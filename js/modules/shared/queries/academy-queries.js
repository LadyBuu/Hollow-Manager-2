/**
 * shared/queries/academy-queries.js - Academy Queries
 * Read-only academy domain queries
 *
 * Path: js/shared/queries/academy-queries.js
 *
 * This module provides READ-ONLY access to academy class data.
 *
 * WHAT IT IS NOW:
 *   A thin facade over the academy domain modules. It exists so that
 *   legacy callers that were written against the old AcademyQueries
 *   surface (getClass, getClasses, getClassByName, getClassDisplayName,
 *   getCharacterClasses, getCharacterClassNames, isCharacterInClass,
 *   getClassStudents, getClassStudentIds) keep working, without every
 *   caller having to be rewritten to import AcademyClasses directly.
 *
 *   New code should call the domain modules directly:
 *     AcademyClasses.getClass(id)
 *     AcademyClasses.getClasses()
 *     AcademyClasses.getCharacterClasses(char)
 *     AcademyAggregator.getClassStudentsViewModel(classId)  // for students
 *
 * WHAT IT IS NOT:
 *   - Not a ranking service. Ranking data comes from AcademyRanking.
 *   - Not a grade service. Grade data comes from AcademyGrades.
 *   - Not a performance service. Averages come from AcademyPerformance.
 *   - Not an auto-group service. Groups come from AcademyQueries'
 *     sibling — see note below — or from window.data.curriculum.autoGroups
 *     via the group read module.
 *   - Not a team service. Teams come from TeamQueries.
 *   - Not a discipline service. Disciplines come from AcademyDisciplines.
 *   - Not a location service. Locations come from AcademyLocations.
 *   - Not a class detail aggregator. That is
 *     AcademyAggregator.getClassViewModel.
 *   - Not a student detail aggregator. That is
 *     AcademyAggregator.getStudentViewModel or CharacterAggregator.
 *
 * REMOVED FUNCTIONS (and their replacements):
 *   - calculateGradeSummary           → AcademyGrades.calculateSummary
 *   - calculateStudentGPA             → AcademyGrades.calculateStudentGPA
 *   - calculateClassRanking           → AcademyRanking.autoGenerate /
 *                                       AcademyPerformance.calculateRanking
 *   - getClassStudentsWithGrades      → AcademyAggregator.getClassViewModel
 *   - getStudentGrades / getClassGrades /
 *     getDisciplineGrades / getWeekGrades / getGrade / getAllGrades
 *                                     → AcademyGrades equivalents
 *   - getClassRankings / getStudentRank /
 *     getRankingsWithDetails / getRankings / calculateRankingSummary
 *                                     → AcademyRanking equivalents
 *   - getAllGroups / getGroup / getGroupsByDiscipline /
 *     getGroupsByInstructor / getGroupStudents / getGroupSlots /
 *     getGroupStudentCount / getGroupSlotCount / isStudentInGroup /
 *     getGroupsForStudent / getGroupsForWeek / getGroupSlotsByWeek /
 *     getGroupSummary / getAllGroupSummaries / getGroupDisplayName
 *                                     → New academy-auto-groups-read.js
 *                                       (auto-group reads are their own
 *                                        concern and are no longer bundled
 *                                        with class queries)
 *   - getAvailableStudents            → AcademyAggregator.getClassStudentsViewModel
 *                                       combined with a caller-side diff
 *   - getClassTeams / getAcademicTeamMembers /
 *     getAcademicTeamMemberCount      → TeamQueries equivalents
 *   - getStudentDetails / getClassDetails
 *                                     → AcademyAggregator.getClassViewModel
 *                                       or AcademyAggregator.getStudentViewModel
 *   - getDiscipline / getDisciplines /
 *     getAvailableDisciplines / getDisciplineName
 *                                     → AcademyDisciplines equivalents
 *   - getLocations / getLocation / getLocationName
 *                                     → AcademyLocations equivalents
 *   - getInstructors / getStudents / getClassInstructors
 *                                     → CharacterQueries equivalents
 *   - getCurrentWeek                  → CalendarQueries or a direct
 *                                       window.data.currentWeek read
 *   - isClassActive / isClassArchived /
 *     isClassGraduated                → inline on cls.status, or a small
 *                                       helper that consumes AcademyConstants
 *
 *   Note: the removed helpers are gone from this module, but the
 *   replacements exist elsewhere. Callers that used them must be
 *   migrated. The batch that removed these functions ships with the
 *   callers already migrated (character-aggregator.js,
 *   character-class-view.js, academy-character-detail.js,
 *   academy-crud-modals.js).
 *
 * OWNERSHIP:
 *   - Academy domain, class subset.
 *   - The class roster is DERIVED from character.classIds. There is no
 *     separate roster store; there has not been one since v15.
 *
 * CLASS MEMBERSHIP MODEL (v15+):
 *   character.classIds[] is the SINGLE SOURCE OF TRUTH for membership.
 *   The class roster is DERIVED: characters whose classIds include
 *   classId. There is no academy.classStudents store.
 *
 *   getClassStudents returns full character objects for that derived
 *   roster. getClassStudentIds returns the IDs. Both are thin
 *   projections over AcademyClasses' internal helpers.
 *
 * DEPENDENCIES (lazily loaded):
 *   - window.AcademyClasses    (from academy-classes.js)
 *   - window.CharacterQueries  (from character-queries.js)
 *   - window.ObjectUtils       (from object-utils.js)  — for deepClone
 *
 * USAGE:
 *   var AQ = window.AcademyQueries;
 *   var classes = AQ.getClasses();
 *   var students = AQ.getClassStudents('class_123');
 *   var ids = AQ.getClassStudentIds('class_123');
 */

