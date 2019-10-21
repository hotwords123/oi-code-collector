
'use strict';

const fs   = require('fs-extra');
const Path = require('path');

const Lock = require('./lock');
const logger = require('./logger');

const { S_HEX, randStr } = require('./utility');

const sessionDir = Path.join(__dirname, "sessions");

let sessions = new Map();
let sessionLock = new Map();

class Session {
    constructor(sid, username = "", admin = false, loginTime = 0) {
        this.sid = sid;
        this.username = username;
        this.admin = admin;
        this.loginTime = loginTime;
    }
}

function getLock(sid) {
    let o;
    if (!sessionLock.has(sid)) {
        o = new Lock();
        sessionLock.set(sid, o);
    } else {
        o = sessionLock.get(sid);
    }
    return o;
}

function getSessionFile(sid) {
    return Path.join(sessionDir, `${sid}.json`);
}

async function getSession(sid) {
    if (!sid) return null;
    if (sessions.has(sid)) return sessions.get(sid);
    try {
        let filename = getSessionFile(sid);
        let data = JSON.parse(await fs.readFile(filename, "utf-8"));
        let session = new Session(data.sid, data.username, data.admin, data.loginTime);
        sessions.set(sid, session);
        return session;
    } catch (err) {
        return null;
    }
}

async function saveSession(sid) {
    if (!sessions.has(sid)) throw new Error("session not found");
    try {
        let filename = getSessionFile(sid);
        await fs.writeFile(filename, JSON.stringify(sessions.get(sid)), "utf-8");
    } catch (err) {
        logger.error(err);
    }
}

function createSession(sid) {
    while (!sid || sessions.has(sid)) {
        sid = randStr(S_HEX, 32);
    }
    let session = new Session(sid);
    sessions.set(sid, session);
    return session;
}

async function writeSession(sid, obj) {
    let session = await getSession(sid);
    if (!session) throw new Error("session not found");
    session = Object.assign(session, obj);
    await saveSession(sid);
}

module.exports = {

    create: createSession,
    async get(sid) {
        return getLock(sid).exec(getSession, sid);
    },
    async set(sid, obj) {
        return getLock(sid).exec(writeSession, sid, obj);
    },
    async deleteAll() {
        let files = await fs.readdir(sessionDir);
        for (let i = 0; i < files.length; ++i) {
            let tmp = files[i].match(/^(.+)\.json$/);
            if (tmp) {
                let sid = tmp[1];
                await getLock(sid).acquire();
                await fs.unlink(getSessionFile(sid));
            }
        }
        sessions.clear();
        sessionLock.clear();
    }

};
