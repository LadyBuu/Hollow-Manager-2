/**
 * js/core/curriculum/curriculum-ranking.js - Ranking Operations
 * Path: js/core/curriculum/curriculum-ranking.js
 * 
 * This module provides ranking CRUD and auto-generation operations.
 * 
 * IMPORTANT:
 *   - All functions return { success: boolean, message?: string, data?: any }
 *   - Validation occurs BEFORE mutation
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - Ranks are 1-indexed (1 = highest)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__curriculumRankingLoaded) {
        return;
    }
    window.__curriculumRankingLoaded = true;

    // ============================================================
    // PRIVATE HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function parsePositiveInteger(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var num = Number(value);
        return Number.isInteger(num) && num >= 1 ? num : null;
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function logActivity(message, type) {
        type = type || 'info';
        if (typeof window.logActivity === 'function') {
            window.logActivity(message, type);
        }
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

    function getCharacterCloneById(id) {
        if (!isNonEmptyString(id)) {
            return null;
        }

        if (typeof window.getCharacterById === 'function') {
            var char = window.getCharacterById(id);
            return char ? deepClone(char) : null;
        }

        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return null;
        }
        var char = data.characters.find(function(c) {
            return c && String(c.id) === String(id);
        }) || null;
        return char ? deepClone(char) : null;
    }

    function getStudents() {
        if (typeof window.getStudents === 'function') {
            return window.getStudents();
        }
        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return [];
        }
        return data.characters.filter(function(c) {
            if (!c || typeof c !== 'object') {
                return false;
            }
            if (c.deceased) {
                return false;
            }
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

    function isRankableStudent(studentId) {
        if (!isNonEmptyString(studentId)) {
            return false;
        }

        var char = getCharacterCloneById(studentId);
        if (!char) {
            return false;
        }

        var students = getStudents();
        return students.some(function(student) {
            return String(student.id) === String(studentId);
        });
    }

    function validateWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 52 ? num : null;
    }

    function validateRank(value) {
        var num = parsePositiveInteger(value);
        return num !== null ? num : null;
    }

    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }
        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                console.error('CurriculumRanking: structuredClone failed:', e);
                return null;
            }
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('CurriculumRanking: JSON clone failed:', e);
            return null;
        }
    }

    // ============================================================
    // RESULT HELPERS
    // ============================================================

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    function successWithRankings(rankings, operationType, count) {
        var cloned = deepClone(rankings);
        if (cloned === null) {
            return failure('Failed to clone ranking data.');
        }
        return {
            success: true,
            rankings: cloned,
            operation: operationType || 'updated',
            count: count || 0
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

        if (!data.curriculum.rankings[weekNum]) {
            return [];
        }

        var rankings = data.curriculum.rankings[weekNum];
        var result = [];

        for (var i = 0; i < rankings.length; i++) {
            result.push({
                studentId: rankings[i].studentId,
                rank: rankings[i].rank
            });
        }

        return result;
    }

    function getStudentRank(week, studentId) {
        var rankings = getRankings(week);
        var entry = rankings.find(function(r) {
            return r && String(r.studentId) === String(studentId);
        });
        return entry ? entry.rank : null;
    }

    function hasRankings(week) {
        return getRankings(week).length > 0;
    }

    function getRankingCount(week) {
        return getRankings(week).length;
    }

    // ============================================================
    // RANKING MUTATIONS
    // ============================================================

    function setRankings(week, rankings) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!Array.isArray(rankings)) {
            return failure('Rankings must be an array.');
        }

        var validatedRankings = [];
        var seen = {};

        for (var i = 0; i < rankings.length; i++) {
            var r = rankings[i];

            if (!r || typeof r !== 'object') {
                return failure('Invalid ranking entry at index ' + i + '.');
            }

            if (!isNonEmptyString(r.studentId)) {
                return failure('Student ID is required at index ' + i + '.');
            }

            var rankNum = validateRank(r.rank);
            if (rankNum === null) {
                return failure('Valid rank is required at index ' + i + '.');
            }

            if (!isRankableStudent(r.studentId)) {
                return failure('Student not found or not rankable at index ' + i + '.');
            }

            var id = String(r.studentId);
            if (seen[id]) {
                return failure('Duplicate student ID: ' + id);
            }
            seen[id] = true;

            validatedRankings.push({
                studentId: id,
                rank: rankNum
            });
        }

        // Normalise ranks
        validatedRankings.sort(function(a, b) {
            return a.rank - b.rank;
        });

        for (var i = 0; i < validatedRankings.length; i++) {
            validatedRankings[i].rank = i + 1;
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        var candidate = deepClone(data.curriculum.rankings || {});
        if (candidate === null) {
            return failure('Failed to prepare ranking data.');
        }

        candidate[weekNum] = validatedRankings;

        data.curriculum.rankings = candidate;

        var count = validatedRankings.length;
        logActivity('Set rankings for week ' + weekNum + ' (' + count + ' students)');

        return successWithRankings(validatedRankings, 'set', count);
    }

    function updateStudentRank(week, studentId, newRank) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        if (!isRankableStudent(studentId)) {
            return failure('Student not found or not rankable.');
        }

        var rankNum = validateRank(newRank);
        if (rankNum === null) {
            return failure('Valid rank is required.');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        var candidate = deepClone(data.curriculum.rankings || {});
        if (candidate === null) {
            return failure('Failed to prepare ranking data.');
        }

        var rankings = candidate[weekNum] || [];

        var existingIndex = -1;
        var existingRank = null;

        for (var i = 0; i < rankings.length; i++) {
            if (String(rankings[i].studentId) === String(studentId)) {
                existingIndex = i;
                existingRank = rankings[i].rank;
                break;
            }
        }

        var studentName = getDisplayName(getCharacterCloneById(studentId));

        if (existingIndex === -1) {
            // Add new student
            var targetRank = Math.min(rankNum, rankings.length + 1);

            for (var i = 0; i < rankings.length; i++) {
                if (rankings[i].rank >= targetRank) {
                    rankings[i].rank++;
                }
            }

            rankings.push({
                studentId: String(studentId),
                rank: targetRank
            });

            rankings.sort(function(a, b) {
                return a.rank - b.rank;
            });

            for (var i = 0; i < rankings.length; i++) {
                rankings[i].rank = i + 1;
            }

            var addedCount = rankings.length;
            candidate[weekNum] = rankings;

            data.curriculum.rankings = candidate;

            logActivity('Added ' + studentName + ' to rankings at #' + targetRank + ' (week ' + weekNum + ')');
            return successWithRankings(rankings, 'added', addedCount);

        } else {
            // Update existing student
            var oldRank = existingRank;
            var effectiveTarget = Math.min(rankNum, rankings.length);

            if (oldRank === effectiveTarget) {
                return successWithRankings(rankings, 'unchanged', rankings.length);
            }

            rankings.splice(existingIndex, 1);

            rankings.sort(function(a, b) {
                return a.rank - b.rank;
            });

            for (var i = 0; i < rankings.length; i++) {
                rankings[i].rank = i + 1;
            }

            var targetRank2 = Math.min(effectiveTarget, rankings.length + 1);

            for (var i = 0; i < rankings.length; i++) {
                if (rankings[i].rank >= targetRank2) {
                    rankings[i].rank++;
                }
            }

            rankings.push({
                studentId: String(studentId),
                rank: targetRank2
            });

            rankings.sort(function(a, b) {
                return a.rank - b.rank;
            });

            for (var i = 0; i < rankings.length; i++) {
                rankings[i].rank = i + 1;
            }

            candidate[weekNum] = rankings;

            data.curriculum.rankings = candidate;

            logActivity('Moved ' + studentName + ' from #' + oldRank + ' to #' + targetRank2 + ' (week ' + weekNum + ')');
            return successWithRankings(rankings, 'updated', rankings.length);
        }
    }

    function removeStudentFromRankings(week, studentId) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        var candidate = deepClone(data.curriculum.rankings || {});
        if (candidate === null) {
            return failure('Failed to prepare ranking data.');
        }

        var rankings = candidate[weekNum] || [];

        var exists = rankings.some(function(r) {
            return String(r.studentId) === String(studentId);
        });

        if (!exists) {
            return successWithRankings(rankings, 'unchanged', rankings.length);
        }

        rankings = rankings.filter(function(r) {
            return String(r.studentId) !== String(studentId);
        });

        rankings.sort(function(a, b) {
            return a.rank - b.rank;
        });

        for (var i = 0; i < rankings.length; i++) {
            rankings[i].rank = i + 1;
        }

        if (rankings.length === 0) {
            delete candidate[weekNum];
        } else {
            candidate[weekNum] = rankings;
        }

        data.curriculum.rankings = candidate;

        var char = getCharacterCloneById(studentId);
        var charName = char ? getDisplayName(char) : 'Unknown';
        logActivity('Removed ' + charName + ' from rankings for week ' + weekNum);

        return successWithRankings(rankings, 'removed', rankings.length);
    }

    // ============================================================
    // AUTO-GENERATE RANKINGS
    // ============================================================

    function calculateGradeSummary(studentId, week) {
        if (typeof window.GradeCore !== 'undefined' &&
            typeof window.GradeCore.calculateGradeSummary === 'function') {
            return window.GradeCore.calculateGradeSummary(studentId, week);
        }

        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return null;
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.grades) {
            return null;
        }

        var grades = data.curriculum.grades[studentId] && data.curriculum.grades[studentId][weekNum]
            ? data.curriculum.grades[studentId][weekNum]
            : {};

        var hasGrades = false;
        var totalWeighted = 0;
        var totalWeight = 0;

        for (var discId in grades) {
            if (!Object.prototype.hasOwnProperty.call(grades, discId)) {
                continue;
            }
            var score = grades[discId];
            if (score !== undefined && score !== null && score !== '') {
                var numericScore = Number(score);
                if (isFinite(numericScore) && numericScore >= 0 && numericScore <= 100) {
                    var discipline = getDiscipline(discId);
                    var weight = discipline && discipline.weight ? Number(discipline.weight) : 1;
                    if (isFinite(weight) && weight > 0) {
                        totalWeighted += numericScore * weight;
                        totalWeight += weight;
                        hasGrades = true;
                    }
                }
            }
        }

        var average = totalWeight > 0 ? totalWeighted / totalWeight : 0;

        return {
            average: average,
            hasGrades: hasGrades,
            gradedWeightedCount: totalWeight > 0 ? 1 : 0
        };
    }

    function getDiscipline(id) {
        if (typeof window.getDiscipline === 'function') {
            return window.getDiscipline(id);
        }
        var data = getDataStore();
        if (!data || !data.curriculum || !Array.isArray(data.curriculum.disciplines)) {
            return null;
        }
        var discipline = data.curriculum.disciplines.find(function(d) {
            return d && String(d.id) === String(id);
        });
        return discipline ? deepClone(discipline) : null;
    }

    function isAutoRankable(studentId, week) {
        if (!isRankableStudent(studentId)) {
            return false;
        }

        var summary = calculateGradeSummary(studentId, week);
        return summary && summary.hasGrades && summary.gradedWeightedCount > 0 && isFinite(summary.average);
    }

    function autoGenerateRankings(week) {
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var students = getStudents();
        if (!Array.isArray(students) || students.length === 0) {
            return failure('No students found.');
        }

        var studentAverages = [];

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            if (isAutoRankable(student.id, weekNum)) {
                var summary = calculateGradeSummary(student.id, weekNum);
                var avg = Number(summary.average);
                if (isFinite(avg)) {
                    studentAverages.push({
                        studentId: student.id,
                        average: avg
                    });
                }
            }
        }

        if (studentAverages.length === 0) {
            return failure('No students with valid weighted grades found.');
        }

        studentAverages.sort(function(a, b) {
            if (b.average !== a.average) {
                return b.average - a.average;
            }

            var charA = getCharacterCloneById(a.studentId);
            var charB = getCharacterCloneById(b.studentId);
            var nameA = charA ? getDisplayName(charA) : '';
            var nameB = charB ? getDisplayName(charB) : '';

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

        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        var candidate = deepClone(data.curriculum.rankings || {});
        if (candidate === null) {
            return failure('Failed to prepare ranking data.');
        }

        candidate[weekNum] = newRankings;

        data.curriculum.rankings = candidate;

        var gradedCount = studentAverages.length;
        var totalStudents = students.length;

        logActivity('Auto-generated rankings for week ' + weekNum +
            ' (' + gradedCount + ' of ' + totalStudents + ' students ranked)');

        return successWithRankings(
            newRankings,
            'auto_generated',
            gradedCount
        );
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    // Queries
    window.getRankings = getRankings;
    window.getStudentRank = getStudentRank;
    window.hasRankings = hasRankings;
    window.getRankingCount = getRankingCount;

    // Mutations
    window.setRankings = setRankings;
    window.updateStudentRank = updateStudentRank;
    window.removeStudentFromRankings = removeStudentFromRankings;
    window.autoGenerateRankings = autoGenerateRankings;

    // Grade summary (used by ranking)
    window.calculateGradeSummary = calculateGradeSummary;

})();
