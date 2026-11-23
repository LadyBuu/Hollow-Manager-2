/**
 * js/modules/missions/mission-rules.js - Mission Rules
 *
 * Path: js/modules/missions/mission-rules.js
 *
 * Pure domain rules and derivations for missions.
 *
 * OWNS: progress / pay derivation, completedAt derivation, state
 *   predicates (ready, editable, cancellable, reactivatable), status
 *   transitions, team eligibility, participant source rules, and the
 *   domain-validation helpers MissionCore calls inside the pipeline.
 * DOES NOT OWN: structural validation (MissionSchema), storage /
 *   queries (MissionCore, MissionQueries), presentation
 *   (MissionViews), vocabulary (MissionConstants), ID grammar
 *   (MissionId), cross-domain existence checks (MissionCore).
 *
 * Every function is pure. Functions that read a mission expect a
 * structurally valid record and fail conservatively (null / false / 0)
 * rather than throwing.
 *
 * REVISION NOTES (fixes in this version):
 *   - isTeamEligibleForMission now normalises `type` and `status`
 *     through TeamConstants (when loaded), exactly like TeamQueries
 *     does. Legacy 'temporary' / 'internship' records are
 *     'professional', and a stored 'Active' is 'active'. Without
 *     TeamConstants it falls back to trimmed-lowercase comparison
 *     (legacy aliases then cannot be resolved; load TeamConstants).
 *     The smoke test that asserted a 'temporary' team is rejected has
 *     been inverted accordingly.
 *   - parsePayValue accepts "$500" and "1,000" / "1,000.50" instead of
 *     silently discarding them. Anything else non-numeric is still
 *     rejected (null), and so are negatives and exponents.
 *
 * NULL vs ZERO:
 *   calculateProgress([]) -> 0. calculateTotalPay with no valid input
 *   -> null (absence of pay is not "pay is zero").
 *
 * COMPLETION: ready when status is 'active' AND every objective is
 *   done. No objectives => progress 0 => not ready.
 *
 * TRANSITIONS: active->completed, active->cancelled, completed->active,
 *   cancelled->active. Self-transition is valid (no-op).
 *
 * PARTICIPANTS: source 'team' (teamId set) or 'rookie' (teamId null).
 *   canAddParticipant / hasParticipant check only pair uniqueness.
 *
 * DEPENDENCIES (MANDATORY): MissionConstants, MissionId.
 * DEPENDENCIES (LAZY): TeamConstants (team normalisation).
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
        var constFns = [
            'isValidStatus', 'isValidPriority', 'isValidDifficulty',
            'isValidBilling', 'isValidEscalation', 'isValidMissionType',
            'isValidSubtype', 'isValidParticipantSource'
        ];
        for (var cf = 0; cf < constFns.length; cf++) {
            if (typeof MissionConstants[constFns[cf]] !== 'function') {
                _missing.push('MissionConstants.' + constFns[cf]);
            }
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

    var VALID_STATUSES = MissionConstants.VALID_STATUSES;
    var isValidStatus = MissionConstants.isValidStatus;

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

    function getTeamConstants() {
        return window.TeamConstants || null;
    }

    // ============================================================
    // PROGRESS
    // ============================================================

    /** 0 objectives -> 0; N of M done -> round(N / M * 100). */
    function calculateProgress(objectives) {
        if (!Array.isArray(objectives) || objectives.length === 0) {
            return 0;
        }

        var total = objectives.length;
        var done = 0;

        for (var i = 0; i < total; i++) {
            var obj = objectives[i];
            if (isPlainObject(obj) && obj.done === true) { done++; }
        }

        return Math.round((done / total) * 100);
    }

    // ============================================================
    // PAY
    // ============================================================

    /**
     * Parse a pay value.
     *
     * Accepts: finite numbers >= 0; strings like "500", "500.25",
     *   "  500  ", "$500", "1,000", "1,000.50".
     * Rejects: negatives, NaN / Infinity, exponents, other text,
     *   null / undefined / ''.
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
            var s = value.trim();
            if (s.charAt(0) === '$') { s = s.substring(1).trim(); }
            if (s === '') { return null; }

            if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) {
                s = s.replace(/,/g, '');
            }
            if (!/^\d+(?:\.\d+)?$/.test(s)) { return null; }
            n = Number(s);
        } else {
            return null;
        }

        if (!isFinite(n) || n < 0) { return null; }
        return n;
    }

    function calculateTotalPay(basePay, surchargePay) {
        var base = parsePayValue(basePay);
        var surcharge = parsePayValue(surchargePay);

        if (base === null && surcharge === null) { return null; }
        if (base === null) { return surcharge; }
        if (surcharge === null) { return base; }
        return base + surcharge;
    }

    /** "1234.50 credits", or '' for a null total. */
    function formatPay(total) {
        if (!isFiniteNumber(total)) { return ''; }
        return total.toFixed(2) + ' credits';
    }

    function calculatePay(basePay, surchargePay) {
        return formatPay(calculateTotalPay(basePay, surchargePay));
    }

    // ============================================================
    // COMPLETED AT
    // ============================================================

    /**
     * entering completed -> now; leaving completed -> null;
     * otherwise the previous value. `now` is supplied by the caller.
     */
    function deriveCompletedAt(
        originalStatus, newStatus, originalCompletedAt, now
    ) {
        var leaving = originalStatus === 'completed' &&
                      newStatus !== 'completed';
        var entering = originalStatus !== 'completed' &&
                       newStatus === 'completed';

        if (entering) { return isNonEmptyString(now) ? now : null; }
        if (leaving) { return null; }
        return originalCompletedAt || null;
    }

    // ============================================================
    // MISSION STATE PREDICATES
    // ============================================================

    function isReadyForCompletion(mission) {
        if (!isPlainObject(mission)) { return false; }
        if (mission.status !== 'active') { return false; }
        return calculateProgress(mission.objectives) === 100;
    }

    /** Objectives are frozen once the mission is not active. */
    function canModifyObjectives(mission) {
        if (!isPlainObject(mission)) { return false; }
        return mission.status === 'active';
    }

    /** Editable unless archived. */
    function canEdit(mission) {
        if (!isPlainObject(mission)) { return false; }
        if (mission.archivedAt !== undefined &&
            mission.archivedAt !== null) {
            return false;
        }
        return true;
    }

    function canCancel(mission) {
        if (!isPlainObject(mission)) { return false; }
        return mission.status === 'active';
    }

    function canReactivate(mission) {
        if (!isPlainObject(mission)) { return false; }
        return mission.status === 'completed' ||
               mission.status === 'cancelled';
    }

    function canComplete(mission) {
        return isReadyForCompletion(mission);
    }

    // ============================================================
    // STATUS TRANSITIONS
    // ============================================================

    function isValidStatusTransition(fromStatus, toStatus) {
        if (!isValidStatus(fromStatus) || !isValidStatus(toStatus)) {
            return false;
        }
        if (fromStatus === toStatus) { return true; }
        if (fromStatus === 'active' &&
            (toStatus === 'completed' || toStatus === 'cancelled')) {
            return true;
        }
        if ((fromStatus === 'completed' || fromStatus === 'cancelled') &&
            toStatus === 'active') {
            return true;
        }
        return false;
    }

    function getValidTransitions(status) {
        if (!isValidStatus(status)) { return []; }
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
    //
    // Only professional, active teams are eligible. type / status are
    // normalised through TeamConstants so legacy aliases ('temporary',
    // 'internship') and casing ('Active') resolve the same way they do
    // in TeamQueries. Does not verify the team exists in storage.

    function normaliseTeamType(type) {
        var TC = getTeamConstants();
        if (TC && typeof TC.normalizeTeamType === 'function') {
            return TC.normalizeTeamType(type);
        }
        return typeof type === 'string'
            ? type.toLowerCase().trim()
            : null;
    }

    function normaliseTeamStatus(status) {
        var TC = getTeamConstants();
        if (TC && typeof TC.normalizeTeamStatus === 'function') {
            return TC.normalizeTeamStatus(status);
        }
        return typeof status === 'string'
            ? status.toLowerCase().trim()
            : null;
    }

    function isTeamEligibleForMission(team) {
        if (!isPlainObject(team)) { return false; }
        if (normaliseTeamType(team.type) !== 'professional') {
            return false;
        }
        if (normaliseTeamStatus(team.status) !== 'active') {
            return false;
        }
        return true;
    }

    function filterEligibleTeams(teams) {
        if (!Array.isArray(teams)) { return []; }
        var result = [];
        for (var i = 0; i < teams.length; i++) {
            if (isTeamEligibleForMission(teams[i])) {
                result.push(teams[i]);
            }
        }
        return result;
    }

    // ============================================================
    // PARTICIPANT RULES
    // ============================================================

    /** Non-empty string teamId -> 'team'; anything else -> 'rookie'. */
    function resolveParticipantSource(teamId) {
        return isNonEmptyString(teamId) ? 'team' : 'rookie';
    }

    /**
     * Does the mission already have this (characterId, teamId) pair?
     * A null / blank teamId is the rookie key.
     */
    function hasParticipant(mission, characterId, teamId) {
        if (!isPlainObject(mission)) { return false; }
        if (!Array.isArray(mission.participants)) { return false; }
        if (!isNonEmptyString(characterId)) { return false; }

        var targetChar = String(characterId);
        var targetTeam = isNonEmptyString(teamId) ? String(teamId) : null;

        for (var i = 0; i < mission.participants.length; i++) {
            var p = mission.participants[i];
            if (!isPlainObject(p)) { continue; }

            var pChar = isNonEmptyString(p.characterId)
                ? String(p.characterId)
                : null;
            if (pChar !== targetChar) { continue; }

            var pTeam = isNonEmptyString(p.teamId)
                ? String(p.teamId)
                : null;
            if (pTeam === targetTeam) { return true; }
        }

        return false;
    }

    /** Structural admissibility only. @returns {{valid, message?}} */
    function canAddParticipant(mission, characterId, teamId) {
        if (!isPlainObject(mission)) {
            return { valid: false, message: 'Mission is required.' };
        }
        if (!isNonEmptyString(characterId)) {
            return { valid: false, message: 'Character id is required.' };
        }
        if (!Array.isArray(mission.participants)) {
            return {
                valid: false,
                message: 'Mission has no participants array.'
            };
        }
        if (hasParticipant(mission, characterId, teamId)) {
            return {
                valid: false,
                message: 'Character is already a participant for this ' +
                    'team.'
            };
        }
        return { valid: true };
    }

    // ============================================================
    // DERIVED FIELD RECOMPUTATION
    // ============================================================

    /**
     * Shallow copy with progress and pay recomputed. completedAt is
     * passed through unchanged (MissionCore derives it on transition).
     */
    function recalculateDerivedFields(mission) {
        if (!isPlainObject(mission)) { return mission; }

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

    /**
     * Validate a status change. `currentMission` should reflect the
     * state the transition is judged against (MissionCore passes the
     * CANDIDATE's objectives with the CURRENT status, so objective
     * edits made in the same save count towards completion).
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
        calculateProgress: calculateProgress,

        parsePayValue: parsePayValue,
        calculateTotalPay: calculateTotalPay,
        calculatePay: calculatePay,
        formatPay: formatPay,

        deriveCompletedAt: deriveCompletedAt,

        isReadyForCompletion: isReadyForCompletion,
        canModifyObjectives: canModifyObjectives,
        canEdit: canEdit,
        canCancel: canCancel,
        canReactivate: canReactivate,
        canComplete: canComplete,

        isValidStatusTransition: isValidStatusTransition,
        getValidTransitions: getValidTransitions,

        isTeamEligibleForMission: isTeamEligibleForMission,
        filterEligibleTeams: filterEligibleTeams,

        resolveParticipantSource: resolveParticipantSource,
        hasParticipant: hasParticipant,
        canAddParticipant: canAddParticipant,

        recalculateDerivedFields: recalculateDerivedFields,

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
            'calculateProgress', 'parsePayValue', 'calculateTotalPay',
            'calculatePay', 'formatPay', 'deriveCompletedAt',
            'isReadyForCompletion', 'canModifyObjectives', 'canEdit',
            'canCancel', 'canReactivate', 'canComplete',
            'isValidStatusTransition', 'getValidTransitions',
            'isTeamEligibleForMission', 'filterEligibleTeams',
            'resolveParticipantSource', 'hasParticipant',
            'canAddParticipant', 'recalculateDerivedFields',
            'validateStatusChange', 'validateObjectivesEditable'
        ];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        function check(cond, label) {
            if (!cond) { missing.push(label); }
        }

        try {
            // progress
            check(calculateProgress([]) === 0, 'progress([]) !== 0');
            check(calculateProgress([
                { text: 'a', done: true }, { text: 'b', done: false }
            ]) === 50, 'progress 1/2 !== 50');
            check(calculateProgress([
                { text: 'a', done: true }, { text: 'b', done: true }
            ]) === 100, 'progress 2/2 !== 100');

            // pay parsing
            check(parsePayValue('500') === 500, "parsePayValue('500')");
            check(parsePayValue('500.25') === 500.25, "parsePayValue('500.25')");
            check(parsePayValue('$500') === 500, "parsePayValue('$500')");
            check(parsePayValue('1,000') === 1000, "parsePayValue('1,000')");
            check(parsePayValue('1,000.50') === 1000.5,
                "parsePayValue('1,000.50')");
            check(parsePayValue('1,00') === null, "parsePayValue('1,00')");
            check(parsePayValue('-5') === null, "parsePayValue('-5')");
            check(parsePayValue('1e3') === null, "parsePayValue('1e3')");
            check(parsePayValue('banana') === null, "parsePayValue('banana')");
            check(parsePayValue('') === null, "parsePayValue('')");
            check(parsePayValue('$') === null, "parsePayValue('$')");

            // totals / format
            check(calculateTotalPay('500', '50') === 550, 'total 500+50');
            check(calculateTotalPay('500', null) === 500, 'total 500+null');
            check(calculateTotalPay(null, null) === null, 'total null+null');
            check(formatPay(500) === '500.00 credits', 'formatPay(500)');
            check(formatPay(null) === '', 'formatPay(null)');

            // completion readiness
            check(isReadyForCompletion({
                status: 'active', objectives: [{ text: 'a', done: true }]
            }) === true, 'ready: all done');
            check(isReadyForCompletion({
                status: 'active', objectives: []
            }) === false, 'ready: empty objectives');
            check(isReadyForCompletion({
                status: 'completed', objectives: [{ text: 'a', done: true }]
            }) === false, 'ready: completed status');

            // transitions
            check(isValidStatusTransition('active', 'completed'),
                'active->completed');
            check(isValidStatusTransition('active', 'cancelled'),
                'active->cancelled');
            check(!isValidStatusTransition('completed', 'cancelled'),
                'completed->cancelled should be false');
            check(isValidStatusTransition('active', 'active'),
                'self-transition');

            // validateStatusChange
            check(validateStatusChange(
                { status: 'active', objectives: [] }, 'completed'
            ).valid === false, 'complete with no objectives accepted');
            check(validateStatusChange(
                { status: 'active', objectives: [{ text: 'a', done: true }] },
                'completed'
            ).valid === true, 'complete with all done rejected');

            // completedAt
            check(deriveCompletedAt('active', 'completed', null, 'T') === 'T',
                'completedAt enter');
            check(deriveCompletedAt('completed', 'active', 'T', 'U') === null,
                'completedAt leave');
            check(deriveCompletedAt('active', 'active', 'X', 'Y') === 'X',
                'completedAt no-op');

            // canEdit
            check(canEdit({ archivedAt: null }) === true, 'canEdit live');
            check(canEdit({ archivedAt: '2026-01-01T00:00:00.000Z' }) === false,
                'canEdit archived');

            // team eligibility
            check(isTeamEligibleForMission({
                type: 'professional', status: 'active'
            }) === true, 'eligible: professional active');
            check(isTeamEligibleForMission({
                type: 'academic', status: 'active'
            }) === false, 'eligible: academic');
            check(isTeamEligibleForMission({
                type: 'civilian', status: 'active'
            }) === false, 'eligible: civilian');
            check(isTeamEligibleForMission({
                type: 'professional', status: 'inactive'
            }) === false, 'eligible: inactive');

            // Legacy aliases resolve via TeamConstants when loaded.
            if (getTeamConstants() &&
                typeof getTeamConstants().normalizeTeamType === 'function') {
                check(isTeamEligibleForMission({
                    type: 'temporary', status: 'active'
                }) === true, 'eligible: legacy temporary should normalise');
                check(isTeamEligibleForMission({
                    type: 'professional', status: 'Active'
                }) === true, 'eligible: "Active" casing should normalise');
            }

            // participants
            check(resolveParticipantSource('team_a') === 'team', 'src team');
            check(resolveParticipantSource(null) === 'rookie', 'src null');
            check(resolveParticipantSource('') === 'rookie', 'src empty');
            check(resolveParticipantSource(undefined) === 'rookie',
                'src undefined');

            var m1 = {
                participants: [
                    { characterId: 'c1', teamId: 't1', source: 'team' },
                    { characterId: 'c1', teamId: null, source: 'rookie' }
                ]
            };
            check(hasParticipant(m1, 'c1', 't1') === true, 'has c1/t1');
            check(hasParticipant(m1, 'c1', null) === true, 'has c1/rookie');
            check(hasParticipant(m1, 'c1', 't2') === false, 'has c1/t2');
            check(hasParticipant(m1, 'c2', 't1') === false, 'has c2/t1');
            check(canAddParticipant(m1, 'c2', 't1').valid === true,
                'canAdd new pair');
            check(canAddParticipant(m1, 'c1', 't1').valid === false,
                'canAdd duplicate');
            check(canAddParticipant({ participants: [] }, '', 't1').valid ===
                false, 'canAdd empty char');
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[MissionRules] Verification failed:', missing.join(', ')
            );
        }
    })();

})();
