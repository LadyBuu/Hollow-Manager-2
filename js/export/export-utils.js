/**
 * js/export/export-utils.js - Shared Export Utilities
 * Path: js/export/export-utils.js
 */

(function() {
    'use strict';

    // ============================================================
    // STRICT DATA VALIDATION HELPERS
    // ============================================================

    /**
     * Check if a row is completely blank (all cells empty)
     */
    function isBlankRow(row) {
        if (!row || row.length === 0) return true;
        return row.every(function(cell) {
            return String(cell == null ? '' : cell).trim() === '';
        });
    }

    /**
     * Normalise an ID for consistent comparison
     */
    function normaliseId(id) {
        return id == null ? '' : String(id).trim();
    }

    /**
     * Require a field to be non-empty
     * @throws {Error} if field is missing or empty
     */
    function requireField(row, index, fieldName) {
        var value = String(row[index] == null ? '' : row[index]).trim();
        if (!value) {
            throw new Error('Missing required field "' + fieldName + '" at column ' + (index + 1));
        }
        return value;
    }

    /**
     * Require a field to be a valid integer with strict parsing
     * @throws {Error} if value is not a valid integer
     */
    function requireInteger(row, index, fieldName, fallback) {
        var value = String(row[index] == null ? '' : row[index]).trim();

        if (value === '' && fallback !== undefined) {
            return fallback;
        }

        if (value === '') {
            throw new Error('Missing required numeric field "' + fieldName + '" at column ' + (index + 1));
        }

        // Strict integer validation - rejects "12garbage" or "1.5"
        if (!/^-?\d+$/.test(value)) {
            throw new Error('Invalid integer "' + value + '" for field "' + fieldName + '" at column ' + (index + 1));
        }

        return Number(value);
    }

    /**
     * Require a field to be a valid number with strict parsing
     * @throws {Error} if value is not a valid number
     */
    function requireNumber(row, index, fieldName, fallback) {
        var value = String(row[index] == null ? '' : row[index]).trim();

        if (value === '' && fallback !== undefined) {
            return fallback;
        }

        if (value === '') {
            throw new Error('Missing required numeric field "' + fieldName + '" at column ' + (index + 1));
        }

        // Strict number validation - rejects "1.5abc" or "12garbage"
        if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) {
            throw new Error('Invalid number "' + value + '" for field "' + fieldName + '" at column ' + (index + 1));
        }

        return Number(value);
    }

    /**
     * Require a field to be one of the allowed enum values
     * @throws {Error} if value is not in the allowed list
     */
    function requireEnum(row, index, fieldName, allowed, defaultValue) {
        var value = String(row[index] == null ? '' : row[index]).trim();

        if (value === '' && defaultValue !== undefined) {
            return defaultValue;
        }

        if (value === '') {
            throw new Error('Missing required field "' + fieldName + '" at column ' + (index + 1));
        }

        if (allowed.indexOf(value) === -1) {
            throw new Error('Invalid value "' + value + '" for field "' + fieldName + '" at column ' + (index + 1) +
                          '. Allowed values: ' + allowed.join(', '));
        }

        return value;
    }

    /**
     * Parse a JSON array field with type validation
     * @throws {Error} if JSON is not an array
     */
    function parseJSONArray(row, index, fieldName, fallback, addWarning) {
        var value = String(row[index] == null ? '' : row[index]).trim();

        if (value === '') {
            return fallback;
        }

        try {
            var parsed = JSON.parse(value);

            if (!Array.isArray(parsed)) {
                throw new Error('Expected a JSON array, got ' + typeof parsed);
            }

            return parsed;
        } catch (e) {
            if (typeof addWarning === 'function') {
                addWarning('Invalid JSON array in "' + fieldName + '" at column ' + (index + 1) + ': ' + e.message);
            }
            return fallback;
        }
    }

    /**
     * Parse a JSON object field with type validation
     * @throws {Error} if JSON is not an object
     */
    function parseJSONObject(row, index, fieldName, fallback, addWarning) {
        var value = String(row[index] == null ? '' : row[index]).trim();

        if (value === '') {
            return fallback;
        }

        try {
            var parsed = JSON.parse(value);

            if (Array.isArray(parsed) || parsed === null || typeof parsed !== 'object') {
                throw new Error('Expected a JSON object, got ' + (Array.isArray(parsed) ? 'array' : typeof parsed));
            }

            return parsed;
        } catch (e) {
            if (typeof addWarning === 'function') {
                addWarning('Invalid JSON object in "' + fieldName + '" at column ' + (index + 1) + ': ' + e.message);
            }
            return fallback;
        }
    }

    /**
     * Legacy safe JSON parse with fallback (deprecated - use typed versions above)
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

    // ============================================================
    // APPLICATION DATA VALIDATION
    // ============================================================

    /**
     * Check if data contains meaningful application data
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

    // ============================================================
    // FILE AND ID HELPERS
    // ============================================================

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
     * Generate a safe ID for imports
     */
    function generateImportId(prefix) {
        if (typeof window.generateId === 'function') {
            return window.generateId(prefix);
        }
        return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    }

    /**
     * Create a deep clone of data for rollback
     */
    function cloneData(data) {
        return data ? JSON.parse(JSON.stringify(data)) : null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ExportUtils = {
        // Validation
        isBlankRow: isBlankRow,
        normaliseId: normaliseId,
        requireField: requireField,
        requireInteger: requireInteger,
        requireNumber: requireNumber,
        requireEnum: requireEnum,
        parseJSONArray: parseJSONArray,
        parseJSONObject: parseJSONObject,
        safeJSONParse: safeJSONParse,

        // Core
        containsApplicationData: containsApplicationData,
        hasCSVExportableData: hasCSVExportableData,
        downloadBlob: downloadBlob,
        generateImportId: generateImportId,
        cloneData: cloneData
    };

})();
