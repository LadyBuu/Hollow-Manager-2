/**
 * js/core/loader.js - Data Loading System
 * Path: js/core/loader.js
 */

var DataLoader = {
    isReady: false,
    isInitialized: false,
    pendingCallbacks: [],
    data: null,
    _dispatched: false,
    _isDispatching: false,
    _initDone: false,

    init: function() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        var self = this;

        // Listen for data ready event from database.js
        document.addEventListener('dataReady', function(e) {
            // Prevent re-entrancy
            if (self._isDispatching) return;
            
            self.data = e.detail.data || window.data;
            self.isReady = true;
            
            // Use requestAnimationFrame or setTimeout to avoid stack issues
            if (typeof requestAnimationFrame !== 'undefined') {
                requestAnimationFrame(function() {
                    self._dispatchReady();
                });
            } else {
                setTimeout(function() {
                    self._dispatchReady();
                }, 10);
            }
        });

        // If data is already available, dispatch immediately but async
        if (window.data) {
            self.data = window.data;
            self.isReady = true;
            setTimeout(function() {
                self._dispatchReady();
            }, 10);
        }

        // Check periodically but with limits
        var checkCount = 0;
        var maxChecks = 20;
        var checkInterval = setInterval(function() {
            checkCount++;
            if (window.data && !self.isReady) {
                self.data = window.data;
                self.isReady = true;
                self._dispatchReady();
                clearInterval(checkInterval);
            }
            if (self.isReady || checkCount >= maxChecks) {
                clearInterval(checkInterval);
            }
        }, 100);
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
        // Use a different event name and only dispatch once
        var event = new CustomEvent('dataLoaded', { 
            detail: { data: this.data },
            bubbles: false,
            cancelable: false
        });
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
}, 100);

console.log('loader.js loaded');
