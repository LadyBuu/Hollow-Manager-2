/**
 * js/modules/calendar/modes/index.js - Calendar Modes Registry
 * Central registry for all calendar modes
 * Path: js/modules/calendar/modes/index.js
 * 
 * This module provides:
 *   - registerMode - Register a new calendar mode
 *   - getMode - Get a mode by name
 *   - getModeNames - Get all registered mode names
 *   - getModeOptions - Get mode options for UI selectors
 *   - hasMode - Check if a mode is registered
 *   - getModeCount - Get the number of registered modes
 *   - unregisterMode - Remove a mode registration (testing only)
 * 
 * IMPORTANT:
 *   - Registry is STATELESS - no mode state, no selection state
 *   - Modes are registered by name with a required contract
 *   - Mode objects are FROZEN to prevent mutation
 *   - No dependencies on other modules
 *   - No DOM, no persistence, no UI state
 * 
 * MODE CONTRACT:
 *   Each mode must provide:
 *   - label: string - Display name
 *   - hint: string - User guidance text
 *   - render(container, state): function - Render the mode
 *   - getEntities(): function - Get list of entities for this mode
 *   - getEntityDisplayName(entity): function - Get display name for an entity
 *   - getData(state): function - Get schedule data for rendering
 * 
 * DEPENDENCIES:
 *   - None (self-contained)
 * 
 * USAGE:
 *   // Register a mode
 *   CalendarModes.registerMode('student', {
 *       label: 'Student',
 *       hint: 'Click a slot to add a class...',
 *       render: function(container, state) { ... },
 *       getEntities: function() { return students; },
 *       getEntityDisplayName: function(entity) { return entity.name; },
 *       getData: function(state) { return schedule; }
 *   });
 * 
 *   // Look up a mode
 *   var mode = CalendarModes.getMode('student');
 *   var names = CalendarModes.getModeNames();
 *   var options = CalendarModes.getModeOptions();
 */

