
'use strict';

module.exports = {

    log(str) {
        console.log(`[${new Date().toLocaleString()}] ${str}`);
    },

    error(err) {
        console.error(err);
    }

};
