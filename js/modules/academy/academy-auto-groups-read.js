/**
 * shared/queries/academy-auto-groups-read.js - Academy Auto-Group Reads
 * Read-only auto-group queries
 *
 * Path: js/shared/queries/academy-auto-groups-read.js
 *
 * This module provides READ-ONLY access to auto-group data:
 *   - Group lookup by key, by discipline, by instructor
 *   - Group rosters and slots
 *   - Group membership checks
 *   - Group summaries
 *
 * WHY THIS MODULE EXISTS:
 *   Auto-group reads used to live in academy-queries.js, mixed in
 *   with class reads. When academy-queries.js was reduced to a thin
 *   class-only facade, the group reads needed a home.
 *
 *   They could not move to academy-groups.js (the mutation module),
 *   because academy-groups.js's own read aliases delegate here. If
 *   reads lived in the mutation module, the aliases would recurse.
 *   Splitting reads into their own module breaks the cycle:
 *
 *     academy-groups.js     → mutates
 *     academy-auto-groups-read.js → reads  (this module)
 *     callers               → read via this module, write via academy-groups.js
 *
 * OWNERSHIP:
 *   Auto-groups live at window.data.curriculum.autoGroups. This module
 *   is the canonical read surface for that store.
 *
 * STORE SHAPE:
 *   curriculum.autoGroups = {
 *     [groupKey]: {
 *       id, disciplineId, instructorId, displayName,
 *       students: [charId, ...],
 *       slots: [{ week, day, hour, duration, label }],
 *       createdAt
 *     }
 *   }
 *
 *   groupKey is conventionally `disciplineId + '_' + instructorId`.
 *
 * READ DISCIPLINE:
 *   - Reads never create the store. When the store is missing, all
 *     functions return empty results, never a thrown error.
 *   - Collection reads return SHALLOW copies of the top-level map
 *     (a new object whose values are the same group references).
 *     Single-group reads return DEEP copies so callers cannot mutate
 *     the live group through the returned reference.
 *   - Malformed entries are skipped, not propagated.
 *
 * DEPENDENCIES (lazily loaded):
 *   - window.CharacterQueries   (for group summary display names)
 *   - window.DisciplineQueries  (for group summary discipline names)
 *   - window.ObjectUtils        (for deepClone)
 *
 *   All three are OPTIONAL. They are resolved at call time via
 *   accessors, not captured at load time. When absent:
 *     - CharacterQueries  → getCharacterDisplayName returns 'Unknown'
 *     - DisciplineQueries → getDisciplineName returns 'Unknown'
 *     - ObjectUtils       → deepClone falls back to structuredClone
 *                           or JSON.parse(JSON.stringify(...))
 *
 *   No load-time warning is emitted for these. The module's own
 *   docstring names them as lazy; the previous load-time
 *   `checkDependencies()` warn was removed because it was noise
 *   that fired for callers whose code path never touched a
 *   dependency the warn named.
 *
 * USAGE:
 *   var AR = window.AcademyAutoGroupsRead;
 *   var all = AR.getAllGroups();
 *   var group = AR.getGroup('disc_abc_char_123');
 *   var byDisc = AR.getGroupsByDiscipline('disc_abc');
 *   var students = AR.getGroupStudents('disc_abc_char_123');
 */

