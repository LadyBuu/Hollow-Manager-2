/**
 * js/import-export/json-io.js - JSON Import/Export
 * Envelope-aware JSON serialization and file I/O
 * 
 * This module handles JSON serialization, deserialization, and file operations
 * for the import/export subsystem. It is ENVELOPE-AWARE and uses ExportEnvelope
 * and ExportSchema for structural validation when processing envelope-formatted
 * files, while still supporting raw data for backward compatibility.
 * 
 * IMPORTANT:
 *   - This is a BOUNDARY module - translation between file and memory
 *   - Does NOT mutate application state
 *   - Does NOT call saveData()
 *   - Does NOT show alerts or confirmations
 *   - Does NOT log activity
 *   - Does NOT render UI
 *   - Does NOT apply migrations (that's ImportPipeline's job)
 * 
 * RESPONSIBILITIES:
 *   - Serialize data to JSON (with or without envelope)
 *   - Parse JSON text into objects
 *   - Detect envelope vs raw data
 *   - Validate envelope structure if envelope detected
 *   - Read files as text
 *   - Provide data summaries for UI display
 * 
 * DOES NOT:
 *   - Handle domain schema validation (that's CrossDomainValidator)
 *   - Apply format migrations (that's FormatMigrations)
 *   - Commit to persistence (that's ImportPipeline + MutationPipeline)
 * 
 * DEPENDENCIES:
 *   - window.ExportUtils (for file download and read) - MANDATORY
 *   - window.ExportEnvelope (for envelope creation/validation) - OPTIONAL
 *     If not present, envelope features degrade to raw JSON handling
 * 
 * USAGE:
 *   var JSONIO = window.JSONIO;
 *   
 *   // Export with envelope (preferred)
 *   var result = JSONIO.exportJSON(window.data, { envelope: true });
 *   
 *   // Export raw (legacy)
 *   var result = JSONIO.exportJSON(window.data, { envelope: false });
 *   
 *   // Parse JSON text
 *   var result = JSONIO.parseJSON(text);
 *   // result.data could be an envelope or raw data
 *   
 *   // Read file and parse
 *   var result = await JSONIO.importJSONFromFile(file);
 *   
 *   // Check if data has meaningful content
 *   if (JSONIO.hasData(result.data)) { ... }
 */

