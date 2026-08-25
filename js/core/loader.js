/**
 * js/core/loader.js - Data Loading System
 * Path: js/core/loader.js
 */

var DataLoader = {
    isReady: false,
    isInitialized: false,
    hasFailed: false,
    error: null,
    data: null,
    pendingCallbacks: [],

    init: function() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        var self = this;

        document.addEventListener('dataReady', function(e) {
            if (e.detail && e.detail.status === 'failed') {
                self._markFailed(
                    e.detail.error || new Error('Data loading failed')
                );
                return;
            }

            var data = e.detail ? e.detail.data : null;

            if (!data) {
                self._markFailed(
                    new Error('dataReady received without data')
                );
                return;
            }

            self._markReady(data);
        });

        if (window.data) {
            self._markReady(window.data);
        }
    },

    _markReady: function(data) {
        if (!data) return;

        this.data = data;
        this.isReady = true;
        this.hasFailed = false;
        this.error = null;
        this._processCallbacks();
    },

    _markFailed: function(error) {
        this.isReady = false;
        this.hasFailed = true;
        this.error = error || new Error('Data loading failed');

        var callbacks = this.pendingCallbacks.slice();
        this.pendingCallbacks = [];

        callbacks.forEach(function(cb) {
            setTimeout(function() {
                try {
                    cb(null);
                } catch (e) {
                    console.error('DataLoader callback error:', e);
                }
            }, 0);
        });
    },

    _processCallbacks: function() {
        if (!this.isReady || !this.data) return;

        var callbacks = this.pendingCallbacks.slice();
        this.pendingCallbacks = [];

        callbacks.forEach(function(cb) {
            try {
                cb(this.data);
            } catch (e) {
                console.error('DataLoader callback error:', e);
            }
        }, this);
    },

    whenReady: function(callback) {
        if (typeof callback !== 'function') return;

        if (this.isReady && this.data) {
            setTimeout(function() {
                try {
                    callback(this.data);
                } catch (e) {
                    console.error('DataLoader callback error:', e);
                }
            }.bind(this), 0);
            return;
        }

        if (this.hasFailed) {
            setTimeout(function() {
                try {
                    callback(null);
                } catch (e) {
                    console.error('DataLoader callback error:', e);
                }
            }.bind(this), 0);
            return;
        }

        this.pendingCallbacks.push(callback);
    },

    getData: function() {
        return this.isReady ? this.data : null;
    },

    getStatus: function() {
        if (this.hasFailed) return 'failed';
        if (this.isReady) return 'ready';
        if (this.isInitialized) return 'waiting';
        return 'uninitialized';
    },

    getError: function() {
        return this.error;
    }
};

function whenDataReady(callback) {
    DataLoader.whenReady(callback);
}

window.DataLoader = DataLoader;
window.whenDataReady = whenDataReady;

DataLoader.init();
