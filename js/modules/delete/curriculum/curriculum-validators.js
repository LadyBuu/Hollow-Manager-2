/**
 * js/core/curriculum/curriculum-validators.js - Shared Validation Helpers
 * Path: js/core/curriculum/curriculum-validators.js
 * 
 * This module provides all validation functions used by other curriculum modules.
 * All functions are PURE: no side effects, no data mutation.
 * 
 * IMPORTANT:
 *   - These validators do NOT mutate any state
 *   - They return { valid: boolean, message?: string }
 *   - They are the SINGLE source of truth for shared STRUCTURAL and VALUE validation
 *   - Shared validators enforce generic structure and enumerated value constraints
 *   - Caller modules enforce relationships and application-specific business rules
 *   - This module validates STRUCTURE and VALUES, not DOMAIN RELATIONSHIPS
 *   - All parsing functions are delegated to CurriculumHelpers
 *   - No function in this module should depend on other curriculum modules
 * 
 * VALIDATION HIERARCHY:
 *   Schema repair (curriculum-schema.js)
 *        ↓
 *   Shared structural/value validation (this module)
 *        ↓
 *   Domain validation (caller modules)
 *        ↓
 *   Business logic (caller modules)
 * 
 * DEPENDENCIES:
 *   - CurriculumHelpers (for type checking, parsing, and result helpers)
 * 
 * LOAD ORDER:
 *   1. curriculum-helpers.js
 *   2. curriculum-validators.js
 *   3. All other curriculum modules
 * 
 * EXPOSED GLOBALS:
 *   - window.CurriculumValidators
 */

