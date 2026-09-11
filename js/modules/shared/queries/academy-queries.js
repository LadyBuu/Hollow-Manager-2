/**
 * shared/queries/academy-queries.js - Academy Queries
 * Read-only academy domain queries
 * 
 * This module provides READ-ONLY access to all academy data:
 *   - Classes
 *   - Grades
 *   - Rankings
 *   - Auto-Groups
 *   - Student details
 *   - Class details
 * 
 * OWNERSHIP: Academy domain
 * 
 * IMPORTANT:
 *   - READ ONLY - no mutations
 *   - This module COMPOSES data from AcademyClasses, AcademyGrades, etc.
 *   - Uses LAZY LOADING to break circular dependencies
 *   - It is the CONSUMER-FACING read API
 *   - Returns defensive copies where appropriate
 *   - No UI dependencies
 *   - No persistence
 * 
 * CLASS MEMBERSHIP MODEL (v15+):
 *   - character.classIds[] is the SINGLE SOURCE OF TRUTH for membership.
 *   - The class roster is DERIVED: characters whose classIds include classId.
 *   - There is no academy.classStudents store. It was removed in v15 and
 *     must never be reintroduced.
 * 
 * AUTO-GROUPS READ OWNERSHIP:
 *   - autoGroups live at window.data.curriculum.autoGroups.
 *   - This module reads that store DIRECTLY.
 *   - This module does NOT delegate reads to AcademyGroups, because
 *     AcademyGroups.getX delegates back to AcademyQueries.getX, which
 *     would cause infinite recursion. Reads terminate here.
 *   - AcademyGroups (the mutation module) may delegate its own reads
 *     to this module; that is a one-way dependency and is safe.
 * 
 * DEPENDENCIES (lazily loaded):
 *   - window.AcademyClasses (from academy-classes.js)
 *   - window.AcademyGrades (from academy-grades.js)
 *   - window.AcademyRanking (from academy-ranking.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.TeamQueries (from team-queries.js)
 *   - window.DisciplineQueries (from discipline-queries.js)
 *   - window.LocationQueries (from location-queries.js)
 * 
 * USAGE:
 *   var AQ = window.AcademyQueries;
 *   var classes = AQ.getClasses();
 *   var students = AQ.getClassStudents('class_123');
 *   var groups = AQ.getAllGroups();
 */

