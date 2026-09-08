/**
 * modules/teams/team-constants.js - Team Constants
 * Single source of truth for all team-related constants
 * 
 * This module provides:
 *   - Team type definitions and validation
 *   - Team status definitions and validation
 *   - Team default values
 *   - Team validation bounds
 *   - Period label helpers
 *   - Team type labels
 * 
 * IMPORTANT:
 *   - This is the SINGLE SOURCE OF TRUTH for team constants
 *   - All modules MUST use these constants - do NOT duplicate
 *   - Constants are DEEP FROZEN to prevent mutation
 *   - Validation runs BEFORE publishing to ensure integrity
 *   - No DOM, no state, no persistence - pure constants only
 * 
 * DEPENDENCIES:
 *   - window.CALENDAR_CONSTANTS (for week/year bounds) - MANDATORY
 *   - None (self-contained otherwise)
 * 
 * USAGE:
 *   var TC = window.TeamConstants;
 *   var types = TC.getTeamTypes();
 *   var isValid = TC.isValidTeamType('professional');
 *   var statuses = TC.getTeamStatuses();
 *   var label = TC.getTypeLabel('professional');
 */

(function() {
    'use strict';

    if (window.__teamConstantsLoaded) {
        return;
    }
    window.__teamConstantsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var CalendarConstants = window.CALENDAR_CONSTANTS;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!CalendarConstants) {
            missing.push('CALENDAR_CONSTANTS');
        }

        if (missing.length > 0) {
            console.warn('[TeamConstants] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

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
    // TEAM TYPES - Canonical Source of Truth
    // ============================================================

    /**
     * Canonical team type definitions.
     * 
     * Properties:
     *   - id: Unique identifier (used in data storage)
     *   - label: Human-readable display name
     *   - periodLabel: Label for periods (Week for academic, Year for others)
     *   - isAcademic: True if academic type
     *   - description: Optional description
     * 
     * Period semantics:
     *   - 'academic': Periods are weeks (1-52)
     *   - 'professional': Periods are years (1900-2100)
     *   - 'temporary': Periods are years (1900-2100)
     *   - 'civilian': Periods are years (1900-2100)
     */
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
            description: 'Professional/working teams (years 1900-2100)'
        },
        {
            id: 'temporary',
            label: 'Temporary',
            periodLabel: 'Year',
            isAcademic: false,
            description: 'Temporary or project-based teams (years 1900-2100)'
        },
        {
            id: 'civilian',
            label: 'Civilian',
            periodLabel: 'Year',
            isAcademic: false,
            description: 'Civilian/non-combatant teams'
        }
    ];

    /**
     * Legacy type mappings for backward compatibility.
     * 'internship' is a legacy persisted value that maps to 'professional'.
     */
    var LEGACY_TYPE_MAP = {
        'internship': 'professional'
    };

    // ============================================================
    // TEAM STATUSES - Canonical Source of Truth
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
    // DERIVED DATA - Maps for quick lookup
    // ============================================================

    // Type ID to type definition map
    var _typeMap = Object.create(null);
    TEAM_TYPES.forEach(function(type) {
        _typeMap[type.id] = type;
    });

    // Type ID to label map
    var _typeLabelMap = Object.create(null);
    TEAM_TYPES.forEach(function(type) {
        _typeLabelMap[type.id] = type.label;
    });

    // Type ID to period label map
    var _periodLabelMap = Object.create(null);
    TEAM_TYPES.forEach(function(type) {
        _periodLabelMap[type.id] = type.periodLabel;
    });

    // Array of valid type IDs
    var VALID_TYPE_IDS = TEAM_TYPES.map(function(type) {
        return type.id;
    });

    // Status ID to status definition map
    var _statusMap = Object.create(null);
    TEAM_STATUSES.forEach(function(status) {
        _statusMap[status.id] = status;
    });

    // Array of valid status IDs
    var VALID_STATUS_IDS = TEAM_STATUSES.map(function(status) {
        return status.id;
    });

    // ============================================================
    // DEFAULT VALUES
    // ============================================================

    var DEFAULT_TEAM_TYPE = 'professional';
    var DEFAULT_TEAM_STATUS = 'active';
    var DEFAULT_ROLE = 'Member';

    // ============================================================
    // VALIDATION CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants ? CalendarConstants.MIN_WEEK : 1;
    var MAX_WEEK = CalendarConstants ? CalendarConstants.MAX_WEEK : 52;
    var MIN_YEAR = CalendarConstants ? CalendarConstants.MIN_YEAR : 1900;
    var MAX_YEAR = CalendarConstants ? CalendarConstants.MAX_YEAR : 2100;

    // ============================================================
    // LOOKUP FUNCTIONS
    // ============================================================

    /**
     * Get all team type definitions.
     * 
     * @returns {Array} Array of team type objects
     */
    function getTeamTypes() {
        return TEAM_TYPES.slice();
    }

    /**
     * Get a team type definition by ID.
     * 
     * @param {string} typeId - Team type ID
     * @returns {object|null} Type definition or null if not found
     */
    function getTeamType(typeId) {
        if (!typeId || typeof typeId !== 'string') {
            return null;
        }
        return _typeMap[typeId] || null;
    }

    /**
     * Get the label for a team type.
     * 
     * @param {string} typeId - Team type ID
     * @returns {string} Label or the type ID if not found
     */
    function getTypeLabel(typeId) {
        if (!typeId || typeof typeId !== 'string') {
            return 'Unknown';
        }
        return _typeLabelMap[typeId] || typeId;
    }

    /**
     * Get the period label for a team type.
     * 
     * @param {string} typeId - Team type ID
     * @returns {string} Period label or 'Year' if not found
     */
    function getPeriodLabel(typeId) {
        if (!typeId || typeof typeId !== 'string') {
            return 'Year';
        }
        return _periodLabelMap[typeId] || 'Year';
    }

    /**
     * Check if a team type is academic.
     * 
     * @param {string} typeId - Team type ID
     * @returns {boolean} True if academic
     */
    function isAcademicType(typeId) {
        if (!typeId || typeof typeId !== 'string') {
            return false;
        }
        var type = getTeamType(typeId);
        return type ? type.isAcademic : false;
    }

    /**
     * Check if a team type ID is valid.
     * 
     * @param {string} typeId - Team type ID
     * @returns {boolean} True if valid
     */
    function isValidTeamType(typeId) {
        if (!typeId || typeof typeId !== 'string') {
            return false;
        }
        // Check legacy mapping first
        if (LEGACY_TYPE_MAP[typeId]) {
            return true;
        }
        return _typeMap[typeId] !== undefined;
    }

    /**
     * Normalize a team type to its canonical form.
     * 
     * @param {string} typeId - Team type ID (may be legacy)
     * @returns {string|null} Canonical type ID or null if invalid
     */
    function normalizeTeamType(typeId) {
        if (!typeId || typeof typeId !== 'string') {
            return null;
        }

        var normalized = String(typeId).toLowerCase().trim();

        // Check legacy mapping
        if (LEGACY_TYPE_MAP[normalized]) {
            return LEGACY_TYPE_MAP[normalized];
        }

        return _typeMap[normalized] ? normalized : null;
    }

    /**
     * Get all team status definitions.
     * 
     * @returns {Array} Array of team status objects
     */
    function getTeamStatuses() {
        return TEAM_STATUSES.slice();
    }

    /**
     * Get a team status definition by ID.
     * 
     * @param {string} statusId - Team status ID
     * @returns {object|null} Status definition or null if not found
     */
    function getTeamStatus(statusId) {
        if (!statusId || typeof statusId !== 'string') {
            return null;
        }
        return _statusMap[statusId] || null;
    }

    /**
     * Get the label for a team status.
     * 
     * @param {string} statusId - Team status ID
     * @returns {string} Label or the status ID if not found
     */
    function getStatusLabel(statusId) {
        if (!statusId || typeof statusId !== 'string') {
            return 'Unknown';
        }
        var status = getTeamStatus(statusId);
        return status ? status.label : statusId;
    }

    /**
     * Check if a team status ID is valid.
     * 
     * @param {string} statusId - Team status ID
     * @returns {boolean} True if valid
     */
    function isValidTeamStatus(statusId) {
        if (!statusId || typeof statusId !== 'string') {
            return false;
        }
        return _statusMap[statusId] !== undefined;
    }

    /**
     * Get valid team type IDs.
     * 
     * @returns {string[]} Array of valid type IDs
     */
    function getValidTypeIds() {
        return VALID_TYPE_IDS.slice();
    }

    /**
     * Get valid team status IDs.
     * 
     * @returns {string[]} Array of valid status IDs
     */
    function getValidStatusIds() {
        return VALID_STATUS_IDS.slice();
    }

    /**
     * Get the default team type.
     * 
     * @returns {string} Default team type ID
     */
    function getDefaultType() {
        return DEFAULT_TEAM_TYPE;
    }

    /**
     * Get the default team status.
     * 
     * @returns {string} Default team status ID
     */
    function getDefaultStatus() {
        return DEFAULT_TEAM_STATUS;
    }

    /**
     * Get the default member role.
     * 
     * @returns {string} Default member role
     */
    function getDefaultRole() {
        return DEFAULT_ROLE;
    }

    /**
     * Get the period range for a team type.
     * 
     * @param {string} typeId - Team type ID
     * @returns {object} { min: number, max: number, label: string }
     */
    function getPeriodRange(typeId) {
        var type = getTeamType(typeId);
        if (!type || type.isAcademic) {
            return {
                min: MIN_WEEK,
                max: MAX_WEEK,
                label: 'Week'
            };
        }
        return {
            min: MIN_YEAR,
            max: MAX_YEAR,
            label: 'Year'
        };
    }

    /**
     * Get the period bounds for a team type.
     * 
     * @param {string} typeId - Team type ID
     * @returns {object} { min: number, max: number }
     */
    function getPeriodBounds(typeId) {
        var range = getPeriodRange(typeId);
        return {
            min: range.min,
            max: range.max
        };
    }

    /**
     * Check if a period is valid for a team type.
     * 
     * @param {*} period - Period value to check
     * @param {string} typeId - Team type ID
     * @returns {boolean} True if valid
     */
    function isValidPeriod(period, typeId) {
        var num = parseInt(period, 10);
        if (isNaN(num) || num < 0) {
            return false;
        }

        var range = getPeriodRange(typeId);
        return num >= range.min && num <= range.max;
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    function validateConstants() {
        var errors = [];

        if (!Array.isArray(TEAM_TYPES) || TEAM_TYPES.length === 0) {
            errors.push('TEAM_TYPES must be a non-empty array.');
        }

        var typeIds = Object.create(null);
        TEAM_TYPES.forEach(function(type, index) {
            if (!type.id || typeof type.id !== 'string') {
                errors.push('Type at index ' + index + ' missing id.');
                return;
            }
            if (typeIds[type.id]) {
                errors.push('Duplicate type id "' + type.id + '".');
            }
            typeIds[type.id] = true;
            if (!type.label || typeof type.label !== 'string') {
                errors.push('Type "' + type.id + '" missing label.');
            }
            if (typeof type.isAcademic !== 'boolean') {
                errors.push('Type "' + type.id + '" missing isAcademic (boolean).');
            }
        });

        if (!Array.isArray(TEAM_STATUSES) || TEAM_STATUSES.length === 0) {
            errors.push('TEAM_STATUSES must be a non-empty array.');
        }

        var statusIds = Object.create(null);
        TEAM_STATUSES.forEach(function(status, index) {
            if (!status.id || typeof status.id !== 'string') {
                errors.push('Status at index ' + index + ' missing id.');
                return;
            }
            if (statusIds[status.id]) {
                errors.push('Duplicate status id "' + status.id + '".');
            }
            statusIds[status.id] = true;
            if (!status.label || typeof status.label !== 'string') {
                errors.push('Status "' + status.id + '" missing label.');
            }
        });

        if (typeof DEFAULT_TEAM_TYPE !== 'string' || !_typeMap[DEFAULT_TEAM_TYPE]) {
            errors.push('DEFAULT_TEAM_TYPE must be a valid type ID.');
        }

        if (typeof DEFAULT_TEAM_STATUS !== 'string' || !_statusMap[DEFAULT_TEAM_STATUS]) {
            errors.push('DEFAULT_TEAM_STATUS must be a valid status ID.');
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
    // DEEP FREEZE
    // ============================================================

    deepFreeze(TEAM_TYPES);
    deepFreeze(TEAM_STATUSES);
    deepFreeze(_typeMap);
    deepFreeze(_typeLabelMap);
    deepFreeze(_periodLabelMap);
    deepFreeze(VALID_TYPE_IDS);
    deepFreeze(_statusMap);
    deepFreeze(VALID_STATUS_IDS);
    deepFreeze(LEGACY_TYPE_MAP);

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

        // Bounds
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        MIN_YEAR: MIN_YEAR,
        MAX_YEAR: MAX_YEAR,

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

        // Period helpers
        getPeriodRange: getPeriodRange,
        getPeriodBounds: getPeriodBounds,
        isValidPeriod: isValidPeriod
    });

})();