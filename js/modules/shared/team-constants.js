/**
 * modules/shared/team-constants.js - Team Constants
 * Single source of truth for all team-related constants.
 *
 * Path: js/modules/shared/team-constants.js
 *
 * This module provides:
 *   - Team type definitions and validation
 *   - Team status definitions and validation
 *   - Team default values
 *   - Canonical period parsing (parsePeriod)
 *   - Period bounds per team type
 *   - Legacy type normalisation (internship -> professional)
 *
 * IMPORTANT:
 *   - This is the SINGLE SOURCE OF TRUTH for team constants.
 *   - All modules MUST use these constants.
 *   - Constants are DEEP FROZEN.
 *   - No DOM, no state, no persistence - pure constants.
 *
 * YEAR SEMANTICS:
 *   - Years are UNBOUNDED positive integers.
 *   - There is no MIN_YEAR or MAX_YEAR.
 *   - Academic teams use bounded weeks (1-52), sourced from
 *     CalendarConstants.
 *   - Non-academic teams use unbounded years: { min: 1, max: Infinity }.
 *
 * PERIOD PARSING:
 *   parsePeriod(value) is the canonical period parser. It:
 *     - accepts integers, integer strings, and objects that stringify
 *       to an integer string
 *     - rejects floats, signed values, whitespace-padded garbage, and
 *       anything with trailing characters
 *     - returns null on failure, never a coerced value
 *     - returns an integer >= 1
 *
 *   isValidPeriod(value, typeId) composes parsePeriod with per-type
 *   bounds from getPeriodRange(). It returns false for invalid types.
 *
 *   Callers MUST use parsePeriod for all period input. Do not use
 *   parseInt in this module or in any consumer.
 *
 * CALENDAR BOUNDS:
 *   CalendarConstants is a LAZY dependency. This module can load
 *   before it. When CalendarConstants is absent, any operation that
 *   needs week bounds THROWS. There is no silent fallback to 1-52.
 *
 *   The MIN_WEEK and MAX_WEEK getters resolve CalendarConstants on
 *   each access. There is no cache. Caching would freeze whichever
 *   value was current at first read, including a fallback.
 *
 * ENUM OWNERSHIP:
 *   - Team types and statuses are owned here.
 *   - Character status semantics (student/instructor/etc.) are owned
 *     by CharacterConstants. Do not import them here.
 *   - Team-entity-specific period semantics (academic = weeks,
 *     others = years) are owned here.
 *
 * DEPENDENCIES:
 *   - window.CalendarConstants (lazy) - mandatory at use time,
 *     optional at load time
 *
 * USAGE:
 *   var TC = window.TeamConstants;
 *   var types = TC.getTeamTypes();
 *   var isValid = TC.isValidTeamType('professional');
 *   var period = TC.parsePeriod('12');
 *   var inBounds = TC.isValidPeriod(period, 'professional');
 */

