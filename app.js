
'use strict';

const fs   = require('./fs-polyfill');
const Path = require('path');

const Express      = require('express');
const bodyParser   = require('body-parser');
const cookieParser = require('cookie-parser');

const logger   = require('./logger');
const Lock     = require('./lock');

const Session  = require('./session');
const User     = require('./user');
const { ClientError } = require('./utility');

let options = require('./options.json');

const SESSION_ID = "__SESSIONID";
const staticDir = Path.join(__dirname, "static");

const app = Express();

const antiDDoS = require('./anti-ddos')();

let outOfOrder = false;

app.use(antiDDoS);

app.use((req, res, next) => {
    if (outOfOrder) {
        res.status(503);
        res.render('error', {
            res, err: new ClientError("服务器维护中，稍安勿躁...")
        });
        return;
    }
    next();
});

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
    try {
        let session = await Session.get(req.cookies[SESSION_ID]);
        if (!session) {
            session = Session.create();
            res.cookie(SESSION_ID, session.sid, {
                maxAge: 1000 * 3600 * 24 * 7
            });
        }
        res.locals.session = session;
        let user = User.get(session.username);
        if (user) {
            if (user.creationTime > session.loginTime) {
                await Session.set(session.sid, {
                    username: ""
                });
                user = null;
            }
        } else if (session.username) {
            await Session.set(session.sid, {
                username: ""
            });
        }
        res.locals.user = user;
        next();
    } catch (err) {
        errHandler(req, res, err);
    }
});

app.get('/', (req, res, next) => {
    res.redirect('/user');
});

app.get('/user', (req, res) => {
    try {
        let user = res.locals.user;
        if (user) {
            if (user.banned) throw new ClientError("该账户被封禁");
            if (Date.now() < options.start_time) {
                res.render('user_before_start', {
                    req, res, options
                });
            } else {
                res.render('user_main', {
                    req, res, options
                });
            }
        } else {
            res.render('user_login');
        }
    } catch (err) {
        errHandler(req, res, err);
    }
});

app.get('/user/download', (req, res) => {
    try {
        if (!res.locals.user) throw new ClientError("请先登录");
        if (res.locals.user.banned) throw new ClientError("该账户被封禁");

        if (Date.now() < options.start_time) throw new ClientError("比赛还没有开始");
        
        if (!options.user_file) throw new ClientError("文件似乎消失了...");

        res.download(Path.resolve(options.user_file), (err) => {
            if (err) {
                errHandler(req, res, err);
            }
        });
    } catch (err) {
        errHandler(req, res, err);
    }
});

