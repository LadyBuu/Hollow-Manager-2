/**
 * modules/shared/team-constants.js - Team Constants
 * Single source of truth for all team-related constants.
 *
 * Path: js/modules/shared/team-constants.js
 *
 * Provides:
 *   - Team type definitions and lookup
 *   - Team status definitions and lookup
 *   - Team default values
 *   - Canonical period parsing
 *   - Period bounds per team type
 *   - Legacy type normalisation
 *
 * IMPORTANT:
 *   - This is the SINGLE SOURCE OF TRUTH for team constants.
 *   - Constants are DEEP FROZEN.
 *   - No DOM, no state, no persistence.
 *
 * YEAR SEMANTICS:
 *   Years are UNBOUNDED positive integers.
 *   Academic teams use bounded weeks (1-52) from CalendarConstants.
 *   Non-academic teams use unbounded years: { min: 1, max: Infinity }.
 *
 * PERIOD PARSING:
 *   parsePeriod(value) is the canonical parser. It accepts integers
 *   and pure digit strings, rejects everything else, and returns null
 *   on failure. It never coerces.
 *
 *   The blank sentinel ('', null, undefined) is NOT a period. It
 *   means "unbounded on this side." isValidPeriod accepts the blank
 *   sentinel as valid; parsePeriod does not.
 *
 * CALENDAR BOUNDS:
 *   CalendarConstants is a LAZY dependency. When absent, any
 *   operation that needs week bounds throws. There is no silent
 *   fallback.
 *
 * DEPENDENCIES:
 *   - window.CalendarConstants (lazy)
 */

