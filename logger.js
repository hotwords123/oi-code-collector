
'use strict';

module.exports = {

    _maxCount: 500,
    _items: [],

    _addItem(type, value) {
        this._items.push({
            type: type,
            value: value,
            time: Date.now()
        });
        while (this._items.length > this._maxCount) {
            this._items.shift();
        }
    },

    log(str) {
        this._addItem('info', str);
        console.log(`[${new Date().toLocaleString()}] ${str}`);
    },

    warn(str) {
        this._addItem('warn', str);
        console.warn(`[${new Date().toLocaleString()}|WARN] ${str}`);
    },

    error(err) {
        this._addItem('error', err);
        console.error(err.stack);
    }

};
