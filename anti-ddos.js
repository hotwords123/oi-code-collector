
'use strict';

const logger = require('./logger');
const { ClientError } = require('./utility');

class ClientInstance {
    constructor() {
        this.lastTime = null;
        this.warnCount = 0;
        this.repeatCount = 0;
        this.banned = false;
    }
}

module.exports = function({ minElapse = 100, maxRepeatCount = 32, maxWarnCount = 20 } = {}) {
    
    let clients = new Map();

    let res = (req, res, next) => {
        let ip = req.ip;
        let inst;
        let result = 'accept';
        if (clients.has(ip)) {
            inst = clients.get(ip);
            if (Date.now() - inst.lastTime < minElapse) {
                ++inst.repeatCount;
                if (inst.repeatCount >= maxRepeatCount) {
                    result = 'deny';
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
            inst = new ClientInstance();
            clients.set(ip, inst);
        }
        inst.lastTime = Date.now();
        switch (result) {
            case 'accept': next(); break;
            case 'deny': {
                res.status(503);
                res.render('error', {
                    res, err: new ClientError("请求频率过高，请稍后再试。")
                });
                break;
            }
            case 'banned': break;
        }
    };

    res.clients = () => clients;

    return res;

};
