/**
 * js/export/json-io.js - JSON Import/Export
 * Path: js/export/json-io.js
 */

(function() {
    'use strict';

    var utils = window.ExportUtils;

    function exportJSON() {
        var data = window.data || {};
        if (!utils.containsApplicationData(data)) {
            alert('No data to export.');
            return;
        }

        var exportData = utils.cloneData(data);
        var jsonData = JSON.stringify(exportData, null, 2);
        var blob = new Blob([jsonData], { type: 'application/json' });
        var filename = 'hollow-blades-data-' + new Date().toISOString().slice(0, 10) + '.json';
        
        utils.downloadBlob(blob, filename);

        if (typeof window.logActivity === 'function') {
            window.logActivity('Exported data to JSON');
        }
    }

    function importJSON(file) {
        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var imported = JSON.parse(e.target.result);

                if (!imported || typeof imported !== 'object') {
                    alert('Invalid data format.');
                    return;
                }

                // Validate before migration
                if (!utils.containsApplicationData(imported)) {
                    alert('No valid data found in JSON file.');
                    return;
                }

                // Migrate data
                if (typeof window.migrateData === 'function') {
                    try {
                        imported = window.migrateData(imported);
                    } catch (migrateErr) {
                        alert('Migration failed: ' + migrateErr.message);
                        return;
                    }
                }

                if (!confirm('This will replace all current data. Continue?')) {
                    return;
                }

                // Create backup only after confirmation
                var backup = utils.cloneData(window.data);
                var persisted = false;

                // Use the standardised saveData API
                if (typeof window.saveData === 'function') {
                    // Ensure we get a Promise
                    Promise.resolve(window.saveData(imported))
                        .then(function() {
                            persisted = true;
                            window.data = imported;
                            onImportSuccess(imported, persisted, 'JSON');
                        })
                        .catch(function(err) {
                            // Rollback memory
                            if (backup) {
                                window.data = backup;
                            }
                            alert('Failed to save data: ' + err.message + '\n\nData has been rolled back.');
                        });
                } else {
                    // No persistence available - just update memory
                    window.data = imported;
                    onImportSuccess(imported, false, 'JSON');
                }

            } catch (err) {
                alert('Failed to import JSON: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    function onImportSuccess(data, persisted, format) {
        if (typeof window.logActivity === 'function') {
            window.logActivity('Imported data from ' + format);
        }
        if (typeof window.renderAll === 'function') {
            window.renderAll();
        }
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
        utils.showImportResult(persisted, data, format);
    }

    // Expose
    window.exportJSON = exportJSON;
    window.importJSON = importJSON;

})();
