/**
 * js/import-export/index.js - Import/Export Module Entry Point
 * Public API for the import/export subsystem
 * 
 * This module is the single entry point for all import/export operations.
 * It aggregates all import/export modules under a unified namespace.
 * 
 * IMPORTANT:
 *   - This is the PUBLIC API for import/export
 *   - All consumers should use `window.ImportExport`
 *   - Individual modules are exposed for advanced/testing use
 *   - Does NOT implement any logic itself - just aggregation
 *   - Verifies all dependencies are loaded
 * 
 * ARCHITECTURE:
 *   Import/Export is an APPLICATION DATA-TRANSFER BOUNDARY.
 *   It is NOT a domain module. It translates between:
 *     - The portable export format (external)
 *     - The canonical application state (internal)
 * 
 * MODULES AGGREGATED:
 *   Core:
 *     - ExportSchema     - Format definition + sections
 *     - ExportEnvelope   - Envelope creation/validation
 *     - FormatMigrations - Export format version migrations
 *     - CrossDomainValidator - Reference integrity validation
 *     - ImportPipeline   - All-or-nothing import orchestration
 *     - JSONIO           - Low-level JSON I/O
 * 
 *   CSV:
 *     - CSV              - Pure CSV parser/escaping
 *     - CharacterCSV     - Character CSV (schema + export + import + template)
 *     - MissionCSV       - Mission CSV (schema + export + import + template)
 * 
 *   Utilities:
 *     - ExportUtils      - File download, field helpers
 *     - ImportResult     - Structured import result container
 * 
 *   UI:
 *     - ImportExportUI   - Button binding, file inputs, notifications
 * 
 * DEPENDENCIES:
 *   All constituent modules must be loaded before this module.
 * 
 * USAGE:
 *   // Public API
 *   var IE = window.ImportExport;
 *   
 *   // Import from file
 *   IE.Pipeline.importFromFile(file).then(function(result) { ... });
 *   
 *   // Export characters to CSV
 *   IE.CharacterCSV.exportFromData();
 *   
 *   // Export JSON backup
 *   IE.JSONIO.exportJSON(window.data);
 *   
 *   // Validate envelope
 *   IE.Envelope.validate(envelope);
 *   
 *   // Get schema info
 *   IE.Schema.FORMAT_VERSION;
 *   IE.Schema.getSections();
 */

