/**
 * js/modules/academy/academy-grades.js - Academy Grades
 * SINGLE SOURCE OF TRUTH for all academy grade data and operations
 * Path: js/modules/academy/academy-grades.js
 *
 * This module is responsible for:
 *   - Grade CRUD operations (create, update, delete)
 *   - Grade queries (get by student, class, discipline, week)
 *   - Grade calculations (summary, averages, pass/fail)
 *   - Grade validation
 *   - Cross-domain cascade helper (stripCharacterRefs)
 *
 * IMPORTANT:
 *   - This module OWNS grade data - it does NOT depend on AcademyQueries.
 *   - Uses AcademyClasses internal methods for class data (no circular dependency).
 *   - All MUTATIONS go through MutationPipeline (persistence, rollback, logging).
 *   - All READS are synchronous and side-effect free.
 *   - Invalid inputs are REJECTED (mutation resolves with { success: false }).
 *   - Mutations are ATOMIC: if persistence fails, window.data is restored.
 *   - This module does NOT call saveData() directly - the pipeline does.
 *
 * STORAGE NAMESPACE (v28):
 *   Grade records live at academy.grades (unchanged).
 *
 *   Discipline records live at academy.disciplines. The legacy
 *   curriculum.disciplines location was retired. The snapshot
 *   validator reads from academy.disciplines and falls back to
 *   curriculum.disciplines only for pre-v28 snapshots loaded
 *   mid-transaction.
 *
 * GRADE TYPE VOCABULARY:
 *   The grade type vocabulary is:
 *
 *     exam              Final exam.
 *     classAssignment   Assignment completed in class.
 *     participation     Participation / engagement grade.
 *     groupProject      Team project. Multiple students.
 *     quiz              Short assessment.
 *     homeAssignment    Take-home assignment. NO TIME SLOT.
 *
 *   The retired names:
 *     'assignment'   → replaced by 'classAssignment'
 *     'project'      → replaced by 'groupProject'
 *     'final'        → REMOVED. Its role is covered by 'exam'.
 *
 *   This module does not migrate legacy records. If a legacy record
 *   surfaces (an old backup, an imported envelope), it will fail
 *   type validation on the next save and the user must pick a
 *   current type.
 *
 *   THE LABEL MAP IS OWNED HERE:
 *     GRADE_TYPE_LABELS maps a type id to its display label.
 *     getGradeTypeLabel(type) is the accessor. Editors, exporters,
 *     and any other consumer that needs the label reads from here
 *     rather than maintaining its own copy.
 *
 * GRADE IDENTITY:
 *   A grade's identity is the five-field tuple:
 *
 *     (studentId, classId, disciplineId, week, type)
 *
 *   A student can have an exam and a class assignment in the same
 *   week of the same discipline; both are legitimate records.
 *   Identity includes `type` for that reason.
 *
 * GRADE SLOT:
 *   A grade carries an optional slot:
 *
 *     { day: number, startTime: number, groupId: string | null }
 *
 *   The slot identifies WHICH class meeting the grade was recorded
 *   at. Tuesday at 08:00 for teaching group "Combat Training A" is
 *   a slot. The grade is anchored to that occurrence: the
 *   historical time is a fact about when the grade was recorded,
 *   not a pointer to a mutable session. If the class's Tuesday
 *   session is later moved to Wednesday, the Tuesday-morning grade
 *   stays a Tuesday-morning grade.
 *
 *   `groupId` names the teaching group the meeting belonged to.
 *   It is optional in the sense that a slot can be stored with
 *   groupId null (a caller that does not know the group can still
 *   record the slot). It is NOT a foreign key; a reader that wants
 *   to resolve the current group label queries the teaching-groups
 *   module.
 *
 *   homeAssignment DOES NOT CARRY A SLOT. Its shape on the record
 *   is slot: null. A take-home assignment does not happen at a
 *   meeting. The editor hides the slot picker when the type is
 *   homeAssignment.
 *
 *   The retired `date` field is gone. Records no longer carry it.
 *
 * WEEK PARSING:
 *   Week parsing goes through CalendarValidation.parseWeek, the
 *   canonical strict parser. No `parseInt` coercion. "5bananas"
 *   is rejected, not silently accepted as 5.
 *
 * NUMERIC PARSING:
 *   Numeric fields (score, maxScore) accept numbers and numeric
 *   strings. A numeric string is parsed strictly: the full string
 *   must be a valid finite number after trimming. "85" parses to
 *   85. "85abc" is rejected. "" is rejected. NaN and Infinity are
 *   rejected.
 *
 * WEIGHT MODEL:
 *   Grades do NOT carry a `weight` field. Weight is a property of
 *   the ASSESSMENT TYPE within a discipline, not of the individual
 *   grade record. It lives at discipline.assessmentWeights.
 *
 *   Weighted averages are computed by the performance layer
 *   (academy-performance.js). This module does not compute them.
 *
 * DERIVED vs STORED:
 *   `percentage` and `passing` are DERIVED. They are not stored on
 *   the grade record.
 *
 *   `percentage` = round(score / maxScore * 100).
 *   `passing` is SCHEME-AWARE. When a discipline grade scheme is
 *   supplied, passing is computed via AcademyGradeSchemes.isPassing.
 *
 *   `decorateGrade(grade, scheme)` attaches these fields to a
 *   cloned grade for display. Callers that want them on a read
 *   result opt in by passing a scheme.
 *
 *   CALCULATION FUNCTIONS DERIVE, THEY DO NOT TRUST:
 *     calculateSummary, calculatePercentage, isPassing, and
 *     decorateGrade all DERIVE their results from score /
 *     maxScore / scheme. If a caller passes an object with a
 *     pre-computed `percentage` or `passing` field, that field is
 *     IGNORED.
 *
 * SCORE VALIDATION:
 *   `score > maxScore` is REJECTED, not clamped.
 *
 * MUTATION CONTRACT:
 *   - create / update / delete / deleteStudentGrades / saveGrades
 *     all return Promise<{ success, data?, message? }>
 *   - getStudentGrades / getClassGrades / getDisciplineGrades /
 *     getWeekGrades / getGrade / getAllGrades / getStudentClassGrades
 *     stay synchronous
 *
 * CASCADE SEMANTICS (stripCharacterRefs):
 *   When a character is deleted, all grade records keyed to that
 *   character are removed from academy.grades. This helper is called
 *   by CharacterCRUD.deleteCharacter from inside its pipeline mutate,
 *   so it runs in the same transaction as the character removal.
 *
 *   A missing grades store is a no-op. A store that is present but
 *   malformed (not a plain object, or an array) is an ERROR.
 *
 * GRADE DATA STRUCTURE:
 *   window.data.academy.grades = {
 *     'grade_123': {
 *       id: 'grade_123',
 *       studentId: 'char_456',
 *       classId: 'class_789',
 *       disciplineId: 'disc_abc',
 *       week: 5,
 *       score: 85,
 *       maxScore: 100,
 *       type: 'classAssignment',
 *       slot: { day: 2, startTime: 8, groupId: 'tgroup_xyz' },
 *       notes: 'Good work',
 *       createdAt: '2026-02-15T10:00:00Z',
 *       updatedAt: '2026-02-15T10:00:00Z'
 *     }
 *   }
 *
 * DEPENDENCIES:
 *   - window.ObjectUtils
 *   - window.IdUtils
 *   - window.ValidationUtils
 *   - window.CalendarValidation
 *   - window.CalendarConstants
 *   - window.AcademyClasses
 *   - window.AcademyGradeSchemes
 *   - window.MutationPipeline
 *
 * USAGE:
 *   var grades = window.AcademyGrades;
 *
 *   grades.create({
 *       studentId, classId, disciplineId, week,
 *       score, maxScore, type,
 *       slot: { day, startTime, groupId }
 *   }).then(function(result) { ... });
 */

