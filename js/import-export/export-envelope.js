/**
 * js/import-export/export-envelope.js - Export Envelope
 * Envelope creation, validation, and manipulation for Hollow Manager 2 exports
 * 
 * This module handles the outer envelope of the export format:
 *   - Creating envelopes with proper structure
 *   - Validating envelope integrity
 *   - Extracting metadata
 *   - Converting between envelope and internal formats
 *   - Format version detection and migration coordination
 * 
 * IMPORTANT:
 *   - This module is PURE - no side effects, no mutations
 *   - No persistence, no DOM, no state
 *   - Uses ExportSchema for format constants
 *   - Validates envelope structure, not domain data
 *   - Domain data validation is handled by domain schemas
 *   - Format migration is coordinated but delegated to format-migrations.js
 * 
 * DEPENDENCIES:
 *   - window.ExportSchema (from export-schema.js) - MANDATORY
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 * 
 * USAGE:
 *   var Envelope = window.ExportEnvelope;
 *   
 *   // Create envelope from data
 *   var envelope = Envelope.create(data, { applicationName: 'Hollow Manager 2' });
 *   
 *   // Validate envelope
 *   var result = Envelope.validate(envelope);
 *   if (result.valid) { /* proceed * / }
 *   
 *   // Extract data from envelope
 *   var data = Envelope.extract(envelope);
 *   
 *   // Check if envelope needs migration
 *   var needsMigrate = Envelope.needsMigration(envelope);
 *   if (needsMigrate) {
 *       envelope = Envelope.migrate(envelope);
 *   }
 */

