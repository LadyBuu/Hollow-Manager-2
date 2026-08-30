/**
 * js/core/curriculum/curriculum-helpers.js - Shared Curriculum Helpers
 * Single source of truth for all shared helper functions
 * Path: js/core/curriculum/curriculum-helpers.js
 * 
 * This module provides:
 *   - Type checking utilities
 *   - Data store access
 *   - Activity logging
 *   - Deep cloning
 *   - ID generation
 *   - Result helpers
 *   - Common validation helpers
 * 
 * IMPORTANT:
 *   - All functions are PURE where possible
 *   - No DOM manipulation
 *   - No UI logic
 *   - This is the SINGLE SOURCE OF TRUTH for shared utilities
 *   - All curriculum modules should use these helpers
 *   - No function in this module should depend on other curriculum modules
 * 
 * USAGE:
 *   var Helpers = window.CurriculumHelpers;
 *   var data = Helpers.getDataStore();
 *   var cloned = Helpers.deepClone(obj);
 *   Helpers.logActivity('Something happened');
 * 
 * LOAD ORDER:
 *   This module should be loaded BEFORE any other curriculum module
 *   that depends on these helpers.
 * 
 * DEPENDENCIES:
 *   - None (self-contained)
 * 
 * EXPOSED GLOBALS:
 *   - window.CurriculumHelpers
 *   - window.deepClone (legacy compatibility)
 *   - window.getDataStore (legacy compatibility)
 *   - window.logActivity (legacy compatibility)
 *   - window.generateId (legacy compatibility)
 */

