/**
 * js/modules/academy/academy-ranking.js - Academy Ranking
 * SINGLE SOURCE OF TRUTH for all academy ranking data and operations
 * Path: js/modules/academy/academy-ranking.js
 *
 * This module is responsible for:
 *   - Ranking CRUD operations (create, update, delete)
 *   - Ranking queries (get by class, student, week)
 *   - Ranking generation (autoGenerate from performance)
 *   - Ranking statistics (percentile, distribution)
 *   - Ranking validation
 *   - Cross-domain cascade helper (stripCharacterRefs)
 *
 * IMPORTANT:
 *   - This module OWNS ranking data - it does NOT depend on AcademyQueries
 *   - Uses AcademyClasses for class data (no circular dependency)
 *   - Uses AcademyPerformance for the calculation (ranking CONSUMES
 *     performance; it does NOT calculate averages itself)
 *   - Uses CharacterQueries for name resolution in autoGenerate
 *   - All MUTATIONS go through MutationPipeline
 *   - All READS are synchronous and side-effect free
 *   - Invalid inputs are REJECTED (mutation resolves with { success: false })
 *   - Mutations are ATOMIC: if persistence fails, window.data is restored
 *   - This module does NOT call saveData() directly - the pipeline does
 *   - AcademyQueries is the PUBLIC read facade that uses these internal lookups
 *
 * READ SAFETY (Phase 2):
 *   - getAcademyStore() returns null (does NOT create academy.{...}) when
 *     the store is missing. Reads are side-effect free.
 *   - Public queries return DEEP CLONES. Callers cannot mutate live state.
 *   - Internal accessors (getRankingRecord, getRankingRecords,
 *     getClassRankingsInternal, getStudentRankInternal) return LIVE
 *     REFERENCES. They are consumed by this module's own mutation paths
 *     and by AcademyQueries.
 *   - Pipeline validate() callbacks read from the `appData` argument the
 *     pipeline supplies, not from window.data.
 *   - Post-mutation reads inside mutate() callbacks read from the
 *     appData snapshot, not from window.data.
 *   - ObjectUtils.deepClone is used as the clone primitive. If cloning
 *     fails, the accessor throws. It does NOT fall back to returning
 *     the original reference.
 *
 * PERFORMANCE INTEGRATION (Phase 3):
 *   - autoGenerate reads the ranking data from AcademyPerformance.
 *     It does NOT call AcademyGrades.calculateClassRanking. Ranking
 *     consumes performance; it does not calculate.
 *   - Students with a null average (no grades) are SKIPPED. Writing
 *     a ranking record with rank: null for an ungraded student would
 *     produce records the UI cannot render. Absence of a record
 *     means "not yet graded", which is the correct representation.
 *
 * RANKING RECORD SHAPE (Phase 3):
 *   {
 *     id,                // rank_xxx
 *     classId,           // class_789
 *     studentId,         // char_456
 *     week,              // 5
 *     rank,              // 1
 *     totalStudents,     // 25
 *     averageScore,      // 82.5 (the number that produced this rank)
 *     createdAt,
 *     updatedAt
 *   }
 *   - `score` is REMOVED. `averageScore` is the single source of the
 *     numeric value.
 *   - `percentile` is REMOVED from the record. It is DERIVED on read
 *     from `rank` and `totalStudents`.
 *
 * UNIQUENESS CONTRACT (Phase 3):
 *   - The tuple (classId, studentId, week) is UNIQUE across the entire
 *     ranking store.
 *   - Enforced in three places:
 *       1. Pre-flight check against the live store (fast feedback).
 *       2. Pipeline validate() check against the appData snapshot
 *          (race-free enforcement).
 *       3. Plan deduplication within autoGenerate / saveRankings
 *          (input-level deduplication with per-entry errors).
 *   - A student can have at most one rank position in a class for a
 *     given week. Multiple classes or multiple weeks are allowed.
 *
 * RANK BOUND CONTRACT (Phase 3):
 *   - rank must be >= 1.
 *   - rank must be <= totalStudents.
 *   - Enforced at write time. A rank of 30 with totalStudents: 20 is
 *     a data error and is rejected.
 *
 * CASCADE SEMANTICS (stripCharacterRefs):
 *   When a character is deleted, all ranking records keyed to that
 *   character are removed. Called by CharacterCRUD.deleteCharacter
 *   from inside its pipeline mutate.
 *
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 *   - window.ValidationUtils (from validation-utils.js) - MANDATORY
 *   - window.AcademyPerformance (from academy-performance.js) - MANDATORY
 *   - window.AcademyClasses (from academy-classes.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 *
 * USAGE:
 *   var rankings = window.AcademyRanking;
 *
 *   rankings.autoGenerate('class_789', 5).then(function(result) { ... });
 *
 *   var classRankings = rankings.getClassRankings('class_789', 5);
 *   var studentRank = rankings.getStudentRank('class_789', 'char_456', 5);
 */

