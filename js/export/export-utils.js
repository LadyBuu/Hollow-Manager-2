/**
 * js/export/export-utils.js - Shared Export Utilities
 * Path: js/export/export-utils.js
 * 
 * This file contains the canonical definitions and utilities for CSV/JSON import/export.
 * All other files should depend on these primitives.
 */

(function() {
    'use strict';

    // ============================================================
    // CANONICAL COLLECTION DEFINITIONS
    // ============================================================

    /**
     * Primary entity collections that CSV can import
     * These are the top-level collections that can exist independently
     */
    var CSV_PRIMARY_COLLECTIONS = [
        'characters',
        'teams',
        'tournaments',
        'missions',
        'disciplines'  // Note: disciplines are stored in curriculum
    ];

    /**
     * Relationship sections that depend on primary entities
     * These are imported after primary entities to ensure referential integrity
     */
    var CSV_RELATIONSHIP_SECTIONS = [
        'teamMembers',
        'teamRankings',
        'tournamentTeams',
        'tournamentMatches',
        'tournamentEliminations',
        'tournamentParticipants'
    ];

    // ============================================================
    // WARNING MANAGEMENT
    // ============================================================

    var MAX_WARNINGS = 50;

    /**
     * Add a warning with a cap
     * Maximum warnings = MAX_WARNINGS (including the omission message)
     */
    function addWarning(warnings, message) {
        if (!Array.isArray(warnings)) return;
        
        if (warnings.length < MAX_WARNINGS - 1) {
            warnings.push(message);
        } else if (warnings.length === MAX_WARNINGS - 1) {
            warnings.push('Additional warnings omitted.');
        }
    }

    // ============================================================
    // ID HANDLING
    // ============================================================

    /**
     * Normalise an ID for consistent comparison
     * Does NOT lowercase - IDs may be case-sensitive
     */
    function normaliseId(id) {
        return id == null ? '' : String(id).trim();
    }

    /**
     * Check if an ID exists in a collection
     * Uses normalised IDs for consistent comparison
     */
    function hasId(collection, id) {
        if (!Array.isArray(collection)) return false;

        var target = normaliseId(id);
        if (!target) return false;

        return collection.some(function(item) {
            return normaliseId(item && item.id) === target;
        });
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
     * Require a field to be a valid finite integer with strict parsing
     * @throws {Error} if value is not a valid finite integer
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

        var parsed = Number(value);
        
        // Check for safe integer (prevents overflow/Infinity)
        if (!Number.isSafeInteger(parsed)) {
            throw new Error('Integer "' + value + '" is outside the safe numeric range for field "' + fieldName + '" at column ' + (index + 1));
        }

        return parsed;
    }

    /**
     * Require a field to be a valid finite number with strict parsing
     * @throws {Error} if value is not a valid finite number
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

        var parsed = Number(value);
        
        // Check for finite number (prevents overflow/Infinity)
        if (!isFinite(parsed)) {
            throw new Error('Number "' + value + '" is out of range for field "' + fieldName + '" at column ' + (index + 1));
        }

        return parsed;
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
     * Returns fallback and optionally records a warning if JSON is invalid
     */
    function parseJSONArray(row, index, fieldName, fallback, warnFn) {
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
            if (typeof warnFn === 'function') {
                warnFn('Invalid JSON array in "' + fieldName + '" at column ' + (index + 1) + ': ' + e.message + ' - using fallback');
            }
            return fallback;
        }
    }

    /**
     * Parse a JSON object field with type validation
     * Returns fallback and optionally records a warning if JSON is invalid
     */
    function parseJSONObject(row, index, fieldName, fallback, warnFn) {
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
            if (typeof warnFn === 'function') {
                warnFn('Invalid JSON object in "' + fieldName + '" at column ' + (index + 1) + ': ' + e.message + ' - using fallback');
            }
            return fallback;
        }
    }

    /**
     * Legacy safe JSON parse with fallback - DEPRECATED
     * Use parseJSONArray or parseJSONObject instead
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
     * Check if data contains meaningful application data (for JSON)
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

        for (var i = 0; i < CSV_PRIMARY_COLLECTIONS.length; i++) {
            var key = CSV_PRIMARY_COLLECTIONS[i];
            if (key === 'disciplines') {
                // Special case: disciplines are in curriculum
                if (data.curriculum &&
                    Array.isArray(data.curriculum.disciplines) &&
                    data.curriculum.disciplines.length > 0) {
                    return true;
                }
            } else if (Array.isArray(data[key]) && data[key].length > 0) {
                return true;
            }
        }

        return false;
    }

    // ============================================================
    // FILE HELPERS
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
     * Create a deep clone of data for rollback
     */
    function cloneData(data) {
        return data ? JSON.parse(JSON.stringify(data)) : null;
    }

    // ============================================================
    // CREATE PROTOTYPE-SAFE OBJECTS
    // ============================================================

    function createSafeMap() {
        return Object.create(null);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ExportUtils = {
        // Canonical definitions
        CSV_PRIMARY_COLLECTIONS: CSV_PRIMARY_COLLECTIONS,
        CSV_RELATIONSHIP_SECTIONS: CSV_RELATIONSHIP_SECTIONS,
        MAX_WARNINGS: MAX_WARNINGS,

        // Warning management
        addWarning: addWarning,

        // ID handling
        normaliseId: normaliseId,
        hasId: hasId,
        generateImportId: generateImportId,

        // Validation
        isBlankRow: isBlankRow,
        requireField: requireField,
        requireInteger: requireInteger,
        requireNumber: requireNumber,
        requireEnum: requireEnum,
        parseJSONArray: parseJSONArray,
        parseJSONObject: parseJSONObject,
        safeJSONParse: safeJSONParse,

        // Data validation
        containsApplicationData: containsApplicationData,
        hasCSVExportableData: hasCSVExportableData,

        // File helpers
        downloadBlob: downloadBlob,
        cloneData: cloneData,

        // Object helpers
        createSafeMap: createSafeMap
    };

})();
