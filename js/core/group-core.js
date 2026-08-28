/**
 * core/group-core.js - Auto-Group Core Operations
 * Single source of truth for all auto-group related data mutations
 * Path: js/core/group-core.js
 * 
 * This module handles:
 *   - Auto-group CRUD (create, read, update, delete)
 *   - Student assignment to groups (with conflict detection)
 *   - Slot management (add/remove class times)
 *   - Group rebuild from schedules
 *   - Group filtering and queries
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
 *   - 3. Clone ALL affected stores (autoGroups, schedules, and all metadata)
 *   - 4. Apply validated changes to candidates ONLY
 *   - 5. Pre-clone result data (safe)
 *   - 6. COMMIT ALL candidates to data store
 *   - 7. If any step before commit fails, return error WITHOUT mutating
 *   - No mutation of live state occurs before all validation completes
 * 
 * AFFECTED STORES:
 *   - curriculum.autoGroups
 *   - curriculum.schedules
 *   - curriculum.classInstructors
 *   - curriculum.classLabels
 *   - curriculum.classGroupLabels
 *   - curriculum.classDurations
 * 
 * GROUP SEMANTICS:
 *   - Groups are auto-created from Discipline + Instructor combinations
 *   - A group has a disciplineId, instructorId, displayName
 *   - Group key = disciplineId + '_' + instructorId (mandatory invariant)
 *   - Students in a group are assigned to ALL slots in the group (invariant)
 *   - Slots are (week, day, hour, duration, label)
 *   - Adding a student to a group assigns them to all slots
 *   - Removing a student removes them from all slots
 *   - Groups are stored in curriculum.autoGroups
 *   - Overlapping group slots are NOT allowed (would violate the invariant)
 *   - METADATA INVARIANT: Class metadata (instructor, label, duration, etc.)
 *     is stored ONLY at the START hour of a class, not at every occupied hour
 *   - Class identity = discipline + instructor + start metadata (all three must match)
 *   - classDurations is MANDATORY for all class starts (1-4 hours)
 *   - rebuildGroupsFromSchedules uses metadata only, no legacy fallback
 *   - Rebuild preserves the student↔slot invariant (students only added if they have the slot)
 *   - Rebuild rejects inconsistent group membership (students must share all slots)
 * 
 * REBUILD SEMANTICS (DESTRUCTIVE):
 *   - Rebuild replaces autoGroups entirely
 *   - It reconstructs groups from: schedules + classInstructors + classGroupLabels + classDurations
 *   - Only classes with classGroupLabels === 'auto-group' are included
 *   - Classes without instructor metadata are skipped
 *   - Classes without duration metadata are skipped
 *   - Overlapping slots are REJECTED (rebuild fails if found)
 *   - Inconsistent student membership is REJECTED (students must share all slots)
 *   - Rebuild does NOT preserve manually created auto-groups
 *   - Purpose: Rebuild from the canonical schedule data after data corruption or manual edits
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__groupCoreLoaded) {
        return;
    }
    window.__groupCoreLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var METADATA_KEYS = ['classInstructors', 'classLabels', 'classGroupLabels', 'classDurations'];
    var AUTO_GROUP_LABEL = 'auto-group';

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
            console.error('GroupCore: activity logging failed:', e);
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

    function getDisplayName(char) {
        if (typeof window.getDisplayName === 'function') {
            return window.getDisplayName(char);
        }
        if (char && char.firstName) {
            return char.firstName + (char.lastName ? ' ' + char.lastName : '');
        }
        return 'Unknown';
    }

    function getStudents() {
        if (typeof window.getStudents === 'function') {
            return window.getStudents();
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) return [];
        return data.characters.filter(function(c) {
            if (!c || typeof c !== 'object') return false;
            if (c.deceased) return false;
            var status = getStudentStatus(c);
            return status === 'trainee' || status === 'rookie' || status === 'junior';
        });
    }

    function getStudentStatus(char) {
        if (typeof window.getCurrentStatus === 'function') {
            var status = window.getCurrentStatus(char);
            return typeof status === 'string' ? status.toLowerCase() : '';
        }
        return '';
    }

    function getInstructors() {
        if (typeof window.getInstructors === 'function') {
            return window.getInstructors();
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) return [];
        return data.characters.filter(function(c) {
            if (!c || typeof c !== 'object') return false;
            if (c.deceased) return false;
            var status = getStudentStatus(c);
            return status === 'instructor' || status === 'teacher' ||
                   status === 'professor' || status === 'senior';
        });
    }

    function isCurrentStudent(studentId) {
        var students = getStudents();
        return students.some(function(s) {
            return String(s.id) === String(studentId);
        });
    }

    function isCurrentInstructor(instructorId) {
        var instructors = getInstructors();
        return instructors.some(function(i) {
            return String(i.id) === String(instructorId);
        });
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

    function getScheduleKey(studentId, week, day, hour) {
        return String(studentId) + '_' + String(week) + '_' + String(day) + '_' + String(hour);
    }

    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }

        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                console.error('GroupCore: structuredClone failed:', e);
                return null;
            }
        }

        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('GroupCore: JSON clone failed:', e);
            return null;
        }
    }

    // ============================================================
    // CLASS METADATA HELPERS (CENTRALISED CLASS IDENTITY)
    // ============================================================

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
            duration: duration
        };
    }

    /**
     * Check if a class matches a group's identity.
     * Identity = discipline + instructor + auto-group label + duration.
     */
    function matchesGroupClass(schedule, metadata, studentId, week, day, hour, group, expectedDuration) {
        if (!schedule || !schedule[day]) return false;
        if (String(schedule[day][hour]) !== String(group.disciplineId)) return false;

        var meta = getClassMetadata(metadata, studentId, week, day, hour);
        if (!meta) return false;

        if (meta.groupLabel !== AUTO_GROUP_LABEL) return false;
        if (String(meta.instructorId) !== String(group.instructorId)) return false;

        if (expectedDuration !== undefined && meta.duration !== expectedDuration) {
            return false;
        }

        return true;
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
                console.error('GroupCore: Failed to clone metadata store: ' + key);
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
     * Find a class start using metadata ONLY.
     * Searches backwards from the given hour for a key that has classDurations metadata.
     * This is the ONLY correct way to identify class starts.
     * Returns null if no metadata-defined class start is found that covers the requested hour.
     */
    function findClassStartByMetadata(schedule, day, hour, studentId, week, metadata) {
        if (!schedule || !schedule[day]) return null;

        var disciplineId = schedule[day][hour];
        if (disciplineId === undefined || disciplineId === null) return null;

        // Search backwards for a metadata-defined class start
        for (var candidate = hour; candidate >= 0; candidate--) {
            // First check discipline boundary
            if (String(schedule[day][candidate]) !== String(disciplineId)) {
                break;
            }

            var meta = getClassMetadata(metadata, studentId, week, day, candidate);

            if (!meta) {
                continue;
            }

            // Metadata defines a class starting here.
            // Make sure this class actually covers the requested hour.
            if (hour >= candidate + meta.duration) {
                return null;
            }

            return {
                startHour: candidate,
                duration: meta.duration,
                disciplineId: disciplineId,
                key: meta.key,
                instructorId: meta.instructorId
            };
        }

        return null;
    }

    /**
     * Check if a class is an auto-group class.
     */
    function isAutoGroupClass(metadata, studentId, week, day, hour) {
        var key = getScheduleKey(studentId, week, day, hour);
        if (metadata && metadata.classGroupLabels) {
            return metadata.classGroupLabels[key] === AUTO_GROUP_LABEL;
        }
        return false;
    }

    /**
     * Check if a slot overlaps with any existing slot in a group.
     * Slots overlap if they share week, day, and have overlapping hours.
     */
    function slotsOverlap(slot1, slot2) {
        if (slot1.week !== slot2.week) return false;
        if (slot1.day !== slot2.day) return false;

        var s1Start = slot1.hour;
        var s1End = slot1.hour + slot1.duration;
        var s2Start = slot2.hour;
        var s2End = slot2.hour + slot2.duration;

        return s1Start < s2End && s2Start < s1End;
    }

    /**
     * Check if a new slot overlaps with any existing slots in a group.
     */
    function hasSlotOverlap(newSlot, existingSlots) {
        for (var i = 0; i < existingSlots.length; i++) {
            if (slotsOverlap(newSlot, existingSlots[i])) {
                return true;
            }
        }
        return false;
    }

    /**
     * Validate a group's structural integrity.
     * Returns failure message if invalid, null if valid.
     */
    function validateAutoGroup(group) {
        if (!group || typeof group !== 'object') {
            return 'Group must be an object.';
        }

        if (!isNonEmptyString(group.id)) {
            return 'Group ID is required.';
        }

        if (!isNonEmptyString(group.disciplineId)) {
            return 'Discipline ID is required.';
        }

        if (!isNonEmptyString(group.instructorId)) {
            return 'Instructor ID is required.';
        }

        // Verify ID matches disciplineId + instructorId
        var expectedId = String(group.disciplineId) + '_' + String(group.instructorId);
        if (String(group.id) !== expectedId) {
            return 'Group ID does not match discipline and instructor.';
        }

        var discipline = getDiscipline(group.disciplineId);
        if (!discipline) {
            return 'Discipline not found.';
        }

        if (!isCurrentInstructor(group.instructorId)) {
            return 'Instructor not found or not an instructor.';
        }

        if (!Array.isArray(group.students)) {
            return 'Students must be an array.';
        }

        // Check for duplicate students and validate student IDs
        var seen = {};
        for (var i = 0; i < group.students.length; i++) {
            var id = String(group.students[i]);
            if (!isNonEmptyString(id)) {
                return 'Invalid student ID.';
            }
            if (seen[id]) {
                return 'Duplicate student ID: ' + id;
            }
            seen[id] = true;
            if (!isCurrentStudent(id)) {
                return 'Student not found or not a current student: ' + id;
            }
        }

        if (!Array.isArray(group.slots)) {
            return 'Slots must be an array.';
        }

        // Check for overlapping slots
        for (var i = 0; i < group.slots.length; i++) {
            var slot = group.slots[i];
            if (validateWeek(slot.week) === null) {
                return 'Invalid week in slot.';
            }
            if (validateDay(slot.day) === null) {
                return 'Invalid day in slot.';
            }
            if (validateHour(slot.hour) === null) {
                return 'Invalid hour in slot.';
            }
            if (validateDuration(slot.duration) === null) {
                return 'Invalid duration in slot.';
            }

            for (var j = i + 1; j < group.slots.length; j++) {
                if (slotsOverlap(slot, group.slots[j])) {
                    return 'Overlapping slots found in group.';
                }
            }
        }

        return null;
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

    // ============================================================
    // VALIDATE STRUCTURE
    // ============================================================

    function validateCurriculumStructure(data) {
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        if (data.curriculum.autoGroups !== undefined && !isObject(data.curriculum.autoGroups)) {
            return failure('Auto-group data is corrupted.');
        }

        if (data.curriculum.schedules !== undefined && !isObject(data.curriculum.schedules)) {
            return failure('Schedule data is corrupted.');
        }

        for (var i = 0; i < METADATA_KEYS.length; i++) {
            var key = METADATA_KEYS[i];
            if (data.curriculum[key] !== undefined && !isObject(data.curriculum[key])) {
                return failure('Metadata store "' + key + '" is corrupted.');
            }
        }

        return { success: true, data: data };
    }

    // ============================================================
    // GROUP QUERIES (with deep cloning for safety)
    // ============================================================

    function getAllAutoGroups() {
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.autoGroups) {
            return {};
        }

        var cloned = deepClone(data.curriculum.autoGroups);
        return cloned || {};
    }

    function getAutoGroup(key) {
        if (!isNonEmptyString(key)) return null;
        var groups = getAllAutoGroups();
        return groups[key] || null;
    }

    function getGroupsByDiscipline(disciplineId) {
        var groups = getAllAutoGroups();
        var result = {};

        for (var key in groups) {
            if (!Object.prototype.hasOwnProperty.call(groups, key)) continue;
            var group = groups[key];
            if (group && String(group.disciplineId) === String(disciplineId)) {
                result[key] = group;
            }
        }

        return result;
    }

    function getGroupsByInstructor(instructorId) {
        var groups = getAllAutoGroups();
        var result = {};

        for (var key in groups) {
            if (!Object.prototype.hasOwnProperty.call(groups, key)) continue;
            var group = groups[key];
            if (group && String(group.instructorId) === String(instructorId)) {
                result[key] = group;
            }
        }

        return result;
    }

    function getGroupStudents(key) {
        var group = getAutoGroup(key);
        if (!group || !Array.isArray(group.students)) {
            return [];
        }
        return group.students.slice();
    }

    function getGroupSlots(key) {
        var group = getAutoGroup(key);
        if (!group || !Array.isArray(group.slots)) {
            return [];
        }
        return group.slots.slice();
    }

    function getGroupStudentCount(key) {
        return getGroupStudents(key).length;
    }

    function getGroupSlotCount(key) {
        return getGroupSlots(key).length;
    }

    function isStudentInGroup(key, studentId) {
        var students = getGroupStudents(key);
        return students.some(function(id) {
            return String(id) === String(studentId);
        });
    }

    // ============================================================
    // GROUP MUTATIONS (candidate-based)
    // ============================================================

    function createAutoGroup(disciplineId, instructorId) {
        // ---- PHASE 1: NORMALISE IDs ----
        disciplineId = String(disciplineId);
        instructorId = String(instructorId);

        // ---- PHASE 2: VALIDATE ----
        if (!isNonEmptyString(disciplineId)) {
            return failure('Discipline ID is required.');
        }

        if (!isNonEmptyString(instructorId)) {
            return failure('Instructor ID is required.');
        }

        var discipline = getDiscipline(disciplineId);
        if (!discipline) {
            return failure('Discipline not found.');
        }

        if (!isCurrentInstructor(instructorId)) {
            return failure('Instructor not found or not an instructor.');
        }

        var instructor = getCharacterById(instructorId);
        if (!instructor) {
            return failure('Instructor not found.');
        }

        // ---- PHASE 3: CHECK EXISTING ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var structValidation = validateCurriculumStructure(data);
        if (!structValidation.success) {
            return structValidation;
        }

        var groupKey = disciplineId + '_' + instructorId;

        if (data.curriculum.autoGroups && data.curriculum.autoGroups[groupKey]) {
            return failure('Group already exists for this discipline and instructor.');
        }

        // ---- PHASE 4: BUILD GROUP ----
        var instructorName = getDisplayName(instructor);
        var shortInstructor = instructorName;
        var parts = instructorName.split(' ');
        if (parts.length >= 2) {
            shortInstructor = parts[0][0] + '. ' + parts[parts.length - 1];
        }

        var newGroup = {
            id: groupKey,
            disciplineId: disciplineId,
            instructorId: instructorId,
            displayName: discipline.name + ' (' + shortInstructor + ')',
            students: [],
            slots: [],
            createdAt: new Date().toISOString()
        };

        // Validate new group structure
        var validationError = validateAutoGroup(newGroup);
        if (validationError) {
            return failure('Invalid group structure: ' + validationError);
        }

        // ---- PHASE 5: PRE-CLONE RESULT ----
        var resultGroup = deepClone(newGroup);
        if (resultGroup === null) {
            return failure('Failed to prepare group data.');
        }

        // ---- PHASE 6: BUILD CANDIDATE ----
        var candidateGroups = deepClone(data.curriculum.autoGroups || {});
        if (candidateGroups === null) {
            return failure('Failed to prepare group data.');
        }

        candidateGroups[groupKey] = newGroup;

        // ---- PHASE 7: COMMIT ----
        data.curriculum.autoGroups = candidateGroups;

        logActivity('Created auto-group: ' + newGroup.displayName);
        return {
            success: true,
            group: resultGroup
        };
    }

    function deleteAutoGroup(key) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(key)) {
            return failure('Group key is required.');
        }

        // ---- PHASE 2: RETRIEVE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var structValidation = validateCurriculumStructure(data);
        if (!structValidation.success) {
            return structValidation;
        }

        if (!data.curriculum.autoGroups || !data.curriculum.autoGroups[key]) {
            return failure('Group not found.');
        }

        var group = data.curriculum.autoGroups[key];
        var displayName = group.displayName || key;
        var students = Array.isArray(group.students) ? group.students : [];
        var slots = Array.isArray(group.slots) ? group.slots : [];

        // ---- PHASE 3: BUILD ALL CANDIDATES ----
        var candidateGroups = deepClone(data.curriculum.autoGroups);
        if (candidateGroups === null) {
            return failure('Failed to prepare group data.');
        }

        var candidateSchedules = deepClone(data.curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var metadataCandidates = buildMetadataCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        // ---- PHASE 4: REMOVE STUDENTS FROM SCHEDULES IN CANDIDATES ----
        if (students.length > 0 && slots.length > 0) {
            slots.forEach(function(slot) {
                var weekNum = validateWeek(slot.week);
                if (weekNum === null) {
                    return;
                }

                var duration = validateDuration(slot.duration);
                if (duration === null) {
                    return;
                }

                students.forEach(function(studentId) {
                    var schedule = candidateSchedules[studentId];
                    if (!schedule || !schedule[weekNum]) return;

                    var weekSchedule = schedule[weekNum];
                    var day = slot.day;
                    var hour = slot.hour;

                    // Use the slot's start hour directly
                    var startHour = hour;

                    // Check if this is actually the group's class at this position
                    if (!matchesGroupClass(weekSchedule, metadataCandidates, studentId, weekNum, day, startHour, group, duration)) {
                        return;
                    }

                    // Delete occupied hours
                    for (var h = startHour; h < startHour + duration && h <= 23; h++) {
                        if (weekSchedule[day] && weekSchedule[day][h] === group.disciplineId) {
                            delete weekSchedule[day][h];
                        }
                    }

                    // Delete metadata from start hour only
                    var key2 = getScheduleKey(studentId, weekNum, day, startHour);
                    delete metadataCandidates.classInstructors[key2];
                    delete metadataCandidates.classLabels[key2];
                    delete metadataCandidates.classGroupLabels[key2];
                    delete metadataCandidates.classDurations[key2];
                });
            });
        }

        // ---- PHASE 5: DELETE GROUP FROM CANDIDATE ----
        delete candidateGroups[key];

        // ---- PHASE 6: COMMIT ALL CANDIDATES ----
        data.curriculum.autoGroups = candidateGroups;
        data.curriculum.schedules = candidateSchedules;
        commitMetadataCandidates(data.curriculum, metadataCandidates);

        logActivity('Deleted auto-group: ' + displayName);
        return { success: true };
    }

    // ============================================================
    // STUDENT MANAGEMENT (candidate-based)
    // ============================================================

    function addStudentToGroup(key, studentId, options) {
        options = options || {};

        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(key)) {
            return failure('Group key is required.');
        }

        studentId = String(studentId);

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        if (!isCurrentStudent(studentId)) {
            return failure('Student not found or not a current student.');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var structValidation = validateCurriculumStructure(data);
        if (!structValidation.success) {
            return structValidation;
        }

        if (!data.curriculum.autoGroups || !data.curriculum.autoGroups[key]) {
            return failure('Group not found.');
        }

        var group = data.curriculum.autoGroups[key];

        // Validate group structure
        var groupError = validateAutoGroup(group);
        if (groupError) {
            return failure('Group is corrupted: ' + groupError);
        }

        // Normalise ID comparison
        if (group.students.some(function(id) { return String(id) === studentId; })) {
            return failure('Student already in this group.');
        }

        var slots = Array.isArray(group.slots) ? group.slots : [];
        var student = getCharacterById(studentId);
        if (!student) {
            return failure('Student not found.');
        }

        // Validate all slots
        for (var i = 0; i < slots.length; i++) {
            if (validateWeek(slots[i].week) === null) {
                return failure('Group contains an invalid slot.');
            }
            if (validateDuration(slots[i].duration) === null) {
                return failure('Group contains an invalid slot duration.');
            }
        }

        // ---- PHASE 2: CHECK CONFLICTS (read-only, using metadata) ----
        var conflicts = [];
        var schedules = data.curriculum.schedules || {};
        var metadataCandidates = buildMetadataCandidates(data.curriculum);

        if (slots.length > 0 && metadataCandidates) {
            slots.forEach(function(slot) {
                var weekNum = validateWeek(slot.week);
                if (weekNum === null) return;

                var duration = validateDuration(slot.duration);
                if (duration === null) return;

                var studentSchedule = schedules[studentId];
                if (!studentSchedule || !studentSchedule[weekNum]) {
                    return;
                }

                var weekSchedule = studentSchedule[weekNum];
                var day = slot.day;
                var hour = slot.hour;

                for (var h = hour; h < hour + duration && h <= 23; h++) {
                    if (weekSchedule[day] && weekSchedule[day][h]) {
                        // Find the class start using metadata ONLY
                        var classInfo = findClassStartByMetadata(
                            weekSchedule, day, h, studentId, weekNum, metadataCandidates
                        );

                        if (classInfo) {
                            conflicts.push({
                                week: weekNum,
                                day: day,
                                hour: h,
                                startHour: classInfo.startHour,
                                duration: classInfo.duration,
                                existingDiscipline: classInfo.disciplineId,
                                key: classInfo.key,
                                instructorId: classInfo.instructorId
                            });
                        } else {
                            // No metadata-defined class found - this is a data integrity issue
                            conflicts.push({
                                week: weekNum,
                                day: day,
                                hour: h,
                                startHour: h,
                                duration: 1,
                                existingDiscipline: weekSchedule[day][h],
                                key: null,
                                noMetadata: true
                            });
                        }
                        break;
                    }
                }
            });
        }

        // ---- PHASE 3: HANDLE CONFLICTS ----
        if (conflicts.length > 0 && !options.confirmed) {
            return {
                success: false,
                message: 'Student has schedule conflicts.',
                conflicts: conflicts,
                requiresConfirmation: true
            };
        }

        // ---- PHASE 4: BUILD ALL CANDIDATES ----
        var candidateGroups = deepClone(data.curriculum.autoGroups);
        if (candidateGroups === null) {
            return failure('Failed to prepare group data.');
        }

        var candidateSchedules = deepClone(data.curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var metadataCandidatesClone = buildMetadataCandidates(data.curriculum);
        if (metadataCandidatesClone === null) {
            return failure('Failed to prepare metadata data.');
        }

        var candidateGroup = candidateGroups[key];
        if (!candidateGroup) {
            return failure('Group disappeared during preparation.');
        }

        // ---- PHASE 5: CLEAR CONFLICTS (if confirmed) ----
        if (options.confirmed) {
            conflicts.forEach(function(conflict) {
                var weekNum = conflict.week;
                var day = conflict.day;
                var startHour = conflict.startHour || conflict.hour;
                var duration = conflict.duration || 1;

                var studentSchedule = candidateSchedules[studentId];
                if (!studentSchedule || !studentSchedule[weekNum]) {
                    studentSchedule = studentSchedule || {};
                    studentSchedule[weekNum] = studentSchedule[weekNum] || {};
                }

                var weekSchedule = studentSchedule[weekNum];

                // Delete the conflicting class's occupied hours
                for (var h = startHour; h < startHour + duration && h <= 23; h++) {
                    if (weekSchedule[day] && weekSchedule[day][h] === conflict.existingDiscipline) {
                        delete weekSchedule[day][h];
                    }
                }

                // Delete metadata from start hour only
                if (conflict.key) {
                    delete metadataCandidatesClone.classInstructors[conflict.key];
                    delete metadataCandidatesClone.classLabels[conflict.key];
                    delete metadataCandidatesClone.classGroupLabels[conflict.key];
                    delete metadataCandidatesClone.classDurations[conflict.key];
                }
            });

            // Revalidate target slots after clearing
            for (var i = 0; i < slots.length; i++) {
                var slot = slots[i];
                var weekNum = validateWeek(slot.week);
                if (weekNum === null) continue;

                var duration = validateDuration(slot.duration);
                if (duration === null) continue;

                var studentSchedule = candidateSchedules[studentId];
                if (!studentSchedule || !studentSchedule[weekNum]) continue;

                var weekSchedule = studentSchedule[weekNum];
                var day = slot.day;
                var hour = slot.hour;

                for (var h = hour; h < hour + duration && h <= 23; h++) {
                    if (weekSchedule[day] && weekSchedule[day][h]) {
                        return failure('Could not clear all conflicts. Target slot still occupied.');
                    }
                }
            }
        }

        // ---- PHASE 6: ASSIGN STUDENT TO ALL SLOTS ----
        var assignedCount = 0;

        slots.forEach(function(slot) {
            var weekNum = validateWeek(slot.week);
            if (weekNum === null) return;

            var duration = validateDuration(slot.duration);
            if (duration === null) return;

            if (!candidateSchedules[studentId]) {
                candidateSchedules[studentId] = {};
            }
            if (!candidateSchedules[studentId][weekNum]) {
                candidateSchedules[studentId][weekNum] = {};
            }

            var weekSchedule = candidateSchedules[studentId][weekNum];
            var day = slot.day;
            var hour = slot.hour;

            // Check if slot is already occupied
            var hasConflict = false;
            for (var h = hour; h < hour + duration && h <= 23; h++) {
                if (weekSchedule[day] && weekSchedule[day][h]) {
                    hasConflict = true;
                    break;
                }
            }

            if (!hasConflict || options.confirmed) {
                if (!weekSchedule[day]) weekSchedule[day] = {};

                for (var h = hour; h < hour + duration && h <= 23; h++) {
                    weekSchedule[day][h] = group.disciplineId;
                }

                // Store metadata at start hour only
                var key2 = getScheduleKey(studentId, weekNum, day, hour);

                metadataCandidatesClone.classInstructors[key2] = group.instructorId;
                metadataCandidatesClone.classGroupLabels[key2] = AUTO_GROUP_LABEL;
                metadataCandidatesClone.classDurations[key2] = duration;

                if (slot.label) {
                    metadataCandidatesClone.classLabels[key2] = slot.label;
                } else {
                    delete metadataCandidatesClone.classLabels[key2];
                }

                assignedCount++;
            }
        });

        // ---- PHASE 7: ADD STUDENT TO GROUP IN CANDIDATE ----
        if (!Array.isArray(candidateGroup.students)) {
            candidateGroup.students = [];
        }
        candidateGroup.students.push(studentId);
        candidateGroup.students.sort();

        // ---- PHASE 8: COMMIT ALL CANDIDATES ----
        data.curriculum.autoGroups = candidateGroups;
        data.curriculum.schedules = candidateSchedules;
        commitMetadataCandidates(data.curriculum, metadataCandidatesClone);

        var studentName = getDisplayName(student);
        logActivity('Added ' + studentName + ' to group: ' + group.displayName);

        return {
            success: true,
            message: 'Student added to group.',
            conflictCount: conflicts.length,
            assignedCount: assignedCount
        };
    }

    function removeStudentFromGroup(key, studentId) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(key)) {
            return failure('Group key is required.');
        }

        studentId = String(studentId);

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var structValidation = validateCurriculumStructure(data);
        if (!structValidation.success) {
            return structValidation;
        }

        if (!data.curriculum.autoGroups || !data.curriculum.autoGroups[key]) {
            return failure('Group not found.');
        }

        var group = data.curriculum.autoGroups[key];

        if (!Array.isArray(group.students)) {
            return failure('Group has no students.');
        }

        if (!group.students.some(function(id) { return String(id) === studentId; })) {
            return failure('Student not in this group.');
        }

        var slots = Array.isArray(group.slots) ? group.slots : [];
        var student = getCharacterById(studentId);
        var studentName = student ? getDisplayName(student) : 'Unknown';

        // ---- PHASE 2: BUILD ALL CANDIDATES ----
        var candidateGroups = deepClone(data.curriculum.autoGroups);
        if (candidateGroups === null) {
            return failure('Failed to prepare group data.');
        }

        var candidateSchedules = deepClone(data.curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var metadataCandidates = buildMetadataCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        var candidateGroup = candidateGroups[key];
        if (!candidateGroup) {
            return failure('Group disappeared during preparation.');
        }

        // ---- PHASE 3: REMOVE FROM SCHEDULES IN CANDIDATES ----
        slots.forEach(function(slot) {
            var weekNum = validateWeek(slot.week);
            if (weekNum === null) return;

            var duration = validateDuration(slot.duration);
            if (duration === null) return;

            var studentSchedule = candidateSchedules[studentId];
            if (!studentSchedule || !studentSchedule[weekNum]) return;

            var weekSchedule = studentSchedule[weekNum];
            var day = slot.day;
            var hour = slot.hour;

            // Use the slot's start hour directly
            var startHour = hour;

            // Check if this is actually the group's class at this position
            if (!matchesGroupClass(weekSchedule, metadataCandidates, studentId, weekNum, day, startHour, group, duration)) {
                return;
            }

            // Delete occupied hours
            for (var h = startHour; h < startHour + duration && h <= 23; h++) {
                if (weekSchedule[day] && weekSchedule[day][h] === group.disciplineId) {
                    delete weekSchedule[day][h];
                }
            }

            // Delete metadata from start hour only
            var key2 = getScheduleKey(studentId, weekNum, day, startHour);
            delete metadataCandidates.classInstructors[key2];
            delete metadataCandidates.classLabels[key2];
            delete metadataCandidates.classGroupLabels[key2];
            delete metadataCandidates.classDurations[key2];
        });

        // ---- PHASE 4: REMOVE FROM GROUP IN CANDIDATE ----
        candidateGroup.students = candidateGroup.students.filter(function(id) {
            return String(id) !== studentId;
        });

        // Clean up empty groups
        var hasStudents = candidateGroup.students && candidateGroup.students.length > 0;
        var hasSlots = candidateGroup.slots && candidateGroup.slots.length > 0;

        if (!hasStudents && !hasSlots) {
            delete candidateGroups[key];
        }

        // ---- PHASE 5: COMMIT ALL CANDIDATES ----
        data.curriculum.autoGroups = candidateGroups;
        data.curriculum.schedules = candidateSchedules;
        commitMetadataCandidates(data.curriculum, metadataCandidates);

        logActivity('Removed ' + studentName + ' from group: ' + group.displayName);
        return { success: true };
    }

    // ============================================================
    // SLOT MANAGEMENT (candidate-based, conflict-first)
    // ============================================================

    function addSlotToGroup(key, week, day, hour, duration, label) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(key)) {
            return failure('Group key is required.');
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

        var durationNum = validateDuration(duration);
        if (durationNum === null) {
            return failure('Duration must be between 1 and 4 hours.');
        }

        if (hourNum + durationNum > 24) {
            return failure('Class duration extends beyond the end of the day.');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var structValidation = validateCurriculumStructure(data);
        if (!structValidation.success) {
            return structValidation;
        }

        if (!data.curriculum.autoGroups || !data.curriculum.autoGroups[key]) {
            return failure('Group not found.');
        }

        var group = data.curriculum.autoGroups[key];

        // Validate group structure
        var groupError = validateAutoGroup(group);
        if (groupError) {
            return failure('Group is corrupted: ' + groupError);
        }

        // ---- PHASE 2: CHECK OVERLAP WITH EXISTING SLOTS ----
        var newSlot = {
            week: weekNum,
            day: dayNum,
            hour: hourNum,
            duration: durationNum,
            label: label || ''
        };

        if (hasSlotOverlap(newSlot, group.slots)) {
            return failure('Slot overlaps with an existing slot in this group. Overlapping slots are not allowed.');
        }

        var students = Array.isArray(group.students) ? group.students : [];

        // ---- PHASE 3: CHECK CONFLICTS FOR ALL STUDENTS (read-only, using metadata) ----
        var conflictStudents = [];
        var schedules = data.curriculum.schedules || {};
        var metadataCandidates = buildMetadataCandidates(data.curriculum);

        students.forEach(function(studentId) {
            var studentSchedule = schedules[studentId];
            if (!studentSchedule || !studentSchedule[weekNum]) return;

            var weekSchedule = studentSchedule[weekNum];
            var hasConflict = false;

            for (var h = hourNum; h < hourNum + durationNum && h <= 23; h++) {
                if (weekSchedule[dayNum] && weekSchedule[dayNum][h]) {
                    hasConflict = true;
                    break;
                }
            }

            if (hasConflict) {
                var student = getCharacterById(studentId);
                conflictStudents.push(student ? getDisplayName(student) : 'Unknown');
            }
        });

        // ---- PHASE 4: ENFORCE INVARIANT ----
        if (conflictStudents.length > 0) {
            return {
                success: false,
                message: 'Some students have schedule conflicts. All students in a group must be assigned to all slots.',
                conflictStudents: conflictStudents
            };
        }

        // ---- PHASE 5: BUILD ALL CANDIDATES ----
        var candidateGroups = deepClone(data.curriculum.autoGroups);
        if (candidateGroups === null) {
            return failure('Failed to prepare group data.');
        }

        var candidateSchedules = deepClone(data.curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var metadataCandidatesClone = buildMetadataCandidates(data.curriculum);
        if (metadataCandidatesClone === null) {
            return failure('Failed to prepare metadata data.');
        }

        var candidateGroup = candidateGroups[key];
        if (!candidateGroup) {
            return failure('Group disappeared during preparation.');
        }

        // ---- PHASE 6: ADD SLOT TO GROUP IN CANDIDATE ----
        if (!Array.isArray(candidateGroup.slots)) {
            candidateGroup.slots = [];
        }

        candidateGroup.slots.push(newSlot);
        candidateGroup.slots.sort(function(a, b) {
            if (a.week !== b.week) return a.week - b.week;
            if (a.day !== b.day) return a.day - b.day;
            return a.hour - b.hour;
        });

        // ---- PHASE 7: ASSIGN TO ALL STUDENTS IN CANDIDATES ----
        var addedCount = 0;

        students.forEach(function(studentId) {
            var studentSchedule = candidateSchedules[studentId];
            if (!studentSchedule) {
                studentSchedule = {};
                candidateSchedules[studentId] = studentSchedule;
            }
            if (!studentSchedule[weekNum]) {
                studentSchedule[weekNum] = {};
            }

            var weekSchedule = studentSchedule[weekNum];

            if (!weekSchedule[dayNum]) weekSchedule[dayNum] = {};

            for (var h = hourNum; h < hourNum + durationNum && h <= 23; h++) {
                weekSchedule[dayNum][h] = group.disciplineId;
            }

            var key2 = getScheduleKey(studentId, weekNum, dayNum, hourNum);

            metadataCandidatesClone.classInstructors[key2] = group.instructorId;
            metadataCandidatesClone.classGroupLabels[key2] = AUTO_GROUP_LABEL;
            metadataCandidatesClone.classDurations[key2] = durationNum;

            if (label) {
                metadataCandidatesClone.classLabels[key2] = label;
            } else {
                delete metadataCandidatesClone.classLabels[key2];
            }

            addedCount++;
        });

        // ---- PHASE 8: COMMIT ALL CANDIDATES ----
        data.curriculum.autoGroups = candidateGroups;
        data.curriculum.schedules = candidateSchedules;
        commitMetadataCandidates(data.curriculum, metadataCandidatesClone);

        logActivity('Added slot to group: ' + group.displayName);
        return {
            success: true,
            addedCount: addedCount,
            conflictStudents: conflictStudents
        };
    }

    function removeSlotFromGroup(key, week, day, hour) {
        // ---- PHASE 1: VALIDATE ----
        if (!isNonEmptyString(key)) {
            return failure('Group key is required.');
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

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var structValidation = validateCurriculumStructure(data);
        if (!structValidation.success) {
            return structValidation;
        }

        if (!data.curriculum.autoGroups || !data.curriculum.autoGroups[key]) {
            return failure('Group not found.');
        }

        var group = data.curriculum.autoGroups[key];

        // Validate group structure
        var groupError = validateAutoGroup(group);
        if (groupError) {
            return failure('Group is corrupted: ' + groupError);
        }

        if (!Array.isArray(group.slots)) {
            return failure('Group has no slots.');
        }

        // Find slot - using start hour directly
        var slotIndex = -1;
        var slotData = null;

        for (var i = 0; i < group.slots.length; i++) {
            var s = group.slots[i];
            if (s.week === weekNum && s.day === dayNum && s.hour === hourNum) {
                slotIndex = i;
                slotData = s;
                break;
            }
        }

        if (slotIndex === -1) {
            return failure('Slot not found in group.');
        }

        var duration = validateDuration(slotData.duration);
        if (duration === null) {
            return failure('Group contains an invalid slot duration.');
        }

        var students = Array.isArray(group.students) ? group.students : [];

        // ---- PHASE 2: BUILD ALL CANDIDATES ----
        var candidateGroups = deepClone(data.curriculum.autoGroups);
        if (candidateGroups === null) {
            return failure('Failed to prepare group data.');
        }

        var candidateSchedules = deepClone(data.curriculum.schedules || {});
        if (candidateSchedules === null) {
            return failure('Failed to prepare schedule data.');
        }

        var metadataCandidates = buildMetadataCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        var candidateGroup = candidateGroups[key];
        if (!candidateGroup) {
            return failure('Group disappeared during preparation.');
        }

        // ---- PHASE 3: REMOVE FROM STUDENT SCHEDULES IN CANDIDATES ----
        students.forEach(function(studentId) {
            var studentSchedule = candidateSchedules[studentId];
            if (!studentSchedule || !studentSchedule[weekNum]) return;

            var weekSchedule = studentSchedule[weekNum];
            var startHour = hourNum;

            // Check if this is actually the group's class at this position
            if (!matchesGroupClass(weekSchedule, metadataCandidates, studentId, weekNum, dayNum, startHour, group, duration)) {
                return;
            }

            // Delete occupied hours
            for (var h = startHour; h < startHour + duration && h <= 23; h++) {
                if (weekSchedule[dayNum] && weekSchedule[dayNum][h] === group.disciplineId) {
                    delete weekSchedule[dayNum][h];
                }
            }

            // Delete metadata from start hour only
            var key2 = getScheduleKey(studentId, weekNum, dayNum, startHour);
            delete metadataCandidates.classInstructors[key2];
            delete metadataCandidates.classLabels[key2];
            delete metadataCandidates.classGroupLabels[key2];
            delete metadataCandidates.classDurations[key2];
        });

        // ---- PHASE 4: REMOVE SLOT FROM GROUP IN CANDIDATE ----
        candidateGroup.slots.splice(slotIndex, 1);

        // Clean up empty groups
        var hasStudents = candidateGroup.students && candidateGroup.students.length > 0;
        var hasSlots = candidateGroup.slots && candidateGroup.slots.length > 0;

        if (!hasStudents && !hasSlots) {
            delete candidateGroups[key];
        }

        // ---- PHASE 5: COMMIT ALL CANDIDATES ----
        data.curriculum.autoGroups = candidateGroups;
        data.curriculum.schedules = candidateSchedules;
        commitMetadataCandidates(data.curriculum, metadataCandidates);

        logActivity('Removed slot from group: ' + group.displayName);
        return { success: true };
    }

    // ============================================================
    // GROUP REBUILD (DESTRUCTIVE, INVARIANT-PRESERVING)
    // ============================================================

    function rebuildGroupsFromSchedules() {
        // ---- PHASE 1: RETRIEVE AND VALIDATE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var structValidation = validateCurriculumStructure(data);
        if (!structValidation.success) {
            return structValidation;
        }

        var metadataCandidates = buildMetadataCandidates(data.curriculum);
        if (metadataCandidates === null) {
            return failure('Failed to prepare metadata data.');
        }

        var newGroups = {};
        var count = 0;
        var overlapErrors = [];

        var students = getStudents();
        if (!Array.isArray(students)) students = [];

        var schedules = data.curriculum.schedules || {};

        // ---- PHASE 2: BUILD GROUP SLOT SETS ----
        // First pass: collect all class instances
        var classInstances = {};

        students.forEach(function(student) {
            var studentId = student.id;
            var studentSchedules = schedules[studentId] || {};

            for (var week in studentSchedules) {
                if (!Object.prototype.hasOwnProperty.call(studentSchedules, week)) continue;

                var weekNum = parseInt(week, 10);
                if (isNaN(weekNum)) continue;

                var weekSchedule = studentSchedules[week];
                if (!isObject(weekSchedule)) continue;

                for (var day in weekSchedule) {
                    if (!Object.prototype.hasOwnProperty.call(weekSchedule, day)) continue;

                    var dayNum = parseInt(day, 10);
                    if (isNaN(dayNum)) continue;

                    var daySchedule = weekSchedule[day];
                    if (!isObject(daySchedule)) continue;

                    for (var hour in daySchedule) {
                        if (!Object.prototype.hasOwnProperty.call(daySchedule, hour)) continue;

                        var hourNum = parseInt(hour, 10);
                        if (isNaN(hourNum)) continue;

                        var disciplineId = daySchedule[hourNum];
                        if (!disciplineId) continue;

                        // ---- ONLY PROCESS CLASS STARTS (using metadata) ----
                        var startKey = getScheduleKey(studentId, weekNum, dayNum, hourNum);

                        // Check if this hour has valid duration metadata
                        var duration = getValidClassDuration(metadataCandidates, startKey);
                        if (duration === null) {
                            continue;
                        }

                        // Check if this is an auto-group class
                        if (!isAutoGroupClass(metadataCandidates, studentId, weekNum, dayNum, hourNum)) {
                            continue;
                        }

                        // Get instructor from metadata
                        var instructorId = null;
                        if (metadataCandidates.classInstructors) {
                            instructorId = metadataCandidates.classInstructors[startKey];
                        }

                        if (!instructorId) {
                            continue;
                        }

                        // Build group key (normalise IDs)
                        var groupKey = String(disciplineId) + '_' + String(instructorId);

                        if (!classInstances[groupKey]) {
                            classInstances[groupKey] = {
                                disciplineId: String(disciplineId),
                                instructorId: String(instructorId),
                                slots: [],
                                studentClasses: {}
                            };
                        }

                        var group = classInstances[groupKey];

                        // Add slot
                        var newSlot = {
                            week: weekNum,
                            day: dayNum,
                            hour: hourNum,
                            duration: duration
                        };

                        var slotExists = group.slots.some(function(s) {
                            return s.week === weekNum &&
                                   s.day === dayNum &&
                                   s.hour === hourNum &&
                                   s.duration === duration;
                        });

                        if (!slotExists) {
                            // Check for overlap with existing slots
                            if (hasSlotOverlap(newSlot, group.slots)) {
                                overlapErrors.push({
                                    groupKey: groupKey,
                                    studentId: studentId,
                                    week: weekNum,
                                    day: dayNum,
                                    hour: hourNum,
                                    duration: duration
                                });
                            } else {
                                group.slots.push(newSlot);
                                group.slots.sort(function(a, b) {
                                    if (a.week !== b.week) return a.week - b.week;
                                    if (a.day !== b.day) return a.day - b.day;
                                    return a.hour - b.hour;
                                });
                            }
                        }

                        // Track which students have this slot
                        var slotKey = weekNum + '_' + dayNum + '_' + hourNum + '_' + duration;
                        if (!group.studentClasses[studentId]) {
                            group.studentClasses[studentId] = {};
                        }
                        group.studentClasses[studentId][slotKey] = true;
                    }
                }
            }
        });

        // ---- PHASE 3: CHECK FOR OVERLAPS ----
        if (overlapErrors.length > 0) {
            return {
                success: false,
                message: 'Cannot rebuild groups: schedule data contains overlapping auto-group classes.',
                overlaps: overlapErrors,
                overlapCount: overlapErrors.length
            };
        }

        // ---- PHASE 4: BUILD GROUPS WITH INVARIANT ENFORCEMENT ----
        for (var groupKey in classInstances) {
            if (!Object.prototype.hasOwnProperty.call(classInstances, groupKey)) continue;

            var instance = classInstances[groupKey];
            var slots = instance.slots;

            // Each student must have ALL slots
            var validStudents = [];
            var studentIds = Object.keys(instance.studentClasses);

            for (var i = 0; i < studentIds.length; i++) {
                var studentId = studentIds[i];
                var hasAllSlots = true;

                for (var j = 0; j < slots.length; j++) {
                    var slot = slots[j];
                    var slotKey = slot.week + '_' + slot.day + '_' + slot.hour + '_' + slot.duration;
                    if (!instance.studentClasses[studentId] || !instance.studentClasses[studentId][slotKey]) {
                        hasAllSlots = false;
                        break;
                    }
                }

                if (hasAllSlots) {
                    validStudents.push(studentId);
                }
            }

            // If no students have all slots, this group is invalid
            if (validStudents.length === 0) {
                // Skip this group entirely - it can't be reconstructed validly
                continue;
            }

            // Build the group
            var discipline = getDiscipline(instance.disciplineId);
            var instructor = getCharacterById(instance.instructorId);
            var disciplineName = discipline ? discipline.name : 'Unknown';
            var instructorName = instructor ? getDisplayName(instructor) : 'Unknown';

            var shortInstructor = instructorName;
            var parts = instructorName.split(' ');
            if (parts.length >= 2) {
                shortInstructor = parts[0][0] + '. ' + parts[parts.length - 1];
            }

            var group = {
                id: groupKey,
                disciplineId: instance.disciplineId,
                instructorId: instance.instructorId,
                displayName: disciplineName + ' (' + shortInstructor + ')',
                students: validStudents,
                slots: slots.slice(),
                createdAt: new Date().toISOString()
            };

            // Validate the reconstructed group
            var error = validateAutoGroup(group);
            if (error) {
                return failure('Rebuilt group is invalid: ' + error + ' (key: ' + groupKey + ')');
            }

            newGroups[groupKey] = group;
            count++;
        }

        // ---- PHASE 5: BUILD CANDIDATE ----
        var candidate = deepClone(newGroups);
        if (candidate === null) {
            return failure('Failed to prepare group data.');
        }

        // ---- PHASE 6: COMMIT (DESTRUCTIVE) ----
        data.curriculum.autoGroups = candidate;

        logActivity('Rebuilt groups from schedules: ' + count + ' groups created');
        return { success: true, count: count };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.GroupCore = {
        // Queries
        getAllAutoGroups: getAllAutoGroups,
        getAutoGroup: getAutoGroup,
        getGroupsByDiscipline: getGroupsByDiscipline,
        getGroupsByInstructor: getGroupsByInstructor,
        getGroupStudents: getGroupStudents,
        getGroupSlots: getGroupSlots,
        getGroupStudentCount: getGroupStudentCount,
        getGroupSlotCount: getGroupSlotCount,
        isStudentInGroup: isStudentInGroup,

        // Mutations
        createAutoGroup: createAutoGroup,
        deleteAutoGroup: deleteAutoGroup,
        addStudentToGroup: addStudentToGroup,
        removeStudentFromGroup: removeStudentFromGroup,
        addSlotToGroup: addSlotToGroup,
        removeSlotFromGroup: removeSlotFromGroup,
        rebuildGroupsFromSchedules: rebuildGroupsFromSchedules,

        // Helpers
        getClassMetadata: getClassMetadata,
        matchesGroupClass: matchesGroupClass,
        getValidClassDuration: getValidClassDuration,
        findClassStartByMetadata: findClassStartByMetadata,
        isAutoGroupClass: isAutoGroupClass,
        slotsOverlap: slotsOverlap,
        hasSlotOverlap: hasSlotOverlap,
        validateAutoGroup: validateAutoGroup
    };

})();
