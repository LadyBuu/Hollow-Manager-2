/**
 * js/export/index.js - Export Module Entry Point
 * Handles UI wiring only - no business logic
 */

(function() {
    'use strict';

    if (window.__exportIndexLoaded) return;
    window.__exportIndexLoaded = true;

    var _initialized = false;

    function initImportExport() {
        if (_initialized) return;
        _initialized = true;

        // Full JSON import/export (full backup)
        bindButton('export-json-btn', function(e) {
            e.preventDefault();
            if (typeof window.exportJSON === 'function') {
                window.exportJSON();
            } else {
                showError('JSON export is not available.');
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
            } else {
                showError('JSON import is not available.');
            }
        });

        // Character CSV import/export
        bindButton('export-characters-csv-btn', function(e) {
            e.preventDefault();
            if (typeof window.exportCharactersCSV === 'function') {
                window.exportCharactersCSV();
            } else {
                showError('Character CSV export is not available.');
            }
        });

        bindButton('import-characters-csv-btn', function(e) {
            e.preventDefault();
            var input = document.getElementById('characters-csv-file-input');
            if (input) input.click();
        });

        bindFileInput('characters-csv-file-input', function(file) {
            if (typeof window.importCharactersCSV === 'function') {
                window.importCharactersCSV(file);
            } else {
                showError('Character CSV import is not available.');
            }
        });

        bindButton('template-characters-csv-btn', function(e) {
            e.preventDefault();
            if (typeof window.exportCharacterTemplate === 'function') {
                window.exportCharacterTemplate();
            } else {
                showError('Character template export is not available.');
            }
        });

        // Mission CSV import/export
        bindButton('export-missions-csv-btn', function(e) {
            e.preventDefault();
            if (typeof window.exportMissionsCSV === 'function') {
                window.exportMissionsCSV();
            } else {
                showError('Mission CSV export is not available.');
            }
        });

        bindButton('import-missions-csv-btn', function(e) {
            e.preventDefault();
            var input = document.getElementById('missions-csv-file-input');
            if (input) input.click();
        });

        bindFileInput('missions-csv-file-input', function(file) {
            if (typeof window.importMissionsCSV === 'function') {
                window.importMissionsCSV(file);
            } else {
                showError('Mission CSV import is not available.');
            }
        });

        bindButton('template-missions-csv-btn', function(e) {
            e.preventDefault();
            if (typeof window.exportMissionTemplate === 'function') {
                window.exportMissionTemplate();
            } else {
                showError('Mission template export is not available.');
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

    function showError(message) {
        if (window.NotificationSystem && typeof window.NotificationSystem.notifyError === 'function') {
            window.NotificationSystem.notifyError(message);
            return;
        }
        alert('Error: ' + message);
    }

    function tryInit() {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            initImportExport();
        } else {
            document.addEventListener('DOMContentLoaded', initImportExport);
        }
    }

    document.addEventListener('dataReady', initImportExport);
    document.addEventListener('tabChanged', function(e) {
        if (_initialized) {
            _initialized = false;
            initImportExport();
        }
    });

    tryInit();

    window.initImportExport = initImportExport;

})();
