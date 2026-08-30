/**
 * js/core/curriculum/curriculum-disciplines.js - Discipline CRUD Operations
 * Path: js/core/curriculum/curriculum-disciplines.js
 * 
 * This module provides discipline CRUD operations.
 * 
 * IMPORTANT:
 *   - createDiscipline() and updateDiscipline() return:
 *     { success: true, discipline: cloned }
 *   - deleteDiscipline() returns:
 *     { success: true, deleted: true, name: string }
 *   - All failures return: { success: false, message: string }
 *   - Validation occurs BEFORE mutation using CurriculumValidators
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - Deleting a discipline cascades to schedules, grades, groups, and metadata
 *   - All query results are DEEP CLONED to prevent external mutation
 *   - Unknown fields are rejected in updateDiscipline()
 *   - Shared validators are consumed from CurriculumValidators
 *   - Shared helpers are consumed from CurriculumHelpers
 *   - No fallback validation - validators are required
 *   - startWeek/endWeek are stored as strings (empty = no restriction)
 *   - Discipline type validation is delegated to CurriculumValidators
 * 
 * DEPENDENCIES:
 *   - CurriculumHelpers (for type checking, cloning, logging, ID generation)
 *   - CurriculumValidators (for validation)
 *   - window.getCharacterById (for instructor validation)
 *   - window.getDisplayName (for instructor name display)
 * 
 * LOAD ORDER:
 *   1. curriculum-helpers.js
 *   2. curriculum-validators.js
 *   3. curriculum-disciplines.js
 * 
 * PARSING SEMANTICS:
 *   - Invalid values in parsing helpers return null to signal validation failure
 *   - Empty values are preserved as empty strings or defaults
 *   - Validation occurs BEFORE parsing, so parsing should only see valid values
 */

