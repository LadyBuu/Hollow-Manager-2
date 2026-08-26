/**
 * js/export/json-io.js - JSON Import/Export
 * Handles JSON backup/restore
 * Path: js/export/json-io.js
 */

(function() {
    'use strict';

    function hasExportableData(data) {
        if (!data || typeof data !== 'object') return false;

        var collections = [
            'characters', 'teams', 'tournaments', 'missions', 'activities',
            'classes', 'locations'
        ];

        for (var i = 0; i < collections.length; i++) {
            var key = collections[i];
            if (Array.isArray(data[key]) && data[key].length > 0) {
                return true;
            }
        }

        if (data.locationSchedules &&
            typeof data.locationSchedules === 'object' &&
            Object.keys(data.locationSchedules).length > 0) {
            return true;
        }

        if (data.curriculum && typeof data.curriculum === 'object') {
            var curriculumKeys = [
                'disciplines', 'schedules', 'restDays', 'examDays',
                'grades', 'rankings', 'classInstructors', 'classLabels',
                'classGroupLabels', 'classDurations', 'classLocations',
                'instructorClasses', 'instructorTemplates', 'instructorBlocks',
                'instructorGroups', 'disciplineGroups', 'autoGroups'
            ];

            for (var j = 0; j < curriculumKeys.length; j++) {
                var cKey = curriculumKeys[j];
                var val = data.curriculum[cKey];
                if (Array.isArray(val) && val.length > 0) {
                    return true;
                }
                if (val && typeof val === 'object' && Object.keys(val).length > 0) {
                    return true;
                }
            }
        }

        if (data.social &&
            typeof data.social === 'object' &&
            Array.isArray(data.social.relationships) &&
            data.social.relationships.length > 0) {
            return true;
        }

        return false;
    }

    function exportJSON() {
        var data = window.data || {};
        if (!hasExportableData(data)) {
            alert('No data to export.');
            return;
        }

        var exportData = JSON.parse(JSON.stringify(data));
        var jsonData = JSON.stringify(exportData, null, 2);
        var blob = new Blob([jsonData], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'hollow-blades-data-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

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

                var oldDataCopy = window.data ? JSON.parse(JSON.stringify(window.data)) : null;

                if (typeof window.migrateData === 'function') {
                    imported = window.migrateData(imported);
                }

                if (!hasExportableData(imported)) {
                    alert('No valid data found in JSON file.');
                    return;
                }

                if (!confirm('This will replace all current data. Continue?')) return;

                window.data = imported;

                if (typeof window.saveData === 'function') {
                    window.saveData().then(function() {
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
                              'Characters: ' + (imported.characters ? imported.characters.length : 0) + '\n' +
                              'Teams: ' + (imported.teams ? imported.teams.length : 0) + '\n' +
                              'Tournaments: ' + (imported.tournaments ? imported.tournaments.length : 0));
                    }).catch(function(err) {
                        if (oldDataCopy) window.data = oldDataCopy;
                        alert('Failed to save data: ' + err.message + '\n\nData has been rolled back.');
                    });
                } else {
                    if (oldDataCopy) window.data = oldDataCopy;
                    alert('Could not save imported data.');
                }
            } catch (err) {
                alert('Failed to import JSON: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    // Expose
    window.exportJSON = exportJSON;
    window.importJSON = importJSON;
    window.hasExportableData = hasExportableData;

})();
