/**
 * js/core/loader.js - Data Loading System
 * Path: js/core/loader.js
 */

var DataLoader = {
    isReady: false,
    isInitialized: false,
    pendingCallbacks: [],
    data: null,

    init: function() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        var self = this;

        // Listen for data ready event from database.js
        document.addEventListener('dataReady', function(e) {
            console.log('DataLoader: dataReady event received');
            self.data = e.detail.data || window.data;
            self.isReady = true;
            self._processCallbacks();
        });

        // If data is already available via window.data, process immediately
        if (window.data) {
            console.log('DataLoader: window.data already available');
            self.data = window.data;
            self.isReady = true;
            // Process callbacks after a short delay
            setTimeout(function() {
                self._processCallbacks();
            }, 10);
        }
    },

    _processCallbacks: function() {
        if (!this.isReady || !this.data) return;
        
        var callbacks = this.pendingCallbacks.slice();
        this.pendingCallbacks = [];
        
        callbacks.forEach(function(cb) {
            try {
                cb(this.data);
            } catch (e) {
                console.warn('Error in data ready callback:', e);
            }
        }, this);
    },

    whenReady: function(callback) {
        if (this.isReady && this.data) {
            setTimeout(function() {
                try {
                    callback(this.data);
                } catch (e) {
                    console.warn('Error in data ready callback:', e);
                }
            }.bind(this), 0);
            return;
        }
        this.pendingCallbacks.push(callback);
    },

    getData: function() {
        return this.data || window.data || null;
    }
};

function whenDataReady(callback) {
    DataLoader.whenReady(callback);
}

window.DataLoader = DataLoader;
window.whenDataReady = whenDataReady;

// Initialize immediately
DataLoader.init();

console.log('loader.js loaded');