(function() {
    'use strict';

    if (window.__exportEnvelopeLoaded) return;
    window.__exportEnvelopeLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.ExportSchema) {
        throw new Error('[ExportEnvelope] ExportSchema is required.');
    }

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        throw new Error('[ExportEnvelope] ObjectUtils.deepClone is required.');
    }

    var Schema = window.ExportSchema;
    var ObjectUtils = window.ObjectUtils;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var FORMAT_NAME = Schema.FORMAT_NAME;
    var FORMAT_VERSION = Schema.FORMAT_VERSION;
    var MIN_SUPPORTED_VERSION = Schema.MIN_SUPPORTED_VERSION;

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isString(value) {
        return typeof value === 'string';
    }

    function isNumber(value) {
        return typeof value === 'number' && Number.isFinite(value);
    }

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    function getCurrentTimestamp() {
        return new Date().toISOString();
    }

    // ============================================================
    // ENVELOPE CREATION
    // ============================================================

    /**
     * Create an export envelope from application data.
     * 
     * @param {object} data - Application data (canonical domain data)
     * @param {object} options - Options
     * @param {string} options.applicationName - Application name
     * @param {string} options.applicationVersion - Application version
     * @param {number} options.dataVersion - Internal data version
     * @param {string} options.exportedBy - Who exported the data
     * @param {boolean} options.preserveTimestamps - Preserve original timestamps (default: false)
     * @param {object} options.extraMetadata - Additional metadata fields
     * @returns {object} Export envelope
     */
    function create(data, options) {
        options = options || {};

        if (!data || typeof data !== 'object') {
            throw new TypeError('Data must be an object.');
        }

        // Validate data sections
        var validatedData = {};
        var sections = Schema.getSections();

        for (var i = 0; i < sections.length; i++) {
            var section = sections[i];
            if (section in data) {
                validatedData[section] = deepClone(data[section]);
            } else {
                validatedData[section] = Schema.getDefaultSection(section);
            }
        }

        // Application settings
        if (data.currentYear !== undefined) {
            validatedData.currentYear = data.currentYear;
        }
        if (data.currentWeek !== undefined) {
            validatedData.currentWeek = data.currentWeek;
        }

        // Build envelope
        var envelope = {
            format: FORMAT_NAME,
            formatVersion: FORMAT_VERSION,
            exportedAt: getCurrentTimestamp(),
            application: {
                name: options.applicationName || 'Hollow Manager 2',
                version: options.applicationVersion || '2.0.0'
            },
            data: validatedData,
            metadata: {
                dataVersion: options.dataVersion || 0,
                totalCharacters: Array.isArray(validatedData.characters) ? validatedData.characters.length : 0,
                totalTeams: Array.isArray(validatedData.teams) ? validatedData.teams.length : 0,
                totalTournaments: Array.isArray(validatedData.tournaments) ? validatedData.tournaments.length : 0,
                totalMissions: Array.isArray(validatedData.missions) ? validatedData.missions.length : 0,
                exportedBy: options.exportedBy || 'Unknown'
            }
        };

        // Add extra metadata
        if (options.extraMetadata && typeof options.extraMetadata === 'object') {
            for (var key in options.extraMetadata) {
                if (Object.prototype.hasOwnProperty.call(options.extraMetadata, key)) {
                    envelope.metadata[key] = options.extraMetadata[key];
                }
            }
        }

        return envelope;
    }

    /**
     * Create an empty envelope with default structure.
     * Useful for generating templates or starting fresh.
     * 
     * @param {object} options - Options
     * @returns {object} Empty export envelope
     */
    function createEmpty(options) {
        options = options || {};

        var data = {};
        var sections = Schema.getSections();

        for (var i = 0; i < sections.length; i++) {
            data[sections[i]] = Schema.getDefaultSection(sections[i]);
        }

        return create(data, options);
    }

    // ============================================================
    // ENVELOPE VALIDATION
    // ============================================================

    /**
     * Validate an export envelope.
     * Checks structure, format, version, and required sections.
     * 
     * @param {object} envelope - Export envelope to validate
     * @param {object} options - Options
     * @param {boolean} options.strict - Strict validation (default: true)
     * @param {boolean} options.checkRequiredSections - Check required sections (default: true)
     * @returns {object} { valid: boolean, errors: array, warnings: array }
     */
    function validate(envelope, options) {
        options = options || {};
        var strict = options.strict !== false;
        var checkRequired = options.checkRequiredSections !== false;

        var errors = [];
        var warnings = [];

        if (!envelope || typeof envelope !== 'object') {
            errors.push('Envelope must be an object.');
            return { valid: false, errors: errors, warnings: warnings };
        }

        // ---- Check format ----
        if (envelope.format !== FORMAT_NAME) {
            errors.push('Invalid format. Expected "' + FORMAT_NAME + '", got "' + (envelope.format || 'undefined') + '".');
        }

        // ---- Check format version ----
        if (!isNumber(envelope.formatVersion)) {
            errors.push('formatVersion must be a number.');
        } else if (envelope.formatVersion < MIN_SUPPORTED_VERSION) {
            errors.push('Format version ' + envelope.formatVersion + ' is not supported. Minimum supported version is ' + MIN_SUPPORTED_VERSION + '.');
        } else if (envelope.formatVersion > FORMAT_VERSION) {
            warnings.push('Export format version ' + envelope.formatVersion + ' is newer than current version ' + FORMAT_VERSION + '. Some features may not be available.');
        }

        // ---- Check exportedAt ----
        if (envelope.exportedAt !== undefined && !isString(envelope.exportedAt)) {
            errors.push('exportedAt must be a string.');
        } else if (envelope.exportedAt) {
            var date = new Date(envelope.exportedAt);
            if (isNaN(date.getTime())) {
                errors.push('exportedAt must be a valid ISO date string.');
            }
        }

        // ---- Check application metadata ----
        if (envelope.application !== undefined && !isObject(envelope.application)) {
            errors.push('application must be an object.');
        }

        // ---- Check data section ----
        if (!envelope.data || typeof envelope.data !== 'object') {
            errors.push('data section is required and must be an object.');
            return { valid: false, errors: errors, warnings: warnings };
        }

        // ---- Check required sections ----
        if (checkRequired) {
            var requiredSections = Schema.getRequiredSections();
            for (var i = 0; i < requiredSections.length; i++) {
                var section = requiredSections[i];
                if (!(section in envelope.data)) {
                    errors.push('Required section "' + section + '" is missing from data.');
                } else if (envelope.data[section] !== null && !Array.isArray(envelope.data[section]) && typeof envelope.data[section] !== 'object') {
                    errors.push('Section "' + section + '" must be an array or object.');
                }
            }
        }

        // ---- Check optional sections ----
        var optionalSections = Schema.getOptionalSections();
        for (var j = 0; j < optionalSections.length; j++) {
            var optSection = optionalSections[j];
            if (optSection in envelope.data && envelope.data[optSection] !== null && !Array.isArray(envelope.data[optSection]) && typeof envelope.data[optSection] !== 'object') {
                errors.push('Section "' + optSection + '" must be an array or object.');
            }
        }

        // ---- Check metadata ----
        if (envelope.metadata !== undefined && !isObject(envelope.metadata)) {
            errors.push('metadata must be an object.');
        }

        // ---- Check for unknown top-level fields ----
        if (strict) {
            var knownFields = ['format', 'formatVersion', 'exportedAt', 'application', 'data', 'metadata'];
            var envelopeKeys = Object.keys(envelope);
            for (var k = 0; k < envelopeKeys.length; k++) {
                var key = envelopeKeys[k];
                if (knownFields.indexOf(key) === -1) {
                    warnings.push('Unknown top-level field "' + key + '" will be ignored.');
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors,
            warnings: warnings
        };
    }

    /**
     * Quick validation - returns boolean.
     * 
     * @param {object} envelope - Export envelope
     * @returns {boolean} True if valid
     */
    function isValid(envelope) {
        var result = validate(envelope, { strict: false });
        return result.valid;
    }

    /**
     * Validate envelope structure only (no domain validation).
     * This is a lighter validation for quick checks.
     * 
     * @param {object} envelope - Export envelope
     * @returns {object} { valid: boolean, errors: array }
     */
    function validateStructure(envelope) {
        var result = validate(envelope, { 
            strict: true, 
            checkRequiredSections: true 
        });
        return {
            valid: result.valid,
            errors: result.errors
        };
    }

    // ============================================================
    // ENVELOPE EXTRACTION
    // ============================================================

    /**
     * Extract application data from an envelope.
     * Returns a clean data object with only the canonical sections.
     * 
     * @param {object} envelope - Export envelope
     * @param {object} options - Options
     * @param {boolean} options.includeSettings - Include application settings (default: true)
     * @param {boolean} options.defaultMissing - Default missing sections (default: true)
     * @returns {object} Application data object
     */
    function extract(envelope, options) {
        options = options || {};
        var includeSettings = options.includeSettings !== false;
        var defaultMissing = options.defaultMissing !== false;

        if (!envelope || typeof envelope !== 'object' || !envelope.data) {
            return {};
        }

        var data = {};
        var sections = Schema.getSections();

        // Extract canonical sections
        for (var i = 0; i < sections.length; i++) {
            var section = sections[i];
            if (section in envelope.data) {
                data[section] = deepClone(envelope.data[section]);
            } else if (defaultMissing) {
                data[section] = Schema.getDefaultSection(section);
            }
        }

        // Extract application settings
        if (includeSettings) {
            if (envelope.data.currentYear !== undefined) {
                data.currentYear = envelope.data.currentYear;
            }
            if (envelope.data.currentWeek !== undefined) {
                data.currentWeek = envelope.data.currentWeek;
            }
        }

        return data;
    }

    /**
     * Extract metadata from an envelope.
     * 
     * @param {object} envelope - Export envelope
     * @returns {object} Metadata object
     */
    function extractMetadata(envelope) {
        if (!envelope || typeof envelope !== 'object') {
            return {};
        }

        var metadata = {
            format: envelope.format,
            formatVersion: envelope.formatVersion,
            exportedAt: envelope.exportedAt,
            application: envelope.application || {}
        };

        if (envelope.metadata && typeof envelope.metadata === 'object') {
            for (var key in envelope.metadata) {
                if (Object.prototype.hasOwnProperty.call(envelope.metadata, key)) {
                    metadata[key] = envelope.metadata[key];
                }
            }
        }

        return metadata;
    }

    // ============================================================
    // ENVELOPE MIGRATION
    // ============================================================

    /**
     * Check if an envelope needs migration to the current format.
     * 
     * @param {object} envelope - Export envelope
     * @returns {boolean} True if migration is needed
     */
    function needsMigration(envelope) {
        if (!envelope || typeof envelope !== 'object') {
            return false;
        }

        var version = envelope.formatVersion;
        if (!isNumber(version)) {
            return true;
        }

        return version < FORMAT_VERSION && version >= MIN_SUPPORTED_VERSION;
    }

    /**
     * Check if an envelope can be migrated to the current format.
     * 
     * @param {object} envelope - Export envelope
     * @returns {boolean} True if migration is possible
     */
    function canMigrate(envelope) {
        if (!envelope || typeof envelope !== 'object') {
            return false;
        }

        var version = envelope.formatVersion;
        if (!isNumber(version)) {
            return false;
        }

        return version >= MIN_SUPPORTED_VERSION;
    }

    /**
     * Migrate an envelope to the current format.
     * This coordinates migration but delegates actual transformation
     * to format-migrations.js.
     * 
     * @param {object} envelope - Export envelope to migrate
     * @param {object} options - Options
     * @param {boolean} options.inPlace - Modify in place (default: false)
     * @returns {object} Migrated envelope
     */
    function migrate(envelope, options) {
        options = options || {};

        if (!envelope || typeof envelope !== 'object') {
            throw new TypeError('Envelope must be an object.');
        }

        var version = envelope.formatVersion;
        if (!isNumber(version)) {
            throw new Error('Envelope has invalid format version.');
        }

        if (version === FORMAT_VERSION) {
            return options.inPlace ? envelope : deepClone(envelope);
        }

        if (version < MIN_SUPPORTED_VERSION) {
            throw new Error('Envelope version ' + version + ' is too old to migrate. Minimum supported version is ' + MIN_SUPPORTED_VERSION + '.');
        }

        // Create a working copy
        var result = options.inPlace ? envelope : deepClone(envelope);

        // Apply migrations sequentially
        // This is where format-migrations.js would be called
        // For v1, there are no migrations yet

        // Update format version
        result.formatVersion = FORMAT_VERSION;

        // Ensure all required sections exist
        var sections = Schema.getRequiredSections();
        for (var i = 0; i < sections.length; i++) {
            var section = sections[i];
            if (!(section in result.data)) {
                result.data[section] = Schema.getDefaultSection(section);
            }
        }

        return result;
    }

    // ============================================================
    // ENVELOPE COMPARISON
    // ============================================================

    /**
     * Compare two envelopes for structural equality.
     * 
     * @param {object} envelope1 - First envelope
     * @param {object} envelope2 - Second envelope
     * @param {object} options - Options
     * @param {boolean} options.ignoreTimestamps - Ignore exportedAt (default: true)
     * @param {boolean} options.ignoreMetadata - Ignore metadata (default: false)
     * @returns {boolean} True if structurally equal
     */
    function isEqual(envelope1, envelope2, options) {
        options = options || {};
        var ignoreTimestamps = options.ignoreTimestamps !== false;
        var ignoreMetadata = options.ignoreMetadata === true;

        if (!envelope1 || !envelope2) {
            return envelope1 === envelope2;
        }

        if (typeof envelope1 !== 'object' || typeof envelope2 !== 'object') {
            return envelope1 === envelope2;
        }

        // Compare format
        if (envelope1.format !== envelope2.format) {
            return false;
        }

        // Compare format version
        if (envelope1.formatVersion !== envelope2.formatVersion) {
            return false;
        }

        // Compare exportedAt
        if (!ignoreTimestamps && envelope1.exportedAt !== envelope2.exportedAt) {
            return false;
        }

        // Compare application
        if (JSON.stringify(envelope1.application) !== JSON.stringify(envelope2.application)) {
            return false;
        }

        // Compare data
        if (JSON.stringify(envelope1.data) !== JSON.stringify(envelope2.data)) {
            return false;
        }

        // Compare metadata
        if (!ignoreMetadata) {
            if (JSON.stringify(envelope1.metadata) !== JSON.stringify(envelope2.metadata)) {
                return false;
            }
        }

        return true;
    }

    // ============================================================
    // ENVELOPE UTILITIES
    // ============================================================

    /**
     * Get a human-readable description of an envelope.
     * 
     * @param {object} envelope - Export envelope
     * @returns {string} Description
     */
    function describe(envelope) {
        if (!envelope || typeof envelope !== 'object') {
            return 'Invalid envelope';
        }

        var parts = [];
        parts.push('Format: ' + (envelope.format || 'unknown'));

        if (isNumber(envelope.formatVersion)) {
            parts.push('Version: ' + envelope.formatVersion);
        } else {
            parts.push('Version: unknown');
        }

        if (envelope.exportedAt) {
            parts.push('Exported: ' + envelope.exportedAt);
        }

        if (envelope.application && envelope.application.name) {
            parts.push('App: ' + envelope.application.name + ' v' + (envelope.application.version || '?'));
        }

        if (envelope.metadata && isNumber(envelope.metadata.totalCharacters)) {
            parts.push('Characters: ' + envelope.metadata.totalCharacters);
        }

        if (envelope.metadata && isNumber(envelope.metadata.totalTeams)) {
            parts.push('Teams: ' + envelope.metadata.totalTeams);
        }

        if (envelope.metadata && isNumber(envelope.metadata.totalMissions)) {
            parts.push('Missions: ' + envelope.metadata.totalMissions);
        }

        return parts.join(' | ');
    }

    /**
     * Get a compact summary of an envelope for display.
     * 
     * @param {object} envelope - Export envelope
     * @returns {object} Display summary
     */
    function getDisplaySummary(envelope) {
        if (!envelope || typeof envelope !== 'object') {
            return {
                valid: false,
                message: 'Invalid envelope'
            };
        }

        var validation = validate(envelope, { strict: false });

        var summary = {
            valid: validation.valid,
            format: envelope.format,
            formatVersion: envelope.formatVersion,
            exportedAt: envelope.exportedAt,
            application: envelope.application || {},
            sections: {},
            totalRecords: 0,
            errors: validation.errors,
            warnings: validation.warnings
        };

        if (envelope.data) {
            var sections = Schema.getSections();
            for (var i = 0; i < sections.length; i++) {
                var section = sections[i];
                if (section in envelope.data) {
                    var value = envelope.data[section];
                    if (Array.isArray(value)) {
                        summary.sections[section] = value.length;
                        summary.totalRecords += value.length;
                    } else if (value && typeof value === 'object') {
                        summary.sections[section] = Object.keys(value).length;
                        summary.totalRecords += Object.keys(value).length;
                    } else {
                        summary.sections[section] = 'present';
                    }
                } else {
                    summary.sections[section] = 'missing';
                }
            }
        }

        return summary;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ExportEnvelope = {
        // ---- Creation ----
        create: create,
        createEmpty: createEmpty,

        // ---- Validation ----
        validate: validate,
        isValid: isValid,
        validateStructure: validateStructure,

        // ---- Extraction ----
        extract: extract,
        extractMetadata: extractMetadata,

        // ---- Migration ----
        needsMigration: needsMigration,
        canMigrate: canMigrate,
        migrate: migrate,

        // ---- Comparison ----
        isEqual: isEqual,

        // ---- Utilities ----
        describe: describe,
        getDisplaySummary: getDisplaySummary
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.ExportEnvelope;
        var missing = [];

        var required = [
            'create', 'createEmpty',
            'validate', 'isValid', 'validateStructure',
            'extract', 'extractMetadata',
            'needsMigration', 'canMigrate', 'migrate',
            'isEqual',
            'describe', 'getDisplaySummary'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[ExportEnvelope] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[ExportEnvelope] All exports verified successfully.');
            console.log('[ExportEnvelope] Current format version:', window.ExportSchema.FORMAT_VERSION);
        }
    })();

})();
