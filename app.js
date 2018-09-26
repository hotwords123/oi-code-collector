
'use strict';

const fs   = require('fs');
const Path = require('path');
const http = require('http');

const Express      = require('express');
const bodyParser   = require('body-parser');
const cookieParser = require('cookie-parser');
const ejs          = require('ejs');

const logger   = require('./logger');
const Session  = require('./session');
const User     = require('./user');
const antiDDoS = require('./anti-ddos');
const { ClientError } = require('./utility');

const options = require('./options.json');

const SESSION_ID = "__SESSIONID";
const staticDir = Path.join(__dirname, "static");

const app = Express();

app.use(antiDDoS({}));

app.use(Express.static(staticDir));

app.set('view engine', 'ejs');

app.use(bodyParser.urlencoded({
    extended: true,
    limit: '20mb'
}));
app.use(cookieParser());

app.use((req, res, next) => {
    logger.log(req.method + ' ' + req.url);
    next();
});

app.use(async (req, res, next) => {
    let session = await Session.get(req.cookies[SESSION_ID]);
    if (!session) {
        session = Session.create();
        res.cookie(SESSION_ID, session.sid, {
            maxAge: 1000 * 3600 * 24 * 7
        });
    }
    res.locals.session = session;
    res.locals.user = User.get(session.username);
    next();
});

app.get('/', (req, res, next) => {
    res.redirect('/user');
});

app.get('/user', (req, res) => {
    if (res.locals.user) {
        res.render('user_main', {
            req, res, options
        });
    } else {
        res.render('user_login');
    }
});

app.get('/user/download', (req, res) => {
    res.download(Path.join(__dirname, options.user_file));
});

