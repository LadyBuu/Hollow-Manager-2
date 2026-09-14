/**
 * js/modules/academy/academy-ranking.js - Academy Ranking
 * SINGLE SOURCE OF TRUTH for all academy ranking data and operations
 * Path: js/modules/academy/academy-ranking.js
 *
 * This module is responsible for:
 *   - Ranking CRUD operations (create, update, delete)
 *   - Ranking queries (get by class, student, week)
 *   - Ranking calculations (auto-generation from grades)
 *   - Ranking statistics (percentile, distribution)
 *   - Ranking validation
 *   - Cross-domain cascade helper (stripCharacterRefs)
 *
 * IMPORTANT:
 *   - This module OWNS ranking data - it does NOT depend on AcademyQueries
 *   - Uses AcademyClasses for class data (no circular dependency)
 *   - Uses AcademyGrades for grade data (legitimate dependency)
 *   - All MUTATIONS go through MutationPipeline (persistence, rollback, logging)
 *   - All READS are synchronous and side-effect free
 *   - Invalid inputs are REJECTED (mutation resolves with { success: false })
 *   - Mutations are ATOMIC: if persistence fails, window.data is restored
 *   - This module does NOT call saveData() directly - the pipeline does
 *   - AcademyQueries is the PUBLIC read facade that uses these internal lookups
 *
 * READ SAFETY (Phase 2):
 *   - getAcademyStore() returns null (does NOT create academy.{...}) when
 *     the store is missing. Reads are side-effect free.
 *   - Public queries (getClassRankings, getStudentRank, getRankingsWithDetails,
 *     getRankings, getRanking) return DEEP CLONES. Callers cannot mutate
 *     live state by writing to a returned ranking.
 *   - Internal accessors (getRankingRecord, getRankingRecords,
 *     getClassRankingsInternal, getStudentRankInternal) keep returning LIVE
 *     REFERENCES. They are consumed by this module's own mutation paths
 *     and by AcademyQueries.
 *   - Pipeline validate() callbacks read from the `appData` argument the
 *     pipeline supplies, not from window.data via the internal accessors.
 *   - Post-mutation reads inside mutate() callbacks read from the appData
 *     snapshot, not from window.data. This makes the returned data
 *     consistent with what was actually written.
 *   - ObjectUtils.deepClone is used as the clone primitive. If cloning
 *     fails, the accessor throws. It does NOT fall back to returning the
 *     original reference, because that would silently alias live state.
 *
 * MUTATION CONTRACT:
 *   - create / update / delete / deleteClassRankings / autoGenerate / saveRankings
 *     all return Promise<{ success, data?, message? }>
 *   - getClassRankings / getStudentRank / getRankingsWithDetails / getRankings /
 *     getRanking and all calculate* functions stay synchronous
 *
 * AUTO-GENERATE SEMANTICS:
 *   - autoGenerate is a compound operation: it reads grades, computes
 *     rankings, and writes them. It plans ALL writes in a pre-flight
 *     pass, then applies them in a SINGLE pipeline transaction. It does
 *     NOT call create / update in a loop.
 *
 * CASCADE SEMANTICS (stripCharacterRefs):
 *   When a character is deleted, all ranking records keyed to that
 *   character are removed from academy.rankings. This helper is called
 *   by CharacterCRUD.deleteCharacter from inside its pipeline mutate,
 *   so it runs in the same transaction as the character removal.
 *
 * RANKING DATA STRUCTURE:
 *   window.data.academy.rankings = {
 *     'rank_123': {
 *       id: 'rank_123',
 *       classId: 'class_789',
 *       studentId: 'char_456',
 *       week: 5,
 *       rank: 1,
 *       totalStudents: 25,
 *       percentile: 96,
 *       averageScore: 85.5,
 *       score: 92,
 *       createdAt: '2026-02-15T10:00:00Z',
 *       updatedAt: '2026-02-15T10:00:00Z'
 *     }
 *   }
 *
 * DEPENDENCIES:
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 *   - window.ValidationUtils (from validation-utils.js) - MANDATORY
 *   - window.AcademyGrades (from academy-grades.js) - MANDATORY
 *   - window.AcademyClasses (from academy-classes.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 *
 * USAGE:
 *   var rankings = window.AcademyRanking;
 *
 *   // Mutations (Promise-based)
 *   rankings.autoGenerate('class_789', 5).then(function(result) { ... });
 *
 *   // Reads (synchronous)
 *   var classRankings = rankings.getClassRankings('class_789', 5);
 *   var studentRank = rankings.getStudentRank('class_789', 'char_456', 5);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
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

    if (!window.AcademyGrades || typeof window.AcademyGrades.getClassGrades !== 'function') {
        missing.push('AcademyGrades.getClassGrades');
    }
    if (!window.AcademyGrades || typeof window.AcademyGrades.calculateSummary !== 'function') {
        missing.push('AcademyGrades.calculateSummary');
    }
    if (!window.AcademyGrades || typeof window.AcademyGrades.calculateClassRanking !== 'function') {
        missing.push('AcademyGrades.calculateClassRanking');
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
    var AcademyGrades = window.AcademyGrades;
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

    /**
     * Deep clone a value.
     *
     * READ SAFETY: this primitive throws if cloning fails. It does NOT
     * fall back to returning the original reference, because that would
     * silently alias live state and let callers mutate the store by
     * writing to a "cloned" result.
     *
     * @param {*} value - Value to clone
     * @returns {*} Deep clone
     * @throws {Error} If cloning fails
     */
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

    function calculatePercentile(rank, total) {
        if (total <= 0 || rank <= 0) {
            return 0;
        }
        return Math.round(((total - rank + 1) / total) * 100);
    }

    // ============================================================
    // DATA STORE ACCESS - INTERNAL (no AcademyQueries dependency)
    // ============================================================
    //
    // READ SAFETY:
    //   - getDataStore() returns null when window.data is missing.
    //   - getAcademyStore() returns null when window.data.academy is
    //     missing. It does NOT create academy.{...} as a side effect
    //     of a read.
    //
    //   Structure creation happens ONLY inside pipeline mutate()
    //   callbacks, operating on the appData snapshot the pipeline
    //   hands in. That keeps reads side-effect free.

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
    //
    // These return LIVE REFERENCES. They are consumed by this
    // module's own mutation paths and by AcademyQueries. The public
    // read surface (below) wraps them with deepClone.

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
                if (!rank) {
                    continue;
                }

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

    // ============================================================
    // INTERNAL SNAPSHOT LOOKUP
    // ============================================================
    //
    // These read from an appData snapshot rather than window.data.
    // They exist so post-mutation reads inside pipeline mutate()
    // callbacks stay consistent with the transaction that just ran.

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
                if (!rank) {
                    continue;
                }
                if (String(rank.classId) !== targetClass) {
                    continue;
                }
                if (rank.week !== weekNum) {
                    continue;
                }
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

        if (data.score !== undefined) {
            var score = parseFloat(data.score);
            if (isNaN(score) || score < 0) {
                return { valid: false, message: 'Score must be a number greater than or equal to 0.' };
            }
        }

        if (data.averageScore !== undefined) {
            var avg = parseFloat(data.averageScore);
            if (isNaN(avg) || avg < 0) {
                return { valid: false, message: 'Average score must be a number greater than or equal to 0.' };
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
        var score = data.score !== undefined ? parseFloat(data.score) : null;
        var averageScore = data.averageScore !== undefined ? parseFloat(data.averageScore) : null;
        var percentile = data.percentile !== undefined
            ? parseFloat(data.percentile)
            : calculatePercentile(rank, totalStudents);

        return {
            id: existingId || generateId(),
            classId: String(data.classId),
            studentId: String(data.studentId),
            week: parseInt(data.week, 10),
            rank: rank,
            totalStudents: totalStudents,
            percentile: clamp(percentile, 0, 100),
            score: score,
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
     * @param {object} data - Ranking data
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
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

        // Pre-flight duplicate check
        var existing = getStudentRankInternal(data.classId, data.studentId, data.week);
        if (existing) {
            return Promise.resolve(failure('Ranking already exists for this student, class, and week. Use update instead.'));
        }

        var newRanking = buildRankingRecord(data, null, null);
        var targetId = newRanking.id;

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy) {
                    return { valid: false, message: 'Academy data is not available.' };
                }
                if (appData.academy.rankings && appData.academy.rankings[targetId]) {
                    return { valid: false, message: 'Ranking ID collision.' };
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
     * @param {string} rankId - Ranking ID
     * @param {object} updates - Updates to apply
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
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

        var candidate = deepClone(existing);
        if (candidate === null) {
            return Promise.resolve(failure('Failed to clone ranking data.'));
        }

        var hasChanges = false;
        var updateFields = ['classId', 'studentId', 'week', 'rank', 'totalStudents', 'score', 'averageScore'];

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
                        candidate.percentile = calculatePercentile(rank, candidate.totalStudents);
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
                        candidate.percentile = calculatePercentile(candidate.rank, total);
                    }
                    break;

                case 'score':
                    var score = parseFloat(value);
                    if (isNaN(score) || score < 0) {
                        return Promise.resolve(failure('Score must be a number greater than or equal to 0.'));
                    }
                    if (candidate.score !== score) {
                        candidate.score = score;
                        hasChanges = true;
                    }
                    break;

                case 'averageScore':
                    var avg = parseFloat(value);
                    if (isNaN(avg) || avg < 0) {
                        return Promise.resolve(failure('Average score must be a number greater than or equal to 0.'));
                    }
                    if (candidate.averageScore !== avg) {
                        candidate.averageScore = avg;
                        hasChanges = true;
                    }
                    break;
            }
        }

        if (!hasChanges) {
            return Promise.resolve(success({ ranking: deepClone(existing), changed: false }));
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
     *
     * @param {string} rankId - Ranking ID
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
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
     *
     * @param {string} classId - Class ID
     * @param {number} week - Week number
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
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
    // These are the consumer-facing lookups. They return DEEP CLONES
    // (or arrays of clones) so callers cannot mutate live state by
    // writing to a returned ranking. Internal code paths within this
    // module continue to use the *Internal accessors, which return
    // live references.

    function getClassRankings(classId, week, includeStudentDetails) {
        var rankings = getClassRankingsInternal(classId, week);

        if (!includeStudentDetails) {
            var result = [];
            for (var i = 0; i < rankings.length; i++) {
                result.push(deepClone(rankings[i]));
            }
            return result;
        }

        var enriched = [];
        for (var j = 0; j < rankings.length; j++) {
            var rank = deepClone(rankings[j]);
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

        var result = deepClone(rank);

        if (includeDetails) {
            var student = CharacterQueries.getCharacterById(result.studentId);
            if (student) {
                result.studentName = CharacterQueries.getDisplayName(student);
                result.student = student;
            }

            var allRankings = getClassRankingsInternal(classId, week);
            result.totalRanked = allRankings.length;
            result.percentile = calculatePercentile(result.rank, result.totalRanked);
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
        var result = [];
        for (var i = 0; i < records.length; i++) {
            result.push(deepClone(records[i]));
        }
        return result;
    }

    function getRanking(rankId) {
        var rank = getRankingRecord(rankId);
        return rank ? deepClone(rank) : null;
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

            var percentile = rank.percentile || 0;
            var binKey = Math.floor(percentile / binSize) * binSize;

            var binLabel = binKey + '-' + Math.min(binKey + binSize - 1, 100);
            if (binKey >= 100) {
                binLabel = '100';
            }

            if (!distribution[binLabel]) {
                distribution[binLabel] = {
                    count: 0,
                    students: []
                };
            }

            distribution[binLabel].count++;
            if (rank.studentName) {
                distribution[binLabel].students.push(rank.studentName);
            }
        }

        return distribution;
    }

    // ============================================================
    // AUTO-GENERATE RANKINGS FROM GRADES (Promise-based)
    // ============================================================

    /**
     * Auto-generate rankings from grade data.
     *
     * PLAN / APPLY:
     *   1. Validate inputs.
     *   2. Read grades and compute ranking data (READ).
     *   3. Plan ALL writes (create/update/skip) without touching
     *      window.data.
     *   4. Apply all planned writes in a SINGLE pipeline transaction.
     *
     * POST-MUTATION READ:
     *   The rankings returned in `data.rankings` are read from the
     *   appData snapshot after the mutation has been applied to it.
     *   They reflect what was actually written in this transaction,
     *   not whatever state window.data happens to be in.
     *
     * @param {string} classId - Class ID
     * @param {number} week - Week number
     * @param {object} options - Generation options
     * @param {boolean} options.overwrite - Overwrite existing rankings (default: true)
     * @param {number} options.weightThreshold - Minimum weight to include
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
        var weightThreshold = options.weightThreshold || 0.5;

        var classValidation = validateClassExists(classId);
        if (!classValidation.valid) {
            return Promise.resolve(failure(classValidation.message));
        }

        // ---- READ: get grades and calculate rankings ----
        var grades = AcademyGrades.getClassGrades(classId, weekNum);
        if (grades.length === 0) {
            return Promise.resolve(failure('No grades found for this class and week.'));
        }

        var rankingData = AcademyGrades.calculateClassRanking(
            classId,
            weekNum,
            CharacterQueries.getCharacterById
        );

        if (!rankingData || rankingData.length === 0) {
            return Promise.resolve(failure('Failed to calculate rankings from grades.'));
        }

        // ---- PLAN: for each computed ranking, decide create/update/skip ----
        var totalStudents = rankingData.length;
        var planned = [];

        for (var i = 0; i < rankingData.length; i++) {
            var data = rankingData[i];
            var rankPosition = data.rank || (i + 1);
            var score = data.average !== undefined ? data.average : null;
            var studentId = data.studentId;

            var existing = getStudentRankInternal(classId, studentId, weekNum);

            if (existing && !overwrite) {
                planned.push({ action: 'skip' });
                continue;
            }

            if (existing) {
                var candidate = deepClone(existing);
                candidate.rank = rankPosition;
                candidate.totalStudents = totalStudents;
                candidate.score = score;
                candidate.percentile = calculatePercentile(rankPosition, totalStudents);
                candidate.updatedAt = new Date().toISOString();
                planned.push({ action: 'update', record: candidate, matchId: existing.id });
            } else {
                var newRecord = buildRankingRecord({
                    classId: classId,
                    studentId: studentId,
                    week: weekNum,
                    rank: rankPosition,
                    totalStudents: totalStudents,
                    score: score,
                    averageScore: null
                }, null, null);
                planned.push({ action: 'create', record: newRecord });
            }
        }

        var creates = planned.filter(function(p) { return p.action === 'create'; });
        var updates = planned.filter(function(p) { return p.action === 'update'; });
        var skipped = planned.filter(function(p) { return p.action === 'skip'; }).length;

        // ---- APPLY: single pipeline transaction ----
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

                // Post-mutation read: read from the snapshot we just
                // mutated, not from window.data.
                var finalRankings = getClassRankingsFromSnapshot(appData, classId, weekNum);

                return {
                    classId: classId,
                    week: weekNum,
                    totalStudents: totalStudents,
                    created: created,
                    updated: updated,
                    skipped: skipped,
                    rankings: finalRankings
                };
            },
            logMessage: 'Generated rankings for class ' + classId + ', week ' + weekNum,
            successMessage: 'Rankings generated successfully!',
            failureMessage: 'Failed to generate rankings.'
        });
    }

    // ============================================================
    // CASCADE HELPERS - Remove all references to a character ID
    // ============================================================

    /**
     * Strip all ranking records for a character from academy.rankings.
     *
     * Rankings are keyed by id and carry a studentId. Deleting a
     * student makes their rankings unreachable.
     *
     * Note: rankings are ALSO keyed by class and week within the
     * record. If a class or week is deleted through some other path,
     * the higher-level cleanup helpers handle that. This helper only
     * cares about the student side.
     *
     * This helper is PURE with respect to `appData`: it mutates the
     * store, but it does not touch `window.data`. It is designed to be
     * called from inside a pipeline mutate() callback in another
     * module's transaction. It never throws.
     *
     * @param {object} appData - The pipeline's appData snapshot
     * @param {string} charId - Character ID to strip
     * @returns {object} { rankingsRemoved }
     */
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
     * PLAN / APPLY:
     *   1. Validate each entry and decide create/update/skip.
     *   2. Apply all planned writes in a SINGLE pipeline transaction.
     *
     * @param {array} rankingDataArray - Array of ranking data objects
     * @param {object} options - Save options
     * @param {boolean} options.overwrite - Overwrite existing rankings
     * @returns {Promise<{ success: boolean, data?: object, message?: string }>}
     */
    function saveRankings(rankingDataArray, options) {
        if (!Array.isArray(rankingDataArray) || rankingDataArray.length === 0) {
            return Promise.resolve(failure('Ranking data array is required.'));
        }

        options = options || {};
        var overwrite = options.overwrite !== false;

        var planned = [];
        var errors = [];

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

            var existing = getStudentRankInternal(data.classId, data.studentId, data.week);

            if (existing && !overwrite) {
                planned.push({ action: 'skip' });
                continue;
            }

            if (existing) {
                var candidate = buildRankingRecord(data, existing.id, existing.createdAt);
                planned.push({ action: 'update', record: candidate, matchId: existing.id });
            } else {
                var newRecord = buildRankingRecord(data, null, null);
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