(function() {
    'use strict';

    if (window.__academyQueriesLoaded) {
        return;
    }
    window.__academyQueriesLoaded = true;

    // ============================================================
    // LAZY LOADING HELPERS
    // ============================================================

    function getAcademyClasses() {
        return window.AcademyClasses || null;
    }

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    function getObjectUtils() {
        return window.ObjectUtils || null;
    }

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!getAcademyClasses()) {
            missing.push('AcademyClasses');
        }
        if (!getCharacterQueries()) {
            missing.push('CharacterQueries');
        }
        if (!getObjectUtils()) {
            missing.push('ObjectUtils');
        }

        if (missing.length > 0) {
            console.warn('[AcademyQueries] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

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

    // ============================================================
    // CLASS QUERIES
    // ============================================================

    /**
     * Get every class, or every class with the given status.
     *
     * Returns defensive copies (from AcademyClasses).
     *
     * @param {string} [status] - Optional status filter
     * @returns {array} Array of class objects
     */
    function getClasses(status) {
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses) {
            return [];
        }

        if (status) {
            if (typeof AcademyClasses.getClassesByStatus === 'function') {
                return AcademyClasses.getClassesByStatus(status) || [];
            }
        }

        if (typeof AcademyClasses.getClasses === 'function') {
            return AcademyClasses.getClasses() || [];
        }

        return [];
    }

    /**
     * Get a class by ID. Returns a defensive copy, or null.
     *
     * @param {string} classId
     * @returns {object|null}
     */
    function getClass(classId) {
        if (!isNonEmptyString(classId)) {
            return null;
        }
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses || typeof AcademyClasses.getClass !== 'function') {
            return null;
        }
        var result = AcademyClasses.getClass(classId);
        return result ? deepClone(result) : null;
    }

    /**
     * Get a class by name (case-insensitive, trimmed). Returns a
     * defensive copy, or null.
     *
     * @param {string} name
     * @returns {object|null}
     */
    function getClassByName(name) {
        if (!isNonEmptyString(name)) {
            return null;
        }
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses || typeof AcademyClasses.getClassByName !== 'function') {
            return null;
        }
        var result = AcademyClasses.getClassByName(name);
        return result ? deepClone(result) : null;
    }

    /**
     * Get the display name of a class by ID. Returns 'Unknown Class'
     * when the class does not exist or the ID is invalid.
     *
     * @param {string} classId
     * @returns {string}
     */
    function getClassDisplayName(classId) {
        if (!isNonEmptyString(classId)) {
            return 'Unknown Class';
        }
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses || typeof AcademyClasses.getDisplayName !== 'function') {
            return 'Unknown Class';
        }
        return AcademyClasses.getDisplayName(classId) || 'Unknown Class';
    }

    // ============================================================
    // CHARACTER <-> CLASS QUERIES
    // ============================================================

    /**
     * Get every class a character belongs to. Returns defensive copies.
     *
     * @param {object} character
     * @returns {array}
     */
    function getCharacterClasses(character) {
        if (!character || typeof character !== 'object') {
            return [];
        }
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses || typeof AcademyClasses.getCharacterClasses !== 'function') {
            return [];
        }
        return AcademyClasses.getCharacterClasses(character) || [];
    }

    /**
     * Get the names of every class a character belongs to.
     *
     * @param {object} character
     * @returns {array} Array of class-name strings
     */
    function getCharacterClassNames(character) {
        if (!character || typeof character !== 'object') {
            return [];
        }
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses || typeof AcademyClasses.getCharacterClassNames !== 'function') {
            return [];
        }
        return AcademyClasses.getCharacterClassNames(character) || [];
    }

    /**
     * Is the character a member of the class?
     *
     * This is a projection over character.classIds. It does NOT consider
     * the class's instructorId. A character can be in a class without
     * being on the roster, if they are the class's instructor.
     *
     * @param {object} character
     * @param {string} classId
     * @returns {boolean}
     */
    function isCharacterInClass(character, classId) {
        if (!character || !isNonEmptyString(classId)) {
            return false;
        }
        if (!Array.isArray(character.classIds)) {
            return false;
        }
        var target = String(classId);
        for (var i = 0; i < character.classIds.length; i++) {
            if (String(character.classIds[i]) === target) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // CLASS ROSTER - DERIVED FROM character.classIds
    // ============================================================

    /**
     * Get the character IDs of a class's roster.
     *
     * The roster is DERIVED: characters whose classIds include classId.
     * The class INSTRUCTOR is NOT included here even if the class
     * record has an instructorId — the instructor is a separate
     * relationship and is stitched into the roster at the VM layer
     * (AcademyAggregator.getClassViewModel) for display only.
     *
     * @param {string} classId
     * @returns {array} Array of character IDs (strings)
     */
    function getClassStudentIds(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var AcademyClasses = getAcademyClasses();
        if (AcademyClasses && typeof AcademyClasses.getClassesInternal === 'function') {
            // Fast path: iterate the class map once, filter characters.
            // Same derivation, no query round-trips.
            var target = String(classId);
            var CharacterQueries = getCharacterQueries();
            if (!CharacterQueries || typeof CharacterQueries.getCharacters !== 'function') {
                return [];
            }
            var characters = CharacterQueries.getCharacters() || [];
            var result = [];
            for (var i = 0; i < characters.length; i++) {
                var char = characters[i];
                if (!char || !char.id) { continue; }
                if (!Array.isArray(char.classIds)) { continue; }
                for (var j = 0; j < char.classIds.length; j++) {
                    if (String(char.classIds[j]) === target) {
                        result.push(char.id);
                        break;
                    }
                }
            }
            return result;
        }

        return [];
    }

    /**
     * Get the character objects of a class's roster.
     *
     * @param {string} classId
     * @param {boolean} [returnObjects=true] - When false, returns IDs
     * @returns {array}
     */
    function getClassStudents(classId, returnObjects) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var ids = getClassStudentIds(classId);

        if (returnObjects === false) {
            return ids;
        }

        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            return [];
        }

        var result = [];
        for (var i = 0; i < ids.length; i++) {
            var char = CharacterQueries.getCharacterById(ids[i]);
            if (char) {
                result.push(char);
            }
        }
        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyQueries = {
        // ---- Class queries ----
        getClasses: getClasses,
        getClass: getClass,
        getClassByName: getClassByName,
        getClassDisplayName: getClassDisplayName,

        // ---- Character <-> class queries ----
        getCharacterClasses: getCharacterClasses,
        getCharacterClassNames: getCharacterClassNames,
        isCharacterInClass: isCharacterInClass,

        // ---- Class roster (derived) ----
        getClassStudents: getClassStudents,
        getClassStudentIds: getClassStudentIds
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyQueries;
        var missing = [];

        var required = [
            'getClasses', 'getClass', 'getClassByName', 'getClassDisplayName',
            'getCharacterClasses', 'getCharacterClassNames', 'isCharacterInClass',
            'getClassStudents', 'getClassStudentIds'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademyQueries] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();
