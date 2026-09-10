/**
 * js/modules/application/application-settings-queries.js - Application Settings Queries
 * Canonical read access to application-wide settings
 * 
 * Path: js/modules/application/application-settings-queries.js
 * 
 * This module provides:
 *   - getCurrentYear() - Read the current application year
 * 
 * IMPORTANT:
 *   - READ-ONLY - no mutations
 *   - This is the ONLY public read interface for application settings
 *   - All consumers (Dashboard, Character queries, Team queries, etc.)
 *     MUST use this module to read application settings
 *   - Writes go through ApplicationSettingsCore
 *   - No fallbacks - if the setting is missing, that is a wiring error
 *   - No DOM, no notifications, no side effects
 * 
 * WHY NO FALLBACK TO new Date().getFullYear():
 *   - The application operates on a fictional/historical timeline
 *   - If currentYear is missing, silently using the real-world year
 *     would display incorrect data and make bugs harder to find
 *   - The correct behaviour is to throw, so the wiring error surfaces
 *   - Every correctly-initialised app has currentYear set (see database.js
 *     getEmptyData() and migrations)
 * 
 * WHAT DOES NOT BELONG HERE:
 *   - getCurrentWeek() - currentWeek is not application state.
 *     Academy owns its displayWeek as UI state. Do not add it here.
 *   - Setters - those live in ApplicationSettingsCore
 *   - Defaults - those live in database.js getEmptyData()
 * 
 * DEPENDENCIES:
 *   - window.data (canonical state) - MANDATORY
 * 
 * USAGE:
 *   var Q = window.ApplicationSettingsQueries;
 *   
 *   try {
 *       var year = Q.getCurrentYear();
 *   } catch (e) {
 *       // Application is not correctly initialised
 *   }
 */

(function() {
    'use strict';

    if (window.__applicationSettingsQueriesLoaded) {
        return;
    }
    window.__applicationSettingsQueriesLoaded = true;

    // ============================================================
    // DATA ACCESS
    // ============================================================

    /**
     * Get the canonical application data store.
     * Throws if window.data is not available.
     * 
     * @returns {object} The application data object
     * @throws {Error} If window.data is not available
     */
    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            throw new Error('[ApplicationSettingsQueries] window.data is not available. The application has not been initialised.');
        }
        return window.data;
    }

    // ============================================================
    // QUERIES
    // ============================================================

    /**
     * Get the current application year.
     * 
     * This is the year the application is currently operating in.
     * It is used as the reference point for:
     *   - Character ages (birthYear → age calculation)
     *   - Career status resolution
     *   - Team active periods
     *   - Tournament scheduling
     *   - Mission timing
     * 
     * @returns {number} Current year
     * @throws {Error} If currentYear is not set or is not a number
     */
    function getCurrentYear() {
        var data = getDataStore();
        var year = data.currentYear;

        if (typeof year !== 'number' || !Number.isFinite(year)) {
            throw new Error('[ApplicationSettingsQueries] currentYear is not set. The application data may be corrupted.');
        }

        return year;
    }

    /**
     * Check whether the application year has been set.
     * 
     * This is useful for callers that want to handle a missing year
     * gracefully instead of catching an exception. In normal operation,
     * the year is always set by database.js on initialisation.
     * 
     * @returns {boolean} True if currentYear is set and is a finite number
     */
    function hasCurrentYear() {
        if (!window.data || typeof window.data !== 'object') {
            return false;
        }
        var year = window.data.currentYear;
        return typeof year === 'number' && Number.isFinite(year);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ApplicationSettingsQueries = {
        getCurrentYear: getCurrentYear,
        hasCurrentYear: hasCurrentYear
    };

})();