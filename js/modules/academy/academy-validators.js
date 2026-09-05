/**
 * js/modules/academy/academy-validators.js - Academy Validators
 * Shared validation functions for the academy module
 * Path: js/modules/academy/academy-validators.js
 * 
 * This module provides:
 *   - Class validation (name uniqueness, structure)
 *   - Grade validation (score range, discipline existence)
 *   - Schedule validation (week, day, hour, duration)
 *   - Team validation (name, type, period)
 *   - Tournament validation (name, week, status)
 *   - Ranking validation (rank positive integer)
 *   - Shared structural and value validation
 * 
 * IMPORTANT:
 *   - All functions are PURE - no side effects
 *   - No DOM manipulation
 *   - No data mutation
 *   - Returns { valid: boolean, message?: string, data?: any }
 *   - This is the SINGLE SOURCE OF TRUTH for academy validation
 * 
 * DEPENDENCIES:
 *   - window.AcademyQueries (from academy-queries.js)
 *   - window.ValidationUtils (from validation-utils.js)
 *   - window.CoreUtils (from core-utils.js)
 * 
 * USAGE:
 *   var validators = window.AcademyValidators;
 *   var result = validators.validateClassName('Spring 2025');
 *   if (!result.valid) { showError(result.message); }
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academyValidatorsLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var AcademyQueries = window.AcademyQueries;
    var ValidationUtils = window.ValidationUtils;
    var CoreUtils = window.CoreUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademyQueries || typeof AcademyQueries.getClasses !== 'function') {
            missing.push('AcademyQueries.getClasses');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClass !== 'function') {
            missing.push('AcademyQueries.getClass');
        }
        if (!AcademyQueries || typeof AcademyQueries.getDiscipline !== 'function') {
            missing.push('AcademyQueries.getDiscipline');
        }
        if (!AcademyQueries || typeof AcademyQueries.getDisciplines !== 'function') {
            missing.push('AcademyQueries.getDisciplines');
        }
        if (!AcademyQueries || typeof AcademyQueries.getCharacterById !== 'function') {
            missing.push('AcademyQueries.getCharacterById');
        }

        if (!ValidationUtils || typeof ValidationUtils.isObject !== 'function') {
            missing.push('ValidationUtils.isObject');
        }
        if (!ValidationUtils || typeof ValidationUtils.parseStrictPositivePeriod !== 'function') {
            missing.push('ValidationUtils.parseStrictPositivePeriod');
        }

        if (!CoreUtils || typeof CoreUtils.isNonEmptyString !== 'function') {
            missing.push('CoreUtils.isNonEmptyString');
        }
        if (!CoreUtils || typeof CoreUtils.hasPeriodValue !== 'function') {
            missing.push('CoreUtils.hasPeriodValue');
        }

        if (missing.length > 0) {
            console.warn('AcademyValidators: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__academyValidatorsLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return ValidationUtils.isObject(value);
    }

    function isNonEmptyString(value) {
        return CoreUtils.isNonEmptyString(value);
    }

    function hasPeriodValue(value) {
        return CoreUtils.hasPeriodValue(value);
    }

    function parseStrictPositivePeriod(value) {
        return ValidationUtils.parseStrictPositivePeriod(value);
    }

    function failure(message) {
        return { valid: false, message: message };
    }

    function success(data) {
        return { valid: true, data: data };
    }

    // ============================================================
    // CLASS VALIDATION
    // ============================================================

    function validateClassName(name, excludeId) {
        if (!isNonEmptyString(name)) {
            return failure('Class name is required.');
        }

        var trimmed = name.trim();
        var classes = AcademyQueries.getClasses();

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || typeof cls !== 'object') {
                continue;
            }
            if (excludeId && String(cls.id) === String(excludeId)) {
                continue;
            }
            if (String(cls.name || '').toLowerCase() === trimmed.toLowerCase()) {
                return failure('A class with this name already exists.');
            }
        }

        return success({ name: trimmed });
    }

    function validateClassData(data, isPartial) {
        if (!isObject(data)) {
            return failure('Class data must be an object.');
        }

        if (!isPartial) {
            if (!isNonEmptyString(data.name)) {
                return failure('Class name is required.');
            }
        } else {
            if (data.name !== undefined && !isNonEmptyString(data.name)) {
                return failure('Class name cannot be empty.');
            }
        }

        return success(data);
    }

    // ============================================================
    // GRADE VALIDATION
    // ============================================================

    function validateGradeScore(score) {
        if (score === undefined || score === null || score === '') {
            return success(null);
        }

        var num = Number(score);
        if (!Number.isFinite(num)) {
            return failure('Score must be a number.');
        }
        if (num < 0 || num > 100) {
            return failure('Score must be between 0 and 100.');
        }

        return success(Math.round(num * 10) / 10);
    }

    function validateGrade(disciplineId, score) {
        if (!isNonEmptyString(disciplineId)) {
            return failure('Discipline ID is required.');
        }

        var discipline = AcademyQueries.getDiscipline(disciplineId);
        if (!discipline) {
            return failure('Discipline not found.');
        }

        var scoreResult = validateGradeScore(score);
        if (!scoreResult.valid) {
            return scoreResult;
        }

        return success({
            disciplineId: disciplineId,
            discipline: discipline,
            score: scoreResult.data
        });
    }

    function validateGrades(grades) {
        if (!isObject(grades)) {
            return failure('Grades must be an object.');
        }

        var validated = {};
        var errors = [];

        for (var disciplineId in grades) {
            if (!Object.prototype.hasOwnProperty.call(grades, disciplineId)) {
                continue;
            }

            var result = validateGrade(disciplineId, grades[disciplineId]);
            if (!result.valid) {
                errors.push(result.message);
            } else {
                validated[disciplineId] = result.data;
            }
        }

        if (errors.length > 0) {
            return failure(errors.join('; '));
        }

        return success(validated);
    }

    // ============================================================
    // SCHEDULE VALIDATION
    // ============================================================

    function validateWeek(value) {
        var num = parseInt(value, 10);
        if (isNaN(num) || num < 1 || num > 52) {
            return failure('Week must be between 1 and 52.');
        }
        return success(num);
    }

    function validateDay(value) {
        var num = parseInt(value, 10);
        if (isNaN(num) || num < 1 || num > 7) {
            return failure('Day must be between 1 and 7.');
        }
        return success(num);
    }

    function validateHour(value) {
        var num = parseInt(value, 10);
        if (isNaN(num) || num < 0 || num > 23) {
            return failure('Hour must be between 0 and 23.');
        }
        return success(num);
    }

    function validateDuration(value) {
        var num = parseInt(value, 10);
        if (isNaN(num) || num < 1 || num > 4) {
            return failure('Duration must be between 1 and 4 hours.');
        }
        return success(num);
    }

    function validateScheduleSlot(studentId, week, day, hour) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekResult = validateWeek(week);
        if (!weekResult.valid) {
            return weekResult;
        }

        var dayResult = validateDay(day);
        if (!dayResult.valid) {
            return dayResult;
        }

        var hourResult = validateHour(hour);
        if (!hourResult.valid) {
            return hourResult;
        }

        var student = AcademyQueries.getCharacterById(studentId);
        if (!student) {
            return failure('Student not found.');
        }

        return success({
            studentId: studentId,
            week: weekResult.data,
            day: dayResult.data,
            hour: hourResult.data
        });
    }

    function validateScheduleClass(studentId, week, day, hour, disciplineId, duration) {
        var slotResult = validateScheduleSlot(studentId, week, day, hour);
        if (!slotResult.valid) {
            return slotResult;
        }

        if (!isNonEmptyString(disciplineId)) {
            return failure('Discipline ID is required.');
        }

        var discipline = AcademyQueries.getDiscipline(disciplineId);
        if (!discipline) {
            return failure('Discipline not found.');
        }

        var durationResult = validateDuration(duration);
        if (!durationResult.valid) {
            return durationResult;
        }

        var slot = slotResult.data;

        return success({
            studentId: slot.studentId,
            week: slot.week,
            day: slot.day,
            hour: slot.hour,
            disciplineId: disciplineId,
            discipline: discipline,
            duration: durationResult.data
        });
    }

    function validateRestDays(days) {
        if (!Array.isArray(days)) {
            return failure('Rest days must be an array.');
        }

        var validDays = [];
        var seen = {};

        for (var i = 0; i < days.length; i++) {
            var dayResult = validateDay(days[i]);
            if (!dayResult.valid) {
                return dayResult;
            }

            var day = dayResult.data;
            if (seen[day]) {
                return failure('Duplicate rest day: ' + day);
            }
            seen[day] = true;
            validDays.push(day);
        }

        validDays.sort(function(a, b) { return a - b; });

        return success(validDays);
    }

    // ============================================================
    // TEAM VALIDATION
    // ============================================================

    function validateTeamName(name, excludeId) {
        if (!isNonEmptyString(name)) {
            return failure('Team name is required.');
        }

        var trimmed = name.trim();
        var teams = AcademyQueries.getAcademicTeams();

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || typeof team !== 'object') {
                continue;
            }
            if (excludeId && String(team.id) === String(excludeId)) {
                continue;
            }
            if (String(team.name || '').toLowerCase() === trimmed.toLowerCase()) {
                return failure('A team with this name already exists.');
            }
        }

        return success({ name: trimmed });
    }

    function validateTeamType(type) {
        var validTypes = ['academic', 'professional', 'temporary', 'civilian'];
        if (!isNonEmptyString(type)) {
            return failure('Team type is required.');
        }
        if (validTypes.indexOf(type) === -1) {
            return failure('Invalid team type. Must be one of: ' + validTypes.join(', '));
        }
        return success(type);
    }

    function validateTeamPeriod(period, type) {
        if (!hasPeriodValue(period)) {
            return success(null);
        }

        var num = parseStrictPositivePeriod(period);
        if (num === null) {
            return failure('Invalid period value.');
        }

        if (type === 'academic') {
            if (num < 1 || num > 52) {
                return failure('Academic period must be between 1 and 52.');
            }
        } else {
            if (num < 1900 || num > 2100) {
                return failure('Year period must be between 1900 and 2100.');
            }
        }

        return success(num);
    }

    function validateTeamData(data, isPartial) {
        if (!isObject(data)) {
            return failure('Team data must be an object.');
        }

        if (!isPartial) {
            if (!isNonEmptyString(data.name)) {
                return failure('Team name is required.');
            }
            var typeResult = validateTeamType(data.type);
            if (!typeResult.valid) {
                return typeResult;
            }
        } else {
            if (data.name !== undefined && !isNonEmptyString(data.name)) {
                return failure('Team name cannot be empty.');
            }
            if (data.type !== undefined) {
                var typeResult = validateTeamType(data.type);
                if (!typeResult.valid) {
                    return typeResult;
                }
            }
        }

        var type = data.type || 'academic';

        if (data.startPeriod !== undefined) {
            var startResult = validateTeamPeriod(data.startPeriod, type);
            if (!startResult.valid) {
                return startResult;
            }
        }

        if (data.endPeriod !== undefined) {
            var endResult = validateTeamPeriod(data.endPeriod, type);
            if (!endResult.valid) {
                return endResult;
            }
        }

        // Cross-field validation: start <= end
        var start = parseStrictPositivePeriod(data.startPeriod);
        var end = parseStrictPositivePeriod(data.endPeriod);

        if (start !== null && end !== null && start > end) {
            return failure('Start period cannot be after end period.');
        }

        return success(data);
    }

    function validateTeamMember(studentId, role, joinPeriod, leavePeriod, teamType) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var student = AcademyQueries.getCharacterById(studentId);
        if (!student) {
            return failure('Student not found.');
        }

        if (role !== undefined && role !== null && !isNonEmptyString(role)) {
            return failure('Role must be a string.');
        }

        if (joinPeriod !== undefined) {
            var joinResult = validateTeamPeriod(joinPeriod, teamType || 'academic');
            if (!joinResult.valid) {
                return failure('Invalid join period: ' + joinResult.message);
            }
        }

        if (leavePeriod !== undefined) {
            var leaveResult = validateTeamPeriod(leavePeriod, teamType || 'academic');
            if (!leaveResult.valid) {
                return failure('Invalid leave period: ' + leaveResult.message);
            }
        }

        // Cross-field: join <= leave
        var join = parseStrictPositivePeriod(joinPeriod);
        var leave = parseStrictPositivePeriod(leavePeriod);

        if (join !== null && leave !== null && join > leave) {
            return failure('Join period cannot be after leave period.');
        }

        return success({
            studentId: studentId,
            student: student,
            role: role || 'Member',
            joinPeriod: joinPeriod || '',
            leavePeriod: leavePeriod || ''
        });
    }

    // ============================================================
    // TOURNAMENT VALIDATION
    // ============================================================

    function validateTournamentName(name, excludeId) {
        if (!isNonEmptyString(name)) {
            return failure('Tournament name is required.');
        }

        var trimmed = name.trim();
        var tournaments = AcademyQueries.getTournaments();

        for (var i = 0; i < tournaments.length; i++) {
            var t = tournaments[i];
            if (!t || typeof t !== 'object') {
                continue;
            }
            if (excludeId && String(t.id) === String(excludeId)) {
                continue;
            }
            if (String(t.name || '').toLowerCase() === trimmed.toLowerCase()) {
                return failure('A tournament with this name already exists.');
            }
        }

        return success({ name: trimmed });
    }

    function validateTournamentStatus(status) {
        var validStatuses = ['draft', 'active', 'completed', 'cancelled'];
        if (!isNonEmptyString(status)) {
            return failure('Tournament status is required.');
        }
        if (validStatuses.indexOf(status) === -1) {
            return failure('Invalid tournament status. Must be one of: ' + validStatuses.join(', '));
        }
        return success(status);
    }

    function validateTournamentData(data, isPartial) {
        if (!isObject(data)) {
            return failure('Tournament data must be an object.');
        }

        if (!isPartial) {
            if (!isNonEmptyString(data.name)) {
                return failure('Tournament name is required.');
            }
            if (!isNonEmptyString(data.classId)) {
                return failure('Class ID is required.');
            }
        } else {
            if (data.name !== undefined && !isNonEmptyString(data.name)) {
                return failure('Tournament name cannot be empty.');
            }
        }

        if (data.classId !== undefined && !isNonEmptyString(data.classId)) {
            return failure('Class ID must be a non-empty string.');
        }

        if (data.week !== undefined) {
            var weekResult = validateWeek(data.week);
            if (!weekResult.valid) {
                return weekResult;
            }
        }

        if (data.status !== undefined) {
            var statusResult = validateTournamentStatus(data.status);
            if (!statusResult.valid) {
                return statusResult;
            }
        }

        if (data.description !== undefined && data.description !== null && typeof data.description !== 'string') {
            return failure('Description must be a string.');
        }

        return success(data);
    }

    // ============================================================
    // DISCIPLINE VALIDATION
    // ============================================================

    function validateDisciplineName(name, excludeId) {
        if (!isNonEmptyString(name)) {
            return failure('Discipline name is required.');
        }

        var trimmed = name.trim();
        var disciplines = AcademyQueries.getDisciplines();

        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            if (!d || typeof d !== 'object') {
                continue;
            }
            if (excludeId && String(d.id) === String(excludeId)) {
                continue;
            }
            if (String(d.name || '').toLowerCase() === trimmed.toLowerCase()) {
                return failure('A discipline with this name already exists.');
            }
        }

        return success({ name: trimmed });
    }

    function validateDisciplineType(type) {
        var validTypes = ['mandatory', 'optional'];
        if (!isNonEmptyString(type)) {
            return failure('Discipline type is required.');
        }
        if (validTypes.indexOf(type) === -1) {
            return failure('Invalid discipline type. Must be one of: ' + validTypes.join(', '));
        }
        return success(type);
    }

    function validateDisciplineWeight(weight) {
        if (weight === undefined || weight === null || weight === '') {
            return success(1);
        }

        var num = Number(weight);
        if (!Number.isFinite(num) || num < 0.1 || num > 10) {
            return failure('Weight must be between 0.1 and 10.');
        }

        return success(Math.round(num * 100) / 100);
    }

    function validateDisciplineInstructors(instructorIds) {
        if (!Array.isArray(instructorIds)) {
            return failure('Instructor IDs must be an array.');
        }

        if (instructorIds.length === 0) {
            return failure('At least one instructor is required.');
        }

        var seen = {};

        for (var i = 0; i < instructorIds.length; i++) {
            var id = instructorIds[i];
            if (!isNonEmptyString(id)) {
                return failure('Instructor ID at index ' + i + ' must be a non-empty string.');
            }
            if (seen[id]) {
                return failure('Duplicate instructor ID: ' + id);
            }
            seen[id] = true;

            var instructor = AcademyQueries.getCharacterById(id);
            if (!instructor) {
                return failure('Instructor not found: ' + id);
            }
        }

        return success(instructorIds);
    }

    function validateDisciplineData(data, isPartial) {
        if (!isObject(data)) {
            return failure('Discipline data must be an object.');
        }

        if (!isPartial) {
            if (!isNonEmptyString(data.name)) {
                return failure('Discipline name is required.');
            }
            var typeResult = validateDisciplineType(data.type);
            if (!typeResult.valid) {
                return typeResult;
            }
            var instResult = validateDisciplineInstructors(data.instructorIds);
            if (!instResult.valid) {
                return instResult;
            }
        } else {
            if (data.name !== undefined && !isNonEmptyString(data.name)) {
                return failure('Discipline name cannot be empty.');
            }
            if (data.type !== undefined) {
                var typeResult = validateDisciplineType(data.type);
                if (!typeResult.valid) {
                    return typeResult;
                }
            }
            if (data.instructorIds !== undefined) {
                var instResult = validateDisciplineInstructors(data.instructorIds);
                if (!instResult.valid) {
                    return instResult;
                }
            }
        }

        if (data.startWeek !== undefined) {
            var startResult = validateWeek(data.startWeek);
            if (!startResult.valid) {
                return startResult;
            }
        }

        if (data.endWeek !== undefined) {
            var endResult = validateWeek(data.endWeek);
            if (!endResult.valid) {
                return endResult;
            }
        }

        // Cross-field: start <= end
        var start = parseInt(data.startWeek, 10);
        var end = parseInt(data.endWeek, 10);

        if (!isNaN(start) && !isNaN(end) && start > end) {
            return failure('Start week cannot be after end week.');
        }

        if (data.weight !== undefined) {
            var weightResult = validateDisciplineWeight(data.weight);
            if (!weightResult.valid) {
                return weightResult;
            }
        }

        if (data.weeklyHours !== undefined) {
            var hours = Number(data.weeklyHours);
            if (!Number.isFinite(hours) || hours < 0 || hours > 40) {
                return failure('Weekly hours must be between 0 and 40.');
            }
        }

        return success(data);
    }

    // ============================================================
    // LOCATION VALIDATION
    // ============================================================

    function validateLocationName(name, excludeId) {
        if (!isNonEmptyString(name)) {
            return failure('Location name is required.');
        }

        var trimmed = name.trim();
        var locations = AcademyQueries.getLocations();

        for (var i = 0; i < locations.length; i++) {
            var loc = locations[i];
            if (!loc || typeof loc !== 'object') {
                continue;
            }
            if (excludeId && String(loc.id) === String(excludeId)) {
                continue;
            }
            if (String(loc.name || '').toLowerCase() === trimmed.toLowerCase()) {
                return failure('A location with this name already exists.');
            }
        }

        return success({ name: trimmed });
    }

    function validateLocationType(type) {
        var validTypes = ['indoor', 'outdoor', 'pool', 'classroom', 'lab', 'field', 'other'];
        if (!isNonEmptyString(type)) {
            return failure('Location type is required.');
        }
        if (validTypes.indexOf(type) === -1) {
            return failure('Invalid location type. Must be one of: ' + validTypes.join(', '));
        }
        return success(type);
    }

    function validateLocationCapacity(capacity) {
        if (capacity === undefined || capacity === null || capacity === '') {
            return success(null);
        }

        var num = Number(capacity);
        if (!Number.isSafeInteger(num) || num < 0) {
            return failure('Capacity must be a non-negative integer.');
        }

        return success(num);
    }

    function validateLocationData(data, isPartial) {
        if (!isObject(data)) {
            return failure('Location data must be an object.');
        }

        if (!isPartial) {
            if (!isNonEmptyString(data.name)) {
                return failure('Location name is required.');
            }
            var typeResult = validateLocationType(data.type);
            if (!typeResult.valid) {
                return typeResult;
            }
        } else {
            if (data.name !== undefined && !isNonEmptyString(data.name)) {
                return failure('Location name cannot be empty.');
            }
            if (data.type !== undefined) {
                var typeResult = validateLocationType(data.type);
                if (!typeResult.valid) {
                    return typeResult;
                }
            }
        }

        if (data.capacity !== undefined) {
            var capResult = validateLocationCapacity(data.capacity);
            if (!capResult.valid) {
                return capResult;
            }
        }

        if (data.description !== undefined && data.description !== null && typeof data.description !== 'string') {
            return failure('Description must be a string.');
        }

        return success(data);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyValidators = {
        // Class validation
        validateClassName: validateClassName,
        validateClassData: validateClassData,

        // Grade validation
        validateGradeScore: validateGradeScore,
        validateGrade: validateGrade,
        validateGrades: validateGrades,

        // Schedule validation
        validateWeek: validateWeek,
        validateDay: validateDay,
        validateHour: validateHour,
        validateDuration: validateDuration,
        validateScheduleSlot: validateScheduleSlot,
        validateScheduleClass: validateScheduleClass,
        validateRestDays: validateRestDays,

        // Team validation
        validateTeamName: validateTeamName,
        validateTeamType: validateTeamType,
        validateTeamPeriod: validateTeamPeriod,
        validateTeamData: validateTeamData,
        validateTeamMember: validateTeamMember,

        // Tournament validation
        validateTournamentName: validateTournamentName,
        validateTournamentStatus: validateTournamentStatus,
        validateTournamentData: validateTournamentData,

        // Discipline validation
        validateDisciplineName: validateDisciplineName,
        validateDisciplineType: validateDisciplineType,
        validateDisciplineWeight: validateDisciplineWeight,
        validateDisciplineInstructors: validateDisciplineInstructors,
        validateDisciplineData: validateDisciplineData,

        // Location validation
        validateLocationName: validateLocationName,
        validateLocationType: validateLocationType,
        validateLocationCapacity: validateLocationCapacity,
        validateLocationData: validateLocationData,

        // Utilities
        isObject: isObject,
        isNonEmptyString: isNonEmptyString,
        hasPeriodValue: hasPeriodValue,
        parseStrictPositivePeriod: parseStrictPositivePeriod
    };

})();