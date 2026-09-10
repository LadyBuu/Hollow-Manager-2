/**
 * modules/tournaments/tournaments-matches.js - Tournament Match Operations
 * CANONICAL match mutation API for tournaments.
 * Path: js/modules/tournaments/tournaments-matches.js
 * 
 * This module provides:
 *   - Match CRUD operations (create, update, delete)
 *   - Match completion
 *   - Match winner and group exam result management
 *   - Internal pure builders for Core.addRound
 * 
 * IMPORTANT:
 *   - This module owns match-level mutations
 *   - Uses MutationPipeline for persistence, rollback, and activity logging
 *   - Public commands are wrapped with MutationPipeline
 *   - Internal pure builders are used by Core.addRound
 *   - Does NOT call saveData() directly
 *   - Does NOT log activity directly
 *   - Does NOT render or notify
 *   - Invalid inputs are REJECTED (operation returns null/false)
 *   - Mutations are ATOMIC: if any part is invalid, nothing changes
 *   - Returns DEFENSIVE COPIES of mutated objects
 * 
 * PUBLIC COMMANDS (via MutationPipeline):
 *   - createMatch(tournamentId, roundIndex, matchData)
 *   - removeMatch(tournamentId, roundIndex, matchIndex)
 *   - updateMatch(tournamentId, roundIndex, matchIndex, updates)
 *   - completeMatch(tournamentId, roundIndex, matchIndex, result)
 *   - setMatchWinner(tournamentId, roundIndex, matchIndex, winnerId)
 *   - setGroupExamResult(tournamentId, roundIndex, matchIndex, participantId, result)
 * 
 * INTERNAL PURE BUILDERS (used by Core.addRound):
 *   - buildMatch(participants, roundConfig)
 *   - buildRound(roundData, participants)
 *   - buildProposedMatch(base, updates, tournament, round, options)
 * 
 * LIFECYCLE RULES:
 *   - Only completeMatch() can transition a match to 'completed'
 *   - updateMatch() cannot change status to 'completed'
 *   - Pending matches may have a provisional winner (setMatchWinner)
 *   - Completion freezes the result
 *   - Results are only valid for group_exam matches
 *   - Type changes only allowed for pending matches with no winner/results
 * 
 * DEPENDENCIES:
 *   - window.TournamentConstants (from tournament-constants.js) - MANDATORY
 *   - window.TournamentSchema (from tournament-schema.js) - MANDATORY
 *   - window.TournamentLifecycle (from tournament-lifecycle.js) - MANDATORY
 *   - window.TournamentRules (from tournament-rules.js) - MANDATORY
 *   - window.TournamentQueries (from tournament-queries.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 * 
 * USAGE:
 *   var Matches = window.TournamentMatches;
 * 
 *   // Public commands (via MutationPipeline)
 *   var match = Matches.createMatch('tourn_123', 0, { participants: ['char_1', 'char_2'] });
 *   var updated = Matches.updateMatch('tourn_123', 0, 0, { winner: 'char_1' });
 *   var completed = Matches.completeMatch('tourn_123', 0, 0, { winner: 'char_1' });
 * 
 *   // Internal builders (used by Core.addRound)
 *   var round = Matches.buildRound({ matchSize: 2, matchType: 'standard' }, participants);
 */

