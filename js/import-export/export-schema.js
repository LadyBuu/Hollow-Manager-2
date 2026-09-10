/**
 * js/import-export/export-schema.js - Export Schema
 * Canonical export format definition for Hollow Manager 2
 * 
 * This module defines the portable export contract for the application.
 * It is INDEPENDENT of internal data structures and migrations.
 * 
 * IMPORTANT:
 *   - This is the PUBLIC FILE CONTRACT - changes require version bump
 *   - Does NOT duplicate domain schemas - uses adapters for translation
 *   - Format version is independent from DATA_VERSION and DB_VERSION
 *   - All sections are canonical domain data (no UI state, no derived debris)
 *   - Cross-domain references are validated against candidate state
 * 
 * VERSION INDEPENDENCE:
 *   - DB_VERSION: IndexedDB structure (database.js)
 *   - DATA_VERSION: Internal application migrations (database.js)
 *   - EXPORT_FORMAT_VERSION: Public file contract (this module)
 * 
 * EXPORT FORMAT EVOLUTION:
 *   - v1: Initial export format
 *   - Future versions: Add sections, change structure with migration
 * 
 * EXPORT ENVELOPE:
 *   {
 *     format: "hollow-blades",
 *     formatVersion: 1,
 *     exportedAt: "2026-09-09T12:00:00Z",
 *     application: { name, version },
 *     data: { ... canonical domain data ... },
 *     metadata: { ... export metadata ... }
 *   }
 * 
 * DEPENDENCIES:
 *   - None (pure constants and validation)
 * 
 * USAGE:
 *   var Schema = window.ExportSchema;
 *   var envelope = Schema.createEnvelope(data);
 *   var valid = Schema.validateEnvelope(envelope);
 *   var migrated = Schema.migrateEnvelope(envelope, 1);
 */

