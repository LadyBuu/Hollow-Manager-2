/**
 * js/modules/missions/mission-rules.js - Mission Rules
 *
 * Path: js/modules/missions/mission-rules.js
 *
 * Pure domain rules and derivations for missions.
 *
 * WHAT THIS MODULE OWNS:
 *   - Derived value calculations: progress from objectives, total
 *     pay from basePay + surchargePay, completedAt from a status
 *     transition.
 *   - State predicates over a mission record: is it ready for
 *     completion, can objectives be edited, can it be cancelled,
 *     can it be reactivated, can it be edited.
 *   - Status transition rules: which transitions are legal, and
 *     what target statuses are available from a given status.
 *   - Team eligibility for mission assignment.
 *   - Domain-rule validation that MissionCore calls inside the
 *     pipeline transaction (as opposed to structural validation,
 *     which belongs to MissionSchema).
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Structural validation (MissionSchema).
 *   - Storage, queries, or pipeline (MissionCore, MissionQueries).
 *   - Presentation formatting (MissionViews).
 *   - Vocabulary or defaults (MissionConstants).
 *   - ID grammar (MissionId).
 *   - Cross-domain existence checks. Whether a team exists, whether
 *     a character exists — those require a snapshot and belong to
 *     MissionCore's pipeline validate. This module judges a team
 *     record once one is provided.
 *
 * DESIGN NOTES:
 *   - Every function here is pure. Same inputs produce same outputs.
 *     No hidden state, no caching, no time-of-day dependence except
 *     where a timestamp is an explicit input.
 *   - Functions that operate on a mission record expect it to be
 *     structurally valid. They do not re-run Schema validation.
 *     They read fields and apply rules. If a field is missing or
 *     malformed, they fail conservatively (return null, false, or
 *     zero) rather than throwing.
 *   - All comparison is done on the CANONICAL values supplied by
 *     MissionConstants. This module never invents vocabulary.
 *
 * NULL vs ZERO:
 *   - calculateProgress(objectives) returns 0 for an empty array.
 *     It does not return null. An empty objective list has progress
 *     0 by definition.
 *   - calculateTotalPay returns null when neither pay input parses
 *     to a number. It does not return 0. Absence of pay data is not
 *     the same as "pay is zero".
 *   - deriveCompletedAt returns null when the mission is not
 *     completed, or when leaving completed status removes the
 *     timestamp.
 *
 * COMPLETION SEMANTICS:
 *   A mission is ready for completion when:
 *     - its status is 'active' (or another pre-completion status
 *       if the vocabulary ever gains one), AND
 *     - every objective is done.
 *
 *   A mission with no objectives has progress 0 and is NOT ready
 *   for completion. Objectives must exist and be completed.
 *
 * STATUS TRANSITIONS:
 *   Legal transitions:
 *     active    -> completed
 *     active    -> cancelled
 *     completed -> active
 *     cancelled -> active
 *
 *   A status may transition to itself, which is a no-op rather than
 *   an error. Self-transition is treated as "valid, no change" by
 *   MissionCore, not as a rule violation here.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.MissionConstants
 *   - window.MissionId
 */