(function() {
    'use strict';

    if (window.__academyAutoGroupsReadLoaded) {
        return;
    }
    window.__academyAutoGroupsReadLoaded = true;

    // ============================================================
    // LAZY LOADING HELPERS
    // ============================================================
    //
    // The three dependencies are optional and resolved at call
    // time. No load-time check. No warning.

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    function getDisciplineQueries() {
        return window.DisciplineQueries || null;
    }

    function getObjectUtils() {
        return window.ObjectUtils || null;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function deepClone(value) {
        var ObjectUtils = getObjectUtils();
        if (ObjectUtils && typeof ObjectUtils.deepClone === 'function') {
            return ObjectUtils.deepClone(value);
        }
        if (value === null || typeof value !== 'object') {
            return value;
        }
        if (typeof structuredClone === 'function') {
            try { return structuredClone(value); } catch (_) {}
        }
        try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
    }

    function getCharacterDisplayName(charId) {
        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            return 'Unknown';
        }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return 'Unknown';
        }
        if (typeof CharacterQueries.getDisplayName === 'function') {
            return CharacterQueries.getDisplayName(char);
        }
        return 'Unknown';
    }

    function getDisciplineName(disciplineId) {
        var DisciplineQueries = getDisciplineQueries();
        if (!DisciplineQueries || typeof DisciplineQueries.getDiscipline !== 'function') {
            return 'Unknown';
        }
        var discipline = DisciplineQueries.getDiscipline(disciplineId);
        return discipline && discipline.name ? discipline.name : 'Unknown';
    }

    /**
     * Get the live autoGroups store from window.data.curriculum.
     * Returns an empty object when the store is missing — never null.
     * Never creates the store.
     *
     * @returns {object}
     */
    function getAutoGroupsStore() {
        var data = window.data || {};
        var curriculum = data.curriculum || {};
        var store = curriculum.autoGroups;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return {};
        }
        return store;
    }

    // ============================================================
    // COLLECTION READS
    // ============================================================

    /**
     * Get every auto-group.
     *
     * Returns a SHALLOW copy of the top-level map. The values are live
     * group references. Callers who need to mutate a returned group
     * must use `getGroup` instead, which returns a deep clone.
     *
     * @returns {object} Map of groupKey -> group
     */
    function getAllGroups() {
        var store = getAutoGroupsStore();
        var result = {};
        var keys = Object.keys(store);
        for (var i = 0; i < keys.length; i++) {
            result[keys[i]] = store[keys[i]];
        }
        return result;
    }

    /**
     * Get groups whose disciplineId matches.
     *
     * Returns a SHALLOW copy of the filtered map. The values are live
     * group references.
     *
     * @param {string} disciplineId
     * @returns {object} Map of groupKey -> group
     */
    function getGroupsByDiscipline(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return {};
        }
        var store = getAutoGroupsStore();
        var target = String(disciplineId);
        var result = {};
        var keys = Object.keys(store);
        for (var i = 0; i < keys.length; i++) {
            var group = store[keys[i]];
            if (group && String(group.disciplineId) === target) {
                result[keys[i]] = group;
            }
        }
        return result;
    }

    /**
     * Get groups whose instructorId matches.
     *
     * Returns a SHALLOW copy of the filtered map. The values are live
     * group references.
     *
     * @param {string} instructorId
     * @returns {object} Map of groupKey -> group
     */
    function getGroupsByInstructor(instructorId) {
        if (!isNonEmptyString(instructorId)) {
            return {};
        }
        var store = getAutoGroupsStore();
        var target = String(instructorId);
        var result = {};
        var keys = Object.keys(store);
        for (var i = 0; i < keys.length; i++) {
            var group = store[keys[i]];
            if (group && String(group.instructorId) === target) {
                result[keys[i]] = group;
            }
        }
        return result;
    }

    /**
     * Get groups that a student is a member of.
     *
     * Returns a SHALLOW copy of the filtered map. The values are live
     * group references.
     *
     * @param {string} studentId
     * @returns {object} Map of groupKey -> group
     */
    function getGroupsForStudent(studentId) {
        if (!isNonEmptyString(studentId)) {
            return {};
        }
        var store = getAutoGroupsStore();
        var target = String(studentId);
        var result = {};
        var keys = Object.keys(store);
        for (var i = 0; i < keys.length; i++) {
            var group = store[keys[i]];
            if (!group || !Array.isArray(group.students)) {
                continue;
            }
            for (var j = 0; j < group.students.length; j++) {
                if (String(group.students[j]) === target) {
                    result[keys[i]] = group;
                    break;
                }
            }
        }
        return result;
    }

    /**
     * Get groups that have at least one slot in the given week.
     *
     * Returns a SHALLOW copy of the filtered map. The values are live
     * group references.
     *
     * @param {number|string} week
     * @returns {object} Map of groupKey -> group
     */
    function getGroupsForWeek(week) {
        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum)) {
            return {};
        }
        var store = getAutoGroupsStore();
        var result = {};
        var keys = Object.keys(store);
        for (var i = 0; i < keys.length; i++) {
            var group = store[keys[i]];
            if (!group || !Array.isArray(group.slots)) {
                continue;
            }
            for (var j = 0; j < group.slots.length; j++) {
                if (group.slots[j] && group.slots[j].week === weekNum) {
                    result[keys[i]] = group;
                    break;
                }
            }
        }
        return result;
    }

    // ============================================================
    // SINGLE-GROUP READS
    // ============================================================

    /**
     * Get a single group by key.
     *
     * Returns a DEEP clone of the group. The caller cannot mutate the
     * live store through this reference.
     *
     * @param {string} key
     * @returns {object|null}
     */
    function getGroup(key) {
        if (!isNonEmptyString(key)) {
            return null;
        }
        var store = getAutoGroupsStore();
        var group = store[key];
        return group ? deepClone(group) : null;
    }

    /**
     * Get the student IDs of a group. Returns a fresh array.
     *
     * @param {string} key
     * @returns {array} Array of character IDs
     */
    function getGroupStudents(key) {
        if (!isNonEmptyString(key)) {
            return [];
        }
        var store = getAutoGroupsStore();
        var group = store[key];
        if (!group || !Array.isArray(group.students)) {
            return [];
        }
        return group.students.slice();
    }

    /**
     * Get the slots of a group. Returns deep clones of each slot.
     *
     * @param {string} key
     * @returns {array} Array of slot objects
     */
    function getGroupSlots(key) {
        if (!isNonEmptyString(key)) {
            return [];
        }
        var store = getAutoGroupsStore();
        var group = store[key];
        if (!group || !Array.isArray(group.slots)) {
            return [];
        }
        var result = [];
        for (var i = 0; i < group.slots.length; i++) {
            result.push(deepClone(group.slots[i]));
        }
        return result;
    }

    /**
     * Get the slots of a group that fall in the given week.
     * Returns deep clones of each slot.
     *
     * @param {string} key
     * @param {number|string} week
     * @returns {array} Array of slot objects
     */
    function getGroupSlotsByWeek(key, week) {
        var weekNum = parseInt(week, 10);
        if (!isNonEmptyString(key) || isNaN(weekNum)) {
            return [];
        }
        var slots = getGroupSlots(key);
        var result = [];
        for (var i = 0; i < slots.length; i++) {
            if (slots[i] && slots[i].week === weekNum) {
                result.push(slots[i]);
            }
        }
        return result;
    }

    /**
     * Get the number of students in a group.
     *
     * @param {string} key
     * @returns {number}
     */
    function getGroupStudentCount(key) {
        return getGroupStudents(key).length;
    }

    /**
     * Get the number of slots in a group.
     *
     * @param {string} key
     * @returns {number}
     */
    function getGroupSlotCount(key) {
        return getGroupSlots(key).length;
    }

    /**
     * Is a student a member of a group?
     *
     * @param {string} key
     * @param {string} studentId
     * @returns {boolean}
     */
    function isStudentInGroup(key, studentId) {
        if (!isNonEmptyString(key) || !isNonEmptyString(studentId)) {
            return false;
        }
        var store = getAutoGroupsStore();
        var group = store[key];
        if (!group || !Array.isArray(group.students)) {
            return false;
        }
        var target = String(studentId);
        for (var i = 0; i < group.students.length; i++) {
            if (String(group.students[i]) === target) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get the display name of a group.
     *
     * @param {string} key
     * @returns {string}
     */
    function getGroupDisplayName(key) {
        if (!isNonEmptyString(key)) {
            return 'Unknown Group';
        }
        var store = getAutoGroupsStore();
        var group = store[key];
        if (!group) {
            return 'Unknown Group';
        }
        return group.displayName || key;
    }

    // ============================================================
    // SUMMARIES
    // ============================================================

    /**
     * Get a summary of a group, resolving discipline and instructor
     * display names.
     *
     * @param {string} key
     * @returns {object|null}
     */
    function getGroupSummary(key) {
        if (!isNonEmptyString(key)) {
            return null;
        }
        var store = getAutoGroupsStore();
        var group = store[key];
        if (!group) {
            return null;
        }

        var students = Array.isArray(group.students) ? group.students : [];
        var slots = Array.isArray(group.slots) ? group.slots : [];

        return {
            key: key,
            id: group.id || key,
            displayName: group.displayName || key,
            disciplineId: group.disciplineId || null,
            disciplineName: getDisciplineName(group.disciplineId),
            instructorId: group.instructorId || null,
            instructorName: group.instructorId
                ? getCharacterDisplayName(group.instructorId)
                : 'Unknown',
            studentCount: students.length,
            slotCount: slots.length,
            createdAt: group.createdAt || ''
        };
    }

    /**
     * Get summaries for every group.
     *
     * @returns {array} Array of summary objects
     */
    function getAllGroupSummaries() {
        var store = getAutoGroupsStore();
        var keys = Object.keys(store);
        var result = [];
        for (var i = 0; i < keys.length; i++) {
            var summary = getGroupSummary(keys[i]);
            if (summary) {
                result.push(summary);
            }
        }
        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyAutoGroupsRead = Object.freeze({
        // Collection reads
        getAllGroups: getAllGroups,
        getGroupsByDiscipline: getGroupsByDiscipline,
        getGroupsByInstructor: getGroupsByInstructor,
        getGroupsForStudent: getGroupsForStudent,
        getGroupsForWeek: getGroupsForWeek,

        // Single-group reads
        getGroup: getGroup,
        getGroupStudents: getGroupStudents,
        getGroupSlots: getGroupSlots,
        getGroupSlotsByWeek: getGroupSlotsByWeek,
        getGroupStudentCount: getGroupStudentCount,
        getGroupSlotCount: getGroupSlotCount,
        isStudentInGroup: isStudentInGroup,
        getGroupDisplayName: getGroupDisplayName,

        // Summaries
        getGroupSummary: getGroupSummary,
        getAllGroupSummaries: getAllGroupSummaries
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyAutoGroupsRead;
        var missing = [];

        var required = [
            'getAllGroups', 'getGroupsByDiscipline', 'getGroupsByInstructor',
            'getGroupsForStudent', 'getGroupsForWeek',
            'getGroup', 'getGroupStudents', 'getGroupSlots',
            'getGroupSlotsByWeek', 'getGroupStudentCount', 'getGroupSlotCount',
            'isStudentInGroup', 'getGroupDisplayName',
            'getGroupSummary', 'getAllGroupSummaries'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademyAutoGroupsRead] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();