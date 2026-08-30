/**
 * js/export/index.js - Export Module Entry Point
 * Handles UI wiring only - no business logic
 * Path: js/export/index.js
 * 
 * This module is responsible for:
 *   - Wiring up export/import buttons to their handlers
 *   - Managing file input change events
 *   - Lazy loading export modules when needed
 *   - Providing fallback error messages
 * 
 * IMPORTANT:
 *   - This module does NOT contain business logic
 *   - All business logic is in csv-io.js, json-io.js, etc.
 *   - Export modules are loaded lazily to improve performance
 *   - Button handlers check for required functions before executing
 * 
 * DEPENDENCIES:
 *   - window.exportJSON (from json-io.js)
 *   - window.importJSON (from json-io.js)
 *   - window.exportCSV (from csv-io.js)
 *   - window.importCSV (from csv-io.js)
 *   - window.exportTemplateCSV (from template.js)
 * 
 * PERFORMANCE:
 *   - Export modules are loaded synchronously but their handlers
 *     check for existence before executing
 *   - No lazy loading implementation required since modules are
 *     loaded in the correct order in index.html
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__exportIndexLoaded) {
        return;
    }
    window.__exportIndexLoaded = true;

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var required = [
            'exportJSON',
            'importJSON',
            'exportCSV',
            'importCSV',
            'exportTemplateCSV'
        ];

        var missing = [];
        required.forEach(function(name) {
            if (typeof window[name] !== 'function') {
                missing.push(name);
            }
        });

        if (missing.length > 0) {
            console.warn('Export Index: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // UI WIRING
    // ============================================================

    function initImportExport() {
        // Prevent duplicate initialization
        if (_initialized) return;
        _initialized = true;

        // Check dependencies
        if (!checkDependencies()) {
            console.warn('Export Index: Some export functions are not available.');
            // Still bind buttons - they will show error messages if functions are missing
        }

        // JSON buttons
        bindButton('export-json-btn', function(e) {
            e.preventDefault();
            if (typeof window.exportJSON === 'function') {
                window.exportJSON();
            } else {
                showError('JSON export is not available. Please refresh the page.');
            }
        });

        bindButton('import-json-btn', function(e) {
            e.preventDefault();
            var input = document.getElementById('json-file-input');
            if (input) {
                input.click();
            } else {
                showError('File input not found. Please refresh the page.');
            }
        });

        bindFileInput('json-file-input', function(file) {
            if (typeof window.importJSON === 'function') {
                window.importJSON(file);
            } else {
                showError('JSON import is not available. Please refresh the page.');
            }
        });

        // CSV buttons
        bindButton('export-csv-btn', function(e) {
            e.preventDefault();
            if (typeof window.exportCSV === 'function') {
                window.exportCSV();
            } else {
                showError('CSV export is not available. Please refresh the page.');
            }
        });

        bindButton('import-csv-btn', function(e) {
            e.preventDefault();
            var input = document.getElementById('csv-file-input');
            if (input) {
                input.click();
            } else {
                showError('File input not found. Please refresh the page.');
            }
        });

        bindFileInput('csv-file-input', function(file) {
            if (typeof window.importCSV === 'function') {
                window.importCSV(file);
            } else {
                showError('CSV import is not available. Please refresh the page.');
            }
        });

        bindButton('template-csv-btn', function(e) {
            e.preventDefault();
            if (typeof window.exportTemplateCSV === 'function') {
                window.exportTemplateCSV();
            } else {
                showError('CSV template export is not available. Please refresh the page.');
            }
        });
    }

    // ============================================================
    // BINDING HELPERS
    // ============================================================

    function bindButton(id, handler) {
        var btn = document.getElementById(id);
        if (!btn) {
            console.warn('Export Index: Button "' + id + '" not found');
            return;
        }

        // Prevent duplicate binding
        if (btn.dataset.exportBound === 'true') return;
        btn.dataset.exportBound = 'true';

        btn.addEventListener('click', handler);
    }

    function bindFileInput(id, handler) {
        var input = document.getElementById(id);
        if (!input) {
            console.warn('Export Index: File input "' + id + '" not found');
            return;
        }

        // Prevent duplicate binding
        if (input.dataset.exportBound === 'true') return;
        input.dataset.exportBound = 'true';

        input.addEventListener('change', function() {
            if (this.files && this.files.length > 0) {
                handler(this.files[0]);
                // Reset input so the same file can be selected again
                this.value = '';
            }
        });
    }

    // ============================================================
    // ERROR HANDLING
    // ============================================================

    function showError(message) {
        // Use notification system if available
        if (window.NotificationSystem && typeof window.NotificationSystem.notifyError === 'function') {
            window.NotificationSystem.notifyError(message);
            return;
        }

        // Fallback to alert
        alert('Error: ' + message);
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================

    function tryInit() {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            initImportExport();
        } else {
            document.addEventListener('DOMContentLoaded', initImportExport);
        }
    }

    // Listen for dataReady events (in case buttons are rendered dynamically)
    // Note: bind functions are idempotent via data-export-bound attribute
    document.addEventListener('dataReady', initImportExport);
    document.addEventListener('dataLoaded', initImportExport);

    // Also listen for tab changes to re-bind if DOM is replaced
    document.addEventListener('tabChanged', function(e) {
        // Only re-bind if we're on a tab that might contain export buttons
        // The buttons are in the header, which is not replaced by tab switching
        // But we re-bind anyway to be safe - it's idempotent
        if (_initialized) {
            // Re-bind but don't re-initialize fully
            // This handles cases where buttons might be recreated
            _initialized = false;
            initImportExport();
        }
    });

    tryInit();

    // ============================================================
    // EXPOSE
    // ============================================================

    window.initImportExport = initImportExport;

})();
