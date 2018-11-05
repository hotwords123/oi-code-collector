
'use strict';

const fs   = require('./fs-polyfill');
const Path = require('path');

const logger = require('./logger');
const Lock   = require('./lock');

const { fileExists, mkdirEx, rmdirEx } = require('./utility');

const usersLock = new Lock();
let userLock = [];

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

    async forceLogout() {
        await this.lock.exec(async () => {
            this.creationTime = Date.now();
            await saveUsers();
        });
    }

    async cleanFiles() {
        await this.lock.exec(async () => {
            let dir = this.getDir();
            if (await fileExists(dir)) {
                try {
                    await rmdirEx(dir);
                } catch (err) {
                    logger.log(err);
                }
            }
        });
    }

    async clearSubmitted() {
        await this.cleanFiles();
        this.submitted = [];
        await saveUsers();
    }

    async cleanup() {
        await this.cleanFiles();
        await this.lock.acquire();
        let p = userLock.findIndex((a) => a.username === this.username);
        if (p !== -1) userLock.splice(p, 1);
    }

    findSubmitted(problem) {
        return this.submitted.find((a) => a.problem === problem);
    }

    getDir() {
        return Path.join(__dirname, "uploads", this.username);
    }
    
    getCodeFile({ problem, filename }, save_type = global.options.save_type) {
        switch (save_type) {
            case 'normal':
                return Path.join(this.getDir(), filename);
            case 'subfolder':
                return Path.join(this.getDir(), problem, filename);
            default:
                throw new Error("unknown save_path argument");
        }
    }

    async deleteCode(entry) {
        await this.lock.exec(async () => {
            await fs.promises.unlink(this.getCodeFile(entry));
        });
    }

    async writeCode(entry, code) {
        await this.lock.exec(async () => {
            let path = this.getCodeFile(entry);
            await mkdirEx(path);
            await fs.promises.writeFile(path, code, "utf-8");
        });
    }

    async saveCode({ problem, filename, language, code }) {
        let entry = this.findSubmitted(problem);
        if (entry) {
            await this.deleteCode(entry);
            entry.filename = filename;
            entry.language = language;
            entry.size = code.length;
        } else {
            entry = {
                problem, filename, language, size: code.length
            };
            this.submitted.push(entry);
        }
        await this.writeCode(entry, code);
        await saveUsers();
    }

    async getCode(problem) {
        let entry = this.findSubmitted(problem);
        if (!entry) return null;
        let filename = this.getCodeFile(entry);
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
        logger.error(err);
    }
}

function getUser(username) {
    if (!username) return null;
    username = username.toLowerCase();
    return users.find((a) => a.username.toLowerCase() === username) || null;
}

async function createUser(username) {
    if (getUser(username)) throw new Error("user already exists");
    let user = new User(username, [], false, Date.now());
    users.push(user);
    await saveUsers();
    return user;
}

async function deleteUser(username) {
    let user = getUser(username);
    if (!user) throw new Error("could not find user");
    let p = users.indexOf(user);
    await user.cleanup();
    users.splice(p, 1);
    await saveUsers();
}

async function deleteAllUsers() {
    for (let i = 0; i < users.length; ++i) {
        await users[i].cleanup();
    }
    userLock = [];
    users = [];
    await saveUsers();
}

async function clearAllSubmissions() {
    for (let i = 0; i < users.length; ++i) {
        await users[i].clearSubmitted();
    }
}

module.exports = {
    
    get all() {
        return users;
    },
    get: getUser,
    create: createUser,
    delete: deleteUser,
    deleteAll: deleteAllUsers,
    clearAllSubmissions: clearAllSubmissions

};
