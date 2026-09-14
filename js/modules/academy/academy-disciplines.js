/**
 * modules/academy/academy-disciplines.js - Academy Disciplines
 * SINGLE SOURCE OF TRUTH for all discipline/curriculum data and operations
 *
 * Path: js/modules/academy/academy-disciplines.js
 *
 * This module is responsible for:
 *   - Discipline CRUD operations (create, update, delete)
 *   - Discipline queries (get by ID, get all, get available)
 *   - Discipline validation
 *   - Instructor assignment for disciplines
 *   - Grade scheme ownership (stored on the discipline record)
 *
 * IMPORTANT:
 *   - This module OWNS discipline data - it does NOT depend on AcademyQueries
 *   - All MUTATIONS go through MutationPipeline (persistence, rollback, logging)
 *   - All READS are synchronous and side-effect free
 *   - Invalid inputs are REJECTED (mutation resolves with { success: false })
 *   - Mutations are ATOMIC: if persistence fails, window.data is restored
 *   - This module does NOT call saveData() directly - the pipeline does
 *   - AcademyQueries is the PUBLIC read facade that uses these internal lookups
 *
 * GRADE SCHEME SEMANTICS (new in this version):
 *   - Each discipline carries a `gradeScheme` object.
 *   - Schemes are FULLY user-editable. Presets (Letter, Pass/Fail, Numeric)
 *     only seed the bands array. Nothing is derived from the preset id at
 *     read time.
 *   - The scheme is a DISPLAY layer. Grades are always stored as percentages.
 *   - Missing gradeScheme on read → normalized to the numeric default.
 *     This is a READ-TIME normalization only; nothing is written to disk
 *     until the user edits the discipline.
 *   - Validation of the scheme shape is delegated to AcademyGradeSchemes.
 *
 * CASCADE SEMANTICS (deleteDiscipline):
 *   Deleting a discipline is a CASCADE. In a single transaction it:
 *     1. Deletes the discipline from curriculum.disciplines.
 *     2. Removes auto-groups whose disciplineId matches.
 *     3. Strips the discipline ID from every student weekly schedule.
 *     4. Strips the discipline ID from every location weekly schedule.
 *     5. Prunes metadata keys whose target slot no longer exists.
 *     6. Deletes grades keyed to this discipline.
 *   Rationale: after deletion, any surviving reference would be
 *   unreachable data. Cleaning in the same transaction avoids both
 *   orphaned references and partial-cascade states.
 *
 * MUTATION CONTRACT:
 *   - create / update / delete / saveDisciplines all return
 *     Promise<{ success, data?, message? }>
 *   - getDiscipline / getDisciplines / getDisciplinesByType /
 *     getDisciplinesByInstructor / getAvailableDisciplines /
 *     getActiveDisciplines stay synchronous
 *
 * YEAR SEMANTICS:
 *   - Disciplines are scoped to WEEKS (bounded 1-52), not years.
 *
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 *   - window.ValidationUtils (from validation-utils.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 *   - window.AcademyGradeSchemes (from academy-grade-schemes.js) - MANDATORY
 *
 * USAGE:
 *   var disciplines = window.AcademyDisciplines;
 *
 *   disciplines.create({
 *       name: 'Combat Training',
 *       type: 'mandatory',
 *       gradeScheme: AcademyGradeSchemes.getPreset('letter')
 *   }).then(function(result) { ... });
 *
 *   disciplines.delete('disc_123').then(function(result) {
 *       // result.data.cascade contains the cascade summary
 *   });
 */