(function() {
    'use strict';

    if (window.__teamConstantsLoaded) {
        return;
    }
    window.__teamConstantsLoaded = true;

    // ============================================================
    // LAZY DEPENDENCY ACCESS
    // ============================================================

    function getCalendarConstants() {
        return window.CalendarConstants || null;
    }

    /**
     * Get the calendar's week bounds.
     *
     * LAZY: reads CalendarConstants on every call. There is no cache.
     *
     * STRICT: throws when CalendarConstants is missing or malformed.
     * This is the difference between "the dependency hasn't loaded
     * yet" (a bug that should surface) and "there is no dependency"
     * (a bug we could paper over with a fallback).
     *
     * @returns {object} { MIN_WEEK: number, MAX_WEEK: number }
     */
    function getWeekBounds() {
        var CC = getCalendarConstants();

        if (!CC ||
            typeof CC.MIN_WEEK !== 'number' ||
            typeof CC.MAX_WEEK !== 'number' ||
            !isFinite(CC.MIN_WEEK) ||
            !isFinite(CC.MAX_WEEK) ||
            CC.MIN_WEEK < 1 ||
            CC.MAX_WEEK < CC.MIN_WEEK) {
            throw new Error(
                '[TeamConstants] CalendarConstants with valid week bounds is required. ' +
                'Ensure CalendarConstants is loaded before any period operation runs.'
            );
        }

        return {
            MIN_WEEK: CC.MIN_WEEK,
            MAX_WEEK: CC.MAX_WEEK
        };
    }

    // ============================================================
    // DEEP FREEZE UTILITY
    // ============================================================

    function deepFreeze(obj) {
        if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) {
            return obj;
        }

        var keys = Object.getOwnPropertyNames(obj);
        for (var i = 0; i < keys.length; i++) {
            var value = obj[keys[i]];
            if (value && typeof value === 'object') {
                deepFreeze(value);
            }
        }

        return Object.freeze(obj);
    }

    // ============================================================
    // TEAM TYPES
    // ============================================================

    var TEAM_TYPES = [
        {
            id: 'academic',
            label: 'Academic',
            periodLabel: 'Week',
            isAcademic: true,
            description: 'Academic/educational teams (weeks 1-52)'
        },
        {
            id: 'professional',
            label: 'Professional',
            periodLabel: 'Year',
            isAcademic: false,
            description: 'Professional/working teams (year is any positive integer)'
        },
        {
            id: 'temporary',
            label: 'Temporary',
            periodLabel: 'Year',
            isAcademic: false,
            description: 'Temporary or project-based teams (year is any positive integer)'
        },
        {
            id: 'civilian',
            label: 'Civilian',
            periodLabel: 'Year',
            isAcademic: false,
            description: 'Civilian/non-combatant teams (year is any positive integer)'
        }
    ];

    /**
     * Legacy type mappings. Applied before any lookup.
     *
     * 'internship' is a legacy persisted value that maps to
     * 'professional'. It must be normalised consistently across every
     * public lookup, not just isValidTeamType.
     */
    var LEGACY_TYPE_MAP = Object.freeze({
        'internship': 'professional'
    });

    // ============================================================
    // TEAM STATUSES
    // ============================================================

    var TEAM_STATUSES = [
        {
            id: 'active',
            label: 'Active',
            description: 'Currently active team'
        },
        {
            id: 'inactive',
            label: 'Inactive',
            description: 'Temporarily inactive team'
        },
        {
            id: 'deprecated',
            label: 'Deprecated',
            description: 'Legacy team, no longer in use'
        }
    ];

    // ============================================================
    // DEFAULTS
    // ============================================================

    var DEFAULT_TEAM_TYPE = 'professional';
    var DEFAULT_TEAM_STATUS = 'active';
    var DEFAULT_ROLE = 'Member';

    // ============================================================
    // DERIVED LOOKUP MAPS
    // ============================================================

    var _typeMap = Object.create(null);
    TEAM_TYPES.forEach(function(type) {
        _typeMap[type.id] = type;
    });

    var VALID_TYPE_IDS = TEAM_TYPES.map(function(type) { return type.id; });
    var VALID_STATUS_IDS = TEAM_STATUSES.map(function(status) { return status.id; });

    var _statusMap = Object.create(null);
    TEAM_STATUSES.forEach(function(status) {
        _statusMap[status.id] = status;
    });

    // ============================================================
    // TYPE NORMALISATION
    // ============================================================

    /**
     * Normalise a type ID to its canonical form.
     *
     * Accepts 'professional', 'internship' (legacy), 'PROFESSIONAL',
     * '  professional  '. Returns null for anything else.
     *
     * This is the single entry point for type resolution. Every other
     * public lookup goes through this.
     *
     * @param {string} typeId
     * @returns {string|null} canonical type ID or null
     */
    function normalizeTeamType(typeId) {
        if (typeof typeId !== 'string') {
            return null;
        }
        var normalized = typeId.toLowerCase().trim();
        if (normalized === '') {
            return null;
        }
        if (LEGACY_TYPE_MAP[normalized]) {
            return LEGACY_TYPE_MAP[normalized];
        }
        return _typeMap[normalized] ? normalized : null;
    }

    // ============================================================
    // TYPE LOOKUPS
    // ============================================================

    function getTeamTypes() {
        // TEAM_TYPES is deep-frozen; a shallow slice is sufficient.
        return TEAM_TYPES.slice();
    }

    /**
     * Get a team type definition by ID. Legacy IDs are normalised.
     *
     * @param {string} typeId
     * @returns {object|null}
     */
    function getTeamType(typeId) {
        var normalized = normalizeTeamType(typeId);
        if (normalized === null) {
            return null;
        }
        return _typeMap[normalized] || null;
    }

    /**
     * Get the display label for a team type. Legacy IDs are normalised.
     *
     * @param {string} typeId
     * @returns {string} label or 'Unknown' if the type is invalid
     */
    function getTypeLabel(typeId) {
        var type = getTeamType(typeId);
        return type ? type.label : 'Unknown';
    }

    /**
     * Get the period label (Week / Year) for a team type. Legacy IDs
     * are normalised.
     *
     * @param {string} typeId
     * @returns {string} 'Week', 'Year', or 'Unknown'
     */
    function getPeriodLabel(typeId) {
        var type = getTeamType(typeId);
        return type ? type.periodLabel : 'Unknown';
    }

    /**
     * Is the type academic? Legacy IDs are normalised.
     *
     * @param {string} typeId
     * @returns {boolean}
     */
    function isAcademicType(typeId) {
        var type = getTeamType(typeId);
        return type ? type.isAcademic === true : false;
    }

    /**
     * Is this a valid team type? Accepts legacy IDs.
     *
     * @param {string} typeId
     * @returns {boolean}
     */
    function isValidTeamType(typeId) {
        return normalizeTeamType(typeId) !== null;
    }

    function getValidTypeIds() {
        return VALID_TYPE_IDS.slice();
    }

    function getDefaultType() {
        return DEFAULT_TEAM_TYPE;
    }

    // ============================================================
    // STATUS LOOKUPS
    // ============================================================

    function getTeamStatuses() {
        return TEAM_STATUSES.slice();
    }

    function getTeamStatus(statusId) {
        if (typeof statusId !== 'string') {
            return null;
        }
        var normalized = statusId.toLowerCase().trim();
        return _statusMap[normalized] || null;
    }

    function getStatusLabel(statusId) {
        var status = getTeamStatus(statusId);
        return status ? status.label : 'Unknown';
    }

    function isValidTeamStatus(statusId) {
        if (typeof statusId !== 'string') {
            return false;
        }
        return _statusMap[statusId.toLowerCase().trim()] !== undefined;
    }

    function getValidStatusIds() {
        return VALID_STATUS_IDS.slice();
    }

    function getDefaultStatus() {
        return DEFAULT_TEAM_STATUS;
    }

    function getDefaultRole() {
        return DEFAULT_ROLE;
    }

    // ============================================================
    // PERIOD PARSING - CANONICAL
    // ============================================================

    /**
     * Parse a period value.
     *
     * ACCEPTS:
     *   - positive integers (1, 2, 42)
     *   - integer strings ('1', '42', '  7  ')
     *   - objects whose toString is an integer string ('1'.toString)
     *
     * REJECTS:
     *   - floats (1.5, '1.5')
     *   - zero and negative numbers
     *   - strings with trailing characters ('12abc', '12 ')
     *   - empty strings, null, undefined, NaN, Infinity
     *   - non-safe integers
     *
     * Returns a positive integer or null. Never coerces silently.
     *
     * @param {*} value
     * @returns {number|null}
     */
    function parsePeriod(value) {
        if (value === undefined || value === null) {
            return null;
        }

        // Numbers: must be integer, >= 1, finite.
        if (typeof value === 'number') {
            if (!Number.isInteger(value) || value < 1) {
                return null;
            }
            return value;
        }

        // Strings: strict integer-string match, no trailing characters.
        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '' || !/^\d+$/.test(trimmed)) {
                return null;
            }
            var parsed = Number(trimmed);
            if (!Number.isSafeInteger(parsed) || parsed < 1) {
                return null;
            }
            return parsed;
        }

        // Other types: reject. Do not stringify objects implicitly;
        // callers must pass a number or a string.
        return null;
    }

    // ============================================================
    // PERIOD RANGE - PER TYPE
    // ============================================================

    /**
     * Get the period range for a team type.
     *
     * ACADEMIC: bounded weeks from CalendarConstants.
     * NON-ACADEMIC: unbounded years, { min: 1, max: Infinity }.
     *
     * Returns null for an invalid type ID. Does not fabricate a
     * default range for unknown types.
     *
     * The `max: Infinity` value is deliberate: it keeps the return
     * shape stable for callers that do `period > range.max`.
     *
     * @param {string} typeId
     * @returns {object|null} { min, max, label } or null
     */
    function getPeriodRange(typeId) {
        var normalized = normalizeTeamType(typeId);
        if (normalized === null) {
            return null;
        }

        var type = _typeMap[normalized];
        if (!type) {
            return null;
        }

        if (type.isAcademic) {
            var bounds = getWeekBounds();
            return {
                min: bounds.MIN_WEEK,
                max: bounds.MAX_WEEK,
                label: 'Week'
            };
        }

        return {
            min: 1,
            max: Infinity,
            label: 'Year'
        };
    }

    /**
     * Get the period bounds for a team type, without the label.
     * Returns null for an invalid type ID.
     *
     * @param {string} typeId
     * @returns {object|null} { min, max } or null
     */
    function getPeriodBounds(typeId) {
        var range = getPeriodRange(typeId);
        if (!range) {
            return null;
        }
        return {
            min: range.min,
            max: range.max
        };
    }

    /**
     * Is a period valid for a team type?
     *
     * Uses parsePeriod for the numeric check and getPeriodRange for
     * the per-type bounds check. Returns false for invalid types.
     *
     * @param {*} period
     * @param {string} typeId
     * @returns {boolean}
     */
    function isValidPeriod(period, typeId) {
        var num = parsePeriod(period);
        if (num === null) {
            return false;
        }

        var range = getPeriodRange(typeId);
        if (range === null) {
            return false;
        }

        return num >= range.min && num <= range.max;
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    /**
     * Validate the constants definitions.
     *
     * Runs at load time. Checks structural invariants only. Does NOT
     * touch CalendarConstants — that would force the lazy dependency
     * to resolve at load, which is exactly what we are avoiding.
     *
     * @returns {boolean}
     */
    function validateConstants() {
        var errors = [];

        // ---- Types ----
        if (!Array.isArray(TEAM_TYPES) || TEAM_TYPES.length === 0) {
            errors.push('TEAM_TYPES must be a non-empty array.');
        }

        var seenTypeIds = Object.create(null);
        TEAM_TYPES.forEach(function(type, index) {
            if (!type.id || typeof type.id !== 'string') {
                errors.push('Type at index ' + index + ' missing id.');
                return;
            }
            if (seenTypeIds[type.id]) {
                errors.push('Duplicate type id "' + type.id + '".');
            }
            seenTypeIds[type.id] = true;

            if (!type.label || typeof type.label !== 'string') {
                errors.push('Type "' + type.id + '" missing label.');
            }
            if (typeof type.isAcademic !== 'boolean') {
                errors.push('Type "' + type.id + '" missing isAcademic (boolean).');
            }

            // periodLabel must agree with isAcademic.
            if (type.isAcademic === true && type.periodLabel !== 'Week') {
                errors.push('Academic type "' + type.id + '" must have periodLabel "Week".');
            }
            if (type.isAcademic === false && type.periodLabel !== 'Year') {
                errors.push('Non-academic type "' + type.id + '" must have periodLabel "Year".');
            }

            // Exactly one academic type.
            // (Not enforced here; if more than one academic type is
            // added, the invariant changes deliberately.)
        });

        // ---- Statuses ----
        if (!Array.isArray(TEAM_STATUSES) || TEAM_STATUSES.length === 0) {
            errors.push('TEAM_STATUSES must be a non-empty array.');
        }

        var seenStatusIds = Object.create(null);
        TEAM_STATUSES.forEach(function(status, index) {
            if (!status.id || typeof status.id !== 'string') {
                errors.push('Status at index ' + index + ' missing id.');
                return;
            }
            if (seenStatusIds[status.id]) {
                errors.push('Duplicate status id "' + status.id + '".');
            }
            seenStatusIds[status.id] = true;

            if (!status.label || typeof status.label !== 'string') {
                errors.push('Status "' + status.id + '" missing label.');
            }
        });

        // ---- Legacy map ----
        Object.keys(LEGACY_TYPE_MAP).forEach(function(key) {
            var target = LEGACY_TYPE_MAP[key];
            if (!_typeMap[target]) {
                errors.push('LEGACY_TYPE_MAP["' + key + '"] points to unknown type "' + target + '".');
            }
        });

        // ---- Defaults ----
        if (!_typeMap[DEFAULT_TEAM_TYPE]) {
            errors.push('DEFAULT_TEAM_TYPE "' + DEFAULT_TEAM_TYPE + '" is not a valid type.');
        }
        if (!_statusMap[DEFAULT_TEAM_STATUS]) {
            errors.push('DEFAULT_TEAM_STATUS "' + DEFAULT_TEAM_STATUS + '" is not a valid status.');
        }
        if (typeof DEFAULT_ROLE !== 'string' || DEFAULT_ROLE.trim() === '') {
            errors.push('DEFAULT_ROLE must be a non-empty string.');
        }

        if (errors.length > 0) {
            console.warn('[TeamConstants] Validation errors:', errors);
        }

        return errors.length === 0;
    }

    validateConstants();

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    /**
     * Check the state of the lazy CalendarConstants dependency.
     *
     * Logs a warning if CalendarConstants is not yet loaded. Does not
     * throw. Does not force evaluation. Does not cache anything.
     *
     * Callers that want a strict check call getWeekBounds(), which
     * throws when CalendarConstants is missing.
     *
     * @returns {boolean}
     */
    function checkDependencies() {
        var CC = getCalendarConstants();
        if (!CC) {
            console.warn(
                '[TeamConstants] CalendarConstants not yet loaded. ' +
                'Week-based operations will throw until it is.'
            );
            return false;
        }
        if (typeof CC.MIN_WEEK !== 'number' || typeof CC.MAX_WEEK !== 'number') {
            console.warn(
                '[TeamConstants] CalendarConstants is loaded but missing MIN_WEEK or MAX_WEEK.'
            );
            return false;
        }
        return true;
    }

    checkDependencies();

    // ============================================================
    // DEEP FREEZE
    // ============================================================

    deepFreeze(TEAM_TYPES);
    deepFreeze(TEAM_STATUSES);
    deepFreeze(_typeMap);
    deepFreeze(_statusMap);
    deepFreeze(LEGACY_TYPE_MAP);
    deepFreeze(VALID_TYPE_IDS);
    deepFreeze(VALID_STATUS_IDS);

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamConstants = Object.freeze({
        // Raw definitions (read-only)
        TEAM_TYPES: TEAM_TYPES,
        TEAM_STATUSES: TEAM_STATUSES,
        LEGACY_TYPE_MAP: LEGACY_TYPE_MAP,

        // Defaults
        DEFAULT_TEAM_TYPE: DEFAULT_TEAM_TYPE,
        DEFAULT_TEAM_STATUS: DEFAULT_TEAM_STATUS,
        DEFAULT_ROLE: DEFAULT_ROLE,

        // Bounds: resolved at call time. Throws if CalendarConstants
        // is unavailable. No caching.
        get MIN_WEEK() {
            return getWeekBounds().MIN_WEEK;
        },
        get MAX_WEEK() {
            return getWeekBounds().MAX_WEEK;
        },

        // ---- Type lookup ----
        getTeamTypes: getTeamTypes,
        getTeamType: getTeamType,
        getTypeLabel: getTypeLabel,
        getPeriodLabel: getPeriodLabel,
        isAcademicType: isAcademicType,
        isValidTeamType: isValidTeamType,
        normalizeTeamType: normalizeTeamType,
        getValidTypeIds: getValidTypeIds,
        getDefaultType: getDefaultType,

        // ---- Status lookup ----
        getTeamStatuses: getTeamStatuses,
        getTeamStatus: getTeamStatus,
        getStatusLabel: getStatusLabel,
        isValidTeamStatus: isValidTeamStatus,
        getValidStatusIds: getValidStatusIds,
        getDefaultStatus: getDefaultStatus,

        // ---- Role ----
        getDefaultRole: getDefaultRole,

        // ---- Period parsing (canonical) ----
        parsePeriod: parsePeriod,

        // ---- Period range and validation ----
        getPeriodRange: getPeriodRange,
        getPeriodBounds: getPeriodBounds,
        isValidPeriod: isValidPeriod,

        // ---- Diagnostics ----
        checkDependencies: checkDependencies,
        validateConstants: validateConstants
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TeamConstants;
        var missing = [];

        var required = [
            'getTeamTypes', 'getTeamType', 'getTypeLabel', 'getPeriodLabel',
            'isAcademicType', 'isValidTeamType', 'normalizeTeamType',
            'getValidTypeIds', 'getDefaultType',
            'getTeamStatuses', 'getTeamStatus', 'getStatusLabel',
            'isValidTeamStatus', 'getValidStatusIds', 'getDefaultStatus',
            'getDefaultRole',
            'parsePeriod',
            'getPeriodRange', 'getPeriodBounds', 'isValidPeriod'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[TeamConstants] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();