app.post('/api/user/login', async (req, res) => {
    try {
        if (res.locals.user) throw new ClientError("已登录");

        if (Date.now() > options.end_time) throw new ClientError("交题已截止");

        let username = req.body.username;
        if (typeof username !== 'string') throw new ClientError("参数错误");

        username = username.trim();
        if (!username) throw new ClientError('用户名不能为空');

        if (username.length > 32) throw new ClientError('用户名过长');

        if (/["\\\/.:;<>&|*?]/.test(username)) throw new ClientError('用户名不能含有非法字符');

        let user = User.get(username);
        if (user) throw new ClientError('用户已存在');

        user = await User.create(username);
        await Session.set(res.locals.session.sid, {
            username: user.username,
            loginTime: Date.now()
        });

        res.send({
            success: true,
            result: {
                url: '/user'
            }
        });
    } catch (err) {
        apiErrHandler(req, res, err);
    }
});

app.post('/api/user/submit', async (req, res) => {
    try {
        if (!res.locals.user) throw new ClientError("请先登录");
        if (res.locals.user.banned) throw new ClientError("该账户被封禁");

        if (Date.now() < options.start_time) throw new ClientError("比赛还没有开始");
        if (Date.now() > options.end_time) throw new ClientError("交题已截止");

        let { problem, language, code } = req.body;

        if (-1 === options.problems.indexOf(problem)) throw new ClientError("无此题目");

        let lang = options.language.find((a) => a.name === language);
        if (!lang) throw new ClientError("无此语言");

        if (!code) throw new ClientError("代码不能为空");

        if (options.max_file_size > 0 && code.length > options.max_file_size) throw new ClientError("代码长度超出限制");

        let filename = problem + '.' + lang.suffix;
        
        await res.locals.user.saveCode({
            problem, language, filename, code
        });

        res.send({
            success: true,
            result: null
        });
    } catch (err) {
        apiErrHandler(req, res, err);
    }
});

app.get('/user/code/:problem', async (req, res) => {
    try {
        if (!res.locals.user) throw new ClientError("请先登录");
        if (res.locals.user.banned) throw new ClientError("该账户被封禁");

        if (Date.now() < options.start_time) throw new ClientError("比赛还没有开始");

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
        errHandler(req, res, err);
    }
});

app.get('/user/code/:problem/download', (req, res) => {
    try {
        if (!res.locals.user) throw new ClientError("请先登录");
        if (res.locals.user.banned) throw new ClientError("该账户被封禁");
        if (Date.now() < options.start_time) throw new ClientError("比赛还没有开始");
        let problem = req.params.problem;
        if (-1 === options.problems.indexOf(problem)) throw new ClientError("题目不存在");
        let entry = res.locals.user.findSubmitted(problem);
        if (!entry) throw new ClientError("未找到提交记录");
        res.download(res.locals.user.getCodeFile(entry.filename));
    } catch (err) {
        errHandler(req, res, err);
    }
});

app.post('/api/user/delete-account', async (req, res) => {
    try {
        if (!res.locals.user) throw new ClientError("请先登录");
        if (res.locals.user.banned) throw new ClientError("该账户被封禁");
        await User.delete(res.locals.user.username);
        await Session.set(res.locals.session.sid, {
            username: ""
        });
        res.send({
            success: true,
            result: null
        });
    } catch (err) {
        apiErrHandler(req, res, err);
    }
});

app.get('/admin', (req, res) => {
    try {
        if (res.locals.session.admin) {
            res.render('admin_main', {
                res,
                users: User.all,
                options: options
            });
        } else {
            res.render('admin_login');
        }
    } catch (err) {
        errHandler(req, res, err);
    }
});

app.post('/api/admin/login', async (req, res) => {
    try {
        if (res.locals.session.admin) throw new ClientError("已登录");

        let password = req.body.password;
        if (password !== options.admin_password) throw new ClientError("密码错误");

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
        apiErrHandler(req, res, err);
    }
});

app.get('/admin/logout', async (req, res) => {
    try {
        if (res.locals.session.admin) {
            await Session.set(res.locals.session.sid, {
                admin: false
            });
        }
        res.redirect('/admin');
    } catch (err) {
        errHandler(req, res, err);
    }
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
        errHandler(req, res, err);
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
        errHandler(req, res, err);
    }
});

app.post('/api/admin/user-action/:action', async (req, res) => {
    try {
        if (!res.locals.session.admin) throw new ClientError("没有权限");

        let username = req.body.username || '';

        if (req.params.action === 'logout') {
            Session.set(res.locals.session.sid, {
                username: ""
            });
        } else {
            let user = User.get(username);
            if (!user) throw new ClientError("无此用户");

            switch (req.params.action) {

                case 'login':
                    Session.set(res.locals.session.sid, {
                        username: username,
                        loginTime: Date.now()
                    });
                    break;
                
                case 'ban':
                    await user.ban();
                    break;
                
                case 'pardon':
                    await user.pardon();
                    break;

                case 'force-logout':
                    await user.forceLogout();
                    break;

                case 'delete':
                    await User.delete(username);
                    break;

                default:
                    throw new ClientError("参数错误");
            }
        }

        res.send({
            success: true,
            result: null
        });
    } catch (err) {
        apiErrHandler(req, res, err);
    }
});

app.post('/api/admin/options/reload', async (req, res) => {
    try {
        if (!res.locals.session.admin) throw new ClientError("没有权限");

        reloadOptions();

        res.send({
            success: true,
            result: null
        });
    } catch (err) {
        apiErrHandler(req, res, err);
    }
});

app.post('/api/admin/options/modify', (req, res) => {
    try {
        if (!res.locals.session.admin) throw new ClientError("没有权限");

        const fields = ['problems', 'language', 'announcement', 'start_time', 'end_time', 'user_file', 'max_file_size', 'hostname', 'port'];

        let o;
        try {
            o = JSON.parse(req.body.value);
        } catch (err) {
            throw new ClientError("无法解析JSON");
        }
        
        fields.forEach(function(key) {
            if (o.hasOwnProperty(key)) {
                options[key] = o[key];
            }
        });
        saveOptions();

        res.send({
            success: true,
            result: null
        });
    } catch (err) {
        apiErrHandler(req, res, err);
    }
});

app.post('/api/admin/change-password', (req, res) => {
    try {
        if (!res.locals.session.admin) throw new ClientError("没有权限");
        
        if (req.body.old !== options.admin_password) throw new ClientError("原密码错误");
        
        let newPassword = req.body.new;
        if (!newPassword) throw new ClientError("新密码不能为空");
        
        options.admin_password = newPassword;
        saveOptions();

        res.send({
            success: true,
            result: null
        });
    } catch (err) {
        apiErrHandler(req, res, err);
    }
});

app.post('/api/admin/reset', async (req, res) => {
    try {
        if (!res.locals.session.admin) throw new ClientError("没有权限");

        let password = req.body.password;
        if (password !== options.admin_password) throw new ClientError("密码错误");

        outOfOrder = true;

        await Session.deleteAll();
        await User.deleteAll();
        
        outOfOrder = false;

        res.send({
            success: true,
            result: null
        });
    } catch (err) {
        outOfOrder = false;
        apiErrHandler(req, res, err);
    }
});

function errHandler(req, res, err) {
    if (err.name !== 'ClientError') {
        res.status(500);
        logger.error(err);
    }
    res.render("error", {
        res, err
    });
}

function apiErrHandler(req, res, err) {
    if (err.name === 'ClientError') {
        res.send({
            success: false,
            message: err.message
        });
    } else {
        logger.error(err);
        res.send({
            success: false,
            message: res.locals.session.admin ? err.stack : '未知错误'
        });
    }
}

app.use((err, req, res, next) => {
    if (req.url.startsWith('/api/')) {
        apiErrHandler(req, res, err);
    } else {
        errHandler(req, res, err);
    }
});

app.use((req, res, next) => {
    if (req.url.startsWith('/api/')) {
        res.send({
            success: false,
            message: req.method + ' ' + req.url + '\n404 Not Found'
        });
    } else {
        res.status(404);
        res.render("error", {
            res, err: new ClientError("这个页面似乎不见了...")
        });
    }
});

app.listen(options.port, options.hostname, () => {
    logger.log(`Server is listening at ${options.hostname || '*'}:${options.port}`);
});

function saveOptions() {
    fs.writeFileSync('./options.json', JSON.stringify(options, null, "    "), "utf-8");
}

function reloadOptions() {
    options = JSON.parse(fs.readFileSync('./options.json', 'utf-8'));
}
