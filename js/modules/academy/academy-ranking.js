/**
 * js/modules/academy/academy-ranking.js - Academy Ranking Operations
 * Centralized ranking management for the academy module
 * Path: js/modules/academy/academy-ranking.js
 * 
 * This module handles:
 *   - Ranking CRUD operations (delegates to RankingCore)
 *   - Auto-generation of rankings from grades
 *   - Ranking display formatting
 *   - Class-level ranking summaries
 *   - Ranking change calculation
 * 
 * IMPORTANT:
 *   - All MUTATION operations return:
 *     { success: true, changed: boolean, operation: string, data: object, count: number }
 *     or { success: false, message: string }
 *   - Query functions return their documented value types
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation (candidate-based approach)
 *   - This module does NOT call saveData() - callers own persistence
 *   - All HTML escaping uses DomUtils.escapeHtml()
 *   - All notifications use NotificationSystem.notify()
 * 
 * DEPENDENCIES:
 *   - window.RankingCore (from curriculum-ranking.js)
 *   - window.AcademyQueries (from academy-queries.js)
 *   - window.AcademyGrades (from academy-grades.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.DomUtils (from dom-utils.js)
 * 
 * USAGE:
 *   var ranking = window.AcademyRanking;
 *   var result = ranking.autoGenerate(week);
 *   var rankings = ranking.getRankings(week);
 *   var summary = ranking.getClassRankingSummary(classId, week);
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

    var RankingCore = window.RankingCore;
    var AcademyQueries = window.AcademyQueries;
    var AcademyGrades = window.AcademyGrades;
    var CharacterQueries = window.CharacterQueries;
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!RankingCore || typeof RankingCore.getRankings !== 'function') {
            missing.push('RankingCore.getRankings');
        }
        if (!RankingCore || typeof RankingCore.getStudentRank !== 'function') {
            missing.push('RankingCore.getStudentRank');
        }
        if (!RankingCore || typeof RankingCore.hasRankings !== 'function') {
            missing.push('RankingCore.hasRankings');
        }
        if (!RankingCore || typeof RankingCore.getRankingCount !== 'function') {
            missing.push('RankingCore.getRankingCount');
        }
        if (!RankingCore || typeof RankingCore.setRankings !== 'function') {
            missing.push('RankingCore.setRankings');
        }
        if (!RankingCore || typeof RankingCore.autoGenerateRankings !== 'function') {
            missing.push('RankingCore.autoGenerateRankings');
        }
        if (!RankingCore || typeof RankingCore.updateStudentRank !== 'function') {
            missing.push('RankingCore.updateStudentRank');
        }
        if (!RankingCore || typeof RankingCore.removeStudentFromRankings !== 'function') {
            missing.push('RankingCore.removeStudentFromRankings');
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

        if (!AcademyGrades || typeof AcademyGrades.getStudentGradeSummary !== 'function') {
            missing.push('AcademyGrades.getStudentGradeSummary');
        }

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
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
    // HTML ESCAPING - Delegates to DomUtils
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    // ============================================================
    // NOTIFICATION - Delegates to NotificationSystem
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    function validateWeek(value) {
        var num = parseInt(value, 10);
        return (!isNaN(num) && num >= 1 && num <= 52) ? num : null;
    }

    function validateRank(value) {
        var num = parseInt(value, 10);
        return (!isNaN(num) && num >= 1) ? num : null;
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    // ============================================================
    // RANKING QUERIES
    // ============================================================

    function getRankings(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }
        return RankingCore.getRankings(weekNum);
    }

    function getStudentRank(week, studentId) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }
        if (!isNonEmptyString(studentId)) {
            return null;
        }
        return RankingCore.getStudentRank(weekNum, studentId);
    }

    function hasRankings(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return false;
        }
        return RankingCore.hasRankings(weekNum);
    }

    function getRankingCount(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return 0;
        }
        return RankingCore.getRankingCount(weekNum);
    }

    function getRankingsWithDetails(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return [];
        }

        var rankings = RankingCore.getRankings(weekNum);
        var result = [];

        for (var i = 0; i < rankings.length; i++) {
            var entry = rankings[i];
            var student = AcademyQueries.getCharacterById(entry.studentId);
            var summary = AcademyGrades.getStudentGradeSummary(entry.studentId, weekNum);

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

        // Sort by rank
        result.sort(function(a, b) {
            return a.rank - b.rank;
        });

        return result;
    }

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

        // Filter to only students in this class
        var studentIds = students.map(function(s) { return s.id; });

        for (var i = 0; i < rankings.length; i++) {
            var entry = rankings[i];
            if (studentIds.indexOf(entry.studentId) !== -1) {
                result.push(entry);
            }
        }

        // Re-rank within class (preserve original ranks)
        result.sort(function(a, b) {
            return a.rank - b.rank;
        });

        // Add class-specific rank
        for (var j = 0; j < result.length; j++) {
            result[j].classRank = j + 1;
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

    function getStudentRankingHistory(studentId, startWeek, endWeek) {
        if (!isNonEmptyString(studentId)) {
            return [];
        }

        startWeek = validateWeek(startWeek) || 1;
        endWeek = validateWeek(endWeek) || 52;

        var history = [];

        for (var week = startWeek; week <= endWeek; week++) {
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
    // RANKING MUTATIONS
    // ============================================================

    function setRankings(week, rankings) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        if (!Array.isArray(rankings)) {
            return { success: false, message: 'Rankings must be an array.' };
        }

        // Validate each entry
        for (var i = 0; i < rankings.length; i++) {
            var entry = rankings[i];
            if (!entry || typeof entry !== 'object') {
                return { success: false, message: 'Invalid ranking entry at index ' + i + '.' };
            }
            if (!isNonEmptyString(entry.studentId)) {
                return { success: false, message: 'Student ID is required at index ' + i + '.' };
            }
            var rankNum = validateRank(entry.rank);
            if (rankNum === null) {
                return { success: false, message: 'Valid rank is required at index ' + i + '.' };
            }
            var student = AcademyQueries.getCharacterById(entry.studentId);
            if (!student) {
                return { success: false, message: 'Student not found at index ' + i + '.' };
            }
        }

        var result = RankingCore.setRankings(weekNum, rankings);

        if (!result || !result.success) {
            return { success: false, message: result ? result.message : 'Failed to set rankings.' };
        }

        return result;
    }

    function autoGenerate(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        // Check if there are any students with grades
        var students = AcademyQueries.getStudents();
        var hasGrades = false;

        for (var i = 0; i < students.length; i++) {
            var summary = AcademyGrades.getStudentGradeSummary(students[i].id, weekNum);
            if (summary && summary.hasGrades && summary.average !== null) {
                hasGrades = true;
                break;
            }
        }

        if (!hasGrades) {
            return { success: false, message: 'No students with valid grades found for week ' + weekNum + '.' };
        }

        var result = RankingCore.autoGenerateRankings(weekNum);

        if (!result || !result.success) {
            return { success: false, message: result ? result.message : 'Failed to auto-generate rankings.' };
        }

        return result;
    }

    function updateStudentRank(week, studentId, newRank) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }

        var rankNum = validateRank(newRank);
        if (rankNum === null) {
            return { success: false, message: 'Valid rank is required.' };
        }

        var student = AcademyQueries.getCharacterById(studentId);
        if (!student) {
            return { success: false, message: 'Student not found.' };
        }

        var result = RankingCore.updateStudentRank(weekNum, studentId, rankNum);

        if (!result || !result.success) {
            return { success: false, message: result ? result.message : 'Failed to update student rank.' };
        }

        return result;
    }

    function removeStudentFromRankings(week, studentId) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }

        var student = AcademyQueries.getCharacterById(studentId);
        if (!student) {
            return { success: false, message: 'Student not found.' };
        }

        var result = RankingCore.removeStudentFromRankings(weekNum, studentId);

        if (!result || !result.success) {
            return { success: false, message: result ? result.message : 'Failed to remove student from rankings.' };
        }

        return result;
    }

    function clearRankings(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        var result = RankingCore.setRankings(weekNum, []);

        if (!result || !result.success) {
            return { success: false, message: result ? result.message : 'Failed to clear rankings.' };
        }

        return result;
    }

    // ============================================================
    // BULK OPERATIONS
    // ============================================================

    function generateClassRankings(classId, week) {
        if (!isNonEmptyString(classId)) {
            return { success: false, message: 'Class ID is required.' };
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        var students = AcademyQueries.getClassStudents(classId);
        if (students.length === 0) {
            return { success: false, message: 'No students in this class.' };
        }

        var rankingData = [];

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            var summary = AcademyGrades.getStudentGradeSummary(student.id, weekNum);

            if (summary && summary.hasGrades && summary.average !== null) {
                rankingData.push({
                    studentId: student.id,
                    average: summary.average,
                    name: CharacterQueries.getDisplayName(student)
                });
            }
        }

        if (rankingData.length === 0) {
            return { success: false, message: 'No students with valid grades found.' };
        }

        // Sort by average descending, then by name
        rankingData.sort(function(a, b) {
            if (b.average !== a.average) {
                return b.average - a.average;
            }
            return a.name.localeCompare(b.name);
        });

        var rankings = [];
        for (var j = 0; j < rankingData.length; j++) {
            rankings.push({
                studentId: rankingData[j].studentId,
                rank: j + 1
            });
        }

        var result = RankingCore.setRankings(weekNum, rankings);

        if (!result || !result.success) {
            return { success: false, message: result ? result.message : 'Failed to set class rankings.' };
        }

        result.data = {
            classId: classId,
            week: weekNum,
            rankedStudents: rankings.length,
            totalStudents: students.length
        };

        return result;
    }

    // ============================================================
    // RANKING DISPLAY HELPERS
    // ============================================================

    function formatRank(rank) {
        if (rank === undefined || rank === null) {
            return '--';
        }
        var num = parseInt(rank, 10);
        if (isNaN(num) || num < 1) {
            return '--';
        }
        return '#' + num;
    }

    function getRankColor(rank) {
        if (rank === undefined || rank === null) {
            return 'var(--text-dim)';
        }
        var num = parseInt(rank, 10);
        if (isNaN(num) || num < 1) {
            return 'var(--text-dim)';
        }
        if (num === 1) {
            return 'var(--accent)';
        }
        if (num <= 3) {
            return 'var(--info)';
        }
        if (num <= 10) {
            return 'var(--warning)';
        }
        return 'var(--text-dim)';
    }

    function getRankLabel(rank) {
        if (rank === undefined || rank === null) {
            return 'Unranked';
        }
        var num = parseInt(rank, 10);
        if (isNaN(num) || num < 1) {
            return 'Unranked';
        }
        if (num === 1) {
            return '1st';
        }
        if (num === 2) {
            return '2nd';
        }
        if (num === 3) {
            return '3rd';
        }
        return num + 'th';
    }

    function getRankChange(currentRank, previousRank) {
        if (currentRank === undefined || currentRank === null) {
            return null;
        }
        if (previousRank === undefined || previousRank === null) {
            return null;
        }

        var current = parseInt(currentRank, 10);
        var previous = parseInt(previousRank, 10);
        if (isNaN(current) || isNaN(previous)) {
            return null;
        }

        var change = previous - current;

        if (change > 0) {
            return { change: change, direction: 'up', label: '+' + change };
        }
        if (change < 0) {
            return { change: Math.abs(change), direction: 'down', label: '-' + Math.abs(change) };
        }
        return { change: 0, direction: 'same', label: '=' };
    }

    function getRankChangeColor(change) {
        if (!change) {
            return 'var(--text-dim)';
        }
        if (change.direction === 'up') {
            return 'var(--accent)';
        }
        if (change.direction === 'down') {
            return 'var(--danger)';
        }
        return 'var(--text-dim)';
    }

    function getRankChangeIcon(change) {
        if (!change) {
            return '·';
        }
        if (change.direction === 'up') {
            return '↑';
        }
        if (change.direction === 'down') {
            return '↓';
        }
        return '·';
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

        count = count || 10;
        var rankings = getRankingsWithDetails(weekNum);
        return rankings.slice(0, Math.min(count, rankings.length));
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
        getClassRankings: getClassRankings,
        getClassRankingSummary: getClassRankingSummary,
        getStudentRankingHistory: getStudentRankingHistory,

        // Mutations
        setRankings: setRankings,
        autoGenerate: autoGenerate,
        updateStudentRank: updateStudentRank,
        removeStudentFromRankings: removeStudentFromRankings,
        clearRankings: clearRankings,
        generateClassRankings: generateClassRankings,

        // Display helpers
        formatRank: formatRank,
        getRankColor: getRankColor,
        getRankLabel: getRankLabel,
        getRankChange: getRankChange,
        getRankChangeColor: getRankChangeColor,
        getRankChangeIcon: getRankChangeIcon,

        // Statistics
        getRankingStatistics: getRankingStatistics,
        getRankingDistribution: getRankingDistribution,
        getTopRankedStudents: getTopRankedStudents,

        // Validation
        validateWeek: validateWeek,
        validateRank: validateRank
    };

})();