(function() {
    'use strict';

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__curriculumDisciplinesLoaded) {
        return;
    }
    window.__curriculumDisciplinesLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    var Helpers = window.CurriculumHelpers;
    var Validators = window.CurriculumValidators;

    if (!Helpers) {
        throw new Error('[CurriculumDisciplines] CurriculumHelpers not available.');
    }

    if (!Validators) {
        throw new Error('[CurriculumDisciplines] CurriculumValidators not available.');
    }

    // ============================================================
    // HELPER ALIASES
    // ============================================================

    var isObject = Helpers.isObject;
    var isNonEmptyString = Helpers.isNonEmptyString;
    var deepClone = Helpers.deepClone;
    var generateId = Helpers.generateId;
    var logActivity = Helpers.logActivity;
    var failure = Helpers.failure;
    var successWithEntity = Helpers.successWithEntity;

    // ============================================================
    // PRIVATE HELPERS
    // ============================================================

    function getDataStore() {
        return Helpers.getDataStore();
    }

    function parseDisciplineWeek(value) {
        if (value === undefined || value === null || value === '') {
            return '';
        }
        var parsed = Validators.parsePositiveInteger(value);
        return parsed !== null ? String(parsed) : null;
    }

    function parseOptionalNumber(value) {
        if (value === undefined || value === null || value === '') {
            return '';
        }
        var parsed = Validators.parseNonNegativeNumber(value);
        return parsed !== null ? parsed : null;
    }

    function parseOptionalInteger(value) {
        if (value === undefined || value === null || value === '') {
            return '';
        }
        var parsed = Validators.parseNonNegativeInteger(value);
        return parsed !== null ? parsed : null;
    }

    function parseWeight(value) {
        if (value === undefined || value === null || value === '') {
            return 1;
        }
        var parsed = Validators.parseNonNegativeNumber(value);
        if (parsed === null) {
            return null;
        }
        return Math.round(parsed * 100) / 100;
    }

    function getCharacterByIdSafe(id) {
        if (!isNonEmptyString(id)) {
            return null;
        }

        if (typeof window.getCharacterById !== 'function') {
            return null;
        }

        return window.getCharacterById(id) || null;
    }

    function getCharacterByIdCloned(id) {
        var char = getCharacterByIdSafe(id);
        return char ? deepClone(char) : null;
    }

    // ============================================================
    // DISCIPLINE QUERIES
    // ============================================================

    function getDiscipline(id) {
        if (!isNonEmptyString(id)) {
            return null;
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return null;
        }

        var discipline = data.curriculum.disciplines.find(function(d) {
            return d && String(d.id) === String(id);
        });

        return discipline ? deepClone(discipline) : null;
    }

    function getDisciplines() {
        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
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
        var weekNum = Validators.validateWeek(week);
        if (weekNum === null) {
            return [];
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return [];
        }

        var disciplines = data.curriculum.disciplines.filter(function(d) {
            if (!d || typeof d !== 'object') {
                return false;
            }

            var start = Validators.parsePositiveInteger(d.startWeek);
            var end = Validators.parsePositiveInteger(d.endWeek);

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
        if (!isNonEmptyString(id)) {
            return false;
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return false;
        }

        var target = String(id);

        for (var i = 0; i < data.curriculum.disciplines.length; i++) {
            var d = data.curriculum.disciplines[i];
            if (d && String(d.id) === target) {
                return true;
            }
        }

        return false;
    }

    // ============================================================
    // INSTRUCTOR HELPERS (with cloning for safety)
    // ============================================================

    function getDisciplineInstructors(discipline) {
        if (!discipline || !Array.isArray(discipline.instructorIds)) {
            return [];
        }

        var instructors = [];
        for (var i = 0; i < discipline.instructorIds.length; i++) {
            var instructor = getCharacterByIdCloned(discipline.instructorIds[i]);
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
    // TYPE HELPERS (delegated to validators)
    // ============================================================

    function isValidDisciplineType(type) {
        if (!Validators || typeof Validators.isValidDisciplineType !== 'function') {
            return type === 'mandatory' || type === 'optional';
        }
        return Validators.isValidDisciplineType(type);
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
    // DISCIPLINE CRUD MUTATIONS
    // ============================================================

    function createDiscipline(data) {
        // ---- PHASE 1: VALIDATE INPUT ----
        if (!isObject(data)) {
            return failure('Discipline data must be an object.');
        }

        var validation = Validators.validateDiscipline(data, false);
        if (!validation.valid) {
            return failure(validation.message);
        }

        // ---- PHASE 2: GET STORE ----
        var store = getDataStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        if (!store.curriculum || !Array.isArray(store.curriculum.disciplines)) {
            return failure('Discipline store is corrupted.');
        }

        // ---- PHASE 3: CHECK DUPLICATE ----
        var name = String(data.name).trim();
        var existing = store.curriculum.disciplines.find(function(d) {
            return d && String(d.name || '').toLowerCase() === name.toLowerCase();
        });

        if (existing) {
            return failure('A discipline with this name already exists.');
        }

        // ---- PHASE 4: VALIDATE INSTRUCTORS EXIST ----
        var invalidInstructors = [];
        if (Array.isArray(data.instructorIds)) {
            for (var i = 0; i < data.instructorIds.length; i++) {
                if (!getCharacterByIdSafe(data.instructorIds[i])) {
                    invalidInstructors.push(data.instructorIds[i]);
                }
            }
        }

        if (invalidInstructors.length > 0) {
            return failure('Invalid instructor IDs: ' + invalidInstructors.join(', '));
        }

        // ---- PHASE 5: BUILD DISCIPLINE WITH PARSING ----
        var startWeek = parseDisciplineWeek(data.startWeek);
        if (startWeek === null) {
            return failure('Invalid start week.');
        }

        var endWeek = parseDisciplineWeek(data.endWeek);
        if (endWeek === null) {
            return failure('Invalid end week.');
        }

        var weeklyHours = parseOptionalNumber(data.weeklyHours);
        if (weeklyHours === null) {
            return failure('Invalid weekly hours.');
        }

        var maxStudents = parseOptionalInteger(data.maxStudents);
        if (maxStudents === null) {
            return failure('Invalid max students.');
        }

        var weight = parseWeight(data.weight);
        if (weight === null) {
            return failure('Invalid weight.');
        }

        var discipline = {
            id: generateId('disc'),
            name: name,
            type: data.type || 'mandatory',
            instructorIds: Array.isArray(data.instructorIds) ? data.instructorIds.slice() : [],
            curriculum: data.curriculum || '',
            startWeek: startWeek,
            endWeek: endWeek,
            weeklyHours: weeklyHours,
            maxStudents: maxStudents,
            weight: weight,
            gradingSystem: [],
            createdAt: new Date().toISOString()
        };

        // ---- PHASE 6: VALIDATE AND ADD GRADING SYSTEM ----
        if (data.gradingSystem !== undefined) {
            if (!Array.isArray(data.gradingSystem)) {
                return failure('Grading system must be an array.');
            }

            var gradingResult = Validators.validateGradingSystem(data.gradingSystem);
            if (!gradingResult.valid) {
                return failure(gradingResult.message);
            }

            discipline.gradingSystem = data.gradingSystem.slice();
        }

        // ---- PHASE 7: VALIDATE BUILT OBJECT ----
        var builtValidation = Validators.validateDiscipline(discipline, false);
        if (!builtValidation.valid) {
            return failure('Internal validation failed: ' + builtValidation.message);
        }

        // ---- PHASE 8: BUILD CANDIDATE AND COMMIT ----
        var candidate = deepClone(store.curriculum.disciplines);
        if (candidate === null) {
            return failure('Failed to prepare discipline data.');
        }

        candidate.push(discipline);
        store.curriculum.disciplines = candidate;

        logActivity('Created discipline: ' + discipline.name);
        return successWithEntity('discipline', discipline);
    }

    function updateDiscipline(id, data) {
        // ---- PHASE 1: VALIDATE ID ----
        if (!isNonEmptyString(id)) {
            return failure('Discipline ID is required.');
        }

        // ---- PHASE 2: VALIDATE UPDATE PAYLOAD ----
        if (!isObject(data)) {
            return failure('Updates must be an object.');
        }

        // ---- PHASE 3: REJECT UNKNOWN FIELDS ----
        var allowedFields = {
            name: true,
            type: true,
            instructorIds: true,
            curriculum: true,
            startWeek: true,
            endWeek: true,
            weeklyHours: true,
            maxStudents: true,
            weight: true,
            gradingSystem: true
        };

        for (var key in data) {
            if (!Object.prototype.hasOwnProperty.call(data, key)) {
                continue;
            }
            if (!allowedFields[key]) {
                return failure('Unsupported discipline field: ' + key);
            }
        }

        // ---- PHASE 4: VALIDATE USING SHARED VALIDATORS ----
        var validation = Validators.validateDiscipline(data, true);
        if (!validation.valid) {
            return failure(validation.message);
        }

        // ---- PHASE 5: GET STORE ----
        var store = getDataStore();
        if (!store || !store.curriculum || !Array.isArray(store.curriculum.disciplines)) {
            return failure('No disciplines found.');
        }

        // ---- PHASE 6: FIND DISCIPLINE ----
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

        // ---- PHASE 7: APPLY CHANGES TO CANDIDATE ----
        if (data.name !== undefined) {
            var newName = String(data.name).trim();
            if (!isNonEmptyString(newName)) {
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
            if (!isValidDisciplineType(data.type)) {
                return failure('Invalid discipline type.');
            }
            candidate.type = data.type;
            hasChanges = true;
        }

        if (data.instructorIds !== undefined) {
            if (!Array.isArray(data.instructorIds)) {
                return failure('Instructor IDs must be an array.');
            }

            var invalidInstructors = [];
            for (var i = 0; i < data.instructorIds.length; i++) {
                if (!getCharacterByIdSafe(data.instructorIds[i])) {
                    invalidInstructors.push(data.instructorIds[i]);
                }
            }

            if (invalidInstructors.length > 0) {
                return failure('Invalid instructor IDs: ' + invalidInstructors.join(', '));
            }

            candidate.instructorIds = data.instructorIds.slice();
            hasChanges = true;
        }

        if (data.curriculum !== undefined) {
            candidate.curriculum = data.curriculum;
            hasChanges = true;
        }

        if (data.startWeek !== undefined) {
            var parsedStart = parseDisciplineWeek(data.startWeek);
            if (parsedStart === null) {
                return failure('Invalid start week.');
            }
            candidate.startWeek = parsedStart;
            hasChanges = true;
        }

        if (data.endWeek !== undefined) {
            var parsedEnd = parseDisciplineWeek(data.endWeek);
            if (parsedEnd === null) {
                return failure('Invalid end week.');
            }
            candidate.endWeek = parsedEnd;
            hasChanges = true;
        }

        if (data.weeklyHours !== undefined) {
            var parsedHours = parseOptionalNumber(data.weeklyHours);
            if (parsedHours === null) {
                return failure('Invalid weekly hours.');
            }
            candidate.weeklyHours = parsedHours;
            hasChanges = true;
        }

        if (data.maxStudents !== undefined) {
            var parsedStudents = parseOptionalInteger(data.maxStudents);
            if (parsedStudents === null) {
                return failure('Invalid max students.');
            }
            candidate.maxStudents = parsedStudents;
            hasChanges = true;
        }

        if (data.weight !== undefined) {
            var parsedWeight = parseWeight(data.weight);
            if (parsedWeight === null) {
                return failure('Invalid weight.');
            }
            candidate.weight = parsedWeight;
            hasChanges = true;
        }

        if (data.gradingSystem !== undefined) {
            if (!Array.isArray(data.gradingSystem)) {
                return failure('Grading system must be an array.');
            }

            var gradingResult = Validators.validateGradingSystem(data.gradingSystem);
            if (!gradingResult.valid) {
                return failure(gradingResult.message);
            }

            candidate.gradingSystem = data.gradingSystem.slice();
            hasChanges = true;
        }

        // ---- PHASE 8: NO CHANGES ----
        if (!hasChanges) {
            return successWithEntity('discipline', discipline);
        }

        // ---- PHASE 9: VALIDATE CANDIDATE ----
        var builtValidation = Validators.validateDiscipline(candidate, false);
        if (!builtValidation.valid) {
            return failure('Internal validation failed: ' + builtValidation.message);
        }

        // ---- PHASE 10: BUILD CANDIDATE ARRAY AND COMMIT ----
        var candidateArray = deepClone(store.curriculum.disciplines);
        if (candidateArray === null) {
            return failure('Failed to prepare discipline data.');
        }

        candidateArray[index] = candidate;
        store.curriculum.disciplines = candidateArray;

        logActivity('Updated discipline: ' + candidate.name);
        return successWithEntity('discipline', candidate);
    }

    function deleteDiscipline(id) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(id)) {
            return failure('Discipline ID is required.');
        }

        // ---- PHASE 2: GET STORE ----
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

        // ---- PHASE 3: CLONE CURRICULUM FOR TRANSACTIONAL CLEANUP ----
        var curriculumClone = deepClone(store.curriculum);
        if (curriculumClone === null) {
            return failure('Failed to prepare deletion. Please try again.');
        }

        try {
            // ---- PHASE 4: REMOVE FROM SCHEDULES ----
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

            // ---- PHASE 5: REMOVE FROM GRADES ----
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

            // ---- PHASE 6: REMOVE FROM AUTO-GROUPS ----
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

            // ---- PHASE 7: REMOVE FROM DISCIPLINE GROUPS ----
            if (curriculumClone.disciplineGroups) {
                delete curriculumClone.disciplineGroups[id];
            }

            // ---- PHASE 8: REMOVE DISCIPLINE ----
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
            return failure('Deletion failed during cleanup: ' + e.message);
        }

        // ---- PHASE 9: COMMIT ----
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