(function() {
    'use strict';

    if (window.__importExportLoaded) {
        return;
    }
    window.__importExportLoaded = true;

    // ============================================================
    // DEPENDENCY VALIDATION
    // ============================================================

    /**
     * Required modules and their minimum required API.
     * Each entry is: { name, check, critical }
     * 
     * critical: if true, missing module throws an error.
     *           if false, missing module produces a warning.
     */
    var REQUIRED_MODULES = [
        // ---- Core (critical) ----
        {
            name: 'ExportSchema',
            check: function(m) {
                return m && typeof m.getSections === 'function' && typeof m.FORMAT_VERSION === 'number';
            },
            critical: true,
            description: 'Export format schema and sections'
        },
        {
            name: 'ExportEnvelope',
            check: function(m) {
                return m && typeof m.create === 'function' && typeof m.validate === 'function';
            },
            critical: true,
            description: 'Envelope creation and validation'
        },
        {
            name: 'FormatMigrations',
            check: function(m) {
                return m && typeof m.apply === 'function' && typeof m.needsMigration === 'function';
            },
            critical: true,
            description: 'Export format version migrations'
        },
        {
            name: 'CrossDomainValidator',
            check: function(m) {
                return m && typeof m.validate === 'function';
            },
            critical: true,
            description: 'Cross-domain reference validation'
        },
        {
            name: 'ImportPipeline',
            check: function(m) {
                return m && typeof m.importFromFile === 'function' && typeof m.importFromEnvelope === 'function';
            },
            critical: true,
            description: 'All-or-nothing import orchestration'
        },

        // ---- Utilities (critical) ----
        {
            name: 'ExportUtils',
            check: function(m) {
                return m && typeof m.downloadBlob === 'function' && typeof m.readFileAsText === 'function';
            },
            critical: true,
            description: 'File utilities'
        },
        {
            name: 'ImportResult',
            check: function(m) {
                return typeof m === 'function';
            },
            critical: true,
            description: 'Structured import result'
        },

        // ---- CSV (critical for CSV operations) ----
        {
            name: 'CSV',
            check: function(m) {
                return m && typeof m.parse === 'function' && typeof m.arrayToCSV === 'function';
            },
            critical: true,
            description: 'Pure CSV parser'
        },
        {
            name: 'CharacterCSV',
            check: function(m) {
                return m && typeof m.export === 'function' && typeof m.import === 'function';
            },
            critical: true,
            description: 'Character CSV operations'
        },
        {
            name: 'MissionCSV',
            check: function(m) {
                return m && typeof m.export === 'function' && typeof m.import === 'function';
            },
            critical: true,
            description: 'Mission CSV operations'
        },

        // ---- JSON (critical) ----
        {
            name: 'JSONIO',
            check: function(m) {
                return m && typeof m.exportJSON === 'function' && typeof m.importJSONFromFile === 'function';
            },
            critical: true,
            description: 'JSON import/export'
        },

        // ---- UI (non-critical) ----
        {
            name: 'ImportExportUI',
            check: function(m) {
                return m && typeof m.init === 'function';
            },
            critical: false,
            description: 'UI wiring (buttons, file inputs)'
        }
    ];

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];
        var missingNonCritical = [];

        for (var i = 0; i < REQUIRED_MODULES.length; i++) {
            var mod = REQUIRED_MODULES[i];
            var moduleRef = window[mod.name];

            var isPresent = moduleRef !== undefined && moduleRef !== null;
            var isFunctional = isPresent && mod.check(moduleRef);

            if (!isFunctional) {
                if (mod.critical) {
                    missing.push({
                        name: mod.name,
                        description: mod.description,
                        reason: !isPresent ? 'not loaded' : 'invalid API'
                    });
                } else {
                    missingNonCritical.push({
                        name: mod.name,
                        description: mod.description,
                        reason: !isPresent ? 'not loaded' : 'invalid API'
                    });
                }
            }
        }

        return {
            valid: missing.length === 0,
            missing: missing,
            missingNonCritical: missingNonCritical
        };
    }

    // ============================================================
    // PUBLIC API AGGREGATION
    // ============================================================

    /**
     * Build the public API object.
     * Only exposes modules that loaded successfully.
     */
    function buildPublicAPI() {
        var api = {
            // ---- Metadata ----
            VERSION: '1.0.0',
            FORMAT_NAME: null,
            FORMAT_VERSION: null,

            // ---- Core ----
            Schema: window.ExportSchema || null,
            Envelope: window.ExportEnvelope || null,
            Migrations: window.FormatMigrations || null,
            Validator: window.CrossDomainValidator || null,
            Pipeline: window.ImportPipeline || null,

            // ---- CSV ----
            CSV: window.CSV || null,
            CharacterCSV: window.CharacterCSV || null,
            MissionCSV: window.MissionCSV || null,

            // ---- JSON ----
            JSONIO: window.JSONIO || null,

            // ---- Utilities ----
            ExportUtils: window.ExportUtils || null,
            ImportResult: window.ImportResult || null,

            // ---- UI ----
            UI: window.ImportExportUI || null
        };

        // Extract format metadata from schema
        if (api.Schema) {
            api.FORMAT_NAME = api.Schema.FORMAT_NAME || null;
            api.FORMAT_VERSION = api.Schema.FORMAT_VERSION || null;
        }

        return api;
    }

    // ============================================================
    // CONVENIENCE FUNCTIONS
    // ============================================================

    /**
     * Get module availability status.
     * 
     * @returns {object} Status of all modules
     */
    function getStatus() {
        var status = {
            valid: true,
            modules: {},
            missing: [],
            missingNonCritical: []
        };

        for (var i = 0; i < REQUIRED_MODULES.length; i++) {
            var mod = REQUIRED_MODULES[i];
            var moduleRef = window[mod.name];
            var isPresent = moduleRef !== undefined && moduleRef !== null;
            var isFunctional = isPresent && mod.check(moduleRef);

            status.modules[mod.name] = {
                loaded: isPresent,
                functional: isFunctional,
                critical: mod.critical,
                description: mod.description
            };

            if (!isFunctional) {
                if (mod.critical) {
                    status.valid = false;
                    status.missing.push(mod.name);
                } else {
                    status.missingNonCritical.push(mod.name);
                }
            }
        }

        return status;
    }

    /**
     * Check if a specific module is available.
     * 
     * @param {string} moduleName - Name of module
     * @returns {boolean} True if module is loaded and functional
     */
    function hasModule(moduleName) {
        var moduleRef = window[moduleName];
        if (!moduleRef) return false;

        for (var i = 0; i < REQUIRED_MODULES.length; i++) {
            var mod = REQUIRED_MODULES[i];
            if (mod.name === moduleName) {
                return mod.check(moduleRef);
            }
        }

        return true;
    }

    /**
     * Get a specific module by name.
     * 
     * @param {string} moduleName - Name of module
     * @returns {object|null} Module or null
     */
    function getModule(moduleName) {
        var moduleRef = window[moduleName] || null;
        if (moduleRef) {
            return moduleRef;
        }

        // Check aggregated API
        var api = window.ImportExport;
        if (api && api[moduleName]) {
            return api[moduleName];
        }

        return null;
    }

    // ============================================================
    // CONVENIENCE WRAPPERS - Direct operations
    // ============================================================

    /**
     * Export application data as a JSON envelope.
     * 
     * @param {object} data - Application data (defaults to window.data)
     * @param {object} options - Export options
     * @returns {object} Export result
     */
    function exportJSON(data, options) {
        if (!window.JSONIO) {
            return { exported: false, error: 'JSONIO not available' };
        }

        options = options || {};
        data = data || window.data || {};

        // Create envelope if not already
        var envelope = data;
        if (window.Envelope && (!data.format || data.format !== window.ExportSchema.FORMAT_NAME)) {
            envelope = window.Envelope.create(data, options);
        }

        return window.JSONIO.exportJSON(envelope, options);
    }

    /**
     * Import application data from a JSON file.
     * 
     * @param {File} file - File to import
     * @param {object} options - Import options
     * @returns {Promise<object>} Import result
     */
    function importJSON(file, options) {
        if (!window.ImportPipeline) {
            return Promise.reject(new Error('ImportPipeline not available'));
        }
        return window.ImportPipeline.importFromFile(file, options);
    }

    /**
     * Export characters to CSV.
     * 
     * @param {object} options - Export options
     * @returns {object} Export result
     */
    function exportCharacters(options) {
        if (!window.CharacterCSV) {
            return { exported: false, error: 'CharacterCSV not available' };
        }
        return window.CharacterCSV.exportFromData(options);
    }

    /**
     * Export missions to CSV.
     * 
     * @param {object} options - Export options
     * @returns {object} Export result
     */
    function exportMissions(options) {
        if (!window.MissionCSV) {
            return { exported: false, error: 'MissionCSV not available' };
        }
        return window.MissionCSV.exportFromData(options);
    }

    // ============================================================
    // VERIFICATION
    // ============================================================

    function verify() {
        var depCheck = checkDependencies();

        if (!depCheck.valid) {
            var errorMessage = 'ImportExport module missing critical dependencies:\n' +
                depCheck.missing.map(function(m) {
                    return '  - ' + m.name + ' (' + m.description + '): ' + m.reason;
                }).join('\n');

            console.error('[ImportExport] ' + errorMessage);
            throw new Error(errorMessage);
        }

        if (depCheck.missingNonCritical.length > 0) {
            console.warn(
                '[ImportExport] Some non-critical modules not loaded:',
                depCheck.missingNonCritical.map(function(m) { return m.name; }).join(', ')
            );
        }

        console.log('[ImportExport] All critical dependencies verified successfully.');
    }

    // ============================================================
    // RUN VERIFICATION
    // ============================================================

    try {
        verify();
    } catch (e) {
        // Store error for later inspection but don't crash the whole app
        window.__importExportError = e;

        // Expose a minimal API that reports the error
        window.ImportExport = {
            VERSION: '1.0.0',
            error: e.message,
            ready: false,
            getStatus: function() {
                return {
                    valid: false,
                    error: e.message,
                    missing: checkDependencies().missing
                };
            }
        };

        console.error('[ImportExport] Module failed to initialize. Errors will be reported via getStatus().');
        return;
    }

    // ============================================================
    // EXPOSE PUBLIC API
    // ============================================================

    var publicAPI = buildPublicAPI();

    // Add convenience methods
    publicAPI.ready = true;
    publicAPI.error = null;
    publicAPI.getStatus = getStatus;
    publicAPI.hasModule = hasModule;
    publicAPI.getModule = getModule;

    // Add convenience wrappers
    publicAPI.exportJSON = exportJSON;
    publicAPI.importJSON = importJSON;
    publicAPI.exportCharacters = exportCharacters;
    publicAPI.exportMissions = exportMissions;

    // Freeze the API
    Object.freeze(publicAPI);

    window.ImportExport = publicAPI;

    // ============================================================
    // VERIFICATION OUTPUT
    // ============================================================

    (function outputStatus() {
        var status = getStatus();

        console.log('[ImportExport] Module initialized successfully.');
        console.log('[ImportExport] Version:', publicAPI.VERSION);
        console.log('[ImportExport] Format:', publicAPI.FORMAT_NAME, 'v' + publicAPI.FORMAT_VERSION);

        // Log loaded modules
        var loadedModules = [];
        for (var name in status.modules) {
            if (status.modules.hasOwnProperty(name) && status.modules[name].functional) {
                loadedModules.push(name);
            }
        }
        console.log('[ImportExport] Loaded modules (' + loadedModules.length + '):', loadedModules.join(', '));

        if (status.missingNonCritical.length > 0) {
            console.warn('[ImportExport] Non-critical modules missing:', status.missingNonCritical.join(', '));
        }
    })();

})();