(function() {
    'use strict';

    if (window.__missionRulesLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var MissionConstants = window.MissionConstants;
    var MissionId = window.MissionId;

    var _missing = [];

    if (!MissionConstants) {
        _missing.push('MissionConstants (module)');
    } else {
        if (typeof MissionConstants.isValidStatus !== 'function') {
            _missing.push('MissionConstants.isValidStatus');
        }
        if (typeof MissionConstants.isValidPriority !== 'function') {
            _missing.push('MissionConstants.isValidPriority');
        }
        if (typeof MissionConstants.isValidDifficulty !== 'function') {
            _missing.push('MissionConstants.isValidDifficulty');
        }
        if (typeof MissionConstants.isValidBilling !== 'function') {
            _missing.push('MissionConstants.isValidBilling');
        }
        if (typeof MissionConstants.isValidEscalation !== 'function') {
            _missing.push('MissionConstants.isValidEscalation');
        }
        if (typeof MissionConstants.isValidMissionType !== 'function') {
            _missing.push('MissionConstants.isValidMissionType');
        }
        if (typeof MissionConstants.isValidSubtype !== 'function') {
            _missing.push('MissionConstants.isValidSubtype');
        }
        if (!Array.isArray(MissionConstants.VALID_STATUSES)) {
            _missing.push('MissionConstants.VALID_STATUSES');
        }
    }

    if (!MissionId || typeof MissionId.isValidYear !== 'function') {
        _missing.push('MissionId.isValidYear');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[MissionRules] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__missionRulesLoaded = true;

    // ============================================================
    // SHORTHAND IMPORTS
    // ============================================================

    var VALID_STATUSES = MissionConstants.VALID_STATUSES;
    var isValidStatus = MissionConstants.isValidStatus;
    var isValidPriority = MissionConstants.isValidPriority;
    var isValidDifficulty = MissionConstants.isValidDifficulty;
    var isValidBilling = MissionConstants.isValidBilling;
    var isValidEscalation = MissionConstants.isValidEscalation;
    var isValidMissionType = MissionConstants.isValidMissionType;
    var isValidSubtype = MissionConstants.isValidSubtype;

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isPlainObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    // ============================================================
    // PROGRESS
    // ============================================================

    /**
     * Calculate progress from objectives.
     *
     * 0 objectives     -> 0
     * all done         -> 100
     * N of M done      -> round(N / M * 100)
     *
     * Non-objective entries in the array are counted as "not done",
     * not skipped. This matches the intent: an objective that is
     * malformed is not "complete".
     *
     * @param {array} objectives
     * @returns {number} integer 0..100
     */
    function calculateProgress(objectives) {
        if (!Array.isArray(objectives) || objectives.length === 0) {
            return 0;
        }

        var total = objectives.length;
        var done = 0;

        for (var i = 0; i < total; i++) {
            var obj = objectives[i];
            if (isPlainObject(obj) && obj.done === true) {
                done++;
            }
        }

        return Math.round((done / total) * 100);
    }

    // ============================================================
    // PAY
    // ============================================================

    /**
     * Parse a pay value from a string or number.
     *
     * Accepts:
     *   - finite numbers >= 0
     *   - strings that reduce to such a number ("500", "500.25",
     *     "  500  ")
     *
     * Rejects:
     *   - negative numbers
     *   - NaN, Infinity
     *   - non-numeric strings
     *   - null, undefined, ''
     *
     * @returns {number|null}
     */
    function parsePayValue(value) {
        if (value === null || value === undefined || value === '') {
            return null;
        }

        var n;

        if (typeof value === 'number') {
            n = value;
        } else if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '') { return null; }
            // Strict numeric: optional decimal, no signs, no
            // thousands separators, no exponent.
            if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
                return null;
            }
            n = Number(trimmed);
        } else {
            return null;
        }

        if (!isFinite(n) || n < 0) {
            return null;
        }

        return n;
    }

    /**
     * Calculate total pay as a number.
     *
     * Both inputs are optional. When both are valid, they are summed.
     * When only one is valid, it is returned. When neither is valid,
     * returns null.
     *
     * @returns {number|null}
     */
    function calculateTotalPay(basePay, surchargePay) {
        var base = parsePayValue(basePay);
        var surcharge = parsePayValue(surchargePay);

        if (base === null && surcharge === null) {
            return null;
        }
        if (base === null) { return surcharge; }
        if (surcharge === null) { return base; }
        return base + surcharge;
    }

    /**
     * Format a pay number for storage or display.
     *
     * Returns a string in the form "1234.50 credits", or '' when the
     * total is null.
     *
     * This is used to populate mission.pay. Storing the formatted
     * string is a deliberate choice: it keeps the persisted record
     * human-readable, and formatting is deterministic so the string
     * is stable across reads.
     *
     * @param {number|null} total
     * @returns {string}
     */
    function formatPay(total) {
        if (!isFiniteNumber(total)) {
            return '';
        }
        return total.toFixed(2) + ' credits';
    }

    /**
     * Calculate and format the mission's pay string in one call.
     *
     * @returns {string}
     */
    function calculatePay(basePay, surchargePay) {
        var total = calculateTotalPay(basePay, surchargePay);
        return formatPay(total);
    }

    // ============================================================
    // COMPLETED AT
    // ============================================================

    /**
     * Determine the completedAt timestamp after a status transition.
     *
     *   becoming completed  -> now (ISO string)
     *   leaving completed   -> null
     *   otherwise           -> the previous value, unchanged
     *
     * The "now" timestamp is supplied by the caller as an argument,
     * so this function remains pure and deterministic for tests.
     *
     * @param {string} originalStatus
     * @param {string} newStatus
     * @param {string|null} originalCompletedAt
     * @param {string} now - ISO 8601 timestamp to use when entering
     *   completed status
     * @returns {string|null}
     */
    function deriveCompletedAt(
        originalStatus,
        newStatus,
        originalCompletedAt,
        now
    ) {
        var leavingCompleted = originalStatus === 'completed' &&
                               newStatus !== 'completed';
        var enteringCompleted = originalStatus !== 'completed' &&
                                newStatus === 'completed';

        if (enteringCompleted) {
            return isNonEmptyString(now) ? now : null;
        }
        if (leavingCompleted) {
            return null;
        }
        return originalCompletedAt || null;
    }

    // ============================================================
    // MISSION STATE PREDICATES
    // ============================================================

    /**
     * Is the mission ready to be marked completed?
     *
     * Requires:
     *   - status is 'active'
     *   - progress is 100 (i.e. every objective is done)
     *
     * @returns {boolean}
     */
    function isReadyForCompletion(mission) {
        if (!isPlainObject(mission)) { return false; }
        if (mission.status !== 'active') { return false; }
        return calculateProgress(mission.objectives) === 100;
    }

    /**
     * Can the mission's objectives be added to, removed from, or
     * toggled?
     *
     * Objectives are frozen once the mission is no longer active.
     * This preserves the historical fact that a completed or
     * cancelled mission had a particular set of objectives at the
     * time it finished.
     *
     * @returns {boolean}
     */
    function canModifyObjectives(mission) {
        if (!isPlainObject(mission)) { return false; }
        return mission.status === 'active';
    }

    /**
     * Can the mission be edited through the general update command?
     *
     * Editing is available for any status except archived. Archives
     * are historical and immutable through ordinary updates; a
     * separate unarchive operation would be needed to make changes.
     *
     * @returns {boolean}
     */
    function canEdit(mission) {
        if (!isPlainObject(mission)) { return false; }
        if (mission.archivedAt !== undefined &&
            mission.archivedAt !== null) {
            return false;
        }
        return true;
    }

    /**
     * Can the mission be cancelled?
     * Only an active mission can be cancelled.
     */
    function canCancel(mission) {
        if (!isPlainObject(mission)) { return false; }
        return mission.status === 'active';
    }

    /**
     * Can the mission be reactivated?
     * Only a completed or cancelled mission can be reactivated.
     */
    function canReactivate(mission) {
        if (!isPlainObject(mission)) { return false; }
        return mission.status === 'completed' ||
               mission.status === 'cancelled';
    }

    /**
     * Can the mission be completed?
     * Equivalent to isReadyForCompletion for now, but separated so
     * the two concepts can diverge if the completion rule ever
     * gains more conditions (e.g. minimum objective count).
     */
    function canComplete(mission) {
        return isReadyForCompletion(mission);
    }

    // ============================================================
    // STATUS TRANSITIONS
    // ============================================================

    /**
     * Is the transition from `fromStatus` to `toStatus` allowed?
     *
     * Self-transitions are allowed (they are treated by callers as
     * "no change requested" rather than as a rule violation).
     *
     * @returns {boolean}
     */
    function isValidStatusTransition(fromStatus, toStatus) {
        if (!isValidStatus(fromStatus) || !isValidStatus(toStatus)) {
            return false;
        }
        if (fromStatus === toStatus) {
            return true;
        }
        if (fromStatus === 'active' &&
            (toStatus === 'completed' || toStatus === 'cancelled')) {
            return true;
        }
        if (fromStatus === 'completed' && toStatus === 'active') {
            return true;
        }
        if (fromStatus === 'cancelled' && toStatus === 'active') {
            return true;
        }
        return false;
    }

    /**
     * List the statuses reachable from `status`.
     *
     * @returns {array} array of status strings
     */
    function getValidTransitions(status) {
        if (!isValidStatus(status)) {
            return [];
        }
        var result = [];
        for (var i = 0; i < VALID_STATUSES.length; i++) {
            if (isValidStatusTransition(status, VALID_STATUSES[i])) {
                result.push(VALID_STATUSES[i]);
            }
        }
        return result;
    }

    // ============================================================
    // TEAM ELIGIBILITY
    // ============================================================

    /**
     * Is the team eligible to be assigned to a mission?
     *
     * A team is eligible when:
     *   - its type is 'professional' or 'temporary'
     *   - its status is 'active'
     *
     * The check is against the team record supplied. It does not
     * verify the team exists in storage; that is the caller's
     * responsibility.
     *
     * @param {object} team
     * @returns {boolean}
     */
    function isTeamEligibleForMission(team) {
        if (!isPlainObject(team)) { return false; }
        if (team.type !== 'professional' && team.type !== 'temporary') {
            return false;
        }
        if (team.status !== 'active') {
            return false;
        }
        return true;
    }

    /**
     * Filter an array of team records down to those eligible for
     * mission assignment. Non-team entries are dropped.
     *
     * @param {array} teams
     * @returns {array} new array of eligible teams (same references)
     */
    function filterEligibleTeams(teams) {
        if (!Array.isArray(teams)) {
            return [];
        }
        var result = [];
        for (var i = 0; i < teams.length; i++) {
            if (isTeamEligibleForMission(teams[i])) {
                result.push(teams[i]);
            }
        }
        return result;
    }

    // ============================================================
    // DERIVED FIELD RECOMPUTATION
    // ============================================================

    /**
     * Recompute the mission's derived fields and return a shallow
     * copy with those fields updated.
     *
     * The input mission is NOT mutated.
     *
     * Recomputed fields:
     *   - progress   (from objectives)
     *   - pay        (from basePay + surchargePay)
     *
     * completedAt is NOT recomputed here. It is tied to a status
     * transition, which is a mutation-level concern, and its value
     * is passed through unchanged. MissionCore computes the new
     * completedAt before calling this function.
     *
     * @param {object} mission
     * @returns {object} shallow copy with derived fields updated
     */
    function recalculateDerivedFields(mission) {
        if (!isPlainObject(mission)) {
            return mission;
        }

        // Shallow copy; nested structures are shared with the input.
        // The caller is expected to pass a candidate that is already
        // a deep clone of the stored record when mutation is
        // intended.
        var result = {};
        var keys = Object.keys(mission);
        for (var i = 0; i < keys.length; i++) {
            result[keys[i]] = mission[keys[i]];
        }

        result.progress = calculateProgress(result.objectives);
        result.pay = calculatePay(result.basePay, result.surchargePay);

        return result;
    }

    // ============================================================
    // DOMAIN VALIDATION HELPERS
    // ============================================================
    //
    // These are called from MissionCore inside the pipeline
    // validate callback. They combine several predicate checks into
    // a single object suitable for returning from the pipeline.
    //
    // They operate on the candidate mission (already structurally
    // validated by Schema) and the transition intent. They do NOT
    // re-validate structure.

    /**
     * Validate that a status change is allowed.
     *
     * @param {object} currentMission
     * @param {string} newStatus
     * @returns {object} { valid, message? }
     */
    function validateStatusChange(currentMission, newStatus) {
        if (!isPlainObject(currentMission)) {
            return { valid: false, message: 'Current mission is required.' };
        }
        if (!isValidStatus(newStatus)) {
            return {
                valid: false,
                message: 'Invalid status: "' + newStatus + '".'
            };
        }
        if (currentMission.status === newStatus) {
            return { valid: true };
        }
        if (!isValidStatusTransition(currentMission.status, newStatus)) {
            return {
                valid: false,
                message: 'Invalid status transition from "' +
                    currentMission.status + '" to "' + newStatus + '".'
            };
        }
        if (newStatus === 'completed' &&
            !isReadyForCompletion(currentMission)) {
            var progress = calculateProgress(currentMission.objectives);
            return {
                valid: false,
                message: 'Mission cannot be completed: ' +
                    progress + '% of objectives done.'
            };
        }
        return { valid: true };
    }

    /**
     * Validate that a proposed objective set may replace the current
     * one.
     *
     * @param {object} currentMission
     * @returns {object} { valid, message? }
     */
    function validateObjectivesEditable(currentMission) {
        if (!isPlainObject(currentMission)) {
            return { valid: false, message: 'Current mission is required.' };
        }
        if (!canModifyObjectives(currentMission)) {
            return {
                valid: false,
                message: 'Objectives cannot be modified for a ' +
                    currentMission.status + ' mission.'
            };
        }
        return { valid: true };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionRules = Object.freeze({
        // Progress
        calculateProgress: calculateProgress,

        // Pay
        parsePayValue: parsePayValue,
        calculateTotalPay: calculateTotalPay,
        calculatePay: calculatePay,
        formatPay: formatPay,

        // Timestamp derivation
        deriveCompletedAt: deriveCompletedAt,

        // State predicates
        isReadyForCompletion: isReadyForCompletion,
        canModifyObjectives: canModifyObjectives,
        canEdit: canEdit,
        canCancel: canCancel,
        canReactivate: canReactivate,
        canComplete: canComplete,

        // Status transitions
        isValidStatusTransition: isValidStatusTransition,
        getValidTransitions: getValidTransitions,

        // Team eligibility
        isTeamEligibleForMission: isTeamEligibleForMission,
        filterEligibleTeams: filterEligibleTeams,

        // Derived field recomputation
        recalculateDerivedFields: recalculateDerivedFields,

        // Domain validation
        validateStatusChange: validateStatusChange,
        validateObjectivesEditable: validateObjectivesEditable
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.MissionRules;
        var missing = [];

        var required = [
            'calculateProgress',
            'parsePayValue',
            'calculateTotalPay',
            'calculatePay',
            'formatPay',
            'deriveCompletedAt',
            'isReadyForCompletion',
            'canModifyObjectives',
            'canEdit',
            'canCancel',
            'canReactivate',
            'canComplete',
            'isValidStatusTransition',
            'getValidTransitions',
            'isTeamEligibleForMission',
            'filterEligibleTeams',
            'recalculateDerivedFields',
            'validateStatusChange',
            'validateObjectivesEditable'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        try {
            // calculateProgress
            if (calculateProgress([]) !== 0) {
                missing.push('calculateProgress([]) !== 0');
            }
            if (calculateProgress([
                { text: 'a', done: true },
                { text: 'b', done: false }
            ]) !== 50) {
                missing.push('calculateProgress of 1/2 done !== 50');
            }
            if (calculateProgress([
                { text: 'a', done: true },
                { text: 'b', done: true }
            ]) !== 100) {
                missing.push('calculateProgress of 2/2 done !== 100');
            }

            // parsePayValue
            if (parsePayValue('500') !== 500) {
                missing.push("parsePayValue('500') !== 500");
            }
            if (parsePayValue('500.25') !== 500.25) {
                missing.push("parsePayValue('500.25') !== 500.25");
            }
            if (parsePayValue('-5') !== null) {
                missing.push("parsePayValue('-5') !== null");
            }
            if (parsePayValue('banana') !== null) {
                missing.push("parsePayValue('banana') !== null");
            }
            if (parsePayValue('') !== null) {
                missing.push("parsePayValue('') !== null");
            }

            // calculateTotalPay
            if (calculateTotalPay('500', '50') !== 550) {
                missing.push("calculateTotalPay('500','50') !== 550");
            }
            if (calculateTotalPay('500', null) !== 500) {
                missing.push("calculateTotalPay('500', null) !== 500");
            }
            if (calculateTotalPay(null, null) !== null) {
                missing.push('calculateTotalPay(null, null) !== null');
            }

            // formatPay
            if (formatPay(500) !== '500.00 credits') {
                missing.push("formatPay(500) !== '500.00 credits'");
            }
            if (formatPay(null) !== '') {
                missing.push("formatPay(null) !== ''");
            }

            // isReadyForCompletion
            if (isReadyForCompletion({
                status: 'active',
                objectives: [
                    { text: 'a', done: true }
                ]
            }) !== true) {
                missing.push('isReadyForCompletion did not accept all-done');
            }
            if (isReadyForCompletion({
                status: 'active',
                objectives: []
            }) !== false) {
                missing.push('isReadyForCompletion accepted empty objectives');
            }
            if (isReadyForCompletion({
                status: 'completed',
                objectives: [
                    { text: 'a', done: true }
                ]
            }) !== false) {
                missing.push('isReadyForCompletion accepted completed status');
            }

            // Status transitions
            if (isValidStatusTransition('active', 'completed') !== true) {
                missing.push("isValidStatusTransition('active','completed')");
            }
            if (isValidStatusTransition('active', 'cancelled') !== true) {
                missing.push("isValidStatusTransition('active','cancelled')");
            }
            if (isValidStatusTransition('completed', 'cancelled') !== false) {
                missing.push("isValidStatusTransition('completed','cancelled') should be false");
            }
            if (isValidStatusTransition('active', 'active') !== true) {
                missing.push('self-transition should be valid');
            }

            // validateStatusChange
            var vsc = validateStatusChange(
                { status: 'active', objectives: [] },
                'completed'
            );
            if (vsc.valid !== false) {
                missing.push('validateStatusChange accepted completion with no objectives');
            }

            // deriveCompletedAt
            if (deriveCompletedAt('active', 'completed', null, 'T') !== 'T') {
                missing.push('deriveCompletedAt: entering completed did not use now');
            }
            if (deriveCompletedAt('completed', 'active', 'T', 'U') !== null) {
                missing.push('deriveCompletedAt: leaving completed did not clear');
            }
            if (deriveCompletedAt('active', 'active', 'X', 'Y') !== 'X') {
                missing.push('deriveCompletedAt: no-op did not preserve');
            }

            // Team eligibility
            if (isTeamEligibleForMission({
                type: 'professional',
                status: 'active'
            }) !== true) {
                missing.push('isTeamEligibleForMission rejected a valid team');
            }
            if (isTeamEligibleForMission({
                type: 'academic',
                status: 'active'
            }) !== false) {
                missing.push('isTeamEligibleForMission accepted academic team');
            }
            if (isTeamEligibleForMission({
                type: 'professional',
                status: 'inactive'
            }) !== false) {
                missing.push('isTeamEligibleForMission accepted inactive team');
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[MissionRules] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
