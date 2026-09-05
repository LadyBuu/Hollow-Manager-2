/**
 * js/constants.js - Shared Constants Module
 * Single source of truth for truly global application constants
 * Path: js/constants.js
 * 
 * This module provides:
 *   - Calendar constants (week, day, hour ranges)
 *   - ID prefix constants
 *   - Data version constants
 *   - UI breakpoint constants
 * 
 * IMPORTANT:
 *   - This module contains ONLY truly global constants
 *   - Domain-specific constants have been moved to their owners:
 *     - CLASS_DEFINITIONS → Academy domain
 *     - MAGIC_CONSTANTS → Magic domain
 *     - CHARACTER_CONSTANTS → Character domain
 *     - GRADE_CONSTANTS → Academy domain
 *     - STATUS_CONSTANTS → Character/Status domain
 *     - RELATIONSHIP_CONSTANTS → Social domain
 *   - Load this module FIRST before any other module
 *   - All constants are READ-ONLY - do not modify them at runtime
 *   - Constants are DEEP FROZEN to prevent mutation
 * 
 * LOAD ORDER:
 *   <script src="js/constants.js"></script>  <!-- FIRST -->
 *   <script src="js/core/core-utils.js"></script>
 *   <script src="js/utils/id-utils.js"></script>
 *   <!-- All other modules -->
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__constantsLoaded) {
        return;
    }
    window.__constantsLoaded = true;

    // ============================================================
    // DEEP FREEZE UTILITY
    // ============================================================

    function deepFreeze(obj) {
        if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) {
            return obj;
        }

        var keys = Object.getOwnPropertyNames(obj);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var value = obj[key];
            if (value && typeof value === 'object') {
                deepFreeze(value);
            }
        }

        return Object.freeze(obj);
    }

    // ============================================================
    // CALENDAR CONSTANTS - Truly global
    // ============================================================

    var CALENDAR_CONSTANTS = {
        /** Minimum week number (1-indexed) */
        MIN_WEEK: 1,
        /** Maximum week number (1-indexed) */
        MAX_WEEK: 52,
        /** Minimum day number (Monday = 1) */
        MIN_DAY: 1,
        /** Maximum day number (Sunday = 7) */
        MAX_DAY: 7,
        /** Minimum hour (0 = midnight) */
        MIN_HOUR: 0,
        /** Maximum hour (23 = 11pm) */
        MAX_HOUR: 23,
        /** Calendar display start hour (5am) */
        CALENDAR_START_HOUR: 5,
        /** Calendar display end hour (11pm) */
        CALENDAR_END_HOUR: 23,
        /** Days in a week */
        DAYS_IN_WEEK: 7,
        /** Minimum year for validation */
        MIN_YEAR: 1900,
        /** Maximum year for validation */
        MAX_YEAR: 9999
    };

    // ============================================================
    // ID PREFIX CONSTANTS - Truly global
    // ============================================================

    var ID_CONSTANTS = {
        /** ID prefixes for different entity types */
        PREFIXES: {
            CHARACTER: 'char',
            TEAM: 'team',
            CLASS: 'class',
            LOCATION: 'loc',
            DISCIPLINE: 'disc',
            TOURNAMENT: 'tourn',
            MISSION: 'miss',
            RELATIONSHIP: 'rel',
            ELIMINATION: 'elim',
            ACTIVITY: 'act',
            GRADUATING_CLASS: 'gradclass',
            NOTIFICATION: 'notif'
        }
    };

    // ============================================================
    // DATA VERSION CONSTANTS - Truly global
    // ============================================================

    var DATA_CONSTANTS = {
        /** Current application data version */
        VERSION: 13,
        /** Minimum supported version (for migration) */
        MIN_SUPPORTED_VERSION: 1,
        /** Maximum warning limit for CSV import */
        MAX_WARNINGS: 50
    };

    // ============================================================
    // UI CONSTANTS - Truly global (minimal)
    // ============================================================

    var UI_CONSTANTS = {
        /** Mobile breakpoint in pixels */
        MOBILE_BREAKPOINT: 768,
        /** Tablet breakpoint in pixels */
        TABLET_BREAKPOINT: 1024
    };

    // ============================================================
    // HELPER FUNCTIONS - Derived from constants
    // ============================================================

    /**
     * Get the current data version.
     * 
     * @returns {number} Current data version
     */
    function getDataVersion() {
        return DATA_CONSTANTS.VERSION;
    }

    /**
     * Check if a value is a valid week.
     * 
     * @param {*} value - Value to check
     * @returns {boolean} True if valid week
     */
    function isValidWeek(value) {
        var num = Number(value);
        return Number.isInteger(num) && num >= CALENDAR_CONSTANTS.MIN_WEEK && num <= CALENDAR_CONSTANTS.MAX_WEEK;
    }

    /**
     * Check if a value is a valid day.
     * 
     * @param {*} value - Value to check
     * @returns {boolean} True if valid day
     */
    function isValidDay(value) {
        var num = Number(value);
        return Number.isInteger(num) && num >= CALENDAR_CONSTANTS.MIN_DAY && num <= CALENDAR_CONSTANTS.MAX_DAY;
    }

    /**
     * Check if a value is a valid hour.
     * 
     * @param {*} value - Value to check
     * @returns {boolean} True if valid hour
     */
    function isValidHour(value) {
        var num = Number(value);
        return Number.isInteger(num) && num >= CALENDAR_CONSTANTS.MIN_HOUR && num <= CALENDAR_CONSTANTS.MAX_HOUR;
    }

    /**
     * Check if a value is a valid year.
     * 
     * @param {*} value - Value to check
     * @returns {boolean} True if valid year
     */
    function isValidYear(value) {
        var num = Number(value);
        return Number.isInteger(num) && num >= CALENDAR_CONSTANTS.MIN_YEAR && num <= CALENDAR_CONSTANTS.MAX_YEAR;
    }

    /**
     * Get all ID prefixes.
     * 
     * @returns {object} ID prefix map
     */
    function getPrefixes() {
        return ID_CONSTANTS.PREFIXES;
    }

    /**
     * Get a specific ID prefix.
     * 
     * @param {string} type - Entity type
     * @returns {string} ID prefix
     */
    function getPrefix(type) {
        return ID_CONSTANTS.PREFIXES[type] || 'id';
    }

    /**
     * Check if the application is on a mobile device.
     * 
     * @returns {boolean} True if mobile
     */
    function isMobile() {
        return window.innerWidth <= UI_CONSTANTS.MOBILE_BREAKPOINT;
    }

    /**
     * Check if the application is on a tablet.
     * 
     * @returns {boolean} True if tablet
     */
    function isTablet() {
        return window.innerWidth > UI_CONSTANTS.MOBILE_BREAKPOINT &&
               window.innerWidth <= UI_CONSTANTS.TABLET_BREAKPOINT;
    }

    /**
     * Check if the application is on desktop.
     * 
     * @returns {boolean} True if desktop
     */
    function isDesktop() {
        return window.innerWidth > UI_CONSTANTS.TABLET_BREAKPOINT;
    }

    // ============================================================
    // DEEP FREEZE ALL CONSTANTS
    // ============================================================

    deepFreeze(CALENDAR_CONSTANTS);
    deepFreeze(ID_CONSTANTS);
    deepFreeze(DATA_CONSTANTS);
    deepFreeze(UI_CONSTANTS);

    // ============================================================
    // EXPOSE - ONLY TRULY GLOBAL CONSTANTS
    // ============================================================

    window.CALENDAR_CONSTANTS = CALENDAR_CONSTANTS;
    window.ID_CONSTANTS = ID_CONSTANTS;
    window.DATA_CONSTANTS = DATA_CONSTANTS;
    window.UI_CONSTANTS = UI_CONSTANTS;

    // Helper functions
    window.getDataVersion = getDataVersion;
    window.isValidWeek = isValidWeek;
    window.isValidDay = isValidDay;
    window.isValidHour = isValidHour;
    window.isValidYear = isValidYear;
    window.getPrefixes = getPrefixes;
    window.getPrefix = getPrefix;
    window.isMobile = isMobile;
    window.isTablet = isTablet;
    window.isDesktop = isDesktop;

})();