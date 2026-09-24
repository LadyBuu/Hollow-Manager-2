/**
 * js/modules/academy/academy-ranking.js - Academy Ranking
 * SINGLE SOURCE OF TRUTH for all academy ranking data and operations
 * Path: js/modules/academy/academy-ranking.js
 *
 * This module is responsible for:
 *   - Ranking CRUD operations (create, update, delete)
 *   - Ranking queries (get by class, student, week)
 *   - Ranking generation (autoGenerate from AcademyPerformance)
 *   - Ranking statistics (percentile, distribution)
 *   - Ranking validation
 *   - Cross-domain cascade helper (stripCharacterRefs)
 *
 * IMPORTANT:
 *   - This module OWNS ranking data - it does NOT depend on AcademyQueries.
 *   - Uses AcademyClasses for class existence checks (no circular dep).
 *   - Uses AcademyPerformance for the calculation. Ranking CONSUMES
 *     performance. It does NOT calculate averages.
 *   - Uses AcademyAggregator.getClassStudentsViewModel to resolve the
 *     class roster for auto-generate. The aggregator is the canonical
 *     roster source; AcademyQueries was the previous source and has
 *     been retired from this module.
 *   - Uses CharacterQueries for name resolution.
 *   - All MUTATIONS go through MutationPipeline.
 *   - All READS are synchronous and side-effect free.
 *   - Invalid inputs are REJECTED (mutation resolves with { success: false }).
 *   - Mutations are ATOMIC: if persistence fails, window.data is restored.
 *   - This module does NOT call saveData() directly - the pipeline does.
 *
 * READ SAFETY:
 *   - getAcademyStore() returns null (does NOT create academy.{...}) when
 *     the store is missing. Reads are side-effect free.
 *   - Public queries return DEEP CLONES. Callers cannot mutate live state.
 *   - Internal accessors return LIVE REFERENCES.
 *   - Pipeline validate() callbacks read from the `appData` argument.
 *   - Post-mutation reads inside mutate() callbacks read from the
 *     appData snapshot, not from window.data.
 *   - ObjectUtils.deepClone throws if cloning fails or if the clone
 *     aliases the input.
 *
 * PERFORMANCE INTEGRATION:
 *   - autoGenerate reads the ranking data from AcademyPerformance.
 *     It does NOT call AcademyGrades.calculateClassRanking.
 *   - Students with no score (academic null AND overall null) are SKIPPED.
 *     Writing a ranking record with rank: null for an ungraded student
 *     would produce records the UI cannot render. Absence of a record
 *     means "not yet graded".
 *
 * RANKING RECORD SHAPE:
 *   {
 *     id,                // rank_xxx
 *     classId,           // class_789
 *     studentId,         // char_456
 *     week,              // 5
 *     rank,              // 1
 *     totalStudents,     // 17
 *     academicAverage,   // 82.5 (number|null)
 *     socialScore,       // 88 (number|null)
 *     overallScore,      // 83.7 (number|null)
 *     createdAt,
 *     updatedAt
 *   }
 *
 *   TOTAL STUDENTS — MEANING:
 *     `totalStudents` is the number of students that received a
 *     ranking record for this (class, week) pair. It is NOT the
 *     number of students enrolled in the class.
 *
 *     Ungraded students do not receive a ranking record. If 25
 *     students are enrolled and 17 have grades this week,
 *     totalStudents is 17, and rank 17 is last.
 *
 *     This is the correct denominator for percentile: rank is
 *     relative to the ranked population, not the enrolled
 *     population. It is NOT a proxy for class size. Callers that
 *     need class size read it from the class roster.
 *
 *     The field name `totalStudents` is retained for storage
 *     stability. It is a historical name; its meaning is
 *     "ranked students this week", not "students in the class".
 *
 *   `score` and `averageScore` are REMOVED. The record carries the
 *   three scores produced by the performance layer.
 *   `percentile` is DERIVED on read from `rank` and `totalStudents`.
 *
 * UNIQUENESS CONTRACT:
 *   - The tuple (classId, studentId, week) is UNIQUE across the store.
 *   - Enforced pre-flight, in pipeline validate, and via input
 *     deduplication inside autoGenerate / saveRankings.
 *
 * RANK BOUND CONTRACT:
 *   - rank must be >= 1.
 *   - rank must be <= totalStudents.
 *
 * TRANSACTION SNAPSHOT RULE:
 *   Every pipeline validate() callback resolves references against
 *   the appData argument it is handed. It does not read window.data.
 *   Preflight reads against window.data are for early UX feedback
 *   only; the pipeline re-checks against the snapshot.
 *
 *   This applies to create, update, autoGenerate, and saveRankings.
 *   Foreign keys (classId, studentId) are validated against the
 *   snapshot, not against AcademyClasses or CharacterQueries.
 *
 * WEEK PARSING:
 *   Week parsing goes through CalendarValidation.parseWeek, the
 *   canonical strict parser. No `parseInt` coercion. "5bananas"
 *   is rejected, not silently accepted as 5.
 *
 * CASCADE STRICTNESS:
 *   stripCharacterRefs and stripClassRefs operate on a destructive
 *   cascade. A missing store is a no-op; a malformed store (present
 *   but not a plain object, or an array) is an error. Silently
 *   reporting a zero-count success on malformed state would let a
 *   corrupted store masquerade as "nothing to clean up".
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.ObjectUtils
 *   - window.IdUtils
 *   - window.ValidationUtils
 *   - window.CalendarValidation
 *   - window.CalendarConstants
 *   - window.AcademyPerformance
 *   - window.AcademyClasses
 *   - window.CharacterQueries
 *   - window.MutationPipeline
 *
 * DEPENDENCIES (LAZY, mandatory at call time):
 *   - window.AcademyAggregator    (class roster for auto-generate)
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

    if (!window.CalendarValidation || typeof window.CalendarValidation.parseWeek !== 'function') {
        missing.push('CalendarValidation.parseWeek');
    }

    if (!window.CalendarConstants ||
        typeof window.CalendarConstants.MIN_WEEK !== 'number' ||
        typeof window.CalendarConstants.MAX_WEEK !== 'number') {
        missing.push('CalendarConstants.MIN_WEEK/MAX_WEEK');
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
    if (!window.CharacterQueries || typeof window.CharacterQueries.getDisplayName !== 'function') {
        missing.push('CharacterQueries.getDisplayName');
    }

    if (!window.MutationPipeline || typeof window.MutationPipeline.performMutation !== 'function') {
        missing.push('MutationPipeline.performMutation');
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
    var CalendarValidation = window.CalendarValidation;
    var CalendarConstants = window.CalendarConstants;
    var AcademyPerformance = window.AcademyPerformance;
    var AcademyClasses = window.AcademyClasses;
    var CharacterQueries = window.CharacterQueries;
    var MutationPipeline = window.MutationPipeline;

    // ============================================================
    // LAZY DEPENDENCIES
    // ============================================================

    function getAcademyAggregator() {
        return window.AcademyAggregator || null;
    }

    /**
     * Resolve AcademyAggregator at call time, throwing when it is
     * missing. Used by autoGenerate to resolve the class roster.
     *
     * Lazy-but-mandatory: the module loads without it, but
     * autoGenerate cannot answer "which students are in this
     * class?" without it. Returning [] would turn "the dependency
     * is missing" into "the class has no students", which is
     * exactly the failure mode this migration removes.
     */
    function requireAcademyAggregator(contextLabel) {
        var AGG = getAcademyAggregator();
        if (!AGG ||
            typeof AGG.getClassStudentsViewModel !== 'function') {
            throw new Error(
                '[AcademyRanking] AcademyAggregator.getClassStudentsViewModel ' +
                'is required by ' + contextLabel + '. Check the script ' +
                'load order in index.html.'
            );
        }
        return AGG;
    }

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

    // ============================================================
    // WEEK PARSING — CANONICAL
    // ============================================================
    //
    // Week parsing goes through CalendarValidation.parseWeek.
    // Returns an integer in [MIN_WEEK, MAX_WEEK], or null.
    //
    // No `parseInt` coercion. "5bananas" is rejected. null is the
    // honest "this is not a week" answer; callers decide whether
    // to return an empty result, a failure, or throw.

    function parseWeekStrict(week) {
        var parsed = CalendarValidation.parseWeek(week);
        if (parsed === null) {
            return null;
        }
        if (parsed < MIN_WEEK || parsed > MAX_WEEK) {
            return null;
        }
        return parsed;
    }

    // ============================================================
    // UNIQUENESS KEY
    // ============================================================

    function makeUniqueKey(classId, studentId, week) {
        return String(classId) + '\u0000' + String(studentId) + '\u0000' + String(week);
    }

    function findConflictingRanking(classId, studentId, week, excludeId) {
        var records = getRankingRecords();
        var exclude = excludeId !== null && excludeId !== undefined ? String(excludeId) : null;

        for (var i = 0; i < records.length; i++) {
            var r = records[i];
            if (!r) continue;
            if (exclude !== null && String(r.id) === exclude) continue;
            if (String(r.classId) !== String(classId)) continue;
            if (String(r.studentId) !== String(studentId)) continue;
            if (parseWeekStrict(r.week) !== parseWeekStrict(week)) continue;
            return r;
        }
        return null;
    }

    function findConflictingRankingInSnapshot(appData, classId, studentId, week, excludeId) {
        if (!appData || !appData.academy || !appData.academy.rankings) {
            return null;
        }

        var rankings = appData.academy.rankings;
        if (!isObject(rankings)) {
            return null;
        }

        var exclude = excludeId !== null && excludeId !== undefined ? String(excludeId) : null;
        var targetWeek = parseWeekStrict(week);

        for (var id in rankings) {
            if (!Object.prototype.hasOwnProperty.call(rankings, id)) continue;
            var r = rankings[id];
            if (!r) continue;
            if (exclude !== null && String(r.id) === exclude) continue;
            if (String(r.classId) !== String(classId)) continue;
            if (String(r.studentId) !== String(studentId)) continue;
            if (parseWeekStrict(r.week) !== targetWeek) continue;
            return r;
        }
        return null;
    }

    // ============================================================
    // SNAPSHOT-AWARE LOOKUPS
    // ============================================================
    //
    // Used by pipeline validate() callbacks. Read from the appData
    // snapshot, not window.data.

    function findRankingInSnapshot(appData, rankId) {
        if (!appData || !appData.academy) {
            return null;
        }
        var rankings = appData.academy.rankings;
        if (!isObject(rankings)) {
            return null;
        }
        var record = rankings[String(rankId)];
        if (!isObject(record)) {
            return null;
        }
        return record;
    }

    function findClassInSnapshot(appData, classId) {
        if (!appData || !appData.academy) {
            return null;
        }
        var store = appData.academy.graduatingClasses;
        if (!isObject(store)) {
            return null;
        }
        if (!isNonEmptyString(classId)) {
            return null;
        }
        return store[String(classId)] || null;
    }

    function findCharacterInSnapshot(appData, charId) {
        if (!appData || !Array.isArray(appData.characters)) {
            return null;
        }
        if (!isNonEmptyString(charId)) {
            return null;
        }
        var target = String(charId);
        for (var i = 0; i < appData.characters.length; i++) {
            var c = appData.characters[i];
            if (c && String(c.id) === target) {
                return c;
            }
        }
        return null;
    }

    // ============================================================
    // DERIVED FIELD HELPERS
    // ============================================================

    function calculatePercentile(rank, total) {
        if (!isNumber(total) || total <= 0) {
            return 0;
        }
        if (!isNumber(rank) || rank <= 0) {
            return 0;
        }
        return Math.round(((total - rank + 1) / total) * 100);
    }

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

        var filterClass = isNonEmptyString(classId) ? String(classId) : null;

        // Week filter. A provided-but-invalid week is a filter that
        // matches nothing, not "no filter". The previous behaviour
        // was `if (!isNaN(weekNum) && ...)`, which turned malformed
        // input into "don't filter" and returned everything.
        var filterWeek = null;
        if (week !== undefined) {
            filterWeek = parseWeekStrict(week);
            if (filterWeek === null) {
                return [];
            }
        }

        for (var id in academy.rankings) {
            if (Object.prototype.hasOwnProperty.call(academy.rankings, id)) {
                var rank = academy.rankings[id];
                if (!rank) continue;

                if (filterClass !== null && String(rank.classId) !== filterClass) {
                    continue;
                }

                if (filterWeek !== null && parseWeekStrict(rank.week) !== filterWeek) {
                    continue;
                }

                result.push(rank);
            }
        }

        result.sort(function(a, b) {
            return (a.rank || 999) - (b.rank || 999);
        });

        return result;
    }

    /**
     * Internal class rankings lookup.
     *
     * An invalid week is rejected with an empty array. The
     * previous behaviour coerced an invalid week to week 1, which
     * produced valid-looking data for a query the caller could not
     * have meant.
     */
    function getClassRankingsInternal(classId, week) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return [];
        }

        return getRankingRecords(classId, weekNum);
    }

    function getStudentRankInternal(classId, studentId, week) {
        if (!isNonEmptyString(classId) || !isNonEmptyString(studentId)) {
            return null;
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return null;
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

    function getClassRankingsFromSnapshot(appData, classId, weekNum) {
        if (!appData || !appData.academy || !appData.academy.rankings) {
            return [];
        }

        var rankings = appData.academy.rankings;
        if (!isObject(rankings)) {
            return [];
        }

        var targetClass = String(classId);
        var result = [];

        for (var id in rankings) {
            if (Object.prototype.hasOwnProperty.call(rankings, id)) {
                var rank = rankings[id];
                if (!rank) continue;
                if (String(rank.classId) !== targetClass) continue;
                if (parseWeekStrict(rank.week) !== weekNum) continue;
                result.push(deepClone(rank));
            }
        }

        result.sort(function(a, b) {
            return (a.rank || 999) - (b.rank || 999);
        });

        return result;
    }

    // ============================================================
    // PREFLIGHT CLASS VALIDATION (live reads, UX only)
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
            var week = parseWeekStrict(data.week);
            if (week === null) {
                return {
                    valid: false,
                    message: 'Valid week is required (' +
                        MIN_WEEK + '-' + MAX_WEEK + ').'
                };
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

        if (data.academicAverage !== undefined && data.academicAverage !== null) {
            var aa = parseFloat(data.academicAverage);
            if (isNaN(aa) || aa < 0) {
                return { valid: false, message: 'Academic average must be a number greater than or equal to 0.' };
            }
        }

        if (data.socialScore !== undefined && data.socialScore !== null) {
            var ss = parseFloat(data.socialScore);
            if (isNaN(ss) || ss < 0) {
                return { valid: false, message: 'Social score must be a number greater than or equal to 0.' };
            }
        }

        if (data.overallScore !== undefined && data.overallScore !== null) {
            var os = parseFloat(data.overallScore);
            if (isNaN(os) || os < 0) {
                return { valid: false, message: 'Overall score must be a number greater than or equal to 0.' };
            }
        }

        return { valid: true };
    }

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

        var week = parseWeekStrict(candidate.week);
        if (week === null) {
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

        // Score fields are optional. Each, if present, must be a
        // finite non-negative number.
        var scoreFields = ['academicAverage', 'socialScore', 'overallScore'];
        for (var i = 0; i < scoreFields.length; i++) {
            var field = scoreFields[i];
            var value = candidate[field];
            if (value === null || value === undefined) { continue; }
            var num = parseFloat(value);
            if (isNaN(num) || num < 0) {
                return { valid: false, message: 'Candidate ' + field + ' is invalid.' };
            }
        }

        return { valid: true };
    }

    /**
     * Authoritative candidate validation against the transaction
     * snapshot.
     *
     * Checks:
     *   - the candidate's structural validity (delegated to
     *     validateCandidate)
     *   - the class exists in the snapshot
     *   - the student exists in the snapshot
     *   - if excludeId is provided, the ranking record exists in
     *     the snapshot (update path)
     *   - no conflicting ranking for (classId, studentId, week)
     *     in the snapshot, excluding the record being updated
     *
     * Returns { valid, message? }.
     */
    function validateCandidateAgainstSnapshot(candidate, appData, excludeId) {
        var structural = validateCandidate(candidate);
        if (!structural.valid) {
            return structural;
        }

        if (!findClassInSnapshot(appData, candidate.classId)) {
            return {
                valid: false,
                message: 'Class no longer exists: ' + candidate.classId
            };
        }

        if (!findCharacterInSnapshot(appData, candidate.studentId)) {
            return {
                valid: false,
                message: 'Student no longer exists: ' + candidate.studentId
            };
        }

        if (excludeId !== null && excludeId !== undefined) {
            if (!findRankingInSnapshot(appData, excludeId)) {
                return {
                    valid: false,
                    message: 'Ranking no longer exists.'
                };
            }
        }

        var conflict = findConflictingRankingInSnapshot(
            appData,
            candidate.classId,
            candidate.studentId,
            candidate.week,
            excludeId
        );
        if (conflict) {
            return {
                valid: false,
                message: 'A ranking already exists for this student, ' +
                    'class, and week.'
            };
        }

        return { valid: true };
    }

    // ============================================================
    // INTERNAL CANDIDATE BUILDER
    // ============================================================

    function buildRankingRecord(data, existingId, existingCreatedAt) {
        var now = new Date().toISOString();

        var weekNum = parseWeekStrict(data.week);
        if (weekNum === null) {
            throw new Error(
                '[AcademyRanking] buildRankingRecord received an ' +
                'invalid week: ' + String(data.week)
            );
        }

        var rank = parseInt(data.rank, 10);
        var totalStudents = data.totalStudents !== undefined
            ? parseInt(data.totalStudents, 10)
            : 0;

        var academicAverage = data.academicAverage !== undefined && data.academicAverage !== null
            ? parseFloat(data.academicAverage)
            : null;
        var socialScore = data.socialScore !== undefined && data.socialScore !== null
            ? parseFloat(data.socialScore)
            : null;
        var overallScore = data.overallScore !== undefined && data.overallScore !== null
            ? parseFloat(data.overallScore)
            : null;

        return {
            id: existingId || generateId(),
            classId: String(data.classId),
            studentId: String(data.studentId),
            week: weekNum,
            rank: rank,
            totalStudents: totalStudents,
            academicAverage: academicAverage,
            socialScore: socialScore,
            overallScore: overallScore,
            createdAt: existingCreatedAt || now,
            updatedAt: now
        };
    }

    // ============================================================
    // PUBLIC API - RANKING CRUD (Promise-based, via MutationPipeline)
    // ============================================================

    function create(data) {
        var validation = validateRankingData(data, false);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.message));
        }

        var classValidation = validateClassExists(data.classId);
        if (!classValidation.valid) {
            return Promise.resolve(failure(classValidation.message));
        }

        var conflict = findConflictingRanking(data.classId, data.studentId, data.week, null);
        if (conflict) {
            return Promise.resolve(failure(
                'A ranking already exists for this student, class, and week. Use update instead.'
            ));
        }

        var newRanking;
        try {
            newRanking = buildRankingRecord(data, null, null);
        } catch (e) {
            return Promise.resolve(failure(e.message));
        }

        var candidateCheck = validateCandidate(newRanking);
        if (!candidateCheck.valid) {
            return Promise.resolve(failure(candidateCheck.message));
        }

        var targetId = newRanking.id;

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || typeof appData !== 'object') {
                    return { valid: false, message: 'Application data is not available.' };
                }

                // ID collision.
                if (findRankingInSnapshot(appData, targetId)) {
                    return { valid: false, message: 'Ranking ID collision.' };
                }

                // Authoritative validation against the snapshot.
                return validateCandidateAgainstSnapshot(
                    newRanking, appData, null
                );
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
        var updateFields = [
            'classId', 'studentId', 'week', 'rank', 'totalStudents',
            'academicAverage', 'socialScore', 'overallScore'
        ];

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
                    var week = parseWeekStrict(value);
                    if (week === null) {
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

                case 'academicAverage':
                case 'socialScore':
                case 'overallScore':
                    if (value === null) {
                        if (candidate[field] !== null) {
                            candidate[field] = null;
                            hasChanges = true;
                        }
                    } else {
                        var num = parseFloat(value);
                        if (isNaN(num) || num < 0) {
                            return Promise.resolve(failure(field + ' must be a number greater than or equal to 0.'));
                        }
                        if (candidate[field] !== num) {
                            candidate[field] = num;
                            hasChanges = true;
                        }
                    }
                    break;
            }
        }

        if (!hasChanges) {
            return Promise.resolve(success({ ranking: decorateRanking(existing), changed: false }));
        }

        var candidateCheck = validateCandidate(candidate);
        if (!candidateCheck.valid) {
            return Promise.resolve(failure(candidateCheck.message));
        }

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

                // Authoritative validation against the snapshot.
                return validateCandidateAgainstSnapshot(
                    candidate, appData, targetId
                );
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
                if (!findRankingInSnapshot(appData, target)) {
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

    function deleteClassRankings(classId, week) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
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
                        if (rank && String(rank.classId) === targetClass && parseWeekStrict(rank.week) === weekNum) {
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
     *   2. Resolve the class roster via AcademyAggregator.
     *   3. Ask AcademyPerformance for the ranked list. Performance
     *      owns the calculation; this module does not compute
     *      averages itself.
     *   4. Plan ALL writes (create/update/skip) without touching
     *      window.data. Deduplicate by (classId, studentId, week).
     *   5. Apply all planned writes in a SINGLE pipeline transaction.
     *      The transaction revalidates the plan against the snapshot.
     *   6. Return the post-mutation state read from the appData
     *      snapshot.
     *
     * SKIPPED STUDENTS:
     *   - Students with no score (overall AND academic both null) are
     *     skipped. No record is written.
     *
     * UNIQUENESS:
     *   - The (classId, studentId, week) tuple is unique.
     *
     * totalStudents:
     *   - Set to the number of students who received a ranking
     *     record this week. See the file header for the full
     *     meaning.
     */
    function autoGenerate(classId, week, options) {
        if (!isNonEmptyString(classId)) {
            return Promise.resolve(failure('Class ID is required.'));
        }

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
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
            try {
                studentIds = resolveClassStudentIds(classId);
            } catch (e) {
                return Promise.resolve(failure(e.message));
            }
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
        var rankedEntries = [];
        for (var i = 0; i < rankingData.length; i++) {
            var entry = rankingData[i];
            if (!entry) { continue; }
            if (entry.rank === null) { continue; }
            var hasScore = (entry.overallScore !== null && entry.overallScore !== undefined) ||
                           (entry.academicAverage !== null && entry.academicAverage !== undefined);
            if (!hasScore) { continue; }
            rankedEntries.push(entry);
        }

        if (rankedEntries.length === 0) {
            return Promise.resolve(failure('No students have grades for this class and week.'));
        }

        // ---- Plan ----
        // totalStudents counts the ranked students this week. See
        // the file header for the semantic distinction from class
        // size.
        var totalStudents = rankedEntries.length;
        var planned = [];
        var errors = [];
        var seenKeys = {};

        for (var j = 0; j < rankedEntries.length; j++) {
            var data = rankedEntries[j];

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
                candidate.academicAverage = data.academicAverage;
                candidate.socialScore = data.socialScore;
                candidate.overallScore = data.overallScore;
                candidate.updatedAt = new Date().toISOString();
                planned.push({ action: 'update', record: candidate, matchId: existing.id });
            } else {
                var newRecord;
                try {
                    newRecord = buildRankingRecord({
                        classId: classId,
                        studentId: data.studentId,
                        week: weekNum,
                        rank: rankPosition,
                        totalStudents: totalStudents,
                        academicAverage: data.academicAverage,
                        socialScore: data.socialScore,
                        overallScore: data.overallScore
                    }, null, null);
                } catch (e) {
                    errors.push({ studentId: data.studentId, error: e.message });
                    continue;
                }
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

                // The class must still exist in the snapshot.
                if (!findClassInSnapshot(appData, classId)) {
                    return { valid: false, message: 'Class no longer exists.' };
                }

                // Revalidate each planned action against the snapshot.
                // The plan is a set of creates and updates; every
                // target must still be consistent.
                for (var i = 0; i < planned.length; i++) {
                    var item = planned[i];

                    if (item.action === 'create') {
                        if (findRankingInSnapshot(appData, item.record.id)) {
                            return {
                                valid: false,
                                message: 'Ranking ID collision during ' +
                                    'auto-generate: ' + item.record.id
                            };
                        }
                        var createCheck = validateCandidateAgainstSnapshot(
                            item.record, appData, null
                        );
                        if (!createCheck.valid) {
                            return createCheck;
                        }
                    } else if (item.action === 'update') {
                        if (!findRankingInSnapshot(appData, item.matchId)) {
                            return {
                                valid: false,
                                message: 'Ranking no longer exists: ' +
                                    item.matchId
                            };
                        }
                        var updateCheck = validateCandidateAgainstSnapshot(
                            item.record, appData, item.matchId
                        );
                        if (!updateCheck.valid) {
                            return updateCheck;
                        }
                    }
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
     * Resolve the class's student IDs.
     *
     * DERIVED ROSTER. The aggregator derives it from
     * character.classIds and excludes instructors.
     *
     * The previous implementation called
     * AcademyQueries.getClassStudentIds, which read the same
     * underlying character data but through a legacy facade. That
     * facade is being retired. The aggregator is the canonical
     * source.
     *
     * Lazy-but-mandatory: the aggregator is resolved at call time
     * and throws when absent. It does NOT return [] for a missing
     * dependency. An empty array means "the class has no students";
     * a missing dependency is a load-order failure that must
     * surface.
     *
     * @returns {array} Array of student ID strings
     * @throws {Error} when AcademyAggregator is unavailable
     */
    function resolveClassStudentIds(classId) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var AGG = requireAcademyAggregator(
            'resolveClassStudentIds'
        );

        var students = AGG.getClassStudentsViewModel(classId);

        if (!Array.isArray(students)) {
            throw new Error(
                '[AcademyRanking] AcademyAggregator.getClassStudentsViewModel ' +
                'returned a non-array. This is an aggregator bug.'
            );
        }

        var result = [];
        for (var i = 0; i < students.length; i++) {
            var s = students[i];
            if (!s || !s.id) { continue; }
            result.push(String(s.id));
        }
        return result;
    }

    // ============================================================
    // CASCADE HELPERS
    // ============================================================

    /**
     * Read the rankings store from the snapshot.
     *
     * A missing store is a legitimate no-op for a cascade (there
     * are no rankings to clean up). A store that is present but
     * malformed is an error: silently reporting a zero-count
     * success would let a corrupted store masquerade as empty.
     *
     * Returns the store, or null when the store is absent.
     * Throws when the store is present but malformed.
     */
    function readRankingsStoreForCascade(appData, helperName) {
        if (!appData || !appData.academy) {
            return null;
        }

        var rankings = appData.academy.rankings;

        if (rankings === undefined || rankings === null) {
            return null;
        }

        if (typeof rankings !== 'object' || Array.isArray(rankings)) {
            throw new Error(
                '[AcademyRanking] ' + helperName + ' found a malformed ' +
                'academy.rankings store on the snapshot. Expected a ' +
                'plain object; got ' +
                (Array.isArray(rankings) ? 'array' : typeof rankings) +
                '. The cascade cannot proceed against corrupted state.'
            );
        }

        return rankings;
    }

    function stripCharacterRefs(appData, charId) {
        var result = { rankingsRemoved: 0 };

        if (!appData || !charId) {
            return result;
        }

        var rankings = readRankingsStoreForCascade(
            appData, 'stripCharacterRefs'
        );
        if (!rankings) {
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

    /**
     * Strip all ranking records for a class.
     * Called from AcademyClasses.delete cascade.
     */
    function stripClassRefs(appData, classId) {
        var result = { rankingsRemoved: 0 };

        if (!appData || !classId) {
            return result;
        }

        var rankings = readRankingsStoreForCascade(
            appData, 'stripClassRefs'
        );
        if (!rankings) {
            return result;
        }

        var target = String(classId);
        var keysToRemove = [];

        Object.keys(rankings).forEach(function(id) {
            var rank = rankings[id];
            if (rank && String(rank.classId) === target) {
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
                var candidate;
                try {
                    candidate = buildRankingRecord(data, existing.id, existing.createdAt);
                } catch (e) {
                    errors.push({ index: i, error: e.message });
                    continue;
                }
                var candidateCheck = validateCandidate(candidate);
                if (!candidateCheck.valid) {
                    errors.push({ index: i, error: candidateCheck.message });
                    continue;
                }
                planned.push({ action: 'update', record: candidate, matchId: existing.id });
            } else {
                var newRecord;
                try {
                    newRecord = buildRankingRecord(data, null, null);
                } catch (e) {
                    errors.push({ index: i, error: e.message });
                    continue;
                }
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

                // Revalidate the entire plan against the snapshot.
                // This is the plan/apply invariant: what we planned
                // must still be consistent with what we are
                // committing to.
                for (var i = 0; i < planned.length; i++) {
                    var item = planned[i];

                    if (item.action === 'create') {
                        if (findRankingInSnapshot(appData, item.record.id)) {
                            return {
                                valid: false,
                                message: 'Ranking ID collision during ' +
                                    'save: ' + item.record.id
                            };
                        }
                        var createCheck = validateCandidateAgainstSnapshot(
                            item.record, appData, null
                        );
                        if (!createCheck.valid) {
                            return createCheck;
                        }
                    } else if (item.action === 'update') {
                        if (!findRankingInSnapshot(appData, item.matchId)) {
                            return {
                                valid: false,
                                message: 'Ranking no longer exists: ' +
                                    item.matchId
                            };
                        }
                        var updateCheck = validateCandidateAgainstSnapshot(
                            item.record, appData, item.matchId
                        );
                        if (!updateCheck.valid) {
                            return updateCheck;
                        }
                    }
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
        stripClassRefs: stripClassRefs,

        // ---- Internal (LIVE REFERENCES) ----
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