(function() {
    'use strict';

    if (window.__academyGradesLoaded) {
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
    if (!window.CalendarValidation || typeof window.CalendarValidation.parseDay !== 'function') {
        missing.push('CalendarValidation.parseDay');
    }
    if (!window.CalendarValidation || typeof window.CalendarValidation.parseHour !== 'function') {
        missing.push('CalendarValidation.parseHour');
    }

    if (!window.CalendarConstants) {
        missing.push('CalendarConstants');
    }

    if (!window.AcademyClasses) {
        missing.push('AcademyClasses');
    }
    if (!window.AcademyClasses || typeof window.AcademyClasses.getClass !== 'function') {
        missing.push('AcademyClasses.getClass');
    }

    if (!window.AcademyGradeSchemes || typeof window.AcademyGradeSchemes.isPassing !== 'function') {
        missing.push('AcademyGradeSchemes.isPassing');
    }

    if (!window.MutationPipeline || typeof window.MutationPipeline.performMutation !== 'function') {
        missing.push('MutationPipeline.performMutation');
    }

    if (missing.length > 0) {
        throw new Error('[AcademyGrades] Missing dependencies: ' + missing.join(', '));
    }

    window.__academyGradesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;
    var ValidationUtils = window.ValidationUtils;
    var CalendarValidation = window.CalendarValidation;
    var CalendarConstants = window.CalendarConstants;
    var AcademyClasses = window.AcademyClasses;
    var GradeSchemes = window.AcademyGradeSchemes;
    var MutationPipeline = window.MutationPipeline;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var MIN_DAY = CalendarConstants.MIN_DAY;
    var MAX_DAY = CalendarConstants.MAX_DAY;
    var MIN_HOUR = CalendarConstants.MIN_HOUR;
    var MAX_HOUR = CalendarConstants.MAX_HOUR;

    var MIN_SCORE = 0;
    var MAX_SCORE = 100;

    // ---- Grade type vocabulary ----

    var VALID_GRADE_TYPES = [
        'exam',
        'classAssignment',
        'participation',
        'groupProject',
        'quiz',
        'homeAssignment'
    ];

    var DEFAULT_GRADE_TYPE = 'classAssignment';

    var TYPE_WITHOUT_SLOT = 'homeAssignment';

    // ---- Grade type labels ----

    var GRADE_TYPE_LABELS = Object.freeze({
        exam:            'Exam',
        classAssignment: 'Class Assignment',
        participation:   'Participation',
        groupProject:    'Group Project',
        quiz:            'Quiz',
        homeAssignment:  'Home Assignment'
    });

    function getGradeTypeLabel(type) {
        if (!isNonEmptyString(type)) { return 'Unknown'; }
        if (GRADE_TYPE_LABELS[type]) { return GRADE_TYPE_LABELS[type]; }
        return String(type);
    }

    function isSlotlessType(type) {
        return type === TYPE_WITHOUT_SLOT;
    }

    var DEFAULT_PASSING_THRESHOLD =
        (GradeSchemes.PASSING_THRESHOLD !== undefined &&
         GradeSchemes.PASSING_THRESHOLD !== null)
            ? GradeSchemes.PASSING_THRESHOLD
            : 70;

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
                '[AcademyGrades] deepClone returned the original reference. ' +
                'ObjectUtils.deepClone must return a genuine clone for objects.'
            );
        }
        return result;
    }

    function generateId() {
        return IdUtils.generateId('grade');
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

    function parseFiniteNumberStrict(value) {
        if (value === undefined || value === null) {
            return null;
        }

        if (typeof value === 'number') {
            return isFinite(value) ? value : null;
        }

        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '') {
                return null;
            }
            if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) {
                return null;
            }
            var n = Number(trimmed);
            return isFinite(n) ? n : null;
        }

        return null;
    }

    /**
     * Normalise a slot value.
     *
     * Accepts a plain object { day, startTime, groupId? }. Returns:
     *   - { ok: true, slot: { day, startTime, groupId } } on success
     *   - { ok: true, slot: null } for null, undefined, or empty
     *   - { ok: false, message } on malformed input
     *
     * The parser is strict: day and startTime must be integers in
     * their respective calendar ranges. groupId, when present, must
     * be a non-empty string; a missing or empty groupId normalises
     * to null.
     */
    function normaliseSlot(rawSlot) {
        if (rawSlot === undefined || rawSlot === null) {
            return { ok: true, slot: null };
        }

        if (!isObject(rawSlot)) {
            return {
                ok: false,
                message: 'Slot must be an object with day and startTime.'
            };
        }

        var dayParsed = CalendarValidation.parseDay(rawSlot.day);
        if (dayParsed === null || dayParsed < MIN_DAY || dayParsed > MAX_DAY) {
            return {
                ok: false,
                message: 'Slot day must be between ' +
                    MIN_DAY + ' and ' + MAX_DAY + '.'
            };
        }

        var startParsed = CalendarValidation.parseHour(rawSlot.startTime);
        if (startParsed === null || startParsed < MIN_HOUR || startParsed > MAX_HOUR) {
            return {
                ok: false,
                message: 'Slot start time must be between ' +
                    MIN_HOUR + ' and ' + MAX_HOUR + '.'
            };
        }

        var groupId = null;
        if (rawSlot.groupId !== undefined && rawSlot.groupId !== null) {
            if (!isNonEmptyString(rawSlot.groupId)) {
                return {
                    ok: false,
                    message: 'Slot groupId must be a non-empty string when present.'
                };
            }
            groupId = String(rawSlot.groupId);
        }

        return {
            ok: true,
            slot: {
                day: dayParsed,
                startTime: startParsed,
                groupId: groupId
            }
        };
    }

    // ============================================================
    // DERIVED FIELD HELPERS
    // ============================================================

    function calculatePercentage(score, maxScore) {
        if (!isNumber(score)) {
            throw new Error(
                '[AcademyGrades] calculatePercentage requires a finite ' +
                'score. Got ' + String(score) + '.'
            );
        }
        if (!isNumber(maxScore) || maxScore <= 0) {
            throw new Error(
                '[AcademyGrades] calculatePercentage requires a positive ' +
                'finite maxScore. Got ' + String(maxScore) + '.'
            );
        }
        return Math.round((score / maxScore) * 100);
    }

    function isPassing(score, maxScore, scheme) {
        var pct = calculatePercentage(score, maxScore);
        return GradeSchemes.isPassing(pct, scheme || null) === true;
    }

    function decorateGrade(grade, scheme) {
        if (!isObject(grade)) {
            throw new Error(
                '[AcademyGrades] decorateGrade requires a grade object. ' +
                'Got ' + (grade === null ? 'null' : typeof grade) + '.'
            );
        }
        var copy = deepClone(grade);
        var pct = calculatePercentage(copy.score, copy.maxScore);
        copy.percentage = pct;
        copy.passing = GradeSchemes.isPassing(pct, scheme || null) === true;
        return copy;
    }

    function decorateGrades(grades, scheme) {
        if (!Array.isArray(grades)) {
            return [];
        }
        var result = [];
        for (var i = 0; i < grades.length; i++) {
            result.push(decorateGrade(grades[i], scheme));
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
    // INTERNAL GRADE LOOKUP - PRIVATE (LIVE REFERENCES)
    // ============================================================

    function getGradeRecord(gradeId) {
        if (!isNonEmptyString(gradeId)) {
            return null;
        }

        var academy = getAcademyStore();
        if (!academy || !academy.grades) {
            return null;
        }

        var target = String(gradeId);
        return academy.grades[target] || null;
    }

    function getGradeRecords() {
        var academy = getAcademyStore();
        if (!academy || !academy.grades) {
            return [];
        }

        var result = [];
        for (var id in academy.grades) {
            if (Object.prototype.hasOwnProperty.call(academy.grades, id)) {
                var grade = academy.grades[id];
                if (grade) {
                    result.push(grade);
                }
            }
        }

        return result;
    }

    // ============================================================
    // SNAPSHOT-AWARE LOOKUPS
    // ============================================================

    function findGradeInSnapshot(appData, gradeId) {
        if (!appData || !appData.academy) {
            return null;
        }
        var grades = appData.academy.grades;
        if (!isObject(grades)) {
            return null;
        }
        var record = grades[String(gradeId)];
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

    function findDisciplineInSnapshot(appData, disciplineId) {
        if (!appData || typeof appData !== 'object') {
            return null;
        }
        if (!isNonEmptyString(disciplineId)) {
            return null;
        }

        var target = String(disciplineId);

        if (appData.academy && typeof appData.academy === 'object') {
            var academyList = appData.academy.disciplines;
            if (Array.isArray(academyList)) {
                for (var a = 0; a < academyList.length; a++) {
                    var ad = academyList[a];
                    if (ad && String(ad.id) === target) {
                        return ad;
                    }
                }
            }
        }

        if (appData.curriculum && typeof appData.curriculum === 'object') {
            var legacyList = appData.curriculum.disciplines;
            if (Array.isArray(legacyList)) {
                for (var l = 0; l < legacyList.length; l++) {
                    var ld = legacyList[l];
                    if (ld && String(ld.id) === target) {
                        return ld;
                    }
                }
            }
        }

        return null;
    }

    // ============================================================
    // CLASS VALIDATION - Preflight
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
    // GRADE VALIDATION
    // ============================================================

    function validateGradeData(data, isPartial) {
        if (!isObject(data)) {
            return { valid: false, message: 'Grade data must be an object.' };
        }

        if (!isPartial || data.studentId !== undefined) {
            if (!isNonEmptyString(data.studentId)) {
                return { valid: false, message: 'Student ID is required.' };
            }
        }

        if (!isPartial || data.classId !== undefined) {
            if (!isNonEmptyString(data.classId)) {
                return { valid: false, message: 'Class ID is required.' };
            }
        }

        if (!isPartial || data.disciplineId !== undefined) {
            if (!isNonEmptyString(data.disciplineId)) {
                return { valid: false, message: 'Discipline ID is required.' };
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

        if (!isPartial || data.score !== undefined) {
            var score = parseFiniteNumberStrict(data.score);
            if (score === null || score < MIN_SCORE) {
                return { valid: false, message: 'Score must be a finite number greater than or equal to 0.' };
            }
        }

        if (data.maxScore !== undefined) {
            var maxScore = parseFiniteNumberStrict(data.maxScore);
            if (maxScore === null || maxScore <= 0) {
                return { valid: false, message: 'Max score must be a finite number greater than 0.' };
            }
        }

        if (data.score !== undefined && data.maxScore !== undefined) {
            var s = parseFiniteNumberStrict(data.score);
            var m = parseFiniteNumberStrict(data.maxScore);
            if (s !== null && m !== null && s > m) {
                return {
                    valid: false,
                    message: 'Score (' + s + ') cannot exceed max score (' + m + ').'
                };
            }
        }

        if (data.type !== undefined) {
            if (VALID_GRADE_TYPES.indexOf(data.type) === -1) {
                return {
                    valid: false,
                    message: 'Invalid grade type. Must be one of: ' +
                        VALID_GRADE_TYPES.join(', ') + '.'
                };
            }
        }

        if (data.slot !== undefined && data.slot !== null) {
            if (data.type !== undefined &&
                isSlotlessType(data.type)) {
                return {
                    valid: false,
                    message: 'A home assignment does not take a slot.'
                };
            }

            var slotCheck = normaliseSlot(data.slot);
            if (!slotCheck.ok) {
                return { valid: false, message: slotCheck.message };
            }
        }

        return { valid: true };
    }

    function validateCandidate(candidate) {
        if (!isObject(candidate)) {
            return { valid: false, message: 'Candidate is not an object.' };
        }

        if (!isNonEmptyString(candidate.studentId)) {
            return { valid: false, message: 'Candidate missing studentId.' };
        }
        if (!isNonEmptyString(candidate.classId)) {
            return { valid: false, message: 'Candidate missing classId.' };
        }
        if (!isNonEmptyString(candidate.disciplineId)) {
            return { valid: false, message: 'Candidate missing disciplineId.' };
        }

        var week = parseWeekStrict(candidate.week);
        if (week === null) {
            return { valid: false, message: 'Candidate week is out of range.' };
        }

        var score = parseFiniteNumberStrict(candidate.score);
        if (score === null || score < MIN_SCORE) {
            return { valid: false, message: 'Candidate score is invalid.' };
        }

        var maxScore = parseFiniteNumberStrict(candidate.maxScore);
        if (maxScore === null || maxScore <= 0) {
            return { valid: false, message: 'Candidate maxScore is invalid.' };
        }

        if (score > maxScore) {
            return {
                valid: false,
                message: 'Candidate score (' + score + ') exceeds maxScore (' + maxScore + ').'
            };
        }

        if (VALID_GRADE_TYPES.indexOf(candidate.type) === -1) {
            return { valid: false, message: 'Candidate type is invalid.' };
        }

        if (isSlotlessType(candidate.type)) {
            if (candidate.slot !== null) {
                return {
                    valid: false,
                    message: 'A home assignment does not take a slot.'
                };
            }
        } else if (candidate.slot !== null) {
            var slotCheck = normaliseSlot(candidate.slot);
            if (!slotCheck.ok) {
                return { valid: false, message: slotCheck.message };
            }
        }

        return { valid: true };
    }

    function validateCandidateAgainstSnapshot(candidate, appData) {
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

        if (!findDisciplineInSnapshot(appData, candidate.disciplineId)) {
            return {
                valid: false,
                message: 'Discipline no longer exists: ' + candidate.disciplineId
            };
        }

        return { valid: true };
    }

    // ============================================================
    // INTERNAL CANDIDATE BUILDER
    // ============================================================

    function buildGradeRecord(data, existingId, existingCreatedAt) {
        var now = new Date().toISOString();

        var score = parseFiniteNumberStrict(data.score);
        if (score === null) {
            throw new Error(
                '[AcademyGrades] buildGradeRecord received a malformed score.'
            );
        }

        var maxScore = data.maxScore !== undefined
            ? parseFiniteNumberStrict(data.maxScore)
            : 100;
        if (maxScore === null || maxScore <= 0) {
            throw new Error(
                '[AcademyGrades] buildGradeRecord received a malformed maxScore.'
            );
        }

        var week = parseWeekStrict(data.week);
        if (week === null) {
            throw new Error(
                '[AcademyGrades] buildGradeRecord received an invalid week.'
            );
        }

        var type = data.type || DEFAULT_GRADE_TYPE;
        if (VALID_GRADE_TYPES.indexOf(type) === -1) {
            throw new Error(
                '[AcademyGrades] buildGradeRecord received an invalid type: ' +
                type + '.'
            );
        }

        var slot = null;
        if (!isSlotlessType(type)) {
            var slotCheck = normaliseSlot(data.slot);
            if (!slotCheck.ok) {
                throw new Error(
                    '[AcademyGrades] buildGradeRecord received a malformed slot: ' +
                    slotCheck.message
                );
            }
            slot = slotCheck.slot;
        }

        return {
            id: existingId || generateId(),
            studentId: String(data.studentId),
            classId: String(data.classId),
            disciplineId: String(data.disciplineId),
            week: week,
            score: score,
            maxScore: maxScore,
            type: type,
            slot: slot,
            notes: data.notes || '',
            createdAt: existingCreatedAt || now,
            updatedAt: now
        };
    }

    // ============================================================
    // PUBLIC API - GRADE CRUD
    // ============================================================

    function create(data) {
        var validation = validateGradeData(data, false);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.message));
        }

        var classValidation = validateClassExists(data.classId);
        if (!classValidation.valid) {
            return Promise.resolve(failure(classValidation.message));
        }

        var newGrade;
        try {
            newGrade = buildGradeRecord(data, null, null);
        } catch (e) {
            return Promise.resolve(failure(e.message));
        }

        var candidateCheck = validateCandidate(newGrade);
        if (!candidateCheck.valid) {
            return Promise.resolve(failure(candidateCheck.message));
        }

        var targetId = newGrade.id;

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy) {
                    return { valid: false, message: 'Academy data is not available.' };
                }
                if (findGradeInSnapshot(appData, targetId)) {
                    return { valid: false, message: 'Grade ID collision.' };
                }
                return validateCandidateAgainstSnapshot(newGrade, appData);
            },
            mutate: function(appData) {
                if (!appData.academy.grades || typeof appData.academy.grades !== 'object') {
                    appData.academy.grades = {};
                }
                appData.academy.grades[targetId] = deepClone(newGrade);
                return { grade: newGrade, id: targetId };
            },
            logMessage: 'Created grade for student ' + newGrade.studentId,
            successMessage: 'Grade created successfully!',
            failureMessage: 'Failed to create grade.'
        });
    }

    function update(gradeId, updates) {
        if (!isNonEmptyString(gradeId)) {
            return Promise.resolve(failure('Grade ID is required.'));
        }

        if (!isObject(updates) || Object.keys(updates).length === 0) {
            return Promise.resolve(failure('Updates are required.'));
        }

        var existing = getGradeRecord(gradeId);
        if (!existing) {
            return Promise.resolve(failure('Grade not found.'));
        }

        var fieldValidation = validateGradeData(updates, true);
        if (!fieldValidation.valid) {
            return Promise.resolve(failure(fieldValidation.message));
        }

        var candidate = deepClone(existing);
        if (candidate === null) {
            return Promise.resolve(failure('Failed to clone grade data.'));
        }

        var hasChanges = false;

        var stringFields = ['studentId', 'classId', 'disciplineId'];
        for (var i = 0; i < stringFields.length; i++) {
            var sf = stringFields[i];
            if (updates[sf] === undefined) { continue; }
            if (!isNonEmptyString(updates[sf])) {
                return Promise.resolve(failure(sf + ' must be a non-empty string.'));
            }
            if (candidate[sf] !== String(updates[sf])) {
                candidate[sf] = String(updates[sf]);
                hasChanges = true;
            }
        }

        if (updates.week !== undefined) {
            var week = parseWeekStrict(updates.week);
            if (week === null) {
                return Promise.resolve(failure('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').'));
            }
            if (candidate.week !== week) {
                candidate.week = week;
                hasChanges = true;
            }
        }

        if (updates.score !== undefined) {
            var score = parseFiniteNumberStrict(updates.score);
            if (score === null || score < MIN_SCORE) {
                return Promise.resolve(failure('Score must be a finite number greater than or equal to 0.'));
            }
            if (candidate.score !== score) {
                candidate.score = score;
                hasChanges = true;
            }
        }

        if (updates.maxScore !== undefined) {
            var newMax = parseFiniteNumberStrict(updates.maxScore);
            if (newMax === null || newMax <= 0) {
                return Promise.resolve(failure('Max score must be a finite number greater than 0.'));
            }
            if (candidate.maxScore !== newMax) {
                candidate.maxScore = newMax;
                hasChanges = true;
            }
        }

        if (updates.type !== undefined) {
            if (VALID_GRADE_TYPES.indexOf(updates.type) === -1) {
                return Promise.resolve(failure(
                    'Invalid grade type. Must be one of: ' +
                    VALID_GRADE_TYPES.join(', ') + '.'
                ));
            }
            if (candidate.type !== updates.type) {
                candidate.type = updates.type;
                hasChanges = true;
            }

            if (isSlotlessType(candidate.type) && candidate.slot !== null) {
                candidate.slot = null;
                hasChanges = true;
            }
        }

        if (updates.slot !== undefined) {
            if (isSlotlessType(candidate.type)) {
                if (updates.slot !== null) {
                    return Promise.resolve(failure(
                        'A home assignment does not take a slot.'
                    ));
                }
            } else {
                var slotCheck = normaliseSlot(updates.slot);
                if (!slotCheck.ok) {
                    return Promise.resolve(failure(slotCheck.message));
                }
                var oldJson = JSON.stringify(candidate.slot);
                var newJson = JSON.stringify(slotCheck.slot);
                if (oldJson !== newJson) {
                    candidate.slot = slotCheck.slot;
                    hasChanges = true;
                }
            }
        }

        if (updates.notes !== undefined) {
            var notes = updates.notes || '';
            if (candidate.notes !== notes) {
                candidate.notes = notes;
                hasChanges = true;
            }
        }

        if (!hasChanges) {
            return Promise.resolve(success({ grade: decorateGrade(existing), changed: false }));
        }

        var candidateCheck = validateCandidate(candidate);
        if (!candidateCheck.valid) {
            return Promise.resolve(failure(candidateCheck.message));
        }

        candidate.updatedAt = new Date().toISOString();
        var targetId = String(gradeId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy || !appData.academy.grades) {
                    return { valid: false, message: 'Grade no longer exists.' };
                }
                if (!findGradeInSnapshot(appData, targetId)) {
                    return { valid: false, message: 'Grade no longer exists.' };
                }
                return validateCandidateAgainstSnapshot(candidate, appData);
            },
            mutate: function(appData) {
                if (!appData.academy || !appData.academy.grades) {
                    throw new Error('Academy data is not available.');
                }
                if (!appData.academy.grades[targetId]) {
                    throw new Error('Grade not found in data store.');
                }
                appData.academy.grades[targetId] = deepClone(candidate);
                return { grade: candidate, changed: true };
            },
            logMessage: 'Updated grade for student ' + candidate.studentId,
            successMessage: 'Grade updated successfully!',
            failureMessage: 'Failed to update grade.'
        });
    }

    function deleteGrade(gradeId) {
        if (!isNonEmptyString(gradeId)) {
            return Promise.resolve(failure('Grade ID is required.'));
        }

        var target = String(gradeId);
        var existing = getGradeRecord(target);
        if (!existing) {
            return Promise.resolve(failure('Grade not found.'));
        }

        var gradeInfo = {
            id: target,
            studentId: existing.studentId,
            disciplineId: existing.disciplineId,
            week: existing.week
        };

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy || !appData.academy.grades) {
                    return { valid: false, message: 'Grade no longer exists.' };
                }
                if (!findGradeInSnapshot(appData, target)) {
                    return { valid: false, message: 'Grade no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                if (!appData.academy || !appData.academy.grades) {
                    throw new Error('Academy data is not available.');
                }
                if (!appData.academy.grades[target]) {
                    throw new Error('Grade not found in data store.');
                }
                delete appData.academy.grades[target];
                return { deleted: true, grade: gradeInfo };
            },
            logMessage: 'Deleted grade',
            successMessage: 'Grade deleted successfully!',
            failureMessage: 'Failed to delete grade.'
        });
    }

    function deleteStudentGrades(studentId) {
        if (!isNonEmptyString(studentId)) {
            return Promise.resolve(failure('Student ID is required.'));
        }

        var targetStudent = String(studentId);

        return MutationPipeline.performMutation({
            validate: function(appData) {
                if (!appData || !appData.academy || !appData.academy.grades) {
                    return { valid: false, message: 'Academy data is not available.' };
                }
                return { valid: true };
            },
            mutate: function(appData) {
                var grades = appData.academy.grades;
                var toRemove = [];
                var removed = [];

                for (var id in grades) {
                    if (Object.prototype.hasOwnProperty.call(grades, id)) {
                        var grade = grades[id];
                        if (grade && String(grade.studentId) === targetStudent) {
                            toRemove.push(id);
                            removed.push({
                                id: id,
                                disciplineId: grade.disciplineId,
                                week: grade.week
                            });
                        }
                    }
                }

                for (var i = 0; i < toRemove.length; i++) {
                    delete grades[toRemove[i]];
                }

                return {
                    studentId: targetStudent,
                    removedCount: removed.length,
                    removed: removed
                };
            },
            logMessage: 'Deleted all grades for student ' + targetStudent,
            successMessage: 'Student grades deleted successfully!',
            failureMessage: 'Failed to delete student grades.'
        });
    }

    // ============================================================
    // PUBLIC READ SURFACE (CLONES)
    // ============================================================

    function sortGrades(a, b) {
        if (a.week !== b.week) {
            return a.week - b.week;
        }
        return (a.createdAt || '').localeCompare(b.createdAt || '');
    }

    function filterGradesByStudentAndClass(all, studentId, classId) {
        var targetStudent = String(studentId);
        var targetClass = String(classId);
        var result = [];

        for (var i = 0; i < all.length; i++) {
            var grade = all[i];
            if (String(grade.studentId) !== targetStudent) {
                continue;
            }
            if (String(grade.classId) !== targetClass) {
                continue;
            }
            result.push(grade);
        }

        return result;
    }

    function getStudentGrades(studentId, week) {
        if (!isNonEmptyString(studentId)) {
            return [];
        }

        var all = getGradeRecords();
        var targetStudent = String(studentId);
        var result = [];

        var weekFilter = null;
        if (week !== undefined) {
            weekFilter = parseWeekStrict(week);
            if (weekFilter === null) {
                return [];
            }
        }

        for (var i = 0; i < all.length; i++) {
            var grade = all[i];
            if (String(grade.studentId) !== targetStudent) {
                continue;
            }
            if (weekFilter !== null && grade.week !== weekFilter) {
                continue;
            }
            result.push(grade);
        }

        result.sort(sortGrades);
        return result.map(function(g) { return deepClone(g); });
    }

    function getStudentClassGrades(studentId, classId, week) {
        if (!isNonEmptyString(studentId) || !isNonEmptyString(classId)) {
            return [];
        }

        var all = getGradeRecords();

        var weekFilter = null;
        if (week !== undefined) {
            weekFilter = parseWeekStrict(week);
            if (weekFilter === null) {
                return [];
            }
        }

        var result = filterGradesByStudentAndClass(
            all, studentId, classId
        );

        if (weekFilter !== null) {
            var filtered = [];
            for (var i = 0; i < result.length; i++) {
                if (result[i].week === weekFilter) {
                    filtered.push(result[i]);
                }
            }
            result = filtered;
        }

        result.sort(sortGrades);
        return result.map(function(g) { return deepClone(g); });
    }

    function getClassGrades(classId, week) {
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var all = getGradeRecords();
        var targetClass = String(classId);
        var result = [];

        var weekFilter = null;
        if (week !== undefined) {
            weekFilter = parseWeekStrict(week);
            if (weekFilter === null) {
                return [];
            }
        }

        for (var i = 0; i < all.length; i++) {
            var grade = all[i];
            if (String(grade.classId) !== targetClass) {
                continue;
            }
            if (weekFilter !== null && grade.week !== weekFilter) {
                continue;
            }
            result.push(grade);
        }

        result.sort(sortGrades);
        return result.map(function(g) { return deepClone(g); });
    }

    function getDisciplineGrades(disciplineId, week) {
        if (!isNonEmptyString(disciplineId)) {
            return [];
        }

        var all = getGradeRecords();
        var targetDiscipline = String(disciplineId);
        var result = [];

        var weekFilter = null;
        if (week !== undefined) {
            weekFilter = parseWeekStrict(week);
            if (weekFilter === null) {
                return [];
            }
        }

        for (var i = 0; i < all.length; i++) {
            var grade = all[i];
            if (String(grade.disciplineId) !== targetDiscipline) {
                continue;
            }
            if (weekFilter !== null && grade.week !== weekFilter) {
                continue;
            }
            result.push(grade);
        }

        result.sort(sortGrades);
        return result.map(function(g) { return deepClone(g); });
    }

    function getWeekGrades(week, classId) {
        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            return [];
        }

        var all = getGradeRecords();
        var targetClass = isNonEmptyString(classId) ? String(classId) : null;
        var result = [];

        for (var i = 0; i < all.length; i++) {
            var grade = all[i];
            if (grade.week !== weekNum) {
                continue;
            }
            if (targetClass !== null &&
                String(grade.classId) !== targetClass) {
                continue;
            }
            result.push(grade);
        }

        return result.map(function(g) { return deepClone(g); });
    }

    function getGrade(gradeId) {
        var grade = getGradeRecord(gradeId);
        return grade ? deepClone(grade) : null;
    }

    function getAllGrades() {
        var records = getGradeRecords();
        var result = [];
        for (var i = 0; i < records.length; i++) {
            result.push(deepClone(records[i]));
        }
        return result;
    }

    // ============================================================
    // CALCULATION FUNCTIONS - Pure
    // ============================================================

    function calculateSummary(grades, scheme) {
        if (!Array.isArray(grades)) {
            throw new Error(
                '[AcademyGrades] calculateSummary requires an array of grades.'
            );
        }

        var count = grades.length;

        if (count === 0) {
            return {
                count: 0,
                average: 0,
                max: 0,
                min: 0,
                passing: 0,
                failing: 0,
                passRate: 0,
                gradeDistribution: {}
            };
        }

        var total = 0;
        var max = -Infinity;
        var min = Infinity;
        var passing = 0;
        var failing = 0;
        var distribution = {};

        for (var i = 0; i < grades.length; i++) {
            var grade = grades[i];
            if (!isObject(grade)) {
                throw new Error(
                    '[AcademyGrades] calculateSummary received a ' +
                    'malformed grade at index ' + i + '. A summary ' +
                    'must include every entry it was given.'
                );
            }

            var pct = calculatePercentage(grade.score, grade.maxScore);

            total += pct;
            if (pct > max) max = pct;
            if (pct < min) min = pct;

            var isPass = GradeSchemes.isPassing(pct, scheme || null) === true;

            if (isPass) {
                passing++;
            } else {
                failing++;
            }

            var bin = Math.floor(pct / 10) * 10;
            var binKey = bin + '-' + (bin + 9);
            if (pct === 100) {
                binKey = '100';
            }
            if (!distribution[binKey]) {
                distribution[binKey] = 0;
            }
            distribution[binKey]++;
        }

        var avg = total / count;

        return {
            count: count,
            average: Math.round(avg * 10) / 10,
            max: Math.round(max * 10) / 10,
            min: Math.round(min * 10) / 10,
            passing: passing,
            failing: failing,
            passRate: Math.round((passing / count) * 100),
            gradeDistribution: distribution
        };
    }

    function calculateClassSummary(classId, week, scheme) {
        var grades = getClassGrades(classId, week);
        return calculateSummary(grades, scheme);
    }

    // ============================================================
    // CASCADE HELPERS - Remove all references to a character ID
    // ============================================================

    function stripCharacterRefs(appData, charId) {
        var result = { gradesRemoved: 0 };

        if (!appData || !charId) {
            return result;
        }

        if (!appData.academy || typeof appData.academy !== 'object') {
            return result;
        }

        var grades = appData.academy.grades;

        if (grades === undefined || grades === null) {
            return result;
        }

        if (typeof grades !== 'object' || Array.isArray(grades)) {
            throw new Error(
                '[AcademyGrades] stripCharacterRefs found a malformed ' +
                'academy.grades store on the snapshot. Expected a ' +
                'plain object; got ' +
                (Array.isArray(grades) ? 'array' : typeof grades) + '.'
            );
        }

        var target = String(charId);
        var keysToRemove = [];

        Object.keys(grades).forEach(function(id) {
            var grade = grades[id];
            if (grade && String(grade.studentId) === target) {
                keysToRemove.push(id);
            }
        });

        for (var i = 0; i < keysToRemove.length; i++) {
            delete grades[keysToRemove[i]];
        }

        result.gradesRemoved = keysToRemove.length;
        return result;
    }

    // ============================================================
    // BULK OPERATIONS - Via MutationPipeline
    // ============================================================

    function saveGrades(gradesData, options) {
        if (!Array.isArray(gradesData) || gradesData.length === 0) {
            return Promise.resolve(failure('Grade data array is required.'));
        }

        options = options || {};
        var overwrite = options.overwrite !== false;

        var existingGrades = getGradeRecords();
        var planned = [];
        var errors = [];
        var seenTuples = Object.create(null);

        for (var i = 0; i < gradesData.length; i++) {
            var data = gradesData[i];
            if (!isObject(data)) {
                errors.push({ index: i, error: 'Invalid grade data.' });
                continue;
            }

            if (!data.studentId || !data.classId || !data.disciplineId ||
                data.week === undefined || data.score === undefined) {
                errors.push({
                    index: i,
                    error: 'Missing required fields: studentId, classId, disciplineId, week, score'
                });
                continue;
            }

            var validation = validateGradeData(data, false);
            if (!validation.valid) {
                errors.push({ index: i, error: validation.message });
                continue;
            }

            var effectiveType = data.type || DEFAULT_GRADE_TYPE;
            var tupleKey = String(data.studentId) + '::' +
                           String(data.classId) + '::' +
                           String(data.disciplineId) + '::' +
                           String(parseWeekStrict(data.week)) + '::' +
                           String(effectiveType);
            if (seenTuples[tupleKey]) {
                errors.push({
                    index: i,
                    error: 'Duplicate entry for the same (student, class, discipline, week, type).'
                });
                continue;
            }
            seenTuples[tupleKey] = true;

            var existing = null;
            for (var j = 0; j < existingGrades.length; j++) {
                var g = existingGrades[j];
                if (String(g.studentId) === String(data.studentId) &&
                    String(g.classId) === String(data.classId) &&
                    String(g.disciplineId) === String(data.disciplineId) &&
                    parseWeekStrict(g.week) === parseWeekStrict(data.week) &&
                    String(g.type || DEFAULT_GRADE_TYPE) === String(effectiveType)) {
                    existing = g;
                    break;
                }
            }

            if (existing && !overwrite) {
                planned.push({ action: 'skip' });
                continue;
            }

            if (existing) {
                var candidate;
                try {
                    candidate = buildGradeRecord(data, existing.id, existing.createdAt);
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
                    newRecord = buildGradeRecord(data, null, null);
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
                total: gradesData.length,
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
                        if (findGradeInSnapshot(appData, item.record.id)) {
                            return {
                                valid: false,
                                message: 'Grade ID collision during ' +
                                    'save: ' + item.record.id
                            };
                        }
                        var createCheck = validateCandidateAgainstSnapshot(
                            item.record, appData
                        );
                        if (!createCheck.valid) {
                            return createCheck;
                        }
                    } else if (item.action === 'update') {
                        if (!findGradeInSnapshot(appData, item.matchId)) {
                            return {
                                valid: false,
                                message: 'Grade no longer exists: ' +
                                    item.matchId
                            };
                        }
                        var updateCheck = validateCandidateAgainstSnapshot(
                            item.record, appData
                        );
                        if (!updateCheck.valid) {
                            return updateCheck;
                        }
                    }
                }

                return { valid: true };
            },
            mutate: function(appData) {
                if (!appData.academy.grades || typeof appData.academy.grades !== 'object') {
                    appData.academy.grades = {};
                }

                var created = 0;
                var updated = 0;

                for (var k = 0; k < planned.length; k++) {
                    var item = planned[k];
                    if (item.action === 'create') {
                        appData.academy.grades[item.record.id] = deepClone(item.record);
                        created++;
                    } else if (item.action === 'update') {
                        if (!appData.academy.grades[item.matchId]) {
                            throw new Error('Grade no longer exists: ' + item.matchId);
                        }
                        appData.academy.grades[item.matchId] = deepClone(item.record);
                        updated++;
                    }
                }

                return {
                    total: gradesData.length,
                    created: created,
                    updated: updated,
                    skipped: skipped,
                    errors: errors,
                    successCount: created + updated
                };
            },
            logMessage: 'Saved ' + (creates.length + updates.length) + ' grade(s)',
            successMessage: 'Grades saved successfully!',
            failureMessage: 'Failed to save grades.'
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyGrades = {
        // ---- Mutations (Promise-based) ----
        create: create,
        update: update,
        delete: deleteGrade,
        deleteStudentGrades: deleteStudentGrades,
        saveGrades: saveGrades,

        // ---- Public queries (synchronous, CLONES) ----
        getStudentGrades: getStudentGrades,
        getStudentClassGrades: getStudentClassGrades,
        getClassGrades: getClassGrades,
        getDisciplineGrades: getDisciplineGrades,
        getWeekGrades: getWeekGrades,
        getGrade: getGrade,
        getAllGrades: getAllGrades,

        // ---- Calculations (synchronous, pure) ----
        calculateSummary: calculateSummary,
        calculateClassSummary: calculateClassSummary,

        // ---- Derived field helpers ----
        decorateGrade: decorateGrade,
        decorateGrades: decorateGrades,
        calculatePercentage: calculatePercentage,
        isPassing: isPassing,

        // ---- Type vocabulary ----
        VALID_GRADE_TYPES: VALID_GRADE_TYPES,
        DEFAULT_GRADE_TYPE: DEFAULT_GRADE_TYPE,
        TYPE_WITHOUT_SLOT: TYPE_WITHOUT_SLOT,
        GRADE_TYPE_LABELS: GRADE_TYPE_LABELS,
        getGradeTypeLabel: getGradeTypeLabel,
        isSlotlessType: isSlotlessType,

        // ---- Slot helper ----
        normaliseSlot: normaliseSlot,

        // ---- Cascade helpers (for cross-domain cleanup) ----
        stripCharacterRefs: stripCharacterRefs,

        // ---- Internal (LIVE REFERENCES) ----
        getGradeRecord: getGradeRecord,
        getGradeRecords: getGradeRecords,

        // ---- Constants ----
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        MIN_SCORE: MIN_SCORE,
        MAX_SCORE: MAX_SCORE,
        DEFAULT_PASSING_THRESHOLD: DEFAULT_PASSING_THRESHOLD
    };

})();
