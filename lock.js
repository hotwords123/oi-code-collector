
'use strict';

class Lock {

    constructor() {
        this.locked = false;
        this.queue = [];
    }

    acquire() {
        return new Promise((resolve) => {
            if (!this.locked) {
                this.locked = true;
                resolve();
            } else {
                this.queue.push(resolve);
            }
        });
    }

    release() {
        if (this.queue.length) {
            this.queue.shift()();
        } else {
            this.locked = false;
        }
    }

    async exec(callback, ...arg) {
        await this.acquire();
        let res, err = null;
        try {
            res = callback(...arg);
            if (res instanceof Promise) {
                res = await res;
            }
        } catch (e) {
            err = e;
        }
        this.release();
        if (err) {
            throw err;
        } else {
            return res;
        }
    }

}

module.exports = Lock;
