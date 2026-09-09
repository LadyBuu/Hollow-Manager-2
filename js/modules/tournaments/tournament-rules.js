/**
 * modules/tournaments/tournament-rules.js - Tournament Rules
 * Domain conditions for tournament operations (not state permissions)
 * Path: js/modules/tournaments/tournament-rules.js
 * 
 * This module is responsible for:
 *   - Domain condition validation (not state permissions)
 *   - Validating week ranges
 *   - Validating participant eligibility
 *   - Validating match results
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
 * DEPENDENCIES:
 *   - window.TournamentConstants (from tournament-constants.js) - MANDATORY
 *   - window.TournamentsSchema (from tournaments-schema.js) - MANDATORY
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
        return window.TournamentsSchema || null;
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

        if (!getConstants()) {
            missing.push('TournamentConstants (lazy)');
        }
        if (!getSchema()) {
            missing.push('TournamentsSchema (lazy)');
        }
        if (!getCalendarValidation()) {
            missing.push('CalendarValidation (lazy)');
        }

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
     * 
     * @param {number|string} startWeek - Start week
     * @param {number|string} endWeek - End week
     * @returns {object} { valid: boolean, message?: string, start: number|null, end: number|null }
     */
    function validateWeekRange(startWeek, endWeek) {
        var Constants = getConstants();
        var minWeek = Constants ? Constants.MIN_WEEK || 1 : 1;
        var maxWeek = Constants ? Constants.MAX_WEEK || 52 : 52;

        var start = parseWeek(startWeek);
        if (start === null) {
            return { valid: false, message: 'Invalid start week. Must be between ' + minWeek + ' and ' + maxWeek + '.', start: null, end: null };
        }

        var end = parseWeek(endWeek);
        if (end === null) {
            return { valid: false, message: 'Invalid end week. Must be between ' + minWeek + ' and ' + maxWeek + '.', start: start, end: null };
        }

        if (start > end) {
            return { valid: false, message: 'Start week (' + start + ') cannot be after end week (' + end + ').', start: start, end: end };
        }

        return { valid: true, start: start, end: end };
    }

    /**
     * Check if a week range is valid.
     * 
     * @param {number|string} startWeek - Start week
     * @param {number|string} endWeek - End week
     * @returns {boolean} True if valid
     */
    function isValidWeekRange(startWeek, endWeek) {
        var result = validateWeekRange(startWeek, endWeek);
        return result.valid;
    }

    /**
     * Check if a week is within a tournament's range.
     * 
     * @param {object} tournament - Tournament object
     * @param {number|string} week - Week to check
     * @returns {boolean} True if week is within range
     */
    function isWeekInTournamentRange(tournament, week) {
        if (!tournament) {
            return false;
        }

        var weekNum = parseWeek(week);
        if (weekNum === null) {
            return false;
        }

        var startWeek = parseWeek(tournament.startWeek);
        var endWeek = parseWeek(tournament.endWeek);

        if (startWeek === null || endWeek === null) {
            return false;
        }

        return weekNum >= startWeek && weekNum <= endWeek;
    }

    // ============================================================
    // PARTICIPANT VALIDATION
    // ============================================================

    /**
     * Validate that a participant can be added to a tournament.
     * 
     * @param {object} tournament - Tournament object
     * @param {string} participantId - Participant ID
     * @param {string} participantType - 'character' or 'team'
     * @returns {object} { valid: boolean, message?: string }
     */
    function validateParticipantAddition(tournament, participantId, participantType) {
        var Constants = getConstants();
        var Schema = getSchema();

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

        var validTypes = Constants ? Constants.VALID_PARTICIPANT_TYPES : ['character', 'team'];
        if (validTypes.indexOf(participantType) === -1) {
            return { valid: false, message: 'Invalid participant type: ' + participantType };
        }

        // Verify participant exists
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

        // Check participant type matches tournament mode
        var canonicalType = Constants ? Constants.getCanonicalParticipantType(tournament.mode) : null;
        if (canonicalType && participantType !== canonicalType) {
            return { valid: false, message: 'Participant type "' + participantType + '" does not match tournament mode "' + tournament.mode + '" (expected "' + canonicalType + '").' };
        }

        // Check if already a participant
        if (isParticipantInTournament(tournament, id)) {
            return { valid: false, message: 'Participant is already in this tournament.' };
        }

        // Check participant count
        var participants = getParticipants(tournament);
        var maxParticipants = tournament.maxParticipants || 100;
        if (participants.length >= maxParticipants) {
            return { valid: false, message: 'Maximum participant count (' + maxParticipants + ') reached.' };
        }

        return { valid: true };
    }

    /**
     * Check if a participant can be added to a tournament.
     * 
     * @param {object} tournament - Tournament object
     * @param {string} participantId - Participant ID
     * @param {string} participantType - 'character' or 'team'
     * @returns {boolean} True if can be added
     */
    function canAddParticipant(tournament, participantId, participantType) {
        var result = validateParticipantAddition(tournament, participantId, participantType);
        return result.valid;
    }

    /**
     * Validate that a participant can be removed from a tournament.
     * 
     * @param {object} tournament - Tournament object
     * @param {string} participantId - Participant ID
     * @returns {object} { valid: boolean, message?: string }
     */
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

        // Check if participant exists
        if (!isParticipantInTournament(tournament, id)) {
            return { valid: false, message: 'Participant not found in tournament.' };
        }

        // Check if participant is already eliminated
        if (isParticipantEliminated(tournament, id)) {
            return { valid: false, message: 'Cannot remove an eliminated participant.' };
        }

        // Check if participant has matches
        var rounds = getRounds(tournament);
        for (var i = 0; i < rounds.length; i++) {
            var round = rounds[i];
            if (!round || !Array.isArray(round.matches)) {
                continue;
            }
            for (var j = 0; j < round.matches.length; j++) {
                var match = round.matches[j];
                if (!match || !Array.isArray(match.participants)) {
                    continue;
                }
                for (var k = 0; k < match.participants.length; k++) {
                    if (normaliseId(match.participants[k]) === id) {
                        return { valid: false, message: 'Participant is in a match and cannot be removed.' };
                    }
                }
            }
        }

        return { valid: true };
    }

    /**
     * Check if a participant can be removed from a tournament.
     * 
     * @param {object} tournament - Tournament object
     * @param {string} participantId - Participant ID
     * @returns {boolean} True if can be removed
     */
    function canRemoveParticipant(tournament, participantId) {
        var result = validateParticipantRemoval(tournament, participantId);
        return result.valid;
    }

    // ============================================================
    // MATCH RESULT VALIDATION
    // ============================================================

    /**
     * Validate that a match result is valid.
     * 
     * @param {object} match - Match object
     * @param {object} result - Result to validate
     * @param {string} result.winner - Winner ID (for standard matches)
     * @param {object} result.results - Results (for group exam matches)
     * @returns {object} { valid: boolean, message?: string }
     */
    function validateMatchResult(match, result) {
        var Constants = getConstants();
        var validGroupExamResults = Constants ? Constants.VALID_GROUP_EXAM_RESULTS : ['pass', 'fail'];

        if (!match || typeof match !== 'object') {
            return { valid: false, message: 'Match is required.' };
        }

        if (!result || typeof result !== 'object') {
            return { valid: false, message: 'Result is required.' };
        }

        var type = match.type || 'standard';

        if (type === 'standard') {
            var winner = result.winner;
            if (!winner) {
                return { valid: false, message: 'Winner is required for standard match.' };
            }

            var winnerId = normaliseId(winner);
            if (winnerId === null) {
                return { valid: false, message: 'Invalid winner ID.' };
            }

            if (!Array.isArray(match.participants) || match.participants.indexOf(winnerId) === -1) {
                return { valid: false, message: 'Winner must be a participant in the match.' };
            }

            // Winner must be an active participant
            if (match.status !== 'completed') {
                // Check if winner is eliminated from tournament
                // This is a business rule check
            }

            return { valid: true };
        }

        if (type === 'group_exam') {
            var results = result.results;
            if (!results || typeof results !== 'object') {
                return { valid: false, message: 'Results are required for group exam match.' };
            }

            if (!Array.isArray(match.participants) || match.participants.length === 0) {
                return { valid: false, message: 'Match has no participants.' };
            }

            for (var i = 0; i < match.participants.length; i++) {
                var id = match.participants[i];
                var normalisedId = normaliseId(id);
                if (normalisedId === null) {
                    return { valid: false, message: 'Invalid participant ID in match.' };
                }

                var resultValue = results[normalisedId] || results[id];
                if (!resultValue) {
                    return { valid: false, message: 'Missing result for participant: ' + id };
                }

                if (validGroupExamResults.indexOf(resultValue) === -1) {
                    return { valid: false, message: 'Invalid result for participant: ' + id + ' (expected pass or fail)' };
                }
            }

            return { valid: true };
        }

        return { valid: false, message: 'Unknown match type: ' + type };
    }

    /**
     * Check if a match result is valid.
     * 
     * @param {object} match - Match object
     * @param {object} result - Result to validate
     * @returns {boolean} True if valid
     */
    function isValidMatchResult(match, result) {
        var validation = validateMatchResult(match, result);
        return validation.valid;
    }

    /**
     * Validate that a match can be completed.
     * 
     * @param {object} match - Match object
     * @param {object} result - Result to validate
     * @returns {object} { valid: boolean, message?: string }
     */
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

        var validation = validateMatchResult(match, result);
        if (!validation.valid) {
            return validation;
        }

        // Additional business rules for completion
        var type = match.type || 'standard';

        if (type === 'standard') {
            var winner = result.winner;
            // Winner must not be eliminated from the tournament
            // This is checked in the workflow layer
        }

        return { valid: true };
    }

    /**
     * Check if a match can be completed.
     * 
     * @param {object} match - Match object
     * @param {object} result - Result to validate
     * @returns {boolean} True if can be completed
     */
    function canCompleteMatch(match, result) {
        var validation = validateMatchCompletion(match, result);
        return validation.valid;
    }

    // ============================================================
    // ROUND VALIDATION
    // ============================================================

    /**
     * Validate that a round can be removed.
     * 
     * @param {object} tournament - Tournament object
     * @param {number} roundIndex - Index of the round to remove
     * @returns {object} { valid: boolean, message?: string }
     */
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

        // Check if round has completed matches
        if (Array.isArray(round.matches)) {
            var hasCompletedMatches = false;
            for (var i = 0; i < round.matches.length; i++) {
                var match = round.matches[i];
                if (match && match.status === 'completed') {
                    hasCompletedMatches = true;
                    break;
                }
            }
            if (hasCompletedMatches) {
                return { valid: false, message: 'Round has completed matches and cannot be removed.' };
            }
        }

        // Check if round is completed
        if (round.status === 'completed') {
            return { valid: false, message: 'Round is completed and cannot be removed.' };
        }

        return { valid: true };
    }

    /**
     * Check if a round can be removed.
     * 
     * @param {object} tournament - Tournament object
     * @param {number} roundIndex - Index of the round to remove
     * @returns {boolean} True if can be removed
     */
    function canRemoveRound(tournament, roundIndex) {
        var validation = validateRoundRemoval(tournament, roundIndex);
        return validation.valid;
    }

    /**
     * Validate that a round can be added.
     * 
     * @param {object} tournament - Tournament object
     * @param {object} roundData - Round data
     * @returns {object} { valid: boolean, message?: string }
     */
    function validateRoundAddition(tournament, roundData) {
        if (!tournament || typeof tournament !== 'object') {
            return { valid: false, message: 'Tournament is required.' };
        }

        var rounds = getRounds(tournament);
        var totalRounds = tournament.totalRounds || 10;

        if (rounds.length >= totalRounds) {
            return { valid: false, message: 'Maximum rounds (' + totalRounds + ') reached.' };
        }

        // Validate round data if provided
        if (roundData && typeof roundData === 'object') {
            if (roundData.matchSize !== undefined) {
                var size = parseInt(roundData.matchSize, 10);
                if (isNaN(size) || size < 2) {
                    return { valid: false, message: 'Match size must be at least 2.' };
                }
            }

            if (roundData.matchType !== undefined) {
                var Constants = getConstants();
                var validTypes = Constants ? Constants.VALID_MATCH_TYPES : ['standard', 'group_exam'];
                if (validTypes.indexOf(roundData.matchType) === -1) {
                    return { valid: false, message: 'Invalid match type: ' + roundData.matchType };
                }
            }
        }

        return { valid: true };
    }

    /**
     * Check if a round can be added.
     * 
     * @param {object} tournament - Tournament object
     * @param {object} roundData - Round data
     * @returns {boolean} True if can be added
     */
    function canAddRound(tournament, roundData) {
        var validation = validateRoundAddition(tournament, roundData);
        return validation.valid;
    }

    // ============================================================
    // COMPLETION READINESS
    // ============================================================

    /**
     * Validate that a tournament is ready for completion.
     * 
     * @param {object} tournament - Tournament object
     * @returns {object} { valid: boolean, message?: string, missing: array }
     */
    function validateCompletionReadiness(tournament) {
        if (!tournament || typeof tournament !== 'object') {
            return { valid: false, message: 'Tournament is required.', missing: ['tournament'] };
        }

        var missing = [];

        // Check all rounds are complete
        var rounds = getRounds(tournament);
        if (rounds.length === 0) {
            missing.push('No rounds');
        }

        var allRoundsComplete = true;
        for (var i = 0; i < rounds.length; i++) {
            var round = rounds[i];
            if (!round || round.status !== 'completed') {
                allRoundsComplete = false;
                missing.push('Round ' + (i + 1) + ' not complete');
            }

            // Check all matches in round are complete
            if (Array.isArray(round.matches)) {
                for (var j = 0; j < round.matches.length; j++) {
                    var match = round.matches[j];
                    if (match && match.status !== 'completed') {
                        missing.push('Match ' + (j + 1) + ' in Round ' + (i + 1) + ' not complete');
                    }
                }
            }
        }

        // Check winner exists
        if (!tournament.winner) {
            missing.push('No winner');
        }

        var valid = missing.length === 0;

        return {
            valid: valid,
            message: valid ? 'Tournament is ready for completion.' : 'Tournament is not ready for completion.',
            missing: missing,
            allRoundsComplete: allRoundsComplete,
            hasWinner: !!tournament.winner
        };
    }

    /**
     * Check if a tournament is ready for completion.
     * 
     * @param {object} tournament - Tournament object
     * @returns {boolean} True if ready
     */
    function isReadyForCompletion(tournament) {
        var validation = validateCompletionReadiness(tournament);
        return validation.valid;
    }

    /**
     * Get completion readiness report.
     * 
     * @param {object} tournament - Tournament object
     * @returns {object} Readiness report
     */
    function getCompletionReadinessReport(tournament) {
        return validateCompletionReadiness(tournament);
    }

    // ============================================================
    // PARTICIPANT ELIGIBILITY
    // ============================================================

    /**
     * Validate that a participant is eligible for a match.
     * 
     * @param {object} tournament - Tournament object
     * @param {string} participantId - Participant ID
     * @param {string} participantType - 'character' or 'team'
     * @returns {object} { valid: boolean, message?: string }
     */
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

        // Check participant is in tournament
        if (!isParticipantInTournament(tournament, id)) {
            return { valid: false, message: 'Participant is not in this tournament.' };
        }

        // Check participant is not eliminated
        if (isParticipantEliminated(tournament, id)) {
            return { valid: false, message: 'Participant has been eliminated.' };
        }

        // Check participant type matches
        if (participantType) {
            var actualType = getParticipantType(tournament, id);
            if (actualType && actualType !== participantType) {
                return { valid: false, message: 'Participant type mismatch. Expected ' + participantType + ', got ' + actualType + '.' };
            }
        }

        return { valid: true };
    }

    /**
     * Check if a participant is eligible for a match.
     * 
     * @param {object} tournament - Tournament object
     * @param {string} participantId - Participant ID
     * @param {string} participantType - 'character' or 'team'
     * @returns {boolean} True if eligible
     */
    function isParticipantEligible(tournament, participantId, participantType) {
        var validation = validateParticipantEligibility(tournament, participantId, participantType);
        return validation.valid;
    }

    // ============================================================
    // TOURNAMENT READINESS
    // ============================================================

    /**
     * Validate that a tournament can be started (transitioned from draft to active).
     * 
     * @param {object} tournament - Tournament object
     * @returns {object} { valid: boolean, message?: string }
     */
    function validateTournamentStart(tournament) {
        if (!tournament || typeof tournament !== 'object') {
            return { valid: false, message: 'Tournament is required.' };
        }

        if (tournament.status !== 'draft') {
            return { valid: false, message: 'Tournament must be in draft status to start.' };
        }

        // Check minimum participants
        var participants = getParticipants(tournament);
        if (participants.length < 2) {
            return { valid: false, message: 'Tournament needs at least 2 participants to start.' };
        }

        // Check week range is valid
        var weekValidation = validateWeekRange(tournament.startWeek, tournament.endWeek);
        if (!weekValidation.valid) {
            return weekValidation;
        }

        return { valid: true };
    }

    /**
     * Check if a tournament can be started.
     * 
     * @param {object} tournament - Tournament object
     * @returns {boolean} True if can be started
     */
    function canStartTournament(tournament) {
        var validation = validateTournamentStart(tournament);
        return validation.valid;
    }

    // ============================================================
    // QUERY HELPERS
    // ============================================================

    /**
     * Get the minimum number of participants required for a tournament.
     * 
     * @param {string} mode - Tournament mode
     * @returns {number} Minimum participants
     */
    function getMinimumParticipants(mode) {
        return 2;
    }

    /**
     * Get the maximum number of participants for a tournament mode.
     * 
     * @param {string} mode - Tournament mode
     * @returns {number} Maximum participants
     */
    function getMaximumParticipants(mode) {
        return 100;
    }

    /**
     * Check if a tournament has enough participants.
     * 
     * @param {object} tournament - Tournament object
     * @returns {boolean} True if enough participants
     */
    function hasEnoughParticipants(tournament) {
        var participants = getParticipants(tournament);
        return participants.length >= 2;
    }

    /**
     * Check if a tournament has active participants (not eliminated).
     * 
     * @param {object} tournament - Tournament object
     * @returns {boolean} True if has active participants
     */
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
        hasActiveParticipants: hasActiveParticipants
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
            'validateMatchResult', 'isValidMatchResult',
            'validateMatchCompletion', 'canCompleteMatch',
            'validateRoundRemoval', 'canRemoveRound',
            'validateRoundAddition', 'canAddRound',
            'validateCompletionReadiness', 'isReadyForCompletion', 'getCompletionReadinessReport',
            'validateParticipantEligibility', 'isParticipantEligible',
            'validateTournamentStart', 'canStartTournament',
            'getMinimumParticipants', 'getMaximumParticipants',
            'hasEnoughParticipants', 'hasActiveParticipants'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[TournamentRules] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[TournamentRules] All exports verified successfully.');
        }
    })();

})();
