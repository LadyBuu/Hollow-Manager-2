/**
 * shared/constants/constants.js - Shared Constants Module
 * Single source of truth for truly global application constants
 * 
 * IMPORTANT:
 *   - This module contains ONLY truly global constants
 *   - Domain-specific constants are in their own files
 *   - All constants are READ-ONLY - do not modify at runtime
 *   - Constants are DEEP FROZEN to prevent mutation
 * 
 * DEPENDENCIES:
 *   - None (self-contained)
 */

(function() {
    'use strict';

    if (window.__constantsLoaded) { return; }
    window.__constantsLoaded = true;

    function deepFreeze(obj) {
        if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) { return obj; }
        var keys = Object.getOwnPropertyNames(obj);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var value = obj[key];
            if (value && typeof value === 'object') { deepFreeze(value); }
        }
        return Object.freeze(obj);
    }

    // ============================================================
    // ID PREFIX CONSTANTS
    // ============================================================

    var ID_PREFIXES = {
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
    };

    // ============================================================
    // DATA VERSION CONSTANTS
    // ============================================================

    var DATA_VERSION = 13;
    var MIN_SUPPORTED_VERSION = 1;
    var MAX_WARNINGS = 50;

    // ============================================================
    // UI CONSTANTS
    // ============================================================

    var MOBILE_BREAKPOINT = 768;
    var TABLET_BREAKPOINT = 1024;
    var DEBOUNCE_DELAY = 300;

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    function getDataVersion() { return DATA_VERSION; }
    function getPrefix(type) { return ID_PREFIXES[type] || 'id'; }
    function getPrefixes() { return Object.assign({}, ID_PREFIXES); }

    function isMobile() { return window.innerWidth <= MOBILE_BREAKPOINT; }
    function isTablet() { return window.innerWidth > MOBILE_BREAKPOINT && window.innerWidth <= TABLET_BREAKPOINT; }
    function isDesktop() { return window.innerWidth > TABLET_BREAKPOINT; }

    deepFreeze(ID_PREFIXES);

    window.ID_CONSTANTS = Object.freeze({ PREFIXES: ID_PREFIXES });
    window.DATA_CONSTANTS = Object.freeze({
        VERSION: DATA_VERSION,
        MIN_SUPPORTED_VERSION: MIN_SUPPORTED_VERSION,
        MAX_WARNINGS: MAX_WARNINGS
    });
    window.UI_CONSTANTS = Object.freeze({
        MOBILE_BREAKPOINT: MOBILE_BREAKPOINT,
        TABLET_BREAKPOINT: TABLET_BREAKPOINT,
        DEBOUNCE_DELAY: DEBOUNCE_DELAY
    });

    window.getDataVersion = getDataVersion;
    window.getPrefix = getPrefix;
    window.getPrefixes = getPrefixes;
    window.isMobile = isMobile;
    window.isTablet = isTablet;
    window.isDesktop = isDesktop;

})();