(function() {
    'use strict';

    if (window.__TournamentMatchesLoaded) {
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

    function getLifecycle() {
        return window.TournamentLifecycle || null;
    }

    function getRules() {
        return window.TournamentRules || null;
    }

    function getQueries() {
        return window.TournamentQueries || null;
    }

    function getMutationPipeline() {
        return window.MutationPipeline || null;
    }

    function getObjectUtils() {
        return window.ObjectUtils || null;
    }

    function getIdUtils() {
        return window.IdUtils || null;
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
            missing.push('TournamentSchema (lazy)');
        }
        if (!getLifecycle()) {
            missing.push('TournamentLifecycle (lazy)');
        }
        if (!getRules()) {
            missing.push('TournamentRules (lazy)');
        }
        if (!getQueries()) {
            missing.push('TournamentQueries (lazy)');
        }
        if (!getMutationPipeline()) {
            missing.push('MutationPipeline (lazy)');
        }
        if (!getObjectUtils()) {
            missing.push('ObjectUtils (lazy)');
        }
        if (!getIdUtils()) {
            missing.push('IdUtils (lazy)');
        }

        if (missing.length > 0) {
            console.warn('[TournamentMatches] Some dependencies not yet loaded:', missing.join(', '));
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

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function normaliseId(value) {
        var IdUtils = getIdUtils();
        if (IdUtils && typeof IdUtils.normaliseId === 'function') {
            return IdUtils.normaliseId(value);
        }
        if (value === null || value === undefined) {
            return null;
        }
        var str = String(value).trim();
        return str !== '' ? str : null;
    }

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
        try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
    }

    function parsePositiveInteger(value) {
        if (value === undefined || value === null) {
            return null;
        }
        var num = parseInt(value, 10);
        if (isNaN(num) || num < 1) {
            return null;
        }
        return num;
    }

    function getDataStore() {
        return window.data || {};
    }

    function getTournamentById(tournamentId) {
        var Queries = getQueries();
        if (Queries && typeof Queries.getTournament === 'function') {
            return Queries.getTournament(tournamentId);
        }
        return null;
    }

    function getParticipants(tournamentId) {
        var Queries = getQueries();
        if (Queries && typeof Queries.getParticipants === 'function') {
            return Queries.getParticipants(tournamentId);
        }
        return [];
    }

    function getRounds(tournamentId) {
        var Queries = getQueries();
        if (Queries && typeof Queries.getRounds === 'function') {
            return Queries.getRounds(tournamentId);
        }
        return [];
    }

    function getMatch(tournamentId, roundIndex, matchIndex) {
        var Queries = getQueries();
        if (Queries && typeof Queries.getMatch === 'function') {
            return Queries.getMatch(tournamentId, roundIndex, matchIndex);
        }
        return null;
    }

    function isParticipantEliminated(tournamentId, participantId) {
        var Queries = getQueries();
        if (Queries && typeof Queries.isParticipantEliminated === 'function') {
            return Queries.isParticipantEliminated(tournamentId, participantId);
        }
        return false;
    }

    function isParticipantInTournament(tournamentId, participantId) {
        var Queries = getQueries();
        if (Queries && typeof Queries.isParticipantInTournament === 'function') {
            return Queries.isParticipantInTournament(tournamentId, participantId);
        }
        return false;
    }

    function getParticipantType(tournamentId, participantId) {
        var Queries = getQueries();
        if (Queries && typeof Queries.getParticipantTypeFromRecord === 'function') {
            return Queries.getParticipantTypeFromRecord(tournamentId, participantId);
        }
        return null;
    }

    function getCanonicalParticipantType(mode) {
        var Constants = getConstants();
        if (Constants && typeof Constants.getCanonicalParticipantType === 'function') {
            return Constants.getCanonicalParticipantType(mode);
        }
        return mode === 'teams' ? 'team' : 'character';
    }

    function validateMatchParticipants(tournamentId, participantIds) {
        if (!Array.isArray(participantIds) || participantIds.length < 2) {
            return { valid: false, message: 'At least 2 participants required.' };
        }

        var seen = {};
        var tournament = getTournamentById(tournamentId);
        if (!tournament) {
            return { valid: false, message: 'Tournament not found.' };
        }

        var expectedType = getCanonicalParticipantType(tournament.mode);

        for (var i = 0; i < participantIds.length; i++) {
            var id = normaliseId(participantIds[i]);
            if (id === null) {
                return { valid: false, message: 'Invalid participant ID: ' + participantIds[i] };
            }
            if (seen[id]) {
                return { valid: false, message: 'Duplicate participant: ' + id };
            }
            seen[id] = true;

            if (!isParticipantInTournament(tournamentId, id)) {
                return { valid: false, message: 'Participant not in tournament: ' + id };
            }

            if (isParticipantEliminated(tournamentId, id)) {
                return { valid: false, message: 'Participant is eliminated: ' + id };
            }

            var actualType = getParticipantType(tournamentId, id);
            if (actualType && actualType !== expectedType) {
                return { valid: false, message: 'Participant type mismatch for ' + id + '. Expected ' + expectedType + ', got ' + actualType };
            }
        }

        return { valid: true };
    }

    function validateMatchResultParticipants(participants, results) {
        if (!results || typeof results !== 'object') {
            return true;
        }

        var participantIds = participants.map(normaliseId).filter(function(id) {
            return id !== null;
        });

        var keys = Object.keys(results);
        for (var i = 0; i < keys.length; i++) {
            var id = normaliseId(keys[i]);
            if (id === null) {
                return false;
            }
            if (participantIds.indexOf(id) === -1) {
                return false;
            }
        }
        return true;
    }

    function deriveLoser(participants, winner) {
        var Schema = getSchema();
        if (Schema && typeof Schema.deriveLoser === 'function') {
            return Schema.deriveLoser(participants, winner);
        }
        if (!Array.isArray(participants) || participants.length !== 2) {
            return null;
        }
        if (!winner) {
            return null;
        }
        var winnerId = normaliseId(winner);
        if (winnerId === null) {
            return null;
        }
        for (var i = 0; i < participants.length; i++) {
            var id = normaliseId(participants[i]);
            if (id !== null && id !== winnerId) {
                return id;
            }
        }
        return null;
    }

    function deriveAdvancing(match) {
        var Schema = getSchema();
        if (Schema && typeof Schema.deriveAdvancing === 'function') {
            return Schema.deriveAdvancing(match);
        }
        if (match.type === 'standard') {
            if (match.winner) {
                var winnerId = normaliseId(match.winner);
                return winnerId !== null ? [winnerId] : [];
            }
            return [];
        }
        if (match.type === 'group_exam') {
            var advancing = [];
            var participants = Array.isArray(match.participants) ? match.participants : [];
            for (var i = 0; i < participants.length; i++) {
                var id = normaliseId(participants[i]);
                if (id !== null && match.results && match.results[id] === 'pass') {
                    advancing.push(id);
                }
            }
            return advancing;
        }
        return [];
    }

    function normaliseIdArrayStrict(ids) {
        if (!Array.isArray(ids)) {
            return null;
        }
        var result = [];
        var seen = {};
        for (var i = 0; i < ids.length; i++) {
            var normalised = normaliseId(ids[i]);
            if (normalised === null) {
                return null;
            }
            if (seen[normalised]) {
                return null;
            }
            seen[normalised] = true;
            result.push(normalised);
        }
        return result;
    }

    function normaliseResultsStrict(results) {
        if (!isObject(results)) {
            return null;
        }
        var Constants = getConstants();
        var validResults = Constants ? Constants.VALID_GROUP_EXAM_RESULTS : ['pass', 'fail'];

        var normalised = {};
        var keys = Object.keys(results);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var id = normaliseId(key);
            if (id === null) {
                return null;
            }
            var value = results[key];
            if (validResults.indexOf(value) === -1) {
                return null;
            }
            normalised[id] = value;
        }
        return normalised;
    }

    function hasOnlyAllowedKeys(object, allowedKeys) {
        var keys = Object.keys(object);
        for (var i = 0; i < keys.length; i++) {
            if (allowedKeys.indexOf(keys[i]) === -1) {
                return false;
            }
        }
        return true;
    }

    function isTypeChangeAllowed(base) {
        if (!base) {
            return false;
        }
        if (base.status !== 'pending') {
            return false;
        }
        if (base.winner) {
            return false;
        }
        if (base.results && Object.keys(base.results).length > 0) {
            return false;
        }
        return true;
    }

    // ============================================================
    // INTERNAL PURE BUILDERS - Used by Core.addRound
    // ============================================================

    /**
     * Build a match object from participants and round configuration.
     * This is an INTERNAL PURE builder used by Core.addRound.
     * 
     * @param {array} participants - Array of participant IDs
     * @param {object} roundConfig - Round configuration { matchSize, matchType }
     * @returns {object} Match object
     */
    function buildMatch(participants, roundConfig) {
        roundConfig = roundConfig || {};

        var matchSize = roundConfig.matchSize || 2;
        var matchType = roundConfig.matchType || 'standard';

        var matchParticipants = Array.isArray(participants) ? participants.slice() : [];

        return {
            participants: matchParticipants,
            type: matchType,
            status: 'pending',
            winner: null,
            loser: null,
            advancing: [],
            results: {}
        };
    }

    /**
     * Build a complete round from round data and participants.
     * This is an INTERNAL PURE builder used by Core.addRound.
     * 
     * @param {object} roundData - Round data { matchSize, matchType, roundNumber }
     * @param {array} participants - Array of participant IDs
     * @returns {object} Round object
     */
    function buildRound(roundData, participants) {
        var matchSize = roundData.matchSize || 2;
        var matchType = roundData.matchType || 'standard';
        var roundNumber = roundData.roundNumber || 1;

        var matches = [];
        var participantList = Array.isArray(participants) ? participants.slice() : [];

        if (participantList.length > 0) {
            var match = buildMatch(participantList, { matchSize: matchSize, matchType: matchType });
            matches.push(match);
        }

        return {
            roundNumber: roundNumber,
            status: 'pending',
            matchSize: matchSize,
            matchType: matchType,
            matches: matches
        };
    }

    /**
     * Build a complete proposed match state.
     * This is the SINGLE canonical match construction function.
     * Used by ALL match creation/update/completion operations.
     * 
     * @param {object} base - Existing match state
     * @param {object} updates - Updates to apply
     * @param {object} tournament - Tournament object
     * @param {object} round - Round object
     * @param {object} options - Build options
     * @param {boolean} options.allowCompletion - Whether completion is allowed
     * @returns {object|null} Proposed match or null
     */
    function buildProposedMatch(base, updates, tournament, round, options) {
        options = options || {};
        var allowCompletion = options.allowCompletion === true;

        var allowedKeys = ['participants', 'type', 'status', 'winner', 'results'];
        if (!hasOnlyAllowedKeys(updates, allowedKeys)) {
            return null;
        }

        var normalisedUpdates = {};

        if (updates.participants !== undefined) {
            var participants = normaliseIdArrayStrict(updates.participants);
            if (participants === null) {
                return null;
            }
            normalisedUpdates.participants = participants;
        }

        var proposedType = updates.type !== undefined
            ? updates.type
            : (base.type || round.matchType || 'standard');

        if (updates.type !== undefined && updates.type !== base.type) {
            if (!isTypeChangeAllowed(base)) {
                return null;
            }
            var Constants = getConstants();
            var validTypes = Constants ? Constants.VALID_MATCH_TYPES : ['standard', 'group_exam'];
            if (validTypes.indexOf(proposedType) === -1) {
                return null;
            }
        }

        normalisedUpdates.type = proposedType;

        var currentStatus = base.status || 'pending';
        var newStatus = updates.status !== undefined ? updates.status : currentStatus;

        if (newStatus === 'completed' && currentStatus !== 'completed') {
            if (!allowCompletion) {
                return null;
            }
        }

        if (updates.status !== undefined && updates.status !== currentStatus) {
            var validStatuses = ['pending', 'in_progress', 'completed'];
            if (validStatuses.indexOf(updates.status) === -1) {
                return null;
            }
            if (updates.status === 'completed' && currentStatus !== 'completed') {
                if (!allowCompletion) {
                    return null;
                }
            }
            normalisedUpdates.status = updates.status;
        }

        if (updates.results !== undefined && proposedType !== 'group_exam') {
            return null;
        }

        if (updates.winner !== undefined) {
            if (updates.winner === null) {
                normalisedUpdates.winner = null;
            } else {
                var winner = normaliseId(updates.winner);
                if (winner === null) {
                    return null;
                }
                normalisedUpdates.winner = winner;
            }
        }

        if (updates.results !== undefined) {
            if (updates.results === null || updates.results === undefined) {
                normalisedUpdates.results = {};
            } else {
                var results = normaliseResultsStrict(updates.results);
                if (results === null) {
                    return null;
                }
                normalisedUpdates.results = results;
            }
        }

        var proposed = {
            participants: normalisedUpdates.participants !== undefined
                ? normalisedUpdates.participants
                : (base.participants ? base.participants.slice() : []),
            type: normalisedUpdates.type,
            status: normalisedUpdates.status !== undefined
                ? normalisedUpdates.status
                : (base.status !== undefined ? base.status : 'pending'),
            winner: normalisedUpdates.winner !== undefined
                ? normalisedUpdates.winner
                : (base.winner !== undefined ? base.winner : null),
            loser: null,
            advancing: [],
            results: normalisedUpdates.results !== undefined
                ? normalisedUpdates.results
                : (base.results ? Object.assign({}, base.results) : {})
        };

        var matchSize = round.matchSize || 2;
        if (proposed.participants.length !== matchSize) {
            return null;
        }

        if (proposed.type === 'group_exam') {
            if (normalisedUpdates.winner !== undefined && normalisedUpdates.winner !== null) {
                return null;
            }
            if (base.winner !== undefined && base.winner !== null && !updates.winner) {
                return null;
            }
            proposed.winner = null;
            proposed.loser = null;
        }

        if (proposed.winner !== null) {
            if (proposed.participants.indexOf(proposed.winner) === -1) {
                return null;
            }
            var expectedType = tournament.mode === 'teams' ? 'team' : 'character';
            var Rules = getRules();
            if (Rules && typeof Rules.isParticipantEligible === 'function') {
                if (!Rules.isParticipantEligible(tournament, proposed.winner, expectedType)) {
                    return null;
                }
            }
        }

        var expectedType = tournament.mode === 'teams' ? 'team' : 'character';
        var valid = true;
        for (var i = 0; i < proposed.participants.length; i++) {
            var id = proposed.participants[i];
            var Rules = getRules();
            if (Rules && typeof Rules.isParticipantEligible === 'function') {
                if (!Rules.isParticipantEligible(tournament, id, expectedType)) {
                    valid = false;
                    break;
                }
            }
        }

        if (!valid) {
            return null;
        }

        if (!validateMatchResultParticipants(proposed.participants, proposed.results)) {
            return null;
        }

        if (proposed.type === 'standard' && proposed.participants.length === 2) {
            if (proposed.winner) {
                proposed.loser = deriveLoser(proposed.participants, proposed.winner);
            } else {
                proposed.loser = null;
            }
        }

        proposed.advancing = deriveAdvancing(proposed);

        return proposed;
    }

    /**
     * Validate a complete proposed match state.
     * 
     * @param {object} proposed - Proposed match state
     * @param {object} tournament - Tournament object
     * @param {object} round - Round object
     * @param {number} matchIndex - Match index (-1 for new matches)
     * @returns {object} { valid: boolean, errors: array }
     */
    function validateProposedMatch(proposed, tournament, round, matchIndex) {
        var errors = [];

        if (round.status === 'completed') {
            errors.push('Cannot modify matches in a completed round.');
            return { valid: false, errors: errors };
        }

        if (matchIndex >= 0) {
            var existingMatch = null;
            if (Array.isArray(round.matches) && matchIndex < round.matches.length) {
                existingMatch = round.matches[matchIndex];
            }
            if (existingMatch && existingMatch.status === 'completed') {
                errors.push('Cannot modify a completed match.');
                return { valid: false, errors: errors };
            }
        }

        var Schema = getSchema();
        if (Schema && typeof Schema.validateMatch === 'function') {
            var schemaResult = Schema.validateMatch(proposed, tournament, true, round);
            if (!schemaResult.valid) {
                schemaResult.errors.forEach(function(err) {
                    errors.push(err);
                });
            }
        } else {
            errors.push('Schema not available for validation.');
        }

        return { valid: errors.length === 0, errors: errors };
    }

    // ============================================================
    // MUTATION PIPELINE WRAPPER
    // ============================================================

    /**
     * Execute a match mutation through MutationPipeline.
     * 
     * @param {object} config - Mutation configuration
     * @param {string} config.logMessage - Activity log message
     * @param {string} config.successMessage - Success notification message
     * @param {string} config.failureMessage - Failure notification message
     * @param {function} config.validate - Validation function
     * @param {function} config.mutate - Mutation function
     * @param {function} config.onSuccess - Success callback
     * @param {function} config.onFailure - Failure callback
     * @returns {Promise<object>} { success: boolean, data?: any, message?: string }
     */
    function executeMutation(config) {
        var Pipeline = getMutationPipeline();
        if (!Pipeline || typeof Pipeline.performMutation !== 'function') {
            return Promise.resolve({
                success: false,
                message: 'MutationPipeline not available.'
            });
        }

        return Pipeline.performMutation({
            validate: config.validate || function(data) {
                return { valid: true };
            },
            mutate: config.mutate,
            logMessage: config.logMessage || 'Match operation performed.',
            successMessage: config.successMessage || 'Match operation completed.',
            failureMessage: config.failureMessage || 'Match operation failed.',
            onSuccess: config.onSuccess || null,
            onFailure: config.onFailure || null
        });
    }

    // ============================================================
    // PUBLIC COMMANDS
    // ============================================================

    /**
     * Create a match in a round.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of the round
     * @param {object} matchData - Match data { participants, type }
     * @returns {Promise<object>} { success: boolean, data?: object, message?: string }
     */
    function createMatch(tournamentId, roundIndex, matchData) {
        if (!isObject(matchData)) {
            return Promise.resolve({
                success: false,
                message: 'Invalid match data.'
            });
        }

        // Validate inputs before pipeline
        var tournament = getTournamentById(tournamentId);
        if (!tournament) {
            return Promise.resolve({
                success: false,
                message: 'Tournament not found.'
            });
        }

        var rounds = getRounds(tournamentId);
        if (roundIndex < 0 || roundIndex >= rounds.length) {
            return Promise.resolve({
                success: false,
                message: 'Round not found.'
            });
        }

        var round = rounds[roundIndex];
        if (!round || typeof round !== 'object') {
            return Promise.resolve({
                success: false,
                message: 'Round not found.'
            });
        }

        if (round.status === 'completed') {
            return Promise.resolve({
                success: false,
                message: 'Cannot add matches to a completed round.'
            });
        }

        // Validate participants
        var participants = matchData.participants || [];
        var validation = validateMatchParticipants(tournamentId, participants);
        if (!validation.valid) {
            return Promise.resolve({
                success: false,
                message: validation.message
            });
        }

        // Build base match
        var base = {
            participants: [],
            type: round.matchType || 'standard',
            status: 'pending',
            winner: null,
            loser: null,
            advancing: [],
            results: {}
        };

        var proposedMatch = buildProposedMatch(base, matchData, tournament, round);
        if (proposedMatch === null) {
            return Promise.resolve({
                success: false,
                message: 'Failed to build match.'
            });
        }

        var validationResult = validateProposedMatch(proposedMatch, tournament, round, -1);
        if (!validationResult.valid) {
            return Promise.resolve({
                success: false,
                message: validationResult.errors.join('; ')
            });
        }

        var matchCopy = deepClone(proposedMatch);
        var roundIndexCopy = parseInt(roundIndex, 10);

        return executeMutation({
            validate: function(data) {
                // Re-validate within transaction
                var currentTournament = getTournamentById(tournamentId);
                if (!currentTournament) {
                    return { valid: false, message: 'Tournament no longer exists.' };
                }

                var currentRounds = getRounds(tournamentId);
                if (roundIndexCopy < 0 || roundIndexCopy >= currentRounds.length) {
                    return { valid: false, message: 'Round no longer exists.' };
                }

                var currentRound = currentRounds[roundIndexCopy];
                if (currentRound.status === 'completed') {
                    return { valid: false, message: 'Round is completed.' };
                }

                return { valid: true };
            },
            mutate: function(data) {
                var targetTournament = null;
                for (var i = 0; i < data.tournaments.length; i++) {
                    if (data.tournaments[i] && normaliseId(data.tournaments[i].id) === normaliseId(tournamentId)) {
                        targetTournament = data.tournaments[i];
                        break;
                    }
                }

                if (!targetTournament) {
                    throw new Error('Tournament not found in data store.');
                }

                if (!Array.isArray(targetTournament.rounds) || roundIndexCopy >= targetTournament.rounds.length) {
                    throw new Error('Round not found in data store.');
                }

                var targetRound = targetTournament.rounds[roundIndexCopy];
                if (!Array.isArray(targetRound.matches)) {
                    targetRound.matches = [];
                }

                targetRound.matches.push(matchCopy);

                return { match: matchCopy };
            },
            logMessage: 'Added match to round ' + (roundIndexCopy + 1),
            successMessage: 'Match added successfully.',
            failureMessage: 'Failed to add match.'
        });
    }

    /**
     * Remove a match from a round.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of the round
     * @param {number} matchIndex - Index of the match to remove
     * @returns {Promise<object>} { success: boolean, message?: string }
     */
    function removeMatch(tournamentId, roundIndex, matchIndex) {
        var roundIndexCopy = parseInt(roundIndex, 10);
        var matchIndexCopy = parseInt(matchIndex, 10);

        var tournament = getTournamentById(tournamentId);
        if (!tournament) {
            return Promise.resolve({
                success: false,
                message: 'Tournament not found.'
            });
        }

        var rounds = getRounds(tournamentId);
        if (roundIndexCopy < 0 || roundIndexCopy >= rounds.length) {
            return Promise.resolve({
                success: false,
                message: 'Round not found.'
            });
        }

        var round = rounds[roundIndexCopy];
        if (!round || typeof round !== 'object') {
            return Promise.resolve({
                success: false,
                message: 'Round not found.'
            });
        }

        if (round.status === 'completed') {
            return Promise.resolve({
                success: false,
                message: 'Cannot remove matches from a completed round.'
            });
        }

        if (!Array.isArray(round.matches) || matchIndexCopy < 0 || matchIndexCopy >= round.matches.length) {
            return Promise.resolve({
                success: false,
                message: 'Match not found.'
            });
        }

        var match = round.matches[matchIndexCopy];
        if (!match) {
            return Promise.resolve({
                success: false,
                message: 'Match not found.'
            });
        }

        if (match.status === 'completed') {
            return Promise.resolve({
                success: false,
                message: 'Cannot remove a completed match.'
            });
        }

        return executeMutation({
            validate: function(data) {
                var currentTournament = getTournamentById(tournamentId);
                if (!currentTournament) {
                    return { valid: false, message: 'Tournament no longer exists.' };
                }

                var currentRounds = getRounds(tournamentId);
                if (roundIndexCopy < 0 || roundIndexCopy >= currentRounds.length) {
                    return { valid: false, message: 'Round no longer exists.' };
                }

                var currentRound = currentRounds[roundIndexCopy];
                if (currentRound.status === 'completed') {
                    return { valid: false, message: 'Round is completed.' };
                }

                if (!Array.isArray(currentRound.matches) || matchIndexCopy >= currentRound.matches.length) {
                    return { valid: false, message: 'Match no longer exists.' };
                }

                var currentMatch = currentRound.matches[matchIndexCopy];
                if (currentMatch && currentMatch.status === 'completed') {
                    return { valid: false, message: 'Match is completed.' };
                }

                return { valid: true };
            },
            mutate: function(data) {
                var targetTournament = null;
                for (var i = 0; i < data.tournaments.length; i++) {
                    if (data.tournaments[i] && normaliseId(data.tournaments[i].id) === normaliseId(tournamentId)) {
                        targetTournament = data.tournaments[i];
                        break;
                    }
                }

                if (!targetTournament) {
                    throw new Error('Tournament not found in data store.');
                }

                if (!Array.isArray(targetTournament.rounds) || roundIndexCopy >= targetTournament.rounds.length) {
                    throw new Error('Round not found in data store.');
                }

                var targetRound = targetTournament.rounds[roundIndexCopy];
                if (!Array.isArray(targetRound.matches) || matchIndexCopy >= targetRound.matches.length) {
                    throw new Error('Match not found in data store.');
                }

                targetRound.matches.splice(matchIndexCopy, 1);

                return { removed: true };
            },
            logMessage: 'Removed match from round ' + (roundIndexCopy + 1),
            successMessage: 'Match removed successfully.',
            failureMessage: 'Failed to remove match.'
        });
    }

    /**
     * Update a match.
     * NOTE: Cannot change status to 'completed'. Use completeMatch() for that.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of the round
     * @param {number} matchIndex - Index of the match to update
     * @param {object} updates - Updates to apply
     * @returns {Promise<object>} { success: boolean, data?: object, message?: string }
     */
    function updateMatch(tournamentId, roundIndex, matchIndex, updates) {
        if (!isObject(updates)) {
            return Promise.resolve({
                success: false,
                message: 'Invalid updates.'
            });
        }

        var roundIndexCopy = parseInt(roundIndex, 10);
        var matchIndexCopy = parseInt(matchIndex, 10);

        var tournament = getTournamentById(tournamentId);
        if (!tournament) {
            return Promise.resolve({
                success: false,
                message: 'Tournament not found.'
            });
        }

        var rounds = getRounds(tournamentId);
        if (roundIndexCopy < 0 || roundIndexCopy >= rounds.length) {
            return Promise.resolve({
                success: false,
                message: 'Round not found.'
            });
        }

        var round = rounds[roundIndexCopy];
        if (!round || typeof round !== 'object') {
            return Promise.resolve({
                success: false,
                message: 'Round not found.'
            });
        }

        if (round.status === 'completed') {
            return Promise.resolve({
                success: false,
                message: 'Cannot modify matches in a completed round.'
            });
        }

        if (!Array.isArray(round.matches) || matchIndexCopy < 0 || matchIndexCopy >= round.matches.length) {
            return Promise.resolve({
                success: false,
                message: 'Match not found.'
            });
        }

        var match = round.matches[matchIndexCopy];
        if (!match || typeof match !== 'object') {
            return Promise.resolve({
                success: false,
                message: 'Match not found.'
            });
        }

        if (match.status === 'completed') {
            return Promise.resolve({
                success: false,
                message: 'Cannot modify a completed match.'
            });
        }

        // Check if trying to set status to completed
        if (updates.status === 'completed') {
            return Promise.resolve({
                success: false,
                message: 'Use completeMatch() to complete a match.'
            });
        }

        var proposedMatch = buildProposedMatch(match, updates, tournament, round);
        if (proposedMatch === null) {
            return Promise.resolve({
                success: false,
                message: 'Invalid updates.'
            });
        }

        var validationResult = validateProposedMatch(proposedMatch, tournament, round, matchIndexCopy);
        if (!validationResult.valid) {
            return Promise.resolve({
                success: false,
                message: validationResult.errors.join('; ')
            });
        }

        var updatedMatch = deepClone(proposedMatch);

        return executeMutation({
            validate: function(data) {
                var currentTournament = getTournamentById(tournamentId);
                if (!currentTournament) {
                    return { valid: false, message: 'Tournament no longer exists.' };
                }

                var currentRounds = getRounds(tournamentId);
                if (roundIndexCopy < 0 || roundIndexCopy >= currentRounds.length) {
                    return { valid: false, message: 'Round no longer exists.' };
                }

                var currentRound = currentRounds[roundIndexCopy];
                if (currentRound.status === 'completed') {
                    return { valid: false, message: 'Round is completed.' };
                }

                if (!Array.isArray(currentRound.matches) || matchIndexCopy >= currentRound.matches.length) {
                    return { valid: false, message: 'Match no longer exists.' };
                }

                var currentMatch = currentRound.matches[matchIndexCopy];
                if (currentMatch && currentMatch.status === 'completed') {
                    return { valid: false, message: 'Match is completed.' };
                }

                return { valid: true };
            },
            mutate: function(data) {
                var targetTournament = null;
                for (var i = 0; i < data.tournaments.length; i++) {
                    if (data.tournaments[i] && normaliseId(data.tournaments[i].id) === normaliseId(tournamentId)) {
                        targetTournament = data.tournaments[i];
                        break;
                    }
                }

                if (!targetTournament) {
                    throw new Error('Tournament not found in data store.');
                }

                if (!Array.isArray(targetTournament.rounds) || roundIndexCopy >= targetTournament.rounds.length) {
                    throw new Error('Round not found in data store.');
                }

                var targetRound = targetTournament.rounds[roundIndexCopy];
                if (!Array.isArray(targetRound.matches) || matchIndexCopy >= targetRound.matches.length) {
                    throw new Error('Match not found in data store.');
                }

                var targetMatch = targetRound.matches[matchIndexCopy];
                var keys = ['participants', 'type', 'status', 'winner', 'loser', 'advancing', 'results'];
                for (var j = 0; j < keys.length; j++) {
                    var key = keys[j];
                    if (JSON.stringify(targetMatch[key]) !== JSON.stringify(updatedMatch[key])) {
                        targetMatch[key] = updatedMatch[key];
                    }
                }

                return { match: targetMatch };
            },
            logMessage: 'Updated match in round ' + (roundIndexCopy + 1),
            successMessage: 'Match updated successfully.',
            failureMessage: 'Failed to update match.'
        });
    }

    /**
     * Complete a match.
     * This is the ONLY way to transition a match to 'completed' status.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of the round
     * @param {number} matchIndex - Index of the match to complete
     * @param {object} result - Result { winner } for standard matches, { results } for group exam
     * @returns {Promise<object>} { success: boolean, data?: object, message?: string }
     */
    function completeMatch(tournamentId, roundIndex, matchIndex, result) {
        if (!isObject(result)) {
            return Promise.resolve({
                success: false,
                message: 'Invalid result.'
            });
        }

        var roundIndexCopy = parseInt(roundIndex, 10);
        var matchIndexCopy = parseInt(matchIndex, 10);

        var tournament = getTournamentById(tournamentId);
        if (!tournament) {
            return Promise.resolve({
                success: false,
                message: 'Tournament not found.'
            });
        }

        var rounds = getRounds(tournamentId);
        if (roundIndexCopy < 0 || roundIndexCopy >= rounds.length) {
            return Promise.resolve({
                success: false,
                message: 'Round not found.'
            });
        }

        var round = rounds[roundIndexCopy];
        if (!round || typeof round !== 'object') {
            return Promise.resolve({
                success: false,
                message: 'Round not found.'
            });
        }

        if (round.status === 'completed') {
            return Promise.resolve({
                success: false,
                message: 'Cannot modify matches in a completed round.'
            });
        }

        if (!Array.isArray(round.matches) || matchIndexCopy < 0 || matchIndexCopy >= round.matches.length) {
            return Promise.resolve({
                success: false,
                message: 'Match not found.'
            });
        }

        var match = round.matches[matchIndexCopy];
        if (!match || typeof match !== 'object') {
            return Promise.resolve({
                success: false,
                message: 'Match not found.'
            });
        }

        if (match.status === 'completed') {
            return Promise.resolve({
                success: false,
                message: 'Match is already completed.'
            });
        }

        // Validate match completion using Rules
        var Rules = getRules();
        if (Rules && typeof Rules.validateMatchCompletion === 'function') {
            var completionValidation = Rules.validateMatchCompletion(match, result);
            if (!completionValidation.valid) {
                return Promise.resolve({
                    success: false,
                    message: completionValidation.message
                });
            }
        }

        // Build updates
        var updates = { status: 'completed' };

        if (match.type === 'standard') {
            if (!result.winner) {
                return Promise.resolve({
                    success: false,
                    message: 'Winner is required for standard match.'
                });
            }
            var winnerNormalised = normaliseId(result.winner);
            if (winnerNormalised === null) {
                return Promise.resolve({
                    success: false,
                    message: 'Invalid winner ID.'
                });
            }
            if (match.participants.indexOf(winnerNormalised) === -1) {
                return Promise.resolve({
                    success: false,
                    message: 'Winner must be a participant in the match.'
                });
            }
            var expectedType = tournament.mode === 'teams' ? 'team' : 'character';
            if (Rules && typeof Rules.isParticipantEligible === 'function') {
                if (!Rules.isParticipantEligible(tournament, winnerNormalised, expectedType)) {
                    return Promise.resolve({
                        success: false,
                        message: 'Winner is not eligible.'
                    });
                }
            }
            updates.winner = winnerNormalised;
        }

        if (match.type === 'group_exam') {
            if (!result.results || !isObject(result.results) || Object.keys(result.results).length === 0) {
                return Promise.resolve({
                    success: false,
                    message: 'Results are required for group exam match.'
                });
            }
            var normalisedResults = normaliseResultsStrict(result.results);
            if (normalisedResults === null) {
                return Promise.resolve({
                    success: false,
                    message: 'Invalid results.'
                });
            }
            for (var i = 0; i < match.participants.length; i++) {
                if (!normalisedResults[match.participants[i]]) {
                    return Promise.resolve({
                        success: false,
                        message: 'Missing result for participant: ' + match.participants[i]
                    });
                }
            }
            if (!validateMatchResultParticipants(match.participants, normalisedResults)) {
                return Promise.resolve({
                    success: false,
                    message: 'Invalid results.'
                });
            }
            updates.results = normalisedResults;
        }

        var proposedMatch = buildProposedMatch(match, updates, tournament, round, {
            allowCompletion: true
        });
        if (proposedMatch === null) {
            return Promise.resolve({
                success: false,
                message: 'Failed to build completed match.'
            });
        }

        var validationResult = validateProposedMatch(proposedMatch, tournament, round, matchIndexCopy);
        if (!validationResult.valid) {
            return Promise.resolve({
                success: false,
                message: validationResult.errors.join('; ')
            });
        }

        var completedMatch = deepClone(proposedMatch);

        return executeMutation({
            validate: function(data) {
                var currentTournament = getTournamentById(tournamentId);
                if (!currentTournament) {
                    return { valid: false, message: 'Tournament no longer exists.' };
                }

                var currentRounds = getRounds(tournamentId);
                if (roundIndexCopy < 0 || roundIndexCopy >= currentRounds.length) {
                    return { valid: false, message: 'Round no longer exists.' };
                }

                var currentRound = currentRounds[roundIndexCopy];
                if (currentRound.status === 'completed') {
                    return { valid: false, message: 'Round is completed.' };
                }

                if (!Array.isArray(currentRound.matches) || matchIndexCopy >= currentRound.matches.length) {
                    return { valid: false, message: 'Match no longer exists.' };
                }

                var currentMatch = currentRound.matches[matchIndexCopy];
                if (currentMatch && currentMatch.status === 'completed') {
                    return { valid: false, message: 'Match is already completed.' };
                }

                return { valid: true };
            },
            mutate: function(data) {
                var targetTournament = null;
                for (var i = 0; i < data.tournaments.length; i++) {
                    if (data.tournaments[i] && normaliseId(data.tournaments[i].id) === normaliseId(tournamentId)) {
                        targetTournament = data.tournaments[i];
                        break;
                    }
                }

                if (!targetTournament) {
                    throw new Error('Tournament not found in data store.');
                }

                if (!Array.isArray(targetTournament.rounds) || roundIndexCopy >= targetTournament.rounds.length) {
                    throw new Error('Round not found in data store.');
                }

                var targetRound = targetTournament.rounds[roundIndexCopy];
                if (!Array.isArray(targetRound.matches) || matchIndexCopy >= targetRound.matches.length) {
                    throw new Error('Match not found in data store.');
                }

                var targetMatch = targetRound.matches[matchIndexCopy];
                var keys = ['participants', 'type', 'status', 'winner', 'loser', 'advancing', 'results'];
                for (var j = 0; j < keys.length; j++) {
                    var key = keys[j];
                    targetMatch[key] = completedMatch[key];
                }

                return { match: targetMatch };
            },
            logMessage: 'Completed match in round ' + (roundIndexCopy + 1),
            successMessage: 'Match completed successfully.',
            failureMessage: 'Failed to complete match.'
        });
    }

    /**
     * Set a group exam result.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of the round
     * @param {number} matchIndex - Index of the match
     * @param {string} participantId - Participant ID
     * @param {string} result - 'pass' or 'fail'
     * @returns {Promise<object>} { success: boolean, data?: object, message?: string }
     */
    function setGroupExamResult(tournamentId, roundIndex, matchIndex, participantId, resultValue) {
        var participantNormalised = normaliseId(participantId);
        if (participantNormalised === null) {
            return Promise.resolve({
                success: false,
                message: 'Invalid participant ID.'
            });
        }

        var Constants = getConstants();
        var validResults = Constants ? Constants.VALID_GROUP_EXAM_RESULTS : ['pass', 'fail'];
        if (validResults.indexOf(resultValue) === -1) {
            return Promise.resolve({
                success: false,
                message: 'Invalid result. Must be "pass" or "fail".'
            });
        }

        var roundIndexCopy = parseInt(roundIndex, 10);
        var matchIndexCopy = parseInt(matchIndex, 10);

        var tournament = getTournamentById(tournamentId);
        if (!tournament) {
            return Promise.resolve({
                success: false,
                message: 'Tournament not found.'
            });
        }

        var rounds = getRounds(tournamentId);
        if (roundIndexCopy < 0 || roundIndexCopy >= rounds.length) {
            return Promise.resolve({
                success: false,
                message: 'Round not found.'
            });
        }

        var round = rounds[roundIndexCopy];
        if (!round || typeof round !== 'object') {
            return Promise.resolve({
                success: false,
                message: 'Round not found.'
            });
        }

        if (round.status === 'completed') {
            return Promise.resolve({
                success: false,
                message: 'Cannot modify matches in a completed round.'
            });
        }

        if (!Array.isArray(round.matches) || matchIndexCopy < 0 || matchIndexCopy >= round.matches.length) {
            return Promise.resolve({
                success: false,
                message: 'Match not found.'
            });
        }

        var match = round.matches[matchIndexCopy];
        if (!match || typeof match !== 'object') {
            return Promise.resolve({
                success: false,
                message: 'Match not found.'
            });
        }

        if (match.type !== 'group_exam') {
            return Promise.resolve({
                success: false,
                message: 'Not a group exam match.'
            });
        }
        if (match.status === 'completed') {
            return Promise.resolve({
                success: false,
                message: 'Cannot modify a completed match.'
            });
        }

        if (match.participants.indexOf(participantNormalised) === -1) {
            return Promise.resolve({
                success: false,
                message: 'Participant not in this match.'
            });
        }

        var expectedType = tournament.mode === 'teams' ? 'team' : 'character';
        var Rules = getRules();
        if (Rules && typeof Rules.isParticipantEligible === 'function') {
            if (!Rules.isParticipantEligible(tournament, participantNormalised, expectedType)) {
                return Promise.resolve({
                    success: false,
                    message: 'Participant is not eligible.'
                });
            }
        }

        var updates = {
            results: Object.assign({}, match.results || {})
        };
        updates.results[participantNormalised] = resultValue;

        var proposedMatch = buildProposedMatch(match, updates, tournament, round);
        if (proposedMatch === null) {
            return Promise.resolve({
                success: false,
                message: 'Failed to update match.'
            });
        }

        var validationResult = validateProposedMatch(proposedMatch, tournament, round, matchIndexCopy);
        if (!validationResult.valid) {
            return Promise.resolve({
                success: false,
                message: validationResult.errors.join('; ')
            });
        }

        var updatedMatch = deepClone(proposedMatch);

        return executeMutation({
            validate: function(data) {
                var currentTournament = getTournamentById(tournamentId);
                if (!currentTournament) {
                    return { valid: false, message: 'Tournament no longer exists.' };
                }

                var currentRounds = getRounds(tournamentId);
                if (roundIndexCopy < 0 || roundIndexCopy >= currentRounds.length) {
                    return { valid: false, message: 'Round no longer exists.' };
                }

                var currentRound = currentRounds[roundIndexCopy];
                if (currentRound.status === 'completed') {
                    return { valid: false, message: 'Round is completed.' };
                }

                if (!Array.isArray(currentRound.matches) || matchIndexCopy >= currentRound.matches.length) {
                    return { valid: false, message: 'Match no longer exists.' };
                }

                var currentMatch = currentRound.matches[matchIndexCopy];
                if (currentMatch && currentMatch.status === 'completed') {
                    return { valid: false, message: 'Match is completed.' };
                }

                if (currentMatch.type !== 'group_exam') {
                    return { valid: false, message: 'Not a group exam match.' };
                }

                return { valid: true };
            },
            mutate: function(data) {
                var targetTournament = null;
                for (var i = 0; i < data.tournaments.length; i++) {
                    if (data.tournaments[i] && normaliseId(data.tournaments[i].id) === normaliseId(tournamentId)) {
                        targetTournament = data.tournaments[i];
                        break;
                    }
                }

                if (!targetTournament) {
                    throw new Error('Tournament not found in data store.');
                }

                if (!Array.isArray(targetTournament.rounds) || roundIndexCopy >= targetTournament.rounds.length) {
                    throw new Error('Round not found in data store.');
                }

                var targetRound = targetTournament.rounds[roundIndexCopy];
                if (!Array.isArray(targetRound.matches) || matchIndexCopy >= targetRound.matches.length) {
                    throw new Error('Match not found in data store.');
                }

                var targetMatch = targetRound.matches[matchIndexCopy];
                var keys = ['participants', 'type', 'status', 'winner', 'loser', 'advancing', 'results'];
                for (var j = 0; j < keys.length; j++) {
                    var key = keys[j];
                    targetMatch[key] = updatedMatch[key];
                }

                return { match: targetMatch };
            },
            logMessage: 'Set group exam result in match',
            successMessage: 'Result set successfully.',
            failureMessage: 'Failed to set result.'
        });
    }

    /**
     * Set a match winner (for standard matches only).
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of the round
     * @param {number} matchIndex - Index of the match
     * @param {string} winnerId - Winner ID
     * @returns {Promise<object>} { success: boolean, data?: object, message?: string }
     */
    function setMatchWinner(tournamentId, roundIndex, matchIndex, winnerId) {
        var winnerNormalised = normaliseId(winnerId);
        if (winnerNormalised === null) {
            return Promise.resolve({
                success: false,
                message: 'Invalid winner ID.'
            });
        }

        var roundIndexCopy = parseInt(roundIndex, 10);
        var matchIndexCopy = parseInt(matchIndex, 10);

        var tournament = getTournamentById(tournamentId);
        if (!tournament) {
            return Promise.resolve({
                success: false,
                message: 'Tournament not found.'
            });
        }

        var rounds = getRounds(tournamentId);
        if (roundIndexCopy < 0 || roundIndexCopy >= rounds.length) {
            return Promise.resolve({
                success: false,
                message: 'Round not found.'
            });
        }

        var round = rounds[roundIndexCopy];
        if (!round || typeof round !== 'object') {
            return Promise.resolve({
                success: false,
                message: 'Round not found.'
            });
        }

        if (round.status === 'completed') {
            return Promise.resolve({
                success: false,
                message: 'Cannot modify matches in a completed round.'
            });
        }

        if (!Array.isArray(round.matches) || matchIndexCopy < 0 || matchIndexCopy >= round.matches.length) {
            return Promise.resolve({
                success: false,
                message: 'Match not found.'
            });
        }

        var match = round.matches[matchIndexCopy];
        if (!match || typeof match !== 'object') {
            return Promise.resolve({
                success: false,
                message: 'Match not found.'
            });
        }

        if (match.type === 'group_exam') {
            return Promise.resolve({
                success: false,
                message: 'Cannot set winner for group exam match.'
            });
        }
        if (match.status === 'completed') {
            return Promise.resolve({
                success: false,
                message: 'Cannot modify a completed match.'
            });
        }

        if (match.participants.indexOf(winnerNormalised) === -1) {
            return Promise.resolve({
                success: false,
                message: 'Winner must be a participant in the match.'
            });
        }

        var expectedType = tournament.mode === 'teams' ? 'team' : 'character';
        var Rules = getRules();
        if (Rules && typeof Rules.isParticipantEligible === 'function') {
            if (!Rules.isParticipantEligible(tournament, winnerNormalised, expectedType)) {
                return Promise.resolve({
                    success: false,
                    message: 'Winner is not eligible.'
                });
            }
        }

        var updates = { winner: winnerNormalised };
        var proposedMatch = buildProposedMatch(match, updates, tournament, round);
        if (proposedMatch === null) {
            return Promise.resolve({
                success: false,
                message: 'Failed to update match.'
            });
        }

        var validationResult = validateProposedMatch(proposedMatch, tournament, round, matchIndexCopy);
        if (!validationResult.valid) {
            return Promise.resolve({
                success: false,
                message: validationResult.errors.join('; ')
            });
        }

        var updatedMatch = deepClone(proposedMatch);

        return executeMutation({
            validate: function(data) {
                var currentTournament = getTournamentById(tournamentId);
                if (!currentTournament) {
                    return { valid: false, message: 'Tournament no longer exists.' };
                }

                var currentRounds = getRounds(tournamentId);
                if (roundIndexCopy < 0 || roundIndexCopy >= currentRounds.length) {
                    return { valid: false, message: 'Round no longer exists.' };
                }

                var currentRound = currentRounds[roundIndexCopy];
                if (currentRound.status === 'completed') {
                    return { valid: false, message: 'Round is completed.' };
                }

                if (!Array.isArray(currentRound.matches) || matchIndexCopy >= currentRound.matches.length) {
                    return { valid: false, message: 'Match no longer exists.' };
                }

                var currentMatch = currentRound.matches[matchIndexCopy];
                if (currentMatch && currentMatch.status === 'completed') {
                    return { valid: false, message: 'Match is completed.' };
                }

                if (currentMatch.type === 'group_exam') {
                    return { valid: false, message: 'Cannot set winner for group exam match.' };
                }

                return { valid: true };
            },
            mutate: function(data) {
                var targetTournament = null;
                for (var i = 0; i < data.tournaments.length; i++) {
                    if (data.tournaments[i] && normaliseId(data.tournaments[i].id) === normaliseId(tournamentId)) {
                        targetTournament = data.tournaments[i];
                        break;
                    }
                }

                if (!targetTournament) {
                    throw new Error('Tournament not found in data store.');
                }

                if (!Array.isArray(targetTournament.rounds) || roundIndexCopy >= targetTournament.rounds.length) {
                    throw new Error('Round not found in data store.');
                }

                var targetRound = targetTournament.rounds[roundIndexCopy];
                if (!Array.isArray(targetRound.matches) || matchIndexCopy >= targetRound.matches.length) {
                    throw new Error('Match not found in data store.');
                }

                var targetMatch = targetRound.matches[matchIndexCopy];
                var keys = ['participants', 'type', 'status', 'winner', 'loser', 'advancing', 'results'];
                for (var j = 0; j < keys.length; j++) {
                    var key = keys[j];
                    targetMatch[key] = updatedMatch[key];
                }

                return { match: targetMatch };
            },
            logMessage: 'Set winner for match',
            successMessage: 'Winner set successfully.',
            failureMessage: 'Failed to set winner.'
        });
    }

    // ============================================================
    // READ OPERATIONS (defensive copies, delegated to Queries)
    // ============================================================

    /**
     * Get matches for a round (defensive copies).
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of the round
     * @returns {array} Array of match objects
     */
    function getRoundMatches(tournamentId, roundIndex) {
        var Queries = getQueries();
        if (Queries && typeof Queries.getMatches === 'function') {
            return Queries.getMatches(tournamentId, roundIndex);
        }
        return [];
    }

    /**
     * Get a match (defensive copy).
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of the round
     * @param {number} matchIndex - Index of the match
     * @returns {object|null} Match object or null
     */
    function getMatch(tournamentId, roundIndex, matchIndex) {
        var Queries = getQueries();
        if (Queries && typeof Queries.getMatch === 'function') {
            return Queries.getMatch(tournamentId, roundIndex, matchIndex);
        }
        return null;
    }

    /**
     * Check if a match is complete.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of the round
     * @param {number} matchIndex - Index of the match
     * @returns {boolean} True if complete
     */
    function isMatchComplete(tournamentId, roundIndex, matchIndex) {
        var Queries = getQueries();
        if (Queries && typeof Queries.isMatchComplete === 'function') {
            return Queries.isMatchComplete(tournamentId, roundIndex, matchIndex);
        }
        var match = getMatch(tournamentId, roundIndex, matchIndex);
        if (!match) {
            return false;
        }
        return match.status === 'completed';
    }

    /**
     * Get match winner ID.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of the round
     * @param {number} matchIndex - Index of the match
     * @returns {string|null} Winner ID or null
     */
    function getMatchWinner(tournamentId, roundIndex, matchIndex) {
        var Queries = getQueries();
        if (Queries && typeof Queries.getMatchWinner === 'function') {
            return Queries.getMatchWinner(tournamentId, roundIndex, matchIndex);
        }
        var match = getMatch(tournamentId, roundIndex, matchIndex);
        if (!match) {
            return null;
        }
        return match.winner || null;
    }

    /**
     * Get advancing participants from a match.
     * ALWAYS derives from the current match state.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of the round
     * @param {number} matchIndex - Index of the match
     * @returns {array} Array of advancing participant IDs
     */
    function getMatchAdvancing(tournamentId, roundIndex, matchIndex) {
        var Queries = getQueries();
        if (Queries && typeof Queries.getMatchAdvancing === 'function') {
            return Queries.getMatchAdvancing(tournamentId, roundIndex, matchIndex);
        }
        var match = getMatch(tournamentId, roundIndex, matchIndex);
        if (!match) {
            return [];
        }
        return deriveAdvancing(match);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentMatches = {
        // ---- Public Mutation Commands (via MutationPipeline) ----
        createMatch: createMatch,
        removeMatch: removeMatch,
        updateMatch: updateMatch,
        completeMatch: completeMatch,
        setMatchWinner: setMatchWinner,
        setGroupExamResult: setGroupExamResult,

        // ---- Internal Pure Builders (used by Core.addRound) ----
        buildMatch: buildMatch,
        buildRound: buildRound,
        buildProposedMatch: buildProposedMatch,

        // ---- Validation Helpers ----
        validateProposedMatch: validateProposedMatch,
        isTypeChangeAllowed: isTypeChangeAllowed,

        // ---- Read Operations (delegated to Queries) ----
        getRoundMatches: getRoundMatches,
        getMatch: getMatch,
        isMatchComplete: isMatchComplete,
        getMatchWinner: getMatchWinner,
        getMatchAdvancing: getMatchAdvancing
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TournamentMatches;
        var missing = [];

        var required = [
            'createMatch', 'removeMatch', 'updateMatch',
            'completeMatch', 'setMatchWinner', 'setGroupExamResult',
            'buildMatch', 'buildRound', 'buildProposedMatch',
            'validateProposedMatch', 'isTypeChangeAllowed',
            'getRoundMatches', 'getMatch', 'isMatchComplete',
            'getMatchWinner', 'getMatchAdvancing'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[TournamentMatches] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[TournamentMatches] All exports verified successfully.');
        }
    })();

})();
