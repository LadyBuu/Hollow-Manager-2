/**
 * modules/tournaments/tournament-rules.js - Tournament Rules
 * Domain conditions for tournament operations (not state permissions)
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
 *   - This is the CANONICAL authority for domain conditions
 *   - All modules MUST use this for domain condition checks
 *   - Rules are declarative and immutable
 *   - No persistence, no DOM, no UI state
 *   - PURE functions - no side effects
 *   - Does NOT duplicate Lifecycle (state permissions) or Schema (structure)
 *   - Lifecycle: "Can I do this in this state?"
 *   - Rules: "Are the domain conditions satisfied?"
 *   - Schema: "Is this structurally valid?"
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
 *   - Years are not stored on tournaments; this module never
 *     reads or writes year values.
 *
 * DEPENDENCIES:
 *   - window.TournamentConstants (from tournament-constants.js) - MANDATORY
 *   - window.TournamentSchema (from tournament-schema.js) - MANDATORY
 *   - window.CalendarValidation (from calendar-validation.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.TeamQueries (from team-queries.js) - MANDATORY
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
    // LAZY LOADING HELPERS
    // ============================================================

    function getConstants() {
        return window.TournamentConstants || null;
    }

    function getSchema() {
        return window.TournamentSchema || null;
    }

    function getCalendarValidation() {
        return window.CalendarValidation || null;
    }

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
    // DEPENDENCY CHECK - Warns but doesn't fail
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!getConstants()) { missing.push('TournamentConstants (lazy)'); }
        if (!getSchema()) { missing.push('TournamentSchema (lazy)'); }
        if (!getCalendarValidation()) { missing.push('CalendarValidation (lazy)'); }

        if (missing.length > 0) {
            console.warn('[TournamentRules] Some dependencies not yet loaded:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function normaliseId(value) {
        var Schema = getSchema();
        if (Schema && typeof Schema.normaliseId === 'function') {
            return Schema.normaliseId(value);
        }
        if (value === null || value === undefined) {
            return null;
        }
        var str = String(value).trim();
        return str !== '' ? str : null;
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function deepClone(value) {
        var ObjectUtils = getObjectUtils();
        if (ObjectUtils && typeof ObjectUtils.deepClone === 'function') {
            return ObjectUtils.deepClone(value);
        }
        if (value === null || typeof value !== 'object') {
            return value;
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_) {
            return value;
        }
    }

    function parseWeek(value) {
        var CalendarValidation = getCalendarValidation();
        if (CalendarValidation && typeof CalendarValidation.parseWeek === 'function') {
            return CalendarValidation.parseWeek(value);
        }
        var num = parseInt(value, 10);
        return !isNaN(num) && num >= 1 && num <= 52 ? num : null;
    }

    function getParticipantType(tournament, participantId) {
        var Schema = getSchema();
        if (Schema && typeof Schema.getParticipantTypeFromRecord === 'function') {
            return Schema.getParticipantTypeFromRecord(tournament, participantId);
        }
        return null;
    }

    function isParticipantInTournament(tournament, participantId) {
        var Schema = getSchema();
        if (Schema && typeof Schema.isParticipantInTournament === 'function') {
            return Schema.isParticipantInTournament(tournament, participantId);
        }
        return false;
    }

    function isParticipantEliminated(tournament, participantId) {
        var Schema = getSchema();
        if (Schema && typeof Schema.isParticipantEliminated === 'function') {
            return Schema.isParticipantEliminated(tournament, participantId);
        }
        return false;
    }

    function getParticipants(tournament) {
        var Schema = getSchema();
        if (Schema && typeof Schema.getParticipants === 'function') {
            return Schema.getParticipants(tournament);
        }
        return [];
    }

    function getRounds(tournament) {
        var Schema = getSchema();
        if (Schema && typeof Schema.getRounds === 'function') {
            return Schema.getRounds(tournament);
        }
        return [];
    }

    function isValidResult(value) {
        var Schema = getSchema();
        if (Schema && typeof Schema.isValidResult === 'function') {
            return Schema.isValidResult(value);
        }
        // Fallback
        return value === 'pass' || value === 'fail' || value === 'retry';
    }

    function isCharacter(participantId) {
        var CharacterQueries = getCharacterQueries();
        if (CharacterQueries && typeof CharacterQueries.getCharacterById === 'function') {
            return CharacterQueries.getCharacterById(participantId) !== null;
        }
        return false;
    }

    function isTeam(participantId) {
        var TeamQueries = getTeamQueries();
        if (TeamQueries && typeof TeamQueries.getTeamById === 'function') {
            return TeamQueries.getTeamById(participantId) !== null;
        }
        return false;
    }

    // ============================================================
    // WEEK RANGE VALIDATION
    // ============================================================

    /**
     * Validate tournament week range.
     */
    function validateWeekRange(startWeek, endWeek) {
        var Constants = getConstants();
        var minWeek = Constants ? Constants.MIN_WEEK || 1 : 1;
        var maxWeek = Constants ? Constants.MAX_WEEK || 52 : 52;

        var start = parseWeek(startWeek);
        if (start === null) {
            return {
                valid: false,
                message: 'Invalid start week. Must be between ' + minWeek + ' and ' + maxWeek + '.',
                start: null,
                end: null
            };
        }

        var end = parseWeek(endWeek);
        if (end === null) {
            return {
                valid: false,
                message: 'Invalid end week. Must be between ' + minWeek + ' and ' + maxWeek + '.',
                start: start,
                end: null
            };
        }

        if (start > end) {
            return {
                valid: false,
                message: 'Start week (' + start + ') cannot be after end week (' + end + ').',
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
        var Constants = getConstants();

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

        var validTypes = Constants
            ? Constants.VALID_PARTICIPANT_TYPES
            : ['character', 'team'];

        if (validTypes.indexOf(participantType) === -1) {
            return { valid: false, message: 'Invalid participant type: ' + participantType };
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
        var canonicalType = Constants && typeof Constants.getCanonicalParticipantType === 'function'
            ? Constants.getCanonicalParticipantType(tournament.mode)
            : (tournament.mode === 'teams' ? 'team' : 'character');

        if (canonicalType && participantType !== canonicalType) {
            return {
                valid: false,
                message: 'Participant type "' + participantType +
                    '" does not match tournament mode "' + tournament.mode +
                    '" (expected "' + canonicalType + '").'
            };
        }

        if (isParticipantInTournament(tournament, id)) {
            return { valid: false, message: 'Participant is already in this tournament.' };
        }

        var participants = getParticipants(tournament);
        var maxParticipants = tournament.maxParticipants || 100;
        if (participants.length >= maxParticipants) {
            return {
                valid: false,
                message: 'Maximum participant count (' + maxParticipants + ') reached.'
            };
        }

        return { valid: true };
    }

    function canAddParticipant(tournament, participantId, participantType) {
        var result = validateParticipantAddition(tournament, participantId, participantType);
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
            return { valid: false, message: 'Participant not found in tournament.' };
        }

        if (isParticipantEliminated(tournament, id)) {
            return { valid: false, message: 'Cannot remove an eliminated participant.' };
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
                            message: 'Participant is in a match and cannot be removed.'
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
                        message: 'Result for ' + id + ' does not match an expected participant.'
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
     *
     * @param {object} match
     * @param {object} result
     * @returns {object} { valid, message? }
     */
    function validateMatchResult(match, result) {
        if (!match || typeof match !== 'object') {
            return { valid: false, message: 'Match is required.' };
        }

        if (!result || typeof result !== 'object') {
            return { valid: false, message: 'Result is required.' };
        }

        var type = match.type || 'group_exam';
        var participants = Array.isArray(match.participants) ? match.participants : [];

        if (type === 'group_exam') {
            var check = validateResultMap(result.results, participants, { requireAll: true });
            if (!check.valid) { return check; }
            return { valid: true };
        }

        if (type === 'team_vs_team') {
            var teamCheck = validateResultMap(result.teamResults, participants, { requireAll: true });
            if (!teamCheck.valid) { return teamCheck; }

            if (result.individualResults !== undefined && result.individualResults !== null) {
                // Individual results are free-form: any character ID that
                // is a member of one of the participating teams.
                // Membership is validated at a higher level; here we
                // only check the values.
                if (!isObject(result.individualResults)) {
                    return { valid: false, message: 'individualResults must be an object.' };
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
                return { valid: false, message: 'Winner is required for standard match.' };
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
            return { valid: false, message: 'Result is required to complete a match.' };
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
                        message: 'Round has completed matches and cannot be removed.'
                    };
                }
            }
        }

        if (round.status === 'completed') {
            return { valid: false, message: 'Round is completed and cannot be removed.' };
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
                    return { valid: false, message: 'Match size must be at least 2.' };
                }
            }

            if (roundData.matchType !== undefined) {
                var Constants = getConstants();
                var validTypes = Constants
                    ? Constants.VALID_MATCH_TYPES
                    : ['standard', 'group_exam', 'team_vs_team'];
                if (validTypes.indexOf(roundData.matchType) === -1) {
                    return {
                        valid: false,
                        message: 'Invalid match type: ' + roundData.matchType
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
            // A tournament with no rounds can still be completed —
            // there is nothing to run.
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

            if (Array.isArray(round.matches)) {
                for (var j = 0; j < round.matches.length; j++) {
                    var match = round.matches[j];
                    if (match && match.status !== 'completed') {
                        missing.push('Match ' + (j + 1) + ' in Round ' + (i + 1) + ' not complete');
                    }
                }
            }
        }

        var valid = missing.length === 0;

        // Count final passers, if the Schema exposes the derivation.
        var finalPasserCount = 0;
        var Schema = getSchema();
        if (Schema && typeof Schema.deriveFinalPassers === 'function' && valid) {
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
            return { valid: false, message: 'Participant is not in this tournament.' };
        }

        if (isParticipantEliminated(tournament, id)) {
            return { valid: false, message: 'Participant has been eliminated.' };
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
        var validation = validateParticipantEligibility(tournament, participantId, participantType);
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
                message: 'Tournament needs at least 2 participants to start.'
            };
        }

        var weekValidation = validateWeekRange(tournament.startWeek, tournament.endWeek);
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

    /**
     * Get the final passers of a tournament, using the Schema's
     * canonical derivation.
     *
     * @param {object} tournament
     * @returns {array} Array of participant IDs
     */
    function getFinalPassers(tournament) {
        var Schema = getSchema();
        if (!Schema || typeof Schema.deriveFinalPassers !== 'function') {
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
     * 'pass'    → 'passed'
     * 'retry'   → 'retry'
     * 'fail'    → 'failed'
     * anything  → 'unknown'
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
            'validateCompletionReadiness', 'isReadyForCompletion', 'getCompletionReadinessReport',
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
            console.warn('[TournamentRules] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();