
'use strict';

const fs   = require('fs-extra');
const Path = require('path');

const Express      = require('express');
const Multer       = require('multer');
const bodyParser   = require('body-parser');
const cookieParser = require('cookie-parser');

const compressing = require('compressing');

const logger   = require('./logger');
const Lock     = require('./lock');

const Session  = require('./session');
const User     = require('./user');
const { ClientError, mkdirEx } = require('./utility');

global.options = loadOptions();
if (!options) {
    try {
        options = loadDefaultOptions();
    } catch (err) {
        logger.error("Failed to load options. Process exiting.");
        process.exit(1);
    }
    logger.log("Failed to load options. Using options-example.json instead.");
}

const SESSION_ID = "__SESSIONID";
const staticDir = Path.join(__dirname, "static");

const app = Express();

const antiDDoS = require('./anti-ddos')();

global.outOfOrder = false;

app.use(antiDDoS);

app.use((req, res, next) => {
    if (outOfOrder) {
        if (req.url.startsWith('/api/')) {
            apiErrHandler(req, res, new ClientError("服务器维护中，稍安勿躁..."));
        } else {
            res.status(503);
            res.render('error', {
                res, err: new ClientError("服务器维护中，稍安勿躁...")
            });
        }
        return;
    }
    next();
});

app.use(Express.static(staticDir));

app.set('view engine', 'ejs');

app.use(bodyParser.urlencoded({
    extended: true,
    limit: '64mb'
}));
app.use(cookieParser());
let multer = Multer({
    limits: {
        fileSize: options.max_file_size > 0 ? options.max_file_size : Infinity
    }
});

app.use((req, res, next) => {
    logger.log([req.ip, req.method, req.url].join(' '));
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

app.use(async (req, res, next) => {
    try {
        let user = res.locals.user;
        if (user) {
            await user.recordIp(req.ip);
        }
        next();
    } catch (err) {
        errHandler(req, res, err);
    }
});

app.get('/', (req, res) => {
    try {
        let user = res.locals.user;
        if (user) {
            res.redirect('/user');
        } else {
            res.redirect('/user/login');
        }
    } catch (err) {
        errHandler(req, res, err);
    }
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
            res.redirect('/user/login');
        }
    } catch (err) {
        errHandler(req, res, err);
    }
});

