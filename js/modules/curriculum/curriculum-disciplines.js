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
 *   - No fallback validation - validators are required
 *   - startWeek/endWeek are stored as strings (empty = no restriction)
 *   - Discipline type validation is delegated to CurriculumValidators
 * 
 * REQUIRED DEPENDENCIES:
 *   - window.CurriculumValidators (for validation)
 *   - window.getCharacterById (for instructor validation)
 *   - window.getDisplayName (for instructor name display)
 *   - window.logActivity (for activity logging)
 * 
 * PARSING SEMANTICS:
 *   - Invalid values in parsing helpers return null to signal validation failure
 *   - Empty values are preserved as empty strings or defaults
 *   - Validation occurs BEFORE parsing, so parsing should only see valid values
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__curriculumDisciplinesLoaded) {
        return;
    }
    window.__curriculumDisciplinesLoaded = true;

    // ============================================================
    // VALIDATOR DEPENDENCIES
    // ============================================================

    var Validators = window.CurriculumValidators;

    if (!Validators) {
        console.error('[CurriculumDisciplines] CurriculumValidators not available.');
        return;
    }

    // ============================================================
    // PRIVATE HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function logActivity(message, type) {
        type = type || 'info';
        if (typeof window.logActivity === 'function') {
            window.logActivity(message, type);
        }
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

    /**
     * Parse a discipline week value for storage.
     * Returns null if value is invalid (should be caught by validation).
     * Returns empty string for undefined/null/empty.
     * Returns string for valid positive integers.
     */
    function parseDisciplineWeek(value) {
        if (value === undefined || value === null || value === '') {
            return '';
        }
        var parsed = Validators.parsePositiveInteger(value);
        return parsed !== null ? String(parsed) : null;
    }

    /**
     * Parse a numeric field for storage.
     * Returns null if value is invalid (should be caught by validation).
     * Returns empty string for undefined/null/empty.
     * Returns number for valid non-negative numbers.
     */
    function parseOptionalNumber(value) {
        if (value === undefined || value === null || value === '') {
            return '';
        }
        var parsed = Validators.parseNonNegativeNumber(value);
        return parsed !== null ? parsed : null;
    }

    /**
     * Parse an integer field for storage.
     * Returns null if value is invalid (should be caught by validation).
     * Returns empty string for undefined/null/empty.
     * Returns number for valid non-negative integers.
     */
    function parseOptionalInteger(value) {
        if (value === undefined || value === null || value === '') {
            return '';
        }
        var parsed = Validators.parseNonNegativeInteger(value);
        return parsed !== null ? parsed : null;
    }

    /**
     * Parse a weight field for storage.
     * Returns null if value is invalid (should be caught by validation).
     * Returns 1 for undefined/null/empty (safe default).
     * Returns number for valid numbers (rounded to 2 decimals).
     */
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

    /**
     * Get a character by ID.
     * REQUIRED DEPENDENCY: window.getCharacterById must be available.
     */
    function getCharacterByIdSafe(id) {
        if (!Validators.isNonEmptyString(id)) {
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
    // RESULT HELPERS
    // ============================================================

    function failure(message) {
        return { success: false, message: message };
    }

    function successWithDiscipline(discipline) {
        var cloned = deepClone(discipline);
        if (cloned === null) {
            return failure('Failed to clone discipline data.');
        }
        return { success: true, discipline: cloned };
    }

    // ============================================================
    // DISCIPLINE QUERIES
    // ============================================================

    function getDiscipline(id) {
        if (!Validators.isNonEmptyString(id)) {
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
        if (!Validators.isNonEmptyString(id)) {
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
        // ---- PHASE 1: VALIDATE INPUT USING SHARED VALIDATORS ----
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
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
        return successWithDiscipline(discipline);
    }

    function updateDiscipline(id, data) {
        // ---- PHASE 1: VALIDATE ID ----
        if (!Validators.isNonEmptyString(id)) {
            return failure('Discipline ID is required.');
        }

        // ---- PHASE 2: VALIDATE UPDATE PAYLOAD ----
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
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
            if (!Validators.isNonEmptyString(newName)) {
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
            return successWithDiscipline(discipline);
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
        return successWithDiscipline(candidate);
    }

    function deleteDiscipline(id) {
        if (!Validators.isNonEmptyString(id)) {
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