(function() {
    'use strict';

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__curriculumHelpersLoaded) {
        return;
    }
    window.__curriculumHelpersLoaded = true;

    // ============================================================
    // TYPE HELPERS
    // ============================================================

    /**
     * Check if a value is a plain object (not null, not array).
     * @param {*} value - Value to check
     * @returns {boolean} True if value is a plain object
     */
    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    /**
     * Check if a value is a non-empty string.
     * @param {*} value - Value to check
     * @returns {boolean} True if value is a non-empty string
     */
    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    /**
     * Check if a value is a safe integer.
     * @param {*} value - Value to check
     * @returns {boolean} True if value is a safe integer
     */
    function isSafeInteger(value) {
        return Number.isSafeInteger(value);
    }

    /**
     * Check if a value is a positive integer (>= 1).
     * @param {*} value - Value to check
     * @returns {boolean} True if value is a positive integer
     */
    function isPositiveInteger(value) {
        return isSafeInteger(value) && value >= 1;
    }

    /**
     * Check if a value is a non-negative integer (>= 0).
     * @param {*} value - Value to check
     * @returns {boolean} True if value is a non-negative integer
     */
    function isNonNegativeInteger(value) {
        return isSafeInteger(value) && value >= 0;
    }

    /**
     * Check if a value is a finite number.
     * @param {*} value - Value to check
     * @returns {boolean} True if value is a finite number
     */
    function isFiniteNumber(value) {
        return typeof value === 'number' && Number.isFinite(value);
    }

    /**
     * Check if a value has content (not undefined, null, or empty string).
     * @param {*} value - Value to check
     * @returns {boolean} True if value has content
     */
    function hasValue(value) {
        return value !== undefined && value !== null && String(value).trim() !== '';
    }

    // ============================================================
    // DATA STORE ACCESS
    // ============================================================

    /**
     * Get the global data store.
     * @returns {object|null} The data store or null if not available
     */
    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    /**
     * Get the curriculum data store.
     * @returns {object|null} The curriculum data store or null if not available
     */
    function getCurriculumStore() {
        var data = getDataStore();
        if (!data) {
            return null;
        }
        if (!data.curriculum || typeof data.curriculum !== 'object' || Array.isArray(data.curriculum)) {
            return null;
        }
        return data.curriculum;
    }

    /**
     * Ensure the curriculum store exists.
     * @returns {object|null} The curriculum store or null if data store is not available
     */
    function ensureCurriculumStore() {
        var data = getDataStore();
        if (!data) {
            return null;
        }
        if (!data.curriculum || typeof data.curriculum !== 'object' || Array.isArray(data.curriculum)) {
            data.curriculum = {};
        }
        return data.curriculum;
    }

    // ============================================================
    // ACTIVITY LOGGING
    // ============================================================

    /**
     * Log an activity to the global activity log.
     * This only updates in-memory state - caller is responsible for persistence.
     * @param {string} message - Activity message
     * @param {string} type - Activity type (info, success, warning, error)
     */
    function logActivity(message, type) {
        type = type || 'info';

        if (!message) {
            return;
        }

        var data = getDataStore();
        if (data) {
            if (!Array.isArray(data.activities)) {
                data.activities = [];
            }

            data.activities.unshift({
                id: generateId('act'),
                message: String(message),
                type: type,
                timestamp: new Date().toISOString()
            });

            if (data.activities.length > 100) {
                data.activities.length = 100;
            }
        }

        console.log('[' + type + ']', message);
    }

    // ============================================================
    // DEEP CLONE
    // ============================================================

    /**
     * Deep clone a value.
     * Uses structuredClone if available, falls back to JSON.
     * Returns null on failure.
     * @param {*} value - Value to clone
     * @returns {*} Cloned value or null on failure
     */
    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }

        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                console.error('CurriculumHelpers: structuredClone failed:', e);
                return null;
            }
        }

        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('CurriculumHelpers: JSON clone failed:', e);
            return null;
        }
    }

    /**
     * Deep clone a value, returning an empty object or array on failure.
     * @param {*} value - Value to clone
     * @param {*} defaultValue - Default value if cloning fails
     * @returns {*} Cloned value or default
     */
    function safeClone(value, defaultValue) {
        if (defaultValue === undefined) {
            defaultValue = Array.isArray(value) ? [] : {};
        }
        var cloned = deepClone(value);
        return cloned !== null ? cloned : defaultValue;
    }

    // ============================================================
    // ID GENERATION
    // ============================================================

    /**
     * Generate a unique ID with an optional prefix.
     * Uses crypto.randomUUID if available.
     * @param {string} prefix - ID prefix (default: 'id')
     * @returns {string} Unique ID
     */
    function generateId(prefix) {
        prefix = prefix || 'id';

        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return prefix + '_' + window.crypto.randomUUID();
        }

        return prefix + '_' +
               Date.now() + '_' +
               Math.random().toString(36).slice(2, 10);
    }

    // ============================================================
    // RESULT HELPERS
    // ============================================================

    /**
     * Create a failure result object.
     * @param {string} message - Error message
     * @returns {object} { success: false, message: string }
     */
    function failure(message) {
        return {
            success: false,
            message: message
        };
    }

    /**
     * Create a success result object.
     * @param {*} data - Data to include
     * @returns {object} { success: true, data: * }
     */
    function success(data) {
        return {
            success: true,
            data: data
        };
    }

    /**
     * Create a success result with a cloned object.
     * @param {string} name - Name of the entity type (for error message)
     * @param {*} data - Data to clone and include
     * @returns {object} { success: true, data: * } or failure
     */
    function successWithClone(name, data) {
        var cloned = deepClone(data);
        if (cloned === null) {
            return failure('Failed to clone ' + name + ' data.');
        }
        return {
            success: true,
            data: cloned
        };
    }

    /**
     * Create a success result with an entity.
     * @param {string} entityName - Name of the entity (e.g., 'class', 'discipline')
     * @param {*} entity - The entity object
     * @returns {object} { success: true, entityName: * } or failure
     */
    function successWithEntity(entityName, entity) {
        var cloned = deepClone(entity);
        if (cloned === null) {
            return failure('Failed to clone ' + entityName + ' data.');
        }
        var result = { success: true };
        result[entityName] = cloned;
        return result;
    }

    // ============================================================
    // PARSING HELPERS
    // ============================================================

    /**
     * Parse a positive integer (>= 1).
     * Returns null for invalid, empty, or non-positive values.
     * @param {*} value - Value to parse
     * @returns {number|null} Parsed integer or null
     */
    function parsePositiveInteger(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        if (!Number.isFinite(num) || !Number.isInteger(num) || num < 1) {
            return null;
        }
        return num;
    }

    /**
     * Parse a non-negative integer (>= 0).
     * Returns null for invalid or negative values.
     * @param {*} value - Value to parse
     * @returns {number|null} Parsed integer or null
     */
    function parseNonNegativeInteger(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) {
            return null;
        }
        return num;
    }

    /**
     * Parse a non-negative number (>= 0).
     * Returns null for invalid or negative values.
     * @param {*} value - Value to parse
     * @returns {number|null} Parsed number or null
     */
    function parseNonNegativeNumber(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        if (!Number.isFinite(num) || num < 0) {
            return null;
        }
        return num;
    }

    /**
     * Parse a week number (1-52).
     * Returns null for invalid values.
     * @param {*} value - Value to parse
     * @returns {number|null} Parsed week or null
     */
    function parseWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 52 ? num : null;
    }

    /**
     * Parse a rank number (>= 1).
     * Returns null for invalid values.
     * @param {*} value - Value to parse
     * @returns {number|null} Parsed rank or null
     */
    function parseRank(value) {
        return parsePositiveInteger(value);
    }

    /**
     * Parse a duration (1-4 hours).
     * Returns null for invalid values.
     * @param {*} value - Value to parse
     * @returns {number|null} Parsed duration or null
     */
    function parseDuration(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 4 ? num : null;
    }

    /**
     * Parse a day number (1-7).
     * Returns null for invalid values.
     * @param {*} value - Value to parse
     * @returns {number|null} Parsed day or null
     */
    function parseDay(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        if (!Number.isSafeInteger(num) || num < 1 || num > 7) {
            return null;
        }
        return num;
    }

    /**
     * Parse an hour number (0-23).
     * Returns null for invalid values.
     * @param {*} value - Value to parse
     * @returns {number|null} Parsed hour or null
     */
    function parseHour(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        if (!Number.isSafeInteger(num) || num < 0 || num > 23) {
            return null;
        }
        return num;
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    /**
     * Validate a week number.
     * @param {*} value - Value to validate
     * @returns {boolean} True if valid week (1-52)
     */
    function isValidWeek(value) {
        return parseWeek(value) !== null;
    }

    /**
     * Validate a day number.
     * @param {*} value - Value to validate
     * @returns {boolean} True if valid day (1-7)
     */
    function isValidDay(value) {
        return parseDay(value) !== null;
    }

    /**
     * Validate an hour number.
     * @param {*} value - Value to validate
     * @returns {boolean} True if valid hour (0-23)
     */
    function isValidHour(value) {
        return parseHour(value) !== null;
    }

    /**
     * Validate a duration.
     * @param {*} value - Value to validate
     * @returns {boolean} True if valid duration (1-4)
     */
    function isValidDuration(value) {
        return parseDuration(value) !== null;
    }

    /**
     * Validate a rank number.
     * @param {*} value - Value to validate
     * @returns {boolean} True if valid rank (>= 1)
     */
    function isValidRank(value) {
        return parseRank(value) !== null;
    }

    // ============================================================
    // SCHEDULE HELPERS
    // ============================================================

    /**
     * Generate a schedule key.
     * All parameters are stringified to avoid type-based collisions.
     * @param {string} studentId - Student ID
     * @param {number|string} week - Week number
     * @param {number|string} day - Day number (1-7)
     * @param {number|string} hour - Hour number (0-23)
     * @returns {string} Schedule key
     */
    function getScheduleKey(studentId, week, day, hour) {
        return JSON.stringify([
            String(studentId),
            String(week),
            String(day),
            String(hour)
        ]);
    }

    /**
     * Check if a schedule slot is empty.
     * @param {*} value - Slot value
     * @returns {boolean} True if slot is empty
     */
    function isSlotEmpty(value) {
        return value === undefined || value === null || value === '';
    }

    /**
     * Check if a schedule slot is occupied.
     * @param {*} value - Slot value
     * @returns {boolean} True if slot is occupied
     */
    function isSlotOccupied(value) {
        return !isSlotEmpty(value);
    }

    // ============================================================
    // GRADING HELPERS
    // ============================================================

    /**
     * Check if a grade value is empty (should be deleted).
     * @param {*} value - Grade value
     * @returns {boolean} True if grade should be deleted
     */
    function isEmptyGradeValue(value) {
        return value === undefined ||
            value === null ||
            (typeof value === 'string' && value.trim() === '');
    }

    /**
     * Parse a grade score value.
     * Returns null for invalid, non-numeric, or out-of-range values.
     * @param {*} value - Score value
     * @returns {number|null} Parsed score or null
     */
    function parseGradeScore(value) {
        // Reject non-string, non-number inputs
        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : null;
        }

        if (typeof value === 'string' && value.trim() !== '') {
            var num = Number(value);
            return Number.isFinite(num) ? num : null;
        }

        // Reject boolean, array, object, null, undefined
        return null;
    }

    /**
     * Validate a grade score.
     * @param {*} value - Score value
     * @returns {boolean} True if valid score (0-100)
     */
    function isValidGradeScore(value) {
        var num = parseGradeScore(value);
        return num !== null && num >= 0 && num <= 100;
    }

    // ============================================================
    // TYPE CONSTANTS
    // ============================================================

    /**
     * Valid discipline types.
     * @constant {string[]}
     */
    var VALID_DISCIPLINE_TYPES = ['mandatory', 'optional'];

    /**
     * Valid location types.
     * @constant {string[]}
     */
    var VALID_LOCATION_TYPES = [
        'indoor', 'outdoor', 'pool', 'classroom', 'lab', 'field', 'other'
    ];

    /**
     * Valid team statuses.
     * @constant {string[]}
     */
    var VALID_TEAM_STATUSES = ['active', 'inactive', 'deprecated', 'deleted'];

    /**
     * Check if a discipline type is valid.
     * @param {string} type - Discipline type
     * @returns {boolean} True if valid
     */
    function isValidDisciplineType(type) {
        return VALID_DISCIPLINE_TYPES.indexOf(type) !== -1;
    }

    /**
     * Check if a location type is valid.
     * @param {string} type - Location type
     * @returns {boolean} True if valid
     */
    function isValidLocationType(type) {
        return VALID_LOCATION_TYPES.indexOf(type) !== -1;
    }

    /**
     * Check if a team status is valid.
     * @param {string} status - Team status
     * @returns {boolean} True if valid
     */
    function isValidTeamStatus(status) {
        return VALID_TEAM_STATUSES.indexOf(status) !== -1;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CurriculumHelpers = {
        // Type helpers
        isObject: isObject,
        isNonEmptyString: isNonEmptyString,
        isSafeInteger: isSafeInteger,
        isPositiveInteger: isPositiveInteger,
        isNonNegativeInteger: isNonNegativeInteger,
        isFiniteNumber: isFiniteNumber,
        hasValue: hasValue,

        // Data store access
        getDataStore: getDataStore,
        getCurriculumStore: getCurriculumStore,
        ensureCurriculumStore: ensureCurriculumStore,

        // Activity logging
        logActivity: logActivity,

        // Deep clone
        deepClone: deepClone,
        safeClone: safeClone,

        // ID generation
        generateId: generateId,

        // Result helpers
        failure: failure,
        success: success,
        successWithClone: successWithClone,
        successWithEntity: successWithEntity,

        // Parsing helpers
        parsePositiveInteger: parsePositiveInteger,
        parseNonNegativeInteger: parseNonNegativeInteger,
        parseNonNegativeNumber: parseNonNegativeNumber,
        parseWeek: parseWeek,
        parseRank: parseRank,
        parseDuration: parseDuration,
        parseDay: parseDay,
        parseHour: parseHour,

        // Validation helpers
        isValidWeek: isValidWeek,
        isValidDay: isValidDay,
        isValidHour: isValidHour,
        isValidDuration: isValidDuration,
        isValidRank: isValidRank,

        // Schedule helpers
        getScheduleKey: getScheduleKey,
        isSlotEmpty: isSlotEmpty,
        isSlotOccupied: isSlotOccupied,

        // Grading helpers
        isEmptyGradeValue: isEmptyGradeValue,
        parseGradeScore: parseGradeScore,
        isValidGradeScore: isValidGradeScore,

        // Type constants
        VALID_DISCIPLINE_TYPES: VALID_DISCIPLINE_TYPES,
        VALID_LOCATION_TYPES: VALID_LOCATION_TYPES,
        VALID_TEAM_STATUSES: VALID_TEAM_STATUSES,
        isValidDisciplineType: isValidDisciplineType,
        isValidLocationType: isValidLocationType,
        isValidTeamStatus: isValidTeamStatus
    };

    // ============================================================
    // LEGACY GLOBAL EXPORTS (Backward Compatibility)
    // ============================================================

    window.deepClone = deepClone;
    window.getDataStore = getDataStore;
    window.logActivity = logActivity;
    window.generateId = generateId;
    window.isObject = isObject;
    window.isNonEmptyString = isNonEmptyString;
    window.isSafeInteger = isSafeInteger;
    window.isPositiveInteger = isPositiveInteger;
    window.parsePositiveInteger = parsePositiveInteger;
    window.parseWeek = parseWeek;
    window.parseRank = parseRank;
    window.parseDuration = parseDuration;
    window.parseDay = parseDay;
    window.parseHour = parseHour;
    window.isSlotEmpty = isSlotEmpty;
    window.isSlotOccupied = isSlotOccupied;
    window.isEmptyGradeValue = isEmptyGradeValue;
    window.getScheduleKey = getScheduleKey;


})();
