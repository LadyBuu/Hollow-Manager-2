/**
 * js/export/export-utils.js - Shared Export Utilities
 * Path: js/export/export-utils.js
 */

(function() {
    'use strict';

    /**
     * Check if data contains meaningful application data
     * Used for both export and import validation
     */
    function containsApplicationData(data) {
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

    /**
     * Check if data has CSV-exportable content
     * CSV is intentionally limited to simpler tabular data
     */
    function hasCSVExportableData(data) {
        if (!data || typeof data !== 'object') return false;

        var csvCollections = ['characters', 'teams', 'tournaments', 'missions'];
        for (var i = 0; i < csvCollections.length; i++) {
            var key = csvCollections[i];
            if (Array.isArray(data[key]) && data[key].length > 0) {
                return true;
            }
        }

        if (data.curriculum && 
            typeof data.curriculum === 'object' &&
            Array.isArray(data.curriculum.disciplines) &&
            data.curriculum.disciplines.length > 0) {
            return true;
        }

        return false;
    }

    /**
     * Download a blob as a file
     */
    function downloadBlob(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Safe JSON parse with fallback
     */
    function safeJSONParse(str, fallback) {
        if (!str) return fallback;
        try {
            var parsed = JSON.parse(str);
            return parsed !== undefined && parsed !== null ? parsed : fallback;
        } catch (e) {
            return fallback;
        }
    }

    /**
     * Generate a safe ID for imports
     */
    function generateImportId(prefix) {
        if (typeof window.generateId === 'function') {
            return window.generateId(prefix);
        }
        return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    }

    /**
     * Create a backup copy of data for rollback
     */
    function backupData(data) {
        return data ? JSON.parse(JSON.stringify(data)) : null;
    }

    /**
     * Rollback data to a backup
     */
    function rollbackData(backup) {
        if (backup) {
            window.data = backup;
            return true;
        }
        return false;
    }

    // Expose
    window.ExportUtils = {
        containsApplicationData: containsApplicationData,
        hasCSVExportableData: hasCSVExportableData,
        downloadBlob: downloadBlob,
        safeJSONParse: safeJSONParse,
        generateImportId: generateImportId,
        backupData: backupData,
        rollbackData: rollbackData
    };

})();
