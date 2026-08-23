/**
 * js/core/loader.js - Data Loading System
 * Handles data initialization and loading events
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

        document.addEventListener('DOMContentLoaded', function() {
            self.loadData();
        });

        // Also handle cases where DOM already loaded
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            self.loadData();
        }
    },

    loadData: function() {
        var self = this;

        if (typeof window.loadData === 'function') {
            window.loadData()
                .then(function(result) {
                    self.data = result || window.data;
                    self.isReady = true;
                    self.dispatchReady();
                })
                .catch(function(err) {
                    self.data = window.getEmptyData ? window.getEmptyData() : {};
                    window.data = self.data;
                    self.isReady = true;
                    self.dispatchReady();
                });
        } else if (window.data) {
            self.data = window.data;
            self.isReady = true;
            self.dispatchReady();
        } else {
            self.data = window.getEmptyData ? window.getEmptyData() : {};
            window.data = self.data;
            self.isReady = true;
            self.dispatchReady();
        }
    },

    dispatchReady: function() {
        var event = new CustomEvent('dataLoaded', { detail: { data: this.data } });
        document.dispatchEvent(event);

        while (this.pendingCallbacks.length > 0) {
            var cb = this.pendingCallbacks.shift();
            try {
                cb(this.data);
            } catch (e) {
                // ignore errors in callbacks
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

// Convenience function
function whenDataReady(callback) {
    DataLoader.whenReady(callback);
}

// Make globally available
window.DataLoader = DataLoader;
window.whenDataReady = whenDataReady;

// Auto-init
DataLoader.init();

// Expose data as window.data when loaded
document.addEventListener('dataLoaded', function(e) {
    if (e.detail && e.detail.data) {
        window.data = e.detail.data;
    }
});