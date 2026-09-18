/**
 * modules/tournaments/tournament-rules.js - Tournament Rules
 * Domain conditions for tournament operations (not state permissions).
 *
 * Path: js/modules/tournaments/tournament-rules.js
 *
 * RESPONSIBILITIES:
 *   - Domain condition validation (not state permissions)
 *   - Participant eligibility checks
 *   - Result-map validation
 *   - Round addition and removal validation
 *
 * IMPORTANT:
 *   - This is the CANONICAL authority for domain conditions.
 *   - All modules MUST use this for domain condition checks.
 *   - Rules are declarative and immutable.
 *   - No persistence, no DOM, no UI state.
 *   - PURE functions - no side effects.
 *   - Does NOT duplicate Schema (structure) or Core (mutations).
 *   - Schema:   "Is this structurally valid?"
 *   - Rules:    "Are the domain conditions satisfied?"
 *
 * WHAT THIS MODULE DOES NOT DO:
 *   - Does NOT check whether a character or team exists in the wider
 *     application. That is an application/repository concern and
 *     belongs to the mutation that owns the transaction snapshot.
 *     Rules validates tournament-specific constraints only.
 *   - Does NOT read window.data.
 *   - Does NOT reach into other domains (CharacterQueries,
 *     TeamQueries, etc.).
 *   - Does NOT carry UI vocabulary (no "passed" / "failed").
 *   - Does NOT expose query helpers. Callers use TournamentQueries
 *     or TournamentSchema.derive* directly.
 *
 * WEEK PARSING:
 *   Week values go through CalendarValidation.parseWeek, which is the
 *   canonical strict parser (integer-only, in-range, no silent
 *   coercion of trailing characters).
 *
 * NORMALISATION CONTRACT:
 *   These functions receive data that has already passed Schema
 *   validation. They may assume structural shape (arrays, objects,
 *   canonical field names) and canonical vocabulary (valid mode,
 *   status, match type, result). They do NOT re-validate structure.
 *
 *   This is the counterpart to Schema's strictness. Schema says
 *   "this is structurally valid"; Rules says "and these are the
 *   domain conditions." Between them, callers get a clean pipeline.
 *
 * RESULT VOCABULARY:
 *   - 'pass'  : advanced and successful
 *   - 'retry' : advanced but not successful
 *   - 'fail'  : not advanced; eliminated from this tournament
 *   - Advancement = 'pass' OR 'retry'.
 *
 * RESULT-MAP VALIDATION OWNERSHIP:
 *   validateResultMap is the SINGLE canonical implementation for
 *   result-map validation in the tournament module. TournamentMatches
 *   has historically carried a near-identical duplicate for its
 *   pre-completion validation path. That duplicate is now redundant;
 *   callers should delegate to this function.
 *
 *   CALLING CONVENTION:
 *     validateResultMap(results, expectedIds, options)
 *
 *     expectedIds — when an array, every result key must be a member
 *                   of it. When null/undefined, only the map shape
 *                   and values are checked.
 *
 *     options.requireAll — when true (the default), every expectedId
 *                   must appear in the map. Callers that validate a
 *                   partially-filled result map (e.g. the pre-
 *                   completion phase of an edit form) must pass
 *                   { requireAll: false } explicitly.
 *
 *   The default of `requireAll: true` is the strictest interpretation
 *   and the correct one for "this match is being completed, are all
 *   results present?". Callers whose semantics are looser must opt
 *   out, not in.
 *
 * ROUND REMOVAL:
 *   A round with any completed match may not be removed by the
 *   ordinary remove-round operation. Removing a completed match
 *   from tournament history is not a normal editing operation.
 *   There is no separate destructive path in this module. If
 *   destructive cleanup is needed, it belongs to an explicit
 *   administrative operation that does not go through Rules.
 *
 * ROUND ADDITION:
 *   There is no cap. totalRounds is a planning hint, not an
 *   invariant. Callers may add rounds beyond it.
 *
 * EXPORT SURFACE (v2, trimmed):
 *   Removed from the public export in this revision (kept as private
 *   helpers where used internally):
 *
 *     - validateWeekRange
 *         General-purpose week-range check. No caller in the
 *         tournament module. Callers that want it can inline the
 *         two parseWeek calls plus the comparison, or request the
 *         helper be re-exported.
 *
 *     - isWeekInTournamentRange
 *         Same reasoning.
 *
 *     - validateCompletionReadiness
 *         The implementation behind the demoted isReadyForCompletion
 *         and getCompletionReadinessReport. No external caller.
 *
 *     - validateMatchResult
 *         The implementation behind the deleted isValidMatchResult.
 *         TournamentMatches does its own result validation inline.
 *         Kept for possible future use; not exported.
 *
 *     - validateMatchCompletion
 *         The implementation behind the deleted canCompleteMatch.
 *         Same reasoning.
 *
 *   Deleted outright in this revision:
 *     - isValidWeekRange
 *         Pure alias of validateWeekRange().valid.
 *     - canAddRound
 *         Pure alias of validateRoundAddition().valid.
 *     - canRemoveRound
 *         Pure alias of validateRoundRemoval().valid.
 *     - isReadyForCompletion
 *         Pure alias of validateCompletionReadiness().valid.
 *     - getCompletionReadinessReport
 *         Same output as validateCompletionReadiness.
 *     - isValidMatchResult
 *         Pure alias of validateMatchResult().valid.
 *     - canCompleteMatch
 *         Pure alias of validateMatchCompletion().valid.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TournamentConstants
 *   - window.TournamentSchema
 *   - window.CalendarValidation
 *
 * DEPENDENCIES (OPTIONAL):
 *   - window.ObjectUtils (unused in this revision; kept as a lazy
 *     accessor for any future defensive-copy needs)
 *
 * USAGE:
 *   var Rules = window.TournamentRules;
 *
 *   Rules.isParticipantEligible(tournament, participantId, 'character');
 *   Rules.validateMatchCompletion(match, result);
 *   Rules.validateRoundRemoval(tournament, roundIndex);
 */

