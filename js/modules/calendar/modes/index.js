/**
 * js/modules/calendar/modes/index.js - Calendar Mode Registry
 * Registers all calendar modes and provides factory functions
 * Path: js/modules/calendar/modes/index.js
 * 
 * This module is responsible for:
 *   - Maintaining the calendar mode registry
 *   - Providing lookup functions for modes
 *   - Validating mode existence
 * 
 * IMPORTANT:
 *   - This module only creates the registry
 *   - Individual mode modules (student.js, instructor.js, location.js)
 *     register themselves with this registry
 *   - No mode implementations are defined here
 */

(function() {
    'use strict';

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    if (!window.CalendarUI) {
        return;
    }

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__calendarModesLoaded) {
        return;
    }
    window.__calendarModesLoaded = true;

    // ============================================================
    // MODE REGISTRY
    // ============================================================

    var modes = {};

    /**
     * Register a calendar mode
     * @param {string} name - Unique mode identifier
     * @param {object} mode - Mode implementation
     * @param {string} mode.label - Display label for the mode
     * @param {function} mode.render - Render function (container, state) => void
     * @param {function} mode.getEntities - Get list of entities for this mode
     * @param {function} mode.getEntityDisplayName - Get display name for an entity
     * @param {function} mode.getData - Get schedule data for the current state
     * @returns {boolean} - True if registration succeeded
     */
    function registerMode(name, mode) {
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return false;
        }

        if (!mode || typeof mode !== 'object') {
            return false;
        }

        if (typeof mode.render !== 'function') {
            return false;
        }

        if (typeof mode.getEntities !== 'function') {
            return false;
        }

        if (typeof mode.getEntityDisplayName !== 'function') {
            return false;
        }

        if (typeof mode.getData !== 'function') {
            return false;
        }

        var key = name.trim();
        modes[key] = {
            label: mode.label || key.charAt(0).toUpperCase() + key.slice(1),
            render: mode.render,
            getEntities: mode.getEntities,
            getEntityDisplayName: mode.getEntityDisplayName,
            getData: mode.getData
        };

        return true;
    }

    /**
     * Get a registered mode by name
     * @param {string} name - Mode identifier
     * @returns {object|null} - The mode implementation or null
     */
    function getMode(name) {
        if (!name || typeof name !== 'string') {
            return null;
        }
        return modes[name.trim()] || null;
    }

    /**
     * Get all registered mode names
     * @returns {string[]} - Array of mode names
     */
    function getModeNames() {
        return Object.keys(modes);
    }

    /**
     * Get mode options for UI selectors
     * @returns {Array<{value: string, label: string}>} - Mode options
     */
    function getModeOptions() {
        var result = [];
        var names = Object.keys(modes);
        for (var i = 0; i < names.length; i++) {
            var name = names[i];
            result.push({
                value: name,
                label: modes[name].label || name.charAt(0).toUpperCase() + name.slice(1)
            });
        }
        return result;
    }

    /**
     * Check if a mode is registered
     * @param {string} name - Mode identifier
     * @returns {boolean} - True if the mode exists
     */
    function hasMode(name) {
        if (!name || typeof name !== 'string') {
            return false;
        }
        return !!modes[name.trim()];
    }

    /**
     * Get the count of registered modes
     * @returns {number} - Number of registered modes
     */
    function getModeCount() {
        return Object.keys(modes).length;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarModes = {
        registerMode: registerMode,
        getMode: getMode,
        getModeNames: getModeNames,
        getModeOptions: getModeOptions,
        hasMode: hasMode,
        getModeCount: getModeCount
    };

})();