(function() {
    'use strict';

    if (window.__academyDisciplinesLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        missing.push('ObjectUtils.deepClone');
    }

    if (!window.IdUtils || typeof window.IdUtils.generateId !== 'function') {
        missing.push('IdUtils.generateId');
    }

    if (!window.ValidationUtils || typeof window.ValidationUtils.isNonEmptyString !== 'function') {
        missing.push('ValidationUtils.isNonEmptyString');
    }

    if (!window.MutationPipeline || typeof window.MutationPipeline.performMutation !== 'function') {
        missing.push('MutationPipeline.performMutation');
    }

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }

    if (!window.CalendarValidation || typeof window.CalendarValidation.parseWeek !== 'function') {
        missing.push('CalendarValidation.parseWeek');
    }

    if (!window.AcademyGradeSchemes || typeof window.AcademyGradeSchemes.normalizeScheme !== 'function') {
        missing.push('AcademyGradeSchemes.normalizeScheme');
    }

    if (missing.length > 0) {
        throw new Error('[AcademyDisciplines] Missing dependencies: ' + missing.join(', '));
    }

    window.__academyDisciplinesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var ValidationUtils = window.ValidationUtils;
    var MutationPipeline = window.MutationPipeline;
    var CalendarConstants = window.CalendarConstants;
    var CalendarValidation = window.CalendarValidation;
    var GradeSchemes = window.AcademyGradeSchemes;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var DEFAULT_START_WEEK = MIN_WEEK;
    var DEFAULT_END_WEEK = MAX_WEEK;

    var VALID_DISCIPLINE_TYPES = ['mandatory', 'optional'];
    var DEFAULT_TYPE = 'mandatory';

    var MIN_WEEKLY_HOURS = 0.5;
    var MAX_WEEKLY_HOURS = 40;
    var DEFAULT_WEEKLY_HOURS = 1;

    var MIN_WEIGHT = 0.1;
    var MAX_WEIGHT = 10;
    var DEFAULT_WEIGHT = 1;

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return ValidationUtils.isNonEmptyString(value);
    }

    function isNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    function generateId() {
        return IdUtils.generateId('disc');
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // GRADE SCHEME HELPERS
    // ============================================================

    /**
     * Normalize a grade scheme to canonical shape.
     * Missing or malformed → numeric default.
     * Always returns a frozen, valid scheme.
     */
    function normalizeGradeScheme(raw) {
        return GradeSchemes.normalizeScheme(raw);
    }

    /**
     * Validate a grade scheme.
     * Returns { valid: boolean, message?: string }.
     *
     * The caller-facing shape is flatter than the raw validator:
     * callers get a single message string, not an error array.
     */
    function validateGradeScheme(raw) {
        if (raw === undefined || raw === null) {
            // Absent scheme → defaults will be applied. Valid.
            return { valid: true };
        }

        var result = GradeSchemes.validateScheme(raw);
        if (result.valid) {
            return { valid: true };
        }

        // Build a single human-readable message.
        var messages = [];
        for (var i = 0; i < result.errors.length; i++) {
            if (result.errors[i] && result.errors[i].message) {
                messages.push(result.errors[i].message);
            }
        }

        return {
            valid: false,
            message: messages.length > 0
                ? messages.join(' ')
                : 'Grade scheme is invalid.'
        };
    }

    /**
     * Does a discipline's scheme equal the numeric default?
     * Used by the view to decide whether to render a "Numeric" hint.
     */
    function isNumericScheme(scheme) {
        return GradeSchemes.isNumericScheme(scheme);
    }

    // ============================================================
    // DATA STORE ACCESS - INTERNAL
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function getCurriculum() {
        var data = getDataStore();
        if (!data || !data.curriculum || typeof data.curriculum !== 'object') {
            return null;
        }
        return data.curriculum;
    }

    function ensureDisciplineStore(appData) {
        if (!appData.curriculum || typeof appData.curriculum !== 'object') {
            appData.curriculum = {};
        }
        if (!Array.isArray(appData.curriculum.disciplines)) {
            appData.curriculum.disciplines = [];
        }
        return appData.curriculum.disciplines;
    }

    // ============================================================
    // INTERNAL DISCIPLINE LOOKUP - PRIVATE
    // ============================================================

    function getDisciplineRecord(id) {
        if (!isNonEmptyString(id)) {
            return null;
        }

        var curriculum = getCurriculum();
        if (!curriculum || !Array.isArray(curriculum.disciplines)) {
            return null;
        }

        var target = String(id);
        for (var i = 0; i < curriculum.disciplines.length; i++) {
            var d = curriculum.disciplines[i];
            if (d && String(d.id) === target) {
                return d;
            }
        }

        return null;
    }

    function getDisciplineRecords() {
        var curriculum = getCurriculum();
        if (!curriculum || !Array.isArray(curriculum.disciplines)) {
            return [];
        }

        var result = [];
        for (var i = 0; i < curriculum.disciplines.length; i++) {
            var d = curriculum.disciplines[i];
            if (d) {
                result.push(d);
            }
        }

        return result;
    }

    function getDisciplineByNameRecord(name) {
        if (!isNonEmptyString(name)) {
            return null;
        }

        var target = String(name).toLowerCase().trim();
        var disciplines = getDisciplineRecords();

        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            if (d && d.name && String(d.name).toLowerCase().trim() === target) {
                return d;
            }
        }

        return null;
    }

    /**
     * Internal normalization for reads.
     * Ensures `gradeScheme` is always present and canonical on
     * returned copies. Never writes to the live store.
     *
     * NOTE: The live record itself is NOT modified here. Only the
     * clone returned to the caller gains a normalized scheme.
     */
    function attachNormalizedScheme(record) {
        if (!record || typeof record !== 'object') {
            return record;
        }
        var copy = deepClone(record);
        copy.gradeScheme = normalizeGradeScheme(record.gradeScheme);
        return copy;
    }

    // ============================================================
    // DISCIPLINE VALIDATION
    // ============================================================

    function validateDisciplineData(data, isPartial) {
        if (!isObject(data)) {
            return { valid: false, message: 'Discipline data must be an object.' };
        }

        if (!isPartial || data.name !== undefined) {
            if (!isNonEmptyString(data.name)) {
                return { valid: false, message: 'Discipline name is required.' };
            }
        }

        if (data.type !== undefined) {
            if (VALID_DISCIPLINE_TYPES.indexOf(data.type) === -1) {
                return { valid: false, message: 'Invalid type. Must be one of: ' + VALID_DISCIPLINE_TYPES.join(', ') };
            }
        }

        if (data.instructorIds !== undefined) {
            if (!Array.isArray(data.instructorIds)) {
                return { valid: false, message: 'Instructor IDs must be an array.' };
            }
            for (var i = 0; i < data.instructorIds.length; i++) {
                if (!isNonEmptyString(data.instructorIds[i])) {
                    return { valid: false, message: 'Invalid instructor ID at index ' + i + '.' };
                }
            }
        }

        if (data.startWeek !== undefined) {
            var startWeek = CalendarValidation.parseWeek(data.startWeek);
            if (startWeek === null || startWeek < MIN_WEEK || startWeek > MAX_WEEK) {
                return { valid: false, message: 'Start week must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.' };
            }
        }

        if (data.endWeek !== undefined) {
            var endWeek = CalendarValidation.parseWeek(data.endWeek);
            if (endWeek === null || endWeek < MIN_WEEK || endWeek > MAX_WEEK) {
                return { valid: false, message: 'End week must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.' };
            }
        }

        if (data.weeklyHours !== undefined) {
            var weeklyHours = Number(data.weeklyHours);
            if (isNaN(weeklyHours) || weeklyHours < MIN_WEEKLY_HOURS || weeklyHours > MAX_WEEKLY_HOURS) {
                return { valid: false, message: 'Weekly hours must be between ' + MIN_WEEKLY_HOURS + ' and ' + MAX_WEEKLY_HOURS + '.' };
            }
        }

        if (data.weight !== undefined) {
            var weight = Number(data.weight);
            if (isNaN(weight) || weight < MIN_WEIGHT || weight > MAX_WEIGHT) {
                return { valid: false, message: 'Weight must be between ' + MIN_WEIGHT + ' and ' + MAX_WEIGHT + '.' };
            }
        }

        // ---- Grade scheme ----
        if (data.gradeScheme !== undefined) {
            var schemeCheck = validateGradeScheme(data.gradeScheme);
            if (!schemeCheck.valid) {
                return { valid: false, message: schemeCheck.message };
            }
        }

        return { valid: true };
    }

    // ============================================================
    // INTERNAL CANDIDATE BUILDER
    // ============================================================

    /**
     * Build a canonical discipline record from raw data.
     *
     * The `gradeScheme` field is always present on the output. If the
     * caller did not supply one, the numeric default is used.
     *
     * @param {object} data              - Raw input
     * @param {string|null} existingId   - ID to reuse (update path)
     * @param {string|null} existingCreatedAt - createdAt to preserve
     * @param {object|null} existingScheme    - Scheme to fall back to
     *                                          when data.gradeScheme is
     *                                          absent (update path)
     */
    function buildDisciplineRecord(data, existingId, existingCreatedAt, existingScheme) {
        var now = new Date().toISOString();

        var startWeek = data.startWeek !== undefined
            ? CalendarValidation.parseWeek(data.startWeek)
            : DEFAULT_START_WEEK;
        var endWeek = data.endWeek !== undefined
            ? CalendarValidation.parseWeek(data.endWeek)
            : DEFAULT_END_WEEK;

        var weeklyHours = data.weeklyHours !== undefined
            ? Number(data.weeklyHours)
            : DEFAULT_WEEKLY_HOURS;
        var weight = data.weight !== undefined
            ? Number(data.weight)
            : DEFAULT_WEIGHT;

        var instructorIds = Array.isArray(data.instructorIds)
            ? data.instructorIds.map(function(id) { return String(id).trim(); })
            : [];

        // Resolve grade scheme:
        //   1. If data carries one, normalize it.
        //   2. Else if we're updating, reuse the existing scheme.
        //   3. Else fall back to numeric default.
        var scheme;
        if (data.gradeScheme !== undefined && data.gradeScheme !== null) {
            scheme = normalizeGradeScheme(data.gradeScheme);
        } else if (existingScheme !== undefined && existingScheme !== null) {
            scheme = normalizeGradeScheme(existingScheme);
        } else {
            scheme = normalizeGradeScheme(null); // → numeric default
        }

        return {
            id: existingId || generateId(),
            name: String(data.name).trim(),
            type: data.type || DEFAULT_TYPE,
            instructorIds: instructorIds,
            startWeek: startWeek,
            endWeek: endWeek,
            weeklyHours: weeklyHours,
            weight: weight,
            gradeScheme: scheme,
            createdAt: existingCreatedAt || now,
            updatedAt: now
        };
    }

    // ============================================================
    // CASCADE HELPERS - Remove all references to a discipline ID
    // ============================================================

    function stripDisciplineFromSchedules(curriculum, disciplineId) {
        var schedules = curriculum.schedules;
        if (!schedules || typeof schedules !== 'object') {
            return 0;
        }

        var target = String(disciplineId);
        var removedCount = 0;

        Object.keys(schedules).forEach(function(studentId) {
            var byWeek = schedules[studentId];
            if (!byWeek || typeof byWeek !== 'object') {
                return;
            }

            Object.keys(byWeek).forEach(function(weekKey) {
                var byDay = byWeek[weekKey];
                if (!byDay || typeof byDay !== 'object') {
                    return;
                }

                Object.keys(byDay).forEach(function(dayKey) {
                    var byHour = byDay[dayKey];
                    if (!byHour || typeof byHour !== 'object') {
                        return;
                    }

                    Object.keys(byHour).forEach(function(hourKey) {
                        if (String(byHour[hourKey]) === target) {
                            delete byHour[hourKey];
                            removedCount++;
                        }
                    });

                    if (Object.keys(byHour).length === 0) {
                        delete byDay[dayKey];
                    }
                });

                if (Object.keys(byDay).length === 0) {
                    delete byWeek[weekKey];
                }
            });

            if (Object.keys(byWeek).length === 0) {
                delete schedules[studentId];
            }
        });

        return removedCount;
    }

    function stripDisciplineFromLocationSchedules(curriculum, disciplineId) {
        var schedules = curriculum.locationSchedules;
        if (!schedules || typeof schedules !== 'object') {
            return 0;
        }

        var target = String(disciplineId);
        var removedCount = 0;

        Object.keys(schedules).forEach(function(locationId) {
            var byWeek = schedules[locationId];
            if (!byWeek || typeof byWeek !== 'object') {
                return;
            }

            Object.keys(byWeek).forEach(function(weekKey) {
                var byDay = byWeek[weekKey];
                if (!byDay || typeof byDay !== 'object') {
                    return;
                }

                Object.keys(byDay).forEach(function(dayKey) {
                    var byHour = byDay[dayKey];
                    if (!byHour || typeof byHour !== 'object') {
                        return;
                    }

                    Object.keys(byHour).forEach(function(hourKey) {
                        if (String(byHour[hourKey]) === target) {
                            delete byHour[hourKey];
                            removedCount++;
                        }
                    });

                    if (Object.keys(byHour).length === 0) {
                        delete byDay[dayKey];
                    }
                });

                if (Object.keys(byDay).length === 0) {
                    delete byWeek[weekKey];
                }
            });

            if (Object.keys(byWeek).length === 0) {
                delete schedules[locationId];
            }
        });

        return removedCount;
    }

    function stripDisciplineFromAutoGroups(curriculum, disciplineId) {
        var store = curriculum.autoGroups;
        if (!store || typeof store !== 'object') {
            return 0;
        }

        var target = String(disciplineId);
        var keysToRemove = [];

        Object.keys(store).forEach(function(key) {
            var group = store[key];
            if (group && String(group.disciplineId) === target) {
                keysToRemove.push(key);
            }
        });

        for (var i = 0; i < keysToRemove.length; i++) {
            delete store[keysToRemove[i]];
        }

        return keysToRemove.length;
    }

    function pruneOrphanedMetadata(curriculum) {
        var metadata = curriculum.metadata;
        if (!metadata || typeof metadata !== 'object') {
            return 0;
        }

        var schedules = curriculum.schedules || {};
        var locationSchedules = curriculum.locationSchedules || {};
        var keysToRemove = [];

        Object.keys(metadata).forEach(function(key) {
            var parts = String(key).split('_');
            if (parts.length < 4) {
                return;
            }

            var hour = parts[parts.length - 1];
            var day = parts[parts.length - 2];
            var week = parts[parts.length - 3];
            var entityId = parts.slice(0, parts.length - 3).join('_');

            var slotExists = false;

            if (schedules[entityId] &&
                schedules[entityId][week] &&
                schedules[entityId][week][day] &&
                schedules[entityId][week][day][hour] !== undefined) {
                slotExists = true;
            }

            if (!slotExists &&
                locationSchedules[entityId] &&
                locationSchedules[entityId][week] &&
                locationSchedules[entityId][week][day] &&
                locationSchedules[entityId][week][day][hour] !== undefined) {
                slotExists = true;
            }

            if (!slotExists) {
                keysToRemove.push(key);
            }
        });

        for (var i = 0; i < keysToRemove.length; i++) {
            delete metadata[keysToRemove[i]];
        }

        return keysToRemove.length;
    }

    function stripDisciplineFromGrades(appData, disciplineId) {
        if (!appData.academy || !appData.academy.grades ||
            typeof appData.academy.grades !== 'object') {
            return 0;
        }

        var grades = appData.academy.grades;
        var target = String(disciplineId);
        var keysToRemove = [];

        Object.keys(grades).forEach(function(id) {
            var grade = grades[id];
            if (grade && String(grade.disciplineId) === target) {
                keysToRemove.push(id);
            }
        });

        for (var i = 0; i < keysToRemove.length; i++) {
            delete grades[keysToRemove[i]];
        }

        return keysToRemove.length;
    }

    // ============================================================
    // PUBLIC API - DISCIPLINE CRUD (Promise-based)
    // ============================================================

    /**
     * Create a new discipline.
     *
     * @param {object} data - Discipline data, may include `gradeScheme`
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function create(data) {
        // ---- PHASE 1: VALIDATE INPUT ----
        var validation = validateDisciplineData(data, false);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.message));
        }

        // ---- PHASE 2: CHECK FOR DUPLICATE NAME (pre-flight) ----
        var existing = getDisciplineByNameRecord(data.name);
        if (existing) {
            return Promise.resolve(failure('A discipline with this name already exists.'));
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
        var newDiscipline;
        try {
            newDiscipline = buildDisciplineRecord(data, null, null, null);
        } catch (e) {
            return Promise.resolve(failure(e.message || 'Failed to build discipline record.'));
        }

        if (newDiscipline.startWeek > newDiscipline.endWeek) {
            return Promise.resolve(failure('Start week cannot be after end week.'));
        }

        var targetId = newDiscipline.id;

        // ---- PHASE 4: PIPELINE MUTATION ----
        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                var curriculum = appData.curriculum;
                if (curriculum && Array.isArray(curriculum.disciplines)) {
                    var nameLower = newDiscipline.name.toLowerCase();
                    for (var i = 0; i < curriculum.disciplines.length; i++) {
                        var d = curriculum.disciplines[i];
                        if (d && d.name && String(d.name).toLowerCase() === nameLower) {
                            return { valid: false, message: 'A discipline with this name already exists.' };
                        }
                    }
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var disciplines = ensureDisciplineStore(appData);
                disciplines.push(deepClone(newDiscipline));
                return { discipline: newDiscipline, id: targetId };
            },
            logMessage: 'Created discipline: ' + newDiscipline.name,
            successMessage: 'Discipline created successfully!',
            failureMessage: 'Failed to create discipline.'
        });
    }

    /**
     * Update an existing discipline.
     *
     * @param {string} id - Discipline ID
     * @param {object} updates - Updates to apply, may include `gradeScheme`
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function update(id, updates) {
        if (!isNonEmptyString(id)) {
            return Promise.resolve(failure('Discipline ID is required.'));
        }

        if (!isObject(updates) || Object.keys(updates).length === 0) {
            return Promise.resolve(failure('Updates are required.'));
        }

        var existing = getDisciplineRecord(id);
        if (!existing) {
            return Promise.resolve(failure('Discipline not found.'));
        }

        // ---- VALIDATE UPDATES ----
        var validation = validateDisciplineData(updates, true);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.message));
        }

        // ---- BUILD CANDIDATE ----
        var candidate = deepClone(existing);
        if (candidate === null) {
            return Promise.resolve(failure('Failed to clone discipline data.'));
        }

        var hasChanges = false;

        // Name update
        if (updates.name !== undefined) {
            var newName = String(updates.name).trim();
            if (!newName) {
                return Promise.resolve(failure('Discipline name cannot be empty.'));
            }
            if (newName !== candidate.name) {
                var duplicate = getDisciplineByNameRecord(newName);
                if (duplicate && String(duplicate.id) !== String(id)) {
                    return Promise.resolve(failure('A discipline with this name already exists.'));
                }
                candidate.name = newName;
                hasChanges = true;
            }
        }

        // Type update
        if (updates.type !== undefined) {
            if (VALID_DISCIPLINE_TYPES.indexOf(updates.type) === -1) {
                return Promise.resolve(failure('Invalid type. Must be one of: ' + VALID_DISCIPLINE_TYPES.join(', ')));
            }
            if (candidate.type !== updates.type) {
                candidate.type = updates.type;
                hasChanges = true;
            }
        }

        // Instructor IDs update
        if (updates.instructorIds !== undefined) {
            if (!Array.isArray(updates.instructorIds)) {
                return Promise.resolve(failure('Instructor IDs must be an array.'));
            }
            var newInstructors = [];
            for (var j = 0; j < updates.instructorIds.length; j++) {
                if (isNonEmptyString(updates.instructorIds[j])) {
                    newInstructors.push(String(updates.instructorIds[j]).trim());
                }
            }
            var currentSorted = (candidate.instructorIds || []).slice().sort();
            var newSorted = newInstructors.slice().sort();
            var changed = currentSorted.length !== newSorted.length ||
                currentSorted.some(function(v, idx) { return v !== newSorted[idx]; });
            if (changed) {
                candidate.instructorIds = newInstructors;
                hasChanges = true;
            }
        }

        // Start week update
        if (updates.startWeek !== undefined) {
            var startWeek = CalendarValidation.parseWeek(updates.startWeek);
            if (startWeek === null || startWeek < MIN_WEEK || startWeek > MAX_WEEK) {
                return Promise.resolve(failure('Start week must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.'));
            }
            if (candidate.startWeek !== startWeek) {
                candidate.startWeek = startWeek;
                hasChanges = true;
            }
        }

        // End week update
        if (updates.endWeek !== undefined) {
            var endWeek = CalendarValidation.parseWeek(updates.endWeek);
            if (endWeek === null || endWeek < MIN_WEEK || endWeek > MAX_WEEK) {
                return Promise.resolve(failure('End week must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.'));
            }
            if (candidate.endWeek !== endWeek) {
                candidate.endWeek = endWeek;
                hasChanges = true;
            }
        }

        // Weekly hours update
        if (updates.weeklyHours !== undefined) {
            var weeklyHours = Number(updates.weeklyHours);
            if (isNaN(weeklyHours) || weeklyHours < MIN_WEEKLY_HOURS || weeklyHours > MAX_WEEKLY_HOURS) {
                return Promise.resolve(failure('Weekly hours must be between ' + MIN_WEEKLY_HOURS + ' and ' + MAX_WEEKLY_HOURS + '.'));
            }
            if (candidate.weeklyHours !== weeklyHours) {
                candidate.weeklyHours = weeklyHours;
                hasChanges = true;
            }
        }

        // Weight update
        if (updates.weight !== undefined) {
            var weight = Number(updates.weight);
            if (isNaN(weight) || weight < MIN_WEIGHT || weight > MAX_WEIGHT) {
                return Promise.resolve(failure('Weight must be between ' + MIN_WEIGHT + ' and ' + MAX_WEIGHT + '.'));
            }
            if (candidate.weight !== weight) {
                candidate.weight = weight;
                hasChanges = true;
            }
        }

        // Grade scheme update
        if (updates.gradeScheme !== undefined) {
            var schemeCheck = validateGradeScheme(updates.gradeScheme);
            if (!schemeCheck.valid) {
                return Promise.resolve(failure(schemeCheck.message));
            }

            var newScheme = normalizeGradeScheme(updates.gradeScheme);
            var oldSchemeJson = JSON.stringify(candidate.gradeScheme || null);
            var newSchemeJson = JSON.stringify(newScheme);
            if (oldSchemeJson !== newSchemeJson) {
                candidate.gradeScheme = newScheme;
                hasChanges = true;
            }
        }

        if (candidate.startWeek > candidate.endWeek) {
            return Promise.resolve(failure('Start week cannot be after end week.'));
        }

        if (!hasChanges) {
            return Promise.resolve(success({ discipline: attachNormalizedScheme(candidate), changed: false }));
        }

        candidate.updatedAt = new Date().toISOString();
        var targetId = String(id);

        return MutationPipeline.performMutation({
            validate: function() {
                if (!getDisciplineRecord(targetId)) {
                    return { valid: false, message: 'Discipline no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var disciplines = ensureDisciplineStore(appData);
                var idx = -1;
                for (var i = 0; i < disciplines.length; i++) {
                    if (String(disciplines[i].id) === targetId) {
                        idx = i;
                        break;
                    }
                }
                if (idx === -1) {
                    throw new Error('Discipline not found in data store.');
                }
                disciplines[idx] = deepClone(candidate);
                return { discipline: candidate, changed: true };
            },
            logMessage: 'Updated discipline: ' + candidate.name,
            successMessage: 'Discipline updated successfully!',
            failureMessage: 'Failed to update discipline.'
        });
    }

    /**
     * Delete a discipline permanently.
     *
     * CASCADE: removes all references to the discipline in one transaction.
     * See the CASCADE SEMANTICS block at the top of this file.
     *
     * @param {string} id - Discipline ID
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function deleteDiscipline(id) {
        if (!isNonEmptyString(id)) {
            return Promise.resolve(failure('Discipline ID is required.'));
        }

        var target = String(id);
        var existing = getDisciplineRecord(target);
        if (!existing) {
            return Promise.resolve(failure('Discipline not found.'));
        }

        var disciplineInfo = {
            id: target,
            name: existing.name
        };

        return MutationPipeline.performMutation({
            validate: function() {
                if (!getDisciplineRecord(target)) {
                    return { valid: false, message: 'Discipline no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                // ---- 1. Delete the discipline entity ----
                var disciplines = ensureDisciplineStore(appData);
                var idx = -1;
                for (var i = 0; i < disciplines.length; i++) {
                    if (String(disciplines[i].id) === target) {
                        idx = i;
                        break;
                    }
                }
                if (idx === -1) {
                    throw new Error('Discipline not found in data store.');
                }
                disciplines.splice(idx, 1);

                // ---- 2. Ensure curriculum structure exists for cascade ----
                if (!appData.curriculum || typeof appData.curriculum !== 'object') {
                    appData.curriculum = {};
                }
                var curriculum = appData.curriculum;

                // ---- 3. Cascade: strip discipline from schedules ----
                var scheduleSlotsRemoved = stripDisciplineFromSchedules(curriculum, target);
                var locationSlotsRemoved = stripDisciplineFromLocationSchedules(curriculum, target);

                // ---- 4. Cascade: remove matching auto-groups ----
                var groupsRemoved = stripDisciplineFromAutoGroups(curriculum, target);

                // ---- 5. Cascade: prune orphaned metadata ----
                var metadataPruned = pruneOrphanedMetadata(curriculum);

                // ---- 6. Cascade: remove grades keyed to this discipline ----
                var gradesRemoved = stripDisciplineFromGrades(appData, target);

                return {
                    deleted: true,
                    discipline: disciplineInfo,
                    cascade: {
                        scheduleSlotsRemoved: scheduleSlotsRemoved,
                        locationSlotsRemoved: locationSlotsRemoved,
                        autoGroupsRemoved: groupsRemoved,
                        metadataEntriesPruned: metadataPruned,
                        gradesRemoved: gradesRemoved
                    }
                };
            },
            logMessage: function(result) {
                var c = result.cascade;
                var extra = [];
                if (c.scheduleSlotsRemoved > 0) extra.push(c.scheduleSlotsRemoved + ' slot(s)');
                if (c.locationSlotsRemoved > 0) extra.push(c.locationSlotsRemoved + ' location slot(s)');
                if (c.autoGroupsRemoved > 0) extra.push(c.autoGroupsRemoved + ' group(s)');
                if (c.gradesRemoved > 0) extra.push(c.gradesRemoved + ' grade(s)');
                var suffix = extra.length > 0 ? ' (' + extra.join(', ') + ')' : '';
                return 'Deleted discipline: ' + existing.name + suffix;
            },
            successMessage: 'Discipline deleted successfully!',
            failureMessage: 'Failed to delete discipline.'
        });
    }

    // ============================================================
    // QUERY FUNCTIONS - Read-only (synchronous)
    // ============================================================
    //
    // All read paths return records with `gradeScheme` normalized.
    // The live store is not modified by reads.

    function getDiscipline(id) {
        var record = getDisciplineRecord(id);
        return record ? attachNormalizedScheme(record) : null;
    }

    function getDisciplines() {
        var records = getDisciplineRecords();
        return records.map(function(r) {
            return attachNormalizedScheme(r);
        });
    }

    function getDisciplinesByType(type) {
        if (VALID_DISCIPLINE_TYPES.indexOf(type) === -1) {
            return [];
        }

        var all = getDisciplineRecords();
        var result = [];

        for (var i = 0; i < all.length; i++) {
            if (all[i].type === type) {
                result.push(attachNormalizedScheme(all[i]));
            }
        }

        return result;
    }

    function getDisciplinesByInstructor(instructorId) {
        if (!isNonEmptyString(instructorId)) {
            return [];
        }

        var all = getDisciplineRecords();
        var result = [];
        var target = String(instructorId);

        for (var i = 0; i < all.length; i++) {
            var d = all[i];
            if (d.instructorIds && Array.isArray(d.instructorIds)) {
                for (var j = 0; j < d.instructorIds.length; j++) {
                    if (String(d.instructorIds[j]) === target) {
                        result.push(attachNormalizedScheme(d));
                        break;
                    }
                }
            }
        }

        return result;
    }

    function getAvailableDisciplines(week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return [];
        }

        var all = getDisciplineRecords();
        var result = [];

        for (var i = 0; i < all.length; i++) {
            var d = all[i];
            if (d.startWeek <= weekNum && d.endWeek >= weekNum) {
                result.push(attachNormalizedScheme(d));
            }
        }

        result.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        return result;
    }

    function getActiveDisciplines(currentWeek) {
        var week = currentWeek !== undefined ? CalendarValidation.parseWeek(currentWeek) : null;
        if (week === null) {
            var data = getDataStore();
            week = (data && data.currentWeek) || MIN_WEEK;
        }

        return getAvailableDisciplines(week);
    }

    /**
     * Get a discipline's grade scheme, normalized.
     * Convenience helper for callers that only need the scheme.
     * Returns the numeric default if the discipline has no scheme or
     * does not exist.
     */
    function getGradeScheme(id) {
        var record = getDisciplineRecord(id);
        if (!record) {
            return normalizeGradeScheme(null);
        }
        return normalizeGradeScheme(record.gradeScheme);
    }

    // ============================================================
    // BULK OPERATIONS - Via MutationPipeline
    // ============================================================

    /**
     * Save multiple disciplines at once.
     *
     * PLAN / APPLY: validate each entry, decide create/update/skip,
     * apply all writes in a single transaction.
     *
     * @param {array} disciplinesData - Array of discipline data objects
     * @param {object} options - Save options
     * @param {boolean} options.overwrite - Overwrite existing disciplines (default: true)
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function saveDisciplines(disciplinesData, options) {
        if (!Array.isArray(disciplinesData) || disciplinesData.length === 0) {
            return Promise.resolve(failure('Discipline data array is required.'));
        }

        options = options || {};
        var overwrite = options.overwrite !== false;

        // ---- PLAN ----
        var planned = [];
        var errors = [];

        for (var i = 0; i < disciplinesData.length; i++) {
            var data = disciplinesData[i];
            if (!isObject(data)) {
                errors.push({ index: i, error: 'Invalid discipline data.' });
                continue;
            }

            if (!isNonEmptyString(data.name)) {
                errors.push({ index: i, error: 'Missing required field: name' });
                continue;
            }

            var validation = validateDisciplineData(data, false);
            if (!validation.valid) {
                errors.push({ index: i, error: validation.message });
                continue;
            }

            var existing = getDisciplineByNameRecord(data.name);

            if (existing && !overwrite) {
                planned.push({ action: 'skip' });
                continue;
            }

            if (existing) {
                var candidate = buildDisciplineRecord(data, existing.id, existing.createdAt, existing.gradeScheme);
                if (candidate.startWeek > candidate.endWeek) {
                    errors.push({ index: i, error: 'Start week cannot be after end week.' });
                    continue;
                }
                planned.push({ action: 'update', record: candidate, matchId: existing.id });
            } else {
                var newRecord = buildDisciplineRecord(data, null, null, null);
                if (newRecord.startWeek > newRecord.endWeek) {
                    errors.push({ index: i, error: 'Start week cannot be after end week.' });
                    continue;
                }
                planned.push({ action: 'create', record: newRecord });
            }
        }

        var creates = planned.filter(function(p) { return p.action === 'create'; });
        var updates = planned.filter(function(p) { return p.action === 'update'; });
        var skipped = planned.filter(function(p) { return p.action === 'skip'; }).length;

        if (creates.length === 0 && updates.length === 0) {
            return Promise.resolve(success({
                total: disciplinesData.length,
                created: 0,
                updated: 0,
                skipped: skipped,
                errors: errors,
                successCount: 0
            }));
        }

        // ---- APPLY ----
        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var disciplines = ensureDisciplineStore(appData);
                var created = 0;
                var updated = 0;

                for (var k = 0; k < planned.length; k++) {
                    var item = planned[k];

                    if (item.action === 'create') {
                        var nameLower = item.record.name.toLowerCase();
                        var collision = false;
                        for (var c = 0; c < disciplines.length; c++) {
                            if (disciplines[c].name &&
                                String(disciplines[c].name).toLowerCase() === nameLower) {
                                collision = true;
                                break;
                            }
                        }
                        if (collision) {
                            throw new Error('Discipline already exists: ' + item.record.name);
                        }
                        disciplines.push(deepClone(item.record));
                        created++;

                    } else if (item.action === 'update') {
                        var idx = -1;
                        for (var u = 0; u < disciplines.length; u++) {
                            if (String(disciplines[u].id) === String(item.matchId)) {
                                idx = u;
                                break;
                            }
                        }
                        if (idx === -1) {
                            throw new Error('Discipline no longer exists: ' + item.matchId);
                        }
                        disciplines[idx] = deepClone(item.record);
                        updated++;
                    }
                }

                return {
                    total: disciplinesData.length,
                    created: created,
                    updated: updated,
                    skipped: skipped,
                    errors: errors,
                    successCount: created + updated
                };
            },
            logMessage: 'Saved ' + (creates.length + updates.length) + ' discipline(s)',
            successMessage: 'Disciplines saved successfully!',
            failureMessage: 'Failed to save disciplines.'
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyDisciplines = {
        // ---- Mutations (Promise-based) ----
        create: create,
        update: update,
        delete: deleteDiscipline,
        saveDisciplines: saveDisciplines,

        // ---- Queries (synchronous) ----
        getDiscipline: getDiscipline,
        getDisciplines: getDisciplines,
        getDisciplinesByType: getDisciplinesByType,
        getDisciplinesByInstructor: getDisciplinesByInstructor,
        getAvailableDisciplines: getAvailableDisciplines,
        getActiveDisciplines: getActiveDisciplines,

        // ---- Grade scheme helper ----
        getGradeScheme: getGradeScheme,
        isNumericScheme: isNumericScheme,

        // ---- Internal (for AcademyQueries) ----
        getDisciplineRecord: getDisciplineRecord,
        getDisciplineRecords: getDisciplineRecords,
        getDisciplineByNameRecord: getDisciplineByNameRecord,

        // ---- Constants ----
        VALID_DISCIPLINE_TYPES: VALID_DISCIPLINE_TYPES,
        DEFAULT_TYPE: DEFAULT_TYPE,
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        MIN_WEEKLY_HOURS: MIN_WEEKLY_HOURS,
        MAX_WEEKLY_HOURS: MAX_WEEKLY_HOURS,
        MIN_WEIGHT: MIN_WEIGHT,
        MAX_WEIGHT: MAX_WEIGHT,
        DEFAULT_WEEKLY_HOURS: DEFAULT_WEEKLY_HOURS,
        DEFAULT_WEIGHT: DEFAULT_WEIGHT
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyDisciplines;
        var missing = [];

        var required = [
            'create', 'update', 'delete', 'saveDisciplines',
            'getDiscipline', 'getDisciplines', 'getDisciplinesByType',
            'getDisciplinesByInstructor', 'getAvailableDisciplines',
            'getActiveDisciplines',
            'getGradeScheme', 'isNumericScheme',
            'getDisciplineRecord', 'getDisciplineRecords', 'getDisciplineByNameRecord'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademyDisciplines] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();
