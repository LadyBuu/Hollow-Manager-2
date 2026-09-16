/**
 * js/modules/missions/mission-schema.js - Mission Schema
 *
 * Path: js/modules/missions/mission-schema.js
 *
 * Structural validation and canonicalisation for missions.
 *
 * WHAT THIS MODULE OWNS:
 *   - The canonical mission shape.
 *   - Structural validation of a mission record.
 *   - Structural validation of nested records (objectives, log
 *     entries, reports, tags, support personnel, pairings).
 *   - Conservative canonicalisation: given a structurally valid
 *     input, produce the canonical representation.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Vocabulary. Every enum, label, and default lives in
 *     MissionConstants. This module imports and re-checks those
 *     values but does not redefine them.
 *   - Year validation. MissionId.isValidYear owns the rule.
 *   - Domain rules. Whether a mission is ready to complete, whether
 *     an objective can be edited, whether a team is eligible, how
 *     progress is derived, how pay is derived — MissionRules owns
 *     all of that. This module only checks that stored values are
 *     structurally valid, not that they satisfy business rules.
 *   - Mutations. MissionCore owns those.
 *   - Reads. MissionQueries owns those.
 *   - Cross-domain existence checks. Whether a team exists, whether
 *     a character exists, whether a support personnel entry refers
 *     to a live character — none of that is here. This module
 *     validates structure only. Cross-domain concerns belong to the
 *     caller and are re-checked against the transaction snapshot.
 *
 * CANONICAL MISSION SHAPE:
 *
 *   {
 *     id:                 string,       // UUID (IdUtils)
 *     title:              string,       // required, non-empty
 *     description:        string,
 *
 *     year:               number|null,  // unbounded positive integer
 *     month:              number|null,  // 1..12
 *     day:                number|null,  // 1..31
 *
 *     sequence:           number,       // >= 1, scoped to (year, difficulty)
 *
 *     primaryType:        string,       // '' or a MissionConstants type id
 *     subtype:            string,       // '' or a valid subtype of primaryType
 *     secondaryType:      string,       // '' or a MissionConstants type id
 *
 *     escalation:         string,       // VALID_ESCALATION_TIERS
 *     threatType:         string,
 *     environment:        string,
 *     location:           string,
 *     duration:           string,
 *
 *     difficulty:         string,       // VALID_DIFFICULTIES
 *     priority:           string,       // VALID_PRIORITIES
 *
 *     basePay:            string,       // raw user-entered string
 *     surchargePay:       string,       // raw user-entered string
 *     pay:                string,       // derived by MissionRules
 *     billing:            string,       // VALID_BILLING_TYPES
 *
 *     assignedTeamId:     string|null,  // UUID, or null
 *     supportPersonnel:   [string],     // character UUIDs, unique
 *
 *     status:             string,       // VALID_STATUSES
 *     objectives:         [{ text, done }],
 *     progress:           number,       // 0..100, derived by MissionRules
 *
 *     notes:              string,
 *     tags:               [string],     // non-empty, trimmed
 *
 *     createdAt:          string,       // ISO 8601
 *     completedAt:        string|null,  // ISO 8601 or null
 *     archivedAt:         string|null,  // ISO 8601 or null
 *
 *     reports:            [{
 *       id,                // UUID (IdUtils)
 *       authorId,          // character UUID, or null when redacted
 *       authorRedacted,    // boolean; true iff authorId === null
 *       text,              // required, non-empty
 *       createdAt,         // ISO 8601
 *       updatedAt          // ISO 8601
 *     }],
 *
 *     log:                [{ timestamp, message }],
 *
 *     graduatingClassId:  string|null,  // UUID, or null
 *     classFilterEnabled: boolean
 *   }
 *
 * DERIVED FIELDS:
 *
 *   `pay` and `progress` are derived. They are structurally checked
 *   here (as strings and numbers, respectively) but their value is
 *   not compared against the calculation. That comparison is a
 *   domain-rule concern and belongs to MissionRules, called from
 *   MissionCore's pipeline validate.
 *
 *   `missionId` is NOT a canonical field. It is derived at read time
 *   by MissionId.derive(mission). It is never stored. The schema
 *   rejects a stored `missionId` field to catch a migration bug that
 *   would reintroduce the drift problem.
 *
 * CANONICALISATION CONTRACT:
 *
 *   canonicaliseMissionShape(input) returns:
 *
 *     { valid: true,  errors: [], value: <canonical mission> }
 *
 *   or:
 *
 *     { valid: false, errors: [...], value: null }
 *
 *   On failure, `value` is null. The caller MUST NOT persist or
 *   otherwise use a partially-transformed object. There is no partial
 *   success.
 *
 *   The canonicaliser does NOT:
 *     - Apply semantic defaults (status, priority, difficulty,
 *       billing, escalation). Creation defaults belong to
 *       MissionCore, applied before canonicalisation.
 *     - Generate timestamps. If `createdAt` is missing or invalid,
 *       the result is `valid: false`, not "invent the current time."
 *     - Generate IDs. If `id` is missing or invalid, the result is
 *       `valid: false`.
 *     - Generate sequence numbers. Sequence is assigned at creation
 *       by MissionCore via MissionId.generate.
 *     - Silently drop malformed nested records. A bad objective,
 *       log entry, report, or support personnel entry makes the
 *       whole canonicalisation fail.
 *     - Compare `pay` / `progress` to their derived values.
 *       MissionRules owns that comparison.
 *
 *   What it DOES do:
 *     - Trim strings.
 *     - Coerce numeric strings to numbers when the canonical type
 *       is number (e.g. `month: "9"` -> `month: 9`).
 *     - Normalise support personnel IDs via IdUtils.
 *     - Drop duplicate support personnel IDs after surfacing the
 *       error, so that the reported errors contain the specific
 *       duplicate.
 *     - Drop empty tags after surfacing the error.
 *     - Preserve unknown top-level fields (deep-cloned) so future
 *       schema extensions and domain-specific metadata survive a
 *       round trip.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CalendarValidation
 *   - window.IdUtils
 *   - window.ObjectUtils
 *   - window.MissionConstants
 *   - window.MissionId
 */