app.post('/user/login', async (req, res) => {
    try {

        if (res.locals.user) throw new ClientError("已登录!");

        if (Date.now() > options.end_time) throw new ClientError("交题已截止!");

        let username = req.body.username;
        if (typeof username !== 'string') throw new ClientError("参数错误!");

        username = username.trim();
        if (!username) throw new ClientError('用户名不能为空!');

        if (username.length > 32) throw new ClientError('用户名过长!');

        if (/["\\\/.:;<>&|*?]/.test(username)) throw new ClientError('用户名不能含有非法字符!');

        let user = await User.create(username);

        await Session.set(res.locals.session.sid, {
            username: user.username
        });

        res.send({
            success: true,
            result: {
                url: '/user'
            }
        });

    } catch (err) {
        if (err instanceof ClientError) {
            res.send({
                success: false,
                message: err.message
            });
        } else {
            logger.error(err);
            res.send({
                success: false,
                message: '未知错误'
            });
        }
    }
});

app.post('/user/submit', async (req, res) => {
    try {

        if (!res.locals.user) throw new ClientError("请先登录!");

        if (Date.now() > options.end_time) throw new ClientError("交题已截止!");

        let { problem, language, code } = req.body;

        if (-1 === options.problems.indexOf(problem)) throw new ClientError("无此题目!");

        let lang = options.language.find((a) => a.name === language);
        if (!lang) throw new ClientError("无此语言!");

        if (!code) throw new ClientError("代码不能为空!");

        if (code.length < 5 || code.length > 64 * 1024) throw new ClientError("代码长度需在5B至64KB之间!");

        let filename = problem + '.' + lang.suffix;
        
        await res.locals.user.saveCode({
            problem, language, filename, code
        });

        res.send({
            success: true,
            result: null
        });

    } catch (err) {
        if (err instanceof ClientError) {
            res.send({
                success: false,
                message: err.message
            });
        } else {
            logger.error(err);
            res.send({
                success: false,
                message: '未知错误'
            });
        }
    }
});

app.get('/user/code/:problem', async (req, res) => {
    try {
        if (!res.locals.user) throw new ClientError("请先登录");
        let problem = req.params.problem;
        if (-1 === options.problems.indexOf(problem)) throw new ClientError("题目不存在");
        let code = await res.locals.user.getCode(problem);
        if (!code) throw new ClientError("未找到提交记录");
        res.render('view_code', {
            username: res.locals.user.username,
            entry: res.locals.user.findSubmitted(problem),
            code: code,
            download: `/user/code/${problem}/download`
        });
    } catch (err) {
        if (err instanceof ClientError) {
            res.send(err.message);
        } else {
            logger.error(err);
            res.send("未知错误");
        }
    }
});

app.get('/user/code/:problem/download', (req, res) => {
    try {
        if (!res.locals.user) throw new ClientError("请先登录");
        let problem = req.params.problem;
        if (-1 === options.problems.indexOf(problem)) throw new ClientError("题目不存在");
        let entry = res.locals.user.findSubmitted(problem);
        if (!entry) throw new ClientError("未找到提交记录");
        res.download(res.locals.user.getCodeFile(entry.filename));
    } catch (err) {
        if (err instanceof ClientError) {
            res.send(err.message);
        } else {
            logger.error(err);
            res.send("未知错误");
        }
    }
});

app.get('/admin', (req, res) => {
    if (res.locals.session.admin) {
        res.render('admin_main', {
            users: User.all,
            options: options
        });
    } else {
        res.render('admin_login');
    }
});

app.post('/admin/login', async (req, res) => {
    try {

        if (res.locals.session.admin) throw new ClientError("已登录!");

        let password = req.body.password;
        if (password !== options.admin_password) throw new ClientError("密码错误!");

        await Session.set(res.locals.session.sid, {
            admin: true
        });

        res.send({
            success: true,
            result: {
                url: '/admin'
            }
        });

    } catch (err) {
        if (err instanceof ClientError) {
            res.send({
                success: false,
                message: err.message
            });
        } else {
            logger.error(err);
            res.send({
                success: false,
                message: '未知错误'
            });
        }
    }
});

app.get('/admin/logout', async (req, res) => {
    if (res.locals.session.admin) {
        await Session.set(res.locals.session.sid, {
            admin: false
        });
    }
    res.redirect('/admin');
});

app.get('/admin/code/:username/:problem', async (req, res) => {
    try {

        if (!res.locals.session.admin) throw new ClientError("没有权限访问");

        let user = User.get(req.params.username);
        if (!user) throw new ClientError("无此用户");

        let problem = req.params.problem;
        if (-1 === options.problems.indexOf(problem)) throw new ClientError("题目不存在");

        let code = await user.getCode(problem);
        if (!code) throw new ClientError("选手没有提交该题");

        res.render('view_code', {
            username: user.username,
            entry: user.findSubmitted(problem),
            code: code,
            download: `/admin/code/${user.username}/${problem}/download`
        });

    } catch (err) {
        if (err instanceof ClientError) {
            res.send(err.message);
        } else {
            logger.error(err);
            res.send("未知错误");
        }
    }
});

app.get('/admin/code/:username/:problem/download', async (req, res) => {
    try {

        if (!res.locals.session.admin) throw new ClientError("没有权限访问");

        let user = User.get(req.params.username);
        if (!user) throw new ClientError("无此用户");

        let problem = req.params.problem;
        if (-1 === options.problems.indexOf(problem)) throw new ClientError("题目不存在");

        let entry = user.findSubmitted(problem);
        if (!entry) throw new ClientError("选手没有提交该题");

        res.download(user.getCodeFile(entry.filename));

    } catch (err) {
        if (err instanceof ClientError) {
            res.send(err.message);
        } else {
            logger.error(err);
            res.send("未知错误");
        }
    }
});

app.post('/admin/login-as-user', async (req, res) => {
    try {

        if (!res.locals.session.admin) throw new ClientError("没有权限");

        let username = req.body.username || '';
        let user = User.get(username);
        if (!user) throw new ClientError("无此用户");

        Session.set(res.locals.session.sid, {
            username: username
        });

        res.send({
            success: true,
            result: null
        });

    } catch (err) {
        if (err instanceof ClientError) {
            res.send({
                success: false,
                message: err.message
            });
        } else {
            logger.error(err);
            res.send({
                success: false,
                message: '未知错误'
            });
        }
    }
});

app.post('/admin/logout-as-user', async (req, res) => {
    try {

        if (!res.locals.session.admin) throw new ClientError("没有权限");

        Session.set(res.locals.session.sid, {
            username: ""
        });

        res.send({
            success: true,
            result: null
        });

    } catch (err) {
        if (err instanceof ClientError) {
            res.send({
                success: false,
                message: err.message
            });
        } else {
            logger.error(err);
            res.send({
                success: false,
                message: '未知错误'
            });
        }
    }
});

app.use((err, req, res, next) => {
    logger.error(err);
    res.sendStatus(500);
});

app.use((req, res, next) => {
    res.sendStatus(404);
});

app.listen(options.port, options.hostname, () => {
    logger.log(`Server is listening at ${options.hostname || '*'}:${options.port}`);
});
