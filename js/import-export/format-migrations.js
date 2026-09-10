/**
 * js/import-export/format-migrations.js - Export Format Migrations
 * Version-to-version migrations for the export format.
 * 
 * This module handles transforming export envelopes from older format versions
 * to newer format versions. Each migration is a pure function that takes
 * an envelope and returns the migrated envelope.
 * 
 * IMPORTANT:
 *   - Migrations are STRICTLY for EXPORT FORMAT versions
 *   - NOT for DATA_VERSION (internal application migrations)
 *   - NOT for DB_VERSION (IndexedDB structural migrations)
 *   - Each migration is PURE - no side effects, no mutations
 *   - Migrations should preserve data integrity
 *   - If a migration cannot be applied, it throws with a clear message
 * 
 * MIGRATION PHILOSOPHY:
 *   - Migration functions are applied sequentially: v1 → v2 → v3 → current
 *   - Each migration knows how to transform from its version to the next
 *   - Migrations should be idempotent where possible
 *   - Data loss should be explicitly documented
 *   - Unknown fields are preserved (forward compatibility)
 * 
 * VERSION INDEPENDENCE:
 *   - EXPORT_FORMAT_VERSION: Public file contract (this module)
 *   - DATA_VERSION: Internal application migrations (database.js)
 *   - DB_VERSION: IndexedDB structural migrations (database.js)
 * 
 * DEPENDENCIES:
 *   - window.ExportSchema (from export-schema.js) - MANDATORY
 *   - window.ExportEnvelope (from export-envelope.js) - MANDATORY
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 * 
 * USAGE:
 *   var Migrations = window.FormatMigrations;
 *   
 *   // Check if migration is needed
 *   if (Migrations.needsMigration(envelope)) {
 *       envelope = Migrations.apply(envelope);
 *   }
 *   
 *   // Apply specific migration
 *   var migrated = Migrations.migrateV1toV2(envelope);
 *   
 *   // Get migration path
 *   var path = Migrations.getMigrationPath(envelope.formatVersion);
 */

