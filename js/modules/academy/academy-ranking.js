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
 *   - Cross-domain cascade helpers (stripCharacterRefs, stripClassRefs)
 *
 * IMPORTANT:
 *   - This module OWNS ranking data - it does NOT depend on AcademyQueries.
 *   - Uses AcademyClasses for class existence checks (no circular dep).
 *   - Uses AcademyPerformance for the per-student aggregates. Ranking
 *     CONSUMES performance. It does NOT calculate averages.
 *   - Uses AcademyAggregator.getClassStudentsViewModel to resolve the
 *     class roster for auto-generate.
 *   - Uses CharacterQueries for name resolution ONLY in the enriched
 *     query variants. The base ranking record does not carry a name.
 *   - All MUTATIONS go through MutationPipeline.
 *   - All READS are synchronous and side-effect free.
 *   - Invalid inputs are REJECTED (mutation resolves with { success: false }).
 *   - Mutations are ATOMIC: if persistence fails, window.data is restored.
 *
 * READ SAFETY:
 *   - getAcademyStore() returns null (does NOT create academy.{...}) when
 *     the store is missing. Reads are side-effect free.
 *   - Public queries return DEEP CLONES. Callers cannot mutate live state.
 *   - Internal accessors return LIVE REFERENCES.
 *   - Pipeline validate() callbacks read from the `appData` argument.
 *   - ObjectUtils.deepClone throws if cloning fails or if the clone
 *     aliases the input.
 *
 * PERFORMANCE INTEGRATION (v30):
 *   - autoGenerate calls AcademyPerformance.calculateClassPerformance,
 *     which returns per-student aggregates in input order.
 *   - The performance layer does NOT order or rank. Ranking ordering
 *     and rank assignment live HERE, in this module.
 *   - autoGenerate sorts the aggregates by overall score (falling back
 *     to academic average), assigns rank numbers, then writes the
 *     ranking records.
 *   - Students with no score (academic null AND overall null) are
 *     SKIPPED. Writing a ranking record with rank: null for an
 *     ungraded student would produce records the UI cannot render.
 *     Absence of a record means "not yet graded".
 *
 *   MIGRATION COMPLETED (v30):
 *     AcademyPerformance.calculateRanking has been deleted. This
 *     module no longer references it. The ordering invariant (rank <=
 *     totalStudents) is enforced by this module's own sort and rank
 *     assignment pass, and validated by the pipeline validator
 *     against the transaction snapshot.
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
 *     This is the correct denominator for percentile. It is NOT a
 *     proxy for class size.
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
 * SCORE BOUND CONTRACT:
 *   - academicAverage, when present, must be in [0, 100].
 *   - socialScore, when present, must be in [0, 100].
 *   - overallScore, when present, must be in [0, 100].
 *
 * PERCENTILE SEMANTICS:
 *   calculatePercentile(rank, total) returns:
 *     ((total - rank + 1) / total) * 100
 *
 *   Rank 1 of 25 → 100. Rank 25 of 25 → 4.
 *
 *   This is "percentage of ranked students at or below this
 *   student's position, with rank 1 = 100%". It is NOT the
 *   statistics-textbook percentile.
 *
 * ENRICHED QUERY VARIANTS REMOVED (v30):
 *   The enriched `getClassRankings(classId, week, includeStudentDetails)`
 *   and `getStudentRank(classId, studentId, week, includeDetails)`
 *   forms, and the standalone `getRankingsWithDetails(classId, week)`,
 *   were removed. Names and student records belong to the aggregator
 *   layer, not the ranking query surface.
 *
 *   The current API:
 *     getClassRankings(classId, week)   — base records, decorated
 *     getStudentRank(classId, sid, wk)  — base record, decorated
 *
 *   Callers that want names call CharacterQueries.getCharacterById
 *   on the studentId, or go through the aggregator.
 *
 *   The only live consumer was the aggregator, which already calls
 *   `getClassRankings(classId, week, false)` and then reads names
 *   itself when it needs them. The enriched path was dead.
 *
 * TRANSACTION SNAPSHOT RULE:
 *   Every pipeline validate() callback resolves references against
 *   the appData argument it is handed. It does not read window.data.
 *
 * WEEK PARSING:
 *   Week parsing goes through CalendarValidation.parseWeek, the
 *   canonical strict parser.
 *
 * CASCADE STRICTNESS:
 *   stripCharacterRefs and stripClassRefs operate on a destructive
 *   cascade. A missing store is a no-op; a malformed store (present
 *   but not a plain object, or an array) is an error.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.ObjectUtils
 *   - window.IdUtils
 *   - window.ValidationUtils
 *   - window.CalendarValidation
 *   - window.CalendarConstants
 *   - window.AcademyPerformance        (calculateClassPerformance)
 *   - window.AcademyClasses
 *   - window.CharacterQueries          (uniqueness validation on
 *                                       candidate reference; not
 *                                       used for names)
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

    if (!window.AcademyPerformance ||
        typeof window.AcademyPerformance.calculateClassPerformance !== 'function') {
        missing.push('AcademyPerformance.calculateClassPerformance');
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
    var MIN_SCORE = 0;
    var MAX_SCORE = 100;

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

    function parseStrictInteger(value) {
        if (value === undefined || value === null) {
            return null;
        }

        if (typeof value === 'number') {
            return Number.isInteger(value) ? value : null;
        }

        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '') { return null; }
            if (!/^-?\d+$/.test(trimmed)) { return null; }
            var n = Number(trimmed);
            return Number.isInteger(n) ? n : null;
        }

        return null;
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

        var targetWeek = parseWeekStrict(week);

        for (var i = 0; i < records.length; i++) {
            var r = records[i];
            if (!r) continue;
            if (exclude !== null && String(r.id) === exclude) continue;
            if (String(r.classId) !== String(classId)) continue;
            if (String(r.studentId) !== String(studentId)) continue;
            if (parseWeekStrict(r.week) !== targetWeek) continue;
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
            var rank = parseStrictInteger(data.rank);
            if (rank === null || rank < MIN_RANK) {
                return { valid: false, message: 'Rank must be an integer greater than or equal to 1.' };
            }
        }

        if (data.totalStudents !== undefined) {
            var total = parseStrictInteger(data.totalStudents);
            if (total === null || total < 0) {
                return { valid: false, message: 'Total students must be an integer greater than or equal to 0.' };
            }
        }

        var scoreFields = ['academicAverage', 'socialScore', 'overallScore'];
        for (var i = 0; i < scoreFields.length; i++) {
            var field = scoreFields[i];
            var value = data[field];
            if (value === undefined || value === null) { continue; }
            var num = Number(value);
            if (!isFinite(num) || num < MIN_SCORE || num > MAX_SCORE) {
                return {
                    valid: false,
                    message: field + ' must be a finite number in [' +
                        MIN_SCORE + ', ' + MAX_SCORE + '].'
                };
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

        var rank = parseStrictInteger(candidate.rank);
        if (rank === null || rank < MIN_RANK) {
            return { valid: false, message: 'Candidate rank must be >= 1.' };
        }

        var total = parseStrictInteger(candidate.totalStudents);
        if (total === null || total < 0) {
            return { valid: false, message: 'Candidate totalStudents is invalid.' };
        }

        if (total > 0 && rank > total) {
            return {
                valid: false,
                message: 'Rank (' + rank + ') cannot exceed totalStudents (' + total + ').'
            };
        }

        var scoreFields = ['academicAverage', 'socialScore', 'overallScore'];
        for (var i = 0; i < scoreFields.length; i++) {
            var field = scoreFields[i];
            var value = candidate[field];
            if (value === null || value === undefined) { continue; }
            var num = Number(value);
            if (!isFinite(num) || num < MIN_SCORE || num > MAX_SCORE) {
                return {
                    valid: false,
                    message: 'Candidate ' + field + ' is out of range [' +
                        MIN_SCORE + ', ' + MAX_SCORE + '].'
                };
            }
        }

        return { valid: true };
    }

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

        var rank = parseStrictInteger(data.rank);
        var totalStudents = data.totalStudents !== undefined
            ? parseStrictInteger(data.totalStudents)
            : 0;

        var academicAverage = data.academicAverage !== undefined && data.academicAverage !== null
            ? Number(data.academicAverage)
            : null;
        var socialScore = data.socialScore !== undefined && data.socialScore !== null
            ? Number(data.socialScore)
            : null;
        var overallScore = data.overallScore !== undefined && data.overallScore !== null
            ? Number(data.overallScore)
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
    // PUBLIC API - RANKING CRUD
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

                if (findRankingInSnapshot(appData, targetId)) {
                    return { valid: false, message: 'Ranking ID collision.' };
                }

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
                    var rank = parseStrictInteger(value);
                    if (rank === null || rank < MIN_RANK) {
                        return Promise.resolve(failure('Rank must be an integer greater than or equal to 1.'));
                    }
                    if (candidate.rank !== rank) {
                        candidate.rank = rank;
                        hasChanges = true;
                    }
                    break;

                case 'totalStudents':
                    var total = parseStrictInteger(value);
                    if (total === null || total < 0) {
                        return Promise.resolve(failure('Total students must be an integer greater than or equal to 0.'));
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
                        var num = Number(value);
                        if (!isFinite(num) || num < MIN_SCORE || num > MAX_SCORE) {
                            return Promise.resolve(failure(
                                field + ' must be a finite number in [' +
                                MIN_SCORE + ', ' + MAX_SCORE + '].'
                            ));
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
    //
    // Base records, decorated with a derived percentile.
    //
    // Names are NOT attached. Callers that need them call
    // CharacterQueries.getCharacterById on the studentId, or route
    // through the aggregator.

    function getClassRankings(classId, week) {
        var rankings = getClassRankingsInternal(classId, week);
        return decorateRankings(rankings);
    }

    function getStudentRank(classId, studentId, week) {
        var rank = getStudentRankInternal(classId, studentId, week);

        if (!rank) {
            return null;
        }

        return decorateRanking(rank);
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
                topStudent = rank.studentId;
            }
            if (rankValue > maxRank) {
                maxRank = rankValue;
                bottomStudent = rank.studentId;
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
                distribution[binLabel] = { count: 0 };
            }

            distribution[binLabel].count++;
        }

        return distribution;
    }

    // ============================================================
    // AUTO-GENERATE RANKINGS FROM PERFORMANCE
    // ============================================================
    //
    // MIGRATION (v30):
    //   This module used to call AcademyPerformance.calculateRanking,
    //   which returned an ORDERED, RANK-ASSIGNED list. The
    //   performance layer has been reduced to
    //   calculateClassPerformance, which returns per-student
    //   aggregates in input order without any ordering or rank.
    //
    //   The ordering and rank assignment now live HERE, in
    //   assignRanks:
    //     1. Sort the aggregates by score (overall, falling back to
    //        academic), descending.
    //     2. Skip entries with no score at all.
    //     3. Assign rank 1 to the first placed entry, rank 2 to the
    //        second, and so on. Ties are ordered by studentId.
    //
    //   The rank bound invariant (rank <= totalStudents) is satisfied
    //   by construction, and validated by the pipeline.

    /**
     * Assign ranks to a list of performance aggregates.
     *
     * INPUT:
     *   An array of { studentId, academicAverage, socialScore,
     *   overallScore, disciplineCount, gradeCount }, in any order.
     *
     * OUTPUT:
     *   A sorted array of the same shape plus a `rank` field. Only
     *   entries with at least one score participate. Entries with
     *   both academicAverage and overallScore null are DROPPED.
     *
     *   totalStudents (the count of participants) is returned
     *   separately; callers use it as the record's denominator.
     */
    function assignRanks(entries) {
        if (!Array.isArray(entries) || entries.length === 0) {
            return { ranked: [], totalStudents: 0 };
        }

        var participants = [];
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (!e || !isNonEmptyString(e.studentId)) { continue; }

            var overall = isNumber(e.overallScore) ? e.overallScore : null;
            var academic = isNumber(e.academicAverage) ? e.academicAverage : null;

            if (overall === null && academic === null) {
                continue;
            }

            participants.push({
                studentId: String(e.studentId),
                academicAverage: academic,
                socialScore: isNumber(e.socialScore) ? e.socialScore : null,
                overallScore: overall,
                disciplineCount: isNumber(e.disciplineCount) ? e.disciplineCount : 0,
                gradeCount: isNumber(e.gradeCount) ? e.gradeCount : 0
            });
        }

        participants.sort(function(a, b) {
            var aVal = a.overallScore !== null ? a.overallScore : a.academicAverage;
            var bVal = b.overallScore !== null ? b.overallScore : b.academicAverage;

            if (aVal === null && bVal === null) {
                return a.studentId.localeCompare(b.studentId);
            }
            if (aVal === null) { return 1; }
            if (bVal === null) { return -1; }
            if (bVal !== aVal) { return bVal - aVal; }
            return a.studentId.localeCompare(b.studentId);
        });

        var totalStudents = participants.length;

        for (var j = 0; j < participants.length; j++) {
            participants[j].rank = j + 1;
        }

        return {
            ranked: participants,
            totalStudents: totalStudents
        };
    }

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

        // ---- Ask performance for the per-student aggregates ----
        //
        // calculateClassPerformance returns aggregates in the same
        // order as the input student IDs. It does NOT order them
        // and it does NOT assign rank.
        var aggregates;
        try {
            aggregates = AcademyPerformance.calculateClassPerformance(
                studentIds,
                classId,
                weekNum
            );
        } catch (e) {
            return Promise.resolve(failure('Failed to calculate performance: ' + e.message));
        }

        if (!Array.isArray(aggregates) || aggregates.length === 0) {
            return Promise.resolve(failure('No performance data available for this class and week.'));
        }

        // ---- Order and rank ----
        var ranked = assignRanks(aggregates);
        var rankedEntries = ranked.ranked;
        var totalStudents = ranked.totalStudents;

        if (rankedEntries.length === 0) {
            return Promise.resolve(failure('No students have grades for this class and week.'));
        }

        // ---- Plan ----
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

            var existing = getStudentRankInternal(classId, data.studentId, weekNum);

            if (existing && !overwrite) {
                planned.push({ action: 'skip' });
                continue;
            }

            if (existing) {
                var candidate = deepClone(existing);
                candidate.rank = data.rank;
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
                        rank: data.rank,
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

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy) {
                    return { valid: false, message: 'Academy data is not available.' };
                }

                if (!findClassInSnapshot(appData, classId)) {
                    return { valid: false, message: 'Class no longer exists.' };
                }

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
        //
        // Base records, decorated with a derived percentile.
        // Names are NOT attached. See the ENRICHED QUERY VARIANTS
        // REMOVED note in the header.
        getClassRankings: getClassRankings,
        getStudentRank: getStudentRank,
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
        MIN_RANK: MIN_RANK,
        MIN_SCORE: MIN_SCORE,
        MAX_SCORE: MAX_SCORE
    };

})();
