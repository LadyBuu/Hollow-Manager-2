/**
 * core/calendar-core.js - Unified Calendar Core Operations
 * Single source of truth for all calendar-related data mutations
 * Path: js/core/calendar-core.js
 * 
 * This module handles:
 *   - Student schedules (classes, rest days, duplication)
 *   - Instructor calendars (templates, blocks)
 *   - Location schedules (assignments)
 *   - Shared grid operations (occupancy, conflicts, availability)
 * 
 * IMPORTANT:
 *   - All MUTATION operations return an object with { success: boolean }.
 *   - Failure results include { message: string }.
 *   - Successful operations may include operation-specific result fields.
 *   - Query/helper functions return their documented value types.
 *   - Invalid inputs are REJECTED (operation returns { success: false }).
 *   - Validation occurs BEFORE mutation (candidate-based approach).
 *   - This module does NOT call saveData() - callers own persistence.
 *   - This module does NOT show UI - caller handles UX.
 *   - Query results are DEEP CLONED to prevent external mutation.
 * 
 * MUTATION INVARIANT (CANDIDATE-BASED COMMIT):
 *   - All mutations build candidates BEFORE touching any live state
 *   - 1. Validate inputs
 *   - 2. Validate live state structure exists (read-only)
 *   - 3. Clone ALL affected stores (schedules, restDays, and all metadata)
 *   - 4. Apply validated changes to candidates ONLY
 *   - 5. Pre-clone result data (safe)
 *   - 6. COMMIT ALL candidates to data store
 *   - 7. If any step before commit fails, return error WITHOUT mutating
 *   - No live application state is mutated before candidate construction and validation complete.
 *   - Commit consists only of replacing the affected stores with prepared candidates.
 * 
 * AFFECTED STORES:
 *   - curriculum.schedules
 *   - curriculum.restDays
 *   - curriculum.classInstructors
 *   - curriculum.classLabels
 *   - curriculum.classGroupLabels
 *   - curriculum.classDurations
 *   - curriculum.classLocations
 *   - locationSchedules
 * 
 * METADATA INVARIANT:
 *   - Class metadata (instructor, label, duration, etc.) is stored ONLY at the
 *     START hour of a class, not at every occupied hour
 *   - scheduleKey = studentId + '_' + week + '_' + day + '_' + hour
 *   - duration metadata is MANDATORY for all class starts
 *   - getClassLocation() resolves continuation hours to the class start
 *   - setClassLocation() resolves continuation hours to the class start
 *   - Instructor templates and blocks are duration-aware
 *   - ID normalisation: all IDs are stored as strings at mutation boundaries
 * 
 * GRID SEMANTICS:
 *   - buildGrid() distinguishes class starts from continuations
 *   - Class starts have full metadata (duration, instructor, label)
 *   - Continuation cells have isContinuation: true and refer to startHour
 *   - getContinuousOccupiedHours() measures occupied cells, not class duration
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__calendarCoreLoaded) {
        return;
    }
    window.__calendarCoreLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var METADATA_KEYS = ['classInstructors', 'classLabels', 'classGroupLabels', 'classDurations', 'classLocations'];

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

    function parseSafeInteger(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        return Number.isSafeInteger(num) ? num : null;
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function logActivity(message, type) {
        type = type || 'info';

        if (typeof window.logActivity !== 'function') {
            return;
        }

        try {
            window.logActivity(message, type);
        } catch (e) {
            console.error('CalendarCore: activity logging failed:', e);
        }
    }

    function getDiscipline(id) {
        if (typeof window.getDiscipline === 'function') {
            return window.getDiscipline(id);
        }
        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return null;
        }
        return data.curriculum.disciplines.find(function(d) {
            return d && String(d.id) === String(id);
        }) || null;
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

    function getLocationById(id) {
        if (typeof window.getLocation === 'function') {
            return window.getLocation(id);
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.locations)) return null;
        return data.locations.find(function(l) {
            return l && String(l.id) === String(id);
        }) || null;
    }

    function getDisplayName(char) {
        if (typeof window.getDisplayName === 'function') {
            return window.getDisplayName(char);
        }
        if (char && char.firstName) {
            return char.firstName + (char.lastName ? ' ' + char.lastName : '');
        }
        return 'Unknown';
    }

    function getScheduleKey(studentId, week, day, hour) {
        return String(studentId) + '_' + String(week) + '_' + String(day) + '_' + String(hour);
    }

    function validateWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 52 ? num : null;
    }

    function validateDay(value) {
        var num = parseSafeInteger(value);
        return num !== null && num >= 1 && num <= 7 ? num : null;
    }

    function validateHour(value) {
        var num = parseSafeInteger(value);
        return num !== null && num >= 0 && num <= 23 ? num : null;
    }

    function validateDuration(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 4 ? num : null;
    }

    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }

        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                console.error('CalendarCore: structuredClone failed:', e);
                return null;
            }
        }

        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('CalendarCore: JSON clone failed:', e);
            return null;
        }
    }

    /**
     * Get class metadata for a specific hour.
     * Returns null if the hour is not a class start (no duration metadata).
     * Validates duration is between 1 and 4.
     */
    function getClassMetadata(metadata, studentId, week, day, hour) {
        var key = getScheduleKey(studentId, week, day, hour);

        var duration = validateDuration(
            metadata.classDurations && metadata.classDurations[key]
        );

        if (duration === null) {
            return null;
        }

        return {
            key: key,
            instructorId: metadata.classInstructors
                ? metadata.classInstructors[key]
                : null,
            label: metadata.classLabels
                ? metadata.classLabels[key] || ''
                : '',
            groupLabel: metadata.classGroupLabels
                ? metadata.classGroupLabels[key]
                : null,
            duration: duration,
            locationId: metadata.classLocations
                ? metadata.classLocations[key]
                : null
        };
    }

    /**
     * Get valid class duration from metadata.
     * Returns null if no valid duration exists.
     */
    function getValidClassDuration(metadata, key) {
        if (!metadata || !metadata.classDurations) {
            return null;
        }
        return validateDuration(metadata.classDurations[key]);
    }

    /**
     * Build candidate copies of all curriculum metadata stores.
     * Returns an object with all metadata candidates, or null on failure.
     */
    function buildMetadataCandidates(curriculum) {
        var metadata = {};

        for (var i = 0; i < METADATA_KEYS.length; i++) {
            var key = METADATA_KEYS[i];
            var source = curriculum && curriculum[key] ? curriculum[key] : {};
            var cloned = deepClone(source);
            if (cloned === null) {
                console.error('CalendarCore: Failed to clone metadata store: ' + key);
                return null;
            }
            metadata[key] = cloned;
        }

        return metadata;
    }

    /**
     * Commit metadata candidates to the curriculum.
     */
    function commitMetadataCandidates(curriculum, metadataCandidates) {
        for (var i = 0; i < METADATA_KEYS.length; i++) {
            var key = METADATA_KEYS[i];
            curriculum[key] = metadataCandidates[key];
        }
    }

    /**
     * Validate curriculum structure.
     */
    function validateCurriculumStructure(data) {
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        if (data.curriculum.schedules !== undefined && !isObject(data.curriculum.schedules)) {
            return failure('Schedule data is corrupted.');
        }

        if (data.curriculum.restDays !== undefined && !isObject(data.curriculum.restDays)) {
            return failure('Rest days data is corrupted.');
        }

        if (data.curriculum.instructorTemplates !== undefined && !isObject(data.curriculum.instructorTemplates)) {
            return failure('Instructor templates data is corrupted.');
        }

        if (data.curriculum.instructorBlocks !== undefined && !isObject(data.curriculum.instructorBlocks)) {
            return failure('Instructor blocks data is corrupted.');
        }

        for (var i = 0; i < METADATA_KEYS.length; i++) {
            var key = METADATA_KEYS[i];
            if (data.curriculum[key] !== undefined && !isObject(data.curriculum[key])) {
                return failure('Metadata store "' + key + '" is corrupted.');
            }
        }

        return { success: true, data: data };
    }

    /**
     * Validate location schedules structure.
     */
    function validateLocationStructure(data) {
        if (!data) {
            return failure('Data store is not available.');
        }

        if (data.locationSchedules !== undefined && !isObject(data.locationSchedules)) {
            return failure('Location schedules data is corrupted.');
        }

        return { success: true, data: data };
    }

    /**
     * Find the class start hour for a given occupied hour.
     * Uses metadata to find the start, with occupancy fallback.
     * Returns null if no class start can be found.
     */
    function findClassStartHour(schedule, metadata, studentId, week, day, hour) {
        if (!schedule || !schedule[day]) return null;

        var disciplineId = schedule[day][hour];
        if (!disciplineId) return null;

        // First, check if this hour itself has metadata (is a start)
        var meta = getClassMetadata(metadata, studentId, week, day, hour);
        if (meta) {
            return {
                startHour: hour,
                duration: meta.duration,
                disciplineId: disciplineId,
                key: meta.key,
                instructorId: meta.instructorId
            };
        }

        // Search backwards for a metadata-defined class start
        for (var candidate = hour - 1; candidate >= 0; candidate--) {
            if (String(schedule[day][candidate]) !== String(disciplineId)) {
                break;
            }

            var candidateMeta = getClassMetadata(metadata, studentId, week, day, candidate);
            if (candidateMeta) {
                // Check if the class covers this hour
                if (hour < candidate + candidateMeta.duration) {
                    return {
                        startHour: candidate,
                        duration: candidateMeta.duration,
                        disciplineId: disciplineId,
                        key: candidateMeta.key,
                        instructorId: candidateMeta.instructorId
                    };
                }
                break;
            }
        }

        // No metadata-defined start found
        return null;
    }

    // ============================================================
    // DURATION-AWARE OVERLAP HELPERS
    // ============================================================

    /**
     * Check if a new duration-based entry overlaps with existing entries.
     * Entries are stored as { hour: { duration: N } }.
     */
    function hasDurationOverlap(entries, day, hour, duration) {
        if (!entries || !entries[day]) {
            return false;
        }

        var dayEntries = entries[day];

        for (var existingHour in dayEntries) {
            if (!Object.prototype.hasOwnProperty.call(dayEntries, existingHour)) {
                continue;
            }

            var existingStart = parseSafeInteger(existingHour);
            if (existingStart === null) {
                continue;
            }

            var entry = dayEntries[existingHour];
            var existingDuration = validateDuration(entry && entry.duration);
            if (existingDuration === null) {
                continue;
            }

            var existingEnd = existingStart + existingDuration;
            var newEnd = hour + duration;

            if (hour < existingEnd && existingStart < newEnd) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if a student schedule slot has conflicts.
     * Duration-aware: checks all occupied hours in the range.
     */
    function hasStudentScheduleConflict(schedule, day, hour, duration) {
        if (!schedule || !schedule[day]) return false;

        for (var h = hour; h < hour + duration && h <= 23; h++) {
            if (schedule[day][h]) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // RESULT HELPERS
    // ============================================================

    function failure(message) {
        return {
            success: false,
            message: message
        };
    }

    function success(data) {
        return {
            success: true,
            data: data
        };
    }

    // ============================================================
    // VALIDATE SCHEDULE SLOT
    // ============================================================

    /**
     * Validate a schedule slot for setters.
     * Returns normalised, validated values on success.
     */
    function validateScheduleSlot(studentId, week, day, hour) {
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var dayNum = validateDay(day);
        if (dayNum === null) {
            return failure('Valid day is required (1-7).');
        }

        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return failure('Valid hour is required (0-23).');
        }

        return success({
            studentId: String(studentId).trim(),
            week: weekNum,
            day: dayNum,
            hour: hourNum
        });
    }

    // ============================================================
    // STUDENT SCHEDULE OPERATIONS
    // ============================================================

    /**
     * Get a student's schedule for a specific week.
     * Returns a cloned copy to prevent external mutation.
     */
    function getStudentSchedule(studentId, week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.schedules) {
            return {};
        }

        var studentSchedule = data.curriculum.schedules[studentId];
        if (!studentSchedule || !studentSchedule[weekNum]) {
            return {};
        }

        // Clone to prevent external mutation
        var weekSchedule = studentSchedule[weekNum];
        var result = {};
        for (var day in weekSchedule) {
            if (!Object.prototype.hasOwnProperty.call(weekSchedule, day)) continue;
            var daySchedule = weekSchedule[day];
            if (!isObject(daySchedule)) continue;
            result[day] = {};
            for (var hour in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) continue;
                result[day][hour] = daySchedule[hour];
            }
        }
        return result;
    }

    /**
     * Set a student's schedule class.
     * Candidate-based: validates, clones, modifies, commits.
     * Cleans stale metadata when setting a new class.
     */
    function setStudentScheduleClass(studentId, week, day, hour, disciplineId, duration, instructorId) {
        // ---- PHASE 1: VALIDATE INPUTS ----
        var slotValidation = validateScheduleSlot(studentId, week, day, hour);
        if (!slotValidation.success) {
            return failure(slotValidation.message);
        }

        var validated = slotValidation.data;

        if (!isNonEmptyString(disciplineId)) {
            return failure('Discipline ID is required.');
        }

        var discipline = getDiscipline(disciplineId);
        if (!discipline) {
            return failure('Discipline not found.');
        }

        var durationNum = validateDuration(duration);
        if (durationNum === null) {
            return failure('Duration must be between 1 and 4 hours.');
        }

        if (validated.hour + durationNum > 24) {
            return failure('Class duration extends beyond the end of the day.');
        }

        if (instructorId && !getCharacterById(instructorId)) {
            return failure('Instructor not found.');
        }

        // ---- PHASE 2: VALIDATE CURRICULUM STRUCTURE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var structValidation = validateCurriculumStructure(data);
        if (!structValidation.success) {
            return structValidation;
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateSchedules = deepClone(data.curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var candidateRestDays = deepClone(data.curriculum.restDays || {});
        if (candidateRestDays === null) {
            return failure('Failed to prepare rest days data.');
        }

        var metadataCandidates = buildMetadataCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        // Ensure student schedule exists
        if (!candidateSchedules[validated.studentId]) {
            candidateSchedules[validated.studentId] = {};
        }
        if (!candidateSchedules[validated.studentId][validated.week]) {
            candidateSchedules[validated.studentId][validated.week] = {};
        }

        var weekSchedule = candidateSchedules[validated.studentId][validated.week];
        var day = validated.day;
        var hour = validated.hour;

        // Check for conflicts (duration-aware)
        if (hasStudentScheduleConflict(weekSchedule, day, hour, durationNum)) {
            return failure('Student already has a class during this time.');
        }

        // Check rest days
        var restDays = candidateRestDays[validated.studentId] && candidateRestDays[validated.studentId][validated.week]
            ? candidateRestDays[validated.studentId][validated.week]
            : [];

        if (restDays.indexOf(day) !== -1) {
            return failure('This is a rest day for this student.');
        }

        // Check weekly hour limit
        var usedHours = {};
        for (var d in weekSchedule) {
            if (!Object.prototype.hasOwnProperty.call(weekSchedule, d)) continue;
            var daySchedule = weekSchedule[d];
            if (!isObject(daySchedule)) continue;
            for (var h in daySchedule) {
                if (!Object.prototype.hasOwnProperty.call(daySchedule, h)) continue;
                var discId = daySchedule[h];
                if (discId) {
                    if (!usedHours[discId]) usedHours[discId] = 0;
                    usedHours[discId]++;
                }
            }
        }

        var usedCount = usedHours[disciplineId] || 0;
        var maxHours = discipline.weeklyHours ? Number(discipline.weeklyHours) : 1;
        if (usedCount + durationNum > maxHours) {
            return failure('This would exceed the weekly hour limit (' + maxHours + 'h) for this discipline.');
        }

        // ---- PHASE 4: APPLY TO CANDIDATES ----
        if (!weekSchedule[day]) weekSchedule[day] = {};

        var key = getScheduleKey(validated.studentId, validated.week, day, hour);

        for (var h = hour; h < hour + durationNum && h <= 23; h++) {
            weekSchedule[day][h] = disciplineId;
        }

        // Set metadata - clean stale metadata first
        delete metadataCandidates.classLabels[key];
        delete metadataCandidates.classGroupLabels[key];
        delete metadataCandidates.classLocations[key];

        if (instructorId) {
            metadataCandidates.classInstructors[key] = instructorId;
        } else {
            delete metadataCandidates.classInstructors[key];
        }

        metadataCandidates.classDurations[key] = durationNum;

        // ---- PHASE 5: COMMIT ----
        data.curriculum.schedules = candidateSchedules;
        data.curriculum.restDays = candidateRestDays;
        commitMetadataCandidates(data.curriculum, metadataCandidates);

        logActivity('Added class to schedule: ' + discipline.name);
        return success({ added: true });
    }

    /**
     * Remove a class from a student's schedule.
     * Candidate-based: validates, clones, modifies, commits.
     * Uses metadata to find the correct start hour.
     */
    function removeStudentScheduleClass(studentId, week, day, hour) {
        // ---- PHASE 1: VALIDATE INPUTS ----
        var slotValidation = validateScheduleSlot(studentId, week, day, hour);
        if (!slotValidation.success) {
            return failure(slotValidation.message);
        }

        var validated = slotValidation.data;

        // ---- PHASE 2: VALIDATE CURRICULUM STRUCTURE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var structValidation = validateCurriculumStructure(data);
        if (!structValidation.success) {
            return structValidation;
        }

        // Check if class exists
        var schedules = data.curriculum.schedules || {};
        var studentSchedule = schedules[validated.studentId];
        if (!studentSchedule || !studentSchedule[validated.week]) {
            return failure('No schedule for this student and week.');
        }

        var weekSchedule = studentSchedule[validated.week];
        var day = validated.day;
        var hour = validated.hour;

        if (!weekSchedule[day] || !weekSchedule[day][hour]) {
            return failure('No class at this time.');
        }

        var disciplineId = String(weekSchedule[day][hour]);

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateSchedules = deepClone(data.curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var candidateRestDays = deepClone(data.curriculum.restDays || {});
        if (candidateRestDays === null) {
            return failure('Failed to prepare rest days data.');
        }

        var metadataCandidates = buildMetadataCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        var weekScheduleClone = candidateSchedules[validated.studentId][validated.week];

        // ---- PHASE 4: FIND CLASS START USING METADATA ----
        var startHour = hour;
        var startKey = getScheduleKey(validated.studentId, validated.week, day, startHour);

        // Check if this hour has metadata
        var duration = getValidClassDuration(metadataCandidates, startKey);

        if (duration === null) {
            // No metadata at this hour - walk back to find start using normalised comparison
            while (startHour > 0 &&
                   weekScheduleClone[day] &&
                   String(weekScheduleClone[day][startHour - 1]) === disciplineId) {
                startHour--;
            }
            var foundKey = getScheduleKey(validated.studentId, validated.week, day, startHour);
            duration = getValidClassDuration(metadataCandidates, foundKey) || 1;
        }

        // Make sure the class covers the requested hour
        if (hour >= startHour + duration) {
            return failure('Class does not cover this hour.');
        }

        // ---- PHASE 5: DELETE FROM CANDIDATES ----
        for (var h = startHour; h < startHour + duration && h <= 23; h++) {
            if (weekScheduleClone[day] && String(weekScheduleClone[day][h]) === disciplineId) {
                delete weekScheduleClone[day][h];
            }
        }

        // Delete metadata from start hour only
        var key = getScheduleKey(validated.studentId, validated.week, day, startHour);
        delete metadataCandidates.classInstructors[key];
        delete metadataCandidates.classLabels[key];
        delete metadataCandidates.classGroupLabels[key];
        delete metadataCandidates.classDurations[key];
        delete metadataCandidates.classLocations[key];

        // Clean up empty day
        if (weekScheduleClone[day] && Object.keys(weekScheduleClone[day]).length === 0) {
            delete weekScheduleClone[day];
        }

        // ---- PHASE 6: COMMIT ----
        data.curriculum.schedules = candidateSchedules;
        data.curriculum.restDays = candidateRestDays;
        commitMetadataCandidates(data.curriculum, metadataCandidates);

        logActivity('Removed class from schedule');
        return success({ removed: true });
    }

    /**
     * Duplicate a student's schedule from one week to another.
     * Candidate-based: validates, clones, modifies, commits.
     * Checks entire duration before copying.
     * Handles rest days: only copies rest days if target day is empty.
     */
    function duplicateStudentSchedule(studentId, sourceWeek, targetWeek, overwrite) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var sourceWeekNum = validateWeek(sourceWeek);
        if (sourceWeekNum === null) {
            return failure('Valid source week is required (1-52).');
        }

        var targetWeekNum = validateWeek(targetWeek);
        if (targetWeekNum === null) {
            return failure('Valid target week is required (1-52).');
        }

        if (sourceWeekNum === targetWeekNum) {
            return failure('Source and target weeks must be different.');
        }

        overwrite = overwrite === true;

        // ---- PHASE 2: VALIDATE CURRICULUM STRUCTURE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var structValidation = validateCurriculumStructure(data);
        if (!structValidation.success) {
            return structValidation;
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateSchedules = deepClone(data.curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var candidateRestDays = deepClone(data.curriculum.restDays || {});
        if (candidateRestDays === null) {
            return failure('Failed to prepare rest days data.');
        }

        var metadataCandidates = buildMetadataCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        if (!candidateSchedules[studentId]) {
            candidateSchedules[studentId] = {};
        }

        var sourceSchedule = candidateSchedules[studentId][sourceWeekNum] || {};
        var targetSchedule = candidateSchedules[studentId][targetWeekNum] || {};

        // ---- PHASE 4: CLEAR TARGET (if overwrite) ----
        if (overwrite) {
            var targetKeyPrefix = studentId + '_' + targetWeekNum + '_';

            // Clear schedule
            for (var day in targetSchedule) {
                delete targetSchedule[day];
            }

            // Clear metadata
            for (var key in metadataCandidates.classInstructors) {
                if (key.indexOf(targetKeyPrefix) === 0) {
                    delete metadataCandidates.classInstructors[key];
                }
            }
            for (var key in metadataCandidates.classLabels) {
                if (key.indexOf(targetKeyPrefix) === 0) {
                    delete metadataCandidates.classLabels[key];
                }
            }
            for (var key in metadataCandidates.classGroupLabels) {
                if (key.indexOf(targetKeyPrefix) === 0) {
                    delete metadataCandidates.classGroupLabels[key];
                }
            }
            for (var key in metadataCandidates.classDurations) {
                if (key.indexOf(targetKeyPrefix) === 0) {
                    delete metadataCandidates.classDurations[key];
                }
            }
            for (var key in metadataCandidates.classLocations) {
                if (key.indexOf(targetKeyPrefix) === 0) {
                    delete metadataCandidates.classLocations[key];
                }
            }

            // Clear rest days
            if (candidateRestDays[studentId]) {
                delete candidateRestDays[studentId][targetWeekNum];
            }
        }

        // Ensure target exists
        if (!candidateSchedules[studentId][targetWeekNum]) {
            candidateSchedules[studentId][targetWeekNum] = {};
        }
        var targetScheduleRef = candidateSchedules[studentId][targetWeekNum];

        // ---- PHASE 5: COPY WITH DURATION-AWARE CONFLICT CHECK ----
        var copiedCount = 0;

        for (var day in sourceSchedule) {
            if (!isObject(sourceSchedule[day])) continue;

            for (var hour in sourceSchedule[day]) {
                var hourNum = parseInt(hour, 10);
                var sourceKey = getScheduleKey(studentId, sourceWeekNum, day, hourNum);

                // Check if this hour has metadata (is a class start)
                var duration = getValidClassDuration(metadataCandidates, sourceKey);
                if (duration === null) {
                    continue;
                }

                var disciplineId = String(sourceSchedule[day][hour]);

                // Check if the entire duration can be copied
                var canCopy = true;

                if (!overwrite) {
                    for (var h = hourNum; h < hourNum + duration && h <= 23; h++) {
                        if (targetScheduleRef[day] && targetScheduleRef[day][h]) {
                            canCopy = false;
                            break;
                        }
                    }
                }

                if (!canCopy) {
                    continue;
                }

                // Copy the class
                for (var h = hourNum; h < hourNum + duration && h <= 23; h++) {
                    if (!targetScheduleRef[day]) targetScheduleRef[day] = {};
                    targetScheduleRef[day][h] = disciplineId;
                }

                copiedCount++;

                var targetKey = getScheduleKey(studentId, targetWeekNum, day, hourNum);

                if (metadataCandidates.classInstructors[sourceKey]) {
                    metadataCandidates.classInstructors[targetKey] = metadataCandidates.classInstructors[sourceKey];
                }
                if (metadataCandidates.classLabels[sourceKey]) {
                    metadataCandidates.classLabels[targetKey] = metadataCandidates.classLabels[sourceKey];
                }
                if (metadataCandidates.classGroupLabels[sourceKey]) {
                    metadataCandidates.classGroupLabels[targetKey] = metadataCandidates.classGroupLabels[sourceKey];
                }
                if (metadataCandidates.classDurations[sourceKey]) {
                    metadataCandidates.classDurations[targetKey] = metadataCandidates.classDurations[sourceKey];
                }
                if (metadataCandidates.classLocations[sourceKey]) {
                    metadataCandidates.classLocations[targetKey] = metadataCandidates.classLocations[sourceKey];
                }
            }
        }

        // ---- PHASE 6: COPY REST DAYS (only if target day is empty) ----
        var sourceRestDays = candidateRestDays[studentId] && candidateRestDays[studentId][sourceWeekNum]
            ? candidateRestDays[studentId][sourceWeekNum]
            : [];

        if (sourceRestDays.length > 0) {
            var targetRestDays = candidateRestDays[studentId] && candidateRestDays[studentId][targetWeekNum]
                ? candidateRestDays[studentId][targetWeekNum]
                : [];

            // Only copy rest days that are not already occupied by classes
            var canCopyRestDays = true;

            if (!overwrite && targetScheduleRef) {
                for (var i = 0; i < sourceRestDays.length; i++) {
                    var day = sourceRestDays[i];
                    // Check if this day has any classes
                    if (targetScheduleRef[day] && Object.keys(targetScheduleRef[day]).length > 0) {
                        canCopyRestDays = false;
                        break;
                    }
                }
            }

            if (canCopyRestDays) {
                if (!candidateRestDays[studentId]) {
                    candidateRestDays[studentId] = {};
                }
                candidateRestDays[studentId][targetWeekNum] = sourceRestDays.slice();
            }
        }

        // ---- PHASE 7: COMMIT ----
        data.curriculum.schedules = candidateSchedules;
        data.curriculum.restDays = candidateRestDays;
        commitMetadataCandidates(data.curriculum, metadataCandidates);

        logActivity('Duplicated schedule from week ' + sourceWeekNum + ' to ' + targetWeekNum);
        return success({ copiedCount: copiedCount });
    }

    /**
     * Clear a student's schedule for a week.
     * Candidate-based: validates, clones, modifies, commits.
     */
    function clearStudentSchedule(studentId, week) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        // ---- PHASE 2: VALIDATE CURRICULUM STRUCTURE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var structValidation = validateCurriculumStructure(data);
        if (!structValidation.success) {
            return structValidation;
        }

        var schedules = data.curriculum.schedules || {};
        if (!schedules[studentId] || !schedules[studentId][weekNum]) {
            return success({ cleared: false, message: 'No schedule for this week.' });
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateSchedules = deepClone(data.curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var candidateRestDays = deepClone(data.curriculum.restDays || {});
        if (candidateRestDays === null) {
            return failure('Failed to prepare rest days data.');
        }

        var metadataCandidates = buildMetadataCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        var weekSchedule = candidateSchedules[studentId][weekNum];
        var keyPrefix = studentId + '_' + weekNum + '_';

        // ---- PHASE 4: CLEAR CANDIDATES ----
        // Clear schedule
        for (var day in weekSchedule) {
            delete weekSchedule[day];
        }
        delete candidateSchedules[studentId][weekNum];

        // Clear rest days
        if (candidateRestDays[studentId]) {
            delete candidateRestDays[studentId][weekNum];
        }

        // Clear metadata
        for (var key in metadataCandidates.classInstructors) {
            if (key.indexOf(keyPrefix) === 0) {
                delete metadataCandidates.classInstructors[key];
            }
        }
        for (var key in metadataCandidates.classLabels) {
            if (key.indexOf(keyPrefix) === 0) {
                delete metadataCandidates.classLabels[key];
            }
        }
        for (var key in metadataCandidates.classGroupLabels) {
            if (key.indexOf(keyPrefix) === 0) {
                delete metadataCandidates.classGroupLabels[key];
            }
        }
        for (var key in metadataCandidates.classDurations) {
            if (key.indexOf(keyPrefix) === 0) {
                delete metadataCandidates.classDurations[key];
            }
        }
        for (var key in metadataCandidates.classLocations) {
            if (key.indexOf(keyPrefix) === 0) {
                delete metadataCandidates.classLocations[key];
            }
        }

        // ---- PHASE 5: COMMIT ----
        data.curriculum.schedules = candidateSchedules;
        data.curriculum.restDays = candidateRestDays;
        commitMetadataCandidates(data.curriculum, metadataCandidates);

        logActivity('Cleared schedule for week ' + weekNum);
        return success({ cleared: true });
    }

    // ============================================================
    // REST DAYS OPERATIONS
    // ============================================================

    function getStudentRestDays(studentId, week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.restDays) {
            return [];
        }

        if (!data.curriculum.restDays[studentId] || !data.curriculum.restDays[studentId][weekNum]) {
            return [];
        }

        return data.curriculum.restDays[studentId][weekNum].slice();
    }

    function setStudentRestDays(studentId, week, days) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!Array.isArray(days)) {
            return failure('Rest days must be an array.');
        }

        // ---- PHASE 2: NORMALISE AND VALIDATE ----
        var validDays = [];
        var seen = {};

        for (var i = 0; i < days.length; i++) {
            var day = days[i];

            if (!isSafeInteger(day) || day < 1 || day > 7) {
                return failure('All rest days must be valid days (1-7).');
            }

            var key = String(day);
            if (!seen[key]) {
                seen[key] = true;
                validDays.push(day);
            }
        }

        validDays.sort(function(a, b) { return a - b; });

        // ---- PHASE 3: VALIDATE CURRICULUM STRUCTURE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var structValidation = validateCurriculumStructure(data);
        if (!structValidation.success) {
            return structValidation;
        }

        // ---- PHASE 4: BUILD CANDIDATES ----
        var candidateRestDays = deepClone(data.curriculum.restDays || {});
        if (candidateRestDays === null) {
            return failure('Failed to prepare rest days data.');
        }

        var candidateSchedules = deepClone(data.curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var metadataCandidates = buildMetadataCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        if (!candidateRestDays[studentId]) {
            candidateRestDays[studentId] = {};
        }

        candidateRestDays[studentId][weekNum] = validDays;

        // ---- PHASE 5: REMOVE CLASSES ON REST DAYS FROM CANDIDATE SCHEDULES ----
        if (candidateSchedules[studentId] && candidateSchedules[studentId][weekNum]) {
            var weekSchedule = candidateSchedules[studentId][weekNum];
            var keyPrefix = studentId + '_' + weekNum + '_';

            validDays.forEach(function(day) {
                if (weekSchedule[day]) {
                    // Find all classes on this day and remove metadata
                    for (var hour in weekSchedule[day]) {
                        var hourNum = parseInt(hour, 10);
                        var key = getScheduleKey(studentId, weekNum, day, hourNum);
                        // Check if this hour has metadata (is a class start)
                        if (getValidClassDuration(metadataCandidates, key) !== null) {
                            delete metadataCandidates.classInstructors[key];
                            delete metadataCandidates.classLabels[key];
                            delete metadataCandidates.classGroupLabels[key];
                            delete metadataCandidates.classDurations[key];
                            delete metadataCandidates.classLocations[key];
                        }
                    }
                    delete weekSchedule[day];
                }
            });
        }

        // ---- PHASE 6: COMMIT ----
        data.curriculum.restDays = candidateRestDays;
        data.curriculum.schedules = candidateSchedules;
        commitMetadataCandidates(data.curriculum, metadataCandidates);

        logActivity('Set rest days for student week ' + weekNum);
        return success({ days: validDays });
    }

    // ============================================================
    // INSTRUCTOR CALENDAR OPERATIONS
    // ============================================================

    function getInstructorTemplates(instructorId, week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.instructorTemplates) {
            return {};
        }

        var templateKey = instructorId + '_' + weekNum;
        var templates = data.curriculum.instructorTemplates[templateKey] || {};

        // Clone to prevent external mutation
        var result = {};
        for (var key in templates) {
            if (!Object.prototype.hasOwnProperty.call(templates, key)) continue;
            result[key] = deepClone(templates[key]);
        }
        return result;
    }

    function setInstructorTemplate(instructorId, week, day, hour, data) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(instructorId)) {
            return failure('Instructor ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var dayNum = validateDay(day);
        if (dayNum === null) {
            return failure('Valid day is required (1-7).');
        }

        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return failure('Valid hour is required (0-23).');
        }

        if (!data || !isNonEmptyString(data.disciplineId)) {
            return failure('Discipline ID is required.');
        }

        var discipline = getDiscipline(data.disciplineId);
        if (!discipline) {
            return failure('Discipline not found.');
        }

        var durationNum = validateDuration(data.duration);
        if (durationNum === null) {
            return failure('Duration must be between 1 and 4 hours.');
        }

        if (hourNum + durationNum > 24) {
            return failure('Class duration extends beyond the end of the day.');
        }

        var instructor = getCharacterById(instructorId);
        if (!instructor) {
            return failure('Instructor not found.');
        }

        // ---- PHASE 2: VALIDATE CURRICULUM STRUCTURE ----
        var store = getDataStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        var structValidation = validateCurriculumStructure(store);
        if (!structValidation.success) {
            return structValidation;
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateTemplates = deepClone(store.curriculum.instructorTemplates || {});
        if (candidateTemplates === null) {
            return failure('Failed to prepare template data.');
        }

        var templateKey = instructorId + '_' + weekNum;
        if (!candidateTemplates[templateKey]) {
            candidateTemplates[templateKey] = {};
        }

        // Duration-aware overlap check
        if (hasDurationOverlap(candidateTemplates[templateKey], dayNum, hourNum, durationNum)) {
            return failure('Class template overlaps with an existing template at this time.');
        }

        var classKey = dayNum + '_' + hourNum;

        candidateTemplates[templateKey][classKey] = {
            disciplineId: String(data.disciplineId),
            label: data.label || '',
            groupLabel: data.groupLabel || '',
            duration: durationNum,
            assignedStudents: Array.isArray(data.assignedStudents) ? data.assignedStudents.slice() : []
        };

        // ---- PHASE 4: COMMIT ----
        store.curriculum.instructorTemplates = candidateTemplates;

        logActivity('Added instructor class template: ' + discipline.name);
        return success({ added: true });
    }

    function removeInstructorTemplate(instructorId, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(instructorId)) {
            return failure('Instructor ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var dayNum = validateDay(day);
        if (dayNum === null) {
            return failure('Valid day is required (1-7).');
        }

        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return failure('Valid hour is required (0-23).');
        }

        // ---- PHASE 2: VALIDATE CURRICULUM STRUCTURE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var structValidation = validateCurriculumStructure(data);
        if (!structValidation.success) {
            return structValidation;
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateTemplates = deepClone(data.curriculum.instructorTemplates || {});
        if (candidateTemplates === null) {
            return failure('Failed to prepare template data.');
        }

        var templateKey = instructorId + '_' + weekNum;
        if (!candidateTemplates[templateKey]) {
            return failure('No template for this instructor and week.');
        }

        var classKey = dayNum + '_' + hourNum;
        if (!candidateTemplates[templateKey][classKey]) {
            return failure('No class template at this time.');
        }

        delete candidateTemplates[templateKey][classKey];

        if (Object.keys(candidateTemplates[templateKey]).length === 0) {
            delete candidateTemplates[templateKey];
        }

        // ---- PHASE 4: COMMIT ----
        data.curriculum.instructorTemplates = candidateTemplates;

        logActivity('Removed instructor class template');
        return success({ removed: true });
    }

    function getInstructorBlocks(instructorId, week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.instructorBlocks) {
            return {};
        }

        var blockKey = instructorId + '_' + weekNum;
        var blocks = data.curriculum.instructorBlocks[blockKey] || {};

        // Clone to prevent external mutation
        var result = {};
        for (var day in blocks) {
            if (!Object.prototype.hasOwnProperty.call(blocks, day)) continue;
            result[day] = {};
            for (var hour in blocks[day]) {
                if (!Object.prototype.hasOwnProperty.call(blocks[day], hour)) continue;
                result[day][hour] = deepClone(blocks[day][hour]);
            }
        }
        return result;
    }

    function setInstructorBlock(instructorId, week, day, hour, data) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(instructorId)) {
            return failure('Instructor ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var dayNum = validateDay(day);
        if (dayNum === null) {
            return failure('Valid day is required (1-7).');
        }

        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return failure('Valid hour is required (0-23).');
        }

        if (!data || typeof data !== 'object') {
            return failure('Block data is required.');
        }

        var durationNum = validateDuration(data.duration);
        if (durationNum === null) {
            return failure('Duration must be between 1 and 4 hours.');
        }

        if (hourNum + durationNum > 24) {
            return failure('Block duration extends beyond the end of the day.');
        }

        var instructor = getCharacterById(instructorId);
        if (!instructor) {
            return failure('Instructor not found.');
        }

        // ---- PHASE 2: VALIDATE CURRICULUM STRUCTURE ----
        var store = getDataStore();
        if (!store) {
            return failure('Data store is not available.');
        }

        var structValidation = validateCurriculumStructure(store);
        if (!structValidation.success) {
            return structValidation;
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateBlocks = deepClone(store.curriculum.instructorBlocks || {});
        if (candidateBlocks === null) {
            return failure('Failed to prepare block data.');
        }

        var blockKey = instructorId + '_' + weekNum;
        if (!candidateBlocks[blockKey]) {
            candidateBlocks[blockKey] = {};
        }
        if (!candidateBlocks[blockKey][dayNum]) {
            candidateBlocks[blockKey][dayNum] = {};
        }

        // Duration-aware overlap check
        if (hasDurationOverlap(candidateBlocks[blockKey], dayNum, hourNum, durationNum)) {
            return failure('Time slot already has a block.');
        }

        candidateBlocks[blockKey][dayNum][hourNum] = {
            label: data.label || 'Blocked Time',
            groupLabel: data.groupLabel || null,
            duration: durationNum,
            disciplineId: data.disciplineId || null
        };

        // ---- PHASE 4: AUTO-ASSIGN STUDENTS IF GROUP LABEL PROVIDED ----
        var autoAssignedCount = 0;

        if (data.groupLabel && data.disciplineId) {
            // This would integrate with group-core in production
            autoAssignedCount = 0;
        }

        // ---- PHASE 5: COMMIT ----
        store.curriculum.instructorBlocks = candidateBlocks;

        logActivity('Added instructor block');
        return success({ added: true, autoAssignedCount: autoAssignedCount });
    }

    function removeInstructorBlock(instructorId, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(instructorId)) {
            return failure('Instructor ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var dayNum = validateDay(day);
        if (dayNum === null) {
            return failure('Valid day is required (1-7).');
        }

        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return failure('Valid hour is required (0-23).');
        }

        // ---- PHASE 2: VALIDATE CURRICULUM STRUCTURE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var structValidation = validateCurriculumStructure(data);
        if (!structValidation.success) {
            return structValidation;
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateBlocks = deepClone(data.curriculum.instructorBlocks || {});
        if (candidateBlocks === null) {
            return failure('Failed to prepare block data.');
        }

        var blockKey = instructorId + '_' + weekNum;
        if (!candidateBlocks[blockKey] ||
            !candidateBlocks[blockKey][dayNum] ||
            !candidateBlocks[blockKey][dayNum][hourNum]) {
            return failure('No block at this time.');
        }

        delete candidateBlocks[blockKey][dayNum][hourNum];

        if (Object.keys(candidateBlocks[blockKey][dayNum]).length === 0) {
            delete candidateBlocks[blockKey][dayNum];
        }

        if (Object.keys(candidateBlocks[blockKey]).length === 0) {
            delete candidateBlocks[blockKey];
        }

        // ---- PHASE 4: COMMIT ----
        data.curriculum.instructorBlocks = candidateBlocks;

        logActivity('Removed instructor block');
        return success({ removed: true });
    }

    // ============================================================
    // LOCATION SCHEDULE OPERATIONS
    // ============================================================

    function getLocationSchedule(locationId, week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return {};
        }

        var data = getDataStore();
        if (!data || !data.locationSchedules) {
            return {};
        }

        var key = locationId + '_' + weekNum;
        if (data.locationSchedules[key]) {
            // Clone to prevent external mutation
            var schedule = data.locationSchedules[key];
            var result = {};
            for (var day in schedule) {
                if (!Object.prototype.hasOwnProperty.call(schedule, day)) continue;
                result[day] = {};
                for (var hour in schedule[day]) {
                    if (!Object.prototype.hasOwnProperty.call(schedule[day], hour)) continue;
                    result[day][hour] = schedule[day][hour];
                }
            }
            return result;
        }
        return {};
    }

    function setLocationClass(locationId, week, day, hour, disciplineId) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(locationId)) {
            return failure('Location ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var dayNum = validateDay(day);
        if (dayNum === null) {
            return failure('Valid day is required (1-7).');
        }

        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return failure('Valid hour is required (0-23).');
        }

        if (!isNonEmptyString(disciplineId)) {
            return failure('Discipline ID is required.');
        }

        var discipline = getDiscipline(disciplineId);
        if (!discipline) {
            return failure('Discipline not found.');
        }

        var location = getLocationById(locationId);
        if (!location) {
            return failure('Location not found.');
        }

        // ---- PHASE 2: VALIDATE STRUCTURE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var locValidation = validateLocationStructure(data);
        if (!locValidation.success) {
            return locValidation;
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateSchedules = deepClone(data.locationSchedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var key = locationId + '_' + weekNum;
        if (!candidateSchedules[key]) {
            candidateSchedules[key] = {};
        }
        if (!candidateSchedules[key][dayNum]) {
            candidateSchedules[key][dayNum] = {};
        }

        // Overwrite without conflict detection (location assignment is replacement)
        candidateSchedules[key][dayNum][hourNum] = disciplineId;

        // ---- PHASE 4: COMMIT ----
        data.locationSchedules = candidateSchedules;

        logActivity('Assigned class to location: ' + discipline.name);
        return success({ assigned: true });
    }

    function removeLocationClass(locationId, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(locationId)) {
            return failure('Location ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var dayNum = validateDay(day);
        if (dayNum === null) {
            return failure('Valid day is required (1-7).');
        }

        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return failure('Valid hour is required (0-23).');
        }

        // ---- PHASE 2: VALIDATE STRUCTURE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var locValidation = validateLocationStructure(data);
        if (!locValidation.success) {
            return locValidation;
        }

        if (!data.locationSchedules) {
            return failure('No location schedules found.');
        }

        var key = locationId + '_' + weekNum;
        if (!data.locationSchedules[key] || !data.locationSchedules[key][dayNum]) {
            return failure('No schedule for this day.');
        }

        if (!data.locationSchedules[key][dayNum][hourNum]) {
            return failure('No class at this time.');
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateSchedules = deepClone(data.locationSchedules);
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        delete candidateSchedules[key][dayNum][hourNum];

        if (Object.keys(candidateSchedules[key][dayNum]).length === 0) {
            delete candidateSchedules[key][dayNum];
        }

        if (Object.keys(candidateSchedules[key]).length === 0) {
            delete candidateSchedules[key];
        }

        // ---- PHASE 4: COMMIT ----
        data.locationSchedules = candidateSchedules;

        logActivity('Removed class from location');
        return success({ removed: true });
    }

    function clearLocationSchedule(locationId, week) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(locationId)) {
            return failure('Location ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        // ---- PHASE 2: VALIDATE STRUCTURE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var locValidation = validateLocationStructure(data);
        if (!locValidation.success) {
            return locValidation;
        }

        if (!data.locationSchedules) {
            return success({ cleared: false, message: 'No location schedules found.' });
        }

        var key = locationId + '_' + weekNum;
        if (!data.locationSchedules[key]) {
            return success({ cleared: false, message: 'No schedule for this week.' });
        }

        // ---- PHASE 3: BUILD CANDIDATES ----
        var candidateSchedules = deepClone(data.locationSchedules);
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        delete candidateSchedules[key];

        // ---- PHASE 4: COMMIT ----
        data.locationSchedules = candidateSchedules;

        logActivity('Cleared location schedule for week ' + weekNum);
        return success({ cleared: true });
    }

    function getClassLocation(studentId, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(studentId)) {
            return null;
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }

        var dayNum = validateDay(day);
        if (dayNum === null) {
            return null;
        }

        var hourNum = validateHour(hour);
        if (hourNum === null) {
            return null;
        }

        // ---- PHASE 2: GET DATA ----
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.classLocations) {
            return null;
        }

        // ---- PHASE 3: FIND CLASS START ----
        var schedules = data.curriculum.schedules || {};
        var studentSchedule = schedules[studentId];
        if (!studentSchedule || !studentSchedule[weekNum]) {
            return null;
        }

        var weekSchedule = studentSchedule[weekNum];
        if (!weekSchedule[dayNum] || !weekSchedule[dayNum][hourNum]) {
            return null;
        }

        // Find the class start hour
        var metadata = buildMetadataCandidates(data.curriculum);
        if (metadata === null) {
            return null;
        }

        var classStart = findClassStartHour(weekSchedule, metadata, studentId, weekNum, dayNum, hourNum);
        if (!classStart) {
            return null;
        }

        // Get the location from the start hour
        var key = getScheduleKey(studentId, weekNum, dayNum, classStart.startHour);
        if (data.curriculum.classLocations[key]) {
            return data.curriculum.classLocations[key];
        }

        return null;
    }

    function setClassLocation(studentId, week, day, hour, locationId) {
        // ---- PHASE 1: VALIDATE ----
        var slotValidation = validateScheduleSlot(studentId, week, day, hour);
        if (!slotValidation.success) {
            return failure(slotValidation.message);
        }

        var validated = slotValidation.data;

        if (locationId && !isNonEmptyString(locationId)) {
            return failure('Valid location ID is required.');
        }

        if (locationId && !getLocationById(locationId)) {
            return failure('Location not found.');
        }

        // ---- PHASE 2: VALIDATE CURRICULUM STRUCTURE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var structValidation = validateCurriculumStructure(data);
        if (!structValidation.success) {
            return structValidation;
        }

        // ---- PHASE 3: VERIFY CLASS EXISTS AT THIS HOUR ----
        var schedules = data.curriculum.schedules || {};
        var studentSchedule = schedules[validated.studentId];
        if (!studentSchedule || !studentSchedule[validated.week]) {
            return failure('No schedule for this student and week.');
        }

        var weekSchedule = studentSchedule[validated.week];
        if (!weekSchedule[validated.day] || !weekSchedule[validated.day][validated.hour]) {
            return failure('No class at this time.');
        }

        // ---- PHASE 4: FIND CLASS START ----
        var metadata = buildMetadataCandidates(data.curriculum);
        if (metadata === null) {
            return failure('Failed to prepare metadata data.');
        }

        var classStart = findClassStartHour(weekSchedule, metadata, validated.studentId, validated.week, validated.day, validated.hour);
        if (!classStart) {
            return failure('No valid class start found for this hour.');
        }

        // ---- PHASE 5: BUILD CANDIDATES ----
        var metadataCandidates = buildMetadataCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        var key = getScheduleKey(validated.studentId, validated.week, validated.day, classStart.startHour);

        if (locationId) {
            metadataCandidates.classLocations[key] = locationId;
        } else {
            delete metadataCandidates.classLocations[key];
        }

        // ---- PHASE 6: COMMIT ----
        commitMetadataCandidates(data.curriculum, metadataCandidates);

        return success({ set: true });
    }

    // ============================================================
    // SHARED GRID HELPERS (WITH CLASS SEMANTICS)
    // ============================================================

    function buildGrid(schedule, options) {
        options = options || {};
        var grid = {};

        var days = options.days || [1, 2, 3, 4, 5, 6, 7];
        var hours = options.hours || [];

        if (hours.length === 0) {
            for (var h = 0; h <= 23; h++) {
                hours.push(h);
            }
        }

        // Get metadata if available
        var metadata = options.metadata || {};
        var studentId = options.studentId || null;
        var week = options.week || null;

        days.forEach(function(day) {
            grid[day] = {};
            hours.forEach(function(hour) {
                var isOccupied = schedule && schedule[day] && schedule[day][hour];

                if (isOccupied) {
                    var disciplineId = schedule[day][hour];

                    // Try to find class start
                    var classStart = null;
                    if (studentId && week && metadata.classDurations) {
                        classStart = findClassStartHour(schedule, metadata, studentId, week, day, hour);
                    }

                    if (classStart && classStart.startHour === hour) {
                        // This is a class start
                        grid[day][hour] = {
                            occupied: true,
                            disciplineId: disciplineId,
                            duration: classStart.duration,
                            students: [],
                            label: metadata.classLabels ? metadata.classLabels[classStart.key] || null : null,
                            groupLabel: metadata.classGroupLabels ? metadata.classGroupLabels[classStart.key] || null : null,
                            instructorId: metadata.classInstructors ? metadata.classInstructors[classStart.key] || null : null,
                            isContinuation: false,
                            startHour: hour,
                            key: classStart.key
                        };
                    } else if (classStart) {
                        // This is a continuation
                        grid[day][hour] = {
                            occupied: true,
                            disciplineId: disciplineId,
                            duration: classStart.duration,
                            students: [],
                            label: null,
                            groupLabel: null,
                            instructorId: null,
                            isContinuation: true,
                            startHour: classStart.startHour,
                            key: classStart.key
                        };
                    } else {
                        // No metadata found - fallback
                        grid[day][hour] = {
                            occupied: true,
                            disciplineId: disciplineId,
                            duration: 1,
                            students: [],
                            label: null,
                            groupLabel: null,
                            instructorId: null,
                            isContinuation: false,
                            startHour: hour,
                            key: null
                        };
                    }
                } else {
                    grid[day][hour] = {
                        occupied: false,
                        disciplineId: null,
                        duration: 1,
                        students: [],
                        label: null,
                        groupLabel: null,
                        instructorId: null,
                        isContinuation: false,
                        startHour: null,
                        key: null
                    };
                }
            });
        });

        return grid;
    }

    function getOccupiedHours(schedule, day) {
        var occupied = {};
        if (!schedule || !schedule[day]) return occupied;

        for (var hour in schedule[day]) {
            if (schedule[day][hour]) {
                occupied[hour] = true;
            }
        }
        return occupied;
    }

    function getAvailableSlots(schedule, day, startHour, endHour) {
        if (startHour === undefined || startHour === null) {
            startHour = 0;
        }
        if (endHour === undefined || endHour === null) {
            endHour = 23;
        }

        var available = [];

        if (!schedule || !schedule[day]) {
            for (var h = startHour; h <= endHour; h++) {
                available.push(h);
            }
            return available;
        }

        for (var h = startHour; h <= endHour; h++) {
            if (!schedule[day][h]) {
                available.push(h);
            }
        }
        return available;
    }

    function hasConflict(schedule, day, hour, duration) {
        if (duration === undefined || duration === null) {
            duration = 1;
        }

        var durationNum = validateDuration(duration);
        if (durationNum === null) {
            return false;
        }

        if (!schedule || !schedule[day]) return false;

        for (var h = hour; h < hour + durationNum && h <= 23; h++) {
            if (schedule[day][h]) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get continuous occupied hours of the same discipline.
     * This measures OCCUPIED HOURS, not class duration.
     * For class duration, use metadata.classDurations.
     */
    function getContinuousOccupiedHours(schedule, day, hour) {
        if (!schedule || !schedule[day] || !schedule[day][hour]) {
            return 0;
        }

        var disciplineId = schedule[day][hour];
        var startHour = hour;
        while (startHour > 0 && String(schedule[day][startHour - 1]) === String(disciplineId)) {
            startHour--;
        }

        var endHour = hour;
        while (endHour < 23 && String(schedule[day][endHour + 1]) === String(disciplineId)) {
            endHour++;
        }

        return endHour - startHour + 1;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarCore = {
        // Student Schedule
        getStudentSchedule: getStudentSchedule,
        setStudentScheduleClass: setStudentScheduleClass,
        removeStudentScheduleClass: removeStudentScheduleClass,
        duplicateStudentSchedule: duplicateStudentSchedule,
        clearStudentSchedule: clearStudentSchedule,
        getStudentRestDays: getStudentRestDays,
        setStudentRestDays: setStudentRestDays,

        // Instructor Calendar
        getInstructorTemplates: getInstructorTemplates,
        setInstructorTemplate: setInstructorTemplate,
        removeInstructorTemplate: removeInstructorTemplate,
        getInstructorBlocks: getInstructorBlocks,
        setInstructorBlock: setInstructorBlock,
        removeInstructorBlock: removeInstructorBlock,

        // Location Schedule
        getLocationSchedule: getLocationSchedule,
        setLocationClass: setLocationClass,
        removeLocationClass: removeLocationClass,
        clearLocationSchedule: clearLocationSchedule,
        getClassLocation: getClassLocation,
        setClassLocation: setClassLocation,

        // Shared Helpers
        buildGrid: buildGrid,
        getOccupiedHours: getOccupiedHours,
        getAvailableSlots: getAvailableSlots,
        hasConflict: hasConflict,
        getContinuousOccupiedHours: getContinuousOccupiedHours,

        // Utilities
        getScheduleKey: getScheduleKey,
        validateWeek: validateWeek,
        validateDay: validateDay,
        validateHour: validateHour,
        validateDuration: validateDuration,
        validateScheduleSlot: validateScheduleSlot,

        // Metadata Helpers
        getClassMetadata: getClassMetadata,
        getValidClassDuration: getValidClassDuration,
        buildMetadataCandidates: buildMetadataCandidates,
        commitMetadataCandidates: commitMetadataCandidates,

        // Class Start Helpers
        findClassStartHour: findClassStartHour,

        // Overlap Helpers
        hasDurationOverlap: hasDurationOverlap,
        hasStudentScheduleConflict: hasStudentScheduleConflict
    };

})();
