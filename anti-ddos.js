
'use strict';

const logger = require('./logger');

class ClientInstance {
    constructor() {
        this.lastTime = null;
        this.warnCount = 0;
        this.repeatCount = 0;
        this.banned = false;
    }
}

module.exports = function({ minElapse = 100, maxRepeatCount = 32, maxWarnCount = 5 }) {
    
    let clients = {};

    return (req, res, next) => {
        let ip = req.ip;
        let inst = clients[ip];
        let result = 'accept';
        if (inst) {
            if (Date.now() - inst.lastTime < minElapse) {
                ++inst.repeatCount;
                if (inst.repeatCount >= maxRepeatCount) {
                    result = 'deny';
                    inst.repeatCount = 0;
                    ++inst.warnCount;
                    if (inst.warnCount >= maxWarnCount && !inst.banned) {
                        inst.banned = true;
                        logger.log('Banned ' + ip);
                    }
                }
            } else {
                inst.repeatCount = 0;
            }
            if (inst.banned) result = 'banned';
        } else {
            inst = clients[ip] = new ClientInstance();
        }
        inst.lastTime = Date.now();
        switch (result) {
            case 'accept': next(); break;
            case 'deny': res.sendStatus(503); break;
            case 'banned': res.send('你因为恶意行为已经被服务器封禁。'); break;
        }
    };

};
