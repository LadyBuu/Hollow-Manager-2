/**
 * js/core/loader.js - Data Loading System
 * Path: js/core/loader.js
 */

var DataLoader = {
    isReady: false,
    isInitialized: false,
    pendingCallbacks: [],
    data: null,
    _dispatched: false, // Prevent multiple dispatches
    _isDispatching: false, // Prevent re-entrancy

    init: function() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        var self = this;

        // Listen for data loaded event from database.js
        document.addEventListener('dataLoaded', function(e) {
            // Prevent re-entrancy - if we're already dispatching, don't trigger again
            if (self._isDispatching) return;
            
            self.data = e.detail.data || window.data;
            self.isReady = true;
            self._dispatchReady();
        });

        // If data is already available, dispatch immediately
        if (window.data) {
            self.data = window.data;
            self.isReady = true;
            // Use setTimeout to avoid synchronous recursion
            setTimeout(function() {
                self._dispatchReady();
            }, 10);
        }

        // Also check periodically (but stop once ready)
        var checkInterval = setInterval(function() {
            if (window.data && !self.isReady) {
                self.data = window.data;
                self.isReady = true;
                self._dispatchReady();
                clearInterval(checkInterval);
            }
            // If we're already ready, clear the interval
            if (self.isReady) {
                clearInterval(checkInterval);
            }
        }, 100);

        // Safety: clear interval after 5 seconds if still running
        setTimeout(function() {
            clearInterval(checkInterval);
        }, 5000);
    },

    _dispatchReady: function() {
        // Prevent re-entrancy
        if (this._isDispatching) return;
        if (this._dispatched) return;
        
        this._isDispatching = true;
        this._dispatched = true;

        // Process all pending callbacks
        var callbacks = this.pendingCallbacks.slice();
        this.pendingCallbacks = [];
        
        callbacks.forEach(function(cb) {
            try {
                cb(this.data);
            } catch (e) {
                console.warn('Error in data ready callback:', e);
            }
        }, this);

        // Dispatch a single event to notify that data is ready
        // Use a different event name to avoid recursion
        var event = new CustomEvent('dataReady', { detail: { data: this.data } });
        document.dispatchEvent(event);

        this._isDispatching = false;
    },

    whenReady: function(callback) {
        if (this.isReady && this.data) {
            // Call immediately but asynchronously to avoid stack issues
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

// Initialize after a short delay to allow other scripts to load
setTimeout(function() {
    if (!DataLoader.isInitialized) {
        DataLoader.init();
    }
}, 50);

console.log('loader.js loaded');

// Also listen for dataReady events from database.js
document.addEventListener('dataReady', function(e) {
    // Just update data if not already set
    if (!DataLoader.data && e.detail && e.detail.data) {
        DataLoader.data = e.detail.data;
        DataLoader.isReady = true;
    }
});
