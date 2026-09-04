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
 *   - All MUTATION operations return { success: boolean, message?: string, data?: any }
 *   - Query/helper functions return their documented value types
 *   - Invalid inputs are REJECTED (operation returns { success: false })
 *   - Validation occurs BEFORE mutation (candidate-based approach)
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - Query results are DEEP CLONED to prevent external mutation
 *   - Character objects returned in query results are also cloned
 * 
 * MUTATION INVARIANT:
 *   - All mutations use candidate-based validation:
 *     1. Validate inputs
 *     2. Build candidate state (deep clone)
 *     3. Apply validated changes to candidate
 *     4. Apply candidate to data store (replace, not mutate)
 *     5. If any step fails, return error WITHOUT mutating
 *   - No mutation of live state occurs before candidate validation completes
 *   - If curriculum structure is missing, the operation fails rather than repairing
 * 
 * RANKING SEMANTICS:
 *   - Rankings are stored as: rankings[week] = [{ studentId, rank }]
 *   - Ranks are 1-indexed (1 = highest)
 *   - Ranks are automatically normalised (no gaps) during mutations
 *   - Query results return stored data as-is (no silent repair)
 *   - Mutation operations normalise rankings before storage
 *   - Auto-rank generates rankings from grade averages
 *   - Only students with valid weighted grades are auto-rankable
 *   - Manual ranking accepts any rankable student (regardless of grades)
 *   - When updating a rank, other ranks shift to maintain continuity
 *   - Ranking order is authoritative (manual overrides auto-generated)
 *   - Adding a previously unranked student inserts them at the requested position
 *   - Student IDs are validated against current students (isRankableStudent)
 *   - Grade averages are validated to prevent NaN contamination
 * 
 * RANKING ELIGIBILITY:
 *   - rankable: Character is a current student (eligible for manual ranking)
 *   - auto-rankable: Character is a current student with valid weighted grades in that week
 * 
 * RANKING STATUS SEMANTICS:
 *   - 'new': Student was not ranked in previous week
 *   - 'removed': Student was ranked in previous week but not current
 *   - 'changed': Student has a rank in both weeks with different values
 *   - 'unchanged': Student has same rank in both weeks
 * 
 * VALIDATION SEMANTICS:
 *   - validateRankings() checks structural validity (entries, uniqueness, rankable students)
 *   - Does NOT check rank continuity (gaps/duplicates) - this is a structural check only
 *   - For normalised ranking data, use mutation operations which guarantee normalisation
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__rankingCoreLoaded) {
        return;
    }
    window.__rankingCoreLoaded = true;

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

    /**
     * Get a character by ID.
     * Returns a CLONE to prevent external mutation.
     */
    function getCharacterCloneById(id) {
        if (!isNonEmptyString(id)) return null;

        var char;

        if (typeof window.getCharacterById === 'function') {
            char = window.getCharacterById(id);
        } else {
            var data = getDataStore();
            if (!data || !Array.isArray(data.characters)) return null;
            char = data.characters.find(function(c) {
                return c && String(c.id) === String(id);
            }) || null;
        }

        if (!char) return null;
        return deepClone(char);
    }

    function getDisplayName(char) {
        if (!char) return 'Unknown';
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
            return typeof status === 'string' ? status.toLowerCase() : '';
        }
        return '';
    }

    /**
     * Calculate grade summary. PREFERS GradeCore as the authoritative source.
     * Fallback only used if GradeCore is unavailable (legacy/transitional).
     */
    function calculateGradeSummary(studentId, week) {
        // Prefer GradeCore as the authoritative source
        if (window.GradeCore &&
            typeof window.GradeCore.calculateGradeSummary === 'function') {
            return window.GradeCore.calculateGradeSummary(studentId, week);
        }

        // Fallback only if GradeCore is unavailable
        var weekNum = validateWeek(week);
        if (weekNum === null) return null;

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
            if (!Object.prototype.hasOwnProperty.call(grades, discId)) continue;
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

    /**
     * Get a discipline. PREFERS DisciplineCore as the authoritative source.
     */
    function getDiscipline(id) {
        if (!isNonEmptyString(id)) return null;

        // Prefer DisciplineCore
        if (window.DisciplineCore &&
            typeof window.DisciplineCore.getDiscipline === 'function') {
            return window.DisciplineCore.getDiscipline(id);
        }

        // Legacy fallback
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

    function validateWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 52 ? num : null;
    }

    function validateRank(value) {
        var num = parsePositiveInteger(value);
        return num !== null ? num : null;
    }

    /**
     * Check if a student is rankable (eligible for manual ranking).
     * Manual ranking accepts any current student regardless of grades.
     * Auto-ranking uses a separate check for valid weighted grades.
     */
    function isRankableStudent(studentId) {
        if (!isNonEmptyString(studentId)) return false;

        var char = getCharacterCloneById(studentId);
        if (!char) return false;

        // Must be a current student (not deceased, not instructor, etc.)
        var students = getStudents();
        return students.some(function(student) {
            return String(student.id) === String(studentId);
        });
    }

    /**
     * Check if a student is auto-rankable (has valid weighted grades for a week).
     */
    function isAutoRankable(studentId, week) {
        if (!isRankableStudent(studentId)) return false;

        var summary = calculateGradeSummary(studentId, week);
        return summary &&
            summary.hasGrades &&
            summary.gradedWeightedCount > 0 &&
            isFinite(summary.average);
    }

    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }

        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                console.error('RankingCore: structuredClone failed:', e);
                return null;
            }
        }

        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('RankingCore: JSON clone failed:', e);
            return null;
        }
    }

    // ============================================================
    // RESULT HELPERS
    // ============================================================

    function failure(message) {
        return {
            success: false,
            message: message
        };
    }

    function success(data) {
        return {
            success: true,
            data: data
        };
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
    // RANKING QUERIES (with deep cloning for safety)
    // ============================================================

    /**
     * Get rankings for a week. Returns stored data as-is (no silent repair).
     * Normalisation is guaranteed during mutation operations, not during queries.
     */
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

        // Deep clone to prevent external mutation
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

    function getRankedStudents(week) {
        var rankings = getRankings(week);
        var result = [];

        for (var i = 0; i < rankings.length; i++) {
            var r = rankings[i];
            var char = getCharacterCloneById(r.studentId);
            if (char) {
                result.push({
                    studentId: r.studentId,
                    rank: r.rank,
                    name: getDisplayName(char),
                    character: char  // Already cloned by getCharacterCloneById
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

        // Students in current ranking
        toRankings.forEach(function(toR) {
            var fromR = fromRankings.find(function(r) {
                return String(r.studentId) === String(toR.studentId);
            });

            var changeType = fromR ? 'changed' : 'new';
            var change = fromR ? fromR.rank - toR.rank : null;
            var fromRank = fromR ? fromR.rank : null;

            if (fromR && fromR.rank === toR.rank) {
                changeType = 'unchanged';
            }

            result.push({
                studentId: toR.studentId,
                fromRank: fromRank,
                toRank: toR.rank,
                change: change,
                changeType: changeType
            });
        });

        // Students who were ranked before but not now
        fromRankings.forEach(function(fromR) {
            var exists = toRankings.some(function(r) {
                return String(r.studentId) === String(fromR.studentId);
            });
            if (!exists) {
                result.push({
                    studentId: fromR.studentId,
                    fromRank: fromR.rank,
                    toRank: null,
                    change: null,
                    changeType: 'removed'
                });
            }
        });

        return result;
    }

    // ============================================================
    // RANKING MUTATIONS (candidate-based, no live mutation)
    // ============================================================

    function setRankings(week, rankings) {
        // ---- PHASE 1: VALIDATE ----
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!Array.isArray(rankings)) {
            return failure('Rankings must be an array.');
        }

        // ---- PHASE 2: VALIDATE EACH ENTRY ----
        var validatedRankings = [];
        var seen = new Set();

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
            if (seen.has(id)) {
                return failure('Duplicate student ID: ' + id);
            }
            seen.add(id);

            validatedRankings.push({
                studentId: id,
                rank: rankNum
            });
        }

        // ---- PHASE 3: NORMALISE RANKS ----
        // Ranks are treated as ordering positions, not explicit rank values
        validatedRankings.sort(function(a, b) {
            return a.rank - b.rank;
        });

        validatedRankings.forEach(function(r, index) {
            r.rank = index + 1;
        });

        // ---- PHASE 4: GET CURRENT STATE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 5: BUILD CANDIDATE ----
        var candidate = deepClone(data.curriculum.rankings || {});
        if (candidate === null) {
            return failure('Failed to prepare ranking data.');
        }

        candidate[weekNum] = validatedRankings;

        // ---- PHASE 6: APPLY ----
        data.curriculum.rankings = candidate;

        var count = validatedRankings.length;
        logActivity('Set rankings for week ' + weekNum + ' (' + count + ' students)');

        return successWithRankings(validatedRankings, 'set', count);
    }

    function updateStudentRank(week, studentId, newRank) {
        // ---- PHASE 1: VALIDATE ----
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

        // ---- PHASE 2: GET CURRENT STATE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
        var candidate = deepClone(data.curriculum.rankings || {});
        if (candidate === null) {
            return failure('Failed to prepare ranking data.');
        }

        var rankings = candidate[weekNum] || [];

        // ---- PHASE 4: FIND OR CREATE ENTRY ----
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
            // ---- PHASE 4A: ADD NEW STUDENT ----
            // Clamp rank to valid insertion range
            var targetRank = Math.min(rankNum, rankings.length + 1);

            // Shift existing ranks down
            for (var i = 0; i < rankings.length; i++) {
                if (rankings[i].rank >= targetRank) {
                    rankings[i].rank++;
                }
            }

            rankings.push({
                studentId: String(studentId),
                rank: targetRank
            });

            // Normalise
            rankings.sort(function(a, b) {
                return a.rank - b.rank;
            });

            rankings.forEach(function(r, index) {
                r.rank = index + 1;
            });

            var addedCount = rankings.length;
            candidate[weekNum] = rankings;

            // ---- PHASE 5: APPLY ----
            data.curriculum.rankings = candidate;

            logActivity('Added ' + studentName + ' to rankings at #' + targetRank + ' (week ' + weekNum + ')');
            return successWithRankings(rankings, 'added', addedCount);

        } else {
            // ---- PHASE 4B: UPDATE EXISTING STUDENT ----
            var oldRank = existingRank;

            // Calculate effective target position (clamped)
            var effectiveTarget = Math.min(rankNum, rankings.length);

            // If effective position hasn't changed, return early (no state mutation)
            if (oldRank === effectiveTarget) {
                return successWithRankings(rankings, 'unchanged', rankings.length);
            }

            // Remove student from rankings
            rankings.splice(existingIndex, 1);

            // Recalculate ranks
            rankings.sort(function(a, b) {
                return a.rank - b.rank;
            });

            rankings.forEach(function(r, index) {
                r.rank = index + 1;
            });

            // Clamp target rank
            var targetRank = Math.min(effectiveTarget, rankings.length + 1);

            // Shift ranks down at insertion point
            for (var i = 0; i < rankings.length; i++) {
                if (rankings[i].rank >= targetRank) {
                    rankings[i].rank++;
                }
            }

            // Insert student at target position
            rankings.push({
                studentId: String(studentId),
                rank: targetRank
            });

            // Final normalisation
            rankings.sort(function(a, b) {
                return a.rank - b.rank;
            });

            rankings.forEach(function(r, index) {
                r.rank = index + 1;
            });

            candidate[weekNum] = rankings;

            // ---- PHASE 5: APPLY ----
            data.curriculum.rankings = candidate;

            logActivity('Moved ' + studentName + ' from #' + oldRank + ' to #' + targetRank + ' (week ' + weekNum + ')');
            return successWithRankings(rankings, 'updated', rankings.length);
        }
    }

    function removeStudentFromRankings(week, studentId) {
        // ---- PHASE 1: VALIDATE ----
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        // ---- PHASE 2: GET CURRENT STATE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 3: BUILD CANDIDATE ----
        var candidate = deepClone(data.curriculum.rankings || {});
        if (candidate === null) {
            return failure('Failed to prepare ranking data.');
        }

        var rankings = candidate[weekNum] || [];

        // Check if student exists
        var exists = rankings.some(function(r) {
            return String(r.studentId) === String(studentId);
        });

        if (!exists) {
            return successWithRankings(rankings, 'unchanged', rankings.length);
        }

        // Remove student
        rankings = rankings.filter(function(r) {
            return String(r.studentId) !== String(studentId);
        });

        // Normalise
        rankings.sort(function(a, b) {
            return a.rank - b.rank;
        });

        rankings.forEach(function(r, index) {
            r.rank = index + 1;
        });

        if (rankings.length === 0) {
            delete candidate[weekNum];
        } else {
            candidate[weekNum] = rankings;
        }

        // ---- PHASE 4: APPLY ----
        data.curriculum.rankings = candidate;

        var char = getCharacterCloneById(studentId);
        var charName = char ? getDisplayName(char) : 'Unknown';
        logActivity('Removed ' + charName + ' from rankings for week ' + weekNum);

        return successWithRankings(rankings, 'removed', rankings.length);
    }

    // ============================================================
    // AUTO-GENERATE RANKINGS
    // ============================================================

    function autoGenerateRankings(week) {
        // ---- PHASE 1: VALIDATE ----
        var weekNum = validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        // ---- PHASE 2: GET STUDENTS AND GRADES ----
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

        // ---- PHASE 3: SORT BY AVERAGE ----
        studentAverages.sort(function(a, b) {
            // Descending order (higher average = higher rank)
            if (b.average !== a.average) {
                return b.average - a.average;
            }

            // Tie-breaker: alphabetical by name, then by ID
            var charA = getCharacterCloneById(a.studentId);
            var charB = getCharacterCloneById(b.studentId);
            var nameA = charA ? getDisplayName(charA) : '';
            var nameB = charB ? getDisplayName(charB) : '';

            var nameComparison = nameA.localeCompare(nameB);
            if (nameComparison !== 0) return nameComparison;

            return String(a.studentId).localeCompare(String(b.studentId));
        });

        // ---- PHASE 4: BUILD RANKINGS ----
        var newRankings = [];
        for (var i = 0; i < studentAverages.length; i++) {
            newRankings.push({
                studentId: studentAverages[i].studentId,
                rank: i + 1
            });
        }

        // ---- PHASE 5: GET CURRENT STATE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        if (!data.curriculum || typeof data.curriculum !== 'object') {
            return failure('Curriculum data is not available.');
        }

        // ---- PHASE 6: BUILD CANDIDATE ----
        var candidate = deepClone(data.curriculum.rankings || {});
        if (candidate === null) {
            return failure('Failed to prepare ranking data.');
        }

        candidate[weekNum] = newRankings;

        // ---- PHASE 7: APPLY ----
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
    // RANKING COMPARISON HELPERS
    // ============================================================

    function getTopRanked(week, limit) {
        var rankings = getRankings(week);
        limit = limit || 10;

        var result = [];
        for (var i = 0; i < Math.min(rankings.length, limit); i++) {
            var r = rankings[i];
            var char = getCharacterCloneById(r.studentId);
            if (char) {
                result.push({
                    studentId: r.studentId,
                    rank: r.rank,
                    name: getDisplayName(char),
                    character: char  // Already cloned
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
            var char = getCharacterCloneById(r.studentId);
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

        if (!isRankableStudent(entry.studentId)) return false;

        return true;
    }

    /**
     * Validate ranking entries structurally.
     * Checks: array, valid entries, unique student IDs, rankable students.
     * Does NOT check rank continuity (gaps/duplicates) - this is a structural check only.
     * For normalised ranking data, use mutation operations which guarantee normalisation.
     */
    function validateRankings(rankings) {
        if (!Array.isArray(rankings)) {
            return failure('Rankings must be an array.');
        }

        var seen = new Set();

        for (var i = 0; i < rankings.length; i++) {
            if (!isValidRankingEntry(rankings[i])) {
                return failure('Invalid ranking entry at index ' + i + '.');
            }

            var id = String(rankings[i].studentId);
            if (seen.has(id)) {
                return failure('Duplicate student ID: ' + id);
            }
            seen.add(id);
        }

        return success(null);
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
        validateRankings: validateRankings,
        isRankableStudent: isRankableStudent,
        isAutoRankable: isAutoRankable,

        // Constants
        SUCCESS: success,
        FAILURE: failure
    };

})();