(function() {
    'use strict';

    if (window.__tournamentRulesLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var Constants = window.TournamentConstants;
    var Schema = window.TournamentSchema;
    var CalendarValidation = window.CalendarValidation;

    var _missing = [];

    if (!Constants) {
        _missing.push('TournamentConstants (module)');
    } else {
        if (!Array.isArray(Constants.VALID_PARTICIPANT_TYPES)) {
            _missing.push('TournamentConstants.VALID_PARTICIPANT_TYPES');
        }
        if (!Array.isArray(Constants.VALID_MATCH_TYPES)) {
            _missing.push('TournamentConstants.VALID_MATCH_TYPES');
        }
        if (typeof Constants.getCanonicalParticipantType !== 'function') {
            _missing.push(
                'TournamentConstants.getCanonicalParticipantType'
            );
        }
        if (typeof Constants.MIN_WEEK !== 'number' ||
            typeof Constants.MAX_WEEK !== 'number') {
            _missing.push(
                'TournamentConstants.MIN_WEEK / MAX_WEEK'
            );
        }
    }

    if (!Schema) {
        _missing.push('TournamentSchema (module)');
    } else {
        if (typeof Schema.isValidResult !== 'function') {
            _missing.push('TournamentSchema.isValidResult');
        }
        if (typeof Schema.isParticipantInTournament !== 'function') {
            _missing.push('TournamentSchema.isParticipantInTournament');
        }
        if (typeof Schema.isParticipantEliminated !== 'function') {
            _missing.push('TournamentSchema.isParticipantEliminated');
        }
        if (typeof Schema.getParticipantTypeFromRecord !== 'function') {
            _missing.push(
                'TournamentSchema.getParticipantTypeFromRecord'
            );
        }
        if (typeof Schema.getCanonicalParticipantType !== 'function') {
            _missing.push(
                'TournamentSchema.getCanonicalParticipantType'
            );
        }
        if (typeof Schema.normaliseId !== 'function') {
            _missing.push('TournamentSchema.normaliseId');
        }
        if (typeof Schema.isValidMatchType !== 'function') {
            _missing.push('TournamentSchema.isValidMatchType');
        }
        if (typeof Schema.isValidMatchStatus !== 'function') {
            _missing.push('TournamentSchema.isValidMatchStatus');
        }
        if (typeof Schema.isValidMode !== 'function') {
            _missing.push('TournamentSchema.isValidMode');
        }
    }

    if (!CalendarValidation ||
        typeof CalendarValidation.parseWeek !== 'function') {
        _missing.push('CalendarValidation.parseWeek');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TournamentRules] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__tournamentRulesLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function normaliseId(value) {
        return Schema.normaliseId(value);
    }

    function parseWeek(value) {
        return CalendarValidation.parseWeek(value);
    }

    function getCanonicalParticipantType(mode) {
        return Schema.getCanonicalParticipantType(mode);
    }

    function getParticipantType(tournament, participantId) {
        return Schema.getParticipantTypeFromRecord(
            tournament,
            participantId
        );
    }

    function isParticipantInTournament(tournament, participantId) {
        return Schema.isParticipantInTournament(
            tournament,
            participantId
        );
    }

    function isParticipantEliminated(tournament, participantId) {
        return Schema.isParticipantEliminated(
            tournament,
            participantId
        );
    }

    function isValidResult(value) {
        return Schema.isValidResult(value);
    }

    // ============================================================
    // WEEK RANGE
    // ============================================================
    //
    // Private helpers. Not part of the public surface in this
    // revision. Kept for internal use; a caller that wants them
    // back can request re-export.

    function validateWeekRange(startWeek, endWeek) {
        var minWeek = Constants.MIN_WEEK;
        var maxWeek = Constants.MAX_WEEK;

        var start = parseWeek(startWeek);
        if (start === null) {
            return {
                valid: false,
                message: 'Invalid start week. Must be between ' +
                    minWeek + ' and ' + maxWeek + '.',
                start: null,
                end: null
            };
        }

        var end = parseWeek(endWeek);
        if (end === null) {
            return {
                valid: false,
                message: 'Invalid end week. Must be between ' +
                    minWeek + ' and ' + maxWeek + '.',
                start: start,
                end: null
            };
        }

        if (start > end) {
            return {
                valid: false,
                message: 'Start week (' + start +
                    ') cannot be after end week (' + end + ').',
                start: start,
                end: end
            };
        }

        return { valid: true, start: start, end: end };
    }

    function isWeekInTournamentRange(tournament, week) {
        if (!tournament) { return false; }

        var weekNum = parseWeek(week);
        if (weekNum === null) { return false; }

        var startWeek = parseWeek(tournament.startWeek);
        var endWeek = parseWeek(tournament.endWeek);
        if (startWeek === null || endWeek === null) { return false; }

        return weekNum >= startWeek && weekNum <= endWeek;
    }

    // ============================================================
    // PARTICIPANT ELIGIBILITY
    // ============================================================
    //
    // These functions validate tournament-specific constraints.
    // They do NOT check whether a character or team exists in the
    // wider application. Existence is verified by the mutation that
    // owns the transaction snapshot.

    /**
     * Is the participant eligible for the given tournament?
     *
     * A participant is eligible when:
     *   - it is a member of the tournament's participant list
     *   - it is not eliminated
     *   - its persisted type matches the expected type (when supplied)
     *     and the tournament's canonical type
     *
     * @param {object} tournament
     * @param {string} participantId
     * @param {string} [participantType]
     * @returns {object} { valid, message? }
     */
    function validateParticipantEligibility(
        tournament,
        participantId,
        participantType
    ) {
        if (!tournament || typeof tournament !== 'object') {
            return { valid: false, message: 'Tournament is required.' };
        }

        if (!participantId) {
            return { valid: false, message: 'Participant ID is required.' };
        }

        var id = normaliseId(participantId);
        if (id === null) {
            return { valid: false, message: 'Invalid participant ID.' };
        }

        if (!isParticipantInTournament(tournament, id)) {
            return {
                valid: false,
                message: 'Participant is not in this tournament.'
            };
        }

        if (isParticipantEliminated(tournament, id)) {
            return {
                valid: false,
                message: 'Participant has been eliminated.'
            };
        }

        var actualType = getParticipantType(tournament, id);
        if (!actualType) {
            return {
                valid: false,
                message: 'Participant type could not be determined.'
            };
        }

        var canonicalType = getCanonicalParticipantType(tournament.mode);
        if (canonicalType === null) {
            return {
                valid: false,
                message:
                    'Cannot determine canonical participant type for ' +
                    'tournament mode "' + tournament.mode + '".'
            };
        }
        if (actualType !== canonicalType) {
            return {
                valid: false,
                message: 'Participant type "' + actualType +
                    '" does not match tournament mode "' +
                    tournament.mode + '".'
            };
        }

        if (participantType !== undefined && participantType !== null) {
            if (participantType !== actualType) {
                return {
                    valid: false,
                    message: 'Participant type mismatch. Expected ' +
                        participantType + ', got ' + actualType + '.'
                };
            }
        }

        return { valid: true };
    }

    function isParticipantEligible(
        tournament,
        participantId,
        participantType
    ) {
        return validateParticipantEligibility(
            tournament,
            participantId,
            participantType
        ).valid;
    }

    // ============================================================
    // RESULT MAP VALIDATION
    // ============================================================

    /**
     * Validate a result map against a set of expected keys.
     *
     * This is the CANONICAL result-map validator for the tournament
     * module. See the file header for the full calling convention
     * and the requireAll default.
     *
     * @param {object} results
     * @param {array|null} expectedIds - when an array, each result key
     *   must be a member of it. When null/undefined, only the map shape
     *   and values are checked.
     * @param {object} [options]
     * @param {boolean} [options.requireAll=true] - when true, every
     *   expectedId must appear in the map.
     * @returns {object} { valid, message?, map? }
     */
    function validateResultMap(results, expectedIds, options) {
        options = options || {};
        var requireAll = options.requireAll !== false;

        if (!isObject(results)) {
            return { valid: false, message: 'Results must be an object.' };
        }

        var normalised = {};
        var keys = Object.keys(results);

        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var id = normaliseId(key);
            if (id === null) {
                return {
                    valid: false,
                    message: 'Invalid result key: ' + key
                };
            }

            var value = results[key];
            if (!isValidResult(value)) {
                return {
                    valid: false,
                    message: 'Invalid result for ' + id + ': ' + value +
                        ' (expected pass, fail, or retry)'
                };
            }

            if (Array.isArray(expectedIds) && expectedIds.length > 0) {
                if (expectedIds.indexOf(id) === -1) {
                    return {
                        valid: false,
                        message: 'Result for ' + id +
                            ' does not match an expected participant.'
                    };
                }
            }

            normalised[id] = value;
        }

        if (requireAll && Array.isArray(expectedIds)) {
            for (var j = 0; j < expectedIds.length; j++) {
                var pid = normaliseId(expectedIds[j]);
                if (pid !== null && normalised[pid] === undefined) {
                    return {
                        valid: false,
                        message: 'Missing result for participant: ' + pid
                    };
                }
            }
        }

        return { valid: true, map: normalised };
    }

    // ============================================================
    // MATCH RESULT VALIDATION
    // ============================================================
    //
    // Private helpers. The public surface for match-result validation
    // is validateResultMap above. These wrap it for the two match
    // types. TournamentMatches does its own inline validation; these
    // remain for callers that want a Rules-layer check.

    /**
     * Validate a match result payload against a match's shape.
     *
     * The match is assumed to be structurally valid (Schema has
     * already run). Rules enforces:
     *   - group_exam   : results map, all participants covered
     *   - team_vs_team : teamResults map, all teams covered.
     *                    individualResults keys and values are
     *                    validated, but team membership is NOT
     *                    checked here (that is a cross-domain concern
     *                    for the caller).
     */
    function validateMatchResult(match, result) {
        if (!match || typeof match !== 'object') {
            return { valid: false, message: 'Match is required.' };
        }

        if (!result || typeof result !== 'object') {
            return { valid: false, message: 'Result is required.' };
        }

        var type = match.type;
        var participants = Array.isArray(match.participants)
            ? match.participants
            : [];

        if (type === 'group_exam') {
            return validateResultMap(
                result.results,
                participants,
                { requireAll: true }
            );
        }

        if (type === 'team_vs_team') {
            var teamCheck = validateResultMap(
                result.teamResults,
                participants,
                { requireAll: true }
            );
            if (!teamCheck.valid) { return teamCheck; }

            if (result.individualResults !== undefined &&
                result.individualResults !== null) {
                if (!isObject(result.individualResults)) {
                    return {
                        valid: false,
                        message: 'individualResults must be an object.'
                    };
                }
                var indCheck = validateResultMap(
                    result.individualResults,
                    null,
                    { requireAll: false }
                );
                if (!indCheck.valid) { return indCheck; }
            }

            return { valid: true };
        }

        return {
            valid: false,
            message: 'Unknown match type: ' + type
        };
    }

    /**
     * Validate that a match can be completed with the given result.
     * Private helper behind the deleted canCompleteMatch alias.
     */
    function validateMatchCompletion(match, result) {
        if (!match || typeof match !== 'object') {
            return { valid: false, message: 'Match is required.' };
        }

        if (match.status === 'completed') {
            return { valid: false, message: 'Match is already completed.' };
        }

        if (!result || typeof result !== 'object') {
            return {
                valid: false,
                message: 'Result is required to complete a match.'
            };
        }

        return validateMatchResult(match, result);
    }

    // ============================================================
    // ROUND VALIDATION
    // ============================================================

    /**
     * Validate that a round can be removed.
     *
     * Rule: a round with any completed match may not be removed by the
     * ordinary remove-round operation. Removing completed tournament
     * history is not an editing operation.
     */
    function validateRoundRemoval(tournament, roundIndex) {
        if (!tournament || typeof tournament !== 'object') {
            return { valid: false, message: 'Tournament is required.' };
        }

        var index = parseInt(roundIndex, 10);
        if (isNaN(index) || index < 0) {
            return { valid: false, message: 'Invalid round index.' };
        }

        var rounds = Array.isArray(tournament.rounds)
            ? tournament.rounds
            : [];
        if (index >= rounds.length) {
            return { valid: false, message: 'Round not found.' };
        }

        var round = rounds[index];
        if (!round) {
            return { valid: false, message: 'Round not found.' };
        }

        if (Array.isArray(round.matches)) {
            for (var i = 0; i < round.matches.length; i++) {
                var match = round.matches[i];
                if (match && match.status === 'completed') {
                    return {
                        valid: false,
                        message: 'Round has completed matches and cannot ' +
                            'be removed.'
                    };
                }
            }
        }

        if (round.status === 'completed') {
            return {
                valid: false,
                message: 'Round is completed and cannot be removed.'
            };
        }

        return { valid: true };
    }

    /**
     * Validate that a round can be added with the given configuration.
     *
     * There is no cap on round count. totalRounds is a planning hint.
     */
    function validateRoundAddition(tournament, roundData) {
        if (!tournament || typeof tournament !== 'object') {
            return { valid: false, message: 'Tournament is required.' };
        }

        if (roundData && typeof roundData === 'object') {
            if (roundData.matchSize !== undefined &&
                roundData.matchSize !== null) {
                var size = parseInt(roundData.matchSize, 10);
                if (isNaN(size) || size < 2) {
                    return {
                        valid: false,
                        message: 'Match size must be an integer >= 2.'
                    };
                }
            }

            if (roundData.matchType !== undefined &&
                roundData.matchType !== null) {
                if (!Schema.isValidMatchType(roundData.matchType)) {
                    return {
                        valid: false,
                        message: 'Invalid match type: ' +
                            roundData.matchType
                    };
                }
            }

            if (roundData.isPairExam === true &&
                roundData.matchType !== undefined &&
                roundData.matchType !== null &&
                roundData.matchType !== 'group_exam') {
                return {
                    valid: false,
                    message:
                        'Pair exams require match type "group_exam".'
                };
            }
        }

        return { valid: true };
    }

    // ============================================================
    // COMPLETION READINESS
    // ============================================================
    //
    // Private helper. Not part of the public surface in this
    // revision. The public surface for "can this tournament be
    // completed?" is: the caller reads the tournament's rounds and
    // checks each round.status === 'completed'. No winner is
    // required; a tournament may end with zero, one, or many final
    // passers.

    function validateCompletionReadiness(tournament) {
        if (!tournament || typeof tournament !== 'object') {
            return {
                valid: false,
                message: 'Tournament is required.',
                missing: ['tournament'],
                allRoundsComplete: false,
                finalPasserCount: 0
            };
        }

        var rounds = Array.isArray(tournament.rounds)
            ? tournament.rounds
            : [];

        if (rounds.length === 0) {
            return {
                valid: true,
                message:
                    'Tournament is ready for completion (no rounds).',
                missing: [],
                allRoundsComplete: true,
                finalPasserCount: 0
            };
        }

        var missing = [];

        for (var i = 0; i < rounds.length; i++) {
            var round = rounds[i];
            if (!round) {
                missing.push('Round ' + (i + 1) + ' missing.');
                continue;
            }

            if (round.status !== 'completed') {
                missing.push('Round ' + (i + 1) + ' not complete.');
            }

            if (Array.isArray(round.matches)) {
                for (var j = 0; j < round.matches.length; j++) {
                    var match = round.matches[j];
                    if (match && match.status !== 'completed') {
                        missing.push(
                            'Match ' + (j + 1) + ' in Round ' + (i + 1) +
                            ' not complete.'
                        );
                    }
                }
            }
        }

        var valid = missing.length === 0;

        var finalPasserCount = 0;
        if (valid && typeof Schema.deriveFinalPassers === 'function') {
            finalPasserCount =
                Schema.deriveFinalPassers(tournament).length;
        }

        return {
            valid: valid,
            message: valid
                ? 'Tournament is ready for completion.'
                : 'Tournament is not ready for completion.',
            missing: missing,
            allRoundsComplete: valid,
            finalPasserCount: finalPasserCount
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentRules = Object.freeze({
        // Participant eligibility
        validateParticipantEligibility: validateParticipantEligibility,
        isParticipantEligible: isParticipantEligible,

        // Result maps
        validateResultMap: validateResultMap,

        // Round operations
        validateRoundRemoval: validateRoundRemoval,
        validateRoundAddition: validateRoundAddition
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TournamentRules;
        var missing = [];

        var required = [
            'validateParticipantEligibility',
            'isParticipantEligible',
            'validateResultMap',
            'validateRoundRemoval',
            'validateRoundAddition'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[TournamentRules] Verification - some exports may be ' +
                'missing:', missing.join(', ')
            );
        }
    })();

})();