
'use strict';

let fs = require('fs');

if (!fs.promises) {

    const util = require('util');

    fs.promises = {
        unlink: util.promisify(fs.unlink),
        mkdir: util.promisify(fs.mkdir),
        stat: util.promisify(fs.stat),
        writeFile: util.promisify(fs.writeFile),
        readFile: util.promisify(fs.readFile),
        rmdir: util.promisify(fs.rmdir),
        readdir: util.promisify(fs.readdir)
    };
}

module.exports = fs;
