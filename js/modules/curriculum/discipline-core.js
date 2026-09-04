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
 *   - All MUTATION operations return { success: boolean, message?: string, data?: any }
 *   - Query/helper functions return their documented value types
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation (candidate-based approach)
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - Query results are DEEP CLONED to prevent external mutation
 *   - deepClone() FAILS SAFELY: returns null on failure, never a live reference
 * 
 * STRUCTURE INITIALISATION NOTE:
 *   - createDiscipline() may initialise missing curriculum structure if needed.
 *   - This is a REPAIR operation, not a mutation of domain data.
 *   - This is explicitly permitted and documented.
 * 
 * MUTATION INVARIANT:
 *   - All mutations use candidate-based validation:
 *     1. Build candidate object (clone)
 *     2. Validate candidate
 *     3. If valid, apply to data store
 *     4. If invalid, return error WITHOUT mutating
 * 
 * DELETION SEMANTICS:
 *   - Provides TRANSACTIONAL CLEANUP with commit:
 *     1. Clones entire curriculum structure
 *     2. All cleanup performed against clone
 *     3. If cleanup succeeds, commit changes (preserving object identity)
 *     4. If cleanup fails (exception), original data untouched
 *   - The commit assumes curriculum is a plain mutable data object
 *   - In practice, Object.assign() on plain objects is extremely reliable
 *   - Object identity of curriculum is preserved during commit
 * 
 * GRADING SYSTEM VALIDATION:
 *   - Labels must be unique (case-insensitive)
 *   - Ranges must not overlap
 *   - Min must be <= max
 *   - Values must be between 0 and 100
 *   - Coverage of 0-100 is NOT required (intentional design)
 *   - Grading systems are normalised: input accepts 'letter' or 'label',
 *     but storage uses 'label' as canonical
 *   - getGradeLetter() supports legacy 'letter' fields for backward compatibility
 * 
 * DEPENDENCIES:
 *   - window.data (global state)
 *   - window.getCharacterById (from core-utils.js)
 *   - window.CoreUtils (from core-utils.js)
 *   - window.MutationUtils (from mutation-utils.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__disciplineCoreLoaded) {
        return;
    }
    window.__disciplineCoreLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // Core dependencies
        var required = ['getCharacterById'];
        required.forEach(function(name) {
            if (typeof window[name] !== 'function') {
                missing.push(name);
            }
        });

        // Check for CoreUtils
        if (!window.CoreUtils || typeof window.CoreUtils.deepClone !== 'function') {
            missing.push('CoreUtils.deepClone');
        }

        if (missing.length > 0) {
            console.warn('DisciplineCore: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

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
        if (!data) return null;
        if (!data.curriculum || typeof data.curriculum !== 'object' || Array.isArray(data.curriculum)) {
            return null;
        }
        if (!Array.isArray(data.curriculum.disciplines)) {
            return null;
        }
        return data;
    }

    /**
     * Ensure the discipline store structure exists.
     * This is a REPAIR operation - it initialises missing structure.
     * It is NOT a domain mutation and is explicitly permitted.
     */
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
        if (window.CoreUtils && typeof window.CoreUtils.generateId === 'function') {
            return window.CoreUtils.generateId(prefix || 'disc');
        }
        prefix = prefix || 'disc';
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return prefix + '_' + window.crypto.randomUUID();
        }
        return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    }

    /**
     * Deep clone a value. FAILS SAFELY - returns null on failure.
     * This guarantees that query results are never live references.
     */
    function deepClone(value) {
        if (window.CoreUtils && typeof window.CoreUtils.deepClone === 'function') {
            return window.CoreUtils.deepClone(value);
        }

        if (value === null || typeof value !== 'object') {
            return value;
        }

        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                console.error('DisciplineCore: structuredClone failed:', e);
                return null;
            }
        }

        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('DisciplineCore: JSON clone failed:', e);
            return null;
        }
    }

    // ============================================================
    // RESULT HELPERS
    // ============================================================

    function success(data) {
        return {
            success: true,
            data: data
        };
    }

    function failure(message) {
        return {
            success: false,
            message: message
        };
    }

    function successWithDiscipline(discipline) {
        var cloned = deepClone(discipline);

        if (cloned === null) {
            return failure('Failed to clone discipline data.');
        }

        return {
            success: true,
            discipline: cloned
        };
    }

    // ============================================================
    // GRADING SYSTEM VALIDATION
    // ============================================================

    /**
     * Validate and normalise a grading system.
     * Input can use 'letter' or 'label' - output always uses 'label'.
     */
    function validateGradingSystem(system) {
        if (!Array.isArray(system)) {
            return failure('Grading system must be an array.');
        }

        if (system.length === 0) {
            return success([]);
        }

        var normalized = [];

        for (var i = 0; i < system.length; i++) {
            var g = system[i];
            if (!g || typeof g !== 'object') {
                return failure('Invalid grade entry at index ' + i + '.');
            }

            // Accept both 'letter' and 'label' for input
            var label = String(g.label || g.letter || '').trim();
            if (!label) {
                return failure('Grade label is required at index ' + i + '.');
            }

            var min = Number(g.min);
            var max = Number(g.max);

            if (!isSafeInteger(min) || !isSafeInteger(max) || min < 0 || max > 100 || min > max) {
                return failure('Invalid grade range at index ' + i + '.');
            }

            normalized.push({ label: label, min: min, max: max });
        }

        // Check for overlapping ranges
        for (var i = 0; i < normalized.length; i++) {
            for (var j = i + 1; j < normalized.length; j++) {
                var a = normalized[i];
                var b = normalized[j];
                if (a.min <= b.max && b.min <= a.max) {
                    return failure('Grading ranges for "' + a.label + '" and "' + b.label + '" overlap.');
                }
            }
        }

        // Check for duplicate labels (case-insensitive)
        var labels = new Set();
        for (var i = 0; i < normalized.length; i++) {
            var label = normalized[i].label.toUpperCase();
            if (labels.has(label)) {
                return failure('Duplicate grade label "' + normalized[i].label + '".');
            }
            labels.add(label);
        }

        return success(normalized);
    }

    // ============================================================
    // DISCIPLINE VALIDATION
    // ============================================================

    /**
     * Validate discipline data.
     * 
     * @param {object} data - Discipline data to validate
     * @param {boolean} isPartial - If true, only validate fields that are present
     * @returns {object} { success: boolean, message?: string }
     * 
     * NOTE: Partial validation does NOT check cross-field invariants
     * (e.g., startWeek <= endWeek). Those are checked in candidate validation.
     * This is intentional: partial validation is for individual field checks
     * during update operations, while full validation is for complete candidates.
     * 
     * NOTE: This function validates but does NOT normalise numeric values.
     * Normalisation happens during object construction in create/update.
     */
    function validateDiscipline(data, isPartial) {
        if (!isObject(data)) {
            return failure('Discipline data must be an object.');
        }

        // Name validation
        if (!isPartial) {
            if (!isNonEmptyString(data.name)) {
                return failure('Discipline name is required.');
            }
        } else {
            if (data.name !== undefined && !isNonEmptyString(data.name)) {
                return failure('Discipline name cannot be empty.');
            }
        }

        // Type validation
        var validTypes = ['mandatory', 'optional'];
        if (!isPartial) {
            if (!data.type || validTypes.indexOf(data.type) === -1) {
                return failure('Valid discipline type is required.');
            }
        } else {
            if (data.type !== undefined && validTypes.indexOf(data.type) === -1) {
                return failure('Valid discipline type is required.');
            }
        }

        // Instructor validation
        var instructorCheck = function(ids) {
            if (!Array.isArray(ids) || ids.length === 0) {
                return failure('At least one instructor is required.');
            }

            var seen = new Set();
            var invalid = [];

            for (var i = 0; i < ids.length; i++) {
                // Handle null/undefined gracefully
                if (ids[i] === undefined || ids[i] === null) {
                    invalid.push('(empty)');
                    continue;
                }

                var key = String(ids[i]);

                if (seen.has(key)) {
                    return failure('Duplicate instructor ID: ' + ids[i] + '.');
                }
                seen.add(key);

                if (!getCharacterById(ids[i])) {
                    invalid.push(ids[i]);
                }
            }

            if (invalid.length > 0) {
                return failure('Invalid instructor IDs: ' + invalid.join(', '));
            }
            return success(null);
        };

        if (!isPartial) {
            var result = instructorCheck(data.instructorIds);
            if (!result.success) return result;
        } else {
            if (data.instructorIds !== undefined) {
                var result = instructorCheck(data.instructorIds);
                if (!result.success) return result;
            }
        }

        // Week validation
        function validateWeek(value, label) {
            if (value === undefined || value === null || value === '') {
                return success(null);
            }
            var num = parsePositiveInteger(value);
            if (num === null || num < 1 || num > 52) {
                return failure(label + ' must be between 1 and 52.');
            }
            return success(num);
        }

        if (!isPartial) {
            var startResult = validateWeek(data.startWeek, 'Start week');
            if (!startResult.success) return startResult;
            var endResult = validateWeek(data.endWeek, 'End week');
            if (!endResult.success) return endResult;

            // Cross-field check (only in full validation)
            if (data.startWeek && data.endWeek) {
                var start = parsePositiveInteger(data.startWeek);
                var end = parsePositiveInteger(data.endWeek);
                if (start !== null && end !== null && start > end) {
                    return failure('Start week must be before end week.');
                }
            }
        } else {
            if (data.startWeek !== undefined) {
                var startResult = validateWeek(data.startWeek, 'Start week');
                if (!startResult.success) return startResult;
            }
            if (data.endWeek !== undefined) {
                var endResult = validateWeek(data.endWeek, 'End week');
                if (!endResult.success) return endResult;
            }
        }

        // Weekly hours validation
        function validateHours(value) {
            if (value === undefined || value === null || value === '') {
                return success(null);
            }
            var num = parsePositiveNumber(value);
            if (num === null || num < 0 || num > 40) {
                return failure('Weekly hours must be between 0 and 40.');
            }
            return success(Math.round(num * 10) / 10);
        }

        if (!isPartial) {
            var hoursResult = validateHours(data.weeklyHours);
            if (!hoursResult.success) return hoursResult;
        } else {
            if (data.weeklyHours !== undefined) {
                var hoursResult = validateHours(data.weeklyHours);
                if (!hoursResult.success) return hoursResult;
            }
        }

        // Max students validation
        function validateMaxStudents(value) {
            if (value === undefined || value === null || value === '') {
                return success(null);
            }
            var num = parsePositiveInteger(value);
            if (num === null || num < 1 || num > 100) {
                return failure('Max students must be between 1 and 100.');
            }
            return success(num);
        }

        if (!isPartial) {
            var studentsResult = validateMaxStudents(data.maxStudents);
            if (!studentsResult.success) return studentsResult;
        } else {
            if (data.maxStudents !== undefined) {
                var studentsResult = validateMaxStudents(data.maxStudents);
                if (!studentsResult.success) return studentsResult;
            }
        }

        // Weight validation
        function validateWeight(value) {
            if (value === undefined || value === null || value === '') {
                return success(null);
            }
            var num = parsePositiveNumber(value);
            if (num === null || num < 0.1 || num > 10) {
                return failure('Weight must be between 0.1 and 10.');
            }
            return success(Math.round(num * 100) / 100);
        }

        if (!isPartial) {
            var weightResult = validateWeight(data.weight);
            if (!weightResult.success) return weightResult;
        } else {
            if (data.weight !== undefined) {
                var weightResult = validateWeight(data.weight);
                if (!weightResult.success) return weightResult;
            }
        }

        // Grading system validation
        if (!isPartial) {
            if (data.gradingSystem !== undefined) {
                var gradingResult = validateGradingSystem(data.gradingSystem);
                if (!gradingResult.success) return gradingResult;
            }
        } else {
            if (data.gradingSystem !== undefined) {
                var gradingResult = validateGradingSystem(data.gradingSystem);
                if (!gradingResult.success) return gradingResult;
            }
        }

        return success(null);
    }

    // ============================================================
    // DISCIPLINE QUERIES (with deep cloning for safety)
    // ============================================================

    function getDiscipline(id) {
        if (!isNonEmptyString(id)) return null;

        var data = getDisciplineStore();
        if (!data) return null;

        var discipline = data.curriculum.disciplines.find(function(d) {
            return d && String(d.id) === String(id);
        });

        if (!discipline) return null;

        return deepClone(discipline);
    }

    function getDisciplines() {
        var data = getDisciplineStore();
        if (!data) return [];

        var disciplines = data.curriculum.disciplines;
        var result = [];

        for (var i = 0; i < disciplines.length; i++) {
            var cloned = deepClone(disciplines[i]);
            if (cloned === null) {
                console.error('DisciplineCore: Failed to clone discipline at index ' + i);
                return [];
            }
            result.push(cloned);
        }

        return result;
    }

    function getAvailableDisciplines(week) {
        var weekNum = parsePositiveInteger(week);
        if (weekNum === null) {
            return [];
        }

        var data = getDisciplineStore();
        if (!data) return [];

        var disciplines = data.curriculum.disciplines.filter(function(d) {
            if (!d || typeof d !== 'object') return false;

            var start = parsePositiveInteger(d.startWeek);
            var end = parsePositiveInteger(d.endWeek);

            if (start !== null && start > weekNum) return false;
            if (end !== null && end < weekNum) return false;

            return true;
        });

        var result = [];
        for (var i = 0; i < disciplines.length; i++) {
            var cloned = deepClone(disciplines[i]);
            if (cloned === null) {
                console.error('DisciplineCore: Failed to clone available discipline at index ' + i);
                return [];
            }
            result.push(cloned);
        }

        return result;
    }

    // ============================================================
    // DISCIPLINE MUTATIONS (candidate-based validation)
    // ============================================================

    function createDiscipline(data) {
        // ---- PHASE 1: VALIDATE INPUTS ----
        var validation = validateDiscipline(data, false);
        if (!validation.success) {
            return failure(validation.message);
        }

        // ---- PHASE 2: ENSURE STRUCTURE (REPAIR ALLOWED) ----
        var store = ensureDisciplineStructure();
        if (!store) {
            return failure('Data store is not available.');
        }

        // ---- PHASE 3: CHECK DUPLICATES ----
        var name = String(data.name).trim();
        var existing = store.curriculum.disciplines.find(function(d) {
            return d && String(d.name || '').toLowerCase() === name.toLowerCase();
        });

        if (existing) {
            return failure('A discipline with this name already exists.');
        }

        // ---- PHASE 4: BUILD DISCIPLINE ----
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

        // ---- PHASE 5: NORMALISE GRADING SYSTEM ----
        if (data.gradingSystem !== undefined && Array.isArray(data.gradingSystem)) {
            var gradingResult = validateGradingSystem(data.gradingSystem);
            if (!gradingResult.success) {
                return failure(gradingResult.message);
            }
            discipline.gradingSystem = gradingResult.data || [];
        }

        // ---- PHASE 6: VALIDATE BUILT OBJECT ----
        var builtValidation = validateDiscipline(discipline, false);
        if (!builtValidation.success) {
            return failure('Internal validation failed: ' + builtValidation.message);
        }

        // ---- PHASE 7: BUILD CANDIDATE ----
        var candidate = deepClone(store.curriculum.disciplines);
        if (candidate === null) {
            return failure('Failed to prepare discipline data.');
        }

        candidate.push(discipline);

        // ---- PHASE 8: COMMIT ----
        store.curriculum.disciplines = candidate;

        logActivity('Created discipline: ' + discipline.name);
        return successWithDiscipline(discipline);
    }

    function updateDiscipline(id, data) {
        // ---- PHASE 1: VALIDATE ID ----
        if (!isNonEmptyString(id)) {
            return failure('Discipline ID is required.');
        }

        // ---- PHASE 2: VALIDATE UPDATES ----
        var validation = validateDiscipline(data, true);
        if (!validation.success) {
            return failure(validation.message);
        }

        // ---- PHASE 3: RETRIEVE ----
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

        // ---- PHASE 4: BUILD CANDIDATE (DO NOT MUTATE YET) ----
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
            candidate.instructorIds = Array.isArray(data.instructorIds)
                ? data.instructorIds.slice()
                : [];
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
            if (!gradingResult.success) {
                return failure(gradingResult.message);
            }
            candidate.gradingSystem = gradingResult.data || [];
            hasChanges = true;
        }

        // If no changes, return early
        if (!hasChanges) {
            return successWithDiscipline(discipline);
        }

        // ---- PHASE 5: VALIDATE CANDIDATE ----
        var builtValidation = validateDiscipline(candidate, false);
        if (!builtValidation.success) {
            return failure(builtValidation.message);
        }

        // ---- PHASE 6: BUILD FULL CANDIDATE ARRAY ----
        var candidateArray = deepClone(store.curriculum.disciplines);
        if (candidateArray === null) {
            return failure('Failed to prepare discipline data.');
        }

        candidateArray[index] = candidate;

        // ---- PHASE 7: COMMIT ----
        store.curriculum.disciplines = candidateArray;

        logActivity('Updated discipline: ' + candidate.name);
        return successWithDiscipline(candidate);
    }

    // ============================================================
    // DELETE DISCIPLINE - TRANSACTIONAL CLEANUP
    // ============================================================

    function deleteDiscipline(id) {
        // ---- PHASE 1: VALIDATE ID ----
        if (!isNonEmptyString(id)) {
            return failure('Discipline ID is required.');
        }

        // ---- PHASE 2: RETRIEVE ----
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

        // ---- PHASE 3: BUILD CLEANUP PLAN (TRANSACTIONAL) ----
        // Clone the entire curriculum structure - this is our transaction space
        var curriculumClone = deepClone(store.curriculum);
        if (curriculumClone === null) {
            return failure('Failed to prepare deletion. Please try again.');
        }

        // ---- PHASE 4: PERFORM ALL CLEANUP ON THE CLONE (WRAPPED IN TRY/CATCH) ----
        try {
            // Remove from schedules
            if (curriculumClone.schedules && isObject(curriculumClone.schedules)) {
                for (var studentId in curriculumClone.schedules) {
                    if (!Object.prototype.hasOwnProperty.call(curriculumClone.schedules, studentId)) continue;
                    var studentSchedule = curriculumClone.schedules[studentId];
                    if (!isObject(studentSchedule)) continue;

                    for (var week in studentSchedule) {
                        if (!Object.prototype.hasOwnProperty.call(studentSchedule, week)) continue;
                        var weekSchedule = studentSchedule[week];
                        if (!isObject(weekSchedule)) continue;

                        for (var day in weekSchedule) {
                            if (!Object.prototype.hasOwnProperty.call(weekSchedule, day)) continue;
                            var daySchedule = weekSchedule[day];
                            if (!isObject(daySchedule)) continue;

                            for (var hour in daySchedule) {
                                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) continue;
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
                    if (!Object.prototype.hasOwnProperty.call(curriculumClone.grades, studentId)) continue;
                    var studentGrades = curriculumClone.grades[studentId];
                    if (!isObject(studentGrades)) continue;

                    for (var week in studentGrades) {
                        if (!Object.prototype.hasOwnProperty.call(studentGrades, week)) continue;
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
                    if (!Object.prototype.hasOwnProperty.call(curriculumClone.autoGroups, key)) continue;
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

            // ---- PHASE 5: REMOVE DISCIPLINE FROM CLONE ----
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
            // ---- TRANSACTION ABORTED ----
            console.error('DisciplineCore.deleteDiscipline: Transaction failed:', e);
            return failure('Deletion failed during cleanup: ' + e.message);
        }

        // ---- PHASE 6: COMMIT (PRESERVE OBJECT IDENTITY) ----
        var originalCurriculum = store.curriculum;

        // Clear original
        var keys = Object.keys(originalCurriculum);
        for (var i = 0; i < keys.length; i++) {
            delete originalCurriculum[keys[i]];
        }

        // Copy clone into original (plain object assignment, extremely reliable)
        Object.assign(originalCurriculum, curriculumClone);

        logActivity('Deleted discipline: ' + name);
        return success({
            deleted: true,
            name: name
        });
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

        // Sort by min descending (highest grade first)
        var sorted = discipline.gradingSystem.slice().sort(function(a, b) {
            return (b.min || 0) - (a.min || 0);
        });

        for (var i = 0; i < sorted.length; i++) {
            var grade = sorted[i];
            var min = Number(grade.min);
            var max = Number(grade.max);

            if (isFinite(min) && isFinite(max) && numScore >= min && numScore <= max) {
                // Support legacy 'letter' field for backward compatibility
                return grade.label || grade.letter || '';
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

    function getDisciplineInstructorIds(discipline) {
        if (!discipline || !Array.isArray(discipline.instructorIds)) {
            return [];
        }
        return discipline.instructorIds.slice();
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
    // DISCIPLINE VALIDATION HELPERS
    // ============================================================

    function isValidDisciplineType(type) {
        var validTypes = ['mandatory', 'optional'];
        return validTypes.indexOf(type) !== -1;
    }

    /**
     * Validate a discipline name.
     * For creation, omit excludeId. For update, pass the current discipline ID.
     */
    function validateDisciplineName(name, excludeId) {
        if (!isNonEmptyString(name)) {
            return failure('Discipline name is required.');
        }

        var trimmed = String(name).trim();

        // Check for existing discipline with same name
        var data = getDataStore();
        if (data && data.curriculum && Array.isArray(data.curriculum.disciplines)) {
            var existing = data.curriculum.disciplines.find(function(d) {
                return d &&
                    String(d.id) !== String(excludeId) &&
                    String(d.name || '').trim().toLowerCase() === trimmed.toLowerCase();
            });
            if (existing) {
                return failure('A discipline with this name already exists.');
            }
        }

        return success(null);
    }

    /**
     * Legacy compatibility: returns boolean.
     * Use validateDisciplineName() for the richer API.
     */
    function isValidDisciplineName(name, excludeId) {
        return validateDisciplineName(name, excludeId).success;
    }

    function disciplineExists(id) {
        return getDiscipline(id) !== null;
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
        getDisciplineInstructorIds: getDisciplineInstructorIds,
        isDisciplineInstructor: isDisciplineInstructor,

        // Validation
        validateDiscipline: validateDiscipline,
        isValidDisciplineType: isValidDisciplineType,
        validateDisciplineName: validateDisciplineName,
        isValidDisciplineName: isValidDisciplineName,
        disciplineExists: disciplineExists,

        // Constants
        VALID_TYPES: ['mandatory', 'optional'],

        // Helpers
        deepClone: deepClone,
        success: success,
        failure: failure
    };

})();
