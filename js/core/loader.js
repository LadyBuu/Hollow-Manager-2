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

        // Listen for data loaded event from database.js
        document.addEventListener('dataLoaded', function(e) {
            self.data = e.detail.data || window.data;
            self.isReady = true;
            self.dispatchReady();
        });

        // If data is already available, dispatch immediately
        if (window.data) {
            self.data = window.data;
            self.isReady = true;
            setTimeout(function() {
                self.dispatchReady();
            }, 10);
        }

        // Also check periodically
        var checkInterval = setInterval(function() {
            if (window.data && !self.isReady) {
                self.data = window.data;
                self.isReady = true;
                self.dispatchReady();
                clearInterval(checkInterval);
            }
        }, 100);
    },

    dispatchReady: function() {
        var event = new CustomEvent('dataLoaded', { detail: { data: this.data } });
        document.dispatchEvent(event);

        while (this.pendingCallbacks.length > 0) {
            var cb = this.pendingCallbacks.shift();
            try {
                cb(this.data);
            } catch (e) {
                // ignore
            }
        }
    },

    whenReady: function(callback) {
        if (this.isReady && this.data) {
            callback(this.data);
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

DataLoader.init();

console.log('loader.js loaded');