(function() {
    'use strict';

    if (window.__teamConstantsLoaded) {
        return;
    }
    window.__teamConstantsLoaded = true;

    // ============================================================
    // LAZY DEPENDENCY
    // ============================================================

    function getCalendarConstants() {
        return window.CalendarConstants || null;
    }

    /**
     * Get the calendar's week bounds.
     *
     * Reads CalendarConstants on every call. No cache — a cache
     * would freeze whichever value was current at first read,
     * including a fallback.
     *
     * Throws when CalendarConstants is missing or malformed. This is
     * a load-order bug that must surface, not a degraded state.
     *
     * @returns {{ MIN_WEEK: number, MAX_WEEK: number }}
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
    // DEEP FREEZE
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
            description: 'Academic teams, scoped to class weeks 1-52'
        },
        {
            id: 'professional',
            label: 'Professional',
            periodLabel: 'Year',
            isAcademic: false,
            description: 'Professional working teams, scoped to years'
        },
        {
            id: 'temporary',
            label: 'Temporary',
            periodLabel: 'Year',
            isAcademic: false,
            description: 'Temporary or project-based teams, scoped to years'
        },
        {
            id: 'civilian',
            label: 'Civilian',
            periodLabel: 'Year',
            isAcademic: false,
            description: 'Civilian or non-combatant teams, scoped to years'
        }
    ];

    /**
     * Legacy type mappings, applied before any lookup.
     *
     * 'internship' was a persisted value in early builds. It maps to
     * 'professional'. Every public lookup normalises through this
     * map; it is not consulted by isValidTeamType alone.
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
            description: 'Temporarily inactive team; can be reactivated'
        },
        {
            id: 'deprecated',
            label: 'Deprecated',
            description: 'Retired team; excluded from operational queries'
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

    var _statusMap = Object.create(null);
    TEAM_STATUSES.forEach(function(status) {
        _statusMap[status.id] = status;
    });

    var VALID_TYPE_IDS = TEAM_TYPES.map(function(t) { return t.id; });
    var VALID_STATUS_IDS = TEAM_STATUSES.map(function(s) { return s.id; });

    // ============================================================
    // TYPE NORMALISATION
    // ============================================================

    /**
     * Normalise a type ID to its canonical form.
     *
     * Accepts canonical IDs, legacy IDs, and any casing or surrounding
     * whitespace. Returns null for anything else.
     *
     * This is the single entry point for type resolution. Every
     * public lookup goes through it.
     *
     * @param {string} typeId
     * @returns {string|null}
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
        return TEAM_TYPES.slice();
    }

    function getTeamType(typeId) {
        var normalized = normalizeTeamType(typeId);
        return normalized === null ? null : (_typeMap[normalized] || null);
    }

    function getTypeLabel(typeId) {
        var type = getTeamType(typeId);
        return type ? type.label : 'Unknown';
    }

    function getPeriodLabel(typeId) {
        var type = getTeamType(typeId);
        return type ? type.periodLabel : 'Unknown';
    }

    function isAcademicType(typeId) {
        var type = getTeamType(typeId);
        return type ? type.isAcademic === true : false;
    }

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
    // PERIOD PARSING
    // ============================================================

    /**
     * Parse a period value.
     *
     * ACCEPTS:
     *   - positive integers (1, 2, 42)
     *   - integer strings ('1', '42', '  7  ')
     *
     * REJECTS:
     *   - floats, zero, negatives
     *   - strings with trailing characters ('12abc')
     *   - empty strings, whitespace-only strings, null, undefined
     *   - NaN, Infinity, non-safe integers
     *   - non-string, non-number types
     *
     * Returns a positive integer or null. Never coerces.
     *
     * Blank input returns null. Blank is the "unbounded" sentinel,
     * not a period; test it with isUnboundedPeriod.
     *
     * @param {*} value
     * @returns {number|null}
     */
    function parsePeriod(value) {
        if (value === undefined || value === null) {
            return null;
        }

        if (typeof value === 'number') {
            if (!Number.isInteger(value) || value < 1) {
                return null;
            }
            return value;
        }

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

        return null;
    }

    /**
     * Is this value the "unbounded on this side" sentinel?
     *
     * The sentinel is '', null, or undefined. It means "no bound on
     * this side of the range" and is not a period.
     *
     * Whitespace-only strings are NOT the sentinel. They are malformed.
     *
     * @param {*} value
     * @returns {boolean}
     */
    function isUnboundedPeriod(value) {
        return value === undefined || value === null || value === '';
    }

    // ============================================================
    // PERIOD RANGE
    // ============================================================

    /**
     * Get the period range for a team type.
     *
     * ACADEMIC: bounded weeks from CalendarConstants.
     * NON-ACADEMIC: unbounded years, { min: 1, max: Infinity }.
     *
     * Returns null for an invalid type. Does not fabricate a default.
     *
     * `max: Infinity` is deliberate: it keeps `period > range.max`
     * stable for callers.
     *
     * @param {string} typeId
     * @returns {{ min: number, max: number, label: string }|null}
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

    function getPeriodBounds(typeId) {
        var range = getPeriodRange(typeId);
        if (!range) {
            return null;
        }
        return { min: range.min, max: range.max };
    }

    /**
     * Is a period valid for a team type?
     *
     * ACCEPTS:
     *   - the blank sentinel ('', null, undefined) for any valid type
     *   - a real integer (or integer string) inside the type's range
     *
     * REJECTS:
     *   - floats, negatives, zero, garbage strings
     *   - out-of-range integers
     *   - whitespace-only strings (malformed, not blank)
     *   - invalid team type IDs
     *
     * WHY BLANK IS VALID: TeamCore writes '' to endPeriod to mean
     * "ongoing." Rejecting blank would make validating a freshly
     * created open-ended team fail.
     *
     * @param {*} period
     * @param {string} typeId
     * @returns {boolean}
     */
    function isValidPeriod(period, typeId) {
        if (isUnboundedPeriod(period)) {
            return normalizeTeamType(typeId) !== null;
        }

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
     * Validate the constants definitions. Runs at load time.
     *
     * Checks structural invariants only. Does not touch
     * CalendarConstants — that would force the lazy dependency to
     * resolve at load, which is exactly what we're avoiding.
     *
     * Throws on failure. Malformed constants are a load-order bug,
     * not a warning.
     */
    function validateConstants() {
        var errors = [];

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
                errors.push('Type "' + type.id + '" missing isAcademic.');
            }
            if (type.isAcademic === true && type.periodLabel !== 'Week') {
                errors.push('Academic type "' + type.id +
                    '" must have periodLabel "Week".');
            }
            if (type.isAcademic === false && type.periodLabel !== 'Year') {
                errors.push('Non-academic type "' + type.id +
                    '" must have periodLabel "Year".');
            }
        });

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

        Object.keys(LEGACY_TYPE_MAP).forEach(function(key) {
            var target = LEGACY_TYPE_MAP[key];
            if (!_typeMap[target]) {
                errors.push('LEGACY_TYPE_MAP["' + key +
                    '"] points to unknown type "' + target + '".');
            }
        });

        if (!_typeMap[DEFAULT_TEAM_TYPE]) {
            errors.push('DEFAULT_TEAM_TYPE "' + DEFAULT_TEAM_TYPE +
                '" is not a valid type.');
        }
        if (!_statusMap[DEFAULT_TEAM_STATUS]) {
            errors.push('DEFAULT_TEAM_STATUS "' + DEFAULT_TEAM_STATUS +
                '" is not a valid status.');
        }
        if (typeof DEFAULT_ROLE !== 'string' || DEFAULT_ROLE.trim() === '') {
            errors.push('DEFAULT_ROLE must be a non-empty string.');
        }

        if (errors.length > 0) {
            throw new Error(
                '[TeamConstants] Validation failed:\n  ' +
                errors.join('\n  ')
            );
        }
    }

    validateConstants();

    // ============================================================
    // FREEZE
    // ============================================================

    deepFreeze(TEAM_TYPES);
    deepFreeze(TEAM_STATUSES);
    deepFreeze(LEGACY_TYPE_MAP);
    deepFreeze(_typeMap);
    deepFreeze(_statusMap);
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

        // Bounds — resolved at call time, throws if unavailable,
        // no caching.
        get MIN_WEEK() { return getWeekBounds().MIN_WEEK; },
        get MAX_WEEK() { return getWeekBounds().MAX_WEEK; },

        // Type lookup
        getTeamTypes: getTeamTypes,
        getTeamType: getTeamType,
        getTypeLabel: getTypeLabel,
        getPeriodLabel: getPeriodLabel,
        isAcademicType: isAcademicType,
        isValidTeamType: isValidTeamType,
        normalizeTeamType: normalizeTeamType,
        getValidTypeIds: getValidTypeIds,
        getDefaultType: getDefaultType,

        // Status lookup
        getTeamStatuses: getTeamStatuses,
        getTeamStatus: getTeamStatus,
        getStatusLabel: getStatusLabel,
        isValidTeamStatus: isValidTeamStatus,
        getValidStatusIds: getValidStatusIds,
        getDefaultStatus: getDefaultStatus,

        // Role
        getDefaultRole: getDefaultRole,

        // Period
        parsePeriod: parsePeriod,
        isUnboundedPeriod: isUnboundedPeriod,
        getPeriodRange: getPeriodRange,
        getPeriodBounds: getPeriodBounds,
        isValidPeriod: isValidPeriod,

        // Diagnostics
        validateConstants: validateConstants
    });

})();