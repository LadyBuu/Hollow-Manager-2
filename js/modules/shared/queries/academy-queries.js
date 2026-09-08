/**
 * shared/queries/academy-queries.js - Academy Queries
 * Read-only academy domain queries
 * Path: js/shared/queries/academy-queries.js
 * 
 * This module provides READ-ONLY access to academy data.
 * All mutations go through academy-classes.js, academy-grades.js, etc.
 * 
 * OWNERSHIP: Academy domain
 * 
 * IMPORTANT: This module COMPOSES data from:
 *   - AcademyClasses (internal data)
 *   - AcademyGrades (internal data)
 *   - AcademyGroups (internal data)
 * 
 * It does NOT depend on AcademyQueries - that would be circular.
 * It is a CONSUMER-FACING read API.
 */

(function() {
    'use strict';

    if (window.__academyQueriesLoaded) return;
    window.__academyQueriesLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK - ACADEMY MODULES MUST BE LOADED FIRST
    // ============================================================

    if (!window.AcademyClasses) {
        throw new Error('[AcademyQueries] AcademyClasses is required.');
    }
    if (!window.AcademyGrades) {
        throw new Error('[AcademyQueries] AcademyGrades is required.');
    }

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var AcademyClasses = window.AcademyClasses;
    var AcademyGrades = window.AcademyGrades;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function getCurrentWeek() {
        var data = window.data || {};
        return data.currentWeek || 1;
    }

    // ============================================================
    // CLASS QUERIES - DELEGATES TO ACADEMYCLASSES
    // ============================================================

    function getClasses(status) {
        if (status) {
            return AcademyClasses.getClassesByStatus(status);
        }
        return AcademyClasses.getAllClasses();
    }

    function getClass(classId) {
        return AcademyClasses.getClass(classId);
    }

    function getClassByName(name) {
        return AcademyClasses.getClassByName(name);
    }

    function getClassDisplayName(classId) {
        return AcademyClasses.getDisplayName(classId);
    }

    function getCharacterClasses(character) {
        return AcademyClasses.getCharacterClasses(character);
    }

    function getCharacterClassNames(character) {
        return AcademyClasses.getCharacterClassNames(character);
    }

    function isCharacterInClass(character, classId) {
        return AcademyClasses.isCharacterInClass(character, classId);
    }

    function getClassStudents(classId) {
        return AcademyClasses.getClassStudents(classId);
    }

    // ============================================================
    // GRADE QUERIES - DELEGATES TO ACADEMYGRADES
    // ============================================================

    function getStudentGrades(studentId, week) {
        return AcademyGrades.getStudentGrades(studentId, week);
    }

    function getClassGrades(classId, week) {
        return AcademyGrades.getClassGrades(classId, week);
    }

    function getDisciplineGrades(disciplineId, week) {
        return AcademyGrades.getDisciplineGrades(disciplineId, week);
    }

    function calculateGradeSummary(grades, weightThreshold) {
        return AcademyGrades.calculateSummary(grades, weightThreshold);
    }

    function calculateStudentGPA(studentId, week) {
        return AcademyGrades.calculateStudentGPA(studentId, week);
    }

    function calculateClassRanking(classId, week) {
        return AcademyGrades.calculateClassRanking(classId, week);
    }

    function getClassStudentsWithGrades(classId, week) {
        var students = getClassStudents(classId);
        var weekNum = week || getCurrentWeek();
        var result = [];

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            var grades = AcademyGrades.getStudentGrades(student.id, weekNum);
            var summary = AcademyGrades.calculateSummary(grades);

            result.push({
                student: student,
                grades: grades,
                summary: summary
            });
        }
        return result;
    }

    // ============================================================
    // AVAILABLE STUDENTS
    // ============================================================

    function getAvailableStudents(classId, week, statusFilter) {
        if (!isNonEmptyString(classId)) return [];

        var allStudents = CharacterQueries.getStudents() || [];
        var classStudents = AcademyClasses.getClassStudents(classId);
        var classStudentSet = {};

        for (var i = 0; i < classStudents.length; i++) {
            classStudentSet[String(classStudents[i])] = true;
        }

        var result = [];
        for (var j = 0; j < allStudents.length; j++) {
            var student = allStudents[j];
            if (!student) continue;

            if (classStudentSet[String(student.id)]) continue;

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
    // STUDENT DETAILS (Aggregate)
    // ============================================================

    function getStudentDetails(studentId, week) {
        var student = CharacterQueries.getCharacterById(studentId);
        if (!student) return null;

        var weekNum = week || getCurrentWeek();
        var grades = AcademyGrades.getStudentGrades(studentId, weekNum);
        var gpa = AcademyGrades.calculateStudentGPA(studentId, weekNum);
        var classes = getCharacterClasses(student);
        var gradeSummary = AcademyGrades.calculateSummary(grades);

        return {
            student: student,
            classes: classes,
            grades: grades,
            gradeSummary: gradeSummary,
            gpa: gpa,
            week: weekNum,
            displayName: CharacterQueries.getDisplayName(student)
        };
    }

    // ============================================================
    // CLASS DETAILS (Aggregate)
    // ============================================================

    function getClassDetails(classId, week) {
        var cls = AcademyClasses.getClass(classId);
        if (!cls) return null;

        var weekNum = week || getCurrentWeek();
        var students = getClassStudents(classId);
        var grades = AcademyGrades.getClassGrades(classId, weekNum);
        var teams = TeamQueries.getTeamsByClass(classId);
        var gradeSummary = AcademyGrades.calculateSummary(grades);
        var ranking = AcademyGrades.calculateClassRanking(classId, weekNum);

        return {
            class: cls,
            studentCount: students.length,
            students: students,
            grades: grades,
            gradeSummary: gradeSummary,
            ranking: ranking,
            teams: teams,
            week: weekNum
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyQueries = {
        // Class queries
        getClasses: getClasses,
        getClass: getClass,
        getClassByName: getClassByName,
        getClassDisplayName: getClassDisplayName,
        getCharacterClasses: getCharacterClasses,
        getCharacterClassNames: getCharacterClassNames,
        isCharacterInClass: isCharacterInClass,
        getClassStudents: getClassStudents,

        // Grade queries
        getStudentGrades: getStudentGrades,
        getClassGrades: getClassGrades,
        getDisciplineGrades: getDisciplineGrades,
        calculateGradeSummary: calculateGradeSummary,
        calculateStudentGPA: calculateStudentGPA,
        calculateClassRanking: calculateClassRanking,
        getClassStudentsWithGrades: getClassStudentsWithGrades,

        // Available students
        getAvailableStudents: getAvailableStudents,

        // Aggregate
        getStudentDetails: getStudentDetails,
        getClassDetails: getClassDetails,

        // Helpers
        getCurrentWeek: getCurrentWeek
    };

})();
