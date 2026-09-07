/**
 * js/export/json-io.js - JSON Import/Export
 * PURE I/O - no mutation, no UI, no persistence
 * 
 * This module handles JSON serialization, deserialization, and file operations.
 * It does NOT mutate application state or call saveData().
 * 
 * It does NOT:
 * - Access window.data directly
 * - Call saveData()
 * - Show alerts or confirmations
 * - Log activity
 * - Render UI
 * - Mutate application state
 * - Apply migrations (caller should handle this)
 * 
 * Usage:
 *   // Export
 *   var result = exportJSON(data);
 *   // result: { exported: true, filename: string }
 * 
 *   // Import
 *   var result = parseJSON(jsonText);
 *   if (result.valid) {
 *     // Pass result.data to migration layer, then to mutation layer
 *   }
 * 
 *   // Read file
 *   var result = await importJSONFromFile(file);
 *   // result: { valid: boolean, data: object, error: string|null }
 */

(function() {
    'use strict';

    // ============================================================
    // Dependencies
    // ============================================================

    var fileUtils = window.FileUtils || window.ExportUtils;

    // Validate dependencies
    if (!fileUtils || typeof fileUtils.downloadBlob !== 'function') {
        throw new Error('JSONIO: FileUtils not available');
    }

    // ============================================================
    // Export Functions
    // ============================================================

    /**
     * Export data to JSON file and download.
     * 
     * @param {Object} data - Data to export
     * @param {Object} options - Export options
     * @param {string} options.filename - Custom filename (optional)
     * @param {boolean} options.pretty - Pretty print JSON (default: true)
     * @param {number} options.indent - Indentation spaces (default: 2)
     * @returns {Object} { exported: boolean, filename: string, error: string|null }
     */
    function exportJSON(data, options) {
        options = options || {};

        if (!data || typeof data !== 'object') {
            return {
                exported: false,
                filename: null,
                error: 'Data must be an object'
            };
        }

        var indent = options.indent || 2;
        var pretty = options.pretty !== false;

        try {
            var jsonData = pretty ? JSON.stringify(data, null, indent) : JSON.stringify(data);
            var blob = new Blob([jsonData], { type: 'application/json' });
            var filename = options.filename || 
                'hollow-blades-data-' + new Date().toISOString().slice(0, 10) + '.json';

            fileUtils.downloadBlob(blob, filename);

            return {
                exported: true,
                filename: filename,
                error: null
            };
        } catch (e) {
            return {
                exported: false,
                filename: null,
                error: 'Serialization failed: ' + e.message
            };
        }
    }

    /**
     * Get JSON content as a string without downloading.
     * Useful for testing or preview.
     * 
     * @param {Object} data - Data to serialize
     * @param {Object} options - Serialization options
     * @param {boolean} options.pretty - Pretty print JSON (default: true)
     * @param {number} options.indent - Indentation spaces (default: 2)
     * @returns {Object} { valid: boolean, content: string|null, error: string|null }
     */
    function serializeJSON(data, options) {
        options = options || {};

        if (!data || typeof data !== 'object') {
            return {
                valid: false,
                content: null,
                error: 'Data must be an object'
            };
        }

        var indent = options.indent || 2;
        var pretty = options.pretty !== false;

        try {
            var jsonData = pretty ? JSON.stringify(data, null, indent) : JSON.stringify(data);
            return {
                valid: true,
                content: jsonData,
                error: null
            };
        } catch (e) {
            return {
                valid: false,
                content: null,
                error: 'Serialization failed: ' + e.message
            };
        }
    }

    // ============================================================
    // Import Functions
    // ============================================================

    /**
     * Parse JSON text into an object.
     * 
     * @param {string} text - JSON text to parse
     * @param {Object} options - Parse options
     * @param {boolean} options.requireObject - Require root to be an object (default: true)
     * @param {boolean} options.stripBOM - Strip UTF-8 BOM (default: true)
     * @returns {Object} { valid: boolean, data: Object|null, error: string|null }
     */
    function parseJSON(text, options) {
        options = options || {};
        var requireObject = options.requireObject !== false;
        var stripBOM = options.stripBOM !== false;

        if (typeof text !== 'string') {
            return {
                valid: false,
                data: null,
                error: 'Input must be a string'
            };
        }

        // Strip BOM if present
        var content = stripBOM ? fileUtils.stripBOM(text) : text;

        if (!content || content.trim() === '') {
            return {
                valid: false,
                data: null,
                error: 'JSON is empty'
            };
        }

        try {
            var data = JSON.parse(content);

            if (requireObject && (data === null || typeof data !== 'object' || Array.isArray(data))) {
                return {
                    valid: false,
                    data: null,
                    error: 'JSON root must be an object'
                };
            }

            return {
                valid: true,
                data: data,
                error: null
            };
        } catch (e) {
            return {
                valid: false,
                data: null,
                error: 'Invalid JSON: ' + e.message
            };
        }
    }

    /**
     * Read a JSON file and parse it.
     * 
     * @param {File} file - JSON file to read
     * @param {Object} options - Parse options
     * @returns {Promise<Object>} Promise resolving to { valid, data, error }
     */
    function importJSONFromFile(file, options) {
        options = options || {};

        return fileUtils.readFileAsText(file)
            .then(function(text) {
                var result = parseJSON(text, options);
                return result;
            })
            .catch(function(err) {
                return {
                    valid: false,
                    data: null,
                    error: 'Failed to read file: ' + err.message
                };
            });
    }

    /**
     * Validate that JSON data contains the required structure.
     * This is a basic structural check, not a full schema validation.
     * 
     * @param {Object} data - Parsed JSON data
     * @param {Object} options - Validation options
     * @param {Array} options.requiredKeys - Keys that must exist (optional)
     * @param {Array} options.expectedCollections - Collections that should be arrays (optional)
     * @returns {Object} { valid: boolean, errors: Array, warnings: Array }
     */
    function validateJSONStructure(data, options) {
        options = options || {};

        var errors = [];
        var warnings = [];

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            errors.push('Data must be an object');
            return { valid: false, errors: errors, warnings: warnings };
        }

        // Check required keys
        if (Array.isArray(options.requiredKeys)) {
            options.requiredKeys.forEach(function(key) {
                if (!(key in data)) {
                    errors.push('Missing required key: "' + key + '"');
                }
            });
        }

        // Check expected collections
        if (Array.isArray(options.expectedCollections)) {
            options.expectedCollections.forEach(function(key) {
                if (key in data && !Array.isArray(data[key])) {
                    warnings.push('Expected "' + key + '" to be an array, got ' + typeof data[key]);
                }
            });
        }

        // Basic collection validation
        var collections = ['characters', 'teams', 'tournaments', 'missions', 'classes', 'locations'];
        for (var i = 0; i < collections.length; i++) {
            var key = collections[i];
            if (key in data && data[key] !== null && data[key] !== undefined) {
                if (!Array.isArray(data[key])) {
                    warnings.push('"' + key + '" should be an array, got ' + typeof data[key]);
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors,
            warnings: warnings
        };
    }

    // ============================================================
    // Convenience Functions
    // ============================================================

    /**
     * Check if data has any meaningful application content.
     * This is a basic check, not a full validation.
     * 
     * @param {Object} data - Data to check
     * @returns {boolean} True if data appears to contain application data
     */
    function hasData(data) {
        if (!data || typeof data !== 'object') {
            return false;
        }

        // Check for non-empty collections
        var collections = ['characters', 'teams', 'tournaments', 'missions', 'classes', 'locations'];
        for (var i = 0; i < collections.length; i++) {
            var key = collections[i];
            if (Array.isArray(data[key]) && data[key].length > 0) {
                return true;
            }
        }

        // Check curriculum
        if (data.curriculum && typeof data.curriculum === 'object') {
            var curriculumKeys = ['disciplines', 'schedules', 'grades', 'rankings', 'restDays', 'examDays'];
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

        // Check social
        if (data.social && typeof data.social === 'object' &&
            Array.isArray(data.social.relationships) && data.social.relationships.length > 0) {
            return true;
        }

        return false;
    }

    /**
     * Get a summary of data content.
     * 
     * @param {Object} data - Data to summarize
     * @returns {Object} { collections: Object, total: number }
     */
    function getDataSummary(data) {
        if (!data || typeof data !== 'object') {
            return { collections: {}, total: 0 };
        }

        var collections = {};
        var total = 0;

        var keys = ['characters', 'teams', 'tournaments', 'missions', 'classes', 'locations'];
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var value = data[key];
            if (Array.isArray(value)) {
                collections[key] = value.length;
                total += value.length;
            } else if (value !== null && value !== undefined) {
                collections[key] = 'present';
            }
        }

        // Curriculum
        if (data.curriculum && typeof data.curriculum === 'object') {
            var curriculumKeys = ['disciplines', 'schedules', 'grades', 'rankings'];
            var curriculumSummary = {};
            for (var j = 0; j < curriculumKeys.length; j++) {
                var cKey = curriculumKeys[j];
                var val = data.curriculum[cKey];
                if (Array.isArray(val)) {
                    curriculumSummary[cKey] = val.length;
                    total += val.length;
                } else if (val && typeof val === 'object') {
                    curriculumSummary[cKey] = Object.keys(val).length;
                    total += Object.keys(val).length;
                }
            }
            if (Object.keys(curriculumSummary).length > 0) {
                collections.curriculum = curriculumSummary;
            }
        }

        // Social
        if (data.social && typeof data.social === 'object') {
            var socialCount = 0;
            if (Array.isArray(data.social.relationships)) {
                socialCount += data.social.relationships.length;
            }
            if (data.social.networks && typeof data.social.networks === 'object') {
                socialCount += Object.keys(data.social.networks).length;
            }
            if (socialCount > 0) {
                collections.social = socialCount;
                total += socialCount;
            }
        }

        return { collections: collections, total: total };
    }

    // ============================================================
    // Expose
    // ============================================================

    window.JSONIO = {
        // Export
        exportJSON: exportJSON,
        serializeJSON: serializeJSON,

        // Import
        parseJSON: parseJSON,
        importJSONFromFile: importJSONFromFile,

        // Validation
        validateJSONStructure: validateJSONStructure,
        hasData: hasData,
        getDataSummary: getDataSummary
    };

    // Legacy exports for backward compatibility
    // These will be removed once all consumers are updated
    window.exportJSON = function(data, options) {
        if (!data) {
            data = window.data || {};
        }
        return exportJSON(data, options);
    };

    window.importJSON = function(file, callback) {
        importJSONFromFile(file)
            .then(function(result) {
                if (result.valid && typeof callback === 'function') {
                    callback(result.data);
                } else if (!result.valid) {
                    console.error('JSON import failed:', result.error);
                    if (window.NotificationSystem) {
                        window.NotificationSystem.notifyError('JSON import failed: ' + result.error);
                    }
                }
            });
    };

    // Legacy parse function
    window.parseJSON = function(text) {
        return parseJSON(text);
    };

})();
