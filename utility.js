
'use strict';

const S_NUMBER = '0123456789';
const S_HEX = '0123456789ABCDEF';
const S_LETTER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

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

module.exports = {
    S_NUMBER, S_HEX, S_LETTER,
    ClientError,
    randInt, randStr
};