(function() {
    'use strict';

    if (window.__formatMigrationsLoaded) return;
    window.__formatMigrationsLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.ExportSchema) {
        throw new Error('[FormatMigrations] ExportSchema is required.');
    }

    if (!window.ExportEnvelope) {
        throw new Error('[FormatMigrations] ExportEnvelope is required.');
    }

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        throw new Error('[FormatMigrations] ObjectUtils.deepClone is required.');
    }

    var Schema = window.ExportSchema;
    var Envelope = window.ExportEnvelope;
    var ObjectUtils = window.ObjectUtils;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var CURRENT_VERSION = Schema.FORMAT_VERSION;
    var MIN_SUPPORTED_VERSION = Schema.MIN_SUPPORTED_VERSION;

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNumber(value) {
        return typeof value === 'number' && Number.isFinite(value);
    }

    function isArray(value) {
        return Array.isArray(value);
    }

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    function getSection(data, sectionName, defaultValue) {
        if (data && sectionName in data) {
            return data[sectionName];
        }
        return defaultValue !== undefined ? defaultValue : Schema.getDefaultSection(sectionName);
    }

    function ensureArray(data, sectionName) {
        if (!data || typeof data !== 'object') {
            return;
        }
        if (!(sectionName in data) || !Array.isArray(data[sectionName])) {
            data[sectionName] = [];
        }
    }

    function ensureObject(data, sectionName) {
        if (!data || typeof data !== 'object') {
            return;
        }
        if (!(sectionName in data) || !isObject(data[sectionName])) {
            data[sectionName] = {};
        }
    }

    // ============================================================
    // MIGRATION REGISTRY
    // ============================================================

    /**
     * Registry of migration functions.
     * Each function takes an envelope and returns the migrated envelope.
     * Functions are applied sequentially: v1 → v2 → v3 → ...
     */
    var MIGRATIONS = {};

    /**
     * Register a migration function.
     * 
     * @param {number} fromVersion - Version to migrate from
     * @param {number} toVersion - Version to migrate to
     * @param {Function} fn - Migration function (envelope) => envelope
     */
    function registerMigration(fromVersion, toVersion, fn) {
        var key = fromVersion + 'to' + toVersion;
        if (MIGRATIONS[key]) {
            console.warn('[FormatMigrations] Migration ' + key + ' already registered. Overwriting.');
        }
        MIGRATIONS[key] = fn;
    }

    // ============================================================
    // INDIVIDUAL MIGRATIONS
    // ============================================================

    // ---- v1 to v2 (placeholder - no actual changes yet) ----
    // When format v2 is introduced, this migration will be implemented.
    // For now, v1 is the only version, so this is a no-op.

    /**
     * Migration: v1 → v2
     * 
     * Changes:
     *   - (Placeholder - no changes yet)
     * 
     * @param {object} envelope - Export envelope (v1)
     * @returns {object} Migrated envelope (v2)
     */
    function migrateV1toV2(envelope) {
        var result = deepClone(envelope);
        // No changes yet - this is a placeholder
        // When format v2 is introduced, add transformations here
        return result;
    }

    registerMigration(1, 2, migrateV1toV2);

    // ---- v2 to v3 (placeholder) ----
    // Future migrations will be added here

    // ---- vN to vN+1 pattern ----
    // Each new version gets its own migration function
    // and is registered in the registry

    // ============================================================
    // MIGRATION EXECUTION
    // ============================================================

    /**
     * Apply all necessary migrations to an envelope.
     * 
     * @param {object} envelope - Export envelope to migrate
     * @param {object} options - Options
     * @param {boolean} options.inPlace - Modify in place (default: false)
     * @param {number} options.targetVersion - Target version (default: CURRENT_VERSION)
     * @returns {object} Migrated envelope
     * @throws {Error} If migration cannot be applied
     */
    function apply(envelope, options) {
        options = options || {};
        var targetVersion = options.targetVersion || CURRENT_VERSION;

        if (!envelope || typeof envelope !== 'object') {
            throw new TypeError('Envelope must be an object.');
        }

        var currentVersion = envelope.formatVersion;
        if (!isNumber(currentVersion)) {
            throw new Error('Envelope has invalid format version.');
        }

        if (currentVersion === targetVersion) {
            return options.inPlace ? envelope : deepClone(envelope);
        }

        if (currentVersion < MIN_SUPPORTED_VERSION) {
            throw new Error(
                'Envelope version ' + currentVersion + ' is too old to migrate. ' +
                'Minimum supported version is ' + MIN_SUPPORTED_VERSION + '.'
            );
        }

        if (currentVersion > targetVersion) {
            throw new Error(
                'Envelope version ' + currentVersion + ' is newer than target version ' + targetVersion + '. ' +
                'Downgrading is not supported.'
            );
        }

        var result = options.inPlace ? envelope : deepClone(envelope);

        // Apply migrations sequentially
        for (var version = currentVersion; version < targetVersion; version++) {
            var nextVersion = version + 1;
            var key = version + 'to' + nextVersion;

            if (!MIGRATIONS[key]) {
                throw new Error(
                    'No migration found from version ' + version + ' to ' + nextVersion + '. ' +
                    'Cannot migrate from ' + currentVersion + ' to ' + targetVersion + '.'
                );
            }

            result = MIGRATIONS[key](result);
            result.formatVersion = nextVersion;
        }

        // Ensure envelope is valid after migration
        var validation = Envelope.validate(result, { strict: false });
        if (!validation.valid) {
            var errors = validation.errors.join(', ');
            throw new Error('Migration produced invalid envelope: ' + errors);
        }

        return result;
    }

    /**
     * Check if an envelope needs migration.
     * 
     * @param {object} envelope - Export envelope
     * @param {number} targetVersion - Target version (default: CURRENT_VERSION)
     * @returns {boolean} True if migration is needed
     */
    function needsMigration(envelope, targetVersion) {
        targetVersion = targetVersion || CURRENT_VERSION;

        if (!envelope || typeof envelope !== 'object') {
            return false;
        }

        var version = envelope.formatVersion;
        if (!isNumber(version)) {
            return true;
        }

        return version < targetVersion && version >= MIN_SUPPORTED_VERSION;
    }

    /**
     * Get the migration path from one version to another.
     * 
     * @param {number} fromVersion - Starting version
     * @param {number} toVersion - Target version (default: CURRENT_VERSION)
     * @returns {Array} Array of version numbers in the migration path
     */
    function getMigrationPath(fromVersion, toVersion) {
        toVersion = toVersion || CURRENT_VERSION;

        if (!isNumber(fromVersion) || !isNumber(toVersion)) {
            return [];
        }

        if (fromVersion === toVersion) {
            return [fromVersion];
        }

        if (fromVersion > toVersion) {
            return [];
        }

        var path = [];
        for (var version = fromVersion; version <= toVersion; version++) {
            path.push(version);
        }
        return path;
    }

    /**
     * Get all available migration keys.
     * 
     * @returns {Array} Array of migration keys
     */
    function getAvailableMigrations() {
        return Object.keys(MIGRATIONS);
    }

    /**
     * Get the current version.
     * 
     * @returns {number} Current format version
     */
    function getCurrentVersion() {
        return CURRENT_VERSION;
    }

    /**
     * Get the minimum supported version.
     * 
     * @returns {number} Minimum supported version
     */
    function getMinSupportedVersion() {
        return MIN_SUPPORTED_VERSION;
    }

    // ============================================================
    // VERSION CONSTANTS
    // ============================================================

    var VERSION_CONSTANTS = Object.freeze({
        CURRENT: CURRENT_VERSION,
        MIN_SUPPORTED: MIN_SUPPORTED_VERSION,
        V1: 1,
        V2: 2,
        V3: 3
    });

    // ============================================================
    // EXPOSE
    // ============================================================

    window.FormatMigrations = {
        // ---- Migration execution ----
        apply: apply,
        needsMigration: needsMigration,

        // ---- Migration path ----
        getMigrationPath: getMigrationPath,
        getAvailableMigrations: getAvailableMigrations,

        // ---- Version info ----
        getCurrentVersion: getCurrentVersion,
        getMinSupportedVersion: getMinSupportedVersion,

        // ---- Individual migrations (exposed for testing) ----
        migrateV1toV2: migrateV1toV2,

        // ---- Constants ----
        VERSIONS: VERSION_CONSTANTS
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.FormatMigrations;
        var missing = [];

        var required = [
            'apply', 'needsMigration',
            'getMigrationPath', 'getAvailableMigrations',
            'getCurrentVersion', 'getMinSupportedVersion'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        // Check that V1 migration is registered
        if (!MIGRATIONS['1to2']) {
            missing.push('Migration 1→2 (not registered)');
        }

        if (missing.length > 0) {
            console.warn('[FormatMigrations] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[FormatMigrations] All exports verified successfully.');
            console.log('[FormatMigrations] Current version:', CURRENT_VERSION);
            console.log('[FormatMigrations] Migrations registered:', Object.keys(MIGRATIONS).join(', '));
        }
    })();

})();