(function() {
    'use strict';

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__calendarModesLoaded) {
        return;
    }

    // ============================================================
    // PRIVATE STATE - Null-prototype registry
    // ============================================================

    var _modes = Object.create(null);
    var _isTestEnvironment = false;

    // ============================================================
    // HELPERS
    // ============================================================

    /**
     * Check if a value is a non-empty string.
     */
    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    /**
     * Check if a value is a function.
     */
    function isFunction(value) {
        return typeof value === 'function';
    }

    /**
     * Deep freeze an object.
     */
    function deepFreeze(obj) {
        if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) {
            return obj;
        }

        var keys = Object.getOwnPropertyNames(obj);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var value = obj[key];
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                deepFreeze(value);
            }
        }

        return Object.freeze(obj);
    }

    // ============================================================
    // REGISTRY FUNCTIONS
    // ============================================================

    /**
     * Register a new calendar mode.
     * 
     * @param {string} name - Mode name (e.g., 'student', 'instructor', 'location')
     * @param {object} mode - Mode implementation
     * @param {string} mode.label - Display label
     * @param {string} mode.hint - User guidance hint
     * @param {function} mode.render - Render function (container, state) => void
     * @param {function} mode.getEntities - Get entities function () => array
     * @param {function} mode.getEntityDisplayName - Get entity display name (entity) => string
     * @param {function} mode.getData - Get schedule data (state) => object
     * @returns {boolean} True if registration was successful
     */
    function registerMode(name, mode) {
        // ---- PHASE 1: VALIDATE NAME ----
        if (!isNonEmptyString(name)) {
            return false;
        }

        var key = name.trim();

        // Check for duplicate registration
        if (Object.prototype.hasOwnProperty.call(_modes, key)) {
            return false;
        }

        // ---- PHASE 2: VALIDATE MODE CONTRACT ----
        if (!mode || typeof mode !== 'object') {
            return false;
        }

        // Validate label
        if (!isNonEmptyString(mode.label)) {
            return false;
        }

        // Validate hint
        if (!isNonEmptyString(mode.hint)) {
            return false;
        }

        // Validate render
        if (!isFunction(mode.render)) {
            return false;
        }

        // Validate getEntities
        if (!isFunction(mode.getEntities)) {
            return false;
        }

        // Validate getEntityDisplayName
        if (!isFunction(mode.getEntityDisplayName)) {
            return false;
        }

        // Validate getData
        if (!isFunction(mode.getData)) {
            return false;
        }

        // ---- PHASE 3: BUILD AND FREEZE REGISTRATION RECORD ----
        var registeredMode = {
            label: mode.label.trim(),
            hint: mode.hint.trim(),
            render: mode.render,
            getEntities: mode.getEntities,
            getEntityDisplayName: mode.getEntityDisplayName,
            getData: mode.getData
        };

        // Freeze to prevent mutation
        deepFreeze(registeredMode);

        // Store in registry
        _modes[key] = registeredMode;

        return true;
    }

    /**
     * Get a registered mode by name.
     * 
     * @param {string} name - Mode name
     * @returns {object|null} Mode object or null if not found
     */
    function getMode(name) {
        if (!isNonEmptyString(name)) {
            return null;
        }

        var key = name.trim();

        if (Object.prototype.hasOwnProperty.call(_modes, key)) {
            return _modes[key];
        }

        return null;
    }

    /**
     * Get all registered mode names.
     * 
     * @returns {Array} Array of mode names
     */
    function getModeNames() {
        var names = [];
        for (var key in _modes) {
            if (Object.prototype.hasOwnProperty.call(_modes, key)) {
                names.push(key);
            }
        }
        return names.sort();
    }

    /**
     * Get mode options for UI selectors.
     * 
     * @returns {Array} Array of { value, label } objects
     */
    function getModeOptions() {
        var options = [];
        var names = getModeNames();

        for (var i = 0; i < names.length; i++) {
            var name = names[i];
            var mode = _modes[name];
            if (mode && mode.label) {
                options.push({
                    value: name,
                    label: mode.label
                });
            }
        }

        return options;
    }

    /**
     * Check if a mode is registered.
     * 
     * @param {string} name - Mode name
     * @returns {boolean} True if the mode is registered
     */
    function hasMode(name) {
        if (!isNonEmptyString(name)) {
            return false;
        }

        var key = name.trim();
        return Object.prototype.hasOwnProperty.call(_modes, key);
    }

    /**
     * Get the number of registered modes.
     * 
     * @returns {number} Number of registered modes
     */
    function getModeCount() {
        return Object.keys(_modes).length;
    }

    /**
     * Unregister a mode.
     * USE WITH CAUTION - primarily for testing and hot-reload.
     * 
     * @param {string} name - Mode name
     * @returns {boolean} True if the mode was unregistered
     */
    function unregisterMode(name) {
        // Only allow in test environment or when explicitly enabled
        if (!_isTestEnvironment) {
            return false;
        }

        if (!isNonEmptyString(name)) {
            return false;
        }

        var key = name.trim();

        if (!Object.prototype.hasOwnProperty.call(_modes, key)) {
            return false;
        }

        delete _modes[key];
        return true;
    }

    /**
     * Enable test mode for unregisterMode.
     * INTERNAL USE ONLY - for testing.
     */
    function _enableTestMode() {
        _isTestEnvironment = true;
    }

    /**
     * Disable test mode.
     * INTERNAL USE ONLY - for testing.
     */
    function _disableTestMode() {
        _isTestEnvironment = false;
    }

    /**
     * Reset the registry.
     * INTERNAL USE ONLY - for testing.
     */
    function _reset() {
        if (!_isTestEnvironment) {
            return;
        }
        _modes = Object.create(null);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarModes = {
        // Core
        registerMode: registerMode,
        getMode: getMode,
        getModeNames: getModeNames,
        getModeOptions: getModeOptions,
        hasMode: hasMode,
        getModeCount: getModeCount,

        // Testing (internal only)
        unregisterMode: unregisterMode,
        _enableTestMode: _enableTestMode,
        _disableTestMode: _disableTestMode,
        _reset: _reset
    };

    window.__calendarModesLoaded = true;

})();