(function() {
    'use strict';

    if (window.__exportSchemaLoaded) return;
    window.__exportSchemaLoaded = true;

    // ============================================================
    // EXPORT FORMAT VERSION
    // ============================================================

    /**
     * Current export format version.
     * Increment when the export format changes in a breaking way.
     * Independent of DATA_VERSION and DB_VERSION.
     */
    var EXPORT_FORMAT_VERSION = 1;

    /**
     * Minimum supported export format version for import.
     * Files older than this will be rejected with a clear message.
     */
    var MIN_SUPPORTED_VERSION = 1;

    /**
     * Format name - identifies Hollow Manager 2 export files.
     */
    var FORMAT_NAME = 'hollow-blades';

    // ============================================================
    // SECTION DEFINITIONS
    // ============================================================

    /**
     * Canonical export sections.
     * These are the top-level sections in the export envelope's data object.
     * Each section corresponds to a domain in the application.
     */
    var SECTIONS = {
        CHARACTERS: 'characters',
        TEAMS: 'teams',
        TOURNAMENTS: 'tournaments',
        MISSIONS: 'missions',
        CURRICULUM: 'curriculum',
        SOCIAL: 'social',
        ACADEMY: 'academy',
        CLASSES: 'classes',
        LOCATIONS: 'locations',
        LOCATION_SCHEDULES: 'locationSchedules',
        STATS_CONFIG: 'statsConfig'
    };

    /**
     * Application settings that are persisted.
     * These are top-level fields in the data object.
     */
    var APPLICATION_SETTINGS = {
        CURRENT_YEAR: 'currentYear',
        CURRENT_WEEK: 'currentWeek'
    };

    /**
     * Metadata fields included in the export envelope.
     */
    var METADATA_FIELDS = {
        DATA_VERSION: 'dataVersion',
        TOTAL_CHARACTERS: 'totalCharacters',
        TOTAL_TEAMS: 'totalTeams',
        TOTAL_TOURNAMENTS: 'totalTournaments',
        TOTAL_MISSIONS: 'totalMissions',
        EXPORTED_BY: 'exportedBy'
    };

    // ============================================================
    // REQUIRED SECTIONS
    // ============================================================

    /**
     * Sections that must be present in a valid export.
     * Missing required sections will cause validation to fail.
     */
    var REQUIRED_SECTIONS = [
        SECTIONS.CHARACTERS,
        SECTIONS.TEAMS,
        SECTIONS.TOURNAMENTS,
        SECTIONS.MISSIONS
    ];

    /**
     * Optional sections that may be present.
     * Missing optional sections are fine (they'll be defaulted).
     */
    var OPTIONAL_SECTIONS = [
        SECTIONS.CURRICULUM,
        SECTIONS.SOCIAL,
        SECTIONS.ACADEMY,
        SECTIONS.CLASSES,
        SECTIONS.LOCATIONS,
        SECTIONS.LOCATION_SCHEDULES,
        SECTIONS.STATS_CONFIG
    ];

    /**
     * All valid section names.
     */
    var ALL_SECTIONS = REQUIRED_SECTIONS.concat(OPTIONAL_SECTIONS);

    // ============================================================
    // EXPORT ENVELOPE STRUCTURE
    // ============================================================

    /**
     * Get the current export format version.
     * 
     * @returns {number} Current version
     */
    function getFormatVersion() {
        return EXPORT_FORMAT_VERSION;
    }

    /**
     * Get the minimum supported version.
     * 
     * @returns {number} Minimum supported version
     */
    function getMinSupportedVersion() {
        return MIN_SUPPORTED_VERSION;
    }

    /**
     * Get the format name.
     * 
     * @returns {string} Format name
     */
    function getFormatName() {
        return FORMAT_NAME;
    }

    /**
     * Get all valid section names.
     * 
     * @returns {Array} Array of section names
     */
    function getSections() {
        return ALL_SECTIONS.slice();
    }

    /**
     * Get required section names.
     * 
     * @returns {Array} Array of required section names
     */
    function getRequiredSections() {
        return REQUIRED_SECTIONS.slice();
    }

    /**
     * Get optional section names.
     * 
     * @returns {Array} Array of optional section names
     */
    function getOptionalSections() {
        return OPTIONAL_SECTIONS.slice();
    }

    /**
     * Check if a section is valid.
     * 
     * @param {string} section - Section name
     * @returns {boolean} True if valid
     */
    function isValidSection(section) {
        return ALL_SECTIONS.indexOf(section) !== -1;
    }

    /**
     * Check if a section is required.
     * 
     * @param {string} section - Section name
     * @returns {boolean} True if required
     */
    function isRequiredSection(section) {
        return REQUIRED_SECTIONS.indexOf(section) !== -1;
    }

    /**
     * Check if a section is optional.
     * 
     * @param {string} section - Section name
     * @returns {boolean} True if optional
     */
    function isOptionalSection(section) {
        return OPTIONAL_SECTIONS.indexOf(section) !== -1;
    }

    // ============================================================
    // ENVELOPE VALIDATION
    // ============================================================

    /**
     * Validate an export envelope.
     * Checks structure, format, version, and required sections.
     * Does NOT validate domain data - that's the domain schemas' job.
     * 
     * @param {object} envelope - Export envelope to validate
     * @returns {object} { valid: boolean, errors: array, warnings: array }
     */
    function validateEnvelope(envelope) {
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
        if (typeof envelope.formatVersion !== 'number') {
            errors.push('formatVersion must be a number.');
        } else if (envelope.formatVersion < MIN_SUPPORTED_VERSION) {
            errors.push('Format version ' + envelope.formatVersion + ' is not supported. Minimum supported version is ' + MIN_SUPPORTED_VERSION + '.');
        } else if (envelope.formatVersion > EXPORT_FORMAT_VERSION) {
            warnings.push('Export format version ' + envelope.formatVersion + ' is newer than current version ' + EXPORT_FORMAT_VERSION + '. Some features may not be available.');
        }

        // ---- Check exportedAt ----
        if (envelope.exportedAt && typeof envelope.exportedAt !== 'string') {
            errors.push('exportedAt must be a string.');
        } else if (envelope.exportedAt) {
            var date = new Date(envelope.exportedAt);
            if (isNaN(date.getTime())) {
                errors.push('exportedAt must be a valid ISO date string.');
            }
        }

        // ---- Check application metadata ----
        if (envelope.application && typeof envelope.application !== 'object') {
            errors.push('application must be an object.');
        }

        // ---- Check data section ----
        if (!envelope.data || typeof envelope.data !== 'object') {
            errors.push('data section is required and must be an object.');
            return { valid: false, errors: errors, warnings: warnings };
        }

        // ---- Check required sections ----
        for (var i = 0; i < REQUIRED_SECTIONS.length; i++) {
            var section = REQUIRED_SECTIONS[i];
            if (!(section in envelope.data)) {
                errors.push('Required section "' + section + '" is missing from data.');
            } else if (envelope.data[section] !== null && !Array.isArray(envelope.data[section]) && typeof envelope.data[section] !== 'object') {
                errors.push('Section "' + section + '" must be an array or object.');
            }
        }

        // ---- Check optional sections ----
        for (var j = 0; j < OPTIONAL_SECTIONS.length; j++) {
            var optSection = OPTIONAL_SECTIONS[j];
            if (optSection in envelope.data && envelope.data[optSection] !== null && !Array.isArray(envelope.data[optSection]) && typeof envelope.data[optSection] !== 'object') {
                errors.push('Section "' + optSection + '" must be an array or object.');
            }
        }

        // ---- Check metadata ----
        if (envelope.metadata && typeof envelope.metadata !== 'object') {
            errors.push('metadata must be an object.');
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
    function isValidEnvelope(envelope) {
        var result = validateEnvelope(envelope);
        return result.valid;
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
     * @param {object} options.extraMetadata - Additional metadata fields
     * @returns {object} Export envelope
     */
    function createEnvelope(data, options) {
        options = options || {};

        if (!data || typeof data !== 'object') {
            throw new TypeError('Data must be an object.');
        }

        // ---- Validate sections ----
        var validatedData = {};
        var sectionKeys = Object.keys(data);

        for (var i = 0; i < sectionKeys.length; i++) {
            var key = sectionKeys[i];
            if (isValidSection(key) || key === APPLICATION_SETTINGS.CURRENT_YEAR || key === APPLICATION_SETTINGS.CURRENT_WEEK) {
                validatedData[key] = data[key];
            }
            // Silently ignore unknown sections
        }

        // Ensure required sections exist
        for (var j = 0; j < REQUIRED_SECTIONS.length; j++) {
            var section = REQUIRED_SECTIONS[j];
            if (!(section in validatedData)) {
                validatedData[section] = [];
            }
        }

        // ---- Build envelope ----
        var envelope = {
            format: FORMAT_NAME,
            formatVersion: EXPORT_FORMAT_VERSION,
            exportedAt: new Date().toISOString(),
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

    // ============================================================
    // SECTION HELPERS
    // ============================================================

    /**
     * Get default data structure for a section.
     * 
     * @param {string} section - Section name
     * @returns {*} Default value (empty array or empty object)
     */
    function getDefaultSection(section) {
        if (section === SECTIONS.CURRICULUM ||
            section === SECTIONS.SOCIAL ||
            section === SECTIONS.ACADEMY ||
            section === SECTIONS.LOCATION_SCHEDULES ||
            section === SECTIONS.STATS_CONFIG) {
            return {};
        }
        return [];
    }

    /**
     * Ensure a section exists with default value.
     * 
     * @param {object} data - Data object
     * @param {string} section - Section name
     * @returns {object} Data object with section ensured
     */
    function ensureSection(data, section) {
        if (!data || typeof data !== 'object') {
            return data;
        }
        if (!(section in data)) {
            data[section] = getDefaultSection(section);
        }
        return data;
    }

    /**
     * Ensure all sections exist with default values.
     * 
     * @param {object} data - Data object
     * @returns {object} Data object with all sections ensured
     */
    function ensureAllSections(data) {
        if (!data || typeof data !== 'object') {
            return data;
        }

        for (var i = 0; i < ALL_SECTIONS.length; i++) {
            ensureSection(data, ALL_SECTIONS[i]);
        }

        return data;
    }

    // ============================================================
    // EXPORT SUMMARY
    // ============================================================

    /**
     * Get a summary of the data in an envelope.
     * 
     * @param {object} envelope - Export envelope
     * @returns {object} Summary information
     */
    function getExportSummary(envelope) {
        if (!envelope || typeof envelope !== 'object' || !envelope.data) {
            return {
                valid: false,
                message: 'Invalid envelope'
            };
        }

        var data = envelope.data;
        var summary = {
            valid: true,
            format: envelope.format,
            formatVersion: envelope.formatVersion,
            exportedAt: envelope.exportedAt,
            sections: {},
            totalRecords: 0
        };

        for (var i = 0; i < ALL_SECTIONS.length; i++) {
            var section = ALL_SECTIONS[i];
            if (section in data) {
                var value = data[section];
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

        // Application settings
        if (data.currentYear !== undefined) {
            summary.currentYear = data.currentYear;
        }
        if (data.currentWeek !== undefined) {
            summary.currentWeek = data.currentWeek;
        }

        // Metadata
        if (envelope.metadata) {
            summary.metadata = envelope.metadata;
        }

        return summary;
    }

    // ============================================================
    // CONSTANTS (read-only)
    // ============================================================

    var EXPORT_SECTIONS = Object.freeze({
        CHARACTERS: SECTIONS.CHARACTERS,
        TEAMS: SECTIONS.TEAMS,
        TOURNAMENTS: SECTIONS.TOURNAMENTS,
        MISSIONS: SECTIONS.MISSIONS,
        CURRICULUM: SECTIONS.CURRICULUM,
        SOCIAL: SECTIONS.SOCIAL,
        ACADEMY: SECTIONS.ACADEMY,
        CLASSES: SECTIONS.CLASSES,
        LOCATIONS: SECTIONS.LOCATIONS,
        LOCATION_SCHEDULES: SECTIONS.LOCATION_SCHEDULES,
        STATS_CONFIG: SECTIONS.STATS_CONFIG
    });

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ExportSchema = {
        // ---- Version ----
        getFormatVersion: getFormatVersion,
        getMinSupportedVersion: getMinSupportedVersion,
        getFormatName: getFormatName,
        FORMAT_VERSION: EXPORT_FORMAT_VERSION,
        MIN_SUPPORTED_VERSION: MIN_SUPPORTED_VERSION,
        FORMAT_NAME: FORMAT_NAME,

        // ---- Sections ----
        SECTIONS: EXPORT_SECTIONS,
        getSections: getSections,
        getRequiredSections: getRequiredSections,
        getOptionalSections: getOptionalSections,
        isValidSection: isValidSection,
        isRequiredSection: isRequiredSection,
        isOptionalSection: isOptionalSection,

        // ---- Envelope Validation ----
        validateEnvelope: validateEnvelope,
        isValidEnvelope: isValidEnvelope,

        // ---- Envelope Creation ----
        createEnvelope: createEnvelope,

        // ---- Section Helpers ----
        getDefaultSection: getDefaultSection,
        ensureSection: ensureSection,
        ensureAllSections: ensureAllSections,

        // ---- Summary ----
        getExportSummary: getExportSummary
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.ExportSchema;
        var missing = [];

        var required = [
            'getFormatVersion', 'getMinSupportedVersion', 'getFormatName',
            'getSections', 'getRequiredSections', 'getOptionalSections',
            'isValidSection', 'isRequiredSection', 'isOptionalSection',
            'validateEnvelope', 'isValidEnvelope',
            'createEnvelope',
            'getDefaultSection', 'ensureSection', 'ensureAllSections',
            'getExportSummary'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (exports.SECTIONS === undefined) {
            missing.push('SECTIONS');
        }
        if (exports.FORMAT_VERSION === undefined) {
            missing.push('FORMAT_VERSION');
        }
        if (exports.MIN_SUPPORTED_VERSION === undefined) {
            missing.push('MIN_SUPPORTED_VERSION');
        }
        if (exports.FORMAT_NAME === undefined) {
            missing.push('FORMAT_NAME');
        }

        if (missing.length > 0) {
            console.warn('[ExportSchema] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[ExportSchema] All exports verified successfully.');
            console.log('[ExportSchema] Current format version:', exports.FORMAT_VERSION);
            console.log('[ExportSchema] Sections:', exports.getSections().join(', '));
        }
    })();

})();
