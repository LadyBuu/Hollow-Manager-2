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
 * 
 * VALIDATION HIERARCHY:
 *   Schema repair (curriculum-schema.js)
 *        ↓
 *   Shared structural/value validation (this module)
 *        ↓
 *   Domain validation (caller modules)
 *        ↓
 *   Business logic (caller modules)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__curriculumValidatorsLoaded) {
        return;
    }
    window.__curriculumValidatorsLoaded = true;

    // ============================================================
    // PRIVATE HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function hasValue(value) {
        return value !== undefined && value !== null && String(value).trim() !== '';
    }

    /**
     * Parse a positive integer (>= 1).
     * Returns null for invalid, empty, or non-positive values.
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
     * Used for max students, capacity, and other integer values that can be zero.
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
     * Used for weekly hours, weights, and other decimal values that can be zero.
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

    function isSafeInteger(value) {
        return Number.isSafeInteger(value);
    }

    // ============================================================
    // WEEK VALIDATION
    // ============================================================

    function validateWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 52 ? num : null;
    }

    // ============================================================
    // RANK VALIDATION
    // ============================================================

    function validateRank(value) {
        var num = parsePositiveInteger(value);
        return num !== null ? num : null;
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

            var num = parsePositiveInteger(value);
            if (num === null || num < 1 || num > 52) {
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
            ? parsePositiveInteger(data.startWeek)
            : null;

        var end = data.endWeek !== '' && data.endWeek !== null && data.endWeek !== undefined
            ? parsePositiveInteger(data.endWeek)
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
    // EXPOSE
    // ============================================================

    window.CurriculumValidators = {
        // Type helpers
        isObject: isObject,
        isNonEmptyString: isNonEmptyString,
        hasValue: hasValue,
        parsePositiveInteger: parsePositiveInteger,
        parseNonNegativeInteger: parseNonNegativeInteger,
        parseNonNegativeNumber: parseNonNegativeNumber,
        isSafeInteger: isSafeInteger,

        // Week validation
        validateWeek: validateWeek,

        // Rank validation
        validateRank: validateRank,

        // Grading system validation
        validateGradingSystem: validateGradingSystem,

        // Discipline validation
        validateDiscipline: validateDiscipline,

        // Team member validation
        validateMemberData: validateMemberData,

        // Location validation
        validateLocation: validateLocation
    };

})();