(function() {
    'use strict';

    if (window.__academyRankingLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    var missing = [];

    if (!window.ObjectUtils || typeof window.ObjectUtils.deepClone !== 'function') {
        missing.push('ObjectUtils.deepClone');
    }

    if (!window.IdUtils || typeof window.IdUtils.generateId !== 'function') {
        missing.push('IdUtils.generateId');
    }

    if (!window.ValidationUtils || typeof window.ValidationUtils.isNonEmptyString !== 'function') {
        missing.push('ValidationUtils.isNonEmptyString');
    }

    if (!window.AcademyPerformance || typeof window.AcademyPerformance.calculateRanking !== 'function') {
        missing.push('AcademyPerformance.calculateRanking');
    }

    if (!window.AcademyClasses || typeof window.AcademyClasses.getClass !== 'function') {
        missing.push('AcademyClasses.getClass');
    }

    if (!window.CharacterQueries || typeof window.CharacterQueries.getCharacterById !== 'function') {
        missing.push('CharacterQueries.getCharacterById');
    }

    if (!window.MutationPipeline || typeof window.MutationPipeline.performMutation !== 'function') {
        missing.push('MutationPipeline.performMutation');
    }

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }

    if (missing.length > 0) {
        throw new Error('[AcademyRanking] Missing dependencies: ' + missing.join(', '));
    }

    window.__academyRankingLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var ValidationUtils = window.ValidationUtils;
    var AcademyPerformance = window.AcademyPerformance;
    var AcademyClasses = window.AcademyClasses;
    var CharacterQueries = window.CharacterQueries;
    var MutationPipeline = window.MutationPipeline;
    var CalendarConstants = window.CalendarConstants;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var MIN_RANK = 1;

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return ValidationUtils.isNonEmptyString(value);
    }

    function isNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function deepClone(value) {
        var result = ObjectUtils.deepClone(value);
        if (result === value && value !== null && typeof value === 'object') {
            throw new Error(
                '[AcademyRanking] deepClone returned the original reference. ' +
                'ObjectUtils.deepClone must return a genuine clone for objects.'
            );
        }
        return result;
    }

    function generateId() {
        return IdUtils.generateId('rank');
    }

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    // ============================================================
    // UNIQUENESS KEY
    // ============================================================
    //
    // The tuple (classId, studentId, week) is unique across the entire
    // ranking store. This helper produces a string key that can be used
    // in a set or map for O(1) uniqueness checks.

    function makeUniqueKey(classId, studentId, week) {
        return String(classId) + '\u0000' + String(studentId) + '\u0000' + String(week);
    }

    /**
     * Check whether a ranking already exists for the given tuple,
     * EXCLUDING the record with the given id (if any). Used during
     * update to allow the record to keep its own tuple.
     *
     * @param {string} classId
     * @param {string} studentId
     * @param {number} week
     * @param {string|null} excludeId - Optional record id to exclude
     * @returns {object|null} The conflicting record, or null
     */
    function findConflictingRanking(classId, studentId, week, excludeId) {
        var records = getRankingRecords();
        var exclude = excludeId !== null && excludeId !== undefined ? String(excludeId) : null;

        for (var i = 0; i < records.length; i++) {
            var r = records[i];
            if (!r) continue;
            if (exclude !== null && String(r.id) === exclude) continue;
            if (String(r.classId) !== String(classId)) continue;
            if (String(r.studentId) !== String(studentId)) continue;
            if (parseInt(r.week, 10) !== parseInt(week, 10)) continue;
            return r;
        }
        return null;
    }

    /**
     * Same as findConflictingRanking, but operating on an appData
     * snapshot rather than the live store. Used inside pipeline
     * validate() callbacks.
     */
    function findConflictingRankingInSnapshot(appData, classId, studentId, week, excludeId) {
        if (!appData || !appData.academy || !appData.academy.rankings) {
            return null;
        }

        var rankings = appData.academy.rankings;
        var exclude = excludeId !== null && excludeId !== undefined ? String(excludeId) : null;

        for (var id in rankings) {
            if (!Object.prototype.hasOwnProperty.call(rankings, id)) continue;
            var r = rankings[id];
            if (!r) continue;
            if (exclude !== null && String(r.id) === exclude) continue;
            if (String(r.classId) !== String(classId)) continue;
            if (String(r.studentId) !== String(studentId)) continue;
            if (parseInt(r.week, 10) !== parseInt(week, 10)) continue;
            return r;
        }
        return null;
    }

    // ============================================================
    // DERIVED FIELD HELPERS
    // ============================================================

    /**
     * Compute a percentile from rank and totalStudents.
     * Returns a number in 0..100.
     *
     * DEFINITION:
     *   percentile = round((totalStudents - rank + 1) / totalStudents * 100)
     *
     * Rank 1 of 25 → 100th percentile.
     * Rank 25 of 25 → 4th percentile.
     */
    function calculatePercentile(rank, total) {
        if (!isNumber(total) || total <= 0) {
            return 0;
        }
        if (!isNumber(rank) || rank <= 0) {
            return 0;
        }
        return Math.round(((total - rank + 1) / total) * 100);
    }

    /**
     * Attach derived fields (percentile) to a ranking record.
     * Returns a clone. The input record is not modified.
     */
    function decorateRanking(record) {
        if (!record || typeof record !== 'object') {
            return record;
        }
        var copy = deepClone(record);
        copy.percentile = calculatePercentile(copy.rank, copy.totalStudents);
        return copy;
    }

    function decorateRankings(records) {
        if (!Array.isArray(records)) {
            return [];
        }
        var result = [];
        for (var i = 0; i < records.length; i++) {
            result.push(decorateRanking(records[i]));
        }
        return result;
    }

    // ============================================================
    // DATA STORE ACCESS - INTERNAL
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') {
            return null;
        }
        return window.data;
    }

    function getAcademyStore() {
        var data = getDataStore();
        if (!data) {
            return null;
        }

        if (!data.academy || typeof data.academy !== 'object') {
            return null;
        }

        return data.academy;
    }

    // ============================================================
    // INTERNAL RANKING LOOKUP - PRIVATE (LIVE REFERENCES)
    // ============================================================

    function getRankingRecord(rankId) {
        if (!isNonEmptyString(rankId)) {
            return null;
        }

        var academy = getAcademyStore();
        if (!academy || !academy.rankings) {
            return null;
        }

        var target = String(rankId);
        return academy.rankings[target] || null;
    }

    function getRankingRecords(classId, week) {
        var academy = getAcademyStore();
        if (!academy || !academy.rankings) {
            return [];
        }

        var result = [];

        for (var id in academy.rankings) {
            if (Object.prototype.hasOwnProperty.call(academy.rankings, id)) {
                var rank = academy.rankings[id];
                if (!rank) continue;

                if (classId !== undefined && String(rank.classId) !== String(classId)) {
                    continue;
                }

                if (week !== undefined) {
                    var weekNum = parseInt(week, 10);
                    if (!isNaN(weekNum) && rank.week !== weekNum) {
                        continue;
                    }
                }

                result.push(rank);
            }
        }

        result.sort(function(a, b) {
            return (a.rank || 999) - (b.rank || 999);
        });

        return result;
    }

    function getClassRankingsInternal(classId, week) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum) || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            weekNum = 1;
        }

        return getRankingRecords(classId, weekNum);
    }

    function getStudentRankInternal(classId, studentId, week) {
        if (!isNonEmptyString(classId) || !isNonEmptyString(studentId)) {
            return null;
        }

        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum) || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            weekNum = 1;
        }

        var rankings = getClassRankingsInternal(classId, weekNum);
        var targetStudent = String(studentId);

        for (var i = 0; i < rankings.length; i++) {
            if (String(rankings[i].studentId) === targetStudent) {
                return rankings[i];
            }
        }

        return null;
    }

    /**
     * Read rankings from an appData snapshot. Used for post-mutation
     * reads inside pipeline mutate() callbacks so the returned data
     * reflects the transaction that just ran.
     */
    function getClassRankingsFromSnapshot(appData, classId, weekNum) {
        if (!appData || !appData.academy || !appData.academy.rankings) {
            return [];
        }

        var rankings = appData.academy.rankings;
        var targetClass = String(classId);
        var result = [];

        for (var id in rankings) {
            if (Object.prototype.hasOwnProperty.call(rankings, id)) {
                var rank = rankings[id];
                if (!rank) continue;
                if (String(rank.classId) !== targetClass) continue;
                if (parseInt(rank.week, 10) !== weekNum) continue;
                result.push(deepClone(rank));
            }
        }

        result.sort(function(a, b) {
            return (a.rank || 999) - (b.rank || 999);
        });

        return result;
    }

    // ============================================================
    // CLASS VALIDATION - Uses AcademyClasses (no circular dependency)
    // ============================================================

    function validateClassExists(classId) {
        if (!isNonEmptyString(classId)) {
            return { valid: false, message: 'Class ID is required.' };
        }

        var cls = AcademyClasses.getClass(classId);
        if (!cls) {
            return { valid: false, message: 'Class not found.' };
        }

        return { valid: true, class: cls };
    }

    // ============================================================
    // RANKING VALIDATION
    // ============================================================

    /**
     * Validate ranking data (field-level, partial-aware).
     *
     * For cross-field validation (rank <= totalStudents), see
     * validateCandidate.
     */
    function validateRankingData(data, isPartial) {
        if (!isObject(data)) {
            return { valid: false, message: 'Ranking data must be an object.' };
        }

        if (!isPartial || data.classId !== undefined) {
            if (!isNonEmptyString(data.classId)) {
                return { valid: false, message: 'Class ID is required.' };
            }
        }

        if (!isPartial || data.studentId !== undefined) {
            if (!isNonEmptyString(data.studentId)) {
                return { valid: false, message: 'Student ID is required.' };
            }
        }

        if (!isPartial || data.week !== undefined) {
            var week = parseInt(data.week, 10);
            if (isNaN(week) || week < MIN_WEEK || week > MAX_WEEK) {
                return { valid: false, message: 'Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').' };
            }
        }

        if (!isPartial || data.rank !== undefined) {
            var rank = parseInt(data.rank, 10);
            if (isNaN(rank) || rank < MIN_RANK) {
                return { valid: false, message: 'Rank must be a number greater than or equal to 1.' };
            }
        }

        if (data.totalStudents !== undefined) {
            var total = parseInt(data.totalStudents, 10);
            if (isNaN(total) || total < 0) {
                return { valid: false, message: 'Total students must be a number greater than or equal to 0.' };
            }
        }

        if (data.averageScore !== undefined && data.averageScore !== null) {
            var avg = parseFloat(data.averageScore);
            if (isNaN(avg) || avg < 0) {
                return { valid: false, message: 'Average score must be a number greater than or equal to 0.' };
            }
        }

        // Note: `score` is no longer a valid field. Callers that pass
        // it receive an "unknown field" error from validateCandidate
        // once it is applied to the record. Silently ignoring it would
        // leave the caller thinking their value was stored.

        return { valid: true };
    }

    /**
     * Validate a complete candidate ranking record.
     *
     * Enforces cross-field invariants that cannot be checked in
     * isolation:
     *   - rank <= totalStudents (when totalStudents > 0)
     *   - week in bounds
     *   - every required field present
     */
    function validateCandidate(candidate) {
        if (!isObject(candidate)) {
            return { valid: false, message: 'Candidate is not an object.' };
        }

        if (!isNonEmptyString(candidate.classId)) {
            return { valid: false, message: 'Candidate missing classId.' };
        }
        if (!isNonEmptyString(candidate.studentId)) {
            return { valid: false, message: 'Candidate missing studentId.' };
        }

        var week = parseInt(candidate.week, 10);
        if (isNaN(week) || week < MIN_WEEK || week > MAX_WEEK) {
            return { valid: false, message: 'Candidate week is out of range.' };
        }

        var rank = parseInt(candidate.rank, 10);
        if (isNaN(rank) || rank < MIN_RANK) {
            return { valid: false, message: 'Candidate rank must be >= 1.' };
        }

        var total = parseInt(candidate.totalStudents, 10);
        if (isNaN(total) || total < 0) {
            return { valid: false, message: 'Candidate totalStudents is invalid.' };
        }

        if (total > 0 && rank > total) {
            return {
                valid: false,
                message: 'Rank (' + rank + ') cannot exceed totalStudents (' + total + ').'
            };
        }

        if (candidate.averageScore !== null && candidate.averageScore !== undefined) {
            var avg = parseFloat(candidate.averageScore);
            if (isNaN(avg) || avg < 0) {
                return { valid: false, message: 'Candidate averageScore is invalid.' };
            }
        }

        return { valid: true };
    }

    // ============================================================
    // INTERNAL CANDIDATE BUILDER
    // ============================================================

    function buildRankingRecord(data, existingId, existingCreatedAt) {
        var now = new Date().toISOString();
        var rank = parseInt(data.rank, 10);
        var totalStudents = data.totalStudents !== undefined ? parseInt(data.totalStudents, 10) : 0;
        var averageScore = data.averageScore !== undefined && data.averageScore !== null
            ? parseFloat(data.averageScore)
            : null;

        return {
            id: existingId || generateId(),
            classId: String(data.classId),
            studentId: String(data.studentId),
            week: parseInt(data.week, 10),
            rank: rank,
            totalStudents: totalStudents,
            averageScore: averageScore,
            createdAt: existingCreatedAt || now,
            updatedAt: now
        };
    }

    // ============================================================
    // PUBLIC API - RANKING CRUD (Promise-based, via MutationPipeline)
    // ============================================================

    /**
     * Create a ranking record.
     *
     * Pre-flight checks:
     *   - class exists
     *   - (classId, studentId, week) is unique in the live store
     *
     * Pipeline validate() re-checks uniqueness against the snapshot.
     */
    function create(data) {
        var validation = validateRankingData(data, false);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.message));
        }

        var classValidation = validateClassExists(data.classId);
        if (!classValidation.valid) {
            return Promise.resolve(failure(classValidation.message));
        }

        // Pre-flight uniqueness check (fast feedback).
        var conflict = findConflictingRanking(data.classId, data.studentId, data.week, null);
        if (conflict) {
            return Promise.resolve(failure(
                'A ranking already exists for this student, class, and week. Use update instead.'
            ));
        }

        var newRanking = buildRankingRecord(data, null, null);

        var candidateCheck = validateCandidate(newRanking);
        if (!candidateCheck.valid) {
            return Promise.resolve(failure(candidateCheck.message));
        }

        var targetId = newRanking.id;

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy) {
                    return { valid: false, message: 'Academy data is not available.' };
                }
                if (appData.academy.rankings && appData.academy.rankings[targetId]) {
                    return { valid: false, message: 'Ranking ID collision.' };
                }
                var snapshotConflict = findConflictingRankingInSnapshot(
                    appData,
                    newRanking.classId,
                    newRanking.studentId,
                    newRanking.week,
                    targetId
                );
                if (snapshotConflict) {
                    return { valid: false, message: 'A ranking already exists for this student, class, and week.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                if (!appData.academy.rankings || typeof appData.academy.rankings !== 'object') {
                    appData.academy.rankings = {};
                }
                appData.academy.rankings[targetId] = deepClone(newRanking);
                return { ranking: newRanking, id: targetId };
            },
            logMessage: 'Created ranking for student ' + newRanking.studentId,
            successMessage: 'Ranking created successfully!',
            failureMessage: 'Failed to create ranking.'
        });
    }

    /**
     * Update an existing ranking.
     *
     * UNIQUENESS: if classId, studentId, or week is changed, the new
     * tuple must not collide with another existing record. The record's
     * own tuple is excluded from the check.
     */
    function update(rankId, updates) {
        if (!isNonEmptyString(rankId)) {
            return Promise.resolve(failure('Ranking ID is required.'));
        }

        if (!isObject(updates) || Object.keys(updates).length === 0) {
            return Promise.resolve(failure('Updates are required.'));
        }

        var existing = getRankingRecord(rankId);
        if (!existing) {
            return Promise.resolve(failure('Ranking not found.'));
        }

        var fieldValidation = validateRankingData(updates, true);
        if (!fieldValidation.valid) {
            return Promise.resolve(failure(fieldValidation.message));
        }

        var candidate = deepClone(existing);
        if (candidate === null) {
            return Promise.resolve(failure('Failed to clone ranking data.'));
        }

        var hasChanges = false;
        var updateFields = ['classId', 'studentId', 'week', 'rank', 'totalStudents', 'averageScore'];

        for (var i = 0; i < updateFields.length; i++) {
            var field = updateFields[i];
            if (updates[field] === undefined) {
                continue;
            }

            var value = updates[field];

            switch (field) {
                case 'classId':
                case 'studentId':
                    if (!isNonEmptyString(value)) {
                        return Promise.resolve(failure(field + ' must be a non-empty string.'));
                    }
                    if (candidate[field] !== String(value)) {
                        candidate[field] = String(value);
                        hasChanges = true;
                    }
                    break;

                case 'week':
                    var week = parseInt(value, 10);
                    if (isNaN(week) || week < MIN_WEEK || week > MAX_WEEK) {
                        return Promise.resolve(failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').'));
                    }
                    if (candidate.week !== week) {
                        candidate.week = week;
                        hasChanges = true;
                    }
                    break;

                case 'rank':
                    var rank = parseInt(value, 10);
                    if (isNaN(rank) || rank < MIN_RANK) {
                        return Promise.resolve(failure('Rank must be a number greater than or equal to 1.'));
                    }
                    if (candidate.rank !== rank) {
                        candidate.rank = rank;
                        hasChanges = true;
                    }
                    break;

                case 'totalStudents':
                    var total = parseInt(value, 10);
                    if (isNaN(total) || total < 0) {
                        return Promise.resolve(failure('Total students must be a number greater than or equal to 0.'));
                    }
                    if (candidate.totalStudents !== total) {
                        candidate.totalStudents = total;
                        hasChanges = true;
                    }
                    break;

                case 'averageScore':
                    if (value === null) {
                        if (candidate.averageScore !== null) {
                            candidate.averageScore = null;
                            hasChanges = true;
                        }
                    } else {
                        var avg = parseFloat(value);
                        if (isNaN(avg) || avg < 0) {
                            return Promise.resolve(failure('Average score must be a number greater than or equal to 0.'));
                        }
                        if (candidate.averageScore !== avg) {
                            candidate.averageScore = avg;
                            hasChanges = true;
                        }
                    }
                    break;
            }
        }

        if (!hasChanges) {
            return Promise.resolve(success({ ranking: decorateRanking(existing), changed: false }));
        }

        // Full candidate validation (rank <= totalStudents, week bounds, etc.).
        var candidateCheck = validateCandidate(candidate);
        if (!candidateCheck.valid) {
            return Promise.resolve(failure(candidateCheck.message));
        }

        // Uniqueness check against the LIVE store, excluding self.
        var conflict = findConflictingRanking(
            candidate.classId,
            candidate.studentId,
            candidate.week,
            rankId
        );
        if (conflict) {
            return Promise.resolve(failure(
                'Another ranking already exists for this student, class, and week.'
            ));
        }

        candidate.updatedAt = new Date().toISOString();
        var targetId = String(rankId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy || !appData.academy.rankings) {
                    return { valid: false, message: 'Ranking no longer exists.' };
                }
                if (!appData.academy.rankings[targetId]) {
                    return { valid: false, message: 'Ranking no longer exists.' };
                }
                var snapshotConflict = findConflictingRankingInSnapshot(
                    appData,
                    candidate.classId,
                    candidate.studentId,
                    candidate.week,
                    targetId
                );
                if (snapshotConflict) {
                    return { valid: false, message: 'Another ranking already exists for this student, class, and week.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                if (!appData.academy || !appData.academy.rankings) {
                    throw new Error('Academy data is not available.');
                }
                if (!appData.academy.rankings[targetId]) {
                    throw new Error('Ranking not found in data store.');
                }
                appData.academy.rankings[targetId] = deepClone(candidate);
                return { ranking: candidate, changed: true };
            },
            logMessage: 'Updated ranking for student ' + candidate.studentId,
            successMessage: 'Ranking updated successfully!',
            failureMessage: 'Failed to update ranking.'
        });
    }

    /**
     * Delete a ranking permanently.
     */
    function deleteRanking(rankId) {
        if (!isNonEmptyString(rankId)) {
            return Promise.resolve(failure('Ranking ID is required.'));
        }

        var target = String(rankId);
        var existing = getRankingRecord(target);
        if (!existing) {
            return Promise.resolve(failure('Ranking not found.'));
        }

        var rankInfo = {
            id: target,
            classId: existing.classId,
            studentId: existing.studentId,
            week: existing.week,
            rank: existing.rank
        };

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy || !appData.academy.rankings) {
                    return { valid: false, message: 'Ranking no longer exists.' };
                }
                if (!appData.academy.rankings[target]) {
                    return { valid: false, message: 'Ranking no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                if (!appData.academy || !appData.academy.rankings) {
                    throw new Error('Academy data is not available.');
                }
                if (!appData.academy.rankings[target]) {
                    throw new Error('Ranking not found in data store.');
                }
                delete appData.academy.rankings[target];
                return { deleted: true, ranking: rankInfo };
            },
            logMessage: 'Deleted ranking for student ' + existing.studentId,
            successMessage: 'Ranking deleted successfully!',
            failureMessage: 'Failed to delete ranking.'
        });
    }

    /**
     * Delete all rankings for a class and week.
     */
    function deleteClassRankings(classId, week) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum) || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return Promise.resolve(failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').'));
        }

        var targetClass = String(classId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy || !appData.academy.rankings) {
                    return { valid: false, message: 'Academy data is not available.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var rankings = appData.academy.rankings;
                var toRemove = [];
                var removed = [];

                for (var id in rankings) {
                    if (Object.prototype.hasOwnProperty.call(rankings, id)) {
                        var rank = rankings[id];
                        if (rank && String(rank.classId) === targetClass && rank.week === weekNum) {
                            toRemove.push(id);
                            removed.push({
                                id: id,
                                studentId: rank.studentId,
                                rank: rank.rank
                            });
                        }
                    }
                }

                for (var i = 0; i < toRemove.length; i++) {
                    delete rankings[toRemove[i]];
                }

                return {
                    classId: targetClass,
                    week: weekNum,
                    removedCount: removed.length,
                    removed: removed
                };
            },
            logMessage: 'Deleted rankings for class ' + targetClass + ', week ' + weekNum,
            successMessage: 'Class rankings deleted successfully!',
            failureMessage: 'Failed to delete class rankings.'
        });
    }

    // ============================================================
    // PUBLIC READ SURFACE (CLONES)
    // ============================================================
    //
    // All records are returned with `percentile` attached as a
    // DERIVED field. The stored record never carries it.

    function getClassRankings(classId, week, includeStudentDetails) {
        var rankings = getClassRankingsInternal(classId, week);

        if (!includeStudentDetails) {
            return decorateRankings(rankings);
        }

        var enriched = [];
        for (var i = 0; i < rankings.length; i++) {
            var rank = decorateRanking(rankings[i]);
            var student = CharacterQueries.getCharacterById(rank.studentId);
            if (student) {
                rank.studentName = CharacterQueries.getDisplayName(student);
                rank.student = student;
            }
            enriched.push(rank);
        }

        return enriched;
    }

    function getStudentRank(classId, studentId, week, includeDetails) {
        var rank = getStudentRankInternal(classId, studentId, week);

        if (!rank) {
            return null;
        }

        var result = decorateRanking(rank);

        if (includeDetails) {
            var student = CharacterQueries.getCharacterById(result.studentId);
            if (student) {
                result.studentName = CharacterQueries.getDisplayName(student);
                result.student = student;
            }

            var allRankings = getClassRankingsInternal(classId, week);
            result.totalRanked = allRankings.length;
        }

        return result;
    }

    function getRankingsWithDetails(classId, week) {
        var rankings = getClassRankings(classId, week, true);
        var summary = calculateRankingSummary(rankings);
        var distribution = calculateRankDistribution(rankings);

        return {
            classId: classId,
            week: week,
            rankings: rankings,
            summary: summary,
            distribution: distribution,
            count: rankings.length
        };
    }

    function getRankings(classId, week) {
        var records = getRankingRecords(classId, week);
        return decorateRankings(records);
    }

    function getRanking(rankId) {
        var rank = getRankingRecord(rankId);
        return rank ? decorateRanking(rank) : null;
    }

    // ============================================================
    // RANKING CALCULATIONS - Pure
    // ============================================================

    function calculateRankingSummary(rankings) {
        if (!Array.isArray(rankings) || rankings.length === 0) {
            return {
                count: 0,
                minRank: null,
                maxRank: null,
                averageRank: 0,
                topStudent: null,
                bottomStudent: null
            };
        }

        var count = rankings.length;
        var minRank = Infinity;
        var maxRank = -Infinity;
        var totalRank = 0;
        var topStudent = null;
        var bottomStudent = null;

        for (var i = 0; i < rankings.length; i++) {
            var rank = rankings[i];
            if (!rank) continue;

            var rankValue = rank.rank || 999;
            totalRank += rankValue;

            if (rankValue < minRank) {
                minRank = rankValue;
                topStudent = rank.studentName || rank.studentId;
            }
            if (rankValue > maxRank) {
                maxRank = rankValue;
                bottomStudent = rank.studentName || rank.studentId;
            }
        }

        return {
            count: count,
            minRank: minRank === Infinity ? null : minRank,
            maxRank: maxRank === -Infinity ? null : maxRank,
            averageRank: count > 0 ? Math.round((totalRank / count) * 10) / 10 : 0,
            topStudent: topStudent,
            bottomStudent: bottomStudent
        };
    }

    function calculateRankDistribution(rankings, bins) {
        bins = bins || 5;

        if (!Array.isArray(rankings) || rankings.length === 0) {
            return {};
        }

        var distribution = {};
        var binSize = Math.ceil(100 / bins);

        for (var i = 0; i < rankings.length; i++) {
            var rank = rankings[i];
            if (!rank) continue;

            var percentile = rank.percentile !== undefined
                ? rank.percentile
                : calculatePercentile(rank.rank, rank.totalStudents);

            var binKey = Math.floor(percentile / binSize) * binSize;
            var binLabel = binKey + '-' + Math.min(binKey + binSize - 1, 100);
            if (binKey >= 100) {
                binLabel = '100';
            }

            if (!distribution[binLabel]) {
                distribution[binLabel] = { count: 0, students: [] };
            }

            distribution[binLabel].count++;
            if (rank.studentName) {
                distribution[binLabel].students.push(rank.studentName);
            }
        }

        return distribution;
    }

    // ============================================================
    // AUTO-GENERATE RANKINGS FROM PERFORMANCE
    // ============================================================

    /**
     * Auto-generate rankings from performance data.
     *
     * PLAN / APPLY:
     *   1. Validate inputs.
     *   2. Read the class roster (student IDs).
     *   3. Ask AcademyPerformance for the ranked list. Performance
     *      owns the calculation; this module does not compute
     *      averages itself.
     *   4. Plan ALL writes (create/update/skip) without touching
     *      window.data. Deduplicate by (classId, studentId, week).
     *   5. Apply all planned writes in a SINGLE pipeline transaction.
     *   6. Return the post-mutation state read from the appData
     *      snapshot, not from window.data.
     *
     * SKIPPED STUDENTS:
     *   - Students with a null average (no grades) are skipped. No
     *     ranking record is written for them. Absence of a record
     *     means "not yet graded".
     *
     * UNIQUENESS:
     *   - The (classId, studentId, week) tuple is unique across the
     *     store. Duplicate inputs within a single call are collapsed
     *     with a per-entry error.
     *
     * @param {string} classId
     * @param {number} week
     * @param {object} [options]
     * @param {boolean} [options.overwrite=true]
     * @param {string[]} [options.studentIds] - Explicit roster. When
     *   absent, the roster is derived from AcademyQueries.
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function autoGenerate(classId, week, options) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum) || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return Promise.resolve(failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').'));
        }

        options = options || {};
        var overwrite = options.overwrite !== false;

        var classValidation = validateClassExists(classId);
        if (!classValidation.valid) {
            return Promise.resolve(failure(classValidation.message));
        }

        // ---- Resolve the roster ----
        var studentIds = options.studentIds;
        if (!Array.isArray(studentIds)) {
            studentIds = resolveClassStudentIds(classId);
        }

        if (!Array.isArray(studentIds) || studentIds.length === 0) {
            return Promise.resolve(failure('No students found in this class.'));
        }

        // ---- Ask performance for the ranked list ----
        var rankingData;
        try {
            rankingData = AcademyPerformance.calculateRanking(
                studentIds,
                classId,
                weekNum,
                CharacterQueries.getCharacterById
            );
        } catch (e) {
            return Promise.resolve(failure('Failed to calculate performance: ' + e.message));
        }

        if (!Array.isArray(rankingData) || rankingData.length === 0) {
            return Promise.resolve(failure('No performance data available for this class and week.'));
        }

        // ---- Filter to students who were actually ranked ----
        // Entries with a null average have no grades. We skip them.
        var rankedEntries = [];
        for (var i = 0; i < rankingData.length; i++) {
            var entry = rankingData[i];
            if (!entry || entry.rank === null || entry.average === null) {
                continue;
            }
            rankedEntries.push(entry);
        }

        if (rankedEntries.length === 0) {
            return Promise.resolve(failure('No students have grades for this class and week.'));
        }

        // ---- Plan ----
        var totalStudents = rankedEntries.length;
        var planned = [];
        var errors = [];
        var seenKeys = {};

        for (var j = 0; j < rankedEntries.length; j++) {
            var data = rankedEntries[j];

            // Collapse duplicate inputs.
            var uniqueKey = makeUniqueKey(classId, data.studentId, weekNum);
            if (seenKeys[uniqueKey]) {
                errors.push({
                    studentId: data.studentId,
                    error: 'Duplicate entry in input.'
                });
                continue;
            }
            seenKeys[uniqueKey] = true;

            var rankPosition = data.rank;
            var averageScore = data.average;

            // Sanity: rank cannot exceed the total.
            if (rankPosition > totalStudents) {
                errors.push({
                    studentId: data.studentId,
                    error: 'Rank ' + rankPosition + ' exceeds total students ' + totalStudents + '.'
                });
                continue;
            }

            var existing = getStudentRankInternal(classId, data.studentId, weekNum);

            if (existing && !overwrite) {
                planned.push({ action: 'skip' });
                continue;
            }

            if (existing) {
                var candidate = deepClone(existing);
                candidate.rank = rankPosition;
                candidate.totalStudents = totalStudents;
                candidate.averageScore = averageScore;
                candidate.updatedAt = new Date().toISOString();
                planned.push({ action: 'update', record: candidate, matchId: existing.id });
            } else {
                var newRecord = buildRankingRecord({
                    classId: classId,
                    studentId: data.studentId,
                    week: weekNum,
                    rank: rankPosition,
                    totalStudents: totalStudents,
                    averageScore: averageScore
                }, null, null);
                planned.push({ action: 'create', record: newRecord });
            }
        }

        var creates = planned.filter(function(p) { return p.action === 'create'; });
        var updates = planned.filter(function(p) { return p.action === 'update'; });
        var skipped = planned.filter(function(p) { return p.action === 'skip'; }).length;

        // ---- Apply ----
        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy) {
                    return { valid: false, message: 'Academy data is not available.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                if (!appData.academy.rankings || typeof appData.academy.rankings !== 'object') {
                    appData.academy.rankings = {};
                }

                var created = 0;
                var updated = 0;

                for (var k = 0; k < planned.length; k++) {
                    var item = planned[k];
                    if (item.action === 'create') {
                        appData.academy.rankings[item.record.id] = deepClone(item.record);
                        created++;
                    } else if (item.action === 'update') {
                        if (!appData.academy.rankings[item.matchId]) {
                            throw new Error('Ranking no longer exists: ' + item.matchId);
                        }
                        appData.academy.rankings[item.matchId] = deepClone(item.record);
                        updated++;
                    }
                }

                // Post-mutation read: from the snapshot, not window.data.
                var finalRankings = getClassRankingsFromSnapshot(appData, classId, weekNum);

                return {
                    classId: classId,
                    week: weekNum,
                    totalStudents: totalStudents,
                    created: created,
                    updated: updated,
                    skipped: skipped,
                    errors: errors,
                    rankings: finalRankings
                };
            },
            logMessage: 'Generated rankings for class ' + classId + ', week ' + weekNum,
            successMessage: 'Rankings generated successfully!',
            failureMessage: 'Failed to generate rankings.'
        });
    }

    /**
     * Resolve the list of student IDs in a class.
     *
     * Uses AcademyQueries.getClassStudentIds when available. Falls
     * back to an empty array. Callers that want a different roster
     * should pass options.studentIds explicitly.
     */
    function resolveClassStudentIds(classId) {
        var AQ = window.AcademyQueries;
        if (AQ && typeof AQ.getClassStudentIds === 'function') {
            var ids = AQ.getClassStudentIds(classId);
            return Array.isArray(ids) ? ids.slice() : [];
        }
        return [];
    }

    // ============================================================
    // CASCADE HELPERS - Remove all references to a character ID
    // ============================================================

    function stripCharacterRefs(appData, charId) {
        var result = { rankingsRemoved: 0 };

        if (!appData || !charId) {
            return result;
        }

        if (!appData.academy || typeof appData.academy !== 'object') {
            return result;
        }

        var rankings = appData.academy.rankings;
        if (!rankings || typeof rankings !== 'object' || Array.isArray(rankings)) {
            return result;
        }

        var target = String(charId);
        var keysToRemove = [];

        Object.keys(rankings).forEach(function(id) {
            var rank = rankings[id];
            if (rank && String(rank.studentId) === target) {
                keysToRemove.push(id);
            }
        });

        for (var i = 0; i < keysToRemove.length; i++) {
            delete rankings[keysToRemove[i]];
        }

        result.rankingsRemoved = keysToRemove.length;
        return result;
    }

    // ============================================================
    // BULK OPERATIONS - Via MutationPipeline
    // ============================================================

    /**
     * Save multiple rankings at once.
     *
     * Input deduplication: entries that would produce duplicate
     * (classId, studentId, week) tuples within the same call are
     * collapsed. The first occurrence wins; subsequent occurrences
     * produce a per-entry error.
     */
    function saveRankings(rankingDataArray, options) {
        if (!Array.isArray(rankingDataArray) || rankingDataArray.length === 0) {
            return Promise.resolve(failure('Ranking data array is required.'));
        }

        options = options || {};
        var overwrite = options.overwrite !== false;

        var planned = [];
        var errors = [];
        var seenKeys = {};

        for (var i = 0; i < rankingDataArray.length; i++) {
            var data = rankingDataArray[i];
            if (!isObject(data)) {
                errors.push({ index: i, error: 'Invalid ranking data.' });
                continue;
            }

            if (!data.classId || !data.studentId || !data.week || data.rank === undefined) {
                errors.push({
                    index: i,
                    error: 'Missing required fields: classId, studentId, week, rank'
                });
                continue;
            }

            var validation = validateRankingData(data, false);
            if (!validation.valid) {
                errors.push({ index: i, studentId: data.studentId, error: validation.message });
                continue;
            }

            // Input-level deduplication.
            var key = makeUniqueKey(data.classId, data.studentId, data.week);
            if (seenKeys[key]) {
                errors.push({
                    index: i,
                    studentId: data.studentId,
                    error: 'Duplicate entry for the same (class, student, week).'
                });
                continue;
            }
            seenKeys[key] = true;

            var existing = getStudentRankInternal(data.classId, data.studentId, data.week);

            if (existing && !overwrite) {
                planned.push({ action: 'skip' });
                continue;
            }

            if (existing) {
                var candidate = buildRankingRecord(data, existing.id, existing.createdAt);
                var candidateCheck = validateCandidate(candidate);
                if (!candidateCheck.valid) {
                    errors.push({ index: i, error: candidateCheck.message });
                    continue;
                }
                planned.push({ action: 'update', record: candidate, matchId: existing.id });
            } else {
                var newRecord = buildRankingRecord(data, null, null);
                var newCheck = validateCandidate(newRecord);
                if (!newCheck.valid) {
                    errors.push({ index: i, error: newCheck.message });
                    continue;
                }
                planned.push({ action: 'create', record: newRecord });
            }
        }

        var creates = planned.filter(function(p) { return p.action === 'create'; });
        var updates = planned.filter(function(p) { return p.action === 'update'; });
        var skipped = planned.filter(function(p) { return p.action === 'skip'; }).length;

        if (creates.length === 0 && updates.length === 0) {
            return Promise.resolve(success({
                total: rankingDataArray.length,
                created: 0,
                updated: 0,
                skipped: skipped,
                errors: errors,
                successCount: 0
            }));
        }

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy) {
                    return { valid: false, message: 'Academy data is not available.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                if (!appData.academy.rankings || typeof appData.academy.rankings !== 'object') {
                    appData.academy.rankings = {};
                }

                var created = 0;
                var updated = 0;

                for (var k = 0; k < planned.length; k++) {
                    var item = planned[k];
                    if (item.action === 'create') {
                        appData.academy.rankings[item.record.id] = deepClone(item.record);
                        created++;
                    } else if (item.action === 'update') {
                        if (!appData.academy.rankings[item.matchId]) {
                            throw new Error('Ranking no longer exists: ' + item.matchId);
                        }
                        appData.academy.rankings[item.matchId] = deepClone(item.record);
                        updated++;
                    }
                }

                return {
                    total: rankingDataArray.length,
                    created: created,
                    updated: updated,
                    skipped: skipped,
                    errors: errors,
                    successCount: created + updated
                };
            },
            logMessage: 'Saved ' + (creates.length + updates.length) + ' ranking(s)',
            successMessage: 'Rankings saved successfully!',
            failureMessage: 'Failed to save rankings.'
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyRanking = {
        // ---- Mutations (Promise-based) ----
        create: create,
        update: update,
        delete: deleteRanking,
        deleteClassRankings: deleteClassRankings,
        autoGenerate: autoGenerate,
        saveRankings: saveRankings,

        // ---- Public queries (synchronous, CLONES) ----
        getClassRankings: getClassRankings,
        getStudentRank: getStudentRank,
        getRankingsWithDetails: getRankingsWithDetails,
        getRankings: getRankings,
        getRanking: getRanking,

        // ---- Calculations (synchronous, pure) ----
        calculateRankingSummary: calculateRankingSummary,
        calculateRankDistribution: calculateRankDistribution,
        calculatePercentile: calculatePercentile,

        // ---- Derived field helpers ----
        decorateRanking: decorateRanking,
        decorateRankings: decorateRankings,

        // ---- Cascade helpers (for cross-domain cleanup) ----
        stripCharacterRefs: stripCharacterRefs,

        // ---- Internal (LIVE REFERENCES - for AcademyQueries and internal use) ----
        getClassRankingsInternal: getClassRankingsInternal,
        getStudentRankInternal: getStudentRankInternal,
        getRankingRecords: getRankingRecords,
        getRankingRecord: getRankingRecord,

        // ---- Constants ----
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        MIN_RANK: MIN_RANK
    };

})();