(function() {
    'use strict';

    if (window.__jsonIOLoaded) return;
    window.__jsonIOLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    if (!window.ExportUtils || typeof window.ExportUtils.downloadBlob !== 'function') {
        throw new Error('[JSONIO] ExportUtils is required.');
    }

    var ExportUtils = window.ExportUtils;

    // ExportEnvelope is optional - if not loaded, we degrade gracefully
    function getEnvelope() {
        return window.ExportEnvelope || null;
    }

    function getSchema() {
        return window.ExportSchema || null;
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var DEFAULT_FILENAME_PREFIX = 'hollow-blades-data';
    var DEFAULT_ENVELOPE = true;
    var DEFAULT_PRETTY = true;
    var DEFAULT_INDENT = 2;

    // ============================================================
    // ENVELOPE DETECTION
    // ============================================================

    /**
     * Check if a data object appears to be an envelope.
     * 
     * An envelope has:
     *   - format: "hollow-blades"
     *   - formatVersion: number
     *   - data: object
     * 
     * @param {*} data - Data to check
     * @returns {boolean} True if data looks like an envelope
     */
    function isEnvelope(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return false;
        }

        var schema = getSchema();
        if (!schema) {
            // Without schema, we can't reliably detect an envelope
            return false;
        }

        return data.format === schema.FORMAT_NAME &&
               typeof data.formatVersion === 'number' &&
               data.data !== undefined &&
               typeof data.data === 'object';
    }

    /**
     * Check if data appears to be raw application data (not an envelope).
     * 
     * Raw data has at least one known section (characters, teams, etc.)
     * but does NOT have the envelope format marker.
     * 
     * @param {*} data - Data to check
     * @returns {boolean} True if data looks like raw application data
     */
    function isRawData(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return false;
        }

        if (isEnvelope(data)) {
            return false;
        }

        // Check for at least one known section
        var knownSections = ['characters', 'teams', 'tournaments', 'missions', 'curriculum', 'social'];
        for (var i = 0; i < knownSections.length; i++) {
            if (knownSections[i] in data) {
                return true;
            }
        }

        return false;
    }

    // ============================================================
    // SERIALIZATION
    // ============================================================

    /**
     * Serialize data to a JSON string.
     * 
     * If `options.envelope` is true (default) and ExportEnvelope is available,
     * the data is wrapped in an envelope before serialization. Otherwise,
     * the data is serialized as-is.
     * 
     * @param {object} data - Data to serialize
     * @param {object} options - Serialization options
     * @param {boolean} options.envelope - Wrap in envelope (default: true)
     * @param {boolean} options.pretty - Pretty print JSON (default: true)
     * @param {number} options.indent - Indentation spaces (default: 2)
     * @param {string} options.applicationName - Application name for envelope
     * @param {string} options.applicationVersion - Application version for envelope
     * @param {number} options.dataVersion - Data version for envelope metadata
     * @param {string} options.exportedBy - Exporter name for envelope metadata
     * @returns {object} { valid: boolean, content: string|null, error: string|null, wasEnveloped: boolean }
     */
    function serializeJSON(data, options) {
        options = options || {};

        if (!data || typeof data !== 'object') {
            return {
                valid: false,
                content: null,
                error: 'Data must be an object',
                wasEnveloped: false
            };
        }

        var useEnvelope = options.envelope !== false;
        var pretty = options.pretty !== false;
        var indent = options.indent || DEFAULT_INDENT;

        var payload = data;
        var wasEnveloped = false;

        // Wrap in envelope if requested and available
        if (useEnvelope && !isEnvelope(data)) {
            var Envelope = getEnvelope();
            if (Envelope && typeof Envelope.create === 'function') {
                try {
                    payload = Envelope.create(data, {
                        applicationName: options.applicationName,
                        applicationVersion: options.applicationVersion,
                        dataVersion: options.dataVersion || data._dataVersion || 0,
                        exportedBy: options.exportedBy
                    });
                    wasEnveloped = true;
                } catch (e) {
                    return {
                        valid: false,
                        content: null,
                        error: 'Failed to create envelope: ' + e.message,
                        wasEnveloped: false
                    };
                }
            } else {
                // No envelope available - serialize raw
                wasEnveloped = false;
            }
        } else if (isEnvelope(data)) {
            // Already an envelope - serialize as-is
            wasEnveloped = true;
        }

        // Serialize
        try {
            var jsonString = pretty
                ? JSON.stringify(payload, null, indent)
                : JSON.stringify(payload);

            return {
                valid: true,
                content: jsonString,
                error: null,
                wasEnveloped: wasEnveloped
            };
        } catch (e) {
            return {
                valid: false,
                content: null,
                error: 'Serialization failed: ' + e.message,
                wasEnveloped: false
            };
        }
    }

    /**
     * Export data to a JSON file and trigger download.
     * 
     * @param {object} data - Data to export (defaults to window.data)
     * @param {object} options - Export options (same as serializeJSON, plus filename)
     * @param {string} options.filename - Custom filename
     * @returns {object} { exported: boolean, filename: string|null, error: string|null, wasEnveloped: boolean }
     */
    function exportJSON(data, options) {
        options = options || {};

        // Default to window.data if not provided
        if (!data) {
            data = window.data || {};
        }

        if (!data || typeof data !== 'object') {
            return {
                exported: false,
                filename: null,
                error: 'Data must be an object',
                wasEnveloped: false
            };
        }

        // Serialize
        var serializationResult = serializeJSON(data, options);
        if (!serializationResult.valid) {
            return {
                exported: false,
                filename: null,
                error: serializationResult.error,
                wasEnveloped: false
            };
        }

        // Create blob and download
        try {
            var blob = new Blob([serializationResult.content], {
                type: 'application/json'
            });

            var filename = options.filename ||
                DEFAULT_FILENAME_PREFIX + '-' + new Date().toISOString().slice(0, 10) + '.json';

            ExportUtils.downloadBlob(blob, filename);

            return {
                exported: true,
                filename: filename,
                error: null,
                wasEnveloped: serializationResult.wasEnveloped
            };
        } catch (e) {
            return {
                exported: false,
                filename: null,
                error: 'Download failed: ' + e.message,
                wasEnveloped: false
            };
        }
    }

    // ============================================================
    // PARSING
    // ============================================================

    /**
     * Parse JSON text into an object.
     * 
     * Detects envelope vs raw data and validates envelope structure
     * if ExportEnvelope is available.
     * 
     * @param {string} text - JSON text to parse
     * @param {object} options - Parse options
     * @param {boolean} options.requireObject - Require root to be an object (default: true)
     * @param {boolean} options.stripBOM - Strip UTF-8 BOM (default: true)
     * @param {boolean} options.validateEnvelope - Validate envelope structure if detected (default: true)
     * @returns {object} {
     *   valid: boolean,
     *   data: object|null,
     *   error: string|null,
     *   isEnvelope: boolean,
     *   validation: object|null
     * }
     */
    function parseJSON(text, options) {
        options = options || {};
        var requireObject = options.requireObject !== false;
        var stripBOM = options.stripBOM !== false;
        var validateEnvelope = options.validateEnvelope !== false;

        if (typeof text !== 'string') {
            return {
                valid: false,
                data: null,
                error: 'Input must be a string',
                isEnvelope: false,
                validation: null
            };
        }

        // Strip BOM if present
        var content = stripBOM ? ExportUtils.stripBOM(text) : text;

        if (!content || content.trim() === '') {
            return {
                valid: false,
                data: null,
                error: 'JSON is empty',
                isEnvelope: false,
                validation: null
            };
        }

        // Parse
        var data;
        try {
            data = JSON.parse(content);
        } catch (e) {
            return {
                valid: false,
                data: null,
                error: 'Invalid JSON: ' + e.message,
                isEnvelope: false,
                validation: null
            };
        }

        // Check root type
        if (requireObject && (data === null || typeof data !== 'object' || Array.isArray(data))) {
            return {
                valid: false,
                data: null,
                error: 'JSON root must be an object',
                isEnvelope: false,
                validation: null
            };
        }

        // Detect envelope
        var envelope = isEnvelope(data);

        // Validate envelope structure if detected
        var envelopeValidation = null;
        if (envelope && validateEnvelope) {
            var Envelope = getEnvelope();
            if (Envelope && typeof Envelope.validate === 'function') {
                envelopeValidation = Envelope.validate(data);

                if (!envelopeValidation.valid) {
                    return {
                        valid: false,
                        data: data,
                        error: 'Invalid envelope: ' + envelopeValidation.errors.join('; '),
                        isEnvelope: true,
                        validation: envelopeValidation
                    };
                }
            }
        }

        return {
            valid: true,
            data: data,
            error: null,
            isEnvelope: envelope,
            validation: envelopeValidation
        };
    }

    /**
     * Read a JSON file and parse it.
     * 
     * @param {File} file - JSON file to read
     * @param {object} options - Parse options
     * @returns {Promise<object>} Promise resolving to parse result with file info
     */
    function importJSONFromFile(file, options) {
        options = options || {};

        if (!file) {
            return Promise.resolve({
                valid: false,
                data: null,
                error: 'No file provided',
                isEnvelope: false,
                validation: null,
                file: null
            });
        }

        return ExportUtils.readFileAsText(file)
            .then(function(text) {
                var result = parseJSON(text, options);

                // Attach file info
                result.file = {
                    name: file.name,
                    size: file.size,
                    type: file.type || 'application/json'
                };

                return result;
            })
            .catch(function(err) {
                return {
                    valid: false,
                    data: null,
                    error: 'Failed to read file: ' + err.message,
                    isEnvelope: false,
                    validation: null,
                    file: {
                        name: file.name,
                        size: file.size
                    }
                };
            });
    }

    // ============================================================
    // DATA INSPECTION
    // ============================================================

    /**
     * Check if data has any meaningful application content.
     * Works on both envelope and raw data.
     * 
     * @param {object} data - Data to check
     * @returns {boolean} True if data appears to contain application data
     */
    function hasData(data) {
        if (!data || typeof data !== 'object') {
            return false;
        }

        // If envelope, check inner data
        if (isEnvelope(data)) {
            return hasData(data.data);
        }

        // Check collections
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
        if (data.social && typeof data.social === 'object') {
            if (Array.isArray(data.social.relationships) && data.social.relationships.length > 0) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get a summary of data content.
     * Works on both envelope and raw data.
     * 
     * @param {object} data - Data to summarize
     * @returns {object} { collections: Object, total: number, isEnvelope: boolean }
     */
    function getDataSummary(data) {
        if (!data || typeof data !== 'object') {
            return { collections: {}, total: 0, isEnvelope: false };
        }

        // Unwrap envelope if present
        var wasEnvelope = isEnvelope(data);
        var innerData = wasEnvelope ? data.data : data;

        if (!innerData || typeof innerData !== 'object') {
            return { collections: {}, total: 0, isEnvelope: wasEnvelope };
        }

        var collections = {};
        var total = 0;

        var keys = ['characters', 'teams', 'tournaments', 'missions', 'classes', 'locations'];
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var value = innerData[key];
            if (Array.isArray(value)) {
                collections[key] = value.length;
                total += value.length;
            } else if (value !== null && value !== undefined) {
                collections[key] = 'present';
            }
        }

        // Curriculum
        if (innerData.curriculum && typeof innerData.curriculum === 'object') {
            var curriculumKeys = ['disciplines', 'schedules', 'grades', 'rankings'];
            var curriculumSummary = {};
            for (var j = 0; j < curriculumKeys.length; j++) {
                var cKey = curriculumKeys[j];
                var val = innerData.curriculum[cKey];
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
        if (innerData.social && typeof innerData.social === 'object') {
            var socialCount = 0;
            if (Array.isArray(innerData.social.relationships)) {
                socialCount += innerData.social.relationships.length;
            }
            if (innerData.social.networks && typeof innerData.social.networks === 'object') {
                socialCount += Object.keys(innerData.social.networks).length;
            }
            if (socialCount > 0) {
                collections.social = socialCount;
                total += socialCount;
            }
        }

        return {
            collections: collections,
            total: total,
            isEnvelope: wasEnvelope,
            formatVersion: wasEnvelope ? data.formatVersion : null,
            exportedAt: wasEnvelope ? data.exportedAt : null
        };
    }

    /**
     * Get a display-friendly summary string.
     * 
     * @param {object} data - Data to summarize
     * @returns {string} Human-readable summary
     */
    function getSummaryString(data) {
        var summary = getDataSummary(data);
        var parts = [];

        if (summary.isEnvelope) {
            parts.push('Envelope v' + summary.formatVersion);
            if (summary.exportedAt) {
                parts.push('exported ' + summary.exportedAt);
            }
        } else {
            parts.push('Raw data');
        }

        parts.push(summary.total + ' records');

        var collectionParts = [];
        for (var key in summary.collections) {
            if (summary.collections.hasOwnProperty(key)) {
                var val = summary.collections[key];
                if (typeof val === 'number') {
                    collectionParts.push(key + ': ' + val);
                } else if (typeof val === 'object') {
                    var subParts = [];
                    for (var subKey in val) {
                        if (val.hasOwnProperty(subKey)) {
                            subParts.push(subKey + ': ' + val[subKey]);
                        }
                    }
                    collectionParts.push(key + ' { ' + subParts.join(', ') + ' }');
                }
            }
        }
        if (collectionParts.length > 0) {
            parts.push('(' + collectionParts.join(', ') + ')');
        }

        return parts.join(' ');
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    /**
     * Validate that JSON data contains the required structure.
     * Basic structural check, not full domain validation.
     * 
     * @param {object} data - Parsed JSON data
     * @param {object} options - Validation options
     * @param {Array} options.requiredKeys - Keys that must exist
     * @param {Array} options.expectedCollections - Collections that should be arrays
     * @returns {object} { valid: boolean, errors: Array, warnings: Array }
     */
    function validateJSONStructure(data, options) {
        options = options || {};

        var errors = [];
        var warnings = [];

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            errors.push('Data must be an object');
            return { valid: false, errors: errors, warnings: warnings };
        }

        // Unwrap envelope for validation
        var innerData = isEnvelope(data) ? data.data : data;

        if (!innerData || typeof innerData !== 'object') {
            errors.push('Envelope data section is invalid');
            return { valid: false, errors: errors, warnings: warnings };
        }

        // Check required keys
        if (Array.isArray(options.requiredKeys)) {
            for (var i = 0; i < options.requiredKeys.length; i++) {
                if (!(options.requiredKeys[i] in innerData)) {
                    errors.push('Missing required key: "' + options.requiredKeys[i] + '"');
                }
            }
        }

        // Check expected collections
        if (Array.isArray(options.expectedCollections)) {
            for (var j = 0; j < options.expectedCollections.length; j++) {
                var key = options.expectedCollections[j];
                if (key in innerData && !Array.isArray(innerData[key])) {
                    warnings.push('Expected "' + key + '" to be an array, got ' + typeof innerData[key]);
                }
            }
        }

        // Basic collection validation
        var collections = ['characters', 'teams', 'tournaments', 'missions', 'classes', 'locations'];
        for (var k = 0; k < collections.length; k++) {
            var cKey = collections[k];
            if (cKey in innerData && innerData[cKey] !== null && innerData[cKey] !== undefined) {
                if (!Array.isArray(innerData[cKey])) {
                    warnings.push('"' + cKey + '" should be an array, got ' + typeof innerData[cKey]);
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
    // EXPOSE
    // ============================================================

    window.JSONIO = {
        // ---- Export ----
        exportJSON: exportJSON,
        serializeJSON: serializeJSON,

        // ---- Import ----
        parseJSON: parseJSON,
        importJSONFromFile: importJSONFromFile,

        // ---- Detection ----
        isEnvelope: isEnvelope,
        isRawData: isRawData,

        // ---- Inspection ----
        hasData: hasData,
        getDataSummary: getDataSummary,
        getSummaryString: getSummaryString,

        // ---- Validation ----
        validateJSONStructure: validateJSONStructure
    };

    // ============================================================
    // LEGACY COMPATIBILITY
    // ============================================================

    /**
     * Legacy global function for backward compatibility.
     * @deprecated Use JSONIO.exportJSON() instead.
     */
    window.exportJSON = function(data, options) {
        return exportJSON(data, options);
    };

    /**
     * Legacy global function for backward compatibility.
     * @deprecated Use JSONIO.importJSONFromFile() instead.
     */
    window.importJSON = function(file, callback) {
        importJSONFromFile(file)
            .then(function(result) {
                if (result.valid && typeof callback === 'function') {
                    callback(result.data);
                } else if (!result.valid) {
                    console.error('[JSONIO] Import failed:', result.error);
                    if (window.NotificationSystem && typeof window.NotificationSystem.notifyError === 'function') {
                        window.NotificationSystem.notifyError('JSON import failed: ' + result.error);
                    }
                }
            });
    };

    /**
     * Legacy global function for backward compatibility.
     * @deprecated Use JSONIO.parseJSON() instead.
     */
    window.parseJSON = function(text) {
        return parseJSON(text);
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.JSONIO;
        var missing = [];

        var required = [
            'exportJSON', 'serializeJSON',
            'parseJSON', 'importJSONFromFile',
            'isEnvelope', 'isRawData',
            'hasData', 'getDataSummary',
            'validateJSONStructure'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[JSONIO] Verification - some exports may be missing:', missing.join(', '));
        } else {
            var envelopeStatus = getEnvelope() ? 'available' : 'NOT available (envelope features degraded)';
            console.log('[JSONIO] All exports verified successfully.');
            console.log('[JSONIO] ExportEnvelope:', envelopeStatus);
        }
    })();

})();
