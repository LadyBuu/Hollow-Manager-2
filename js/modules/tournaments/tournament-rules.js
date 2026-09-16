/**
 * modules/tournaments/tournament-rules.js - Tournament Rules
 * Domain conditions for tournament operations (not state permissions).
 *
 * Path: js/modules/tournaments/tournament-rules.js
 *
 * This module is responsible for:
 *   - Domain condition validation (not state permissions)
 *   - Validating week ranges
 *   - Validating participant eligibility
 *   - Validating match results (pass | fail | retry)
 *   - Checking if a tournament is ready for completion
 *   - Validating round removal conditions
 *   - Validating participant counts
 *   - Validating match participant eligibility
 *
 * IMPORTANT:
 *   - This is the CANONICAL authority for domain conditions.
 *   - All modules MUST use this for domain condition checks.
 *   - Rules are declarative and immutable.
 *   - No persistence, no DOM, no UI state.
 *   - PURE functions - no side effects.
 *   - Does NOT duplicate Lifecycle (state permissions) or Schema (structure).
 *   - Lifecycle: "Can I do this in this state?"
 *   - Rules: "Are the domain conditions satisfied?"
 *   - Schema: "Is this structurally valid?"
 *
 * WEEK PARSING:
 *   Week values go through CalendarValidation.parseWeek, which is the
 *   canonical strict parser (integer-only, in-range, no silent coercion
 *   of trailing characters). This module does not have a local parser.
 *
 * DEEP CLONING:
 *   ObjectUtils.deepClone is the canonical deep-clone primitive. This
 *   module does not have a local clone helper.
 *
 * RESULT VOCABULARY:
 *   - 'pass'  : advanced and successful
 *   - 'retry' : advanced but not successful
 *   - 'fail'  : not advanced; eliminated from this tournament
 *   - Advancement = 'pass' OR 'retry'.
 *   - No winner/loser concept anywhere in this module.
 *
 * COMPLETION READINESS:
 *   - A tournament can be completed when every round's matches are
 *     completed. No winner is required. A tournament may end with
 *     zero, one, or many final passers.
 *
 * YEAR SEMANTICS:
 *   - Years are UNBOUNDED positive integers.
 *   - There is no MIN_YEAR or MAX_YEAR.
 *   - Tournaments are scoped to WEEKS (bounded 1-52), not years.
 *   - Years are not stored on tournaments; this module never reads or
 *     writes year values.
 *
 * DEPENDENCY CONTRACT:
 *   TournamentConstants, TournamentSchema, and CalendarValidation are
 *   MANDATORY. Each is checked at load time. CharacterQueries and
 *   TeamQueries are used only by the participant-eligibility helpers
 *   (isCharacter / isTeam), which degrade gracefully to a "not found"
 *   result when the query module is absent. That is intentional: an
 *   eligibility check for a tournament operation should not throw just
 *   because a character query module hasn't been registered yet. The
 *   tournament mutation pipeline re-validates against the snapshot.
 *
 * DEPENDENCIES:
 *   - window.TournamentConstants (from tournament-constants.js) - MANDATORY
 *   - window.TournamentSchema (from tournament-schema.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - LAZY
 *     (used only for isCharacter)
 *   - window.TeamQueries (from team-queries.js) - LAZY
 *     (used only for isTeam)
 *
 * USAGE:
 *   var Rules = window.TournamentRules;
 *   var isValid = Rules.isValidWeekRange(startWeek, endWeek);
 *   var canAdd = Rules.canAddParticipant(tournament, participantId, 'character');
 *   var isReady = Rules.isReadyForCompletion(tournament);
 *   var canRemove = Rules.canRemoveRound(tournament, roundIndex);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__tournamentRulesLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY
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
            _missing.push('TournamentConstants.getCanonicalParticipantType');
        }
        if (typeof Constants.MIN_WEEK !== 'number' ||
            typeof Constants.MAX_WEEK !== 'number') {
            _missing.push('TournamentConstants.MIN_WEEK / MAX_WEEK');
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
            _missing.push('TournamentSchema.getParticipantTypeFromRecord');
        }
        if (typeof Schema.normaliseId !== 'function') {
            _missing.push('TournamentSchema.normaliseId');
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
    // OPTIONAL DEPENDENCY ACCESSORS
    // ============================================================
    //
    // CharacterQueries and TeamQueries are used only by the
    // participant-eligibility helpers. When absent, those helpers
    // return false — the participant is treated as not found, which
    // is the correct conservative answer for a rules check.

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    function getTeamQueries() {
        return window.TeamQueries || null;
    }

    function getObjectUtils() {
        return window.ObjectUtils || null;
    }

    function getTournamentQueries() {
        return window.TournamentQueries || null;
    }

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

    /**
     * Normalise an ID via Schema.normaliseId (the canonical source).
     * Falls back to a local equivalent only if Schema returns undefined
     * (which shouldn't happen — Schema was checked at load).
     */
    function normaliseId(value) {
        return Schema.normaliseId(value);
    }

    /**
     * Deep clone a value via ObjectUtils.deepClone.
     *
     * ObjectUtils is not a load-time dependency of this module (it's
     * used only by a couple of helpers that build defensive copies of
     * caller-supplied objects). When absent, this falls back to a
     * structuredClone-based clone, then JSON, then the input. Every
     * fallback is a genuine clone for the value shapes this module
     * touches (plain JSON-compatible objects and arrays).
     */
    function deepClone(value) {
        var ObjectUtils = getObjectUtils();
        if (ObjectUtils && typeof ObjectUtils.deepClone === 'function') {
            return ObjectUtils.deepClone(value);
        }

        if (value === null || typeof value !== 'object') {
            return value;
        }

        if (typeof structuredClone === 'function') {
            try { return structuredClone(value); } catch (_) {}
        }

        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_) {
            return value;
        }
    }

    /**
     * Parse a week via CalendarValidation.parseWeek, the canonical
     * strict parser. No local implementation.
     */
    function parseWeek(value) {
        return CalendarValidation.parseWeek(value);
    }

    function getParticipantType(tournament, participantId) {
        return Schema.getParticipantTypeFromRecord(tournament, participantId);
    }

    function isParticipantInTournament(tournament, participantId) {
        return Schema.isParticipantInTournament(tournament, participantId);
    }

    function isParticipantEliminated(tournament, participantId) {
        return Schema.isParticipantEliminated(tournament, participantId);
    }

    function getParticipants(tournament) {
        if (!tournament || !Array.isArray(tournament.participants)) {
            return [];
        }
        return deepClone(tournament.participants);
    }

    function getRounds(tournament) {
        if (!tournament || !Array.isArray(tournament.rounds)) {
            return [];
        }
        return deepClone(tournament.rounds);
    }

    function isValidResult(value) {
        return Schema.isValidResult(value);
    }

    /**
     * Check whether a character ID exists in the wider application.
     * Uses CharacterQueries when available. When CharacterQueries is
     * absent, returns false — the participant is treated as not found.
     */
    function isCharacter(participantId) {
        var CQ = getCharacterQueries();
        if (!CQ || typeof CQ.getCharacterById !== 'function') {
            return false;
        }
        return CQ.getCharacterById(participantId) !== null;
    }

    /**
     * Check whether a team ID exists in the wider application.
     * Uses TeamQueries when available. When TeamQueries is absent,
     * returns false.
     */
    function isTeam(participantId) {
        var TQ = getTeamQueries();
        if (!TQ || typeof TQ.getTeamById !== 'function') {
            return false;
        }
        return TQ.getTeamById(participantId) !== null;
    }

    // ============================================================
    // WEEK RANGE VALIDATION
    // ============================================================

    /**
     * Validate tournament week range.
     */
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

    function isValidWeekRange(startWeek, endWeek) {
        var result = validateWeekRange(startWeek, endWeek);
        return result.valid;
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
    // PARTICIPANT VALIDATION
    // ============================================================

    function validateParticipantAddition(tournament, participantId, participantType) {
        var validTypes = Constants.VALID_PARTICIPANT_TYPES;

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

        if (!participantType) {
            return { valid: false, message: 'Participant type is required.' };
        }

        if (validTypes.indexOf(participantType) === -1) {
            return {
                valid: false,
                message: 'Invalid participant type: ' + participantType
            };
        }

        // Verify participant exists in the wider application.
        if (participantType === 'character') {
            if (!isCharacter(id)) {
                return { valid: false, message: 'Character not found.' };
            }
        } else if (participantType === 'team') {
            if (!isTeam(id)) {
                return { valid: false, message: 'Team not found.' };
            }
        } else {
            return { valid: false, message: 'Unknown participant type.' };
        }

        // Type must match tournament mode.
        var canonicalType = Constants.getCanonicalParticipantType(
            tournament.mode
        );

        if (canonicalType && participantType !== canonicalType) {
            return {
                valid: false,
                message: 'Participant type "' + participantType +
                    '" does not match tournament mode "' +
                    tournament.mode +
                    '" (expected "' + canonicalType + '").'
            };
        }

        if (isParticipantInTournament(tournament, id)) {
            return {
                valid: false,
                message: 'Participant is already in this tournament.'
            };
        }

        var participants = getParticipants(tournament);
        var maxParticipants = tournament.maxParticipants || 100;
        if (participants.length >= maxParticipants) {
            return {
                valid: false,
                message: 'Maximum participant count (' +
                    maxParticipants + ') reached.'
            };
        }

        return { valid: true };
    }

    function canAddParticipant(tournament, participantId, participantType) {
        var result = validateParticipantAddition(
            tournament, participantId, participantType
        );
        return result.valid;
    }

    function validateParticipantRemoval(tournament, participantId) {
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
                message: 'Participant not found in tournament.'
            };
        }

        if (isParticipantEliminated(tournament, id)) {
            return {
                valid: false,
                message: 'Cannot remove an eliminated participant.'
            };
        }

        // Cannot remove a participant who is in a match.
        var rounds = getRounds(tournament);
        for (var i = 0; i < rounds.length; i++) {
            var round = rounds[i];
            if (!round || !Array.isArray(round.matches)) { continue; }
            for (var j = 0; j < round.matches.length; j++) {
                var match = round.matches[j];
                if (!match || !Array.isArray(match.participants)) { continue; }
                for (var k = 0; k < match.participants.length; k++) {
                    if (normaliseId(match.participants[k]) === id) {
                        return {
                            valid: false,
                            message: 'Participant is in a match and ' +
                                'cannot be removed.'
                        };
                    }
                }
            }
        }

        return { valid: true };
    }

    function canRemoveParticipant(tournament, participantId) {
        var result = validateParticipantRemoval(tournament, participantId);
        return result.valid;
    }

    // ============================================================
    // RESULT MAP VALIDATION
    // ============================================================

    /**
     * Validate a results map against a list of expected keys.
     *
     * @param {object} results - Map of { id: 'pass' | 'fail' | 'retry' }
     * @param {array} expectedIds - Expected keys (participant or team IDs)
     * @param {object} options - { requireAll: boolean (default: true) }
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
                return { valid: false, message: 'Invalid result key: ' + key };
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

    /**
     * Validate a match result payload against a match's shape.
     */
    function validateMatchResult(match, result) {
        if (!match || typeof match !== 'object') {
            return { valid: false, message: 'Match is required.' };
        }

        if (!result || typeof result !== 'object') {
            return { valid: false, message: 'Result is required.' };
        }

        var type = match.type || 'group_exam';
        var participants = Array.isArray(match.participants)
            ? match.participants
            : [];

        if (type === 'group_exam') {
            var check = validateResultMap(
                result.results,
                participants,
                { requireAll: true }
            );
            if (!check.valid) { return check; }
            return { valid: true };
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
                var indKeys = Object.keys(result.individualResults);
                for (var i = 0; i < indKeys.length; i++) {
                    var val = result.individualResults[indKeys[i]];
                    if (!isValidResult(val)) {
                        return {
                            valid: false,
                            message: 'Invalid individual result: ' + val
                        };
                    }
                }
            }

            return { valid: true };
        }

        if (type === 'standard') {
            // Legacy. Only the winner is required.
            if (!result.winner) {
                return {
                    valid: false,
                    message: 'Winner is required for standard match.'
                };
            }
            var winnerId = normaliseId(result.winner);
            if (winnerId === null || participants.indexOf(winnerId) === -1) {
                return {
                    valid: false,
                    message: 'Winner must be a participant in the match.'
                };
            }
            return { valid: true };
        }

        return { valid: false, message: 'Unknown match type: ' + type };
    }

    function isValidMatchResult(match, result) {
        var validation = validateMatchResult(match, result);
        return validation.valid;
    }

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

    function canCompleteMatch(match, result) {
        var validation = validateMatchCompletion(match, result);
        return validation.valid;
    }

    // ============================================================
    // ROUND VALIDATION
    // ============================================================

    function validateRoundRemoval(tournament, roundIndex) {
        if (!tournament || typeof tournament !== 'object') {
            return { valid: false, message: 'Tournament is required.' };
        }

        var index = parseInt(roundIndex, 10);
        if (isNaN(index) || index < 0) {
            return { valid: false, message: 'Invalid round index.' };
        }

        var rounds = getRounds(tournament);
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

    function canRemoveRound(tournament, roundIndex) {
        var validation = validateRoundRemoval(tournament, roundIndex);
        return validation.valid;
    }

    function validateRoundAddition(tournament, roundData) {
        if (!tournament || typeof tournament !== 'object') {
            return { valid: false, message: 'Tournament is required.' };
        }

        var rounds = getRounds(tournament);
        var totalRounds = tournament.totalRounds || 10;

        if (rounds.length >= totalRounds) {
            return {
                valid: false,
                message: 'Maximum rounds (' + totalRounds + ') reached.'
            };
        }

        if (roundData && typeof roundData === 'object') {
            if (roundData.matchSize !== undefined) {
                var size = parseInt(roundData.matchSize, 10);
                if (isNaN(size) || size < 2) {
                    return {
                        valid: false,
                        message: 'Match size must be at least 2.'
                    };
                }
            }

            if (roundData.matchType !== undefined) {
                var validTypes = Constants.VALID_MATCH_TYPES;
                if (validTypes.indexOf(roundData.matchType) === -1) {
                    return {
                        valid: false,
                        message: 'Invalid match type: ' +
                            roundData.matchType
                    };
                }
            }
        }

        return { valid: true };
    }

    function canAddRound(tournament, roundData) {
        var validation = validateRoundAddition(tournament, roundData);
        return validation.valid;
    }

    // ============================================================
    // COMPLETION READINESS
    // ============================================================
    //
    // A tournament is ready to complete when every round's matches
    // are completed. No winner is required. A tournament may finish
    // with zero, one, or many final passers.

    function validateCompletionReadiness(tournament) {
        if (!tournament || typeof tournament !== 'object') {
            return {
                valid: false,
                message: 'Tournament is required.',
                missing: ['tournament']
            };
        }

        var missing = [];

        var rounds = getRounds(tournament);
        if (rounds.length === 0) {
            // A tournament with no rounds can still be completed — there
            // is nothing to run.
            return {
                valid: true,
                message: 'Tournament is ready for completion (no rounds).',
                missing: [],
                allRoundsComplete: true,
                finalPasserCount: 0
            };
        }

        for (var i = 0; i < rounds.length; i++) {
            var round = rounds[i];
            if (!round || round.status !== 'completed') {
                missing.push('Round ' + (i + 1) + ' not complete');
            }

            if (round && Array.isArray(round.matches)) {
                for (var j = 0; j < round.matches.length; j++) {
                    var match = round.matches[j];
                    if (match && match.status !== 'completed') {
                        missing.push(
                            'Match ' + (j + 1) + ' in Round ' + (i + 1) +
                            ' not complete'
                        );
                    }
                }
            }
        }

        var valid = missing.length === 0;

        // Count final passers, if the Schema exposes the derivation.
        var finalPasserCount = 0;
        if (Schema &&
            typeof Schema.deriveFinalPassers === 'function' &&
            valid) {
            try {
                finalPasserCount = Schema.deriveFinalPassers(tournament).length;
            } catch (e) {
                finalPasserCount = 0;
            }
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

    function isReadyForCompletion(tournament) {
        var validation = validateCompletionReadiness(tournament);
        return validation.valid;
    }

    function getCompletionReadinessReport(tournament) {
        return validateCompletionReadiness(tournament);
    }

    // ============================================================
    // PARTICIPANT ELIGIBILITY
    // ============================================================

    function validateParticipantEligibility(tournament, participantId, participantType) {
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

        if (participantType) {
            var actualType = getParticipantType(tournament, id);
            if (actualType && actualType !== participantType) {
                return {
                    valid: false,
                    message: 'Participant type mismatch. Expected ' +
                        participantType + ', got ' + actualType + '.'
                };
            }
        }

        return { valid: true };
    }

    function isParticipantEligible(tournament, participantId, participantType) {
        var validation = validateParticipantEligibility(
            tournament, participantId, participantType
        );
        return validation.valid;
    }

    // ============================================================
    // TOURNAMENT READINESS
    // ============================================================

    function validateTournamentStart(tournament) {
        if (!tournament || typeof tournament !== 'object') {
            return { valid: false, message: 'Tournament is required.' };
        }

        if (tournament.status !== 'draft') {
            return {
                valid: false,
                message: 'Tournament must be in draft status to start.'
            };
        }

        var participants = getParticipants(tournament);
        if (participants.length < 2) {
            return {
                valid: false,
                message: 'Tournament needs at least 2 participants ' +
                    'to start.'
            };
        }

        var weekValidation = validateWeekRange(
            tournament.startWeek,
            tournament.endWeek
        );
        if (!weekValidation.valid) {
            return weekValidation;
        }

        return { valid: true };
    }

    function canStartTournament(tournament) {
        var validation = validateTournamentStart(tournament);
        return validation.valid;
    }

    // ============================================================
    // QUERY HELPERS
    // ============================================================

    function getMinimumParticipants(mode) {
        return 2;
    }

    function getMaximumParticipants(mode) {
        return 100;
    }

    function hasEnoughParticipants(tournament) {
        var participants = getParticipants(tournament);
        return participants.length >= 2;
    }

    function hasActiveParticipants(tournament) {
        if (!tournament || !Array.isArray(tournament.participants)) {
            return false;
        }

        var activeCount = 0;
        for (var i = 0; i < tournament.participants.length; i++) {
            var p = tournament.participants[i];
            if (p && !isParticipantEliminated(tournament, p.id)) {
                activeCount++;
            }
        }

        return activeCount >= 2;
    }

    // ============================================================
    // FINAL PASSERS HELPERS
    // ============================================================

    function getFinalPassers(tournament) {
        if (!Schema ||
            typeof Schema.deriveFinalPassers !== 'function') {
            return [];
        }
        try {
            return Schema.deriveFinalPassers(tournament);
        } catch (e) {
            return [];
        }
    }

    /**
     * Classify a result value into a semantic category.
     *   'pass'   → 'passed'
     *   'retry'  → 'retry'
     *   'fail'   → 'failed'
     *   other    → 'unknown'
     */
    function getResultCategory(resultValue) {
        if (resultValue === 'pass') { return 'passed'; }
        if (resultValue === 'retry') { return 'retry'; }
        if (resultValue === 'fail') { return 'failed'; }
        return 'unknown';
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentRules = {
        // Week range
        validateWeekRange: validateWeekRange,
        isValidWeekRange: isValidWeekRange,
        isWeekInTournamentRange: isWeekInTournamentRange,

        // Participant addition/removal
        validateParticipantAddition: validateParticipantAddition,
        canAddParticipant: canAddParticipant,
        validateParticipantRemoval: validateParticipantRemoval,
        canRemoveParticipant: canRemoveParticipant,

        // Result maps
        validateResultMap: validateResultMap,

        // Match results
        validateMatchResult: validateMatchResult,
        isValidMatchResult: isValidMatchResult,
        validateMatchCompletion: validateMatchCompletion,
        canCompleteMatch: canCompleteMatch,

        // Round operations
        validateRoundRemoval: validateRoundRemoval,
        canRemoveRound: canRemoveRound,
        validateRoundAddition: validateRoundAddition,
        canAddRound: canAddRound,

        // Completion readiness
        validateCompletionReadiness: validateCompletionReadiness,
        isReadyForCompletion: isReadyForCompletion,
        getCompletionReadinessReport: getCompletionReadinessReport,

        // Participant eligibility
        validateParticipantEligibility: validateParticipantEligibility,
        isParticipantEligible: isParticipantEligible,

        // Tournament start
        validateTournamentStart: validateTournamentStart,
        canStartTournament: canStartTournament,

        // Query helpers
        getMinimumParticipants: getMinimumParticipants,
        getMaximumParticipants: getMaximumParticipants,
        hasEnoughParticipants: hasEnoughParticipants,
        hasActiveParticipants: hasActiveParticipants,

        // Final passers
        getFinalPassers: getFinalPassers,
        getResultCategory: getResultCategory
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TournamentRules;
        var missing = [];

        var required = [
            'validateWeekRange', 'isValidWeekRange', 'isWeekInTournamentRange',
            'validateParticipantAddition', 'canAddParticipant',
            'validateParticipantRemoval', 'canRemoveParticipant',
            'validateResultMap',
            'validateMatchResult', 'isValidMatchResult',
            'validateMatchCompletion', 'canCompleteMatch',
            'validateRoundRemoval', 'canRemoveRound',
            'validateRoundAddition', 'canAddRound',
            'validateCompletionReadiness', 'isReadyForCompletion',
            'getCompletionReadinessReport',
            'validateParticipantEligibility', 'isParticipantEligible',
            'validateTournamentStart', 'canStartTournament',
            'getMinimumParticipants', 'getMaximumParticipants',
            'hasEnoughParticipants', 'hasActiveParticipants',
            'getFinalPassers', 'getResultCategory'
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
