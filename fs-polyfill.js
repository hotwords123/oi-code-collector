
'use strict';

let fs = require('fs');

if (!fs.promises) {

    function makePromise(thisObj, fn) {
        return (...arg) => new Promise((resolve, reject) => {
            fn.call(thisObj, ...arg, (err, data) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        });
    }

    fs.promises = {
        unlink: makePromise(fs, fs.unlink),
        mkdir: makePromise(fs, fs.mkdir),
        stat: makePromise(fs, fs.stat),
        writeFile: makePromise(fs, fs.writeFile),
        readFile: makePromise(fs, fs.readFile),
        rmdir: makePromise(fs, fs.rmdir),
        readdir: makePromise(fs, fs.readdir)
    };
}

module.exports = fs;
