/**
 * core/discipline-core.js - Discipline Core Operations
 * Single source of truth for all discipline-related data mutations
 * Path: js/core/discipline-core.js
 * 
 * This module handles:
 *   - Discipline CRUD (create, read, update, delete)
 *   - Grading system validation
 *   - Discipline instructor assignment
 *   - Discipline type validation (mandatory/optional)
 * 
 * IMPORTANT:
 *   - All functions return { success: boolean, message?: string, data?: any }
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 * 
 * PERSISTENCE CONTRACT:
 *   - Mutations are applied to window.data in memory
 *   - Caller is responsible for saveData() persistence
 *   - No rollback is provided after mutation begins
 * 
 * GRADING SYSTEM VALIDATION:
 *   - Letters must be unique (case-insensitive)
 *   - Ranges must not overlap
 *   - Min must be <= max
 *   - Values must be between 0 and 100
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

    function isSafeInteger(value) {
        return Number.isSafeInteger(value);
    }

    function parsePositiveInteger(value) {
        var num = Number(value);
        return Number.isInteger(num) && num >= 1 ? num : null;
    }

    function parseFloatStrict(value) {
        var num = Number(value);
        return isFinite(num) ? num : NaN;
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function ensureDisciplineStructure() {
        var data = getDataStore();
        if (!data) return null;

        if (!data.curriculum || typeof data.curriculum !== 'object' || Array.isArray(data.curriculum)) {
            data.curriculum = {};
        }

        if (!Array.isArray(data.curriculum.disciplines)) {
            data.curriculum.disciplines = [];
        }

        return data;
    }

    function logActivity(message, type) {
        type = type || 'info';
        if (typeof window.logActivity === 'function') {
            window.logActivity(message, type);
        }
    }

    function getCharacterById(id) {
        if (typeof window.getCharacterById === 'function') {
            return window.getCharacterById(id);
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) return null;
        return data.characters.find(function(c) {
            return c && String(c.id) === String(id);
        }) || null;
    }

    function generateId(prefix) {
        prefix = prefix || 'disc';
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return prefix + '_' + window.crypto.randomUUID();
        }
        return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    }

    // ============================================================
    // GRADING SYSTEM VALIDATION
    // ============================================================

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

        // Check for overlapping ranges
        for (var i = 0; i < normalized.length; i++) {
            for (var j = i + 1; j < normalized.length; j++) {
                var a = normalized[i];
                var b = normalized[j];
                if (a.min <= b.max && b.min <= a.max) {
                    return {
                        valid: false,
                        message: 'Grading ranges for "' + a.letter + '" and "' + b.letter + '" overlap.'
                    };
                }
            }
        }

        // Check for duplicate letters (case-insensitive)
        var letters = {};
        for (var i = 0; i < normalized.length; i++) {
            var letter = normalized[i].letter.toUpperCase();
            if (letters[letter]) {
                return {
                    valid: false,
                    message: 'Duplicate grade letter "' + normalized[i].letter + '".'
                };
            }
            letters[letter] = true;
        }

        return { valid: true };
    }

    // ============================================================
    // DISCIPLINE VALIDATION
    // ============================================================

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

        // Instructor validation
        var instructorCheck = function(ids) {
            if (!Array.isArray(ids) || ids.length === 0) {
                return { valid: false, message: 'At least one instructor is required.' };
            }
            var invalid = [];
            for (var i = 0; i < ids.length; i++) {
                if (!getCharacterById(ids[i])) {
                    invalid.push(ids[i]);
                }
            }
            if (invalid.length > 0) {
                return { valid: false, message: 'Invalid instructor IDs: ' + invalid.join(', ') };
            }
            return { valid: true };
        };

        if (!isPartial) {
            var result = instructorCheck(data.instructorIds);
            if (!result.valid) return result;
        } else {
            if (data.instructorIds !== undefined) {
                var result = instructorCheck(data.instructorIds);
                if (!result.valid) return result;
            }
        }

        // Week validation
        function validateWeek(value, label) {
            if (value === undefined || value === null || value === '') return { valid: true };
            var num = parsePositiveInteger(value);
            if (num === null || num < 1 || num > 52) {
                return { valid: false, message: label + ' must be between 1 and 52.' };
            }
            return { valid: true };
        }

        if (!isPartial) {
            var startResult = validateWeek(data.startWeek, 'Start week');
            if (!startResult.valid) return startResult;
            var endResult = validateWeek(data.endWeek, 'End week');
            if (!endResult.valid) return endResult;

            if (data.startWeek && data.endWeek) {
                var start = parsePositiveInteger(data.startWeek);
                var end = parsePositiveInteger(data.endWeek);
                if (start !== null && end !== null && start > end) {
                    return { valid: false, message: 'Start week must be before end week.' };
                }
            }
        } else {
            if (data.startWeek !== undefined) {
                var startResult = validateWeek(data.startWeek, 'Start week');
                if (!startResult.valid) return startResult;
            }
            if (data.endWeek !== undefined) {
                var endResult = validateWeek(data.endWeek, 'End week');
                if (!endResult.valid) return endResult;
            }
        }

        // Weekly hours validation
        function validateHours(value) {
            if (value === undefined || value === null || value === '') return { valid: true };
            var num = parseFloatStrict(value);
            if (isNaN(num) || num < 0 || num > 40) {
                return { valid: false, message: 'Weekly hours must be between 0 and 40.' };
            }
            return { valid: true };
        }

        if (!isPartial) {
            var hoursResult = validateHours(data.weeklyHours);
            if (!hoursResult.valid) return hoursResult;
        } else {
            if (data.weeklyHours !== undefined) {
                var hoursResult = validateHours(data.weeklyHours);
                if (!hoursResult.valid) return hoursResult;
            }
        }

        // Max students validation
        function validateMaxStudents(value) {
            if (value === undefined || value === null || value === '') return { valid: true };
            var num = parsePositiveInteger(value);
            if (num === null || num > 100) {
                return { valid: false, message: 'Max students must be between 0 and 100.' };
            }
            return { valid: true };
        }

        if (!isPartial) {
            var studentsResult = validateMaxStudents(data.maxStudents);
            if (!studentsResult.valid) return studentsResult;
        } else {
            if (data.maxStudents !== undefined) {
                var studentsResult = validateMaxStudents(data.maxStudents);
                if (!studentsResult.valid) return studentsResult;
            }
        }

        // Weight validation
        function validateWeight(value) {
            if (value === undefined || value === null || value === '') return { valid: true };
            var num = parseFloatStrict(value);
            if (isNaN(num) || num < 0.1 || num > 10) {
                return { valid: false, message: 'Weight must be between 0.1 and 10.' };
            }
            return { valid: true };
        }

        if (!isPartial) {
            var weightResult = validateWeight(data.weight);
            if (!weightResult.valid) return weightResult;
        } else {
            if (data.weight !== undefined) {
                var weightResult = validateWeight(data.weight);
                if (!weightResult.valid) return weightResult;
            }
        }

        // Grading system validation
        if (!isPartial) {
            if (data.gradingSystem !== undefined) {
                var gradingResult = validateGradingSystem(data.gradingSystem);
                if (!gradingResult.valid) return gradingResult;
            }
        } else {
            if (data.gradingSystem !== undefined) {
                var gradingResult = validateGradingSystem(data.gradingSystem);
                if (!gradingResult.valid) return gradingResult;
            }
        }

        return { valid: true };
    }

    // ============================================================
    // DISCIPLINE CRUD
    // ============================================================

    function getDiscipline(id) {
        if (!isNonEmptyString(id)) return null;

        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return null;
        }

        return data.curriculum.disciplines.find(function(d) {
            return d && String(d.id) === String(id);
        }) || null;
    }

    function getDisciplines() {
        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return [];
        }
        return data.curriculum.disciplines.slice();
    }

    function getAvailableDisciplines(week) {
        var weekNum = parsePositiveInteger(week);
        if (weekNum === null) {
            return [];
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return [];
        }

        return data.curriculum.disciplines.filter(function(d) {
            if (!d || typeof d !== 'object') return false;

            var start = parsePositiveInteger(d.startWeek);
            var end = parsePositiveInteger(d.endWeek);

            if (start !== null && start > weekNum) return false;
            if (end !== null && end < weekNum) return false;

            return true;
        });
    }

    function createDiscipline(data) {
        // ---- PHASE 1: VALIDATE INPUTS ----
        var validation = validateDiscipline(data, false);
        if (!validation.valid) {
            return { success: false, message: validation.message };
        }

        // ---- PHASE 2: CHECK DUPLICATES ----
        var store = ensureDisciplineStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        var existing = store.curriculum.disciplines.find(function(d) {
            return d && String(d.name || '').toLowerCase() === String(data.name).toLowerCase();
        });

        if (existing) {
            return { success: false, message: 'A discipline with this name already exists.' };
        }

        // ---- PHASE 3: BUILD DISCIPLINE ----
        var discipline = {
            id: generateId('disc'),
            name: String(data.name).trim(),
            type: data.type || 'mandatory',
            instructorIds: Array.isArray(data.instructorIds) ? data.instructorIds.slice() : [],
            curriculum: data.curriculum || '',
            startWeek: data.startWeek !== undefined && data.startWeek !== null && data.startWeek !== ''
                ? String(data.startWeek)
                : '',
            endWeek: data.endWeek !== undefined && data.endWeek !== null && data.endWeek !== ''
                ? String(data.endWeek)
                : '',
            weeklyHours: data.weeklyHours !== undefined && data.weeklyHours !== null && data.weeklyHours !== ''
                ? Number(data.weeklyHours)
                : '',
            maxStudents: data.maxStudents !== undefined && data.maxStudents !== null && data.maxStudents !== ''
                ? Number(data.maxStudents)
                : '',
            weight: data.weight !== undefined && data.weight !== null && data.weight !== ''
                ? Number(data.weight)
                : 1,
            gradingSystem: Array.isArray(data.gradingSystem) ? data.gradingSystem.slice() : [],
            createdAt: new Date().toISOString()
        };

        // ---- PHASE 4: VALIDATE BUILT OBJECT ----
        var builtValidation = validateDiscipline(discipline, false);
        if (!builtValidation.valid) {
            return { success: false, message: 'Internal validation failed: ' + builtValidation.message };
        }

        // ---- PHASE 5: APPLY ----
        store.curriculum.disciplines.push(discipline);

        logActivity('Created discipline: ' + discipline.name);
        return { success: true, discipline: discipline };
    }

    function updateDiscipline(id, data) {
        // ---- PHASE 1: VALIDATE ID ----
        if (!isNonEmptyString(id)) {
            return { success: false, message: 'Discipline ID is required.' };
        }

        // ---- PHASE 2: VALIDATE UPDATES ----
        var validation = validateDiscipline(data, true);
        if (!validation.valid) {
            return { success: false, message: validation.message };
        }

        // ---- PHASE 3: RETRIEVE ----
        var store = getDataStore();
        if (!store || !store.curriculum || !Array.isArray(store.curriculum.disciplines)) {
            return { success: false, message: 'No disciplines found.' };
        }

        var index = store.curriculum.disciplines.findIndex(function(d) {
            return d && String(d.id) === String(id);
        });

        if (index === -1) {
            return { success: false, message: 'Discipline not found.' };
        }

        var discipline = store.curriculum.disciplines[index];

        // ---- PHASE 4: CHECK DUPLICATES (name change) ----
        if (data.name !== undefined) {
            var newName = String(data.name).trim();
            if (!newName) {
                return { success: false, message: 'Discipline name cannot be empty.' };
            }

            var existing = store.curriculum.disciplines.find(function(d) {
                return d && String(d.id) !== String(id) &&
                       String(d.name || '').toLowerCase() === newName.toLowerCase();
            });

            if (existing) {
                return { success: false, message: 'A discipline with this name already exists.' };
            }

            discipline.name = newName;
        }

        // ---- PHASE 5: APPLY UPDATES ----
        if (data.type !== undefined) {
            discipline.type = data.type;
        }

        if (data.instructorIds !== undefined) {
            discipline.instructorIds = Array.isArray(data.instructorIds)
                ? data.instructorIds.slice()
                : [];
        }

        if (data.curriculum !== undefined) {
            discipline.curriculum = data.curriculum;
        }

        if (data.startWeek !== undefined) {
            discipline.startWeek = data.startWeek !== '' ? String(data.startWeek) : '';
        }

        if (data.endWeek !== undefined) {
            discipline.endWeek = data.endWeek !== '' ? String(data.endWeek) : '';
        }

        if (data.weeklyHours !== undefined) {
            discipline.weeklyHours = data.weeklyHours !== '' ? Number(data.weeklyHours) : '';
        }

        if (data.maxStudents !== undefined) {
            discipline.maxStudents = data.maxStudents !== '' ? Number(data.maxStudents) : '';
        }

        if (data.weight !== undefined) {
            discipline.weight = data.weight !== '' ? Number(data.weight) : 1;
        }

        if (data.gradingSystem !== undefined) {
            discipline.gradingSystem = Array.isArray(data.gradingSystem)
                ? data.gradingSystem.slice()
                : [];
        }

        // ---- PHASE 6: VALIDATE RESULT ----
        var builtValidation = validateDiscipline(discipline, false);
        if (!builtValidation.valid) {
            return { success: false, message: 'Internal validation failed: ' + builtValidation.message };
        }

        logActivity('Updated discipline: ' + discipline.name);
        return { success: true, discipline: discipline };
    }

    function deleteDiscipline(id) {
        // ---- PHASE 1: VALIDATE ID ----
        if (!isNonEmptyString(id)) {
            return { success: false, message: 'Discipline ID is required.' };
        }

        // ---- PHASE 2: RETRIEVE ----
        var store = getDataStore();
        if (!store || !store.curriculum || !Array.isArray(store.curriculum.disciplines)) {
            return { success: false, message: 'No disciplines found.' };
        }

        var index = store.curriculum.disciplines.findIndex(function(d) {
            return d && String(d.id) === String(id);
        });

        if (index === -1) {
            return { success: false, message: 'Discipline not found.' };
        }

        var discipline = store.curriculum.disciplines[index];
        var name = discipline.name;

        // ---- PHASE 3: CLEAN UP REFERENCES ----
        // Remove from schedules
        if (store.curriculum.schedules && isObject(store.curriculum.schedules)) {
            for (var studentId in store.curriculum.schedules) {
                if (!isObject(store.curriculum.schedules[studentId])) continue;

                for (var week in store.curriculum.schedules[studentId]) {
                    var schedule = store.curriculum.schedules[studentId][week];
                    if (!isObject(schedule)) continue;

                    for (var day in schedule) {
                        if (!isObject(schedule[day])) continue;

                        for (var hour in schedule[day]) {
                            if (String(schedule[day][hour]) === String(id)) {
                                delete schedule[day][hour];

                                var key = studentId + '_' + week + '_' + day + '_' + hour;

                                if (store.curriculum.classInstructors) {
                                    delete store.curriculum.classInstructors[key];
                                }
                                if (store.curriculum.classLabels) {
                                    delete store.curriculum.classLabels[key];
                                }
                                if (store.curriculum.classGroupLabels) {
                                    delete store.curriculum.classGroupLabels[key];
                                }
                                if (store.curriculum.classDurations) {
                                    delete store.curriculum.classDurations[key];
                                }
                                if (store.curriculum.classLocations) {
                                    delete store.curriculum.classLocations[key];
                                }
                            }
                        }
                    }
                }
            }
        }

        // Remove from grades
        if (store.curriculum.grades && isObject(store.curriculum.grades)) {
            for (var studentId in store.curriculum.grades) {
                if (!isObject(store.curriculum.grades[studentId])) continue;

                for (var week in store.curriculum.grades[studentId]) {
                    if (isObject(store.curriculum.grades[studentId][week])) {
                        delete store.curriculum.grades[studentId][week][id];
                    }
                }
            }
        }

        // Remove from auto-groups
        if (store.curriculum.autoGroups && isObject(store.curriculum.autoGroups)) {
            for (var key in store.curriculum.autoGroups) {
                var group = store.curriculum.autoGroups[key];
                if (group && String(group.disciplineId) === String(id)) {
                    delete store.curriculum.autoGroups[key];
                }
            }
        }

        // Remove from discipline groups
        if (store.curriculum.disciplineGroups) {
            delete store.curriculum.disciplineGroups[id];
        }

        // ---- PHASE 4: DELETE ----
        store.curriculum.disciplines.splice(index, 1);

        logActivity('Deleted discipline: ' + name);
        return { success: true };
    }

    // ============================================================
    // GRADING SYSTEM HELPERS
    // ============================================================

    function getGradeLetter(discipline, score) {
        if (!discipline || !Array.isArray(discipline.gradingSystem) || discipline.gradingSystem.length === 0) {
            return '';
        }

        var numScore = Number(score);
        if (!isFinite(numScore) || numScore < 0 || numScore > 100) {
            return '';
        }

        var sorted = discipline.gradingSystem.slice().sort(function(a, b) {
            return (b.min || 0) - (a.min || 0);
        });

        for (var i = 0; i < sorted.length; i++) {
            var grade = sorted[i];
            var min = Number(grade.min);
            var max = Number(grade.max);

            if (isFinite(min) && isFinite(max) && numScore >= min && numScore <= max) {
                return grade.letter;
            }
        }

        return '';
    }

    function getDisciplineTypeLabel(type) {
        var labels = {
            'mandatory': '■ Mandatory',
            'optional': '□ Optional'
        };
        return labels[type] || type || 'Unknown';
    }

    function getDisciplineTypeColor(type) {
        var colors = {
            'mandatory': 'var(--accent)',
            'optional': 'var(--warning)'
        };
        return colors[type] || 'var(--text-dim)';
    }

    // ============================================================
    // INSTRUCTOR HELPERS
    // ============================================================

    function getDisciplineInstructors(discipline) {
        if (!discipline || !Array.isArray(discipline.instructorIds)) {
            return [];
        }

        var instructors = [];
        for (var i = 0; i < discipline.instructorIds.length; i++) {
            var instructor = getCharacterById(discipline.instructorIds[i]);
            if (instructor) {
                instructors.push(instructor);
            }
        }
        return instructors;
    }

    function getDisciplineInstructorNames(discipline) {
        var instructors = getDisciplineInstructors(discipline);
        return instructors.map(function(instructor) {
            if (typeof window.getDisplayName === 'function') {
                return window.getDisplayName(instructor);
            }
            return instructor.name || 'Unknown';
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DisciplineCore = {
        // CRUD
        getDiscipline: getDiscipline,
        getDisciplines: getDisciplines,
        getAvailableDisciplines: getAvailableDisciplines,
        createDiscipline: createDiscipline,
        updateDiscipline: updateDiscipline,
        deleteDiscipline: deleteDiscipline,

        // Grading
        validateGradingSystem: validateGradingSystem,
        getGradeLetter: getGradeLetter,
        getDisciplineTypeLabel: getDisciplineTypeLabel,
        getDisciplineTypeColor: getDisciplineTypeColor,

        // Instructors
        getDisciplineInstructors: getDisciplineInstructors,
        getDisciplineInstructorNames: getDisciplineInstructorNames,

        // Validation (exposed for UI)
        validateDiscipline: validateDiscipline
    };

})();
