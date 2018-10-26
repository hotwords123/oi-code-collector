
'use strict';

const fs   = require('./fs-polyfill');
const Path = require('path');

const logger = require('./logger');
const Lock   = require('./lock');

const { ClientError } = require('./utility');

const usersLock = new Lock();
const userLock = [];

class User {

    constructor(username, submitted = [], banned = false, creationTime = 0) {
        this.username = username;
        this.submitted = submitted;
        this.banned = banned;
        this.creationTime = creationTime;
    }

    get lock() {
        let o = userLock.find((a) => a.username === this.username);
        if (!o) {
            o = {};
            o.username = this.username;
            o.lock = new Lock();
            userLock.push(o);
        }
        return o.lock;
    }

    async ban() {
        await this.lock.exec(async () => {
            if (this.banned) return;
            this.banned = true;
            await saveUsers();
        });
    }

    async pardon() {
        await this.lock.exec(async () => {
            if (!this.banned) return;
            this.banned = false;
            await saveUsers();
        });
    }

    async cleanup() {
        await this.lock.acquire();
        let p = userLock.findIndex((a) => a.username === this.username);
        if (p !== -1) userLock.splice(p, 1);
        for (let i = 0; i < this.submitted.length; ++i) {
            let entry = this.submitted[i];
            await this.deleteCode(entry.filename);
        }
        let dir = this.getDir();
        try {
            await fs.promises.stat(dir);
            try {
                fs.promises.rmdir(dir);
            } catch (err) {
                logger.log(err);
            }
        } catch (err) {}
    }

    findSubmitted(problem) {
        return this.submitted.find((a) => a.problem === problem);
    }

    getDir() {
        return Path.join(__dirname, "uploads", this.username);
    }
    
    getCodeFile(filename) {
        return Path.join(this.getDir(), filename);
    }

    async deleteCode(filename) {
        try {
            await this.lock.exec(async () => {
                await fs.promises.unlink(this.getCodeFile(filename));
            });
        } catch (err) {
            logger.error(err);
        }
    }

    async writeCode(filename, code) {
        await this.lock.exec(async () => {
            let dir = this.getDir();
            try {
                await fs.promises.stat(dir);
            } catch (err) {
                await fs.promises.mkdir(dir);
            }
            await fs.promises.writeFile(this.getCodeFile(filename), code, "utf-8");
        });
    }

    async saveCode(obj) {
        let { problem, filename, language, code } = obj;
        let entry = this.findSubmitted(problem);
        if (entry) {
            await this.deleteCode(entry.filename);
            entry.filename = filename;
            entry.language = language;
            entry.size = code.length;
        } else {
            this.submitted.push({
                problem, filename, language, size: code.length
            });
        }
        await this.writeCode(filename, code);
        await saveUsers();
    }

    async getCode(problem) {
        let entry = this.findSubmitted(problem);
        if (!entry) return null;
        let filename = this.getCodeFile(entry.filename);
        return await this.lock.exec(async () => {
            return await fs.promises.readFile(filename, 'utf-8');
        });
    }

}

const userDataFile = Path.join(__dirname, 'users.json');

let users = loadUsers();

function loadUsers() {
    let data = [];
    try {
        JSON.parse(fs.readFileSync(userDataFile, 'utf-8')).forEach(function(a) {
            data.push(new User(a.username, a.submitted, a.banned, a.creationTime));
        });
    } catch (err) {}
    return data;
}

async function saveUsers() {
    try {
        await usersLock.exec(async () => {
            await fs.promises.writeFile(userDataFile, JSON.stringify(users), "utf-8");
        });
    } catch (err) {
        logger.log(err);
    }
}

function getUser(username) {
    if (!username) return null;
    username = username.toLowerCase();
    return users.find((a) => a.username.toLowerCase() === username) || null;
}

async function createUser(username) {
    if (getUser(username)) throw new ClientError("用户已存在!");
    let user = new User(username, [], false, Date.now());
    users.push(user);
    await saveUsers();
    return user;
}

async function deleteUser(username) {
    let user = getUser(username);
    if (!user) throw new ClientError("找不到用户");
    let p = users.indexOf(user);
    await user.cleanup();
    users.splice(p, 1);
    await saveUsers();
}

module.exports = {
    
    get all() {
        return users;
    },
    get: getUser,
    create: createUser,
    delete: deleteUser

};