(function() {
    'use strict';

    if (window.__missionSchemaLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var CalendarValidation = window.CalendarValidation;
    var IdUtils = window.IdUtils;
    var ObjectUtils = window.ObjectUtils;
    var MissionConstants = window.MissionConstants;
    var MissionId = window.MissionId;

    var _missing = [];

    if (!CalendarValidation) {
        _missing.push('CalendarValidation (module)');
    } else {
        if (typeof CalendarValidation.parseWeek !== 'function') {
            _missing.push('CalendarValidation.parseWeek');
        }
        if (typeof CalendarValidation.isValidCalendarDate !== 'function') {
            _missing.push('CalendarValidation.isValidCalendarDate');
        }
    }

    if (!IdUtils) {
        _missing.push('IdUtils (module)');
    } else {
        if (typeof IdUtils.normaliseId !== 'function') {
            _missing.push('IdUtils.normaliseId');
        }
        if (typeof IdUtils.generateId !== 'function') {
            _missing.push('IdUtils.generateId');
        }
    }

    if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
        _missing.push('ObjectUtils.deepClone');
    }

    if (!MissionConstants) {
        _missing.push('MissionConstants (module)');
    } else {
        if (!Array.isArray(MissionConstants.VALID_STATUSES)) {
            _missing.push('MissionConstants.VALID_STATUSES');
        }
        if (!Array.isArray(MissionConstants.VALID_PRIORITIES)) {
            _missing.push('MissionConstants.VALID_PRIORITIES');
        }
        if (!Array.isArray(MissionConstants.VALID_DIFFICULTIES)) {
            _missing.push('MissionConstants.VALID_DIFFICULTIES');
        }
        if (!Array.isArray(MissionConstants.VALID_BILLING_TYPES)) {
            _missing.push('MissionConstants.VALID_BILLING_TYPES');
        }
        if (!Array.isArray(MissionConstants.VALID_ESCALATION_TIERS)) {
            _missing.push('MissionConstants.VALID_ESCALATION_TIERS');
        }
        if (typeof MissionConstants.isValidMissionType !== 'function') {
            _missing.push('MissionConstants.isValidMissionType');
        }
        if (typeof MissionConstants.isValidSubtype !== 'function') {
            _missing.push('MissionConstants.isValidSubtype');
        }
    }

    if (!MissionId || typeof MissionId.isValidYear !== 'function') {
        _missing.push('MissionId.isValidYear');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[MissionSchema] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__missionSchemaLoaded = true;

    // ============================================================
    // SHORTHAND IMPORTS
    // ============================================================

    var VALID_STATUSES = MissionConstants.VALID_STATUSES;
    var VALID_PRIORITIES = MissionConstants.VALID_PRIORITIES;
    var VALID_DIFFICULTIES = MissionConstants.VALID_DIFFICULTIES;
    var VALID_BILLING_TYPES = MissionConstants.VALID_BILLING_TYPES;
    var VALID_ESCALATION_TIERS = MissionConstants.VALID_ESCALATION_TIERS;
    var isValidMissionType = MissionConstants.isValidMissionType;
    var isValidSubtype = MissionConstants.isValidSubtype;
    var isValidYear = MissionId.isValidYear;

    var SCHEMA_VERSION = 1;

    // ============================================================
    // LOW-LEVEL HELPERS
    // ============================================================

    function isPlainObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isNonEmptyStringTrimmedEqual(value, expected) {
        return typeof value === 'string' && value.trim() === expected;
    }

    function deepClone(value) {
        var result = ObjectUtils.deepClone(value);
        if (result === value &&
            value !== null &&
            typeof value === 'object') {
            throw new Error(
                '[MissionSchema] deepClone returned the original reference.'
            );
        }
        return result;
    }

    function normaliseId(value) {
        return IdUtils.normaliseId(value);
    }

    /**
     * Coerce a value to a canonical integer, or return null.
     *
     * Accepts integers and pure-digit strings. Rejects everything
     * else. Does not accept trailing characters, decimals, or signs.
     */
    function coerceInteger(value) {
        if (typeof value === 'number') {
            return Number.isSafeInteger(value) ? value : null;
        }
        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '' || !/^-?\d+$/.test(trimmed)) {
                return null;
            }
            var n = Number(trimmed);
            return Number.isSafeInteger(n) ? n : null;
        }
        return null;
    }

    /**
     * Is the value a valid ISO 8601 timestamp string?
     *
     * Strict: the string must parse as a Date AND the parsed Date's
     * ISO representation must equal the input. This rejects formats
     * Date accepts loosely (e.g. "Dec 25 2026") and requires the
     * canonical form produced by Date.prototype.toISOString.
     */
    function isStrictIsoTimestamp(value) {
        if (typeof value !== 'string' || value === '') {
            return false;
        }
        var parsed = new Date(value);
        if (isNaN(parsed.getTime())) {
            return false;
        }
        return parsed.toISOString() === value;
    }

    // ============================================================
    // ENUM PREDICATES
    // ============================================================

    function isValidStatus(value) {
        return VALID_STATUSES.indexOf(value) !== -1;
    }

    function isValidPriority(value) {
        return VALID_PRIORITIES.indexOf(value) !== -1;
    }

    function isValidDifficulty(value) {
        return VALID_DIFFICULTIES.indexOf(value) !== -1;
    }

    function isValidBilling(value) {
        return VALID_BILLING_TYPES.indexOf(value) !== -1;
    }

    function isValidEscalation(value) {
        return VALID_ESCALATION_TIERS.indexOf(value) !== -1;
    }

    // ============================================================
    // NESTED VALIDATORS
    // ============================================================
    //
    // Each validator appends to an `errors` array. None throws. None
    // mutates the input.

    function validateObjective(objective, index, errors) {
        if (!isPlainObject(objective)) {
            errors.push('Objective ' + (index + 1) + ' must be an object.');
            return;
        }
        if (!isNonEmptyString(objective.text)) {
            errors.push(
                'Objective ' + (index + 1) + ' requires non-empty text.'
            );
        }
        if (objective.done !== undefined &&
            typeof objective.done !== 'boolean') {
            errors.push(
                'Objective ' + (index + 1) + ' done must be a boolean.'
            );
        }
    }

    function validateLogEntry(entry, index, errors) {
        if (!isPlainObject(entry)) {
            errors.push('Log entry ' + (index + 1) + ' must be an object.');
            return;
        }
        if (!isStrictIsoTimestamp(entry.timestamp)) {
            errors.push(
                'Log entry ' + (index + 1) +
                ' timestamp must be an ISO 8601 string.'
            );
        }
        if (!isNonEmptyString(entry.message)) {
            errors.push(
                'Log entry ' + (index + 1) + ' requires non-empty message.'
            );
        }
    }

    function validateReport(report, index, errors) {
        if (!isPlainObject(report)) {
            errors.push('Report ' + (index + 1) + ' must be an object.');
            return;
        }

        if (normaliseId(report.id) === null) {
            errors.push('Report ' + (index + 1) + ' id is required.');
        }

        var hasAuthorId = report.authorId !== undefined &&
                          report.authorId !== null;

        if (hasAuthorId) {
            if (normaliseId(report.authorId) === null) {
                errors.push(
                    'Report ' + (index + 1) + ' authorId must be a valid ' +
                    'id or null.'
                );
            }
            if (report.authorRedacted === true) {
                errors.push(
                    'Report ' + (index + 1) +
                    ' cannot have both authorId and authorRedacted=true.'
                );
            }
        } else {
            if (report.authorRedacted !== true) {
                errors.push(
                    'Report ' + (index + 1) +
                    ' must have authorId or authorRedacted=true.'
                );
            }
        }

        if (!isNonEmptyString(report.text)) {
            errors.push('Report ' + (index + 1) + ' requires non-empty text.');
        }

        if (!isStrictIsoTimestamp(report.createdAt)) {
            errors.push(
                'Report ' + (index + 1) +
                ' createdAt must be an ISO 8601 string.'
            );
        }

        if (report.updatedAt !== undefined && report.updatedAt !== null) {
            if (!isStrictIsoTimestamp(report.updatedAt)) {
                errors.push(
                    'Report ' + (index + 1) +
                    ' updatedAt must be an ISO 8601 string or null.'
                );
            }
        }
    }

    function validateTag(tag, index, errors) {
        if (typeof tag !== 'string') {
            errors.push('Tag ' + (index + 1) + ' must be a string.');
            return;
        }
        if (tag.trim() === '') {
            errors.push('Tag ' + (index + 1) + ' cannot be empty.');
        }
    }

    function validateSupportPersonnel(id, index, errors) {
        if (normaliseId(id) === null) {
            errors.push(
                'Support personnel entry ' + (index + 1) +
                ' must be a valid id.'
            );
        }
    }

    function validateSupportPersonnelUniqueness(ids, errors) {
        var seen = Object.create(null);
        for (var i = 0; i < ids.length; i++) {
            var normalised = normaliseId(ids[i]);
            if (normalised === null) {
                continue;
            }
            if (seen[normalised] === true) {
                errors.push(
                    'Duplicate support personnel id: ' + normalised + '.'
                );
            }
            seen[normalised] = true;
        }
    }

    // ============================================================
    // FULL MISSION VALIDATION
    // ============================================================

    /**
     * Validate a mission record.
     *
     * Does NOT require any particular field to be absent or present
     * beyond what the canonical shape defines. Missing required
     * fields are errors; missing optional fields are not.
     *
     * Does NOT check derived values against their derivation.
     * MissionRules is responsible for that, when it matters.
     *
     * Returns { valid: boolean, errors: [...] }.
     */
    function validateMission(mission) {
        var errors = [];

        if (!isPlainObject(mission)) {
            return { valid: false, errors: ['Mission must be an object.'] };
        }

        // ---- id ----
        if (normaliseId(mission.id) === null) {
            errors.push('Mission id is required.');
        }

        // ---- title ----
        if (!isNonEmptyString(mission.title)) {
            errors.push('Mission title is required.');
        }

        // ---- stored missionId is forbidden ----
        // missionId is derived, not stored. A stored field means a
        // migration or a caller re-introduced the old model.
        if (mission.missionId !== undefined && mission.missionId !== null) {
            errors.push(
                'Mission must not carry a stored "missionId" field. ' +
                'missionId is derived by MissionId.derive().'
            );
        }

        // ---- year / month / day ----
        var hasYear = mission.year !== undefined && mission.year !== null;
        var hasMonth = mission.month !== undefined && mission.month !== null;
        var hasDay = mission.day !== undefined && mission.day !== null;

        if (hasYear) {
            if (isValidYear(mission.year) === null) {
                errors.push('Year must be a positive integer.');
            }
        }

        if (hasMonth) {
            var month = coerceInteger(mission.month);
            if (month === null || month < 1 || month > 12) {
                errors.push('Month must be an integer between 1 and 12.');
            }
        }

        if (hasDay) {
            var day = coerceInteger(mission.day);
            if (day === null || day < 1 || day > 31) {
                errors.push('Day must be an integer between 1 and 31.');
            }
        }

        if (hasYear && hasMonth && hasDay &&
            isValidYear(mission.year) !== null) {
            var yearNum = isValidYear(mission.year);
            var monthNum = coerceInteger(mission.month);
            var dayNum = coerceInteger(mission.day);
            if (yearNum !== null && monthNum !== null && dayNum !== null) {
                if (typeof CalendarValidation.isValidCalendarDate === 'function') {
                    if (!CalendarValidation.isValidCalendarDate(
                        yearNum, monthNum, dayNum
                    )) {
                        errors.push('Invalid calendar date.');
                    }
                }
            }
        }

        // ---- sequence ----
        var sequence = coerceInteger(mission.sequence);
        if (sequence === null || sequence < 1) {
            errors.push('Sequence must be an integer >= 1.');
        }

        // ---- difficulty ----
        if (!isValidDifficulty(mission.difficulty)) {
            errors.push(
                'Invalid difficulty: "' + mission.difficulty + '".'
            );
        }

        // ---- status ----
        if (!isValidStatus(mission.status)) {
            errors.push('Invalid status: "' + mission.status + '".');
        }

        // ---- priority ----
        if (!isValidPriority(mission.priority)) {
            errors.push('Invalid priority: "' + mission.priority + '".');
        }

        // ---- billing ----
        if (!isValidBilling(mission.billing)) {
            errors.push('Invalid billing type: "' + mission.billing + '".');
        }

        // ---- escalation ----
        if (!isValidEscalation(mission.escalation)) {
            errors.push(
                'Invalid escalation tier: "' + mission.escalation + '".'
            );
        }

        // ---- primaryType / subtype / secondaryType ----
        var primaryType = mission.primaryType;
        if (primaryType !== undefined && primaryType !== null &&
            primaryType !== '') {
            if (!isValidMissionType(primaryType)) {
                errors.push(
                    'Invalid primary type: "' + primaryType + '".'
                );
            }
        }

        var subtype = mission.subtype;
        if (subtype !== undefined && subtype !== null && subtype !== '') {
            if (!primaryType) {
                errors.push('Subtype requires a primary type.');
            } else if (!isValidSubtype(primaryType, subtype)) {
                errors.push(
                    'Invalid subtype "' + subtype +
                    '" for primary type "' + primaryType + '".'
                );
            }
        }

        var secondaryType = mission.secondaryType;
        if (secondaryType !== undefined && secondaryType !== null &&
            secondaryType !== '') {
            if (!isValidMissionType(secondaryType)) {
                errors.push(
                    'Invalid secondary type: "' + secondaryType + '".'
                );
            }
        }

        // ---- objectives ----
        if (!Array.isArray(mission.objectives)) {
            errors.push('Objectives must be an array.');
        } else {
            for (var i = 0; i < mission.objectives.length; i++) {
                validateObjective(mission.objectives[i], i, errors);
            }
        }

        // ---- support personnel ----
        if (!Array.isArray(mission.supportPersonnel)) {
            errors.push('Support personnel must be an array.');
        } else {
            for (var j = 0; j < mission.supportPersonnel.length; j++) {
                validateSupportPersonnel(
                    mission.supportPersonnel[j], j, errors
                );
            }
            validateSupportPersonnelUniqueness(
                mission.supportPersonnel, errors
            );
        }

        // ---- tags ----
        if (!Array.isArray(mission.tags)) {
            errors.push('Tags must be an array.');
        } else {
            for (var k = 0; k < mission.tags.length; k++) {
                validateTag(mission.tags[k], k, errors);
            }
        }

        // ---- log ----
        if (!Array.isArray(mission.log)) {
            errors.push('Log must be an array.');
        } else {
            for (var l = 0; l < mission.log.length; l++) {
                validateLogEntry(mission.log[l], l, errors);
            }
        }

        // ---- reports ----
        if (!Array.isArray(mission.reports)) {
            errors.push('Reports must be an array.');
        } else {
            for (var m = 0; m < mission.reports.length; m++) {
                validateReport(mission.reports[m], m, errors);
            }
        }

        // ---- progress ----
        if (typeof mission.progress !== 'number' ||
            !isFinite(mission.progress) ||
            mission.progress < 0 ||
            mission.progress > 100) {
            errors.push('Progress must be a number between 0 and 100.');
        }

        // ---- pay ----
        if (typeof mission.pay !== 'string') {
            errors.push('Pay must be a string.');
        }

        // ---- basePay / surchargePay ----
        if (mission.basePay !== undefined &&
            mission.basePay !== null &&
            typeof mission.basePay !== 'string') {
            errors.push('basePay must be a string.');
        }
        if (mission.surchargePay !== undefined &&
            mission.surchargePay !== null &&
            typeof mission.surchargePay !== 'string') {
            errors.push('surchargePay must be a string.');
        }

        // ---- createdAt ----
        if (!isStrictIsoTimestamp(mission.createdAt)) {
            errors.push('createdAt must be an ISO 8601 string.');
        }

        // ---- completedAt ----
        if (mission.completedAt !== undefined &&
            mission.completedAt !== null) {
            if (!isStrictIsoTimestamp(mission.completedAt)) {
                errors.push(
                    'completedAt must be an ISO 8601 string or null.'
                );
            }
        }

        // ---- archivedAt ----
        if (mission.archivedAt !== undefined &&
            mission.archivedAt !== null) {
            if (!isStrictIsoTimestamp(mission.archivedAt)) {
                errors.push(
                    'archivedAt must be an ISO 8601 string or null.'
                );
            }
        }

        // ---- assignedTeamId ----
        if (mission.assignedTeamId !== undefined &&
            mission.assignedTeamId !== null) {
            if (normaliseId(mission.assignedTeamId) === null) {
                errors.push('assignedTeamId must be a valid id or null.');
            }
        }

        // ---- graduatingClassId ----
        if (mission.graduatingClassId !== undefined &&
            mission.graduatingClassId !== null) {
            if (normaliseId(mission.graduatingClassId) === null) {
                errors.push('graduatingClassId must be a valid id or null.');
            }
        }

        // ---- classFilterEnabled ----
        if (typeof mission.classFilterEnabled !== 'boolean') {
            errors.push('classFilterEnabled must be a boolean.');
        }

        // ---- textual fields ----
        var textualFields = [
            'description',
            'threatType',
            'environment',
            'location',
            'duration',
            'notes'
        ];
        for (var t = 0; t < textualFields.length; t++) {
            var field = textualFields[t];
            if (mission[field] !== undefined &&
                mission[field] !== null &&
                typeof mission[field] !== 'string') {
                errors.push(field + ' must be a string.');
            }
        }

        return { valid: errors.length === 0, errors: errors };
    }

    // ============================================================
    // CANONICALISATION
    // ============================================================
    //
    // Conservative. Given structurally valid input, produce the
    // canonical shape. On any error, return { valid: false, errors,
    // value: null }.
    //
    // The canonicaliser is used by MissionCore.createMission and
    // MissionCore.updateMission, after creation defaults have been
    // applied by the caller. It is NOT a repair tool: malformed
    // input is reported, not silently fixed.

    function canonicaliseObjective(objective, index, errors) {
        if (!isPlainObject(objective)) {
            errors.push('Objective ' + (index + 1) + ' must be an object.');
            return null;
        }
        var text = typeof objective.text === 'string'
            ? objective.text.trim()
            : '';
        if (text === '') {
            errors.push(
                'Objective ' + (index + 1) + ' requires non-empty text.'
            );
            return null;
        }
        if (objective.done !== undefined &&
            typeof objective.done !== 'boolean') {
            errors.push(
                'Objective ' + (index + 1) + ' done must be a boolean.'
            );
            return null;
        }
        return {
            text: text,
            done: objective.done === true
        };
    }

    function canonicaliseLogEntry(entry, index, errors) {
        if (!isPlainObject(entry)) {
            errors.push('Log entry ' + (index + 1) + ' must be an object.');
            return null;
        }
        if (!isStrictIsoTimestamp(entry.timestamp)) {
            errors.push(
                'Log entry ' + (index + 1) +
                ' timestamp must be an ISO 8601 string.'
            );
            return null;
        }
        var message = typeof entry.message === 'string'
            ? entry.message.trim()
            : '';
        if (message === '') {
            errors.push(
                'Log entry ' + (index + 1) + ' requires non-empty message.'
            );
            return null;
        }
        return {
            timestamp: entry.timestamp,
            message: message
        };
    }

    function canonicaliseReport(report, index, errors) {
        if (!isPlainObject(report)) {
            errors.push('Report ' + (index + 1) + ' must be an object.');
            return null;
        }

        var id = normaliseId(report.id);
        if (id === null) {
            errors.push('Report ' + (index + 1) + ' id is required.');
            return null;
        }

        var authorId = null;
        var authorRedacted = false;

        var hasAuthorId = report.authorId !== undefined &&
                          report.authorId !== null;

        if (hasAuthorId) {
            authorId = normaliseId(report.authorId);
            if (authorId === null) {
                errors.push(
                    'Report ' + (index + 1) +
                    ' authorId must be a valid id or null.'
                );
                return null;
            }
            if (report.authorRedacted === true) {
                errors.push(
                    'Report ' + (index + 1) +
                    ' cannot have both authorId and authorRedacted=true.'
                );
                return null;
            }
        } else {
            if (report.authorRedacted !== true) {
                errors.push(
                    'Report ' + (index + 1) +
                    ' must have authorId or authorRedacted=true.'
                );
                return null;
            }
            authorRedacted = true;
        }

        var text = typeof report.text === 'string'
            ? report.text.trim()
            : '';
        if (text === '') {
            errors.push('Report ' + (index + 1) + ' requires non-empty text.');
            return null;
        }

        if (!isStrictIsoTimestamp(report.createdAt)) {
            errors.push(
                'Report ' + (index + 1) +
                ' createdAt must be an ISO 8601 string.'
            );
            return null;
        }

        var updatedAt = null;
        if (report.updatedAt !== undefined && report.updatedAt !== null) {
            if (!isStrictIsoTimestamp(report.updatedAt)) {
                errors.push(
                    'Report ' + (index + 1) +
                    ' updatedAt must be an ISO 8601 string or null.'
                );
                return null;
            }
            updatedAt = report.updatedAt;
        }

        var result = {
            id: id,
            authorId: authorId,
            authorRedacted: authorRedacted,
            text: text,
            createdAt: report.createdAt,
            updatedAt: updatedAt
        };

        var knownKeys = [
            'id',
            'authorId',
            'authorRedacted',
            'text',
            'createdAt',
            'updatedAt'
        ];
        Object.keys(report).forEach(function(key) {
            if (knownKeys.indexOf(key) === -1) {
                result[key] = deepClone(report[key]);
            }
        });

        return result;
    }

    function canonicaliseTag(tag, index, errors) {
        if (typeof tag !== 'string') {
            errors.push('Tag ' + (index + 1) + ' must be a string.');
            return null;
        }
        var trimmed = tag.trim();
        if (trimmed === '') {
            errors.push('Tag ' + (index + 1) + ' cannot be empty.');
            return null;
        }
        return trimmed;
    }

    function canonicaliseSupportPersonnelEntry(id, index, errors) {
        var normalised = normaliseId(id);
        if (normalised === null) {
            errors.push(
                'Support personnel entry ' + (index + 1) +
                ' must be a valid id.'
            );
            return null;
        }
        return normalised;
    }

    /**
     * Canonicalise a mission.
     *
     * @param {object} input
     * @returns {object} { valid, errors, value }
     */
    function canonicaliseMissionShape(input) {
        var errors = [];

        if (!isPlainObject(input)) {
            return {
                valid: false,
                errors: ['Mission data must be an object.'],
                value: null
            };
        }

        // ---- id ----
        var id = normaliseId(input.id);
        if (id === null) {
            errors.push('Mission id is required.');
        }

        // ---- title ----
        var title = typeof input.title === 'string'
            ? input.title.trim()
            : '';
        if (title === '') {
            errors.push('Mission title is required.');
        }

        // ---- reject stored missionId ----
        if (input.missionId !== undefined && input.missionId !== null) {
            errors.push(
                'Mission must not carry a stored "missionId" field.'
            );
        }

        // ---- year / month / day ----
        var year = null;
        if (input.year !== undefined && input.year !== null && input.year !== '') {
            year = isValidYear(input.year);
            if (year === null) {
                errors.push('Year must be a positive integer.');
            }
        }

        var month = null;
        if (input.month !== undefined && input.month !== null && input.month !== '') {
            var m = coerceInteger(input.month);
            if (m === null || m < 1 || m > 12) {
                errors.push('Month must be an integer between 1 and 12.');
            } else {
                month = m;
            }
        }

        var day = null;
        if (input.day !== undefined && input.day !== null && input.day !== '') {
            var d = coerceInteger(input.day);
            if (d === null || d < 1 || d > 31) {
                errors.push('Day must be an integer between 1 and 31.');
            } else {
                day = d;
            }
        }

        if (year !== null && month !== null && day !== null) {
            if (typeof CalendarValidation.isValidCalendarDate === 'function') {
                if (!CalendarValidation.isValidCalendarDate(
                    year, month, day
                )) {
                    errors.push('Invalid calendar date.');
                }
            }
        }

        // ---- sequence ----
        var sequence = coerceInteger(input.sequence);
        if (sequence === null || sequence < 1) {
            errors.push('Sequence must be an integer >= 1.');
        }

        // ---- difficulty ----
        var difficulty = input.difficulty;
        if (!isValidDifficulty(difficulty)) {
            errors.push(
                'Invalid difficulty: "' + difficulty + '".'
            );
        }

        // ---- status ----
        var status = input.status;
        if (!isValidStatus(status)) {
            errors.push('Invalid status: "' + status + '".');
        }

        // ---- priority ----
        var priority = input.priority;
        if (!isValidPriority(priority)) {
            errors.push('Invalid priority: "' + priority + '".');
        }

        // ---- billing ----
        var billing = input.billing;
        if (!isValidBilling(billing)) {
            errors.push('Invalid billing type: "' + billing + '".');
        }

        // ---- escalation ----
        var escalation = input.escalation;
        if (!isValidEscalation(escalation)) {
            errors.push(
                'Invalid escalation tier: "' + escalation + '".'
            );
        }

        // ---- primaryType / subtype / secondaryType ----
        var primaryType = typeof input.primaryType === 'string'
            ? input.primaryType.trim()
            : '';
        if (primaryType !== '' && !isValidMissionType(primaryType)) {
            errors.push('Invalid primary type: "' + primaryType + '".');
            primaryType = '';
        }

        var subtype = typeof input.subtype === 'string'
            ? input.subtype.trim()
            : '';
        if (subtype !== '') {
            if (primaryType === '') {
                errors.push('Subtype requires a primary type.');
                subtype = '';
            } else if (!isValidSubtype(primaryType, subtype)) {
                errors.push(
                    'Invalid subtype "' + subtype +
                    '" for primary type "' + primaryType + '".'
                );
                subtype = '';
            }
        }

        var secondaryType = typeof input.secondaryType === 'string'
            ? input.secondaryType.trim()
            : '';
        if (secondaryType !== '' && !isValidMissionType(secondaryType)) {
            errors.push('Invalid secondary type: "' + secondaryType + '".');
            secondaryType = '';
        }

        // ---- textual fields ----
        function readString(field) {
            if (input[field] === undefined || input[field] === null) {
                return '';
            }
            if (typeof input[field] !== 'string') {
                errors.push(field + ' must be a string.');
                return '';
            }
            return input[field];
        }

        var description = readString('description');
        var threatType = readString('threatType');
        var environment = readString('environment');
        var location = readString('location');
        var duration = readString('duration');
        var notes = readString('notes');

        // ---- pay fields ----
        var basePay = '';
        if (input.basePay !== undefined && input.basePay !== null) {
            if (typeof input.basePay !== 'string') {
                errors.push('basePay must be a string.');
            } else {
                basePay = input.basePay;
            }
        }

        var surchargePay = '';
        if (input.surchargePay !== undefined && input.surchargePay !== null) {
            if (typeof input.surchargePay !== 'string') {
                errors.push('surchargePay must be a string.');
            } else {
                surchargePay = input.surchargePay;
            }
        }

        var pay = '';
        if (input.pay !== undefined && input.pay !== null) {
            if (typeof input.pay !== 'string') {
                errors.push('Pay must be a string.');
            } else {
                pay = input.pay;
            }
        }

        // ---- progress ----
        var progress = 0;
        if (input.progress !== undefined && input.progress !== null) {
            if (typeof input.progress !== 'number' ||
                !isFinite(input.progress) ||
                input.progress < 0 ||
                input.progress > 100) {
                errors.push('Progress must be a number between 0 and 100.');
            } else {
                progress = input.progress;
            }
        }

        // ---- objectives ----
        var objectives = [];
        if (input.objectives !== undefined && input.objectives !== null) {
            if (!Array.isArray(input.objectives)) {
                errors.push('Objectives must be an array.');
            } else {
                for (var oi = 0; oi < input.objectives.length; oi++) {
                    var obj = canonicaliseObjective(
                        input.objectives[oi], oi, errors
                    );
                    if (obj !== null) {
                        objectives.push(obj);
                    }
                }
            }
        }

        // ---- support personnel ----
        var supportPersonnel = [];
        if (input.supportPersonnel !== undefined &&
            input.supportPersonnel !== null) {
            if (!Array.isArray(input.supportPersonnel)) {
                errors.push('Support personnel must be an array.');
            } else {
                var spSeen = Object.create(null);
                for (var si = 0; si < input.supportPersonnel.length; si++) {
                    var sp = canonicaliseSupportPersonnelEntry(
                        input.supportPersonnel[si], si, errors
                    );
                    if (sp === null) {
                        continue;
                    }
                    if (spSeen[sp] === true) {
                        errors.push(
                            'Duplicate support personnel id: ' + sp + '.'
                        );
                        continue;
                    }
                    spSeen[sp] = true;
                    supportPersonnel.push(sp);
                }
            }
        }

        // ---- tags ----
        var tags = [];
        if (input.tags !== undefined && input.tags !== null) {
            if (!Array.isArray(input.tags)) {
                errors.push('Tags must be an array.');
            } else {
                for (var ti = 0; ti < input.tags.length; ti++) {
                    var tag = canonicaliseTag(input.tags[ti], ti, errors);
                    if (tag !== null) {
                        tags.push(tag);
                    }
                }
            }
        }

        // ---- log ----
        var log = [];
        if (input.log !== undefined && input.log !== null) {
            if (!Array.isArray(input.log)) {
                errors.push('Log must be an array.');
            } else {
                for (var li = 0; li < input.log.length; li++) {
                    var logEntry = canonicaliseLogEntry(
                        input.log[li], li, errors
                    );
                    if (logEntry !== null) {
                        log.push(logEntry);
                    }
                }
            }
        }

        // ---- reports ----
        var reports = [];
        if (input.reports !== undefined && input.reports !== null) {
            if (!Array.isArray(input.reports)) {
                errors.push('Reports must be an array.');
            } else {
                for (var ri = 0; ri < input.reports.length; ri++) {
                    var report = canonicaliseReport(
                        input.reports[ri], ri, errors
                    );
                    if (report !== null) {
                        reports.push(report);
                    }
                }
            }
        }

        // ---- assignedTeamId ----
        var assignedTeamId = null;
        if (input.assignedTeamId !== undefined &&
            input.assignedTeamId !== null) {
            assignedTeamId = normaliseId(input.assignedTeamId);
            if (assignedTeamId === null) {
                errors.push('assignedTeamId must be a valid id or null.');
            }
        }

        // ---- graduatingClassId ----
        var graduatingClassId = null;
        if (input.graduatingClassId !== undefined &&
            input.graduatingClassId !== null) {
            graduatingClassId = normaliseId(input.graduatingClassId);
            if (graduatingClassId === null) {
                errors.push('graduatingClassId must be a valid id or null.');
            }
        }

        // ---- classFilterEnabled ----
        var classFilterEnabled = false;
        if (input.classFilterEnabled !== undefined &&
            input.classFilterEnabled !== null) {
            if (typeof input.classFilterEnabled !== 'boolean') {
                errors.push('classFilterEnabled must be a boolean.');
            } else {
                classFilterEnabled = input.classFilterEnabled;
            }
        }

        // ---- timestamps ----
        var createdAt = input.createdAt;
        if (!isStrictIsoTimestamp(createdAt)) {
            errors.push('createdAt must be an ISO 8601 string.');
        }

        var completedAt = null;
        if (input.completedAt !== undefined && input.completedAt !== null) {
            if (!isStrictIsoTimestamp(input.completedAt)) {
                errors.push(
                    'completedAt must be an ISO 8601 string or null.'
                );
            } else {
                completedAt = input.completedAt;
            }
        }

        var archivedAt = null;
        if (input.archivedAt !== undefined && input.archivedAt !== null) {
            if (!isStrictIsoTimestamp(input.archivedAt)) {
                errors.push(
                    'archivedAt must be an ISO 8601 string or null.'
                );
            } else {
                archivedAt = input.archivedAt;
            }
        }

        // ---- If anything failed, return null value ----
        if (errors.length > 0) {
            return {
                valid: false,
                errors: errors,
                value: null
            };
        }

        // ---- Build canonical object ----
        var result = {
            id: id,
            title: title,
            description: description,

            year: year,
            month: month,
            day: day,
            sequence: sequence,

            primaryType: primaryType,
            subtype: subtype,
            secondaryType: secondaryType,

            escalation: escalation,
            threatType: threatType,
            environment: environment,
            location: location,
            duration: duration,

            difficulty: difficulty,
            priority: priority,

            basePay: basePay,
            surchargePay: surchargePay,
            pay: pay,
            billing: billing,

            assignedTeamId: assignedTeamId,
            supportPersonnel: supportPersonnel,

            status: status,
            objectives: objectives,
            progress: progress,

            notes: notes,
            tags: tags,

            createdAt: createdAt,
            completedAt: completedAt,
            archivedAt: archivedAt,

            reports: reports,
            log: log,

            graduatingClassId: graduatingClassId,
            classFilterEnabled: classFilterEnabled
        };

        // ---- Preserve unknown top-level fields ----
        var knownKeys = [
            'id',
            'missionId',    // explicitly not part of the canonical shape
            'title',
            'description',
            'year',
            'month',
            'day',
            'sequence',
            'primaryType',
            'subtype',
            'secondaryType',
            'escalation',
            'threatType',
            'environment',
            'location',
            'duration',
            'difficulty',
            'priority',
            'basePay',
            'surchargePay',
            'pay',
            'billing',
            'assignedTeamId',
            'supportPersonnel',
            'status',
            'objectives',
            'progress',
            'notes',
            'tags',
            'createdAt',
            'completedAt',
            'archivedAt',
            'reports',
            'log',
            'graduatingClassId',
            'classFilterEnabled'
        ];

        Object.keys(input).forEach(function(key) {
            if (knownKeys.indexOf(key) === -1) {
                result[key] = deepClone(input[key]);
            }
        });

        return { valid: true, errors: [], value: result };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionSchema = Object.freeze({
        SCHEMA_VERSION: SCHEMA_VERSION,

        // Full validation
        validateMission: validateMission,

        // Nested validation (used by MissionCore and by callers that
        // want to validate a single nested record)
        validateObjective: validateObjective,
        validateLogEntry: validateLogEntry,
        validateReport: validateReport,
        validateTag: validateTag,
        validateSupportPersonnel: validateSupportPersonnel,

        // Canonicalisation
        canonicaliseMissionShape: canonicaliseMissionShape
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.MissionSchema;
        var missing = [];

        var required = [
            'validateMission',
            'validateObjective',
            'validateLogEntry',
            'validateReport',
            'validateTag',
            'validateSupportPersonnel',
            'canonicaliseMissionShape'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        // Smoke test: a minimal valid mission must round-trip cleanly.
        try {
            var sample = {
                id: 'miss_abc',
                title: 'Operation Test',
                description: '',
                year: 2026,
                month: 9,
                day: 17,
                sequence: 1,
                primaryType: '',
                subtype: '',
                secondaryType: '',
                escalation: 'tier_ii',
                threatType: '',
                environment: '',
                location: '',
                duration: '',
                difficulty: 'medium',
                priority: 'medium',
                basePay: '',
                surchargePay: '',
                pay: '',
                billing: 'original',
                assignedTeamId: null,
                supportPersonnel: [],
                status: 'active',
                objectives: [],
                progress: 0,
                notes: '',
                tags: [],
                createdAt: '2026-09-17T12:00:00.000Z',
                completedAt: null,
                archivedAt: null,
                reports: [],
                log: [],
                graduatingClassId: null,
                classFilterEnabled: false
            };

            var canonical = canonicaliseMissionShape(sample);
            if (!canonical.valid) {
                missing.push(
                    'smoke test: minimal valid mission failed canonicalisation: ' +
                    canonical.errors.join('; ')
                );
            }

            var validated = validateMission(sample);
            if (!validated.valid) {
                missing.push(
                    'smoke test: minimal valid mission failed validation: ' +
                    validated.errors.join('; ')
                );
            }

            // A mission with a stored missionId must be rejected.
            var badMission = JSON.parse(JSON.stringify(sample));
            badMission.missionId = '2026-001-M';
            var badResult = validateMission(badMission);
            if (badResult.valid) {
                missing.push(
                    'smoke test: mission with stored missionId was not rejected'
                );
            }

            // Duplicate support personnel must be rejected.
            var dupSupport = JSON.parse(JSON.stringify(sample));
            dupSupport.supportPersonnel = ['char_1', 'char_1'];
            var dupResult = validateMission(dupSupport);
            if (dupResult.valid) {
                missing.push(
                    'smoke test: mission with duplicate support personnel ' +
                    'was not rejected'
                );
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[MissionSchema] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
