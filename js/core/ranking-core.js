/**
 * core/ranking-core.js - Ranking Core Operations
 * Single source of truth for all ranking-related data mutations
 * Path: js/core/ranking-core.js
 * 
 * This module handles:
 *   - Ranking CRUD (get, set, update)
 *   - Auto-generation of rankings from grade data
 *   - Rank shifting and normalisation
 *   - Ranking queries by week and student
 *   - Rank change tracking between weeks
 * 
 * IMPORTANT:
 *   - All functions return { success: boolean, message?: string, data?: any }
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 * 
 * PERSISTENCE CONTRACT:
 *   - Mutations are applied to window.data in memory
 *   - Caller is responsible for saveData() persistence
 *   - No rollback is provided after mutation begins
 * 
 * RANKING SEMANTICS:
 *   - Rankings are stored as: rankings[week] = [{ studentId, rank }]
 *   - Ranks are 1-indexed (1 = highest)
 *   - Ranks are automatically normalised (no gaps)
 *   - Auto-rank generates rankings from grade averages
 *   - Only students with grades are ranked (ungraded students excluded)
 *   - When updating a rank, other ranks shift to maintain continuity
 *   - Ranking order is authoritative (manual overrides auto-generated)
 */

(function() {
    'use strict';

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
            return status.toLowerCase();
        }
        return '';
    }

    function calculateGradeSummary(studentId, week) {
        if (typeof window.calculateGradeSummary === 'function') {
            return window.calculateGradeSummary(studentId, week);
        }

        // Fallback: minimal implementation
        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.grades) {
            return null;
        }

        var grades = data.curriculum.grades[studentId] && data.curriculum.grades[studentId][week]
            ? data.curriculum.grades[studentId][week]
            : {};

        var hasGrades = false;
        var totalWeighted = 0;
        var totalWeight = 0;

        for (var discId in grades) {
            if (!Object.prototype.hasOwnProperty.call(grades, discId)) continue;
            var score = grades[discId];
            if (score !== undefined && score !== null && score !== '') {
                var discipline = getDiscipline(discId);
                var weight = discipline && discipline.weight ? Number(discipline.weight) : 1;
                totalWeighted += Number(score) * weight;
                totalWeight += weight;
                hasGrades = true;
            }
        }

        var average = totalWeight > 0 ? totalWeighted / totalWeight : 0;

        return {
            average: average,
            hasGrades: hasGrades
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
        return data.curriculum.disciplines.find(function(d) {
            return d && String(d.id) === String(id);
        }) || null;
    }

    function validateWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 52 ? num : null;
    }

    function validateRank(value) {
        var num = parsePositiveInteger(value);
        return num !== null ? num : null;
    }

    function ensureRankingStructure() {
        var data = getDataStore();
        if (!data) return null;

        if (!data.curriculum || typeof data.curriculum !== 'object' || Array.isArray(data.curriculum)) {
            data.curriculum = {};
        }

        if (!data.curriculum.rankings || typeof data.curriculum.rankings !== 'object') {
            data.curriculum.rankings = {};
        }

        return data;
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

        if (data.curriculum.rankings[weekNum]) {
            return data.curriculum.rankings[weekNum].slice();
        }

        return [];
    }

    function getStudentRank(week, studentId) {
        var rankings = getRankings(week);
        var entry = rankings.find(function(r) {
            return r && String(r.studentId) === String(studentId);
        });
        return entry ? entry.rank : null;
    }

    function getRankedStudents(week) {
        var rankings = getRankings(week);
        var result = [];

        for (var i = 0; i < rankings.length; i++) {
            var r = rankings[i];
            var char = getCharacterById(r.studentId);
            if (char) {
                result.push({
                    studentId: r.studentId,
                    rank: r.rank,
                    name: getDisplayName(char),
                    character: char
                });
            }
        }

        return result;
    }

    function getRankingCount(week) {
        return getRankings(week).length;
    }

    function hasRankings(week) {
        return getRankingCount(week) > 0;
    }

    function getRankChanges(fromWeek, toWeek) {
        var fromRankings = getRankings(fromWeek);
        var toRankings = getRankings(toWeek);

        var result = [];

        toRankings.forEach(function(toR) {
            var fromR = fromRankings.find(function(r) {
                return String(r.studentId) === String(toR.studentId);
            });

            var change = null;
            if (fromR) {
                change = fromR.rank - toR.rank;
            }

            result.push({
                studentId: toR.studentId,
                fromRank: fromR ? fromR.rank : null,
                toRank: toR.rank,
                change: change
            });
        });

        // Also include students who were ranked before but not now
        fromRankings.forEach(function(fromR) {
            var exists = toRankings.some(function(r) {
                return String(r.studentId) === String(fromR.studentId);
            });
            if (!exists) {
                result.push({
                    studentId: fromR.studentId,
                    fromRank: fromR.rank,
                    toRank: null,
                    change: null
                });
            }
        });

        return result;
    }

    // ============================================================
    // RANKING MUTATIONS
    // ============================================================

    function setRankings(week, rankings) {
        // ---- PHASE 1: VALIDATE ----
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        if (!Array.isArray(rankings)) {
            return { success: false, message: 'Rankings must be an array.' };
        }

        // ---- PHASE 2: VALIDATE EACH ENTRY ----
        var validatedRankings = [];

        for (var i = 0; i < rankings.length; i++) {
            var r = rankings[i];
            if (!r || typeof r !== 'object') {
                return { success: false, message: 'Invalid ranking entry at index ' + i + '.' };
            }

            if (!isNonEmptyString(r.studentId)) {
                return { success: false, message: 'Student ID is required at index ' + i + '.' };
            }

            var rankNum = validateRank(r.rank);
            if (rankNum === null) {
                return { success: false, message: 'Valid rank is required at index ' + i + '.' };
            }

            var char = getCharacterById(r.studentId);
            if (!char) {
                return { success: false, message: 'Student not found at index ' + i + '.' };
            }

            validatedRankings.push({
                studentId: String(r.studentId),
                rank: rankNum
            });
        }

        // ---- PHASE 3: CHECK FOR DUPLICATES ----
        var seen = {};
        for (var i = 0; i < validatedRankings.length; i++) {
            var id = validatedRankings[i].studentId;
            if (seen[id]) {
                return { success: false, message: 'Duplicate student ID: ' + id };
            }
            seen[id] = true;
        }

        // ---- PHASE 4: NORMALISE RANKS ----
        validatedRankings.sort(function(a, b) {
            return a.rank - b.rank;
        });

        validatedRankings.forEach(function(r, index) {
            r.rank = index + 1;
        });

        // ---- PHASE 5: APPLY ----
        var store = ensureRankingStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        store.curriculum.rankings[weekNum] = validatedRankings;

        var count = validatedRankings.length;
        logActivity('Set rankings for week ' + weekNum + ' (' + count + ' students)');

        return { success: true, rankings: validatedRankings, count: count };
    }

    function updateStudentRank(week, studentId, newRank) {
        // ---- PHASE 1: VALIDATE ----
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

        var char = getCharacterById(studentId);
        if (!char) {
            return { success: false, message: 'Student not found.' };
        }

        // ---- PHASE 2: RETRIEVE ----
        var store = ensureRankingStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        var rankings = store.curriculum.rankings[weekNum] || [];

        // ---- PHASE 3: FIND OR CREATE ----
        var existingIndex = -1;
        var existingRank = null;

        for (var i = 0; i < rankings.length; i++) {
            if (String(rankings[i].studentId) === String(studentId)) {
                existingIndex = i;
                existingRank = rankings[i].rank;
                break;
            }
        }

        // If student not in rankings, add them
        if (existingIndex === -1) {
            rankings.push({
                studentId: String(studentId),
                rank: rankNum
            });
        } else {
            var oldRank = existingRank;

            // If rank hasn't changed, return success
            if (oldRank === rankNum) {
                return { success: true, rankings: rankings };
            }

            // Shift ranks
            if (oldRank < rankNum) {
                // Moving down: shift intervening ranks up
                for (var i = 0; i < rankings.length; i++) {
                    var r = rankings[i];
                    if (String(r.studentId) !== String(studentId) &&
                        r.rank > oldRank && r.rank <= rankNum) {
                        r.rank--;
                    }
                }
            } else {
                // Moving up: shift intervening ranks down
                for (var i = 0; i < rankings.length; i++) {
                    var r = rankings[i];
                    if (String(r.studentId) !== String(studentId) &&
                        r.rank >= rankNum && r.rank < oldRank) {
                        r.rank++;
                    }
                }
            }

            rankings[existingIndex].rank = rankNum;
        }

        // ---- PHASE 4: NORMALISE ----
        rankings.sort(function(a, b) {
            return a.rank - b.rank;
        });

        rankings.forEach(function(r, index) {
            r.rank = index + 1;
        });

        // ---- PHASE 5: APPLY ----
        store.curriculum.rankings[weekNum] = rankings;

        var charName = getDisplayName(char);
        logActivity('Updated rank for ' + charName + ' to #' + rankNum + ' in week ' + weekNum);

        return { success: true, rankings: rankings };
    }

    function removeStudentFromRankings(week, studentId) {
        // ---- PHASE 1: VALIDATE ----
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        if (!isNonEmptyString(studentId)) {
            return { success: false, message: 'Student ID is required.' };
        }

        // ---- PHASE 2: RETRIEVE ----
        var store = ensureRankingStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        var rankings = store.curriculum.rankings[weekNum] || [];

        // Check if student exists
        var exists = rankings.some(function(r) {
            return String(r.studentId) === String(studentId);
        });

        if (!exists) {
            return { success: false, message: 'Student not found in rankings.' };
        }

        // ---- PHASE 3: REMOVE AND NORMALISE ----
        rankings = rankings.filter(function(r) {
            return String(r.studentId) !== String(studentId);
        });

        rankings.sort(function(a, b) {
            return a.rank - b.rank;
        });

        rankings.forEach(function(r, index) {
            r.rank = index + 1;
        });

        // ---- PHASE 4: APPLY ----
        if (rankings.length === 0) {
            delete store.curriculum.rankings[weekNum];
        } else {
            store.curriculum.rankings[weekNum] = rankings;
        }

        var char = getCharacterById(studentId);
        var charName = char ? getDisplayName(char) : 'Unknown';
        logActivity('Removed ' + charName + ' from rankings for week ' + weekNum);

        return { success: true, rankings: rankings };
    }

    // ============================================================
    // AUTO-GENERATE RANKINGS
    // ============================================================

    function autoGenerateRankings(week) {
        // ---- PHASE 1: VALIDATE ----
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return { success: false, message: 'Valid week is required (1-52).' };
        }

        // ---- PHASE 2: GET STUDENTS AND GRADES ----
        var students = getStudents();
        if (!Array.isArray(students) || students.length === 0) {
            return { success: false, message: 'No students found.' };
        }

        var studentAverages = [];

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            var summary = calculateGradeSummary(student.id, weekNum);

            if (summary && summary.hasGrades) {
                studentAverages.push({
                    studentId: student.id,
                    average: summary.average
                });
            }
        }

        if (studentAverages.length === 0) {
            return { success: false, message: 'No students with grades found.' };
        }

        // ---- PHASE 3: SORT BY AVERAGE ----
        studentAverages.sort(function(a, b) {
            // Descending order (higher average = higher rank)
            if (b.average !== a.average) {
                return b.average - a.average;
            }

            // Tie-breaker: alphabetical by name
            var charA = getCharacterById(a.studentId);
            var charB = getCharacterById(b.studentId);
            var nameA = charA ? getDisplayName(charA) : '';
            var nameB = charB ? getDisplayName(charB) : '';
            return nameA.localeCompare(nameB);
        });

        // ---- PHASE 4: BUILD RANKINGS ----
        var newRankings = [];
        for (var i = 0; i < studentAverages.length; i++) {
            newRankings.push({
                studentId: studentAverages[i].studentId,
                rank: i + 1
            });
        }

        // ---- PHASE 5: APPLY ----
        var store = ensureRankingStructure();
        if (!store) {
            return { success: false, message: 'Data store is not available.' };
        }

        store.curriculum.rankings[weekNum] = newRankings;

        var gradedCount = studentAverages.length;
        var totalStudents = students.length;

        logActivity('Auto-generated rankings for week ' + weekNum +
            ' (' + gradedCount + ' of ' + totalStudents + ' students ranked)');

        return {
            success: true,
            count: gradedCount,
            total: totalStudents,
            rankings: newRankings
        };
    }

    // ============================================================
    // RANKING COMPARISON HELPERS
    // ============================================================

    function getTopRanked(week, limit) {
        var rankings = getRankings(week);
        limit = limit || 10;

        var result = [];
        for (var i = 0; i < Math.min(rankings.length, limit); i++) {
            var r = rankings[i];
            var char = getCharacterById(r.studentId);
            if (char) {
                result.push({
                    studentId: r.studentId,
                    rank: r.rank,
                    name: getDisplayName(char),
                    character: char
                });
            }
        }

        return result;
    }

    function getRankingDistribution(week) {
        var rankings = getRankings(week);
        var distribution = {
            top: [],      // Rank 1-3
            middle: [],   // Rank 4-10
            rest: []      // Rank 11+
        };

        for (var i = 0; i < rankings.length; i++) {
            var r = rankings[i];
            var char = getCharacterById(r.studentId);
            if (!char) continue;

            var entry = {
                studentId: r.studentId,
                rank: r.rank,
                name: getDisplayName(char)
            };

            if (r.rank <= 3) {
                distribution.top.push(entry);
            } else if (r.rank <= 10) {
                distribution.middle.push(entry);
            } else {
                distribution.rest.push(entry);
            }
        }

        return distribution;
    }

    function getRankingStats(week) {
        var rankings = getRankings(week);
        var total = rankings.length;

        if (total === 0) {
            return {
                total: 0,
                top3: 0,
                top10: 0,
                bottom: 0
            };
        }

        var top3 = Math.min(3, total);
        var top10 = Math.min(10, total);
        var bottom = Math.max(0, total - 10);

        return {
            total: total,
            top3: top3,
            top10: top10,
            bottom: bottom
        };
    }

    // ============================================================
    // VALIDATION HELPERS
    // ============================================================

    function isValidRankingEntry(entry) {
        if (!entry || typeof entry !== 'object') return false;
        if (!isNonEmptyString(entry.studentId)) return false;

        var rankNum = validateRank(entry.rank);
        if (rankNum === null) return false;

        var char = getCharacterById(entry.studentId);
        if (!char) return false;

        return true;
    }

    function validateRankings(rankings) {
        if (!Array.isArray(rankings)) {
            return { valid: false, message: 'Rankings must be an array.' };
        }

        for (var i = 0; i < rankings.length; i++) {
            if (!isValidRankingEntry(rankings[i])) {
                return { valid: false, message: 'Invalid ranking entry at index ' + i + '.' };
            }
        }

        // Check for duplicate student IDs
        var seen = {};
        for (var i = 0; i < rankings.length; i++) {
            var id = rankings[i].studentId;
            if (seen[id]) {
                return { valid: false, message: 'Duplicate student ID: ' + id };
            }
            seen[id] = true;
        }

        return { valid: true };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.RankingCore = {
        // Queries
        getRankings: getRankings,
        getStudentRank: getStudentRank,
        getRankedStudents: getRankedStudents,
        getRankingCount: getRankingCount,
        hasRankings: hasRankings,
        getRankChanges: getRankChanges,

        // Mutations
        setRankings: setRankings,
        updateStudentRank: updateStudentRank,
        removeStudentFromRankings: removeStudentFromRankings,
        autoGenerateRankings: autoGenerateRankings,

        // Comparison
        getTopRanked: getTopRanked,
        getRankingDistribution: getRankingDistribution,
        getRankingStats: getRankingStats,

        // Validation
        isValidRankingEntry: isValidRankingEntry,
        validateRankings: validateRankings
    };

})();
