/**
 * js/export/index.js - Export Module Entry Point
 * Handles UI wiring only - no business logic
 * Path: js/export/index.js
 */

(function() {
    'use strict';

    var initialized = false;

    function initImportExport() {
        if (initialized) return;
        initialized = true;

        // JSON buttons
        bindButton('export-json-btn', function(e) {
            e.preventDefault();
            if (typeof window.exportJSON === 'function') {
                window.exportJSON();
            }
        });

        bindButton('import-json-btn', function(e) {
            e.preventDefault();
            var input = document.getElementById('json-file-input');
            if (input) input.click();
        });

        bindFileInput('json-file-input', function(file) {
            if (typeof window.importJSON === 'function') {
                window.importJSON(file);
            }
        });

        // CSV buttons
        bindButton('export-csv-btn', function(e) {
            e.preventDefault();
            if (typeof window.exportCSV === 'function') {
                window.exportCSV();
            }
        });

        bindButton('import-csv-btn', function(e) {
            e.preventDefault();
            var input = document.getElementById('csv-file-input');
            if (input) input.click();
        });

        bindFileInput('csv-file-input', function(file) {
            if (typeof window.importCSV === 'function') {
                window.importCSV(file);
            }
        });

        bindButton('template-csv-btn', function(e) {
            e.preventDefault();
            if (typeof window.exportTemplateCSV === 'function') {
                window.exportTemplateCSV();
            }
        });
    }

    function bindButton(id, handler) {
        var btn = document.getElementById(id);
        if (!btn) return;
        if (btn.dataset.exportBound === 'true') return;
        btn.dataset.exportBound = 'true';
        btn.addEventListener('click', handler);
    }

    function bindFileInput(id, handler) {
        var input = document.getElementById(id);
        if (!input) return;
        if (input.dataset.exportBound === 'true') return;
        input.dataset.exportBound = 'true';
        input.addEventListener('change', function() {
            if (this.files && this.files.length > 0) {
                handler(this.files[0]);
                this.value = '';
            }
        });
    }

    // Initialise when DOM is ready - no magic delay
    function tryInit() {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            initImportExport();
        } else {
            document.addEventListener('DOMContentLoaded', initImportExport);
        }
    }

    // Also init when data loads (in case buttons are rendered dynamically)
    document.addEventListener('dataReady', function() {
        // Only init if not already done (idempotent)
        if (!initialized) {
            initImportExport();
        }
    });

    // One more safety net - if dataReady fires before DOM is ready
    document.addEventListener('dataLoaded', function() {
        if (!initialized) {
            tryInit();
        }
    });

    tryInit();

    window.initImportExport = initImportExport;

})();
