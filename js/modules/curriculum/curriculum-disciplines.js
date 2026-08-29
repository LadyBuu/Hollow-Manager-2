/**
 * js/core/curriculum/curriculum-disciplines.js - Discipline CRUD Operations
 * Path: js/core/curriculum/curriculum-disciplines.js
 * 
 * This module provides discipline CRUD operations.
 * 
 * IMPORTANT:
 *   - All functions return { success: boolean, message?: string, data?: any }
 *   - Validation occurs BEFORE mutation
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - Deleting a discipline cascades to schedules, grades, groups, and metadata
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__curriculumDisciplinesLoaded) {
        return;
    }
    window.__curriculumDisciplinesLoaded = true;

    // ============================================================
    // PRIVATE HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function parsePositiveInteger(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        return Number.isInteger(num) && num >= 1 ? num : null;
    }

    function parsePositiveNumber(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        return isFinite(num) && num >= 0 ? num : null;
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function getDisciplineStore() {
        var data = getDataStore();
        if (!data) {
            return null;
        }
        if (!data.curriculum || typeof data.curriculum !== 'object' || Array.isArray(data.curriculum)) {
            return null;
        }
        if (!Array.isArray(data.curriculum.disciplines)) {
            return null;
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
        if (!data || !Array.isArray(data.characters)) {
            return null;
        }
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

    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                console.error('CurriculumDisciplines: structuredClone failed:', e);
                return null;
            }
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('CurriculumDisciplines: JSON clone failed:', e);
            return null;
        }
    }

    // ============================================================
    // RESULT HELPERS
    // ============================================================

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    function successWithDiscipline(discipline) {
        var cloned = deepClone(discipline);
        if (cloned === null) {
            return failure('Failed to clone discipline data.');
        }
        return { success: true, discipline: cloned };
    }

    // ============================================================
    // VALIDATION WRAPPERS
    // ============================================================

    function validateDiscipline(data, isPartial) {
        if (typeof window.CurriculumValidators !== 'undefined' &&
            typeof window.CurriculumValidators.validateDiscipline === 'function') {
            return window.CurriculumValidators.validateDiscipline(data, isPartial);
        }

        // Basic fallback
        if (!data || typeof data !== 'object') {
            return { valid: false, message: 'Discipline data must be an object.' };
        }

        if (!isPartial) {
            if (!isNonEmptyString(data.name)) {
                return { valid: false, message: 'Discipline name is required.' };
            }
        }

        return { valid: true };
    }

    function validateGradingSystem(system) {
        if (typeof window.CurriculumValidators !== 'undefined' &&
            typeof window.CurriculumValidators.validateGradingSystem === 'function') {
            return window.CurriculumValidators.validateGradingSystem(system);
        }

        if (!Array.isArray(system)) {
            return { valid: false, message: 'Grading system must be an array.' };
        }

        return { valid: true };
    }

    // ============================================================
    // DISCIPLINE QUERIES
    // ============================================================

    function getDiscipline(id) {
        if (!isNonEmptyString(id)) {
            return null;
        }
        var data = getDisciplineStore();
        if (!data) {
            return null;
        }
        var discipline = data.curriculum.disciplines.find(function(d) {
            return d && String(d.id) === String(id);
        });
        return discipline ? deepClone(discipline) : null;
    }

    function getDisciplines() {
        var data = getDisciplineStore();
        if (!data) {
            return [];
        }
        var result = [];
        for (var i = 0; i < data.curriculum.disciplines.length; i++) {
            var cloned = deepClone(data.curriculum.disciplines[i]);
            if (cloned !== null) {
                result.push(cloned);
            }
        }
        return result;
    }

    function getAvailableDisciplines(week) {
        var weekNum = parsePositiveInteger(week);
        if (weekNum === null) {
            return [];
        }
        var data = getDisciplineStore();
        if (!data) {
            return [];
        }
        var disciplines = data.curriculum.disciplines.filter(function(d) {
            if (!d || typeof d !== 'object') {
                return false;
            }
            var start = parsePositiveInteger(d.startWeek);
            var end = parsePositiveInteger(d.endWeek);
            if (start !== null && start > weekNum) {
                return false;
            }
            if (end !== null && end < weekNum) {
                return false;
            }
            return true;
        });
        var result = [];
        for (var i = 0; i < disciplines.length; i++) {
            var cloned = deepClone(disciplines[i]);
            if (cloned !== null) {
                result.push(cloned);
            }
        }
        return result;
    }

    function disciplineExists(id) {
        return getDiscipline(id) !== null;
    }

    // ============================================================
    // DISCIPLINE CRUD MUTATIONS
    // ============================================================

    function createDiscipline(data) {
        var validation = validateDiscipline(data, false);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var store = getDisciplineStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        var name = String(data.name).trim();
        var existing = store.curriculum.disciplines.find(function(d) {
            return d && String(d.name || '').toLowerCase() === name.toLowerCase();
        });

        if (existing) {
            return failure('A discipline with this name already exists.');
        }

        // Validate instructors exist
        var invalidInstructors = [];
        if (Array.isArray(data.instructorIds)) {
            for (var i = 0; i < data.instructorIds.length; i++) {
                if (!getCharacterById(data.instructorIds[i])) {
                    invalidInstructors.push(data.instructorIds[i]);
                }
            }
        }

        if (invalidInstructors.length > 0) {
            return failure('Invalid instructor IDs: ' + invalidInstructors.join(', '));
        }

        // Build discipline object
        var discipline = {
            id: generateId('disc'),
            name: name,
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
                ? Math.round(Number(data.weeklyHours) * 10) / 10
                : '',
            maxStudents: data.maxStudents !== undefined && data.maxStudents !== null && data.maxStudents !== ''
                ? Number(data.maxStudents)
                : '',
            weight: data.weight !== undefined && data.weight !== null && data.weight !== ''
                ? Math.round(Number(data.weight) * 100) / 100
                : 1,
            gradingSystem: [],
            createdAt: new Date().toISOString()
        };

        // Validate and add grading system
        if (data.gradingSystem !== undefined && Array.isArray(data.gradingSystem)) {
            var gradingResult = validateGradingSystem(data.gradingSystem);
            if (!gradingResult.valid) {
                return failure(gradingResult.message);
            }
            discipline.gradingSystem = data.gradingSystem.slice();
        }

        var candidate = deepClone(store.curriculum.disciplines);
        if (candidate === null) {
            return failure('Failed to prepare discipline data.');
        }

        candidate.push(discipline);
        store.curriculum.disciplines = candidate;

        logActivity('Created discipline: ' + discipline.name);
        return successWithDiscipline(discipline);
    }

    function updateDiscipline(id, data) {
        if (!isNonEmptyString(id)) {
            return failure('Discipline ID is required.');
        }

        var validation = validateDiscipline(data, true);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var store = getDataStore();
        if (!store || !store.curriculum || !Array.isArray(store.curriculum.disciplines)) {
            return failure('No disciplines found.');
        }

        var index = store.curriculum.disciplines.findIndex(function(d) {
            return d && String(d.id) === String(id);
        });

        if (index === -1) {
            return failure('Discipline not found.');
        }

        var discipline = store.curriculum.disciplines[index];
        var candidate = deepClone(discipline);

        if (candidate === null) {
            return failure('Failed to clone discipline data.');
        }

        var hasChanges = false;

        if (data.name !== undefined) {
            var newName = String(data.name).trim();
            if (!newName) {
                return failure('Discipline name cannot be empty.');
            }

            var existing = store.curriculum.disciplines.find(function(d) {
                return d && String(d.id) !== String(id) &&
                    String(d.name || '').toLowerCase() === newName.toLowerCase();
            });

            if (existing) {
                return failure('A discipline with this name already exists.');
            }

            candidate.name = newName;
            hasChanges = true;
        }

        if (data.type !== undefined) {
            candidate.type = data.type;
            hasChanges = true;
        }

        if (data.instructorIds !== undefined) {
            // Validate instructors exist
            var invalidInstructors = [];
            for (var i = 0; i < data.instructorIds.length; i++) {
                if (!getCharacterById(data.instructorIds[i])) {
                    invalidInstructors.push(data.instructorIds[i]);
                }
            }

            if (invalidInstructors.length > 0) {
                return failure('Invalid instructor IDs: ' + invalidInstructors.join(', '));
            }

            candidate.instructorIds = Array.isArray(data.instructorIds) ? data.instructorIds.slice() : [];
            hasChanges = true;
        }

        if (data.curriculum !== undefined) {
            candidate.curriculum = data.curriculum;
            hasChanges = true;
        }

        if (data.startWeek !== undefined) {
            candidate.startWeek = data.startWeek !== '' ? String(data.startWeek) : '';
            hasChanges = true;
        }

        if (data.endWeek !== undefined) {
            candidate.endWeek = data.endWeek !== '' ? String(data.endWeek) : '';
            hasChanges = true;
        }

        if (data.weeklyHours !== undefined) {
            candidate.weeklyHours = data.weeklyHours !== '' ? Math.round(Number(data.weeklyHours) * 10) / 10 : '';
            hasChanges = true;
        }

        if (data.maxStudents !== undefined) {
            candidate.maxStudents = data.maxStudents !== '' ? Number(data.maxStudents) : '';
            hasChanges = true;
        }

        if (data.weight !== undefined) {
            candidate.weight = data.weight !== '' ? Math.round(Number(data.weight) * 100) / 100 : 1;
            hasChanges = true;
        }

        if (data.gradingSystem !== undefined) {
            var gradingResult = validateGradingSystem(data.gradingSystem);
            if (!gradingResult.valid) {
                return failure(gradingResult.message);
            }
            candidate.gradingSystem = Array.isArray(data.gradingSystem) ? data.gradingSystem.slice() : [];
            hasChanges = true;
        }

        if (!hasChanges) {
            return successWithDiscipline(discipline);
        }

        var candidateArray = deepClone(store.curriculum.disciplines);
        if (candidateArray === null) {
            return failure('Failed to prepare discipline data.');
        }

        candidateArray[index] = candidate;
        store.curriculum.disciplines = candidateArray;

        logActivity('Updated discipline: ' + candidate.name);
        return successWithDiscipline(candidate);
    }

    function deleteDiscipline(id) {
        if (!isNonEmptyString(id)) {
            return failure('Discipline ID is required.');
        }

        var store = getDataStore();
        if (!store || !store.curriculum || !Array.isArray(store.curriculum.disciplines)) {
            return failure('No disciplines found.');
        }

        var index = store.curriculum.disciplines.findIndex(function(d) {
            return d && String(d.id) === String(id);
        });

        if (index === -1) {
            return failure('Discipline not found.');
        }

        var discipline = store.curriculum.disciplines[index];
        var name = discipline.name;

        // Clone the entire curriculum structure for transactional cleanup
        var curriculumClone = deepClone(store.curriculum);
        if (curriculumClone === null) {
            return failure('Failed to prepare deletion. Please try again.');
        }

        try {
            // Remove from schedules
            if (curriculumClone.schedules && isObject(curriculumClone.schedules)) {
                for (var studentId in curriculumClone.schedules) {
                    if (!Object.prototype.hasOwnProperty.call(curriculumClone.schedules, studentId)) {
                        continue;
                    }
                    var studentSchedule = curriculumClone.schedules[studentId];
                    if (!isObject(studentSchedule)) {
                        continue;
                    }

                    for (var week in studentSchedule) {
                        if (!Object.prototype.hasOwnProperty.call(studentSchedule, week)) {
                            continue;
                        }
                        var weekSchedule = studentSchedule[week];
                        if (!isObject(weekSchedule)) {
                            continue;
                        }

                        for (var day in weekSchedule) {
                            if (!Object.prototype.hasOwnProperty.call(weekSchedule, day)) {
                                continue;
                            }
                            var daySchedule = weekSchedule[day];
                            if (!isObject(daySchedule)) {
                                continue;
                            }

                            for (var hour in daySchedule) {
                                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) {
                                    continue;
                                }
                                if (String(daySchedule[hour]) === String(id)) {
                                    delete daySchedule[hour];

                                    var key = studentId + '_' + week + '_' + day + '_' + hour;

                                    if (curriculumClone.classInstructors) {
                                        delete curriculumClone.classInstructors[key];
                                    }
                                    if (curriculumClone.classLabels) {
                                        delete curriculumClone.classLabels[key];
                                    }
                                    if (curriculumClone.classGroupLabels) {
                                        delete curriculumClone.classGroupLabels[key];
                                    }
                                    if (curriculumClone.classDurations) {
                                        delete curriculumClone.classDurations[key];
                                    }
                                    if (curriculumClone.classLocations) {
                                        delete curriculumClone.classLocations[key];
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Remove from grades
            if (curriculumClone.grades && isObject(curriculumClone.grades)) {
                for (var studentId in curriculumClone.grades) {
                    if (!Object.prototype.hasOwnProperty.call(curriculumClone.grades, studentId)) {
                        continue;
                    }
                    var studentGrades = curriculumClone.grades[studentId];
                    if (!isObject(studentGrades)) {
                        continue;
                    }

                    for (var week in studentGrades) {
                        if (!Object.prototype.hasOwnProperty.call(studentGrades, week)) {
                            continue;
                        }
                        var weekGrades = studentGrades[week];
                        if (isObject(weekGrades)) {
                            delete weekGrades[id];
                        }
                    }
                }
            }

            // Remove from auto-groups
            if (curriculumClone.autoGroups && isObject(curriculumClone.autoGroups)) {
                for (var key in curriculumClone.autoGroups) {
                    if (!Object.prototype.hasOwnProperty.call(curriculumClone.autoGroups, key)) {
                        continue;
                    }
                    var group = curriculumClone.autoGroups[key];
                    if (group && String(group.disciplineId) === String(id)) {
                        delete curriculumClone.autoGroups[key];
                    }
                }
            }

            // Remove from discipline groups
            if (curriculumClone.disciplineGroups) {
                delete curriculumClone.disciplineGroups[id];
            }

            // Remove the discipline itself
            if (!Array.isArray(curriculumClone.disciplines)) {
                return failure('Corrupted discipline data structure.');
            }

            var cloneIndex = curriculumClone.disciplines.findIndex(function(d) {
                return d && String(d.id) === String(id);
            });

            if (cloneIndex === -1) {
                return failure('Discipline disappeared during deletion preparation.');
            }

            curriculumClone.disciplines.splice(cloneIndex, 1);

        } catch (e) {
            console.error('CurriculumDisciplines.deleteDiscipline: Transaction failed:', e);
            return failure('Deletion failed during cleanup: ' + e.message);
        }

        // Commit
        var originalCurriculum = store.curriculum;
        var keys = Object.keys(originalCurriculum);

        for (var i = 0; i < keys.length; i++) {
            delete originalCurriculum[keys[i]];
        }

        Object.assign(originalCurriculum, curriculumClone);

        logActivity('Deleted discipline: ' + name);
        return { success: true, deleted: true, name: name };
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

    function isDisciplineInstructor(discipline, characterId) {
        if (!discipline || !Array.isArray(discipline.instructorIds)) {
            return false;
        }
        return discipline.instructorIds.some(function(id) {
            return String(id) === String(characterId);
        });
    }

    // ============================================================
    // TYPE HELPERS
    // ============================================================

    function isValidDisciplineType(type) {
        return type === 'mandatory' || type === 'optional';
    }

    function getDisciplineTypeLabel(type) {
        var labels = {
            'mandatory': 'Mandatory',
            'optional': 'Optional'
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
    // EXPOSE
    // ============================================================

    // Queries
    window.getDiscipline = getDiscipline;
    window.getDisciplines = getDisciplines;
    window.getAvailableDisciplines = getAvailableDisciplines;
    window.disciplineExists = disciplineExists;

    // Mutations
    window.createDiscipline = createDiscipline;
    window.updateDiscipline = updateDiscipline;
    window.deleteDiscipline = deleteDiscipline;

    // Instructor helpers
    window.getDisciplineInstructors = getDisciplineInstructors;
    window.getDisciplineInstructorNames = getDisciplineInstructorNames;
    window.isDisciplineInstructor = isDisciplineInstructor;

    // Type helpers
    window.isValidDisciplineType = isValidDisciplineType;
    window.getDisciplineTypeLabel = getDisciplineTypeLabel;
    window.getDisciplineTypeColor = getDisciplineTypeColor;

})();
