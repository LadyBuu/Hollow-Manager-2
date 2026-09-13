/**
 * modules/tournaments/tournament-matches.js - Tournament Match Operations
 * CANONICAL match mutation API for tournaments.
 * Path: js/modules/tournaments/tournament-matches.js
 *
 * This module provides:
 *   - Match CRUD operations (create, update, delete)
 *   - Match completion (per-participant pass/fail/retry)
 *   - Team match completion (team-level + member-level results)
 *   - Auto-generation of matches from an eligible pool
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
 *   - Invalid inputs are REJECTED (operation returns a rejected/failed Promise)
 *   - Mutations are ATOMIC: if any part is invalid, nothing changes
 *   - Returns DEFENSIVE COPIES of mutated objects
 *
 * MATCH TYPES:
 *   - 'standard'    : legacy 2-participant match. Read-only compat.
 *                     The UI no longer creates these. Uses winner/loser.
 *   - 'group_exam'  : open assessment. 2+ participants. Per-participant
 *                     results (pass | fail | retry). No winner/loser.
 *   - 'team_vs_team': adversarial team match. 2+ teams. Two-layer
 *                     results: teamResults + individualResults.
 *
 * PAIR EXAM:
 *   - 'group_exam' with isPairExam: true.
 *   - Pairings field partitions participants into groups of 2 or 3.
 *
 * RESULT VOCABULARY:
 *   - 'pass'  : advanced and successful
 *   - 'retry' : advanced but not successful; tries again next round
 *   - 'fail'  : not advanced; eliminated from this tournament
 *   - Advancement = result is 'pass' OR 'retry'.
 *
 * PUBLIC COMMANDS (via MutationPipeline):
 *   - createMatch(tournamentId, roundIndex, matchData)
 *   - removeMatch(tournamentId, roundIndex, matchIndex)
 *   - updateMatch(tournamentId, roundIndex, matchIndex, updates)
 *   - completeMatch(tournamentId, roundIndex, matchIndex, result)
 *   - generateMatches(tournamentId, roundIndex, options)
 *
 * INTERNAL PURE BUILDERS (used by Core.addRound):
 *   - buildMatch(participants, roundConfig)
 *   - buildRound(roundData, participants)
 *   - buildProposedMatch(base, updates, tournament, round, options)
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
 *   Matches.createMatch('tourn_123', 0, { participants: ['char_1', 'char_2'] });
 *   Matches.completeMatch('tourn_123', 0, 0, {
 *     results: { char_1: 'pass', char_2: 'retry' }
 *   });
 *   Matches.generateMatches('tourn_123', 0, { matchSize: 2 });
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

        if (!getConstants()) { missing.push('TournamentConstants (lazy)'); }
        if (!getSchema()) { missing.push('TournamentSchema (lazy)'); }
        if (!getLifecycle()) { missing.push('TournamentLifecycle (lazy)'); }
        if (!getRules()) { missing.push('TournamentRules (lazy)'); }
        if (!getQueries()) { missing.push('TournamentQueries (lazy)'); }
        if (!getMutationPipeline()) { missing.push('MutationPipeline (lazy)'); }
        if (!getObjectUtils()) { missing.push('ObjectUtils (lazy)'); }
        if (!getIdUtils()) { missing.push('IdUtils (lazy)'); }

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

    function failure(message) {
        return { success: false, message: message };
    }

    function success(data) {
        return { success: true, data: data };
    }

    function getTournamentById(tournamentId) {
        var Queries = getQueries();
        if (Queries && typeof Queries.getTournament === 'function') {
            return Queries.getTournament(tournamentId);
        }
        return null;
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
        var Schema = getSchema();
        if (Schema && typeof Schema.getCanonicalParticipantType === 'function') {
            return Schema.getCanonicalParticipantType(mode);
        }
        return mode === 'teams' ? 'team' : 'character';
    }

    function isValidResult(value) {
        var Schema = getSchema();
        if (Schema && typeof Schema.isValidResult === 'function') {
            return Schema.isValidResult(value);
        }
        return value === 'pass' || value === 'fail' || value === 'retry';
    }

    // ============================================================
    // ELIGIBILITY - who can participate in the next match?
    // ============================================================

    /**
     * Determine whether a participant is eligible for a NEW match
     * in the given round, given prior rounds' results.
     *
     * Rules:
     *   - Must be in the tournament roster.
     *   - Must not have failed any prior match in this tournament.
     *   - Must not be individually eliminated (CharacterEliminations).
     *
     * The function is used by generateMatches and validateMatchParticipants.
     *
     * @param {string} tournamentId
     * @param {string} participantId
     * @returns {boolean}
     */
    function isEligibleForNewMatch(tournamentId, participantId) {
        if (!participantId) { return false; }

        // In the tournament roster?
        if (!isParticipantInTournament(tournamentId, participantId)) {
            return false;
        }

        // Individually eliminated?
        if (isParticipantEliminated(tournamentId, participantId)) {
            return false;
        }

        // Has the participant failed any prior match in this tournament?
        var rounds = getRounds(tournamentId);
        for (var r = 0; r < rounds.length; r++) {
            var matches = rounds[r] && Array.isArray(rounds[r].matches)
                ? rounds[r].matches
                : [];
            for (var m = 0; m < matches.length; m++) {
                var match = matches[m];
                if (!match || match.status !== 'completed') { continue; }

                if (match.type === 'team_vs_team') {
                    var tr = match.teamResults || {};
                    if (tr[participantId] === 'fail') {
                        return false;
                    }
                } else {
                    var rr = match.results || {};
                    if (rr[participantId] === 'fail') {
                        return false;
                    }
                }
            }
        }

        return true;
    }

    /**
     * Get every eligible participant for a new match.
     * Returns an array of IDs.
     */
    function getEligibleParticipants(tournamentId) {
        var tournament = getTournamentById(tournamentId);
        if (!tournament || !Array.isArray(tournament.participants)) {
            return [];
        }
        var result = [];
        for (var i = 0; i < tournament.participants.length; i++) {
            var p = tournament.participants[i];
            if (!p || !p.id) { continue; }
            if (isEligibleForNewMatch(tournamentId, p.id)) {
                result.push(p.id);
            }
        }
        return result;
    }

    // ============================================================
    // VALIDATION - match participants
    // ============================================================

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
                return {
                    valid: false,
                    message: 'Participant type mismatch for ' + id +
                        '. Expected ' + expectedType + ', got ' + actualType
                };
            }
        }

        return { valid: true };
    }

    // ============================================================
    // VALIDATION - result maps
    // ============================================================

    /**
     * Normalise and validate a per-participant result map.
     * Returns { valid, message, map }.
     */
    function validateResultMap(rawMap, participants, options) {
        options = options || {};
        var requireAll = options.requireAll === true;

        if (!isObject(rawMap)) {
            return { valid: false, message: 'Results must be an object.' };
        }

        var normalised = {};
        var keys = Object.keys(rawMap);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var id = normaliseId(key);
            if (id === null) {
                return { valid: false, message: 'Invalid result key: ' + key };
            }
            if (participants.indexOf(id) === -1) {
                return {
                    valid: false,
                    message: 'Result for ' + id + ' does not match a match participant.'
                };
            }
            var value = rawMap[key];
            if (!isValidResult(value)) {
                return {
                    valid: false,
                    message: 'Invalid result for ' + id + ': ' + value +
                        ' (expected pass, fail, or retry)'
                };
            }
            normalised[id] = value;
        }

        if (requireAll) {
            for (var j = 0; j < participants.length; j++) {
                var pid = normaliseId(participants[j]);
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
    // INTERNAL PURE BUILDERS - Used by Core.addRound
    // ============================================================

    /**
     * Build an empty match for a given round configuration.
     * The match has no participants and no results — those are added
     * explicitly via createMatch or generateMatches.
     */
    function buildMatch(participants, roundConfig) {
        roundConfig = roundConfig || {};
        var matchType = roundConfig.matchType || 'group_exam';
        var matchParticipants = Array.isArray(participants) ? participants.slice() : [];

        var result = {
            participants: matchParticipants,
            type: matchType,
            status: 'pending',
            winner: null,
            loser: null,
            advancing: []
        };

        if (matchType === 'group_exam') {
            result.results = {};
            if (roundConfig.isPairExam === true) {
                result.isPairExam = true;
                result.pairings = [];
            }
        } else if (matchType === 'team_vs_team') {
            result.teamResults = {};
            result.individualResults = {};
        }

        return result;
    }

    /**
     * Build an empty round from round data.
     * The round has ZERO matches. Matches are added explicitly via
     * createMatch or generateMatches. This is a deliberate change from
     * the previous behavior where addRound auto-created a single match
     * containing every participant.
     */
    function buildRound(roundData, participants) {
        roundData = roundData || {};
        var matchSize = roundData.matchSize || 2;
        var matchType = roundData.matchType || 'group_exam';
        var roundNumber = roundData.roundNumber || 1;
        var isPairExam = roundData.isPairExam === true;

        var round = {
            roundNumber: roundNumber,
            status: 'pending',
            matchSize: matchSize,
            matchType: matchType,
            matches: []
        };

        if (isPairExam) {
            round.isPairExam = true;
        }

        return round;
    }

    /**
     * Build a complete proposed match state.
     * This is the SINGLE canonical match construction function.
     * Used by ALL match creation/update/completion operations.
     *
     * Deprecated winner/loser are always emitted as null.
     */
    function buildProposedMatch(base, updates, tournament, round, options) {
        options = options || {};
        var allowCompletion = options.allowCompletion === true;

        var allowedKeys = [
            'participants', 'type', 'status', 'results',
            'isPairExam', 'pairings',
            'teamResults', 'individualResults'
        ];
        if (!hasOnlyAllowedKeys(updates, allowedKeys)) {
            return null;
        }

        var normalisedUpdates = {};

        // ---- participants ----
        if (updates.participants !== undefined) {
            var participants = normaliseIdArrayStrict(updates.participants);
            if (participants === null) {
                return null;
            }
            normalisedUpdates.participants = participants;
        }

        // ---- type ----
        var proposedType = updates.type !== undefined
            ? updates.type
            : (base.type || round.matchType || 'group_exam');

        if (updates.type !== undefined && updates.type !== base.type) {
            if (!isTypeChangeAllowed(base)) {
                return null;
            }
            var Constants = getConstants();
            var validTypes = Constants
                ? Constants.VALID_MATCH_TYPES
                : ['standard', 'group_exam', 'team_vs_team'];
            if (validTypes.indexOf(proposedType) === -1) {
                return null;
            }
        }

        normalisedUpdates.type = proposedType;

        // ---- status ----
        var currentStatus = base.status || 'pending';
        if (updates.status !== undefined && updates.status !== currentStatus) {
            var validStatuses = ['pending', 'in_progress', 'completed'];
            if (validStatuses.indexOf(updates.status) === -1) {
                return null;
            }
            if (updates.status === 'completed' && currentStatus !== 'completed') {
                if (!allowCompletion) { return null; }
            }
            normalisedUpdates.status = updates.status;
        }

        // ---- isPairExam ----
        if (updates.isPairExam !== undefined) {
            if (proposedType !== 'group_exam') {
                return null;
            }
            normalisedUpdates.isPairExam = updates.isPairExam === true;
        }

        // ---- results (group_exam) ----
        if (updates.results !== undefined) {
            if (proposedType !== 'group_exam') {
                return null;
            }
            var resultCheck = validateResultMap(updates.results, [], { requireAll: false });
            if (!resultCheck.valid) {
                return null;
            }
            normalisedUpdates.results = resultCheck.map;
        }

        // ---- teamResults (team_vs_team) ----
        if (updates.teamResults !== undefined) {
            if (proposedType !== 'team_vs_team') {
                return null;
            }
            var teamCheck = validateResultMap(updates.teamResults, [], { requireAll: false });
            if (!teamCheck.valid) {
                return null;
            }
            normalisedUpdates.teamResults = teamCheck.map;
        }

        // ---- individualResults (team_vs_team) ----
        if (updates.individualResults !== undefined) {
            if (proposedType !== 'team_vs_team') {
                return null;
            }
            var indCheck = validateResultMap(updates.individualResults, [], { requireAll: false });
            if (!indCheck.valid) {
                return null;
            }
            normalisedUpdates.individualResults = indCheck.map;
        }

        // ---- pairings (group_exam + isPairExam) ----
        if (updates.pairings !== undefined) {
            var isPairExamFinal = normalisedUpdates.isPairExam !== undefined
                ? normalisedUpdates.isPairExam
                : (base.isPairExam === true);
            if (proposedType !== 'group_exam' || !isPairExamFinal) {
                return null;
            }
            var Schema = getSchema();
            if (!Schema || typeof Schema.normalisePairings !== 'function') {
                return null;
            }
            var pairings = Schema.normalisePairings(updates.pairings);
            if (pairings === null) {
                return null;
            }
            normalisedUpdates.pairings = pairings;
        }

        // ---- build proposed ----
        var proposed = {
            participants: normalisedUpdates.participants !== undefined
                ? normalisedUpdates.participants
                : (base.participants ? base.participants.slice() : []),
            type: normalisedUpdates.type,
            status: normalisedUpdates.status !== undefined
                ? normalisedUpdates.status
                : (base.status !== undefined ? base.status : 'pending'),
            // Deprecated — always null going forward.
            winner: null,
            loser: null,
            advancing: []
        };

        var isPairExam = normalisedUpdates.isPairExam !== undefined
            ? normalisedUpdates.isPairExam
            : (base.isPairExam === true);

        if (isPairExam) {
            proposed.isPairExam = true;
        }

        // ---- per-type payloads ----
        if (proposed.type === 'group_exam') {
            proposed.results = normalisedUpdates.results !== undefined
                ? normalisedUpdates.results
                : (base.results ? Object.assign({}, base.results) : {});
            proposed.pairings = normalisedUpdates.pairings !== undefined
                ? normalisedUpdates.pairings
                : (base.pairings ? base.pairings.slice() : (isPairExam ? [] : undefined));
            if (proposed.pairings === undefined) {
                delete proposed.pairings;
            }
        }

        if (proposed.type === 'team_vs_team') {
            proposed.teamResults = normalisedUpdates.teamResults !== undefined
                ? normalisedUpdates.teamResults
                : (base.teamResults ? Object.assign({}, base.teamResults) : {});
            proposed.individualResults = normalisedUpdates.individualResults !== undefined
                ? normalisedUpdates.individualResults
                : (base.individualResults ? Object.assign({}, base.individualResults) : {});
        }

        // ---- size check against round.matchSize ----
        var matchSize = round && round.matchSize ? round.matchSize : 2;
        if (proposed.participants.length > 0 && proposed.participants.length !== matchSize) {
            // Allow partial participants only when not completing.
            if (proposed.status === 'completed') {
                return null;
            }
        }

        // ---- participant eligibility check ----
        var expectedType = tournament.mode === 'teams' ? 'team' : 'character';
        for (var pi = 0; pi < proposed.participants.length; pi++) {
            var pid = proposed.participants[pi];
            var Rules = getRules();
            if (Rules && typeof Rules.isParticipantEligible === 'function') {
                if (!Rules.isParticipantEligible(tournament, pid, expectedType)) {
                    return null;
                }
            }
        }

        // ---- result participant check ----
        if (proposed.type === 'group_exam') {
            if (!validateMatchResultParticipants(proposed.participants, proposed.results)) {
                return null;
            }
        }

        // ---- derive advancing ----
        var Schema = getSchema();
        if (Schema && typeof Schema.deriveAdvancing === 'function') {
            proposed.advancing = Schema.deriveAdvancing(proposed);
        }

        return proposed;
    }

    /**
     * Validate a complete proposed match state.
     */
    function validateProposedMatch(proposed, tournament, round, matchIndex) {
        var errors = [];

        if (!proposed || typeof proposed !== 'object') {
            errors.push('Proposed match is invalid.');
            return { valid: false, errors: errors };
        }

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
            var schemaErrors = Schema.validateMatch(proposed, round, true);
            if (Array.isArray(schemaErrors)) {
                for (var i = 0; i < schemaErrors.length; i++) {
                    errors.push(schemaErrors[i]);
                }
            }
        } else {
            errors.push('Schema not available for validation.');
        }

        return { valid: errors.length === 0, errors: errors };
    }

    // ============================================================
    // SMALL VALIDATION HELPERS
    // ============================================================

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
        if (!base) { return false; }
        if (base.status !== 'pending') { return false; }
        if (base.results && Object.keys(base.results).length > 0) { return false; }
        if (base.teamResults && Object.keys(base.teamResults).length > 0) { return false; }
        if (base.individualResults && Object.keys(base.individualResults).length > 0) { return false; }
        if (base.winner) { return false; }
        return true;
    }

    function normaliseIdArrayStrict(ids) {
        if (!Array.isArray(ids)) { return null; }
        var result = [];
        var seen = {};
        for (var i = 0; i < ids.length; i++) {
            var normalised = normaliseId(ids[i]);
            if (normalised === null) { return null; }
            if (seen[normalised]) { return null; }
            seen[normalised] = true;
            result.push(normalised);
        }
        return result;
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
            if (id === null) { return false; }
            if (participantIds.indexOf(id) === -1) { return false; }
        }
        return true;
    }

    // ============================================================
    // MUTATION PIPELINE WRAPPER
    // ============================================================

    function executeMutation(config) {
        var Pipeline = getMutationPipeline();
        if (!Pipeline || typeof Pipeline.performMutation !== 'function') {
            return Promise.resolve({
                success: false,
                message: 'MutationPipeline not available.'
            });
        }

        return Pipeline.performMutation({
            validate: config.validate || function() {
                return { valid: true };
            },
            mutate: config.mutate,
            logMessage: config.logMessage || 'Match operation performed.',
            successMessage: config.successMessage || 'Match operation completed.',
            failureMessage: config.failureMessage || 'Match operation failed.'
        });
    }

    // ============================================================
    // PUBLIC COMMANDS - CREATE MATCH
    // ============================================================

    /**
     * Create a single match in a round.
     *
     * @param {string} tournamentId
     * @param {number} roundIndex
     * @param {object} matchData - { participants, type?, isPairExam?, pairings? }
     * @returns {Promise<object>}
     */
    function createMatch(tournamentId, roundIndex, matchData) {
        if (!isObject(matchData)) {
            return Promise.resolve(failure('Invalid match data.'));
        }

        var tournament = getTournamentById(tournamentId);
        if (!tournament) {
            return Promise.resolve(failure('Tournament not found.'));
        }

        var rounds = getRounds(tournamentId);
        if (roundIndex < 0 || roundIndex >= rounds.length) {
            return Promise.resolve(failure('Round not found.'));
        }

        var round = rounds[roundIndex];
        if (!round || typeof round !== 'object') {
            return Promise.resolve(failure('Round not found.'));
        }

        if (round.status === 'completed') {
            return Promise.resolve(failure('Cannot add matches to a completed round.'));
        }

        var participants = matchData.participants || [];
        var validation = validateMatchParticipants(tournamentId, participants);
        if (!validation.valid) {
            return Promise.resolve(failure(validation.message));
        }

        var base = buildMatch([], {
            matchType: matchData.type || round.matchType || 'group_exam',
            isPairExam: matchData.isPairExam === true || round.isPairExam === true
        });

        var updates = {
            participants: participants,
            type: matchData.type || round.matchType || 'group_exam'
        };

        if (matchData.isPairExam === true || round.isPairExam === true) {
            updates.isPairExam = true;
            if (Array.isArray(matchData.pairings)) {
                updates.pairings = matchData.pairings;
            }
        }

        var proposed = buildProposedMatch(base, updates, tournament, round);
        if (!proposed) {
            return Promise.resolve(failure('Failed to build match.'));
        }

        var validationResult = validateProposedMatch(proposed, tournament, round, -1);
        if (!validationResult.valid) {
            return Promise.resolve(failure(validationResult.errors.join('; ')));
        }

        // ---- special: if isPairExam and no explicit pairings, auto-partition
        if (proposed.isPairExam && (!proposed.pairings || proposed.pairings.length === 0)) {
            var Schema = getSchema();
            if (Schema && typeof Schema.normalisePairings === 'function') {
                var autoPairings = partitionIntoPairs(proposed.participants);
                if (autoPairings) {
                    proposed.pairings = autoPairings;
                }
            }
        }

        var matchCopy = deepClone(proposed);
        var roundIndexCopy = parseInt(roundIndex, 10);

        return executeMutation({
            validate: function() {
                var currentRounds = getRounds(tournamentId);
                if (roundIndexCopy < 0 || roundIndexCopy >= currentRounds.length) {
                    return { valid: false, message: 'Round no longer exists.' };
                }
                if (currentRounds[roundIndexCopy].status === 'completed') {
                    return { valid: false, message: 'Round is completed.' };
                }
                return { valid: true };
            },
            mutate: function(data) {
                var targetTournament = findTournament(data, tournamentId);
                if (!targetTournament) {
                    throw new Error('Tournament not found in data store.');
                }
                if (!Array.isArray(targetTournament.rounds) ||
                    roundIndexCopy >= targetTournament.rounds.length) {
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

    // ============================================================
    // PUBLIC COMMANDS - REMOVE MATCH
    // ============================================================

    function removeMatch(tournamentId, roundIndex, matchIndex) {
        var roundIndexCopy = parseInt(roundIndex, 10);
        var matchIndexCopy = parseInt(matchIndex, 10);

        var tournament = getTournamentById(tournamentId);
        if (!tournament) {
            return Promise.resolve(failure('Tournament not found.'));
        }

        var rounds = getRounds(tournamentId);
        if (roundIndexCopy < 0 || roundIndexCopy >= rounds.length) {
            return Promise.resolve(failure('Round not found.'));
        }

        var round = rounds[roundIndexCopy];
        if (!round || typeof round !== 'object') {
            return Promise.resolve(failure('Round not found.'));
        }

        if (round.status === 'completed') {
            return Promise.resolve(failure('Cannot remove matches from a completed round.'));
        }

        if (!Array.isArray(round.matches) ||
            matchIndexCopy < 0 ||
            matchIndexCopy >= round.matches.length) {
            return Promise.resolve(failure('Match not found.'));
        }

        var match = round.matches[matchIndexCopy];
        if (!match) {
            return Promise.resolve(failure('Match not found.'));
        }

        if (match.status === 'completed') {
            return Promise.resolve(failure('Cannot remove a completed match.'));
        }

        return executeMutation({
            validate: function() {
                var currentRounds = getRounds(tournamentId);
                if (roundIndexCopy < 0 || roundIndexCopy >= currentRounds.length) {
                    return { valid: false, message: 'Round no longer exists.' };
                }
                var currentRound = currentRounds[roundIndexCopy];
                if (currentRound.status === 'completed') {
                    return { valid: false, message: 'Round is completed.' };
                }
                if (!Array.isArray(currentRound.matches) ||
                    matchIndexCopy >= currentRound.matches.length) {
                    return { valid: false, message: 'Match no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(data) {
                var targetTournament = findTournament(data, tournamentId);
                if (!targetTournament) {
                    throw new Error('Tournament not found in data store.');
                }
                var targetRound = targetTournament.rounds[roundIndexCopy];
                if (!Array.isArray(targetRound.matches) ||
                    matchIndexCopy >= targetRound.matches.length) {
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

    // ============================================================
    // PUBLIC COMMANDS - UPDATE MATCH
    // ============================================================

    function updateMatch(tournamentId, roundIndex, matchIndex, updates) {
        if (!isObject(updates)) {
            return Promise.resolve(failure('Invalid updates.'));
        }

        var roundIndexCopy = parseInt(roundIndex, 10);
        var matchIndexCopy = parseInt(matchIndex, 10);

        var tournament = getTournamentById(tournamentId);
        if (!tournament) {
            return Promise.resolve(failure('Tournament not found.'));
        }

        var rounds = getRounds(tournamentId);
        if (roundIndexCopy < 0 || roundIndexCopy >= rounds.length) {
            return Promise.resolve(failure('Round not found.'));
        }

        var round = rounds[roundIndexCopy];
        if (!round) {
            return Promise.resolve(failure('Round not found.'));
        }

        if (round.status === 'completed') {
            return Promise.resolve(failure('Cannot modify matches in a completed round.'));
        }

        if (!Array.isArray(round.matches) ||
            matchIndexCopy < 0 ||
            matchIndexCopy >= round.matches.length) {
            return Promise.resolve(failure('Match not found.'));
        }

        var match = round.matches[matchIndexCopy];
        if (!match) {
            return Promise.resolve(failure('Match not found.'));
        }

        if (match.status === 'completed') {
            return Promise.resolve(failure('Cannot modify a completed match.'));
        }

        if (updates.status === 'completed') {
            return Promise.resolve(failure('Use completeMatch() to complete a match.'));
        }

        var proposedMatch = buildProposedMatch(match, updates, tournament, round);
        if (!proposedMatch) {
            return Promise.resolve(failure('Invalid updates.'));
        }

        var validationResult = validateProposedMatch(proposedMatch, tournament, round, matchIndexCopy);
        if (!validationResult.valid) {
            return Promise.resolve(failure(validationResult.errors.join('; ')));
        }

        var updatedMatch = deepClone(proposedMatch);

        return executeMutation({
            validate: function() {
                var currentRounds = getRounds(tournamentId);
                if (roundIndexCopy < 0 || roundIndexCopy >= currentRounds.length) {
                    return { valid: false, message: 'Round no longer exists.' };
                }
                var currentRound = currentRounds[roundIndexCopy];
                if (currentRound.status === 'completed') {
                    return { valid: false, message: 'Round is completed.' };
                }
                if (!Array.isArray(currentRound.matches) ||
                    matchIndexCopy >= currentRound.matches.length) {
                    return { valid: false, message: 'Match no longer exists.' };
                }
                return { valid: true };
            },
            mutate: function(data) {
                var targetTournament = findTournament(data, tournamentId);
                if (!targetTournament) {
                    throw new Error('Tournament not found in data store.');
                }
                var targetRound = targetTournament.rounds[roundIndexCopy];
                var targetMatch = targetRound.matches[matchIndexCopy];
                applyMatchUpdate(targetMatch, updatedMatch);
                return { match: targetMatch };
            },
            logMessage: 'Updated match in round ' + (roundIndexCopy + 1),
            successMessage: 'Match updated successfully.',
            failureMessage: 'Failed to update match.'
        });
    }

    // ============================================================
    // PUBLIC COMMANDS - COMPLETE MATCH
    // ============================================================

    /**
     * Complete a match.
     *
     * For group_exam (including pair exams):
     *   result.results must be { participantId: 'pass' | 'fail' | 'retry' }
     *
     * For team_vs_team:
     *   result.teamResults       - { teamId: 'pass' | 'fail' | 'retry' }
     *   result.individualResults - { charId: 'pass' | 'fail' | 'retry' }
     */
    function completeMatch(tournamentId, roundIndex, matchIndex, result) {
        if (!isObject(result)) {
            return Promise.resolve(failure('Invalid result.'));
        }

        var roundIndexCopy = parseInt(roundIndex, 10);
        var matchIndexCopy = parseInt(matchIndex, 10);

        var tournament = getTournamentById(tournamentId);
        if (!tournament) {
            return Promise.resolve(failure('Tournament not found.'));
        }

        var rounds = getRounds(tournamentId);
        if (roundIndexCopy < 0 || roundIndexCopy >= rounds.length) {
            return Promise.resolve(failure('Round not found.'));
        }

        var round = rounds[roundIndexCopy];
        if (!round) {
            return Promise.resolve(failure('Round not found.'));
        }

        if (round.status === 'completed') {
            return Promise.resolve(failure('Cannot modify matches in a completed round.'));
        }

        if (!Array.isArray(round.matches) ||
            matchIndexCopy < 0 ||
            matchIndexCopy >= round.matches.length) {
            return Promise.resolve(failure('Match not found.'));
        }

        var match = round.matches[matchIndexCopy];
        if (!match) {
            return Promise.resolve(failure('Match not found.'));
        }

        if (match.status === 'completed') {
            return Promise.resolve(failure('Match is already completed.'));
        }

        var type = match.type || 'group_exam';
        var updates = { status: 'completed' };

        // ---- group_exam ----
        if (type === 'group_exam') {
            var rawResults = result.results;
            if (!isObject(rawResults) || Object.keys(rawResults).length === 0) {
                return Promise.resolve(failure('Results are required for a group exam.'));
            }

            var participants = Array.isArray(match.participants) ? match.participants : [];
            var check = validateResultMap(rawResults, participants, { requireAll: true });
            if (!check.valid) {
                return Promise.resolve(failure(check.message));
            }
            updates.results = check.map;

            // Preservation of existing pairings if present.
            if (match.isPairExam && Array.isArray(match.pairings)) {
                updates.isPairExam = true;
                updates.pairings = deepClone(match.pairings);
            }
        }

        // ---- team_vs_team ----
        if (type === 'team_vs_team') {
            var rawTeam = result.teamResults;
            var rawInd = result.individualResults || {};

            if (!isObject(rawTeam) || Object.keys(rawTeam).length === 0) {
                return Promise.resolve(failure('teamResults are required for a team match.'));
            }

            var teams = Array.isArray(match.participants) ? match.participants : [];
            var teamCheck = validateResultMap(rawTeam, teams, { requireAll: true });
            if (!teamCheck.valid) {
                return Promise.resolve(failure(teamCheck.message));
            }
            updates.teamResults = teamCheck.map;

            // individualResults: any subset of character IDs, each
            // value must be pass | fail | retry. We don't validate
            // against the teams here — that's a Rules concern.
            if (isObject(rawInd)) {
                var indCheck = validateResultMap(rawInd, null, { requireAll: false, allowUnlisted: true });
                if (!indCheck.valid) {
                    return Promise.resolve(failure(indCheck.message));
                }
                updates.individualResults = indCheck.map;
            }
        }

        // ---- standard (legacy) ----
        if (type === 'standard') {
            if (!result.winner) {
                return Promise.resolve(failure('Winner is required for a standard match.'));
            }
            var winnerNormalised = normaliseId(result.winner);
            var matchParticipants = Array.isArray(match.participants) ? match.participants : [];
            if (winnerNormalised === null || matchParticipants.indexOf(winnerNormalised) === -1) {
                return Promise.resolve(failure('Winner must be a participant in the match.'));
            }
            // Preserve legacy path only for existing standard matches.
            updates.winner = winnerNormalised;
        }

        // ---- build proposed ----
        var proposed;
        if (type === 'standard') {
            proposed = Object.assign({}, match);
            proposed.status = 'completed';
            proposed.winner = updates.winner;
            // buildProposedMatch handles the new types; standard we
            // just merge manually.
        } else {
            proposed = buildProposedMatch(match, updates, tournament, round, {
                allowCompletion: true
            });
        }

        if (!proposed) {
            return Promise.resolve(failure('Failed to build completed match.'));
        }

        var validationResult = validateProposedMatch(proposed, tournament, round, matchIndexCopy);
        if (!validationResult.valid) {
            return Promise.resolve(failure(validationResult.errors.join('; ')));
        }

        var completedMatch = deepClone(proposed);

        return executeMutation({
            validate: function() {
                var currentRounds = getRounds(tournamentId);
                if (roundIndexCopy < 0 || roundIndexCopy >= currentRounds.length) {
                    return { valid: false, message: 'Round no longer exists.' };
                }
                var currentRound = currentRounds[roundIndexCopy];
                if (currentRound.status === 'completed') {
                    return { valid: false, message: 'Round is completed.' };
                }
                if (!Array.isArray(currentRound.matches) ||
                    matchIndexCopy >= currentRound.matches.length) {
                    return { valid: false, message: 'Match no longer exists.' };
                }
                var currentMatch = currentRound.matches[matchIndexCopy];
                if (currentMatch && currentMatch.status === 'completed') {
                    return { valid: false, message: 'Match is already completed.' };
                }
                return { valid: true };
            },
            mutate: function(data) {
                var targetTournament = findTournament(data, tournamentId);
                if (!targetTournament) {
                    throw new Error('Tournament not found in data store.');
                }
                var targetRound = targetTournament.rounds[roundIndexCopy];
                var targetMatch = targetRound.matches[matchIndexCopy];
                applyMatchUpdate(targetMatch, completedMatch);
                return { match: targetMatch };
            },
            logMessage: 'Completed match in round ' + (roundIndexCopy + 1),
            successMessage: 'Match completed successfully.',
            failureMessage: 'Failed to complete match.'
        });
    }

    // ============================================================
    // PUBLIC COMMANDS - AUTO-GENERATE MATCHES
    // ============================================================

    /**
     * Auto-generate matches for a round from the eligible participant
     * pool, partitioning into groups of round.matchSize.
     *
     * options.matchSize overrides round.matchSize for this generation.
     * options.pairingMode: 'pairs' uses size 2 or 3 for pair exams.
     *
     * All created matches go through a SINGLE pipeline transaction.
     */
    function generateMatches(tournamentId, roundIndex, options) {
        options = options || {};

        var tournament = getTournamentById(tournamentId);
        if (!tournament) {
            return Promise.resolve(failure('Tournament not found.'));
        }

        var rounds = getRounds(tournamentId);
        var roundIndexCopy = parseInt(roundIndex, 10);
        if (isNaN(roundIndexCopy) || roundIndexCopy < 0 || roundIndexCopy >= rounds.length) {
            return Promise.resolve(failure('Round not found.'));
        }

        var round = rounds[roundIndexCopy];
        if (!round) {
            return Promise.resolve(failure('Round not found.'));
        }

        if (round.status === 'completed') {
            return Promise.resolve(failure('Cannot add matches to a completed round.'));
        }

        // ---- determine match size ----
        var matchSize = parseInt(options.matchSize, 10);
        if (isNaN(matchSize) || matchSize < 2) {
            matchSize = round.matchSize || 2;
        }

        var isPairExam = round.isPairExam === true || options.isPairExam === true;
        if (isPairExam) {
            // Pair exams use groups of 2 or 3.
            matchSize = 2;
        }

        // ---- eligible pool ----
        var pool = getEligibleParticipants(tournamentId);

        // If the round already has matches, exclude anyone already
        // assigned to them (in this round) to avoid duplicate placements.
        var alreadyInRound = {};
        if (Array.isArray(round.matches)) {
            for (var m = 0; m < round.matches.length; m++) {
                var existing = round.matches[m];
                if (existing && Array.isArray(existing.participants)) {
                    for (var p = 0; p < existing.participants.length; p++) {
                        var pid = normaliseId(existing.participants[p]);
                        if (pid !== null) {
                            alreadyInRound[pid] = true;
                        }
                    }
                }
            }
        }

        var eligible = pool.filter(function(id) {
            return !alreadyInRound[id];
        });

        if (eligible.length < 2) {
            return Promise.resolve(failure(
                'Not enough eligible participants to generate a match ' +
                '(need at least 2, have ' + eligible.length + ').'
            ));
        }

        // ---- partition ----
        var partitions = null;
        if (isPairExam) {
            partitions = partitionIntoPairs(eligible);
        } else {
            partitions = partitionIntoGroups(eligible, matchSize);
        }

        if (!partitions || partitions.length === 0) {
            return Promise.resolve(failure('Could not partition participants.'));
        }

        // ---- build all proposed matches ----
        var proposedMatches = [];
        var matchType = round.matchType || 'group_exam';
        if (isPairExam && matchType !== 'group_exam') {
            matchType = 'group_exam';
        }

        for (var i = 0; i < partitions.length; i++) {
            var group = partitions[i];
            var base = buildMatch([], { matchType: matchType, isPairExam: isPairExam });
            var updates = {
                participants: group,
                type: matchType
            };
            if (isPairExam) {
                updates.isPairExam = true;
                updates.pairings = [group.slice()];
            }
            var proposed = buildProposedMatch(base, updates, tournament, round);
            if (!proposed) {
                return Promise.resolve(failure('Failed to build match for group ' + (i + 1) + '.'));
            }
            proposedMatches.push(proposed);
        }

        // ---- commit all in one transaction ----
        return executeMutation({
            validate: function() {
                var currentRounds = getRounds(tournamentId);
                if (roundIndexCopy < 0 || roundIndexCopy >= currentRounds.length) {
                    return { valid: false, message: 'Round no longer exists.' };
                }
                if (currentRounds[roundIndexCopy].status === 'completed') {
                    return { valid: false, message: 'Round is completed.' };
                }
                return { valid: true };
            },
            mutate: function(data) {
                var targetTournament = findTournament(data, tournamentId);
                if (!targetTournament) {
                    throw new Error('Tournament not found in data store.');
                }
                var targetRound = targetTournament.rounds[roundIndexCopy];
                if (!Array.isArray(targetRound.matches)) {
                    targetRound.matches = [];
                }
                var created = [];
                for (var k = 0; k < proposedMatches.length; k++) {
                    var copy = deepClone(proposedMatches[k]);
                    targetRound.matches.push(copy);
                    created.push(copy);
                }
                return { createdCount: created.length, matches: created };
            },
            logMessage: 'Generated ' + proposedMatches.length + ' match(es) in round ' + (roundIndexCopy + 1),
            successMessage: 'Matches generated successfully.',
            failureMessage: 'Failed to generate matches.'
        });
    }

    // ============================================================
    // PARTITION HELPERS
    // ============================================================

    /**
     * Partition an array of IDs into groups of size groupSize.
     * Any leftover partial group is dropped if it has fewer than 2
     * members (nobody should be in a 1-person match).
     */
    function partitionIntoGroups(ids, groupSize) {
        if (!Array.isArray(ids) || ids.length < 2) { return []; }
        if (groupSize < 2) { groupSize = 2; }

        // Shuffle a copy so distribution isn't alphabetical/by-input-order.
        var pool = ids.slice();
        for (var s = pool.length - 1; s > 0; s--) {
            var r = Math.floor(Math.random() * (s + 1));
            var tmp = pool[s];
            pool[s] = pool[r];
            pool[r] = tmp;
        }

        var groups = [];
        for (var i = 0; i < pool.length; i += groupSize) {
            var slice = pool.slice(i, i + groupSize);
            if (slice.length >= 2) {
                groups.push(slice);
            }
        }

        return groups;
    }

    /**
     * Partition an array of IDs into pairs (size 2) with odd leftovers
     * forming a triple (size 3).
     *
     * Rules:
     *   - If the count is even, all groups are size 2.
     *   - If the count is odd, one group becomes size 3, rest size 2.
     *   - If the count is exactly 3, one group of size 3.
     */
    function partitionIntoPairs(ids) {
        if (!Array.isArray(ids) || ids.length < 2) { return []; }

        // Shuffle
        var pool = ids.slice();
        for (var s = pool.length - 1; s > 0; s--) {
            var r = Math.floor(Math.random() * (s + 1));
            var tmp = pool[s];
            pool[s] = pool[r];
            pool[r] = tmp;
        }

        var groups = [];
        var i = 0;

        if (pool.length % 2 === 1 && pool.length >= 3) {
            // Pull the first three into one group, then pair the rest.
            groups.push(pool.slice(0, 3));
            i = 3;
        }

        for (; i < pool.length; i += 2) {
            var slice = pool.slice(i, i + 2);
            if (slice.length === 2) {
                groups.push(slice);
            } else if (slice.length === 1) {
                // Should not happen given parity handling, but if it
                // does, append to the last group rather than creating a
                // 1-person group.
                if (groups.length > 0) {
                    groups[groups.length - 1].push(slice[0]);
                }
            }
        }

        return groups;
    }

    // ============================================================
    // INTERNAL HELPERS
    // ============================================================

    function findTournament(data, tournamentId) {
        if (!data || !Array.isArray(data.tournaments)) {
            return null;
        }
        var target = normaliseId(tournamentId);
        if (target === null) { return null; }
        for (var i = 0; i < data.tournaments.length; i++) {
            var t = data.tournaments[i];
            if (t && normaliseId(t.id) === target) {
                return t;
            }
        }
        return null;
    }

    function applyMatchUpdate(target, updated) {
        var keys = [
            'participants', 'type', 'status',
            'winner', 'loser', 'advancing',
            'results', 'isPairExam', 'pairings',
            'teamResults', 'individualResults'
        ];
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (updated[key] !== undefined) {
                target[key] = updated[key];
            } else {
                delete target[key];
            }
        }
    }

    // ============================================================
    // READ OPERATIONS (delegated to Queries)
    // ============================================================

    function getRoundMatches(tournamentId, roundIndex) {
        var Queries = getQueries();
        if (Queries && typeof Queries.getMatches === 'function') {
            return Queries.getMatches(tournamentId, roundIndex);
        }
        return [];
    }

    function getMatchWrapper(tournamentId, roundIndex, matchIndex) {
        return getMatch(tournamentId, roundIndex, matchIndex);
    }

    function isMatchComplete(tournamentId, roundIndex, matchIndex) {
        var match = getMatch(tournamentId, roundIndex, matchIndex);
        if (!match) { return false; }
        return match.status === 'completed';
    }

    function getMatchAdvancing(tournamentId, roundIndex, matchIndex) {
        var match = getMatch(tournamentId, roundIndex, matchIndex);
        if (!match) { return []; }
        var Schema = getSchema();
        if (Schema && typeof Schema.deriveAdvancing === 'function') {
            return Schema.deriveAdvancing(match);
        }
        return [];
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentMatches = {
        // Public mutation commands (via MutationPipeline)
        createMatch: createMatch,
        removeMatch: removeMatch,
        updateMatch: updateMatch,
        completeMatch: completeMatch,
        generateMatches: generateMatches,

        // Eligibility helpers
        isEligibleForNewMatch: isEligibleForNewMatch,
        getEligibleParticipants: getEligibleParticipants,

        // Internal pure builders (used by Core.addRound)
        buildMatch: buildMatch,
        buildRound: buildRound,
        buildProposedMatch: buildProposedMatch,

        // Validation
        validateProposedMatch: validateProposedMatch,
        validateMatchParticipants: validateMatchParticipants,
        validateResultMap: validateResultMap,
        isTypeChangeAllowed: isTypeChangeAllowed,

        // Partition helpers (exposed for testing/reuse)
        partitionIntoGroups: partitionIntoGroups,
        partitionIntoPairs: partitionIntoPairs,

        // Read operations
        getRoundMatches: getRoundMatches,
        getMatch: getMatchWrapper,
        isMatchComplete: isMatchComplete,
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
            'completeMatch', 'generateMatches',
            'isEligibleForNewMatch', 'getEligibleParticipants',
            'buildMatch', 'buildRound', 'buildProposedMatch',
            'validateProposedMatch', 'validateMatchParticipants',
            'validateResultMap', 'isTypeChangeAllowed',
            'partitionIntoGroups', 'partitionIntoPairs',
            'getRoundMatches', 'getMatch', 'isMatchComplete',
            'getMatchAdvancing'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[TournamentMatches] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();