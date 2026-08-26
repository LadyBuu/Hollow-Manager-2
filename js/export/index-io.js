/**
 * js/export/index.js - Export Module Entry Point
 * Path: js/export/index.js
 */

(function() {
    'use strict';

    function initImportExport() {
        // JSON buttons
        bindButton('export-json-btn', function(e) {
            e.preventDefault();
            window.exportJSON();
        });

        bindButton('import-json-btn', function(e) {
            e.preventDefault();
            var input = document.getElementById('json-file-input');
            if (input) input.click();
        });

        bindFileInput('json-file-input', window.importJSON);

        // CSV buttons
        bindButton('export-csv-btn', function(e) {
            e.preventDefault();
            window.exportCSV();
        });

        bindButton('import-csv-btn', function(e) {
            e.preventDefault();
            var input = document.getElementById('csv-file-input');
            if (input) input.click();
        });

        bindFileInput('csv-file-input', window.importCSV);

        bindButton('template-csv-btn', function(e) {
            e.preventDefault();
            window.exportTemplateCSV();
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

    // Auto-initialize
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(initImportExport, 200);
    } else {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(initImportExport, 200);
        });
    }

    document.addEventListener('dataLoaded', function() {
        setTimeout(initImportExport, 300);
    });

    window.initImportExport = initImportExport;

})();
