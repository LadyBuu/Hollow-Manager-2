/**
 * js/export/json-io.js - JSON Import/Export
 * Handles JSON backup/restore with proper transaction semantics
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

        var exportData = JSON.parse(JSON.stringify(data));
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

                // Create backup before any changes
                var backup = utils.backupData(window.data);

                // Migrate data
                if (typeof window.migrateData === 'function') {
                    try {
                        imported = window.migrateData(imported);
                    } catch (migrateErr) {
                        alert('Migration failed: ' + migrateErr.message);
                        return;
                    }
                }

                if (!utils.containsApplicationData(imported)) {
                    alert('No valid data found in JSON file.');
                    return;
                }

                if (!confirm('This will replace all current data. Continue?')) {
                    return;
                }

                // Save to database first, then update in-memory state
                if (typeof window.saveData === 'function') {
                    // If saveData accepts data, use that
                    if (window.saveData.length >= 1) {
                        window.saveData(imported).then(function() {
                            window.data = imported;
                            onImportSuccess(imported);
                        }).catch(function(err) {
                            utils.rollbackData(backup);
                            alert('Failed to save data: ' + err.message + '\n\nData has been rolled back.');
                        });
                    } else {
                        // Legacy saveData that uses window.data
                        window.data = imported;
                        window.saveData().then(function() {
                            onImportSuccess(imported);
                        }).catch(function(err) {
                            utils.rollbackData(backup);
                            alert('Failed to save data: ' + err.message + '\n\nData has been rolled back.');
                        });
                    }
                } else {
                    // No persistence available - just update memory
                    window.data = imported;
                    onImportSuccess(imported);
                    alert('Data imported into memory, but could not be saved to persistent storage.');
                }

            } catch (err) {
                alert('Failed to import JSON: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    function onImportSuccess(data) {
        if (typeof window.logActivity === 'function') {
            window.logActivity('Imported data from JSON');
        }
        if (typeof window.renderAll === 'function') {
            window.renderAll();
        }
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
        alert('Data imported successfully!\n' +
              'Characters: ' + (data.characters ? data.characters.length : 0) + '\n' +
              'Teams: ' + (data.teams ? data.teams.length : 0) + '\n' +
              'Tournaments: ' + (data.tournaments ? data.tournaments.length : 0));
    }

    // Expose
    window.exportJSON = exportJSON;
    window.importJSON = importJSON;

})();
