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
 *   - Not an auto-group service. Groups come from AcademyAutoGroupsRead
 *     (reads) and AcademyGroups (writes).
 *   - Not a team service. Teams come from TeamQueries.
 *   - Not a discipline service. Disciplines come from AcademyDisciplines.
 *   - Not a location service. Locations come from AcademyLocations.
 *   - Not a class detail aggregator. That is
 *     AcademyAggregator.getClassViewModel.
 *   - Not a student detail aggregator. That is
 *     AcademyAggregator.getStudentViewModel or CharacterAggregator.
 *   - Not an instructor-of-class service. That is
 *     AcademyClasses.getClassInstructorIds (week-scoped) and
 *     AcademyClasses.getClassInstructorIdsAllTime (not week-scoped).
 *
 * LIVE CALLERS:
 *   The module is not dead. As of this revision, the live callers
 *   route through the facade for class reads. The facade will be
 *   retired when those callers are migrated.
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
 * NO CLASS-LEVEL INSTRUCTOR (v29):
 *   Prior to v29, a class record carried `instructorId` — a single
 *   instructor per class. That field was retired. Instructors are
 *   now per-discipline enrolments, and the class's instructors are
 *   derived from them via AcademyClasses.getClassInstructorIds
 *   (week-scoped) or getClassInstructorIdsAllTime (not week-scoped).
 *
 *   This module does NOT expose any instructor-of-class read. The
 *   two instructor queries live on AcademyClasses. Callers that
 *   need them call AcademyClasses directly.
 *
 *   The roster functions in this module (getClassStudents,
 *   getClassStudentIds) return characters whose classIds include
 *   classId. They do NOT exclude the class's instructors. Instructor
 *   exclusion is done at the aggregator layer, where the display
 *   week is known. This module has no week context and cannot make
 *   that decision.
 *
 * READ SAFETY:
 *   - Reads never create the store.
 *   - getClass / getClasses / getClassesByStatus / getClassByName
 *     delegate to AcademyClasses, whose public reads already return
 *     DEEP CLONES. This module does NOT re-clone.
 *   - getClassStudents returns whatever CharacterQueries.getCharacterById
 *     returns — a live reference. This matches the historical
 *     behaviour. Callers that need a clone copy it themselves.
 *
 * DEPENDENCIES (lazily loaded):
 *   - window.AcademyClasses    (from academy-classes.js)
 *   - window.CharacterQueries  (from character-queries.js)
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

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
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
     * Delegates to AcademyClasses.getClass, which already returns a
     * deep clone. This module does NOT re-clone.
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
        return AcademyClasses.getClass(classId);
    }

    /**
     * Get a class by name (case-insensitive, trimmed). Returns a
     * defensive copy, or null.
     *
     * Delegates to AcademyClasses.getClassByName, which already
     * returns a deep clone. This module does NOT re-clone.
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
        return AcademyClasses.getClassByName(name);
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
     * whether the character teaches anything in the class. A character
     * can be an instructor for a class without being a member of it in
     * the classIds sense.
     *
     * The instructor-of-class relationship is expressed through
     * instructor-mode enrolments and is answered by
     * AcademyClasses.getClassInstructorIds / getClassInstructorIdsAllTime.
     * The retired `class.instructorId` field is not consulted anywhere;
     * it was removed in v29.
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
     * The roster does NOT exclude the class's instructors. A character
     * who both has the class in their classIds and teaches something
     * in the class appears in this list.
     *
     * Instructor exclusion is done at the aggregator layer
     * (AcademyAggregator.deriveClassRoster), where the display week is
     * known and the week-scoped instructor query can be applied. This
     * module has no week context, so it cannot make that decision.
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