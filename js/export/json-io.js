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

                // Validate after migration
                if (!utils.containsApplicationData(imported)) {
                    alert('Imported data failed validation after migration.\n\n' +
                          'The data structure appears incomplete or corrupt.');
                    return;
                }

                if (!confirm('This will replace all current data. Continue?')) {
                    return;
                }

                // Create backup only after confirmation
                var backup = utils.cloneData(window.data);
                var persisted = false;

                // saveData must exist
                if (typeof window.saveData !== 'function') {
                    alert(
                        'Cannot import JSON: saveData() is unavailable.\n\n' +
                        'The imported data was not applied.\n' +
                        'Please ensure the application has loaded correctly before importing.'
                    );
                    return;
                }

                // Apply imported data to global state
                window.data = imported;
                
                // Now save the current state (which is the imported data)
                Promise.resolve(window.saveData())
                    .then(function(result) {
                        // saveData() returns true on success
                        if (result !== true) {
                            throw new Error('saveData did not confirm successful persistence.');
                        }
                        
                        persisted = true;

                        try {
                            onImportSuccess(imported, true, 'JSON');
                        } catch (renderErr) {
                            console.error('Import persisted successfully, but UI refresh failed:', renderErr);
                            alert(
                                'JSON import was saved successfully, but the interface could not refresh.\n\n' +
                                'Please reload the page to see your imported data.'
                            );
                        }
                    })
                    .catch(function(err) {
                        // Roll back on persistence failure
                        if (!persisted && backup) {
                            window.data = backup;
                        }
                        alert('Failed to save data: ' + err.message + '\n\nData has been rolled back.');
                    });

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

        var charCount = data.characters ? data.characters.length : 0;
        var teamCount = data.teams ? data.teams.length : 0;
        var tournCount = data.tournaments ? data.tournaments.length : 0;
        var missionCount = data.missions ? data.missions.length : 0;

        var msg = format + ' import completed successfully!\n\n' +
            'Characters: ' + charCount + '\n' +
            'Teams: ' + teamCount + '\n' +
            'Tournaments: ' + tournCount + '\n' +
            'Missions: ' + missionCount;

        alert(msg);
    }

    // Expose
    window.exportJSON = exportJSON;
    window.importJSON = importJSON;

})();