(function() {
    'use strict';

    if (window.__academyQueriesLoaded) {
        return;
    }
    window.__academyQueriesLoaded = true;

    // ============================================================
    // LAZY LOADING HELPERS - Breaks circular dependencies
    // ============================================================

    function getAcademyClasses() {
        return window.AcademyClasses || null;
    }

    function getAcademyGrades() {
        return window.AcademyGrades || null;
    }

    function getAcademyRanking() {
        return window.AcademyRanking || null;
    }

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    function getTeamQueries() {
        return window.TeamQueries || null;
    }

    function getDisciplineQueries() {
        return window.DisciplineQueries || null;
    }

    function getLocationQueries() {
        return window.LocationQueries || null;
    }

    function getObjectUtils() {
        return window.ObjectUtils || null;
    }

    // ============================================================
    // DEPENDENCY CHECK - Warns but doesn't fail
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!getAcademyClasses()) {
            missing.push('AcademyClasses');
        }
        if (!getAcademyGrades()) {
            missing.push('AcademyGrades');
        }
        if (!getAcademyRanking()) {
            missing.push('AcademyRanking');
        }
        if (!getCharacterQueries()) {
            missing.push('CharacterQueries');
        }
        if (!getTeamQueries()) {
            missing.push('TeamQueries');
        }
        if (!getDisciplineQueries()) {
            missing.push('DisciplineQueries');
        }

        if (missing.length > 0) {
            console.warn('[AcademyQueries] Some dependencies not yet loaded (will use lazy loading):', missing.join(', '));
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

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function getCurrentWeek() {
        var data = window.data || {};
        var week = data.currentWeek;
        if (typeof week === 'number' && week >= 1 && week <= 52) {
            return week;
        }
        return 1;
    }

    function getCharacterDisplayName(charId) {
        if (!charId) {
            return 'Unknown';
        }
        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) {
            return 'Unknown';
        }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return 'Unknown';
        }
        return CharacterQueries.getDisplayName(char);
    }

    function deepClone(value) {
        var ObjectUtils = getObjectUtils();
        if (ObjectUtils && typeof ObjectUtils.deepClone === 'function') {
            return ObjectUtils.deepClone(value);
        }
        if (value === null || typeof value !== 'object') {
            return value;
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_) {
            return value;
        }
    }

    function getDisciplineNameById(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return 'Unknown';
        }
        var DisciplineQueries = getDisciplineQueries();
        if (!DisciplineQueries) {
            return 'Unknown';
        }
        var discipline = DisciplineQueries.getDiscipline(disciplineId);
        return discipline ? discipline.name : 'Unknown';
    }

    // ============================================================
    // CLASS MEMBERSHIP - DERIVED ROSTER (v15+)
    // ============================================================

    function getCharacterClassIds(char) {
        if (!char || typeof char !== 'object') {
            return [];
        }
        if (!Array.isArray(char.classIds)) {
            return [];
        }
        return char.classIds;
    }

    function characterHasClass(char, classId) {
        if (!char || !classId) {
            return false;
        }
        var ids = getCharacterClassIds(char);
        var target = String(classId);
        for (var i = 0; i < ids.length; i++) {
            if (String(ids[i]) === target) {
                return true;
            }
        }
        return false;
    }

    function deriveClassRosterIds(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) {
            return [];
        }

        var characters = CharacterQueries.getCharacters() || [];
        var target = String(classId);
        var result = [];

        for (var i = 0; i < characters.length; i++) {
            var char = characters[i];
            if (!char || !char.id) {
                continue;
            }
            if (characterHasClass(char, target)) {
                result.push(char.id);
            }
        }

        return result;
    }

    // ============================================================
    // CLASS QUERIES - DELEGATES TO ACADEMYCLASSES (lazy)
    // ============================================================

    function getClasses(status) {
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses) {
            return [];
        }

        if (status) {
            var getByStatus = AcademyClasses.getClassesByStatus || AcademyClasses.getClassesByStatusInternal;
            if (typeof getByStatus === 'function') {
                return getByStatus.call(AcademyClasses, status) || [];
            }
        }

        var getAll = AcademyClasses.getClasses || AcademyClasses.getClassesInternal;
        if (typeof getAll === 'function') {
            return getAll.call(AcademyClasses) || [];
        }

        return [];
    }

    function getClass(classId) {
        if (!isNonEmptyString(classId)) {
            return null;
        }
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses) {
            return null;
        }

        var getClassFn = AcademyClasses.getClass || AcademyClasses.getClassInternal;
        if (typeof getClassFn === 'function') {
            var result = getClassFn.call(AcademyClasses, classId);
            return result ? deepClone(result) : null;
        }

        return null;
    }

    function getClassByName(name) {
        if (!isNonEmptyString(name)) {
            return null;
        }
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses) {
            return null;
        }

        var getByName = AcademyClasses.getClassByName || AcademyClasses.getClassByNameInternal;
        if (typeof getByName === 'function') {
            var result = getByName.call(AcademyClasses, name);
            return result ? deepClone(result) : null;
        }

        return null;
    }

    function getClassDisplayName(classId) {
        if (!isNonEmptyString(classId)) {
            return 'Unknown Class';
        }
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses) {
            return 'Unknown Class';
        }

        var getDisplay = AcademyClasses.getDisplayName || AcademyClasses.getClassDisplayNameInternal;
        if (typeof getDisplay === 'function') {
            return getDisplay.call(AcademyClasses, classId) || 'Unknown Class';
        }

        var cls = getClass(classId);
        return cls ? cls.name || 'Unnamed Class' : 'Unknown Class';
    }

    function getCharacterClasses(character) {
        if (!character || typeof character !== 'object') {
            return [];
        }

        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses) {
            return [];
        }

        var getCharClasses = AcademyClasses.getCharacterClasses || AcademyClasses.getCharacterClassesInternal;
        if (typeof getCharClasses === 'function') {
            return getCharClasses.call(AcademyClasses, character) || [];
        }

        return [];
    }

    function getCharacterClassNames(character) {
        if (!character || typeof character !== 'object') {
            return [];
        }
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses) {
            return [];
        }

        var getClassNames = AcademyClasses.getCharacterClassNames || AcademyClasses.getCharacterClassNamesInternal;
        if (typeof getClassNames === 'function') {
            return getClassNames.call(AcademyClasses, character) || [];
        }

        return [];
    }

    function isCharacterInClass(character, classId) {
        return characterHasClass(character, classId);
    }

    function getClassStudents(classId, returnObjects) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) {
            return [];
        }

        returnObjects = returnObjects !== false;

        var ids = deriveClassRosterIds(classId);

        if (!returnObjects) {
            return ids;
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

    function getClassStudentIds(classId) {
        return deriveClassRosterIds(classId);
    }

    // ============================================================
    // GRADE QUERIES - DELEGATES TO ACADEMYGRADES (lazy)
    // ============================================================

    function getStudentGrades(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return [];
        }
        var AcademyGrades = getAcademyGrades();
        if (!AcademyGrades) {
            return [];
        }

        var getGrades = AcademyGrades.getStudentGrades;
        if (typeof getGrades === 'function') {
            return getGrades.call(AcademyGrades, studentId, week) || [];
        }

        return [];
    }

    function getClassGrades(classId, week) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var AcademyGrades = getAcademyGrades();
        if (!AcademyGrades) {
            return [];
        }

        var getGrades = AcademyGrades.getClassGrades;
        if (typeof getGrades === 'function') {
            return getGrades.call(AcademyGrades, classId, week) || [];
        }

        return [];
    }

    function getDisciplineGrades(disciplineId, week) {
        if (!isNonEmptyString(disciplineId)) {
            return [];
        }
        var AcademyGrades = getAcademyGrades();
        if (!AcademyGrades) {
            return [];
        }

        var getGrades = AcademyGrades.getDisciplineGrades;
        if (typeof getGrades === 'function') {
            return getGrades.call(AcademyGrades, disciplineId, week) || [];
        }

        return [];
    }

    function getWeekGrades(week, classId) {
        var AcademyGrades = getAcademyGrades();
        if (!AcademyGrades) {
            return [];
        }

        var getGrades = AcademyGrades.getWeekGrades;
        if (typeof getGrades === 'function') {
            return getGrades.call(AcademyGrades, week, classId) || [];
        }

        return [];
    }

    function getGrade(gradeId) {
        if (!isNonEmptyString(gradeId)) {
            return null;
        }
        var AcademyGrades = getAcademyGrades();
        if (!AcademyGrades) {
            return null;
        }

        var getGradeFn = AcademyGrades.getGrade;
        if (typeof getGradeFn === 'function') {
            var result = getGradeFn.call(AcademyGrades, gradeId);
            return result ? deepClone(result) : null;
        }

        return null;
    }

    function getAllGrades() {
        var AcademyGrades = getAcademyGrades();
        if (!AcademyGrades) {
            return [];
        }

        var getAll = AcademyGrades.getAllGrades;
        if (typeof getAll === 'function') {
            return getAll.call(AcademyGrades) || [];
        }

        return [];
    }

    function calculateGradeSummary(grades, weightThreshold) {
        var AcademyGrades = getAcademyGrades();
        if (!AcademyGrades) {
            return { count: 0, average: 0, max: 0, min: 0, passing: 0, failing: 0, passRate: 0 };
        }

        var calcSummary = AcademyGrades.calculateSummary || AcademyGrades.calculateGradeSummary;
        if (typeof calcSummary === 'function') {
            return calcSummary.call(AcademyGrades, grades, weightThreshold) || { count: 0, average: 0 };
        }

        return { count: 0, average: 0 };
    }

    function calculateStudentGPA(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return { gradeCount: 0, average: 0, gpa: 0 };
        }
        var AcademyGrades = getAcademyGrades();
        if (!AcademyGrades) {
            return { gradeCount: 0, average: 0, gpa: 0 };
        }

        var calcGPA = AcademyGrades.calculateStudentGPA;
        if (typeof calcGPA === 'function') {
            return calcGPA.call(AcademyGrades, studentId, week) || { gradeCount: 0, average: 0, gpa: 0 };
        }

        return { gradeCount: 0, average: 0, gpa: 0 };
    }

    function calculateClassRanking(classId, week) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var AcademyGrades = getAcademyGrades();
        if (!AcademyGrades) {
            return [];
        }

        var calcRanking = AcademyGrades.calculateClassRanking;
        if (typeof calcRanking === 'function') {
            var CharacterQueries = getCharacterQueries();
            var getCharById = CharacterQueries ? CharacterQueries.getCharacterById : null;
            return calcRanking.call(AcademyGrades, classId, week, getCharById) || [];
        }

        return [];
    }

    function getClassStudentsWithGrades(classId, week) {
        var students = getClassStudents(classId);
        var weekNum = week || getCurrentWeek();
        var result = [];

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            if (!student || typeof student !== 'object') {
                continue;
            }
            var grades = getStudentGrades(student.id, weekNum);
            var summary = calculateGradeSummary(grades);

            result.push({
                student: student,
                grades: grades,
                summary: summary
            });
        }
        return result;
    }

    // ============================================================
    // RANKING QUERIES - DELEGATES TO ACADEMYRANKING (lazy)
    // ============================================================

    function getClassRankings(classId, week, includeStudentDetails) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var AcademyRanking = getAcademyRanking();
        if (!AcademyRanking) {
            return [];
        }

        var getRankings = AcademyRanking.getClassRankings;
        if (typeof getRankings === 'function') {
            return getRankings.call(AcademyRanking, classId, week, includeStudentDetails) || [];
        }

        return [];
    }

    function getStudentRank(classId, studentId, week, includeDetails) {
        if (!isNonEmptyString(classId) || !isNonEmptyString(studentId)) {
            return null;
        }
        var AcademyRanking = getAcademyRanking();
        if (!AcademyRanking) {
            return null;
        }

        var getRank = AcademyRanking.getStudentRank;
        if (typeof getRank === 'function') {
            var result = getRank.call(AcademyRanking, classId, studentId, week, includeDetails);
            return result ? deepClone(result) : null;
        }

        return null;
    }

    function getRankingsWithDetails(classId, week) {
        if (!isNonEmptyString(classId)) {
            return { rankings: [], summary: {}, distribution: {} };
        }
        var AcademyRanking = getAcademyRanking();
        if (!AcademyRanking) {
            return { rankings: [], summary: {}, distribution: {} };
        }

        var getDetails = AcademyRanking.getRankingsWithDetails;
        if (typeof getDetails === 'function') {
            return getDetails.call(AcademyRanking, classId, week) || { rankings: [], summary: {}, distribution: {} };
        }

        return { rankings: [], summary: {}, distribution: {} };
    }

    function getRankings(classId, week) {
        var AcademyRanking = getAcademyRanking();
        if (!AcademyRanking) {
            return [];
        }

        var getRankingsFn = AcademyRanking.getRankings;
        if (typeof getRankingsFn === 'function') {
            return getRankingsFn.call(AcademyRanking, classId, week) || [];
        }

        return [];
    }

    function calculateRankingSummary(rankings) {
        var AcademyRanking = getAcademyRanking();
        if (!AcademyRanking) {
            return { count: 0, minRank: null, maxRank: null, averageRank: 0 };
        }

        var calcSummary = AcademyRanking.calculateRankingSummary;
        if (typeof calcSummary === 'function') {
            return calcSummary.call(AcademyRanking, rankings) || { count: 0, minRank: null, maxRank: null, averageRank: 0 };
        }

        return { count: 0, minRank: null, maxRank: null, averageRank: 0 };
    }

    // ============================================================
    // AUTO-GROUP QUERIES - DIRECT READS
    // ============================================================
    // 
    // IMPORTANT: These functions read window.data.curriculum.autoGroups
    // DIRECTLY. They do NOT delegate to AcademyGroups, because
    // AcademyGroups' own read functions delegate back to this module,
    // which would cause infinite recursion (stack overflow).
    // 
    // The store shape is:
    //   curriculum.autoGroups = {
    //     [groupKey]: {
    //       id, disciplineId, instructorId, displayName,
    //       students: [charId, ...],
    //       slots: [{ week, day, hour, duration, label }],
    //       createdAt
    //     }
    //   }
    // 
    // groupKey is conventionally `disciplineId + '_' + instructorId`.

    function getAutoGroupsStore() {
        var data = window.data || {};
        var curriculum = data.curriculum || {};
        var store = curriculum.autoGroups;
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return {};
        }
        return store;
    }

    function getAllGroups() {
        var store = getAutoGroupsStore();
        // Shallow clone so the caller can't mutate the live store by
        // accident through the returned reference.
        var result = {};
        var keys = Object.keys(store);
        for (var i = 0; i < keys.length; i++) {
            result[keys[i]] = store[keys[i]];
        }
        return result;
    }

    function getGroup(key) {
        if (!isNonEmptyString(key)) {
            return null;
        }
        var store = getAutoGroupsStore();
        var group = store[key];
        return group ? deepClone(group) : null;
    }

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

    function getGroupSlots(key) {
        if (!isNonEmptyString(key)) {
            return [];
        }
        var store = getAutoGroupsStore();
        var group = store[key];
        if (!group || !Array.isArray(group.slots)) {
            return [];
        }
        return group.slots.map(function(slot) {
            return deepClone(slot);
        });
    }

    function getGroupStudentCount(key) {
        return getGroupStudents(key).length;
    }

    function getGroupSlotCount(key) {
        return getGroupSlots(key).length;
    }

    function isStudentInGroup(key, studentId) {
        if (!isNonEmptyString(key) || !isNonEmptyString(studentId)) {
            return false;
        }
        var students = getGroupStudents(key);
        var target = String(studentId);
        for (var i = 0; i < students.length; i++) {
            if (String(students[i]) === target) {
                return true;
            }
        }
        return false;
    }

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
            var hasSlotThisWeek = false;
            for (var j = 0; j < group.slots.length; j++) {
                if (group.slots[j] && group.slots[j].week === weekNum) {
                    hasSlotThisWeek = true;
                    break;
                }
            }
            if (hasSlotThisWeek) {
                result[keys[i]] = group;
            }
        }
        return result;
    }

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

        var discipline = null;
        var instructor = null;

        var DisciplineQueries = getDisciplineQueries();
        if (DisciplineQueries && group.disciplineId) {
            discipline = DisciplineQueries.getDiscipline(group.disciplineId);
        }

        var CharacterQueries = getCharacterQueries();
        if (CharacterQueries && group.instructorId) {
            instructor = CharacterQueries.getCharacterById(group.instructorId);
        }

        return {
            key: key,
            id: group.id || key,
            displayName: group.displayName || key,
            disciplineId: group.disciplineId || null,
            disciplineName: discipline ? discipline.name : 'Unknown',
            instructorId: group.instructorId || null,
            instructorName: instructor && CharacterQueries
                ? CharacterQueries.getDisplayName(instructor)
                : 'Unknown',
            studentCount: students.length,
            slotCount: slots.length,
            createdAt: group.createdAt || ''
        };
    }

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
    // AVAILABLE STUDENTS
    // ============================================================

    function getAvailableStudents(classId, week, statusFilter) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) {
            return [];
        }

        var allStudents = CharacterQueries.getStudents() || [];
        var classStudentIds = getClassStudentIds(classId);
        var classStudentSet = {};

        for (var i = 0; i < classStudentIds.length; i++) {
            classStudentSet[String(classStudentIds[i])] = true;
        }

        var result = [];
        for (var j = 0; j < allStudents.length; j++) {
            var student = allStudents[j];
            if (!student) { continue; }

            if (classStudentSet[String(student.id)]) {
                continue;
            }

            if (statusFilter) {
                var status = CharacterQueries.getCurrentStatus(student);
                if (status.toLowerCase() !== statusFilter.toLowerCase()) {
                    continue;
                }
            }

            result.push(student);
        }

        result.sort(function(a, b) {
            return CharacterQueries.getDisplayName(a).localeCompare(
                CharacterQueries.getDisplayName(b)
            );
        });

        return result;
    }

    // ============================================================
    // ACADEMIC TEAM QUERIES - DELEGATES TO TEAMQUERIES (lazy)
    // ============================================================

    function getClassTeams(classId, status) {
        if (!isNonEmptyString(classId)) {
            return [];
        }
        var TeamQueries = getTeamQueries();
        if (!TeamQueries) {
            return [];
        }

        var getTeamsByClass = TeamQueries.getTeamsByClass;
        if (typeof getTeamsByClass === 'function') {
            return getTeamsByClass.call(TeamQueries, classId, status) || [];
        }

        return [];
    }

    function getAcademicTeamMembers(teamId, period, includeDetails) {
        if (!isNonEmptyString(teamId)) {
            return [];
        }

        var TeamQueries = getTeamQueries();
        if (!TeamQueries) {
            return [];
        }

        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return [];
        }

        var periodNum = parseInt(period, 10);
        if (isNaN(periodNum) || periodNum < 1) {
            periodNum = getCurrentWeek();
        }

        var members = TeamQueries.getActiveTeamMembers(team, periodNum);

        if (!includeDetails) {
            return members.map(function(m) {
                return {
                    characterId: m.characterId,
                    role: m.role || 'Member',
                    joinPeriod: m.joinPeriod || '',
                    leavePeriod: m.leavePeriod || ''
                };
            });
        }

        var CharacterQueries = getCharacterQueries();
        return members.map(function(m) {
            var char = CharacterQueries ? CharacterQueries.getCharacterById(m.characterId) : null;
            return {
                characterId: m.characterId,
                name: char ? CharacterQueries.getDisplayName(char) : 'Unknown',
                status: char ? CharacterQueries.getCurrentStatus(char) : '',
                age: char ? CharacterQueries.getCharacterAge(char) : '',
                deceased: char ? char.deceased || false : false,
                role: m.role || 'Member',
                joinPeriod: m.joinPeriod || '',
                leavePeriod: m.leavePeriod || ''
            };
        });
    }

    function getAcademicTeamMemberCount(teamId, period) {
        if (!isNonEmptyString(teamId)) {
            return 0;
        }

        var TeamQueries = getTeamQueries();
        if (!TeamQueries) {
            return 0;
        }

        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return 0;
        }

        var periodNum = parseInt(period, 10);
        if (isNaN(periodNum) || periodNum < 1) {
            periodNum = getCurrentWeek();
        }

        return TeamQueries.getActiveTeamMembers(team, periodNum).length;
    }

    // ============================================================
    // STUDENT DETAILS (Aggregate)
    // ============================================================

    function getStudentDetails(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return null;
        }

        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) {
            return null;
        }

        var student = CharacterQueries.getCharacterById(studentId);
        if (!student) {
            return null;
        }

        var weekNum = week || getCurrentWeek();
        var grades = getStudentGrades(studentId, weekNum);
        var gpa = calculateStudentGPA(studentId, weekNum);
        var classes = getCharacterClasses(student);
        var gradeSummary = calculateGradeSummary(grades);

        var ranking = null;
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || !cls.id) {
                continue;
            }
            var classRankings = calculateClassRanking(cls.id, weekNum);
            for (var j = 0; j < classRankings.length; j++) {
                if (String(classRankings[j].studentId) === String(studentId)) {
                    ranking = classRankings[j];
                    break;
                }
            }
            if (ranking) {
                break;
            }
        }

        return {
            student: student,
            classes: classes,
            grades: grades,
            gradeSummary: gradeSummary,
            gpa: gpa,
            ranking: ranking,
            week: weekNum,
            displayName: CharacterQueries.getDisplayName(student),
            classNames: classes.map(function(c) { return c.name; })
        };
    }

    // ============================================================
    // CLASS DETAILS (Aggregate)
    // ============================================================

    function getClassDetails(classId, week, includeStudentDetails) {
        if (!isNonEmptyString(classId)) {
            return null;
        }

        var cls = getClass(classId);
        if (!cls) {
            return null;
        }

        var weekNum = week || getCurrentWeek();
        var studentIds = getClassStudentIds(classId);
        var students = [];

        var CharacterQueries = getCharacterQueries();
        if (includeStudentDetails !== false && CharacterQueries) {
            for (var i = 0; i < studentIds.length; i++) {
                var char = CharacterQueries.getCharacterById(studentIds[i]);
                if (char) {
                    students.push(char);
                }
            }
        }

        var grades = getClassGrades(classId, weekNum);
        var teams = getClassTeams(classId);
        var gradeSummary = calculateGradeSummary(grades);
        var ranking = calculateClassRanking(classId, weekNum);

        return {
            class: cls,
            studentCount: studentIds.length,
            students: students,
            grades: grades,
            gradeSummary: gradeSummary,
            ranking: ranking,
            teams: teams,
            week: weekNum
        };
    }

    // ============================================================
    // DISCIPLINE QUERIES - DELEGATES TO DISCIPLINEQUERIES (lazy)
    // ============================================================

    function getDiscipline(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return null;
        }
        var DisciplineQueries = getDisciplineQueries();
        if (!DisciplineQueries) {
            return null;
        }

        var getDisciplineFn = DisciplineQueries.getDiscipline;
        if (typeof getDisciplineFn === 'function') {
            var result = getDisciplineFn.call(DisciplineQueries, disciplineId);
            return result ? deepClone(result) : null;
        }

        return null;
    }

    function getDisciplines() {
        var DisciplineQueries = getDisciplineQueries();
        if (!DisciplineQueries) {
            return [];
        }

        var getDisciplinesFn = DisciplineQueries.getDisciplines;
        if (typeof getDisciplinesFn === 'function') {
            return getDisciplinesFn.call(DisciplineQueries) || [];
        }

        return [];
    }

    function getAvailableDisciplines(week) {
        var weekNum = week || getCurrentWeek();
        var DisciplineQueries = getDisciplineQueries();
        if (!DisciplineQueries) {
            return [];
        }

        var getAvailable = DisciplineQueries.getAvailableDisciplines;
        if (typeof getAvailable === 'function') {
            return getAvailable.call(DisciplineQueries, weekNum) || [];
        }

        return [];
    }

    function getDisciplineName(disciplineId) {
        return getDisciplineNameById(disciplineId);
    }

    // ============================================================
    // LOCATION QUERIES - DELEGATES TO LOCATIONQUERIES (lazy)
    // ============================================================

    function getLocations() {
        var LocationQueries = getLocationQueries();
        if (!LocationQueries) {
            return [];
        }

        var getLocationsFn = LocationQueries.getLocations;
        if (typeof getLocationsFn === 'function') {
            return getLocationsFn.call(LocationQueries) || [];
        }

        return [];
    }

    function getLocation(locationId) {
        if (!isNonEmptyString(locationId)) {
            return null;
        }
        var LocationQueries = getLocationQueries();
        if (!LocationQueries) {
            return null;
        }

        var getLocationFn = LocationQueries.getLocation;
        if (typeof getLocationFn === 'function') {
            var result = getLocationFn.call(LocationQueries, locationId);
            return result ? deepClone(result) : null;
        }

        return null;
    }

    function getLocationName(locationId) {
        if (!isNonEmptyString(locationId)) {
            return 'Unknown';
        }
        var LocationQueries = getLocationQueries();
        if (!LocationQueries) {
            return 'Unknown';
        }

        var getNameFn = LocationQueries.getLocationName;
        if (typeof getNameFn === 'function') {
            return getNameFn.call(LocationQueries, locationId) || 'Unknown';
        }

        return 'Unknown';
    }

    // ============================================================
    // INSTRUCTOR/STUDENT QUERIES - DELEGATES TO CHARACTERQUERIES (lazy)
    // ============================================================

    function getClassInstructors(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var cls = getClass(classId);
        if (!cls || !cls.instructorId) {
            return [];
        }

        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) {
            return [];
        }

        var instructor = CharacterQueries.getCharacterById(cls.instructorId);
        return instructor ? [instructor] : [];
    }

    function getInstructors() {
        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) {
            return [];
        }

        var getInstructorsFn = CharacterQueries.getInstructors;
        if (typeof getInstructorsFn === 'function') {
            return getInstructorsFn.call(CharacterQueries) || [];
        }

        return [];
    }

    function getStudents() {
        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) {
            return [];
        }

        var getStudentsFn = CharacterQueries.getStudents;
        if (typeof getStudentsFn === 'function') {
            return getStudentsFn.call(CharacterQueries) || [];
        }

        return [];
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function isClassActive(cls) {
        if (!cls || typeof cls !== 'object') {
            return false;
        }
        return cls.status === 'active';
    }

    function isClassArchived(cls) {
        if (!cls || typeof cls !== 'object') {
            return false;
        }
        return cls.status === 'archived';
    }

    function isClassGraduated(cls) {
        if (!cls || typeof cls !== 'object') {
            return false;
        }
        return cls.status === 'graduated';
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
        getCharacterClasses: getCharacterClasses,
        getCharacterClassNames: getCharacterClassNames,
        isCharacterInClass: isCharacterInClass,
        getClassStudents: getClassStudents,
        getClassStudentIds: getClassStudentIds,

        // ---- Grade queries ----
        getStudentGrades: getStudentGrades,
        getClassGrades: getClassGrades,
        getDisciplineGrades: getDisciplineGrades,
        getWeekGrades: getWeekGrades,
        getGrade: getGrade,
        getAllGrades: getAllGrades,
        calculateGradeSummary: calculateGradeSummary,
        calculateStudentGPA: calculateStudentGPA,
        calculateClassRanking: calculateClassRanking,
        getClassStudentsWithGrades: getClassStudentsWithGrades,

        // ---- Ranking queries ----
        getClassRankings: getClassRankings,
        getStudentRank: getStudentRank,
        getRankingsWithDetails: getRankingsWithDetails,
        getRankings: getRankings,
        calculateRankingSummary: calculateRankingSummary,

        // ---- Group queries ----
        getAllGroups: getAllGroups,
        getGroup: getGroup,
        getGroupsByDiscipline: getGroupsByDiscipline,
        getGroupsByInstructor: getGroupsByInstructor,
        getGroupStudents: getGroupStudents,
        getGroupSlots: getGroupSlots,
        getGroupStudentCount: getGroupStudentCount,
        getGroupSlotCount: getGroupSlotCount,
        isStudentInGroup: isStudentInGroup,
        getGroupsForStudent: getGroupsForStudent,
        getGroupsForWeek: getGroupsForWeek,
        getGroupSlotsByWeek: getGroupSlotsByWeek,
        getGroupSummary: getGroupSummary,
        getAllGroupSummaries: getAllGroupSummaries,
        getGroupDisplayName: getGroupDisplayName,

        // ---- Available students ----
        getAvailableStudents: getAvailableStudents,

        // ---- Academic team queries ----
        getClassTeams: getClassTeams,
        getAcademicTeamMembers: getAcademicTeamMembers,
        getAcademicTeamMemberCount: getAcademicTeamMemberCount,

        // ---- Student details (Aggregate) ----
        getStudentDetails: getStudentDetails,

        // ---- Class details (Aggregate) ----
        getClassDetails: getClassDetails,

        // ---- Discipline queries ----
        getDiscipline: getDiscipline,
        getDisciplines: getDisciplines,
        getAvailableDisciplines: getAvailableDisciplines,
        getDisciplineName: getDisciplineName,

        // ---- Location queries ----
        getLocations: getLocations,
        getLocation: getLocation,
        getLocationName: getLocationName,

        // ---- Instructor/Student queries ----
        getInstructors: getInstructors,
        getStudents: getStudents,
        getClassInstructors: getClassInstructors,

        // ---- Helpers ----
        getCurrentWeek: getCurrentWeek,
        isClassActive: isClassActive,
        isClassArchived: isClassArchived,
        isClassGraduated: isClassGraduated
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
            'getClassStudents', 'getClassStudentIds',
            'getStudentGrades', 'getClassGrades', 'getDisciplineGrades',
            'getWeekGrades', 'getGrade', 'getAllGrades',
            'calculateGradeSummary', 'calculateStudentGPA', 'calculateClassRanking',
            'getClassStudentsWithGrades',
            'getClassRankings', 'getStudentRank', 'getRankingsWithDetails',
            'getRankings', 'calculateRankingSummary',
            'getAllGroups', 'getGroup', 'getGroupsByDiscipline', 'getGroupsByInstructor',
            'getGroupStudents', 'getGroupSlots', 'getGroupStudentCount',
            'getGroupSlotCount', 'isStudentInGroup', 'getGroupsForStudent',
            'getGroupsForWeek', 'getGroupSlotsByWeek', 'getGroupSummary',
            'getAllGroupSummaries', 'getGroupDisplayName',
            'getAvailableStudents',
            'getClassTeams', 'getAcademicTeamMembers', 'getAcademicTeamMemberCount',
            'getStudentDetails', 'getClassDetails',
            'getDiscipline', 'getDisciplines', 'getAvailableDisciplines',
            'getDisciplineName',
            'getLocations', 'getLocation', 'getLocationName',
            'getInstructors', 'getStudents', 'getClassInstructors',
            'getCurrentWeek', 'isClassActive', 'isClassArchived', 'isClassGraduated'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademyQueries] Verification failed - missing exports:', missing.join(', '));
        } else {
            console.log('[AcademyQueries] All exports verified successfully.');
        }
    })();

})();