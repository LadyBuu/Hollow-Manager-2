/**
 * js/core/curriculum/curriculum-validators.js - Shared Validation Helpers
 * Path: js/core/curriculum/curriculum-validators.js
 */

(function() {
    'use strict';

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

    function parsePositiveInteger(value) {
        var num = Number(value);
        return Number.isInteger(num) && num >= 1 ? num : null;
    }

    function isSafeInteger(value) {
        return Number.isSafeInteger(value);
    }

    function validateWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 52 ? num : null;
    }

    function validateRank(value) {
        var num = parsePositiveInteger(value);
        return num !== null ? num : null;
    }

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
            var letter = String(g.letter || '').trim();
            if (!letter) {
                return { valid: false, message: 'Grade letter is required at index ' + i + '.' };
            }
            var min = Number(g.min);
            var max = Number(g.max);
            if (!isSafeInteger(min) || !isSafeInteger(max) || min < 0 || max > 100 || min > max) {
                return { valid: false, message: 'Invalid grade range at index ' + i + '.' };
            }
            normalized.push({ letter: letter, min: min, max: max });
        }

        for (var i = 0; i < normalized.length; i++) {
            for (var j = i + 1; j < normalized.length; j++) {
                var a = normalized[i];
                var b = normalized[j];
                if (a.min <= b.max && b.min <= a.max) {
                    return { valid: false, message: 'Grading ranges for "' + a.letter + '" and "' + b.letter + '" overlap.' };
                }
            }
            for (var j = 0; j < i; j++) {
                var a = normalized[i];
                var b = normalized[j];
                if (a.letter.toUpperCase() === b.letter.toUpperCase()) {
                    return { valid: false, message: 'Duplicate grade letter "' + a.letter + '".' };
                }
            }
        }

        return { valid: true };
    }

    function validateDiscipline(data, isPartial) {
        if (!isObject(data)) {
            return { valid: false, message: 'Discipline data must be an object.' };
        }

        if (isPartial) {
            if (data.name !== undefined && !isNonEmptyString(data.name)) {
                return { valid: false, message: 'Discipline name cannot be empty.' };
            }
            if (data.type !== undefined && (data.type !== 'mandatory' && data.type !== 'optional')) {
                return { valid: false, message: 'Valid discipline type is required.' };
            }
            if (data.instructorIds !== undefined && (!Array.isArray(data.instructorIds) || data.instructorIds.length === 0)) {
                return { valid: false, message: 'At least one instructor is required.' };
            }
            if (data.startWeek !== undefined) {
                var start = validateWeek(data.startWeek);
                if (data.startWeek !== '' && data.startWeek !== null && data.startWeek !== undefined && start === null) {
                    return { valid: false, message: 'Start week must be between 1 and 52.' };
                }
            }
            if (data.endWeek !== undefined) {
                var end = validateWeek(data.endWeek);
                if (data.endWeek !== '' && data.endWeek !== null && data.endWeek !== undefined && end === null) {
                    return { valid: false, message: 'End week must be between 1 and 52.' };
                }
            }
            if (data.weeklyHours !== undefined && data.weeklyHours !== '' && data.weeklyHours !== null) {
                var hours = Number(data.weeklyHours);
                if (isNaN(hours) || hours < 0 || hours > 40) {
                    return { valid: false, message: 'Weekly hours must be between 0 and 40.' };
                }
            }
            if (data.maxStudents !== undefined && data.maxStudents !== '' && data.maxStudents !== null) {
                var students = Number(data.maxStudents);
                if (isNaN(students) || students < 0 || students > 100) {
                    return { valid: false, message: 'Max students must be between 0 and 100.' };
                }
            }
            if (data.weight !== undefined && data.weight !== '' && data.weight !== null) {
                var weight = Number(data.weight);
                if (isNaN(weight) || weight < 0.1 || weight > 10) {
                    return { valid: false, message: 'Weight must be between 0.1 and 10.' };
                }
            }
            if (data.gradingSystem !== undefined) {
                var gradingValidation = validateGradingSystem(data.gradingSystem);
                if (!gradingValidation.valid) {
                    return gradingValidation;
                }
            }
        } else {
            if (!isNonEmptyString(data.name)) {
                return { valid: false, message: 'Discipline name is required.' };
            }
            if (!data.type || (data.type !== 'mandatory' && data.type !== 'optional')) {
                return { valid: false, message: 'Valid discipline type is required.' };
            }
            if (!Array.isArray(data.instructorIds) || data.instructorIds.length === 0) {
                return { valid: false, message: 'At least one instructor is required.' };
            }
            if (data.startWeek !== '' && data.startWeek !== undefined && data.startWeek !== null) {
                var start = validateWeek(data.startWeek);
                if (start === null) {
                    return { valid: false, message: 'Start week must be between 1 and 52.' };
                }
            }
            if (data.endWeek !== '' && data.endWeek !== undefined && data.endWeek !== null) {
                var end = validateWeek(data.endWeek);
                if (end === null) {
                    return { valid: false, message: 'End week must be between 1 and 52.' };
                }
            }
            if (data.startWeek && data.endWeek) {
                var start = parsePositiveInteger(data.startWeek);
                var end = parsePositiveInteger(data.endWeek);
                if (start !== null && end !== null && start > end) {
                    return { valid: false, message: 'Start week must be before end week.' };
                }
            }
            if (data.weeklyHours !== '' && data.weeklyHours !== undefined && data.weeklyHours !== null) {
                var hours = Number(data.weeklyHours);
                if (isNaN(hours) || hours < 0 || hours > 40) {
                    return { valid: false, message: 'Weekly hours must be between 0 and 40.' };
                }
            }
            if (data.maxStudents !== '' && data.maxStudents !== undefined && data.maxStudents !== null) {
                var students = Number(data.maxStudents);
                if (isNaN(students) || students < 0 || students > 100) {
                    return { valid: false, message: 'Max students must be between 0 and 100.' };
                }
            }
            if (data.weight !== '' && data.weight !== undefined && data.weight !== null) {
                var weight = Number(data.weight);
                if (isNaN(weight) || weight < 0.1 || weight > 10) {
                    return { valid: false, message: 'Weight must be between 0.1 and 10.' };
                }
            }
            if (data.gradingSystem) {
                var gradingValidation = validateGradingSystem(data.gradingSystem);
                if (!gradingValidation.valid) {
                    return gradingValidation;
                }
            }
        }

        return { valid: true };
    }

    function validateMemberData(data) {
        if (!isObject(data)) {
            return { valid: false, message: 'Member data must be an object.' };
        }
        if (!isNonEmptyString(data.characterId)) {
            return { valid: false, message: 'Character ID is required.' };
        }
        if (data.joinPeriod !== '' && data.joinPeriod !== undefined && data.joinPeriod !== null) {
            var join = parsePositiveInteger(data.joinPeriod);
            if (join === null) {
                return { valid: false, message: 'Invalid join period.' };
            }
        }
        if (data.leavePeriod !== '' && data.leavePeriod !== undefined && data.leavePeriod !== null) {
            var leave = parsePositiveInteger(data.leavePeriod);
            if (leave === null) {
                return { valid: false, message: 'Invalid leave period.' };
            }
        }
        var joinNum = parsePositiveInteger(data.joinPeriod);
        var leaveNum = parsePositiveInteger(data.leavePeriod);
        if (joinNum !== null && leaveNum !== null && joinNum > leaveNum) {
            return { valid: false, message: 'Join period cannot be after leave period.' };
        }
        return { valid: true };
    }

    function validateLocation(data, isPartial) {
        if (!isObject(data)) {
            return { valid: false, message: 'Location data must be an object.' };
        }

        if (isPartial) {
            if (data.name !== undefined && !isNonEmptyString(data.name)) {
                return { valid: false, message: 'Location name cannot be empty.' };
            }
            if (data.type !== undefined && typeof data.type !== 'string') {
                return { valid: false, message: 'Invalid location type.' };
            }
            if (data.capacity !== undefined) {
                if (data.capacity !== null && data.capacity !== '') {
                    var cap = Number(data.capacity);
                    if (!Number.isInteger(cap) || cap < 0) {
                        return { valid: false, message: 'Capacity must be a whole number of 0 or greater.' };
                    }
                }
            }
        } else {
            if (!isNonEmptyString(data.name)) {
                return { valid: false, message: 'Location name is required.' };
            }
            if (data.capacity !== null && data.capacity !== '') {
                var cap = Number(data.capacity);
                if (!Number.isInteger(cap) || cap < 0) {
                    return { valid: false, message: 'Capacity must be a whole number of 0 or greater.' };
                }
            }
        }

        return { valid: true };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CurriculumValidators = {
        isObject: isObject,
        isNonEmptyString: isNonEmptyString,
        hasValue: hasValue,
        parsePositiveInteger: parsePositiveInteger,
        isSafeInteger: isSafeInteger,
        validateWeek: validateWeek,
        validateRank: validateRank,
        validateGradingSystem: validateGradingSystem,
        validateDiscipline: validateDiscipline,
        validateMemberData: validateMemberData,
        validateLocation: validateLocation
    };

})();