(function() {
    'use strict';

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__curriculumValidatorsLoaded) {
        return;
    }
    window.__curriculumValidatorsLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    var Helpers = window.CurriculumHelpers;

    if (!Helpers) {
        console.error('[CurriculumValidators] CurriculumHelpers not available.');
        return;
    }

    // ============================================================
    // TYPE HELPERS (Delegated to Helpers)
    // ============================================================

    var isObject = Helpers.isObject;
    var isNonEmptyString = Helpers.isNonEmptyString;
    var hasValue = Helpers.hasValue;
    var isSafeInteger = Helpers.isSafeInteger;
    var isPositiveInteger = Helpers.isPositiveInteger;
    var isNonNegativeInteger = Helpers.isNonNegativeInteger;
    var isFiniteNumber = Helpers.isFiniteNumber;

    // ============================================================
    // PARSING HELPERS (Delegated to Helpers)
    // ============================================================

    var parsePositiveInteger = Helpers.parsePositiveInteger;
    var parseNonNegativeInteger = Helpers.parseNonNegativeInteger;
    var parseNonNegativeNumber = Helpers.parseNonNegativeNumber;
    var parseWeek = Helpers.parseWeek;
    var parseRank = Helpers.parseRank;
    var parseDuration = Helpers.parseDuration;
    var parseDay = Helpers.parseDay;
    var parseHour = Helpers.parseHour;

    // ============================================================
    // RESULT HELPERS (Delegated to Helpers)
    // ============================================================

    var failure = Helpers.failure;
    var success = Helpers.success;

    // ============================================================
    // WEEK VALIDATION
    // ============================================================

    /**
     * Validate a week number.
     * @param {*} value - Week number to validate
     * @returns {number|null} Validated week or null
     */
    function validateWeek(value) {
        return parseWeek(value);
    }

    /**
     * Check if a week number is valid.
     * @param {*} value - Week number to check
     * @returns {boolean} True if valid week (1-52)
     */
    function isValidWeek(value) {
        return validateWeek(value) !== null;
    }

    // ============================================================
    // RANK VALIDATION
    // ============================================================

    /**
     * Validate a rank number.
     * @param {*} value - Rank number to validate
     * @returns {number|null} Validated rank or null
     */
    function validateRank(value) {
        return parseRank(value);
    }

    /**
     * Check if a rank number is valid.
     * @param {*} value - Rank number to check
     * @returns {boolean} True if valid rank (>= 1)
     */
    function isValidRank(value) {
        return validateRank(value) !== null;
    }

    // ============================================================
    // DURATION VALIDATION
    // ============================================================

    /**
     * Validate a duration (1-4 hours).
     * @param {*} value - Duration to validate
     * @returns {number|null} Validated duration or null
     */
    function validateDuration(value) {
        return parseDuration(value);
    }

    /**
     * Check if a duration is valid.
     * @param {*} value - Duration to check
     * @returns {boolean} True if valid duration (1-4)
     */
    function isValidDuration(value) {
        return validateDuration(value) !== null;
    }

    // ============================================================
    // DAY AND HOUR VALIDATION
    // ============================================================

    /**
     * Validate a day number (1-7).
     * @param {*} value - Day number to validate
     * @returns {number|null} Validated day or null
     */
    function validateDay(value) {
        return parseDay(value);
    }

    /**
     * Validate an hour number (0-23).
     * @param {*} value - Hour number to validate
     * @returns {number|null} Validated hour or null
     */
    function validateHour(value) {
        return parseHour(value);
    }

    /**
     * Check if a day number is valid.
     * @param {*} value - Day number to check
     * @returns {boolean} True if valid day (1-7)
     */
    function isValidDay(value) {
        return validateDay(value) !== null;
    }

    /**
     * Check if an hour number is valid.
     * @param {*} value - Hour number to check
     * @returns {boolean} True if valid hour (0-23)
     */
    function isValidHour(value) {
        return validateHour(value) !== null;
    }

    // ============================================================
    // GRADING SYSTEM VALIDATION
    // ============================================================

    /**
     * Validate a grading system.
     * 
     * @param {Array} system - Array of grade entries
     * @param {string} system[].label - Grade label (e.g., "A", "B", "C")
     * @param {number|string} system[].min - Minimum percentage (0-100)
     * @param {number|string} system[].max - Maximum percentage (0-100)
     * @returns {Object} { valid: boolean, message?: string }
     * 
     * NOTE: Accepts legacy 'letter' field as alias for 'label' for backward compatibility.
     * If both are provided and differ, validation fails.
     * This function validates only; it does NOT normalise or mutate input.
     * Empty grading system is valid (no grade levels defined).
     * Grading ranges do NOT need to cover the entire 0-100 scale.
     */
    function validateGradingSystem(system) {
        if (!Array.isArray(system)) {
            return { valid: false, message: 'Grading system must be an array.' };
        }

        if (system.length === 0) {
            return { valid: true };
        }

        var normalized = [];

        for (var i = 0; i < system.length; i++) {
            var g = system[i];

            if (!g || typeof g !== 'object') {
                return { valid: false, message: 'Invalid grade entry at index ' + i + '.' };
            }

            // Handle legacy 'letter' field
            var hasLabel = g.label !== undefined && g.label !== null && String(g.label).trim() !== '';
            var hasLetter = g.letter !== undefined && g.letter !== null && String(g.letter).trim() !== '';

            // Ambiguous input: both provided and different
            if (hasLabel && hasLetter && String(g.label).trim() !== String(g.letter).trim()) {
                return {
                    valid: false,
                    message: 'Cannot supply both label and letter with different values at index ' + i + '.'
                };
            }

            var label = hasLabel ? String(g.label).trim() : (hasLetter ? String(g.letter).trim() : '');

            if (!label) {
                return { valid: false, message: 'Grade label is required at index ' + i + '.' };
            }

            // Explicitly reject null/undefined/empty min/max
            if (g.min === undefined || g.min === null || g.min === '' ||
                g.max === undefined || g.max === null || g.max === '') {
                return {
                    valid: false,
                    message: 'Grade minimum and maximum are required at index ' + i + '.'
                };
            }

            var min = Number(g.min);
            var max = Number(g.max);

            if (!isSafeInteger(min) || !isSafeInteger(max) || min < 0 || max > 100 || min > max) {
                return { valid: false, message: 'Invalid grade range at index ' + i + '.' };
            }

            normalized.push({ label: label, min: min, max: max });
        }

        // Check for overlapping ranges
        for (var i = 0; i < normalized.length; i++) {
            for (var j = i + 1; j < normalized.length; j++) {
                var a = normalized[i];
                var b = normalized[j];

                if (a.min <= b.max && b.min <= a.max) {
                    return {
                        valid: false,
                        message: 'Grading ranges for "' + a.label + '" and "' + b.label + '" overlap.'
                    };
                }
            }
        }

        // Check for duplicate labels (case-insensitive)
        var labels = Object.create(null);

        for (var i = 0; i < normalized.length; i++) {
            var label = normalized[i].label.toUpperCase();

            if (labels[label]) {
                return {
                    valid: false,
                    message: 'Duplicate grade label "' + normalized[i].label + '".'
                };
            }

            labels[label] = true;
        }

        return { valid: true };
    }

    // ============================================================
    // DISCIPLINE VALIDATION
    // ============================================================

    /**
     * Validate discipline data.
     * 
     * @param {Object} data - Discipline data to validate
     * @param {boolean} isPartial - If true, only validate fields that are present
     * @returns {Object} { valid: boolean, message?: string }
     * 
     * NOTE: This validates STRUCTURE. It does NOT check:
     *   - That instructor IDs exist (caller responsibility)
     *   - That the discipline name is unique (caller responsibility)
     *   - That the discipline is in the correct schema location (caller responsibility)
     *   - That instructor IDs are valid strings (this module validates structure)
     */
    function validateDiscipline(data, isPartial) {
        if (!isObject(data)) {
            return { valid: false, message: 'Discipline data must be an object.' };
        }

        // Name validation
        if (!isPartial) {
            if (!isNonEmptyString(data.name)) {
                return { valid: false, message: 'Discipline name is required.' };
            }
        } else {
            if (data.name !== undefined && !isNonEmptyString(data.name)) {
                return { valid: false, message: 'Discipline name cannot be empty.' };
            }
        }

        // Type validation
        var validTypes = ['mandatory', 'optional'];

        if (!isPartial) {
            if (!data.type || validTypes.indexOf(data.type) === -1) {
                return { valid: false, message: 'Valid discipline type is required.' };
            }
        } else {
            if (data.type !== undefined && validTypes.indexOf(data.type) === -1) {
                return { valid: false, message: 'Valid discipline type is required.' };
            }
        }

        // Instructor validation (structure only - existence checked by caller)
        if (!isPartial) {
            if (!Array.isArray(data.instructorIds) || data.instructorIds.length === 0) {
                return { valid: false, message: 'At least one instructor is required.' };
            }

            // Validate each instructor ID is a non-empty string
            var seen = Object.create(null);

            for (var i = 0; i < data.instructorIds.length; i++) {
                var id = data.instructorIds[i];

                if (!isNonEmptyString(id)) {
                    return {
                        valid: false,
                        message: 'Instructor ID at index ' + i + ' must be a non-empty string.'
                    };
                }

                if (seen[id]) {
                    return {
                        valid: false,
                        message: 'Duplicate instructor ID: ' + id + '.'
                    };
                }

                seen[id] = true;
            }
        } else {
            if (data.instructorIds !== undefined) {
                if (!Array.isArray(data.instructorIds) || data.instructorIds.length === 0) {
                    return { valid: false, message: 'At least one instructor is required.' };
                }

                var seen = Object.create(null);

                for (var i = 0; i < data.instructorIds.length; i++) {
                    var id = data.instructorIds[i];

                    if (!isNonEmptyString(id)) {
                        return {
                            valid: false,
                            message: 'Instructor ID at index ' + i + ' must be a non-empty string.'
                        };
                    }

                    if (seen[id]) {
                        return {
                            valid: false,
                            message: 'Duplicate instructor ID: ' + id + '.'
                        };
                    }

                    seen[id] = true;
                }
            }
        }

        // Week validation
        function validateWeekField(value, label) {
            if (value === undefined || value === null || value === '') {
                return { valid: true, value: null };
            }

            var num = parseWeek(value);
            if (num === null) {
                return { valid: false, message: label + ' must be between 1 and 52.' };
            }

            return { valid: true, value: num };
        }

        var startResult = validateWeekField(data.startWeek, 'Start week');
        if (!startResult.valid) {
            return startResult;
        }

        var endResult = validateWeekField(data.endWeek, 'End week');
        if (!endResult.valid) {
            return endResult;
        }

        // Cross-field: startWeek <= endWeek (if both present)
        var start = data.startWeek !== '' && data.startWeek !== null && data.startWeek !== undefined
            ? parseWeek(data.startWeek)
            : null;

        var end = data.endWeek !== '' && data.endWeek !== null && data.endWeek !== undefined
            ? parseWeek(data.endWeek)
            : null;

        if (start !== null && end !== null && start > end) {
            return { valid: false, message: 'Start week must be before end week.' };
        }

        // Weekly hours validation
        function validateHours(value) {
            if (value === undefined || value === null || value === '') {
                return { valid: true, value: null };
            }

            var num = parseNonNegativeNumber(value);
            if (num === null || num < 0 || num > 40) {
                return { valid: false, message: 'Weekly hours must be between 0 and 40.' };
            }

            return { valid: true, value: Math.round(num * 10) / 10 };
        }

        var hoursResult = validateHours(data.weeklyHours);
        if (!hoursResult.valid) {
            return hoursResult;
        }

        // Max students validation
        function validateMaxStudents(value) {
            if (value === undefined || value === null || value === '') {
                return { valid: true, value: null };
            }

            var num = parseNonNegativeInteger(value);
            if (num === null || num > 100) {
                return {
                    valid: false,
                    message: 'Max students must be between 0 and 100.'
                };
            }

            return { valid: true, value: num };
        }

        var studentsResult = validateMaxStudents(data.maxStudents);
        if (!studentsResult.valid) {
            return studentsResult;
        }

        // Weight validation
        function validateWeight(value) {
            if (value === undefined || value === null || value === '') {
                return { valid: true, value: null };
            }

            var num = parseNonNegativeNumber(value);
            if (num === null || num < 0.1 || num > 10) {
                return { valid: false, message: 'Weight must be between 0.1 and 10.' };
            }

            return { valid: true, value: Math.round(num * 100) / 100 };
        }

        var weightResult = validateWeight(data.weight);
        if (!weightResult.valid) {
            return weightResult;
        }

        // Grading system validation
        if (data.gradingSystem !== undefined) {
            var gradingResult = validateGradingSystem(data.gradingSystem);
            if (!gradingResult.valid) {
                return gradingResult;
            }
        }

        return { valid: true };
    }

    // ============================================================
    // TEAM MEMBER VALIDATION
    // ============================================================

    /**
     * Validate team member data.
     * 
     * @param {Object} data - Member data to validate
     * @param {string} data.characterId - Character ID (required)
     * @param {string} data.role - Role name (defaults to 'Member')
     * @param {string|number} data.joinPeriod - Join period (optional)
     * @param {string|number} data.leavePeriod - Leave period (optional)
     * @returns {Object} { valid: boolean, message?: string }
     * 
     * NOTE: This validates STRUCTURE. It does NOT check:
     *   - That the character exists (caller responsibility)
     *   - That the team exists (caller responsibility)
     *   - That the join/leave periods make sense in context (caller responsibility)
     */
    function validateMemberData(data) {
        if (!isObject(data)) {
            return { valid: false, message: 'Member data must be an object.' };
        }

        if (!isNonEmptyString(data.characterId)) {
            return { valid: false, message: 'Character ID is required.' };
        }

        if (data.role !== undefined && data.role !== null && typeof data.role !== 'string') {
            return { valid: false, message: 'Role must be a string.' };
        }

        // Validate join period
        if (data.joinPeriod !== '' && data.joinPeriod !== undefined && data.joinPeriod !== null) {
            var join = parsePositiveInteger(data.joinPeriod);

            if (join === null) {
                return { valid: false, message: 'Invalid join period.' };
            }
        }

        // Validate leave period
        if (data.leavePeriod !== '' && data.leavePeriod !== undefined && data.leavePeriod !== null) {
            var leave = parsePositiveInteger(data.leavePeriod);

            if (leave === null) {
                return { valid: false, message: 'Invalid leave period.' };
            }
        }

        // Cross-field: join <= leave (if both present)
        var joinNum = parsePositiveInteger(data.joinPeriod);
        var leaveNum = parsePositiveInteger(data.leavePeriod);

        if (joinNum !== null && leaveNum !== null && joinNum > leaveNum) {
            return { valid: false, message: 'Join period cannot be after leave period.' };
        }

        return { valid: true };
    }

    // ============================================================
    // LOCATION VALIDATION
    // ============================================================

    /**
     * Validate location data.
     * 
     * @param {Object} data - Location data to validate
     * @param {boolean} isPartial - If true, only validate fields that are present
     * @returns {Object} { valid: boolean, message?: string }
     * 
     * NOTE: This validates STRUCTURE. It does NOT check:
     *   - That the location name is unique (caller responsibility)
     *   - That the location exists (caller responsibility)
     *   - That the location type is valid (caller responsibility)
     */
    function validateLocation(data, isPartial) {
        if (!isObject(data)) {
            return { valid: false, message: 'Location data must be an object.' };
        }

        // Name validation
        if (!isPartial) {
            if (!isNonEmptyString(data.name)) {
                return { valid: false, message: 'Location name is required.' };
            }
        } else {
            if (data.name !== undefined && !isNonEmptyString(data.name)) {
                return { valid: false, message: 'Location name cannot be empty.' };
            }
        }

        // Type validation
        var validTypes = ['indoor', 'outdoor', 'pool', 'classroom', 'lab', 'field', 'other'];

        if (!isPartial) {
            if (!data.type || validTypes.indexOf(data.type) === -1) {
                return { valid: false, message: 'Valid location type is required.' };
            }
        } else {
            if (data.type !== undefined && validTypes.indexOf(data.type) === -1) {
                return { valid: false, message: 'Invalid location type.' };
            }
        }

        // Capacity validation
        function validateCapacity(value) {
            if (value === undefined || value === null || value === '') {
                return { valid: true };
            }

            var num = parseNonNegativeInteger(value);
            if (num === null) {
                return { valid: false, message: 'Capacity must be a whole number of 0 or greater.' };
            }

            return { valid: true };
        }

        if (!isPartial) {
            var capResult = validateCapacity(data.capacity);
            if (!capResult.valid) {
                return capResult;
            }
        } else {
            if (data.capacity !== undefined) {
                var capResult = validateCapacity(data.capacity);
                if (!capResult.valid) {
                    return capResult;
                }
            }
        }

        // Description validation
        if (data.description !== undefined && typeof data.description !== 'string') {
            return { valid: false, message: 'Description must be a string.' };
        }

        return { valid: true };
    }

    // ============================================================
    // SCHEDULE SLOT VALIDATION
    // ============================================================

    /**
     * Validate a schedule slot.
     * 
     * @param {string} studentId - Student ID
     * @param {*} week - Week number
     * @param {*} day - Day number
     * @param {*} hour - Hour number
     * @returns {Object} { valid: boolean, message?: string, data?: Object }
     * 
     * NOTE: This validates structure and values. It does NOT check:
     *   - That the student exists (caller responsibility)
     *   - That the slot is available (caller responsibility)
     *   - That there are no conflicts (caller responsibility)
     */
    function validateScheduleSlot(studentId, week, day, hour) {
        if (!isNonEmptyString(studentId)) {
            return { valid: false, message: 'Student ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { valid: false, message: 'Valid week is required (1-52).' };
        }

        var dayNum = validateDay(day);
        if (dayNum === null) {
            return { valid: false, message: 'Valid day is required (1-7).' };
        }

        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return { valid: false, message: 'Valid hour is required (0-23).' };
        }

        return {
            valid: true,
            data: {
                studentId: String(studentId).trim(),
                week: weekNum,
                day: dayNum,
                hour: hourNum
            }
        };
    }

    // ============================================================
    // CLASS VALIDATION
    // ============================================================

    /**
     * Validate class data.
     * 
     * @param {Object} data - Class data to validate
     * @param {boolean} isPartial - If true, only validate fields that are present
     * @returns {Object} { valid: boolean, message?: string }
     * 
     * NOTE: This validates STRUCTURE. It does NOT check:
     *   - That the class name is unique (caller responsibility)
     *   - That the class exists (caller responsibility)
     */
    function validateClass(data, isPartial) {
        if (!isObject(data)) {
            return { valid: false, message: 'Class data must be an object.' };
        }

        // Name validation
        if (!isPartial) {
            if (!isNonEmptyString(data.name)) {
                return { valid: false, message: 'Class name is required.' };
            }
        } else {
            if (data.name !== undefined && !isNonEmptyString(data.name)) {
                return { valid: false, message: 'Class name cannot be empty.' };
            }
        }

        // No other fields to validate for classes
        return { valid: true };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CurriculumValidators = {
        // Type helpers (delegated)
        isObject: isObject,
        isNonEmptyString: isNonEmptyString,
        hasValue: hasValue,
        isSafeInteger: isSafeInteger,
        isPositiveInteger: isPositiveInteger,
        isNonNegativeInteger: isNonNegativeInteger,
        isFiniteNumber: isFiniteNumber,

        // Parsing helpers (delegated)
        parsePositiveInteger: parsePositiveInteger,
        parseNonNegativeInteger: parseNonNegativeInteger,
        parseNonNegativeNumber: parseNonNegativeNumber,
        parseWeek: parseWeek,
        parseRank: parseRank,
        parseDuration: parseDuration,
        parseDay: parseDay,
        parseHour: parseHour,

        // Week validation
        validateWeek: validateWeek,
        isValidWeek: isValidWeek,

        // Rank validation
        validateRank: validateRank,
        isValidRank: isValidRank,

        // Duration validation
        validateDuration: validateDuration,
        isValidDuration: isValidDuration,

        // Day and hour validation
        validateDay: validateDay,
        validateHour: validateHour,
        isValidDay: isValidDay,
        isValidHour: isValidHour,

        // Grading system validation
        validateGradingSystem: validateGradingSystem,

        // Discipline validation
        validateDiscipline: validateDiscipline,

        // Team member validation
        validateMemberData: validateMemberData,

        // Location validation
        validateLocation: validateLocation,

        // Schedule slot validation
        validateScheduleSlot: validateScheduleSlot,

        // Class validation
        validateClass: validateClass
    };


})();
