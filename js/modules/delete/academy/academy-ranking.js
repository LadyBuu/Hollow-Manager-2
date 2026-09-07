/**
 * js/modules/academy/academy-ranking.js - Academy Ranking Domain
 * Single source of truth for all ranking operations within the Academy
 * Path: js/modules/academy/academy-ranking.js
 * 
 * This module handles:
 *   - Ranking CRUD operations
 *   - Auto-generation of rankings from grades
 *   - Class ranking summaries
 *   - Ranking history
 *   - Ranking statistics
 * 
 * IMPORTANT:
 *   - This module is the CANONICAL source of truth for rankings
 *   - All mutations are candidate-based: validate, clone, modify, return candidate
 *   - This module does NOT commit to window.data or call saveData()
 *   - Persistence and logging are owned by MutationPipeline
 *   - All validation uses CalendarValidation from calendar-validation.js
 *   - All deep cloning uses ObjectUtils.deepClone()
 *   - Rankings are POSITIONAL: ranks are normalised to 1..N on every mutation
 *   - Input rank values are treated as desired positions, not absolute ranks
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.AcademyClassQueries (from academy-class-queries.js)
 *   - window.AcademyGrades (from academy-grades.js)
 *   - window.CalendarValidation (from calendar-validation.js)
 *   - window.CalendarConstants (from calendar-constants.js)
 * 
 * USAGE:
 *   var rankings = window.AcademyRanking;
 *   var result = rankings.autoGenerate(week);
 *   var classRankings = rankings.getClassRankings(classId, week);
 *   var summary = rankings.getClassRankingSummary(classId, week);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academyRankingLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var CharacterQueries = window.CharacterQueries;
    var AcademyClassQueries = window.AcademyClassQueries;
    var AcademyGrades = window.AcademyGrades;
    var CalendarValidation = window.CalendarValidation;
    var CalendarConstants = window.CalendarConstants;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
            missing.push('ObjectUtils.deepClone');
        }

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCurrentStatus !== 'function') {
            missing.push('CharacterQueries.getCurrentStatus');
        }
        if (!CharacterQueries || typeof CharacterQueries.getStudents !== 'function') {
            missing.push('CharacterQueries.getStudents');
        }

        if (!AcademyClassQueries || typeof AcademyClassQueries.getClass !== 'function') {
            missing.push('AcademyClassQueries.getClass');
        }
        if (!AcademyClassQueries || typeof AcademyClassQueries.getCharactersByClass !== 'function') {
            missing.push('AcademyClassQueries.getCharactersByClass');
        }

        if (!AcademyGrades || typeof AcademyGrades.calculateSummary !== 'function') {
            missing.push('AcademyGrades.calculateSummary');
        }

        if (!CalendarValidation || typeof CalendarValidation.parseWeek !== 'function') {
            missing.push('CalendarValidation.parseWeek');
        }

        if (!CalendarConstants || typeof CalendarConstants.MIN_WEEK !== 'number') {
            missing.push('CalendarConstants.MIN_WEEK');
        }

        if (missing.length > 0) {
            throw new Error('AcademyRanking: Missing dependencies: ' + missing.join(', '));
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HELPER ALIASES
    // ============================================================

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // DATA STORE ACCESS - Read-only
    // ============================================================

    function getRankingsStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        if (!window.data.curriculum || typeof window.data.curriculum !== 'object') {
            return null;
        }
        return window.data.curriculum.rankings;
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    function validateRank(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        if (!Number.isInteger(num) || num < 1) {
            return null;
        }
        return num;
    }

    function validateStudentId(studentId) {
        if (!isNonEmptyString(studentId)) {
            return { valid: false, message: 'Student ID is required.' };
        }
        var student = CharacterQueries.getCharacterById(studentId);
        if (!student) {
            return { valid: false, message: 'Student not found.' };
        }
        var status = CharacterQueries.getCurrentStatus(student);
        if (status !== 'trainee' && status !== 'rookie' && status !== 'junior') {
            return { valid: false, message: 'Character is not a student.' };
        }
        return { valid: true, student: student };
    }

    function validateRankingsData(week, rankings) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return { valid: false, message: 'Valid week is required (' + CalendarConstants.MIN_WEEK + '-' + CalendarConstants.MAX_WEEK + ').' };
        }

        if (!Array.isArray(rankings)) {
            return { valid: false, message: 'Rankings must be an array.' };
        }

        var validated = [];
        var seen = {};
        var errors = [];

        for (var i = 0; i < rankings.length; i++) {
            var entry = rankings[i];
            if (!entry || typeof entry !== 'object') {
                errors.push('Invalid ranking entry at index ' + i + '.');
                continue;
            }

            var studentResult = validateStudentId(entry.studentId);
            if (!studentResult.valid) {
                errors.push('Entry ' + i + ': ' + studentResult.message);
                continue;
            }

            var rankNum = validateRank(entry.rank);
            if (rankNum === null) {
                errors.push('Entry ' + i + ': Valid rank is required.');
                continue;
            }

            var id = String(entry.studentId);
            if (seen[id]) {
                errors.push('Duplicate student ID: ' + id);
                continue;
            }
            seen[id] = true;

            validated.push({
                studentId: id,
                student: studentResult.student,
                rank: rankNum
            });
        }

        if (errors.length > 0) {
            return { valid: false, message: errors.join('; ') };
        }

        if (validated.length === 0) {
            return { valid: false, message: 'No valid ranking entries.' };
        }

        return {
            valid: true,
            week: weekNum,
            rankings: validated
        };
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    // ============================================================
    // RANKING QUERIES
    // ============================================================

    function getRankings(week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return [];
        }

        var store = getRankingsStore();
        if (!store || typeof store !== 'object') {
            return [];
        }

        var rankings = store[weekNum];
        if (!Array.isArray(rankings)) {
            return [];
        }

        return deepClone(rankings) || [];
    }

    function getStudentRank(week, studentId) {
        var rankings = getRankings(week);
        for (var i = 0; i < rankings.length; i++) {
            if (String(rankings[i].studentId) === String(studentId)) {
                return rankings[i].rank;
            }
        }
        return null;
    }

    function hasRankings(week) {
        return getRankings(week).length > 0;
    }

    function getRankingCount(week) {
        return getRankings(week).length;
    }

    function getRankingsWithDetails(week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return [];
        }

        var rankings = getRankings(weekNum);
        var result = [];

        for (var i = 0; i < rankings.length; i++) {
            var entry = rankings[i];
            var student = CharacterQueries.getCharacterById(entry.studentId);
            var summary = AcademyGrades.calculateSummary(entry.studentId, weekNum);

            result.push({
                rank: entry.rank,
                studentId: entry.studentId,
                studentName: student ? CharacterQueries.getDisplayName(student) : 'Unknown',
                studentStatus: student ? CharacterQueries.getCurrentStatus(student) : '',
                average: summary ? summary.average : null,
                gradedCount: summary ? summary.gradedCount : 0,
                scheduledCount: summary ? summary.scheduledCount : 0,
                hasGrades: summary ? summary.hasGrades : false
            });
        }

        result.sort(function(a, b) {
            return a.rank - b.rank;
        });

        return result;
    }

    function getStudentRankingHistory(studentId, startWeek, endWeek) {
        if (!isNonEmptyString(studentId)) {
            return [];
        }

        var start = CalendarValidation.parseWeek(startWeek);
        var end = CalendarValidation.parseWeek(endWeek);

        if (start === null) {
            start = CalendarConstants.MIN_WEEK;
        }
        if (end === null) {
            end = CalendarConstants.MAX_WEEK;
        }

        var history = [];

        for (var week = start; week <= end; week++) {
            var rank = getStudentRank(week, studentId);
            if (rank !== null) {
                history.push({
                    week: week,
                    rank: rank
                });
            }
        }

        return history;
    }

    // ============================================================
    // CLASS RANKING QUERIES - Derived projections
    // ============================================================

    function getClassRankings(classId, week) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return [];
        }

        var students = AcademyClassQueries.getCharactersByClass(classId);
        var rankings = getRankingsWithDetails(weekNum);
        var result = [];

        var studentIds = {};
        for (var i = 0; i < students.length; i++) {
            studentIds[String(students[i].id)] = true;
        }

        for (var j = 0; j < rankings.length; j++) {
            var entry = rankings[j];
            if (studentIds[entry.studentId]) {
                result.push(entry);
            }
        }

        result.sort(function(a, b) {
            return a.rank - b.rank;
        });

        for (var k = 0; k < result.length; k++) {
            result[k].classRank = k + 1;
        }

        return result;
    }

    function getClassRankingSummary(classId, week) {
        if (!isNonEmptyString(classId)) {
            return null;
        }

        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return null;
        }

        var rankings = getClassRankings(classId, weekNum);
        var students = AcademyClassQueries.getCharactersByClass(classId);

        var rankedStudents = rankings.length;
        var unrankedStudents = students.length - rankedStudents;

        var averages = [];
        for (var i = 0; i < rankings.length; i++) {
            if (rankings[i].average !== null) {
                averages.push(rankings[i].average);
            }
        }

        var classAverage = averages.length > 0 ? averages.reduce(function(a, b) { return a + b; }, 0) / averages.length : null;

        return {
            classId: classId,
            week: weekNum,
            totalStudents: students.length,
            rankedStudents: rankedStudents,
            unrankedStudents: unrankedStudents,
            classAverage: classAverage,
            rankings: rankings,
            highestRank: rankings.length > 0 ? rankings[0] : null,
            lowestRank: rankings.length > 0 ? rankings[rankings.length - 1] : null
        };
    }

    // ============================================================
    // RANKING STATISTICS
    // ============================================================

    function getRankingStatistics(week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return null;
        }

        var rankings = getRankingsWithDetails(weekNum);
        var students = CharacterQueries.getStudents();

        var ranked = rankings.length;
        var unranked = students.length - ranked;

        var averages = [];
        for (var i = 0; i < rankings.length; i++) {
            if (rankings[i].average !== null) {
                averages.push(rankings[i].average);
            }
        }

        var averageScore = averages.length > 0 ? averages.reduce(function(a, b) { return a + b; }, 0) / averages.length : null;

        var topStudent = rankings.length > 0 ? rankings[0] : null;
        var bottomStudent = rankings.length > 0 ? rankings[rankings.length - 1] : null;

        return {
            week: weekNum,
            totalStudents: students.length,
            rankedStudents: ranked,
            unrankedStudents: unranked,
            averageScore: averageScore,
            topStudent: topStudent,
            bottomStudent: bottomStudent
        };
    }

    function getRankingDistribution(week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return null;
        }

        var rankings = getRankingsWithDetails(weekNum);
        var distribution = {
            top10: 0,
            top25: 0,
            top50: 0,
            bottom50: 0,
            bottom25: 0,
            bottom10: 0
        };

        var total = rankings.length;
        if (total === 0) {
            return distribution;
        }

        for (var i = 0; i < rankings.length; i++) {
            var rank = rankings[i].rank;
            var pct = rank / total;

            if (pct <= 0.1) {
                distribution.top10++;
            }
            if (pct <= 0.25) {
                distribution.top25++;
            }
            if (pct <= 0.5) {
                distribution.top50++;
            }
            if (pct > 0.5) {
                distribution.bottom50++;
            }
            if (pct > 0.75) {
                distribution.bottom25++;
            }
            if (pct > 0.9) {
                distribution.bottom10++;
            }
        }

        return distribution;
    }

    function getTopRankedStudents(week, count) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return [];
        }

        var parsedCount = CalendarValidation.parseInRange(count, 1, 100, true);
        if (parsedCount === null || !Number.isFinite(parsedCount)) {
            parsedCount = 10;
        }

        var rankings = getRankingsWithDetails(weekNum);
        return rankings.slice(0, Math.min(parsedCount, rankings.length));
    }

    // ============================================================
    // CANDIDATE MUTATION FUNCTIONS - No direct commit
    // ============================================================

    /**
     * Build a candidate for setting rankings for a week.
     * Replaces the entire ranking for the specified week.
     */
    function buildSetRankingsCandidate(week, rankings) {
        // ---- PHASE 1: VALIDATE ----
        var validation = validateRankingsData(week, rankings);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var weekNum = validation.week;
        var validatedRankings = validation.rankings;

        // ---- PHASE 2: PREPARE RANKINGS ----
        var sorted = validatedRankings.slice().sort(function(a, b) {
            return a.rank - b.rank;
        });

        var finalRankings = [];
        for (var i = 0; i < sorted.length; i++) {
            finalRankings.push({
                studentId: sorted[i].studentId,
                rank: i + 1
            });
        }

        // ---- PHASE 3: BUILD MUTATION FUNCTION ----
        function mutate(data) {
            if (!data.curriculum) {
                data.curriculum = {};
            }
            if (!data.curriculum.rankings) {
                data.curriculum.rankings = {};
            }
            data.curriculum.rankings[weekNum] = finalRankings;
            return { rankings: finalRankings, count: finalRankings.length };
        }

        return success({
            mutate: mutate,
            week: weekNum,
            rankings: finalRankings,
            count: finalRankings.length
        });
    }

    /**
     * Build a candidate for auto-generating rankings from grades.
     */
    function buildAutoGenerateCandidate(week) {
        // ---- PHASE 1: VALIDATE ----
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + CalendarConstants.MIN_WEEK + '-' + CalendarConstants.MAX_WEEK + ').');
        }

        // ---- PHASE 2: GET STUDENTS WITH GRADES ----
        var students = CharacterQueries.getStudents();
        var studentAverages = [];

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            var summary = AcademyGrades.calculateSummary(student.id, weekNum);

            if (summary && summary.hasGrades && summary.average !== null) {
                studentAverages.push({
                    studentId: student.id,
                    student: student,
                    average: summary.average
                });
            }
        }

        if (studentAverages.length === 0) {
            return failure('No students with valid grades found for week ' + weekNum + '.');
        }

        // ---- PHASE 3: SORT ----
        studentAverages.sort(function(a, b) {
            if (b.average !== a.average) {
                return b.average - a.average;
            }
            var nameA = CharacterQueries.getDisplayName(a.student);
            var nameB = CharacterQueries.getDisplayName(b.student);
            var nameComparison = nameA.localeCompare(nameB);
            if (nameComparison !== 0) {
                return nameComparison;
            }
            return String(a.studentId).localeCompare(String(b.studentId));
        });

        var newRankings = [];
        for (var i = 0; i < studentAverages.length; i++) {
            newRankings.push({
                studentId: studentAverages[i].studentId,
                rank: i + 1
            });
        }

        var gradedCount = studentAverages.length;
        var totalStudents = students.length;

        // ---- PHASE 4: BUILD MUTATION FUNCTION ----
        function mutate(data) {
            if (!data.curriculum) {
                data.curriculum = {};
            }
            if (!data.curriculum.rankings) {
                data.curriculum.rankings = {};
            }
            data.curriculum.rankings[weekNum] = newRankings;
            return {
                rankings: newRankings,
                count: gradedCount,
                totalStudents: totalStudents
            };
        }

        return success({
            mutate: mutate,
            week: weekNum,
            rankings: newRankings,
            count: gradedCount,
            totalStudents: totalStudents
        });
    }

    /**
     * Build a candidate for setting a student's position in the rankings.
     * Adds student if not present, updates position if present.
     */
    function buildSetStudentPositionCandidate(week, studentId, desiredRank) {
        // ---- PHASE 1: VALIDATE ----
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + CalendarConstants.MIN_WEEK + '-' + CalendarConstants.MAX_WEEK + ').');
        }

        var studentResult = validateStudentId(studentId);
        if (!studentResult.valid) {
            return failure(studentResult.message);
        }

        var rankNum = validateRank(desiredRank);
        if (rankNum === null) {
            return failure('Valid rank is required.');
        }

        // ---- PHASE 2: GET CURRENT RANKINGS ----
        var store = getRankingsStore();
        var currentRankings = (store && store[weekNum] && Array.isArray(store[weekNum]))
            ? store[weekNum]
            : [];

        // ---- PHASE 3: FIND OR PREPARE ----
        var existingIndex = -1;
        var existingRank = null;

        for (var i = 0; i < currentRankings.length; i++) {
            if (String(currentRankings[i].studentId) === String(studentId)) {
                existingIndex = i;
                existingRank = currentRankings[i].rank;
                break;
            }
        }

        // If student already exists and rank hasn't changed, return no-op
        if (existingIndex !== -1 && existingRank === rankNum) {
            return success({
                mutate: function(data) {
                    return { rankings: currentRankings, count: currentRankings.length, operation: 'unchanged' };
                },
                operation: 'unchanged',
                count: currentRankings.length
            });
        }

        // ---- PHASE 4: BUILD CANDIDATE ----
        // Create a working copy
        var workingRankings = currentRankings.slice();

        // Remove existing entry if present
        if (existingIndex !== -1) {
            workingRankings.splice(existingIndex, 1);
        }

        // Normalise ranks after removal
        workingRankings.sort(function(a, b) {
            return a.rank - b.rank;
        });
        for (var i = 0; i < workingRankings.length; i++) {
            workingRankings[i].rank = i + 1;
        }

        // Determine insertion position
        var targetIndex = Math.min(rankNum - 1, workingRankings.length);

        // Insert at target position
        var newEntry = {
            studentId: String(studentId),
            rank: targetIndex + 1
        };

        workingRankings.splice(targetIndex, 0, newEntry);

        // Re-normalise all ranks
        for (var i = 0; i < workingRankings.length; i++) {
            workingRankings[i].rank = i + 1;
        }

        var operation = existingIndex !== -1 ? 'updated' : 'added';
        var studentName = CharacterQueries.getDisplayName(studentResult.student);

        // ---- PHASE 5: BUILD MUTATION FUNCTION ----
        function mutate(data) {
            if (!data.curriculum) {
                data.curriculum = {};
            }
            if (!data.curriculum.rankings) {
                data.curriculum.rankings = {};
            }
            data.curriculum.rankings[weekNum] = workingRankings;
            return {
                rankings: workingRankings,
                count: workingRankings.length,
                operation: operation,
                studentId: studentId,
                studentName: studentName
            };
        }

        return success({
            mutate: mutate,
            operation: operation,
            count: workingRankings.length,
            studentId: studentId,
            studentName: studentName
        });
    }

    /**
     * Build a candidate for removing a student from rankings.
     */
    function buildRemoveStudentCandidate(week, studentId) {
        // ---- PHASE 1: VALIDATE ----
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + CalendarConstants.MIN_WEEK + '-' + CalendarConstants.MAX_WEEK + ').');
        }

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        // ---- PHASE 2: GET CURRENT RANKINGS ----
        var store = getRankingsStore();
        var currentRankings = (store && store[weekNum] && Array.isArray(store[weekNum]))
            ? store[weekNum]
            : [];

        if (currentRankings.length === 0) {
            return success({
                mutate: function(data) {
                    return { rankings: [], count: 0, operation: 'unchanged' };
                },
                operation: 'unchanged',
                count: 0
            });
        }

        // Check if student exists
        var exists = false;
        for (var i = 0; i < currentRankings.length; i++) {
            if (String(currentRankings[i].studentId) === String(studentId)) {
                exists = true;
                break;
            }
        }

        if (!exists) {
            return success({
                mutate: function(data) {
                    return { rankings: currentRankings, count: currentRankings.length, operation: 'unchanged' };
                },
                operation: 'unchanged',
                count: currentRankings.length
            });
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
        var newRankings = [];
        for (var i = 0; i < currentRankings.length; i++) {
            if (String(currentRankings[i].studentId) !== String(studentId)) {
                newRankings.push({
                    studentId: currentRankings[i].studentId,
                    rank: currentRankings[i].rank
                });
            }
        }

        newRankings.sort(function(a, b) {
            return a.rank - b.rank;
        });

        for (var i = 0; i < newRankings.length; i++) {
            newRankings[i].rank = i + 1;
        }

        var student = CharacterQueries.getCharacterById(studentId);
        var studentName = student ? CharacterQueries.getDisplayName(student) : 'Unknown';

        // ---- PHASE 4: BUILD MUTATION FUNCTION ----
        function mutate(data) {
            if (!data.curriculum) {
                data.curriculum = {};
            }
            if (!data.curriculum.rankings) {
                data.curriculum.rankings = {};
            }

            if (newRankings.length === 0) {
                delete data.curriculum.rankings[weekNum];
            } else {
                data.curriculum.rankings[weekNum] = newRankings;
            }

            return {
                rankings: newRankings,
                count: newRankings.length,
                operation: 'removed',
                studentId: studentId,
                studentName: studentName
            };
        }

        return success({
            mutate: mutate,
            operation: 'removed',
            count: newRankings.length,
            studentId: studentId,
            studentName: studentName
        });
    }

    /**
     * Build a candidate for clearing all rankings for a week.
     */
    function buildClearRankingsCandidate(week) {
        var weekNum = CalendarValidation.parseWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + CalendarConstants.MIN_WEEK + '-' + CalendarConstants.MAX_WEEK + ').');
        }

        function mutate(data) {
            if (!data.curriculum) {
                data.curriculum = {};
            }
            if (!data.curriculum.rankings) {
                data.curriculum.rankings = {};
            }
            delete data.curriculum.rankings[weekNum];
            return { week: weekNum };
        }

        return success({
            mutate: mutate,
            week: weekNum
        });
    }

    // ============================================================
    // LEGACY WRAPPER FUNCTIONS - For backward compatibility
    // These perform the mutation and commit directly.
    // DEPRECATED: Use build*Candidate functions with MutationPipeline.
    // ============================================================

    function setRankings(week, rankings) {
        var candidate = buildSetRankingsCandidate(week, rankings);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var data = window.data;
            var result = candidate.data.mutate(data);
            return success({
                rankings: result.rankings,
                count: result.count
            });
        } catch (e) {
            return failure(e.message || 'Failed to set rankings.');
        }
    }

    function autoGenerate(week) {
        var candidate = buildAutoGenerateCandidate(week);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var data = window.data;
            var result = candidate.data.mutate(data);
            return success({
                rankings: result.rankings,
                count: result.count,
                totalStudents: result.totalStudents
            });
        } catch (e) {
            return failure(e.message || 'Failed to auto-generate rankings.');
        }
    }

    function updateStudentRank(week, studentId, newRank) {
        var candidate = buildSetStudentPositionCandidate(week, studentId, newRank);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var data = window.data;
            var result = candidate.data.mutate(data);
            return success({
                rankings: result.rankings,
                count: result.count,
                operation: result.operation
            });
        } catch (e) {
            return failure(e.message || 'Failed to update student rank.');
        }
    }

    function removeStudentFromRankings(week, studentId) {
        var candidate = buildRemoveStudentCandidate(week, studentId);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var data = window.data;
            var result = candidate.data.mutate(data);
            return success({
                rankings: result.rankings,
                count: result.count,
                operation: result.operation
            });
        } catch (e) {
            return failure(e.message || 'Failed to remove student from rankings.');
        }
    }

    function clearRankings(week) {
        var candidate = buildClearRankingsCandidate(week);
        if (!candidate.success) {
            return candidate;
        }

        try {
            var data = window.data;
            candidate.data.mutate(data);
            return success({ week: candidate.data.week });
        } catch (e) {
            return failure(e.message || 'Failed to clear rankings.');
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyRanking = {
        // Queries
        getRankings: getRankings,
        getStudentRank: getStudentRank,
        hasRankings: hasRankings,
        getRankingCount: getRankingCount,
        getRankingsWithDetails: getRankingsWithDetails,
        getStudentRankingHistory: getStudentRankingHistory,

        // Class ranking queries (derived projections)
        getClassRankings: getClassRankings,
        getClassRankingSummary: getClassRankingSummary,

        // Statistics
        getRankingStatistics: getRankingStatistics,
        getRankingDistribution: getRankingDistribution,
        getTopRankedStudents: getTopRankedStudents,

        // Candidate builders (preferred - use with MutationPipeline)
        buildSetRankingsCandidate: buildSetRankingsCandidate,
        buildAutoGenerateCandidate: buildAutoGenerateCandidate,
        buildSetStudentPositionCandidate: buildSetStudentPositionCandidate,
        buildRemoveStudentCandidate: buildRemoveStudentCandidate,
        buildClearRankingsCandidate: buildClearRankingsCandidate,

        // Legacy wrappers (deprecated - use with caution)
        setRankings: setRankings,
        autoGenerate: autoGenerate,
        updateStudentRank: updateStudentRank,
        removeStudentFromRankings: removeStudentFromRankings,
        clearRankings: clearRankings,

        // Validation (exposed for external use)
        validateRank: validateRank
    };

})();
