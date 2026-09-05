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
 *   - All mutations are candidate-based: validate, clone, modify, commit
 *   - No mutation of live state occurs before candidate validation completes
 *   - This module does NOT call saveData() - callers own persistence
 *   - All validation uses CALENDAR_CONSTANTS from constants.js
 *   - All deep cloning uses ObjectUtils.deepClone()
 *   - Bulk operations are ATOMIC: all or nothing
 *   - Rankings are POSITIONAL: ranks are normalised to 1..N on every mutation
 *   - Input rank values are treated as desired positions, not absolute ranks
 * 
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.AcademyQueries (from academy-queries.js)
 *   - window.AcademyGrades (from academy-grades.js)
 *   - window.CALENDAR_CONSTANTS (from constants.js)
 *   - window.ActivityLog (from activity-log.js)
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
    var AcademyQueries = window.AcademyQueries;
    var AcademyGrades = window.AcademyGrades;
    var CalendarConstants = window.CALENDAR_CONSTANTS;
    var ActivityLog = window.ActivityLog;

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

        if (!AcademyQueries || typeof AcademyQueries.getClassStudents !== 'function') {
            missing.push('AcademyQueries.getClassStudents');
        }
        if (!AcademyQueries || typeof AcademyQueries.getCharacterById !== 'function') {
            missing.push('AcademyQueries.getCharacterById');
        }
        if (!AcademyQueries || typeof AcademyQueries.getStudents !== 'function') {
            missing.push('AcademyQueries.getStudents');
        }

        if (!AcademyGrades || typeof AcademyGrades.calculateSummary !== 'function') {
            missing.push('AcademyGrades.calculateSummary');
        }

        if (!CalendarConstants || typeof CalendarConstants.MIN_WEEK !== 'number') {
            missing.push('CALENDAR_CONSTANTS');
        }

        if (!ActivityLog || typeof ActivityLog.record !== 'function') {
            missing.push('ActivityLog.record');
        }

        if (missing.length > 0) {
            console.warn('AcademyRanking: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__academyRankingLoaded = true;

    // ============================================================
    // CONSTANTS - From CALENDAR_CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    // ============================================================
    // HELPER ALIASES
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    function recordActivity(message) {
        try {
            ActivityLog.record(message);
        } catch (e) {
            // Activity logging failure should not abort the mutation
        }
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    // ============================================================
    // DATA STORE ACCESS
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    // ============================================================
    // VALIDATION HELPERS - Strict validation
    // ============================================================

    function validateWeek(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        if (!Number.isInteger(num) || num < MIN_WEEK || num > MAX_WEEK) {
            return null;
        }
        return num;
    }

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
        // Check if character is actually a student
        var status = CharacterQueries.getCurrentStatus(student);
        if (status !== 'trainee' && status !== 'rookie' && status !== 'junior') {
            return { valid: false, message: 'Character is not a student.' };
        }
        return { valid: true, student: student };
    }

    function validateRankingsData(week, rankings) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { valid: false, message: 'Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').' };
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

    // ============================================================
    // RANKING QUERIES
    // ============================================================

    function getRankings(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.rankings) {
            return [];
        }

        var rankings = data.curriculum.rankings[weekNum];
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
        var weekNum = validateWeek(week);
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

        var start = validateWeek(startWeek) || MIN_WEEK;
        var end = validateWeek(endWeek) || MAX_WEEK;

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
    // CLASS RANKING QUERIES
    // ============================================================

    function getClassRankings(classId, week) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }

        var students = AcademyQueries.getClassStudents(classId);
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

        // Re-rank within class (preserve original ranks for tie-breaking)
        result.sort(function(a, b) {
            return a.rank - b.rank;
        });

        // Add class-specific rank
        for (var k = 0; k < result.length; k++) {
            result[k].classRank = k + 1;
        }

        return result;
    }

    function getClassRankingSummary(classId, week) {
        if (!isNonEmptyString(classId)) {
            return null;
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }

        var rankings = getClassRankings(classId, weekNum);
        var students = AcademyQueries.getClassStudents(classId);

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
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }

        var rankings = getRankingsWithDetails(weekNum);
        var students = AcademyQueries.getStudents();

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
        var weekNum = validateWeek(week);
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

            // Cumulative buckets (top10 ⊂ top25 ⊂ top50)
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
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }

        count = Math.max(1, count || 10);
        var rankings = getRankingsWithDetails(weekNum);
        return rankings.slice(0, Math.min(count, rankings.length));
    }

    // ============================================================
    // RANKING MUTATIONS - Candidate-based
    // ============================================================

    function setRankings(week, rankings) {
        // ---- PHASE 1: VALIDATE ----
        var validation = validateRankingsData(week, rankings);
        if (!validation.valid) {
            return failure(validation.message);
        }

        var weekNum = validation.week;
        var validatedRankings = validation.rankings;

        // ---- PHASE 2: GET STORE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        var existingRankings = data.curriculum.rankings;
        if (!isObject(existingRankings)) {
            return failure('Ranking data store is corrupted.');
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
        var candidate = deepClone(existingRankings || {});
        if (candidate === null) {
            return failure('Failed to prepare ranking data.');
        }

        // ---- PHASE 4: PREPARE RANKINGS ----
        // Ranks are POSITIONAL: input rank values determine order.
        // Equal positions preserve input order (stable sort).
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

        // ---- PHASE 5: COMMIT ----
        candidate[weekNum] = finalRankings;
        data.curriculum.rankings = candidate;

        // ---- PHASE 6: LOG ----
        recordActivity('Set rankings for week ' + weekNum + ' (' + finalRankings.length + ' students)');

        return success({
            rankings: finalRankings,
            count: finalRankings.length
        });
    }

    function autoGenerate(week) {
        // ---- PHASE 1: VALIDATE ----
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        // ---- PHASE 2: GET STUDENTS WITH GRADES ----
        var students = AcademyQueries.getStudents();
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
            // Sort by average descending
            if (b.average !== a.average) {
                return b.average - a.average;
            }
            // Tie-break by display name
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

        // ---- PHASE 4: GET STORE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        var existingRankings = data.curriculum.rankings;
        if (!isObject(existingRankings)) {
            return failure('Ranking data store is corrupted.');
        }

        // ---- PHASE 5: BUILD CANDIDATE ----
        var candidate = deepClone(existingRankings || {});
        if (candidate === null) {
            return failure('Failed to prepare ranking data.');
        }

        // ---- PHASE 6: COMMIT ----
        candidate[weekNum] = newRankings;
        data.curriculum.rankings = candidate;

        // ---- PHASE 7: LOG ----
        var gradedCount = studentAverages.length;
        var totalStudents = students.length;
        recordActivity('Auto-generated rankings for week ' + weekNum +
            ' (' + gradedCount + ' of ' + totalStudents + ' students ranked)');

        return success({
            rankings: newRankings,
            count: gradedCount,
            totalStudents: totalStudents
        });
    }

    function generateClassRankings(classId, week) {
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        // ---- PHASE 1: GET STUDENTS IN CLASS ----
        var students = AcademyQueries.getClassStudents(classId);
        if (students.length === 0) {
            return failure('No students in this class.');
        }

        // ---- PHASE 2: COLLECT AVERAGES ----
        var rankingData = [];

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            var summary = AcademyGrades.calculateSummary(student.id, weekNum);

            if (summary && summary.hasGrades && summary.average !== null) {
                rankingData.push({
                    studentId: student.id,
                    student: student,
                    average: summary.average,
                    name: CharacterQueries.getDisplayName(student)
                });
            }
        }

        if (rankingData.length === 0) {
            return failure('No students with valid grades found in this class.');
        }

        // ---- PHASE 3: SORT ----
        rankingData.sort(function(a, b) {
            if (b.average !== a.average) {
                return b.average - a.average;
            }
            return a.name.localeCompare(b.name);
        });

        var rankings = [];
        for (var i = 0; i < rankingData.length; i++) {
            rankings.push({
                studentId: rankingData[i].studentId,
                rank: i + 1
            });
        }

        // ---- PHASE 4: GET STORE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        var existingRankings = data.curriculum.rankings;
        if (!isObject(existingRankings)) {
            return failure('Ranking data store is corrupted.');
        }

        // ---- PHASE 5: BUILD CANDIDATE ----
        var candidate = deepClone(existingRankings || {});
        if (candidate === null) {
            return failure('Failed to prepare ranking data.');
        }

        // ---- PHASE 6: COMMIT ----
        candidate[weekNum] = rankings;
        data.curriculum.rankings = candidate;

        // ---- PHASE 7: LOG ----
        var className = 'Unknown';
        var cls = AcademyQueries.getClass(classId);
        if (cls) {
            className = cls.name;
        }
        recordActivity('Generated class rankings for ' + className + ' week ' + weekNum +
            ' (' + rankings.length + ' of ' + students.length + ' students ranked)');

        return success({
            rankings: rankings,
            count: rankings.length,
            totalStudents: students.length,
            classId: classId,
            week: weekNum
        });
    }

    function updateStudentRank(week, studentId, newRank) {
        // ---- PHASE 1: VALIDATE ----
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        var studentResult = validateStudentId(studentId);
        if (!studentResult.valid) {
            return failure(studentResult.message);
        }

        var rankNum = validateRank(newRank);
        if (rankNum === null) {
            return failure('Valid rank is required.');
        }

        // ---- PHASE 2: GET STORE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        var existingRankings = data.curriculum.rankings;
        if (!isObject(existingRankings)) {
            return failure('Ranking data store is corrupted.');
        }

        var rankings = existingRankings[weekNum];
        if (!Array.isArray(rankings)) {
            // No rankings exist, create new
            return setRankings(weekNum, [{ studentId: studentId, rank: rankNum }]);
        }

        // ---- PHASE 3: FIND OR CREATE ENTRY ----
        var existingIndex = -1;
        var existingRank = null;

        for (var i = 0; i < rankings.length; i++) {
            if (String(rankings[i].studentId) === String(studentId)) {
                existingIndex = i;
                existingRank = rankings[i].rank;
                break;
            }
        }

        var targetRank = Math.min(rankNum, rankings.length + 1);

        // ---- PHASE 4: BUILD CANDIDATE ----
        var candidate = deepClone(existingRankings || {});
        if (candidate === null) {
            return failure('Failed to prepare ranking data.');
        }

        var weekRankings = candidate[weekNum];

        if (!Array.isArray(weekRankings)) {
            weekRankings = [];
        }

        if (existingIndex === -1) {
            // Add new student
            for (var i = 0; i < weekRankings.length; i++) {
                if (weekRankings[i].rank >= targetRank) {
                    weekRankings[i].rank++;
                }
            }

            weekRankings.push({
                studentId: String(studentId),
                rank: targetRank
            });

            weekRankings.sort(function(a, b) {
                return a.rank - b.rank;
            });

            for (var i = 0; i < weekRankings.length; i++) {
                weekRankings[i].rank = i + 1;
            }

            candidate[weekNum] = weekRankings;

            // ---- PHASE 5: COMMIT ----
            data.curriculum.rankings = candidate;

            // ---- PHASE 6: LOG ----
            var studentName = CharacterQueries.getDisplayName(studentResult.student);
            recordActivity('Added ' + studentName + ' to rankings at #' + targetRank + ' (week ' + weekNum + ')');

            return success({
                rankings: weekRankings,
                count: weekRankings.length,
                operation: 'added'
            });

        } else {
            // Update existing student
            var oldRank = existingRank;
            var effectiveTarget = Math.min(rankNum, weekRankings.length);

            if (oldRank === effectiveTarget) {
                return success({
                    rankings: weekRankings,
                    count: weekRankings.length,
                    operation: 'unchanged'
                });
            }

            // Remove existing entry
            weekRankings.splice(existingIndex, 1);

            weekRankings.sort(function(a, b) {
                return a.rank - b.rank;
            });

            for (var i = 0; i < weekRankings.length; i++) {
                weekRankings[i].rank = i + 1;
            }

            var targetRank2 = Math.min(effectiveTarget, weekRankings.length + 1);

            for (var i = 0; i < weekRankings.length; i++) {
                if (weekRankings[i].rank >= targetRank2) {
                    weekRankings[i].rank++;
                }
            }

            weekRankings.push({
                studentId: String(studentId),
                rank: targetRank2
            });

            weekRankings.sort(function(a, b) {
                return a.rank - b.rank;
            });

            for (var i = 0; i < weekRankings.length; i++) {
                weekRankings[i].rank = i + 1;
            }

            candidate[weekNum] = weekRankings;

            // ---- PHASE 5: COMMIT ----
            data.curriculum.rankings = candidate;

            // ---- PHASE 6: LOG ----
            var studentName = CharacterQueries.getDisplayName(studentResult.student);
            recordActivity('Moved ' + studentName + ' from #' + oldRank + ' to #' + targetRank2 + ' (week ' + weekNum + ')');

            return success({
                rankings: weekRankings,
                count: weekRankings.length,
                operation: 'updated'
            });
        }
    }

    function removeStudentFromRankings(week, studentId) {
        // ---- PHASE 1: VALIDATE ----
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        // ---- PHASE 2: GET STORE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        var existingRankings = data.curriculum.rankings;
        if (!isObject(existingRankings)) {
            return failure('Ranking data store is corrupted.');
        }

        var rankings = existingRankings[weekNum];
        if (!Array.isArray(rankings) || rankings.length === 0) {
            return success({
                rankings: [],
                count: 0,
                operation: 'unchanged'
            });
        }

        // ---- PHASE 3: FIND STUDENT ----
        var exists = false;
        for (var i = 0; i < rankings.length; i++) {
            if (String(rankings[i].studentId) === String(studentId)) {
                exists = true;
                break;
            }
        }

        if (!exists) {
            return success({
                rankings: rankings,
                count: rankings.length,
                operation: 'unchanged'
            });
        }

        // ---- PHASE 4: BUILD CANDIDATE ----
        var candidate = deepClone(existingRankings || {});
        if (candidate === null) {
            return failure('Failed to prepare ranking data.');
        }

        var weekRankings = candidate[weekNum];
        if (!Array.isArray(weekRankings)) {
            return success({
                rankings: [],
                count: 0,
                operation: 'unchanged'
            });
        }

        // ---- PHASE 5: REMOVE ----
        var newRankings = [];
        for (var i = 0; i < weekRankings.length; i++) {
            if (String(weekRankings[i].studentId) !== String(studentId)) {
                newRankings.push(weekRankings[i]);
            }
        }

        newRankings.sort(function(a, b) {
            return a.rank - b.rank;
        });

        for (var i = 0; i < newRankings.length; i++) {
            newRankings[i].rank = i + 1;
        }

        if (newRankings.length === 0) {
            delete candidate[weekNum];
        } else {
            candidate[weekNum] = newRankings;
        }

        // ---- PHASE 6: COMMIT ----
        data.curriculum.rankings = candidate;

        // ---- PHASE 7: LOG ----
        var student = CharacterQueries.getCharacterById(studentId);
        var studentName = student ? CharacterQueries.getDisplayName(student) : 'Unknown';
        recordActivity('Removed ' + studentName + ' from rankings for week ' + weekNum);

        return success({
            rankings: newRankings,
            count: newRankings.length,
            operation: 'removed'
        });
    }

    function clearRankings(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        return setRankings(weekNum, []);
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

        // Class ranking queries
        getClassRankings: getClassRankings,
        getClassRankingSummary: getClassRankingSummary,

        // Statistics
        getRankingStatistics: getRankingStatistics,
        getRankingDistribution: getRankingDistribution,
        getTopRankedStudents: getTopRankedStudents,

        // Mutations
        setRankings: setRankings,
        autoGenerate: autoGenerate,
        generateClassRankings: generateClassRankings,
        updateStudentRank: updateStudentRank,
        removeStudentFromRankings: removeStudentFromRankings,
        clearRankings: clearRankings,

        // Validation (exposed for external use)
        validateWeek: validateWeek,
        validateRank: validateRank
    };

})();