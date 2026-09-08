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
 * 
 * IMPORTANT:
 *   - This module OWNS ranking data - it does NOT depend on AcademyQueries
 *   - Uses AcademyClasses for class data (no circular dependency)
 *   - Uses AcademyGrades for grade data (legitimate dependency)
 *   - All mutations are candidate-based: VALIDATE → CLONE → MODIFY → COMMIT
 *   - Invalid inputs are REJECTED (operation returns null/false)
 *   - Mutations are ATOMIC: if any part is invalid, nothing changes
 *   - This module does NOT call saveData() - callers own persistence
 *   - AcademyQueries is the PUBLIC read facade that uses these internal lookups
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
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 * 
 * USAGE:
 *   var rankings = window.AcademyRanking;
 *   
 *   // Create/update rankings
 *   var result = rankings.autoGenerate('class_789', 5);
 *   var result = rankings.saveRanking(rankData);
 *   
 *   // Get rankings
 *   var classRankings = rankings.getClassRankings('class_789', 5);
 *   var studentRank = rankings.getStudentRank('class_789', 'char_456', 5);
 *   
 *   // Get ranking details
 *   var ranking = rankings.getRanking('rank_123');
 *   var all = rankings.getRankings();
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
        return ObjectUtils.deepClone(value);
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
            data.academy = {};
        }

        return data.academy;
    }

    function ensureRankingStructures() {
        var academy = getAcademyStore();
        if (!academy) {
            return null;
        }

        if (!academy.rankings || typeof academy.rankings !== 'object') {
            academy.rankings = {};
        }

        return academy;
    }

    // ============================================================
    // INTERNAL RANKING LOOKUP - PRIVATE
    // ============================================================

    /**
     * Get a ranking record by ID (internal).
     * 
     * @param {string} rankId - Ranking ID
     * @returns {object|null} Ranking object or null
     */
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

    /**
     * Get all ranking records (internal).
     * 
     * @param {string} classId - Optional class filter
     * @param {number} week - Optional week filter
     * @returns {array} Array of ranking objects
     */
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

        // Sort by rank ascending (1 is best)
        result.sort(function(a, b) {
            return (a.rank || 999) - (b.rank || 999);
        });

        return result;
    }

    /**
     * Get rankings for a specific class and week.
     * 
     * @param {string} classId - Class ID
     * @param {number} week - Week number
     * @returns {array} Array of ranking objects
     */
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

    /**
     * Get a student's ranking for a class and week.
     * 
     * @param {string} classId - Class ID
     * @param {string} studentId - Student ID
     * @param {number} week - Week number
     * @returns {object|null} Ranking object or null
     */
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
    // CLASS VALIDATION - Uses AcademyClasses (no circular dependency)
    // ============================================================

    /**
     * Validate that a class exists.
     * Uses AcademyClasses internal methods.
     * 
     * @param {string} classId - Class ID
     * @returns {object} { valid: boolean, class?: object, message?: string }
     */
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

        // Class ID - required for full creation
        if (!isPartial || data.classId !== undefined) {
            if (!isNonEmptyString(data.classId)) {
                return { valid: false, message: 'Class ID is required.' };
            }
        }

        // Student ID - required for full creation
        if (!isPartial || data.studentId !== undefined) {
            if (!isNonEmptyString(data.studentId)) {
                return { valid: false, message: 'Student ID is required.' };
            }
        }

        // Week - required for full creation
        if (!isPartial || data.week !== undefined) {
            var week = parseInt(data.week, 10);
            if (isNaN(week) || week < MIN_WEEK || week > MAX_WEEK) {
                return { valid: false, message: 'Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').' };
            }
        }

        // Rank - required for full creation
        if (!isPartial || data.rank !== undefined) {
            var rank = parseInt(data.rank, 10);
            if (isNaN(rank) || rank < MIN_RANK) {
                return { valid: false, message: 'Rank must be a number greater than or equal to 1.' };
            }
        }

        // Total students - optional, but if provided must be valid
        if (data.totalStudents !== undefined) {
            var total = parseInt(data.totalStudents, 10);
            if (isNaN(total) || total < 0) {
                return { valid: false, message: 'Total students must be a number greater than or equal to 0.' };
            }
        }

        // Score - optional
        if (data.score !== undefined) {
            var score = parseFloat(data.score);
            if (isNaN(score) || score < 0) {
                return { valid: false, message: 'Score must be a number greater than or equal to 0.' };
            }
        }

        // Average score - optional
        if (data.averageScore !== undefined) {
            var avg = parseFloat(data.averageScore);
            if (isNaN(avg) || avg < 0) {
                return { valid: false, message: 'Average score must be a number greater than or equal to 0.' };
            }
        }

        return { valid: true };
    }

    // ============================================================
    // PUBLIC API - RANKING CRUD
    // ============================================================

    /**
     * Create a ranking record.
     * Candidate-based: validates, creates, commits.
     * 
     * @param {object} data - Ranking data
     * @param {string} data.classId - Class ID
     * @param {string} data.studentId - Student ID
     * @param {number} data.week - Week number
     * @param {number} data.rank - Rank position (1 is best)
     * @param {number} data.totalStudents - Total students in class
     * @param {number} data.score - Student's score
     * @param {number} data.averageScore - Class average score
     * @param {number} data.percentile - Percentile (optional, auto-calculated)
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function create(data) {
        // ---- PHASE 1: VALIDATE INPUT ----
        var validation = validateRankingData(data, false);
        if (!validation.valid) {
            return failure(validation.message);
        }

        // ---- PHASE 2: GET STORE ----
        var academy = ensureRankingStructures();
        if (!academy) {
            return failure('Academy data is not available.');
        }

        // ---- PHASE 3: VALIDATE CLASS EXISTS (uses AcademyClasses) ----
        var classValidation = validateClassExists(data.classId);
        if (!classValidation.valid) {
            return failure(classValidation.message);
        }

        // ---- PHASE 4: CHECK FOR DUPLICATE ----
        var existing = getStudentRankInternal(data.classId, data.studentId, data.week);
        if (existing) {
            return failure('Ranking already exists for this student, class, and week. Use update instead.');
        }

        // ---- PHASE 5: BUILD RANKING OBJECT ----
        var now = new Date().toISOString();
        var rankId = generateId();

        var rank = parseInt(data.rank, 10);
        var totalStudents = data.totalStudents !== undefined ? parseInt(data.totalStudents, 10) : 0;
        var score = data.score !== undefined ? parseFloat(data.score) : null;
        var averageScore = data.averageScore !== undefined ? parseFloat(data.averageScore) : null;
        var percentile = data.percentile !== undefined ? parseFloat(data.percentile) : calculatePercentile(rank, totalStudents);

        var newRanking = {
            id: rankId,
            classId: String(data.classId),
            studentId: String(data.studentId),
            week: parseInt(data.week, 10),
            rank: rank,
            totalStudents: totalStudents,
            percentile: clamp(percentile, 0, 100),
            score: score,
            averageScore: averageScore,
            createdAt: now,
            updatedAt: now
        };

        // ---- PHASE 6: COMMIT ----
        academy.rankings[rankId] = newRanking;

        return success({
            ranking: newRanking
        });
    }

    /**
     * Update an existing ranking.
     * Candidate-based: validates, clones, modifies, commits.
     * 
     * @param {string} rankId - Ranking ID
     * @param {object} updates - Updates to apply
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function update(rankId, updates) {
        // ---- PHASE 1: VALIDATE INPUT ----
        if (!isNonEmptyString(rankId)) {
            return failure('Ranking ID is required.');
        }

        if (!isObject(updates) || Object.keys(updates).length === 0) {
            return failure('Updates are required.');
        }

        // ---- PHASE 2: GET STORE ----
        var academy = ensureRankingStructures();
        if (!academy) {
            return failure('Academy data is not available.');
        }

        // ---- PHASE 3: FIND EXISTING ----
        var target = String(rankId);
        var existing = academy.rankings[target];

        if (!existing) {
            return failure('Ranking not found.');
        }

        // ---- PHASE 4: BUILD CANDIDATE ----
        var candidate = deepClone(existing);
        if (candidate === null) {
            return failure('Failed to clone ranking data.');
        }

        var hasChanges = false;

        // Validate and apply updates
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
                        return failure(field + ' must be a non-empty string.');
                    }
                    if (candidate[field] !== String(value)) {
                        candidate[field] = String(value);
                        hasChanges = true;
                    }
                    break;

                case 'week':
                    var week = parseInt(value, 10);
                    if (isNaN(week) || week < MIN_WEEK || week > MAX_WEEK) {
                        return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
                    }
                    if (candidate.week !== week) {
                        candidate.week = week;
                        hasChanges = true;
                    }
                    break;

                case 'rank':
                    var rank = parseInt(value, 10);
                    if (isNaN(rank) || rank < MIN_RANK) {
                        return failure('Rank must be a number greater than or equal to 1.');
                    }
                    if (candidate.rank !== rank) {
                        candidate.rank = rank;
                        hasChanges = true;
                        // Recalculate percentile
                        candidate.percentile = calculatePercentile(rank, candidate.totalStudents);
                    }
                    break;

                case 'totalStudents':
                    var total = parseInt(value, 10);
                    if (isNaN(total) || total < 0) {
                        return failure('Total students must be a number greater than or equal to 0.');
                    }
                    if (candidate.totalStudents !== total) {
                        candidate.totalStudents = total;
                        hasChanges = true;
                        // Recalculate percentile
                        candidate.percentile = calculatePercentile(candidate.rank, total);
                    }
                    break;

                case 'score':
                    var score = parseFloat(value);
                    if (isNaN(score) || score < 0) {
                        return failure('Score must be a number greater than or equal to 0.');
                    }
                    if (candidate.score !== score) {
                        candidate.score = score;
                        hasChanges = true;
                    }
                    break;

                case 'averageScore':
                    var avg = parseFloat(value);
                    if (isNaN(avg) || avg < 0) {
                        return failure('Average score must be a number greater than or equal to 0.');
                    }
                    if (candidate.averageScore !== avg) {
                        candidate.averageScore = avg;
                        hasChanges = true;
                    }
                    break;

                default:
                    break;
            }
        }

        if (!hasChanges) {
            return success({ ranking: existing, changed: false });
        }

        // ---- PHASE 5: COMMIT ----
        candidate.updatedAt = new Date().toISOString();
        academy.rankings[target] = candidate;

        return success({
            ranking: candidate,
            changed: true
        });
    }

    /**
     * Delete a ranking permanently.
     * 
     * @param {string} rankId - Ranking ID
     * @returns {object} { success: boolean, message?: string, data?: object }
     */
    function deleteRanking(rankId) {
        // ---- PHASE 1: VALIDATE INPUT ----
        if (!isNonEmptyString(rankId)) {
            return failure('Ranking ID is required.');
        }

        // ---- PHASE 2: GET STORE ----
        var academy = ensureRankingStructures();
        if (!academy) {
            return failure('Academy data is not available.');
        }

        // ---- PHASE 3: FIND EXISTING ----
        var target = String(rankId);
        var existing = academy.rankings[target];

        if (!existing) {
            return failure('Ranking not found.');
        }

        var rankInfo = {
            id: target,
            classId: existing.classId,
            studentId: existing.studentId,
            week: existing.week,
            rank: existing.rank
        };

        // ---- PHASE 4: REMOVE ----
        delete academy.rankings[target];

        return success({
            deleted: true,
            ranking: rankInfo
        });
    }

    /**
     * Delete all rankings for a class and week.
     * 
     * @param {string} classId - Class ID
     * @param {number} week - Week number
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function deleteClassRankings(classId, week) {
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum) || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        var academy = ensureRankingStructures();
        if (!academy) {
            return failure('Academy data is not available.');
        }

        var targetClass = String(classId);
        var removed = [];
        var toRemove = [];

        for (var id in academy.rankings) {
            if (Object.prototype.hasOwnProperty.call(academy.rankings, id)) {
                var rank = academy.rankings[id];
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
            delete academy.rankings[toRemove[i]];
        }

        return success({
            classId: targetClass,
            week: weekNum,
            removedCount: removed.length,
            removed: removed
        });
    }

    // ============================================================
    // QUERY FUNCTIONS - Read-only (internal)
    // ============================================================

    /**
     * Get rankings for a class and week.
     * 
     * @param {string} classId - Class ID
     * @param {number} week - Week number
     * @param {boolean} includeStudentDetails - Include student details
     * @returns {array} Array of ranking objects with student details
     */
    function getClassRankings(classId, week, includeStudentDetails) {
        var rankings = getClassRankingsInternal(classId, week);

        if (!includeStudentDetails) {
            return rankings.map(function(rank) {
                return deepClone(rank);
            });
        }

        var result = [];
        for (var i = 0; i < rankings.length; i++) {
            var rank = deepClone(rankings[i]);
            var student = CharacterQueries.getCharacterById(rank.studentId);
            if (student) {
                rank.studentName = CharacterQueries.getDisplayName(student);
                rank.student = student;
            }
            result.push(rank);
        }

        return result;
    }

    /**
     * Get a student's ranking for a class and week.
     * 
     * @param {string} classId - Class ID
     * @param {string} studentId - Student ID
     * @param {number} week - Week number
     * @param {boolean} includeDetails - Include ranking details
     * @returns {object|null} Ranking object or null
     */
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

            // Get all rankings for context
            var allRankings = getClassRankingsInternal(classId, week);
            result.totalRanked = allRankings.length;
            result.percentile = calculatePercentile(result.rank, result.totalRanked);
        }

        return result;
    }

    /**
     * Get rankings with details (comprehensive view).
     * 
     * @param {string} classId - Class ID
     * @param {number} week - Week number
     * @returns {object} { rankings, summary, distribution }
     */
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

    /**
     * Get all rankings (defensive copies).
     * 
     * @param {string} classId - Optional class filter
     * @param {number} week - Optional week filter
     * @returns {array} Array of ranking objects
     */
    function getRankings(classId, week) {
        var records = getRankingRecords(classId, week);
        return records.map(function(rank) {
            return deepClone(rank);
        });
    }

    /**
     * Get a ranking by ID (defensive copy).
     * 
     * @param {string} rankId - Ranking ID
     * @returns {object|null} Ranking object or null
     */
    function getRanking(rankId) {
        var rank = getRankingRecord(rankId);
        return rank ? deepClone(rank) : null;
    }

    // ============================================================
    // RANKING CALCULATIONS
    // ============================================================

    /**
     * Calculate a ranking summary.
     * 
     * @param {array} rankings - Array of ranking objects
     * @returns {object} Summary statistics
     */
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

    /**
     * Calculate rank distribution.
     * 
     * @param {array} rankings - Array of ranking objects
     * @param {number} bins - Number of bins (default: 5)
     * @returns {object} Distribution by percentile bins
     */
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

            // Bin label: "0-19", "20-39", etc.
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
    // AUTO-GENERATE RANKINGS FROM GRADES
    // ============================================================

    /**
     * Auto-generate rankings from grade data.
     * 
     * @param {string} classId - Class ID
     * @param {number} week - Week number
     * @param {object} options - Generation options
     * @param {boolean} options.overwrite - Overwrite existing rankings
     * @param {number} options.weightThreshold - Minimum weight to include
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function autoGenerate(classId, week, options) {
        if (!isNonEmptyString(classId)) {
            return failure('Class ID is required.');
        }

        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum) || weekNum < MIN_WEEK || weekNum > MAX_WEEK) {
            return failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').');
        }

        options = options || {};
        var overwrite = options.overwrite !== false;
        var weightThreshold = options.weightThreshold || 0.5;

        // ---- PHASE 1: VALIDATE CLASS EXISTS (uses AcademyClasses) ----
        var classValidation = validateClassExists(classId);
        if (!classValidation.valid) {
            return failure(classValidation.message);
        }

        // ---- PHASE 2: GET GRADES (uses AcademyGrades) ----
        var grades = AcademyGrades.getClassGrades(classId, weekNum);

        if (grades.length === 0) {
            return failure('No grades found for this class and week.');
        }

        // ---- PHASE 3: CALCULATE RANKINGS (uses AcademyGrades) ----
        var rankingData = AcademyGrades.calculateClassRanking(
            classId,
            weekNum,
            CharacterQueries.getCharacterById
        );

        if (!rankingData || rankingData.length === 0) {
            return failure('Failed to calculate rankings from grades.');
        }

        // ---- PHASE 4: GET STORE ----
        var academy = ensureRankingStructures();
        if (!academy) {
            return failure('Academy data is not available.');
        }

        // ---- PHASE 5: PREPARE FOR MUTATION ----
        var created = 0;
        var updated = 0;
        var skipped = 0;
        var errors = [];

        var totalStudents = rankingData.length;

        for (var i = 0; i < rankingData.length; i++) {
            var data = rankingData[i];
            var rankPosition = data.rank || (i + 1);
            var score = data.average || null;
            var studentId = data.studentId;

            // Check if ranking already exists
            var existing = getStudentRankInternal(classId, studentId, weekNum);

            if (existing && !overwrite) {
                skipped++;
                continue;
            }

            // Prepare ranking data
            var rankData = {
                classId: classId,
                studentId: studentId,
                week: weekNum,
                rank: rankPosition,
                totalStudents: totalStudents,
                score: score,
                averageScore: null // We don't have class average from this data
            };

            if (existing) {
                // Update existing
                var updateResult = update(existing.id, {
                    rank: rankPosition,
                    totalStudents: totalStudents,
                    score: score
                });

                if (updateResult.success) {
                    updated++;
                } else {
                    errors.push({
                        studentId: studentId,
                        error: updateResult.message
                    });
                }
            } else {
                // Create new
                var createResult = create(rankData);

                if (createResult.success) {
                    created++;
                } else {
                    errors.push({
                        studentId: studentId,
                        error: createResult.message
                    });
                }
            }
        }

        return success({
            classId: classId,
            week: weekNum,
            totalStudents: totalStudents,
            created: created,
            updated: updated,
            skipped: skipped,
            errors: errors,
            rankings: getClassRankingsInternal(classId, weekNum)
        });
    }

    // ============================================================
    // BULK OPERATIONS
    // ============================================================

    /**
     * Save multiple rankings at once.
     * 
     * @param {array} rankingDataArray - Array of ranking data objects
     * @param {object} options - Save options
     * @param {boolean} options.overwrite - Overwrite existing rankings
     * @returns {object} { success: boolean, data?: object, message?: string }
     */
    function saveRankings(rankingDataArray, options) {
        if (!Array.isArray(rankingDataArray) || rankingDataArray.length === 0) {
            return failure('Ranking data array is required.');
        }

        options = options || {};
        var overwrite = options.overwrite !== false;

        var created = 0;
        var updated = 0;
        var skipped = 0;
        var errors = [];

        for (var i = 0; i < rankingDataArray.length; i++) {
            var data = rankingDataArray[i];
            if (!isObject(data)) {
                errors.push({
                    index: i,
                    error: 'Invalid ranking data.'
                });
                continue;
            }

            // Validate required fields
            if (!data.classId || !data.studentId || !data.week || data.rank === undefined) {
                errors.push({
                    index: i,
                    error: 'Missing required fields: classId, studentId, week, rank'
                });
                continue;
            }

            // Check if ranking already exists
            var existing = getStudentRankInternal(data.classId, data.studentId, data.week);

            if (existing && !overwrite) {
                skipped++;
                continue;
            }

            if (existing) {
                // Update existing
                var updateResult = update(existing.id, data);
                if (updateResult.success) {
                    updated++;
                } else {
                    errors.push({
                        index: i,
                        studentId: data.studentId,
                        error: updateResult.message
                    });
                }
            } else {
                // Create new
                var createResult = create(data);
                if (createResult.success) {
                    created++;
                } else {
                    errors.push({
                        index: i,
                        studentId: data.studentId,
                        error: createResult.message
                    });
                }
            }
        }

        return success({
            total: rankingDataArray.length,
            created: created,
            updated: updated,
            skipped: skipped,
            errors: errors,
            successCount: created + updated
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyRanking = {
        // ---- CRUD ----
        create: create,
        update: update,
        delete: deleteRanking,
        deleteClassRankings: deleteClassRankings,

        // ---- Queries ----
        getClassRankings: getClassRankings,
        getStudentRank: getStudentRank,
        getRankingsWithDetails: getRankingsWithDetails,
        getRankings: getRankings,
        getRanking: getRanking,

        // ---- Calculations ----
        calculateRankingSummary: calculateRankingSummary,
        calculateRankDistribution: calculateRankDistribution,
        calculatePercentile: calculatePercentile,

        // ---- Auto-generation ----
        autoGenerate: autoGenerate,
        saveRankings: saveRankings,

        // ---- Internal (for AcademyQueries) ----
        getClassRankingsInternal: getClassRankingsInternal,
        getStudentRankInternal: getStudentRankInternal,
        getRankingRecords: getRankingRecords,

        // ---- Constants ----
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        MIN_RANK: MIN_RANK
    };

})();
