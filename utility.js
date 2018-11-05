
'use strict';

const S_NUMBER = '0123456789';
const S_HEX = '0123456789ABCDEF';
const S_LETTER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const fs = require('./fs-polyfill');
const Path = require('path');

class ClientError extends Error {
    constructor(...arg) {
        super(...arg);
        this.name = 'ClientError';
    }
}

function randInt(a, b) {
    if (typeof b === 'undefined') return Math.floor(Math.random() * a);
    return Math.floor(Math.random() * (b - a + 1)) + a;
}

function randStr(pattern, length) {
    let str = '';
    while (length--) str += pattern[randInt(pattern.length)];
    return str;
}

async function fileExists(path) {
    try {
        await fs.promises.stat(path);
        return true;
    } catch (err) {
        return false;
    }
}

async function mkdirEx(path) {
    path = Path.resolve(path);
    let arr = path.split(Path.sep);
    for (let i = 2; i < arr.length; ++i) {
        let dir = arr.slice(0, i).join(Path.sep);
        let res;
        try {
            res = await fs.promises.stat(dir);
            if (res.isFile()) {
                throw new Error("directory expected but file found, mkdirEx " + path);
            }
        } catch (err) {
            await fs.promises.mkdir(dir);
        }
    }
}

async function rmdirEx(path) {
    let res;
    try {
        res = await fs.promises.stat(path);
    } catch (err) {
        throw new Error("directory does not exist, rmdirEx " + path);
    }
    if (!res.isDirectory()) {
        throw new Error("file must be a directory, rmdirEx " + path);
    }
    let files = await fs.promises.readdir(path);
    for (let i = 0; i < files.length; ++i) {
        let file = Path.join(path, files[i]);
        res = await fs.promises.stat(file);
        if (res.isDirectory()) {
            await rmdirEx(file);
        } else {
            await fs.promises.unlink(file);
        }
    }
    await fs.promises.rmdir(path);
}

module.exports = {
    S_NUMBER, S_HEX, S_LETTER,
    ClientError,
    randInt, randStr,
    fileExists, mkdirEx, rmdirEx
};