app.get('/user/login', (req, res) => {
    try {
        let user = res.locals.user;
        if (user) {
            res.redirect('/user');
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

        if (options.username_regex && options.force_username_format && !res.locals.session.admin) {
            let re = new RegExp(options.username_regex, options.username_regex_case_sensitive ? '' : 'i');
            if (!re.test(username)) {
                var tip_text = '用户名不符合格式要求!';
                if (options.username_tip) {
                    tip_text += '\n格式: ' + options.username_tip;
                }
                throw new ClientError(tip_text);
            }
        }

        let user = User.get(username);
        if (user) {
            let flag = true;
            if (!options.use_authorization) {
                flag = false;
            } else if (options.allow_ip_authorization && user.ips && user.ips.includes(req.ip)) {
                flag = false;
            }
            if (flag) {
                throw new ClientError('用户已存在');
            }
        } else {
            user = await User.create(username);
        }

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

app.get('/api/user/announcements', async (req, res) => {
    try {
        res.send({
            success: true,
            result: {
                announcements: options.announcement
            }
        });
    } catch (err) {
        apiErrHandler(req, res, err);
    }
});

app.post('/api/user/submit', multer.fields([{ name: 'code', maxCount: 1 }]), async (req, res) => {
    try {
        if (!res.locals.user) throw new ClientError("请先登录");
        if (res.locals.user.banned) throw new ClientError("该账户被封禁");

        if (Date.now() < options.start_time) throw new ClientError("比赛还没有开始");
        if (Date.now() > options.end_time) throw new ClientError("交题已截止");

        let { problem, language } = req.body;

        if (-1 === options.problems.indexOf(problem)) throw new ClientError("无此题目");

        let lang = options.language.find((a) => a.name === language);
        if (!lang) throw new ClientError("无此语言");

        if (!req.files.code) throw new ClientError("代码不能为空");

        let codeFile = req.files.code[0];

        if (!codeFile.size) throw new ClientError("代码不能为空");

        if (options.max_file_size > 0 && codeFile.size > options.max_file_size) throw new ClientError("代码长度超出限制");

        let filename = problem + '.' + lang.suffix;
        
        await res.locals.user.saveCode({
            problem, language, filename, code: codeFile.buffer
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
        res.download(res.locals.user.getCodeFile(entry));
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
                users: User.all.sort((a, b) => a.username < b.username ? -1 : a.username > b.username ? 1 : 0),
                options: options
            });
        } else {
            res.redirect('/admin/login');
        }
    } catch (err) {
        errHandler(req, res, err);
    }
});

app.get('/admin/login', (req, res) => {
    try {
        if (res.locals.session.admin) {
            res.redirect('/admin');
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
        res.redirect('/admin/login');
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

        res.download(user.getCodeFile(entry));
    } catch (err) {
        errHandler(req, res, err);
    }
});

app.get('/admin/code-all/download', async (req, res) => {
    try {
        if (!res.locals.session.admin) throw new ClientError("没有权限访问");

        let users = User.all;
        if (!users.length) throw new ClientError("还没有选手提交题目");

        let problems = global.options.problems;

        let stream = new compressing.zip.Stream();

        let save_type = req.query.save_type || global.options.save_type;
        if (!['normal', 'subfolder'].includes(save_type)) {
            throw new ClientError("参数错误");
        }

        let flag = false;

        users.forEach((user) => {
            problems.forEach((problem) => {
                let entry = user.findSubmitted(problem);
                if (entry) {
                    let relativePath = user.getCodeFileRelative(entry, save_type);
                    let absolutePath = user.getCodeFile(entry);
                    stream.addEntry(absolutePath, {
                        relativePath: Path.join(user.username, relativePath)
                    });
                    flag = true;
                }
            });
        });

        if (!flag) {
            stream.destroy();
            throw new ClientError("还没有选手提交题目");
        }

        stream.on('error', (err) => {
            errHandler(req, res, err);
        });

        res.header('Content-Disposition', 'attachment; filename=code.zip');
        stream.pipe(res);
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

        let tmp = loadOptions();
        if (!tmp) throw new ClientError("无法加载新的配置文件");
        
        options = tmp;

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

        const fields = ['problems', 'language', 'announcement', 'username_regex', 'username_tip', 'username_regex_case_sensitive', 'force_username_format', 'use_authorization', 'allow_ip_authorization', 'start_time', 'end_time', 'user_file', 'max_file_size', 'hostname', 'port'];

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

app.post('/api/admin/change-save-method', async (req, res) => {
    try {
        if (!res.locals.session.admin) throw new ClientError("没有权限");

        let newType = req.body.type;
        let newRoot = req.body.root;

        if (-1 === ['normal', 'subfolder'].indexOf(newType)) throw new ClientError("参数错误");
        if (!newRoot) throw new ClientError("参数错误");
        if (newType === options.save_type && newRoot === options.save_root) throw new ClientError("设置未更改");

        try {
            await mkdirEx(Path.join(newRoot, 'a'));
        } catch (err) {
            logger.error(err);
            throw new ClientError("无法创建文件夹");
        }

        outOfOrder = true;

        await User.clearAllSubmissions();

        options.save_type = newType;
        options.save_root = newRoot;

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

function loadOptions() {
    try {
        let res = JSON.parse(fs.readFileSync('./options.json', 'utf-8'));
        res.save_root = res.save_root || 'uploads';
        res.save_type = res.save_type || 'normal';
        return res;
    } catch (err) {
        return null;
    }
}

function loadDefaultOptions() {
    return JSON.parse(fs.readFileSync('./options-example.json', 'utf-8'));
}
