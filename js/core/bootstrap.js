/**
 * js/core/bootstrap.js - Application Bootstrap
 * Path: js/core/bootstrap.js
 * 
 * This module connects infrastructure components:
 *   - DataLoader → TabManager (data readiness)
 *   - Database → DataLoader (data loading)
 * 
 * IMPORTANT:
 *   - This is the explicit bridge between infrastructure modules
 *   - No domain logic here
 *   - Just connects the dots
 */

(function() {
    'use strict';

    if (window.__bootstrapLoaded) return;
    window.__bootstrapLoaded = true;

    var DataLoader = window.DataLoader;
    var TabManager = window.TabManager;

    function bootstrap() {
        // Wait for data to be ready
        if (DataLoader && typeof DataLoader.whenReady === 'function') {
            DataLoader.whenReady(function(data) {
                if (data) {
                    // Data is ready - tell TabManager
                    if (TabManager && typeof TabManager.onDataReady === 'function') {
                        TabManager.onDataReady();
                    }
                } else {
                    // Data loading failed - fallback to default tab
                    if (TabManager && typeof TabManager.switchTo === 'function') {
                        TabManager.switchTo('dashboard', false);
                    }
                }
            });
        } else {
            // No DataLoader - try direct check
            if (window.data) {
                if (TabManager && typeof TabManager.onDataReady === 'function') {
                    TabManager.onDataReady();
                }
            }
        }
    }

    // Auto-bootstrap when DOM is ready
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        bootstrap();
    } else {
        document.addEventListener('DOMContentLoaded', bootstrap);
    }

    // Also expose for manual invocation
    window.bootstrap = bootstrap;

})();