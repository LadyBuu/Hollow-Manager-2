/**
 * js/modules/application/application-settings-core.js - Application Settings Core
 * Canonical owner of application-wide settings
 * 
 * Path: js/modules/application/application-settings-core.js
 * 
 * This module owns:
 *   - currentYear
 * 
 * IMPORTANT:
 *   - Application settings are NOT domain data
 *   - They are NOT dashboard data
 *   - They live in window.data but are owned by this module
 *   - All reads go through ApplicationSettingsQueries
 *   - All writes go through ApplicationSettingsCore
 *   - Writes go through MutationPipeline
 *   - This module does NOT call saveData() directly
 *   - This module does NOT touch the DOM
 *   - This module does NOT own currentWeek
 *     - currentWeek is a per-session view selector owned by AcademyUI
 *     - It is not application state and is not persisted
 * 
 * WHY currentYear IS APPLICATION STATE:
 *   - It represents "which year am I working in"
 *   - Characters, teams, tournaments, missions all reference it
 *   - Users navigate the timeline by changing it
 *   - It must survive reloads (it is the working context)
 * 
 * WHY currentWeek IS NOT APPLICATION STATE:
 *   - It is a filter for which schedule/grades/ranking to display
 *   - It is per-view, per-session, and ephemeral
 *   - It is owned by AcademyUI as displayWeek (sessionStorage)
 *   - It does not affect how domains interpret data
 * 
 * DEPENDENCIES:
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 *     (for MIN_YEAR / MAX_YEAR bounds)
 * 
 * USAGE:
 *   var Core = window.ApplicationSettingsCore;
 *   
 *   Core.setCurrentYear(1925).then(function(result) {
 *       if (result.success) {
 *           // Year updated
 *       } else {
 *           // result.message contains the failure reason
 *       }
 *   });
 */

(function() {
    'use strict';

    if (window.__applicationSettingsCoreLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY
    // ============================================================

    var missing = [];

    if (!window.MutationPipeline || typeof window.MutationPipeline.performMutation !== 'function') {
        missing.push('MutationPipeline.performMutation');
    }

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }
    if (!window.CalendarConstants || typeof window.CalendarConstants.MIN_YEAR !== 'number') {
        missing.push('CalendarConstants.MIN_YEAR');
    }
    if (!window.CalendarConstants || typeof window.CalendarConstants.MAX_YEAR !== 'number') {
        missing.push('CalendarConstants.MAX_YEAR');
    }

    if (missing.length > 0) {
        throw new Error('[ApplicationSettingsCore] Missing dependencies: ' + missing.join(', '));
    }

    window.__applicationSettingsCoreLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var MutationPipeline = window.MutationPipeline;
    var CalendarConstants = window.CalendarConstants;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_YEAR = CalendarConstants.MIN_YEAR;
    var MAX_YEAR = CalendarConstants.MAX_YEAR;

    // ============================================================
    // VALIDATION
    // ============================================================

    /**
     * Check if a value is a valid application year.
     * 
     * @param {*} year - Value to validate
     * @returns {boolean} True if valid
     */
    function isValidYear(year) {
        if (typeof year !== 'number' || !Number.isFinite(year)) {
            return false;
        }
        if (!Number.isInteger(year)) {
            return false;
        }
        return year >= MIN_YEAR && year <= MAX_YEAR;
    }

    // ============================================================
    // COMMANDS
    // ============================================================

    /**
     * Set the current application year.
     * 
     * Delegates the mutation to MutationPipeline, which:
     *   - Snapshots window.data
     *   - Applies the mutation
     *   - Persists via saveData()
     *   - Rolls back on failure
     *   - Logs the activity
     * 
     * Returns a promise resolving to a structured result.
     * 
     * @param {number} year - New year (MIN_YEAR..MAX_YEAR)
     * @returns {Promise<object>} { success: boolean, data?: any, message?: string }
     */
    function setCurrentYear(year) {
        // ---- VALIDATE ----
        if (!isValidYear(year)) {
            return Promise.resolve({
                success: false,
                message: 'Year must be an integer between ' + MIN_YEAR + ' and ' + MAX_YEAR + '.'
            });
        }

        // ---- DELEGATE TO MUTATION PIPELINE ----
        return MutationPipeline.performMutation({
            validate: function(data) {
                if (!data || typeof data !== 'object') {
                    return {
                        valid: false,
                        message: 'Application data is not available.'
                    };
                }
                if (data.currentYear === year) {
                    return {
                        valid: false,
                        message: 'Year is already set to ' + year + '.'
                    };
                }
                return { valid: true };
            },

            mutate: function(data) {
                var previousYear = data.currentYear;
                data.currentYear = year;
                return {
                    previousYear: previousYear,
                    newYear: year
                };
            },

            logMessage: function(result) {
                return 'Changed current year from ' + result.previousYear + ' to ' + result.newYear;
            },

            successMessage: function(result) {
                return 'Year set to ' + result.newYear + '.';
            },

            failureMessage: 'Failed to update year.'
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ApplicationSettingsCore = {
        // Commands
        setCurrentYear: setCurrentYear,

        // Validation (exposed for reuse by queries and UI)
        isValidYear: isValidYear,

        // Constants (read-only)
        MIN_YEAR: MIN_YEAR,
        MAX_YEAR: MAX_YEAR
    };

})();