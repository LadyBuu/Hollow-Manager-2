/**
 * js/core/curriculum/curriculum-ranking.js - Ranking Operations
 * Path: js/core/curriculum/curriculum-ranking.js
 * 
 * This module provides ranking CRUD and auto-generation operations.
 * 
 * IMPORTANT:
 *   - Query functions return their documented shape directly
 *   - Mutation functions return:
 *     { success: true, rankings: Array, operation: string, count: number }
 *     or { success: false, message: string }
 *   - Validation occurs BEFORE mutation
 *   - This module does NOT call saveData() - callers own persistence
 *   - This module does NOT show UI - caller handles UX
 *   - Ranks are POSITIONAL: ranks are normalised to 1..N on every mutation
 *   - Input rank values are treated as desired positions, not absolute ranks
 *   - Equal input positions preserve input order (stable sort)
 *   - Grades are the authoritative source for auto-ranking
 *   - calculateGradeSummary() is imported from curriculum-grades.js
 *   - Shared validators are consumed from CurriculumValidators
 *   - No live state is mutated before validation and candidate preparation complete
 */

(function() {
    'use strict';

    // ============================================================
    // DEPENDENCY CHECK (BEFORE LOADING GUARD)
    // ============================================================

    var Validators = window.CurriculumValidators;

    if (!Validators) {
        console.error('[CurriculumRanking] CurriculumValidators not available.');
        return;
    }

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

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

    function getCharacterByIdSafe(id) {
        if (!isNonEmptyString(id)) {
            return null;
        }

        if (typeof window.getCharacterById === 'function') {
            return window.getCharacterById(id) || null;
        }

        var data = getDataStore();
        if (!data || !Array.isArray(data.characters)) {
            return null;
        }

        for (var i = 0; i < data.characters.length; i++) {
            var c = data.characters[i];
            if (c && String(c.id) === String(id)) {
                return c;
            }
        }

        return null;
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

        var char = getCharacterByIdSafe(studentId);
        if (!char) {
            return false;
        }

        var students = getStudents();
        for (var i = 0; i < students.length; i++) {
            if (String(students[i].id) === String(studentId)) {
                return true;
            }
        }
        return false;
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

    function cloneRankings(rankings) {
        if (!rankings || typeof rankings !== 'object') {
            return {};
        }
        return deepClone(rankings);
    }

    function getWeekRankingsStrict(rankings, weekNum) {
        if (!rankings || typeof rankings !== 'object' || Array.isArray(rankings)) {
            return { valid: false, message: 'Ranking store is corrupted.' };
        }

        var value = rankings[weekNum];

        if (value === undefined || value === null) {
            return { valid: true, rankings: [] };
        }

        if (!Array.isArray(value)) {
            return {
                valid: false,
                message: 'Ranking data for week ' + weekNum + ' is corrupted.'
            };
        }

        return {
            valid: true,
            rankings: value
        };
    }

    function validateStoredRankings(rankings) {
        if (!Array.isArray(rankings)) {
            return { success: false, message: 'Ranking data must be an array.' };
        }

        var seen = Object.create(null);

        for (var i = 0; i < rankings.length; i++) {
            var entry = rankings[i];

            if (!entry || typeof entry !== 'object') {
                return {
                    success: false,
                    message: 'Invalid stored ranking entry at index ' + i + '.'
                };
            }

            if (!isNonEmptyString(entry.studentId)) {
                return {
                    success: false,
                    message: 'Stored ranking entry at index ' + i + ' has no student ID.'
                };
            }

            if (Validators.validateRank(entry.rank) === null) {
                return {
                    success: false,
                    message: 'Invalid stored rank at index ' + i + '.'
                };
            }

            var id = String(entry.studentId);

            if (seen[id]) {
                return {
                    success: false,
                    message: 'Duplicate student ID in stored rankings: ' + id + '.'
                };
            }

            seen[id] = true;
        }

        return { success: true };
    }

    function prepareRankingsStore(data) {
        if (!data || !data.curriculum || typeof data.curriculum !== 'object') {
            return { success: false, message: 'Curriculum data is not available.' };
        }

        var existing = data.curriculum.rankings;

        if (existing !== undefined && existing !== null &&
            (typeof existing !== 'object' || Array.isArray(existing))) {
            return { success: false, message: 'Ranking data store is corrupted.' };
        }

        var candidate = cloneRankings(existing || {});

        if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
            return { success: false, message: 'Failed to prepare ranking data.' };
        }

        return { success: true, candidate: candidate };
    }

    function getGradeSummary(studentId, week) {
        if (typeof window.calculateGradeSummary === 'function') {
            return window.calculateGradeSummary(studentId, week);
        }
        return null;
    }

    function isAutoRankable(studentId, week) {
        if (!isRankableStudent(studentId)) {
            return false;
        }

        var summary = getGradeSummary(studentId, week);
        return summary && summary.hasGrades && summary.gradedWeightedCount > 0 && isFinite(summary.average);
    }

    // ============================================================
    // RESULT HELPERS
    // ============================================================

    function failure(message) {
        return { success: false, message: message };
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
        var weekNum = Validators.validateWeek(week);
        if (weekNum === null) {
            return [];
        }

        var data = getDataStore();
        if (!data || !data.curriculum || !data.curriculum.rankings) {
            return [];
        }

        var result = getWeekRankingsStrict(data.curriculum.rankings, weekNum);

        if (!result.valid) {
            return [];
        }

        var output = [];
        for (var i = 0; i < result.rankings.length; i++) {
            output.push({
                studentId: result.rankings[i].studentId,
                rank: result.rankings[i].rank
            });
        }

        return output;
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

    // ============================================================
    // RANKING MUTATIONS
    // ============================================================

    function setRankings(week, rankings) {
        // ---- PHASE 1: VALIDATE INPUT ----
        var weekNum = Validators.validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!Array.isArray(rankings)) {
            return failure('Rankings must be an array.');
        }

        var validatedRankings = [];
        var seen = Object.create(null);

        for (var i = 0; i < rankings.length; i++) {
            var r = rankings[i];

            if (!r || typeof r !== 'object') {
                return failure('Invalid ranking entry at index ' + i + '.');
            }

            if (!isNonEmptyString(r.studentId)) {
                return failure('Student ID is required at index ' + i + '.');
            }

            var rankNum = Validators.validateRank(r.rank);
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

        // ---- PHASE 2: VALIDATE STORE STRUCTURE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var storeResult = prepareRankingsStore(data);
        if (!storeResult.success) {
            return failure(storeResult.message);
        }

        var candidate = storeResult.candidate;

        // ---- PHASE 3: VALIDATE STORED DATA ----
        if (candidate[weekNum] !== undefined && candidate[weekNum] !== null) {
            var storedValidation = validateStoredRankings(candidate[weekNum]);
            if (!storedValidation.success) {
                return failure('Corrupted existing ranking data: ' + storedValidation.message);
            }
        }

        // ---- PHASE 4: PREPARE NEW RANKINGS ----
        // Ranks are POSITIONAL: input rank values determine order.
        // Equal positions preserve input order (stable sort).
        validatedRankings.sort(function(a, b) {
            return a.rank - b.rank;
        });

        for (var i = 0; i < validatedRankings.length; i++) {
            validatedRankings[i].rank = i + 1;
        }

        // ---- PHASE 5: COMMIT ----
        candidate[weekNum] = validatedRankings;
        data.curriculum.rankings = candidate;

        var count = validatedRankings.length;
        logActivity('Set rankings for week ' + weekNum + ' (' + count + ' students)');

        return successWithRankings(validatedRankings, 'set', count);
    }

    function updateStudentRank(week, studentId, newRank) {
        // ---- PHASE 1: VALIDATE INPUT ----
        var weekNum = Validators.validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        if (!isRankableStudent(studentId)) {
            return failure('Student not found or not rankable.');
        }

        var rankNum = Validators.validateRank(newRank);
        if (rankNum === null) {
            return failure('Valid rank is required.');
        }

        // ---- PHASE 2: VALIDATE STORE STRUCTURE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var storeResult = prepareRankingsStore(data);
        if (!storeResult.success) {
            return failure(storeResult.message);
        }

        var candidate = storeResult.candidate;

        // ---- PHASE 3: VALIDATE STORED DATA ----
        var weekResult = getWeekRankingsStrict(candidate, weekNum);
        if (!weekResult.valid) {
            return failure(weekResult.message);
        }

        var rankings = weekResult.rankings;

        // Validate existing rankings structure
        var storedValidation = validateStoredRankings(rankings);
        if (!storedValidation.success) {
            return failure('Corrupted existing ranking data: ' + storedValidation.message);
        }

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

        var studentName = getDisplayName(getCharacterByIdSafe(studentId));

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

            // ---- PHASE 5: COMMIT ----
            candidate[weekNum] = rankings;
            data.curriculum.rankings = candidate;

            logActivity('Added ' + studentName + ' to rankings at #' + targetRank + ' (week ' + weekNum + ')');
            return successWithRankings(rankings, 'added', rankings.length);

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

            // ---- PHASE 5: COMMIT ----
            candidate[weekNum] = rankings;
            data.curriculum.rankings = candidate;

            logActivity('Moved ' + studentName + ' from #' + oldRank + ' to #' + targetRank2 + ' (week ' + weekNum + ')');
            return successWithRankings(rankings, 'updated', rankings.length);
        }
    }

    function removeStudentFromRankings(week, studentId) {
        // ---- PHASE 1: VALIDATE INPUT ----
        var weekNum = Validators.validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        if (!isNonEmptyString(studentId)) {
            return failure('Student ID is required.');
        }

        // ---- PHASE 2: VALIDATE STORE STRUCTURE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var storeResult = prepareRankingsStore(data);
        if (!storeResult.success) {
            return failure(storeResult.message);
        }

        var candidate = storeResult.candidate;

        // ---- PHASE 3: VALIDATE STORED DATA ----
        var weekResult = getWeekRankingsStrict(candidate, weekNum);
        if (!weekResult.valid) {
            return failure(weekResult.message);
        }

        var rankings = weekResult.rankings;

        if (rankings.length === 0) {
            return successWithRankings([], 'unchanged', 0);
        }

        var storedValidation = validateStoredRankings(rankings);
        if (!storedValidation.success) {
            return failure('Corrupted existing ranking data: ' + storedValidation.message);
        }

        // ---- PHASE 4: FIND AND REMOVE ----
        var exists = false;
        for (var i = 0; i < rankings.length; i++) {
            if (String(rankings[i].studentId) === String(studentId)) {
                exists = true;
                break;
            }
        }

        if (!exists) {
            return successWithRankings(rankings, 'unchanged', rankings.length);
        }

        var newRankings = [];
        for (var i = 0; i < rankings.length; i++) {
            if (String(rankings[i].studentId) !== String(studentId)) {
                newRankings.push(rankings[i]);
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

        // ---- PHASE 5: COMMIT ----
        data.curriculum.rankings = candidate;

        var char = getCharacterByIdSafe(studentId);
        var charName = char ? getDisplayName(char) : 'Unknown';
        logActivity('Removed ' + charName + ' from rankings for week ' + weekNum);

        return successWithRankings(newRankings, 'removed', newRankings.length);
    }

    // ============================================================
    // AUTO-GENERATE RANKINGS
    // ============================================================

    function autoGenerateRankings(week) {
        // ---- PHASE 1: VALIDATE INPUT ----
        var weekNum = Validators.validateWeek(week);
        if (weekNum === null) {
            return failure('Valid week is required (1-52).');
        }

        var students = getStudents();
        if (!Array.isArray(students) || students.length === 0) {
            return failure('No students found.');
        }

        // ---- PHASE 2: COLLECT GRADE DATA ----
        var studentAverages = [];

        for (var i = 0; i < students.length; i++) {
            var student = students[i];
            if (isAutoRankable(student.id, weekNum)) {
                var summary = getGradeSummary(student.id, weekNum);
                if (summary !== null) {
                    var avg = Number(summary.average);
                    if (isFinite(avg)) {
                        studentAverages.push({
                            studentId: student.id,
                            average: avg
                        });
                    }
                }
            }
        }

        if (studentAverages.length === 0) {
            return failure('No students with valid weighted grades found.');
        }

        // ---- PHASE 3: SORT BY AVERAGE ----
        studentAverages.sort(function(a, b) {
            if (b.average !== a.average) {
                return b.average - a.average;
            }

            var charA = getCharacterByIdSafe(a.studentId);
            var charB = getCharacterByIdSafe(b.studentId);
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

        // ---- PHASE 4: VALIDATE STORE STRUCTURE ----
        var data = getDataStore();
        if (!data) {
            return failure('Data store is not available.');
        }

        var storeResult = prepareRankingsStore(data);
        if (!storeResult.success) {
            return failure(storeResult.message);
        }

        var candidate = storeResult.candidate;

        // ---- PHASE 5: COMMIT ----
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

    // NOTE: calculateGradeSummary is NOT exposed here.
    // It is exposed by curriculum-grades.js, which is the canonical owner.

})();
