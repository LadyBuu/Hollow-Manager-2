/**
 * modules/tournaments/tournament-schema.js - Tournament Schema
 * Single source of truth for tournament structure and validation
 * Path: js/modules/tournaments/tournament-schema.js
 * 
 * This module is responsible for:
 *   - Structural validation of tournaments
 *   - Canonical representation rules
 *   - Participant identity management
 *   - Domain derivations (when purely structural)
 * 
 * IMPORTANT:
 *   - Schema is the CONSTITUTIONAL AUTHORITY for tournament structure
 *   - Does NOT know about characters/teams in the wider application
 *   - Does NOT call saveData()
 *   - Does NOT perform business-rule validation (that belongs in Rules)
 *   - Does NOT perform lifecycle validation (that belongs in Lifecycle)
 *   - strict=true: reports unknown fields as warnings, validates canonical structure
 *   - strict=false: minimal structural validation, ignores unknown fields
 *   - Exported constants are FROZEN to prevent mutation
 *   - cloneTournament() preserves ALL properties (exact defensive copy)
 *   - normaliseTournament() produces canonical structural representation
 * 
 * SCHEMA vs LIFECYCLE vs RULES DISTINCTION:
 *   - Schema: "Is this tournament structurally valid?"
 *   - Lifecycle: "Is this operation allowed for this status?"
 *   - Rules: "Are the domain conditions satisfied?"
 * 
 * DEPENDENCIES:
 *   - window.CalendarConstants (from calendar-constants.js) - MANDATORY
 *   - window.ObjectUtils (from object-utils.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 * 
 * USAGE:
 *   var Schema = window.TournamentSchema;
 *   var validation = Schema.validateTournament(tournament, { strict: true });
 *   if (!validation.valid) { console.log(validation.errors); }
 *   var canonical = Schema.normaliseTournament(tournament);
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__tournamentSchemaLoaded) {
        return;
    }

    // ============================================================
    // LAZY LOADING HELPERS
    // ============================================================

    function getCalendarConstants() {
        return window.CalendarConstants || window.CalendarConstants || null;
    }

    function getObjectUtils() {
        return window.ObjectUtils || null;
    }

    function getIdUtils() {
        return window.IdUtils || null;
    }

    // ============================================================
    // GET BOUNDS - Lazy load from CalendarConstants
    // ============================================================

    function getBounds() {
        var CC = getCalendarConstants();
        if (!CC) {
            // Default bounds if CalendarConstants not loaded yet
            return {
                MIN_WEEK: 1,
                MAX_WEEK: 52,
                MIN_YEAR: 1900,
                MAX_YEAR: 2100
            };
        }
        return {
            MIN_WEEK: CC.MIN_WEEK || 1,
            MAX_WEEK: CC.MAX_WEEK || 52,
            MIN_YEAR: CC.MIN_YEAR || 1900,
            MAX_YEAR: CC.MAX_YEAR || 2100
        };
    }

    // ============================================================
    // DEPENDENCY CHECK - Warns but doesn't fail
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!getCalendarConstants()) {
            missing.push('CalendarConstants (lazy)');
        }
        if (!getObjectUtils()) {
            missing.push('ObjectUtils (lazy)');
        }
        if (!getIdUtils()) {
            missing.push('IdUtils (lazy)');
        }

        if (missing.length > 0) {
            console.warn('[TournamentSchema] Some dependencies not yet loaded:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // CONSTANTS - DEEP FROZEN
    // ============================================================

    var bounds = getBounds();
    var MIN_WEEK = bounds.MIN_WEEK;
    var MAX_WEEK = bounds.MAX_WEEK;

    var VALID_STATUSES = Object.freeze(['draft', 'active', 'completed']);
    var VALID_MODES = Object.freeze(['teams', 'individuals']);
    var VALID_MATCH_TYPES = Object.freeze(['standard', 'group_exam']);
    var VALID_MATCH_STATUSES = Object.freeze(['pending', 'in_progress', 'completed']);
    var VALID_PARTICIPANT_TYPES = Object.freeze(['character', 'team']);
    var VALID_GROUP_EXAM_RESULTS = Object.freeze(['pass', 'fail']);

    // ============================================================
    // ID NORMALISATION - Delegates to IdUtils
    // ============================================================

    /**
     * Normalise an ID to canonical string form.
     * Rejects objects, numbers, and non-string values.
     * This is the SINGLE SOURCE OF TRUTH for ID normalisation.
     * 
     * @param {*} value - Value to normalise
     * @returns {string|null} Normalised ID or null
     */
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

    // ============================================================
    // CLONING - Exact defensive copies
    // ============================================================

    /**
     * Deep clone any value using the canonical cloning utility.
     * Preserves ALL properties, including unknown ones.
     * 
     * @param {*} value - Value to clone
     * @returns {*} Deep clone of value
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
        try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
    }

    /**
     * Clone a participant record exactly.
     * Preserves all properties.
     * 
     * @param {object} participant - Participant record
     * @returns {object} Cloned participant
     */
    function cloneParticipant(participant) {
        if (!participant || typeof participant !== 'object') {
            return null;
        }
        return deepClone(participant);
    }

    /**
     * Clone a match exactly.
     * Preserves all properties.
     * 
     * @param {object} match - Match object
     * @returns {object} Cloned match
     */
    function cloneMatch(match) {
        if (!match || typeof match !== 'object') {
            return null;
        }
        return deepClone(match);
    }

    /**
     * Clone a round exactly.
     * Preserves all properties.
     * 
     * @param {object} round - Round object
     * @returns {object} Cloned round
     */
    function cloneRound(round) {
        if (!round || typeof round !== 'object') {
            return null;
        }
        return deepClone(round);
    }

    /**
     * Clone an elimination record exactly.
     * Preserves all properties.
     * 
     * @param {object} elimination - Elimination record
     * @returns {object} Cloned elimination
     */
    function cloneElimination(elimination) {
        if (!elimination || typeof elimination !== 'object') {
            return null;
        }
        return deepClone(elimination);
    }

    /**
     * Clone a tournament exactly.
     * Preserves ALL properties, including unknown ones.
     * This is a DEFENSIVE COPY, not a canonicalisation.
     * 
     * @param {object} tournament - Tournament object
     * @returns {object} Cloned tournament
     */
    function cloneTournament(tournament) {
        if (!tournament || typeof tournament !== 'object') {
            return null;
        }
        return deepClone(tournament);
    }

    // ============================================================
    // CANONICAL NORMALISATION - Structural representation
    // ============================================================

    /**
     * Normalise a participant to canonical form.
     * Preserves unknown properties.
     * 
     * @param {object} participant - Participant record
     * @param {string} mode - Tournament mode
     * @returns {object|null} Normalised participant or null
     */
    function normaliseParticipant(participant, mode) {
        if (!participant || typeof participant !== 'object') {
            return null;
        }

        var id = normaliseId(participant.id);
        if (id === null) {
            return null;
        }

        var canonicalType = getCanonicalParticipantType(mode);
        if (canonicalType === null) {
            return null;
        }

        var result = {
            id: id,
            type: canonicalType
        };

        // Preserve unknown properties
        var knownKeys = ['id', 'type'];
        Object.keys(participant).forEach(function(key) {
            if (knownKeys.indexOf(key) === -1) {
                result[key] = participant[key];
            }
        });

        return result;
    }

    /**
     * Normalise a match to canonical form.
     * Preserves unknown properties.
     * 
     * @param {object} match - Match object
     * @param {number} expectedSize - Expected participant count
     * @returns {object|null} Normalised match or null
     */
    function normaliseMatch(match, expectedSize) {
        if (!match || typeof match !== 'object') {
            return null;
        }

        var participants = [];
        if (Array.isArray(match.participants)) {
            for (var i = 0; i < match.participants.length; i++) {
                var id = normaliseId(match.participants[i]);
                if (id !== null) {
                    participants.push(id);
                }
            }
        }

        if (participants.length !== expectedSize) {
            return null;
        }

        var type = match.type || 'standard';
        if (VALID_MATCH_TYPES.indexOf(type) === -1) {
            return null;
        }

        var status = match.status || 'pending';
        if (VALID_MATCH_STATUSES.indexOf(status) === -1) {
            return null;
        }

        var result = {
            participants: participants,
            type: type,
            status: status,
            winner: match.winner !== undefined && match.winner !== null
                ? normaliseId(match.winner)
                : null,
            loser: match.loser !== undefined && match.loser !== null
                ? normaliseId(match.loser)
                : null,
            advancing: Array.isArray(match.advancing)
                ? match.advancing.map(normaliseId).filter(function(id) { return id !== null; })
                : [],
            results: {}
        };

        // Normalise group exam results
        if (type === 'group_exam' && match.results && typeof match.results === 'object') {
            var results = {};
            var seen = {};
            for (var key in match.results) {
                if (!Object.prototype.hasOwnProperty.call(match.results, key)) {
                    continue;
                }
                var id = normaliseId(key);
                if (id === null) {
                    continue;
                }
                if (seen[id]) {
                    continue;
                }
                seen[id] = true;
                var value = match.results[key];
                if (VALID_GROUP_EXAM_RESULTS.indexOf(value) !== -1) {
                    results[id] = value;
                }
            }
            result.results = results;
        }

        // Preserve unknown properties
        var knownKeys = ['participants', 'type', 'status', 'winner', 'loser', 'advancing', 'results'];
        Object.keys(match).forEach(function(key) {
            if (knownKeys.indexOf(key) === -1) {
                result[key] = match[key];
            }
        });

        return result;
    }

    /**
     * Normalise a round to canonical form.
     * Preserves unknown properties.
     * 
     * @param {object} round - Round object
     * @param {number} index - Round index (for roundNumber)
     * @returns {object|null} Normalised round or null
     */
    function normaliseRound(round, index) {
        if (!round || typeof round !== 'object') {
            return null;
        }

        var status = round.status || 'pending';
        if (VALID_MATCH_STATUSES.indexOf(status) === -1) {
            return null;
        }

        var matchSize = typeof round.matchSize === 'number' && round.matchSize >= 2
            ? round.matchSize
            : 2;

        var matchType = round.matchType || 'standard';
        if (VALID_MATCH_TYPES.indexOf(matchType) === -1) {
            return null;
        }

        var matches = [];
        if (Array.isArray(round.matches)) {
            for (var i = 0; i < round.matches.length; i++) {
                var normalisedMatch = normaliseMatch(round.matches[i], matchSize);
                if (normalisedMatch !== null) {
                    matches.push(normalisedMatch);
                }
            }
        }

        var result = {
            roundNumber: (index !== undefined && index !== null) ? index + 1 : 1,
            status: status,
            matchSize: matchSize,
            matchType: matchType,
            matches: matches
        };

        // Preserve unknown properties
        var knownKeys = ['roundNumber', 'status', 'matchSize', 'matchType', 'matches'];
        Object.keys(round).forEach(function(key) {
            if (knownKeys.indexOf(key) === -1) {
                result[key] = round[key];
            }
        });

        return result;
    }

    /**
     * Normalise an elimination record to canonical form.
     * Preserves unknown properties.
     * 
     * @param {object} elimination - Elimination record
     * @returns {object|null} Normalised elimination or null
     */
    function normaliseElimination(elimination) {
        if (!elimination || typeof elimination !== 'object') {
            return null;
        }

        var participantId = normaliseId(elimination.participantId);
        if (participantId === null) {
            return null;
        }

        var tournamentId = normaliseId(elimination.tournamentId);
        if (tournamentId === null) {
            return null;
        }

        var week = typeof elimination.week === 'number' && elimination.week >= MIN_WEEK && elimination.week <= MAX_WEEK
            ? elimination.week
            : null;

        if (week === null) {
            return null;
        }

        var participantType = elimination.participantType || null;
        if (participantType !== null && VALID_PARTICIPANT_TYPES.indexOf(participantType) === -1) {
            return null;
        }

        var result = {
            participantId: participantId,
            tournamentId: tournamentId,
            participantType: participantType,
            week: week,
            reason: typeof elimination.reason === 'string' ? elimination.reason : '',
            standalone: elimination.standalone === true
        };

        // Preserve unknown properties
        var knownKeys = ['participantId', 'tournamentId', 'participantType', 'week', 'reason', 'standalone'];
        Object.keys(elimination).forEach(function(key) {
            if (knownKeys.indexOf(key) === -1) {
                result[key] = elimination[key];
            }
        });

        return result;
    }

    /**
     * Normalise a tournament to canonical form.
     * Preserves unknown top-level properties.
     * This is a STRUCTURAL NORMALISATION, not a clone.
     * 
     * @param {object} tournament - Tournament object
     * @returns {object|null} Normalised tournament or null
     */
    function normaliseTournament(tournament) {
        if (!tournament || typeof tournament !== 'object') {
            return null;
        }

        var id = normaliseId(tournament.id);
        if (id === null) {
            return null;
        }

        var name = typeof tournament.name === 'string' ? tournament.name.trim() : '';
        if (name === '') {
            return null;
        }

        var mode = tournament.mode || 'individuals';
        if (VALID_MODES.indexOf(mode) === -1) {
            return null;
        }

        var startWeek = typeof tournament.startWeek === 'number' && tournament.startWeek >= MIN_WEEK && tournament.startWeek <= MAX_WEEK
            ? tournament.startWeek
            : null;

        if (startWeek === null) {
            return null;
        }

        var endWeek = typeof tournament.endWeek === 'number' && tournament.endWeek >= MIN_WEEK && tournament.endWeek <= MAX_WEEK
            ? tournament.endWeek
            : null;

        if (endWeek === null) {
            return null;
        }

        if (startWeek > endWeek) {
            return null;
        }

        var totalRounds = typeof tournament.totalRounds === 'number' && tournament.totalRounds >= 1
            ? tournament.totalRounds
            : null;

        if (totalRounds === null) {
            return null;
        }

        var status = tournament.status || 'draft';
        if (VALID_STATUSES.indexOf(status) === -1) {
            return null;
        }

        // Normalise participants
        var participants = [];
        if (Array.isArray(tournament.participants)) {
            for (var i = 0; i < tournament.participants.length; i++) {
                var normalisedParticipant = normaliseParticipant(tournament.participants[i], mode);
                if (normalisedParticipant !== null) {
                    // Check for duplicates
                    var duplicate = false;
                    for (var j = 0; j < participants.length; j++) {
                        if (participants[j].id === normalisedParticipant.id) {
                            duplicate = true;
                            break;
                        }
                    }
                    if (!duplicate) {
                        participants.push(normalisedParticipant);
                    }
                }
            }
        }

        // Normalise rounds
        var rounds = [];
        if (Array.isArray(tournament.rounds)) {
            for (var i = 0; i < tournament.rounds.length; i++) {
                var normalisedRound = normaliseRound(tournament.rounds[i], i);
                if (normalisedRound !== null) {
                    rounds.push(normalisedRound);
                }
            }
        }

        // Normalise eliminations
        var eliminations = [];
        if (Array.isArray(tournament.eliminations)) {
            for (var i = 0; i < tournament.eliminations.length; i++) {
                var normalisedElimination = normaliseElimination(tournament.eliminations[i]);
                if (normalisedElimination !== null) {
                    // Check for duplicate participant
                    var duplicate = false;
                    for (var j = 0; j < eliminations.length; j++) {
                        if (eliminations[j].participantId === normalisedElimination.participantId &&
                            eliminations[j].tournamentId === normalisedElimination.tournamentId) {
                            duplicate = true;
                            break;
                        }
                    }
                    if (!duplicate) {
                        eliminations.push(normalisedElimination);
                    }
                }
            }
        }

        // Normalise winner
        var winner = null;
        if (tournament.winner !== undefined && tournament.winner !== null) {
            if (typeof tournament.winner === 'object') {
                var winnerId = normaliseId(tournament.winner.id);
                if (winnerId !== null) {
                    var winnerType = tournament.winner.type || null;
                    if (winnerType === null || VALID_PARTICIPANT_TYPES.indexOf(winnerType) !== -1) {
                        winner = {
                            id: winnerId,
                            type: winnerType
                        };
                        // Preserve unknown winner properties
                        var knownWinnerKeys = ['id', 'type'];
                        Object.keys(tournament.winner).forEach(function(key) {
                            if (knownWinnerKeys.indexOf(key) === -1) {
                                winner[key] = tournament.winner[key];
                            }
                        });
                    }
                }
            } else {
                var winnerId = normaliseId(tournament.winner);
                if (winnerId !== null) {
                    winner = {
                        id: winnerId,
                        type: null
                    };
                }
            }
        }

        // Graduating class fields
        var graduatingClassId = tournament.graduatingClassId !== undefined && tournament.graduatingClassId !== null
            ? normaliseId(tournament.graduatingClassId)
            : null;

        var classFilterEnabled = typeof tournament.classFilterEnabled === 'boolean'
            ? tournament.classFilterEnabled
            : false;

        // Created at - preserve if valid
        var createdAt = tournament.createdAt || null;
        if (createdAt !== null && typeof createdAt !== 'string') {
            createdAt = null;
        }

        var result = {
            id: id,
            name: name,
            mode: mode,
            startWeek: startWeek,
            endWeek: endWeek,
            totalRounds: totalRounds,
            status: status,
            participants: participants,
            rounds: rounds,
            eliminations: eliminations,
            winner: winner,
            graduatingClassId: graduatingClassId,
            classFilterEnabled: classFilterEnabled,
            createdAt: createdAt,
            _schemaVersion: 2
        };

        // Preserve unknown top-level properties
        var knownTopKeys = [
            'id', 'name', 'mode', 'startWeek', 'endWeek', 'totalRounds',
            'status', 'participants', 'rounds', 'eliminations', 'winner',
            'graduatingClassId', 'classFilterEnabled', 'createdAt', '_schemaVersion'
        ];

        Object.keys(tournament).forEach(function(key) {
            if (knownTopKeys.indexOf(key) === -1) {
                result[key] = tournament[key];
            }
        });

        return result;
    }

    // ============================================================
    // TYPE VALIDATION
    // ============================================================

    function isValidMode(mode) {
        return VALID_MODES.indexOf(mode) !== -1;
    }

    function isValidStatus(status) {
        return VALID_STATUSES.indexOf(status) !== -1;
    }

    function isValidMatchType(type) {
        return VALID_MATCH_TYPES.indexOf(type) !== -1;
    }

    function isValidMatchStatus(status) {
        return VALID_MATCH_STATUSES.indexOf(status) !== -1;
    }

    function isValidParticipantType(type) {
        return VALID_PARTICIPANT_TYPES.indexOf(type) !== -1;
    }

    function isValidGroupExamResult(value) {
        return VALID_GROUP_EXAM_RESULTS.indexOf(value) !== -1;
    }

    function isValidGraduatingClassId(value) {
        if (value === undefined || value === null || value === '') {
            return true;
        }
        return normaliseId(value) !== null;
    }

    // ============================================================
    // PARTICIPANT IDENTITY - (id, type) pair
    // ============================================================

    function getCanonicalParticipantType(mode) {
        if (mode === 'teams') return 'team';
        if (mode === 'individuals') return 'character';
        return null;
    }

    function isParticipantTypeCanonical(mode, type) {
        return type === getCanonicalParticipantType(mode);
    }

    function getParticipantTypeFromRecord(tournament, participantId) {
        if (!tournament || !Array.isArray(tournament.participants)) {
            return null;
        }
        var id = normaliseId(participantId);
        if (id === null) {
            return null;
        }

        for (var i = 0; i < tournament.participants.length; i++) {
            var p = tournament.participants[i];
            if (p && normaliseId(p.id) === id) {
                return p.type || null;
            }
        }
        return null;
    }

    function isParticipantInTournament(tournament, participantId, participantType) {
        if (!tournament || !Array.isArray(tournament.participants)) {
            return false;
        }
        var id = normaliseId(participantId);
        if (id === null) {
            return false;
        }

        for (var i = 0; i < tournament.participants.length; i++) {
            var p = tournament.participants[i];
            if (!p) {
                continue;
            }
            if (normaliseId(p.id) === id) {
                if (participantType !== undefined && participantType !== null) {
                    if (p.type === participantType) {
                        return true;
                    }
                } else {
                    return true;
                }
            }
        }
        return false;
    }

    function getParticipantIdKey(participant) {
        if (!participant || typeof participant !== 'object') {
            return null;
        }
        var id = normaliseId(participant.id);
        if (id === null) {
            return null;
        }
        return id + ':' + (participant.type || 'unknown');
    }

    function getParticipantIdKeyFromParts(id, type) {
        var normId = normaliseId(id);
        if (normId === null) {
            return null;
        }
        return normId + ':' + (type || 'unknown');
    }

    function participantMatches(p1, p2) {
        if (!p1 || !p2) {
            return false;
        }
        var id1 = normaliseId(p1.id);
        var id2 = normaliseId(p2.id);
        if (id1 === null || id2 === null) {
            return false;
        }
        if (id1 !== id2) {
            return false;
        }
        return (p1.type || null) === (p2.type || null);
    }

    // ============================================================
    // PARTICIPANT ELIMINATION CHECK
    // ============================================================

    function isParticipantEliminated(tournament, participantId) {
        if (!tournament || !Array.isArray(tournament.eliminations)) {
            return false;
        }
        var id = normaliseId(participantId);
        if (id === null) {
            return false;
        }

        for (var i = 0; i < tournament.eliminations.length; i++) {
            var e = tournament.eliminations[i];
            if (e && normaliseId(e.participantId) === id) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // STRUCTURAL GETTERS - Return DEFENSIVE COPIES
    // ============================================================

    function getParticipants(tournament) {
        if (!tournament || !Array.isArray(tournament.participants)) {
            return [];
        }
        return tournament.participants.map(cloneParticipant).filter(function(p) { return p !== null; });
    }

    function getRounds(tournament) {
        if (!tournament || !Array.isArray(tournament.rounds)) {
            return [];
        }
        return tournament.rounds.map(cloneRound).filter(function(r) { return r !== null; });
    }

    function getEliminations(tournament) {
        if (!tournament || !Array.isArray(tournament.eliminations)) {
            return [];
        }
        return tournament.eliminations.map(cloneElimination).filter(function(e) { return e !== null; });
    }

    function getWinner(tournament) {
        if (!tournament || !tournament.winner) {
            return null;
        }
        return cloneParticipant(tournament.winner);
    }

    // ============================================================
    // DERIVATION - Canonical
    // ============================================================

    /**
     * Derive advancing participants from a match state.
     * This is the SINGLE SOURCE OF TRUTH for advancing.
     * 
     * Standard matches: winner advances (if winner exists)
     * Group exam matches: participants with 'pass' advance
     * 
     * @param {object} match - Match object with participants, type, winner, results
     * @returns {array} Array of advancing participant IDs
     */
    function deriveAdvancing(match) {
        if (!match || typeof match !== 'object') {
            return [];
        }

        // Standard match: winner advances
        if (match.type === 'standard') {
            if (match.winner) {
                var winnerId = normaliseId(match.winner);
                return winnerId !== null ? [winnerId] : [];
            }
            return [];
        }

        // Group exam: participants with 'pass' advance
        if (match.type === 'group_exam') {
            var advancing = [];
            var participants = Array.isArray(match.participants) ? match.participants : [];

            for (var i = 0; i < participants.length; i++) {
                var id = normaliseId(participants[i]);
                if (id === null) {
                    continue;
                }
                if (match.results && match.results[id] === 'pass') {
                    advancing.push(id);
                }
            }
            return advancing;
        }

        return [];
    }

    /**
     * Derive loser from participants and winner.
     * Returns null if loser cannot be unambiguously derived.
     * 
     * @param {array} participants - Array of participant IDs
     * @param {string} winner - Winner ID
     * @returns {string|null} Loser ID or null
     */
    function deriveLoser(participants, winner) {
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

    // ============================================================
    // STRUCTURAL VALIDATION - ONLY
    // ============================================================

    function validateParticipant(participant, mode) {
        var errors = [];

        if (!participant || typeof participant !== 'object') {
            errors.push('Participant must be an object.');
            return errors;
        }

        var id = normaliseId(participant.id);
        if (id === null) {
            errors.push('Participant ID is required.');
        }

        var type = participant.type || null;
        var canonicalType = getCanonicalParticipantType(mode);
        if (canonicalType === null) {
            errors.push('Cannot determine canonical participant type for mode: ' + mode);
        } else if (type !== canonicalType) {
            errors.push('Participant type "' + type + '" does not match tournament mode "' + mode + '" (expected "' + canonicalType + '").');
        }

        return errors;
    }

    function validateParticipants(participants, mode) {
        var errors = [];
        var seen = Object.create(null);

        if (!Array.isArray(participants)) {
            errors.push('Participants must be an array.');
            return errors;
        }

        for (var i = 0; i < participants.length; i++) {
            var p = participants[i];
            var pErrors = validateParticipant(p, mode);
            if (pErrors.length > 0) {
                errors.push('Participant ' + i + ': ' + pErrors.join(' '));
                continue;
            }

            var key = getParticipantIdKey(p);
            if (key === null) {
                errors.push('Participant ' + i + ': Invalid participant.');
                continue;
            }

            if (seen[key]) {
                errors.push('Duplicate participant: ' + key);
            }
            seen[key] = true;
        }

        return errors;
    }

    function validateRound(round, strict) {
        var errors = [];

        if (!round || typeof round !== 'object') {
            errors.push('Round must be an object.');
            return errors;
        }

        if (strict !== false) {
            var allowedKeys = ['status', 'matchSize', 'matches', 'matchType'];
            for (var key in round) {
                if (Object.prototype.hasOwnProperty.call(round, key) && allowedKeys.indexOf(key) === -1) {
                    // Unknown fields are warnings in strict mode, not errors
                    // This allows preservation of legacy properties
                }
            }
        }

        var status = round.status || 'pending';
        if (!isValidMatchStatus(status)) {
            errors.push('Invalid round status: ' + status);
        }

        if (round.matchSize !== undefined && round.matchSize !== null) {
            if (typeof round.matchSize !== 'number' || round.matchSize < 2) {
                errors.push('matchSize must be a number >= 2');
            }
        }

        return errors;
    }

    function validateRounds(rounds, strict) {
        var errors = [];

        if (!Array.isArray(rounds)) {
            errors.push('Rounds must be an array.');
            return errors;
        }

        for (var i = 0; i < rounds.length; i++) {
            var rErrors = validateRound(rounds[i], strict);
            if (rErrors.length > 0) {
                errors.push('Round ' + i + ': ' + rErrors.join(' '));
            }
        }

        return errors;
    }

    function validateElimination(elimination, strict) {
        var errors = [];

        if (!elimination || typeof elimination !== 'object') {
            errors.push('Elimination must be an object.');
            return errors;
        }

        if (strict !== false) {
            var allowedKeys = ['participantId', 'tournamentId', 'participantType', 'week', 'reason', 'standalone'];
            for (var key in elimination) {
                if (Object.prototype.hasOwnProperty.call(elimination, key) && allowedKeys.indexOf(key) === -1) {
                    // Unknown fields are warnings in strict mode
                }
            }
        }

        var participantId = normaliseId(elimination.participantId);
        if (participantId === null) {
            errors.push('Elimination participantId is required.');
        }

        if (elimination.participantType !== undefined && elimination.participantType !== null) {
            if (!isValidParticipantType(elimination.participantType)) {
                errors.push('Invalid participantType: ' + elimination.participantType);
            }
        }

        if (elimination.week !== undefined && elimination.week !== null) {
            if (typeof elimination.week !== 'number' || elimination.week < MIN_WEEK || elimination.week > MAX_WEEK) {
                errors.push('Invalid week: ' + elimination.week);
            }
        }

        return errors;
    }

    function validateEliminations(eliminations, strict) {
        var errors = [];
        var seen = Object.create(null);

        if (!Array.isArray(eliminations)) {
            errors.push('Eliminations must be an array.');
            return errors;
        }

        for (var i = 0; i < eliminations.length; i++) {
            var e = eliminations[i];
            var eErrors = validateElimination(e, strict);
            if (eErrors.length > 0) {
                errors.push('Elimination ' + i + ': ' + eErrors.join(' '));
                continue;
            }

            var key = normaliseId(e.participantId);
            if (key !== null) {
                if (seen[key]) {
                    errors.push('Duplicate elimination for participant: ' + key);
                }
                seen[key] = true;
            }
        }

        return errors;
    }

    function validateMatch(match, round, strict) {
        var errors = [];

        if (!match || typeof match !== 'object') {
            errors.push('Match must be an object.');
            return errors;
        }

        if (strict !== false) {
            var allowedKeys = ['participants', 'type', 'status', 'winner', 'loser', 'advancing', 'results'];
            for (var key in match) {
                if (Object.prototype.hasOwnProperty.call(match, key) && allowedKeys.indexOf(key) === -1) {
                    // Unknown fields are warnings in strict mode
                }
            }
        }

        var type = match.type || 'standard';
        if (!isValidMatchType(type)) {
            errors.push('Invalid match type: ' + type);
        }

        var status = match.status || 'pending';
        if (!isValidMatchStatus(status)) {
            errors.push('Invalid match status: ' + status);
        }

        var participants = Array.isArray(match.participants) ? match.participants : [];
        var expectedSize = round && round.matchSize ? round.matchSize : 2;

        if (participants.length !== expectedSize) {
            errors.push('Match has ' + participants.length + ' participants, expected ' + expectedSize);
        }

        // Participant validation
        for (var i = 0; i < participants.length; i++) {
            var id = normaliseId(participants[i]);
            if (id === null) {
                errors.push('Participant ' + i + ': Invalid ID');
            }
        }

        // Group exam: results must be valid
        if (type === 'group_exam') {
            if (match.results && typeof match.results === 'object') {
                var resultKeys = Object.keys(match.results);
                if (resultKeys.length === 0) {
                    errors.push('Group exam has no results.');
                }
                for (var i = 0; i < resultKeys.length; i++) {
                    var key = normaliseId(resultKeys[i]);
                    if (key === null) {
                        errors.push('Invalid result key: ' + resultKeys[i]);
                        continue;
                    }
                    var val = match.results[resultKeys[i]];
                    if (!isValidGroupExamResult(val)) {
                        errors.push('Invalid result for ' + key + ': ' + val);
                    }
                }
            } else {
                if (status === 'completed') {
                    errors.push('Completed group exam has no results.');
                }
            }

            // Group exam cannot have winner/loser
            if (match.winner !== undefined && match.winner !== null) {
                errors.push('Group exam cannot have a winner.');
            }
            if (match.loser !== undefined && match.loser !== null) {
                errors.push('Group exam cannot have a loser.');
            }
        }

        // Standard match: winner must be a participant
        if (type === 'standard') {
            if (status === 'completed') {
                if (match.winner === undefined || match.winner === null) {
                    errors.push('Completed standard match has no winner.');
                } else {
                    var winnerId = normaliseId(match.winner);
                    if (winnerId === null) {
                        errors.push('Invalid winner ID.');
                    } else if (participants.indexOf(winnerId) === -1) {
                        errors.push('Winner ' + winnerId + ' is not a participant.');
                    }
                }

                if (match.loser !== undefined && match.loser !== null) {
                    var loserId = normaliseId(match.loser);
                    if (loserId !== null) {
                        if (loserId === normaliseId(match.winner)) {
                            errors.push('Winner and loser cannot be the same.');
                        }
                        if (participants.indexOf(loserId) === -1) {
                            errors.push('Loser ' + loserId + ' is not a participant.');
                        }
                    }
                }
            }
        }

        // Advancing participants must be valid
        if (Array.isArray(match.advancing)) {
            for (var i = 0; i < match.advancing.length; i++) {
                var advId = normaliseId(match.advancing[i]);
                if (advId === null) {
                    errors.push('Invalid advancing ID: ' + match.advancing[i]);
                } else if (participants.indexOf(advId) === -1) {
                    errors.push('Advancing participant ' + advId + ' is not a participant.');
                }
            }
        }

        return errors;
    }

    function validateMatches(round, strict) {
        var errors = [];

        if (!round || !Array.isArray(round.matches)) {
            errors.push('Round matches must be an array.');
            return errors;
        }

        for (var i = 0; i < round.matches.length; i++) {
            var mErrors = validateMatch(round.matches[i], round, strict);
            if (mErrors.length > 0) {
                errors.push('Match ' + i + ': ' + mErrors.join(' '));
            }
        }

        return errors;
    }

    /**
     * Validate a tournament against the schema.
     * STRUCTURAL ONLY - no lifecycle or business rules.
     * 
     * @param {object} tournament - Tournament to validate
     * @param {object} options - Validation options
     * @param {boolean} options.strict - If true, unknown fields are warnings (not errors)
     * @returns {object} { valid: boolean, errors: array, warnings: array }
     */
    function validateTournament(tournament, options) {
        options = options || {};
        var strict = options.strict !== false;

        var errors = [];
        var warnings = [];

        if (!tournament || typeof tournament !== 'object') {
            errors.push('Tournament must be an object.');
            return { valid: false, errors: errors, warnings: warnings };
        }

        // ID
        var id = normaliseId(tournament.id);
        if (id === null) {
            errors.push('Tournament ID is required.');
        }

        // Name
        if (!tournament.name || typeof tournament.name !== 'string' || tournament.name.trim() === '') {
            errors.push('Tournament name is required.');
        }

        // Mode
        if (!isValidMode(tournament.mode)) {
            errors.push('Invalid mode: ' + tournament.mode);
        }

        // Status
        if (!isValidStatus(tournament.status)) {
            errors.push('Invalid status: ' + tournament.status);
        }

        // Week range
        var startWeek = typeof tournament.startWeek === 'number' ? tournament.startWeek : parseInt(tournament.startWeek, 10);
        var endWeek = typeof tournament.endWeek === 'number' ? tournament.endWeek : parseInt(tournament.endWeek, 10);

        if (isNaN(startWeek) || startWeek < MIN_WEEK || startWeek > MAX_WEEK) {
            errors.push('Invalid startWeek: ' + tournament.startWeek);
        }
        if (isNaN(endWeek) || endWeek < MIN_WEEK || endWeek > MAX_WEEK) {
            errors.push('Invalid endWeek: ' + tournament.endWeek);
        }
        if (!isNaN(startWeek) && !isNaN(endWeek) && startWeek > endWeek) {
            errors.push('startWeek (' + startWeek + ') cannot be after endWeek (' + endWeek + ').');
        }

        // Total rounds
        var totalRounds = typeof tournament.totalRounds === 'number' ? tournament.totalRounds : parseInt(tournament.totalRounds, 10);
        if (isNaN(totalRounds) || totalRounds < 1) {
            errors.push('totalRounds must be >= 1');
        }

        // Graduating class
        if (tournament.graduatingClassId !== undefined && tournament.graduatingClassId !== null) {
            var gradId = normaliseId(tournament.graduatingClassId);
            if (gradId === null) {
                errors.push('Invalid graduatingClassId.');
            }
        }

        // Class filter enabled
        if (tournament.classFilterEnabled !== undefined && typeof tournament.classFilterEnabled !== 'boolean') {
            errors.push('classFilterEnabled must be a boolean.');
        }

        // Strict mode: unknown top-level properties are warnings
        if (strict) {
            var allowedKeys = [
                'id', 'name', 'mode', 'startWeek', 'endWeek', 'totalRounds',
                'status', 'participants', 'rounds', 'eliminations', 'winner',
                'createdAt', '_schemaVersion',
                'graduatingClassId', 'classFilterEnabled'
            ];
            for (var key in tournament) {
                if (Object.prototype.hasOwnProperty.call(tournament, key) && allowedKeys.indexOf(key) === -1) {
                    warnings.push('Unknown top-level property: ' + key);
                }
            }
        }

        // Validate participants
        if (tournament.participants !== undefined) {
            var pErrors = validateParticipants(tournament.participants, tournament.mode);
            if (pErrors.length > 0) {
                errors = errors.concat(pErrors);
            }
        }

        // Validate rounds
        if (tournament.rounds !== undefined) {
            var rErrors = validateRounds(tournament.rounds, strict);
            if (rErrors.length > 0) {
                errors = errors.concat(rErrors);
            }

            // Validate matches inside rounds
            if (Array.isArray(tournament.rounds)) {
                for (var i = 0; i < tournament.rounds.length; i++) {
                    var round = tournament.rounds[i];
                    if (round && Array.isArray(round.matches)) {
                        var mErrors = validateMatches(round, strict);
                        if (mErrors.length > 0) {
                            errors = errors.concat(mErrors);
                        }
                    }
                }
            }
        }

        // Validate eliminations
        if (tournament.eliminations !== undefined) {
            var eErrors = validateEliminations(tournament.eliminations, strict);
            if (eErrors.length > 0) {
                errors = errors.concat(eErrors);
            }
        }

        // Winner must be a participant (structural check only)
        if (tournament.winner && tournament.winner !== null) {
            var winner = tournament.winner;
            var winnerId = normaliseId(winner.id);
            if (winnerId === null) {
                errors.push('Winner has invalid ID.');
            } else if (!isParticipantInTournament(tournament, winnerId)) {
                errors.push('Winner ' + winnerId + ' is not a tournament participant.');
            }
        }

        // NOTE: Status-specific rules (e.g., completed tournament must have winner)
        // have been REMOVED - these belong in Lifecycle/Rules, not Schema

        var valid = errors.length === 0;

        return {
            valid: valid,
            errors: errors,
            warnings: warnings
        };
    }

    // ============================================================
    // GET VALIDATION REPORT - For diagnostics
    // ============================================================

    function getValidationReport(tournament) {
        if (!tournament || typeof tournament !== 'object') {
            return { valid: false, errors: ['Tournament is null or not an object.'] };
        }

        return {
            id: tournament.id ? String(tournament.id) : null,
            name: tournament.name || null,
            mode: tournament.mode || null,
            status: tournament.status || null,
            startWeek: tournament.startWeek !== undefined && tournament.startWeek !== null
                ? Number(tournament.startWeek)
                : null,
            endWeek: tournament.endWeek !== undefined && tournament.endWeek !== null
                ? Number(tournament.endWeek)
                : null,
            totalRounds: tournament.totalRounds !== undefined && tournament.totalRounds !== null
                ? Number(tournament.totalRounds)
                : null,
            graduatingClassId: tournament.graduatingClassId !== undefined && tournament.graduatingClassId !== null
                ? String(tournament.graduatingClassId)
                : null,
            classFilterEnabled: typeof tournament.classFilterEnabled === 'boolean'
                ? tournament.classFilterEnabled
                : null,
            participantCount: Array.isArray(tournament.participants) ? tournament.participants.length : 0,
            roundCount: Array.isArray(tournament.rounds) ? tournament.rounds.length : 0,
            eliminationCount: Array.isArray(tournament.eliminations) ? tournament.eliminations.length : 0,
            hasWinner: tournament.winner !== undefined && tournament.winner !== null,
            createdAt: tournament.createdAt || null,
            _schemaVersion: tournament._schemaVersion || null
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentSchema = {
        // Constants (frozen)
        VALID_STATUSES: VALID_STATUSES,
        VALID_MODES: VALID_MODES,
        VALID_MATCH_TYPES: VALID_MATCH_TYPES,
        VALID_MATCH_STATUSES: VALID_MATCH_STATUSES,
        VALID_PARTICIPANT_TYPES: VALID_PARTICIPANT_TYPES,
        VALID_GROUP_EXAM_RESULTS: VALID_GROUP_EXAM_RESULTS,
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,

        // ID Normalisation
        normaliseId: normaliseId,

        // Cloning (exact copies, preserve all properties)
        deepClone: deepClone,
        cloneTournament: cloneTournament,
        cloneParticipant: cloneParticipant,
        cloneMatch: cloneMatch,
        cloneRound: cloneRound,
        cloneElimination: cloneElimination,

        // Canonical Normalisation
        normaliseTournament: normaliseTournament,
        normaliseParticipant: normaliseParticipant,
        normaliseMatch: normaliseMatch,
        normaliseRound: normaliseRound,
        normaliseElimination: normaliseElimination,

        // Participant Identity
        getCanonicalParticipantType: getCanonicalParticipantType,
        isParticipantTypeCanonical: isParticipantTypeCanonical,
        getParticipantTypeFromRecord: getParticipantTypeFromRecord,
        isParticipantInTournament: isParticipantInTournament,
        getParticipantIdKey: getParticipantIdKey,
        getParticipantIdKeyFromParts: getParticipantIdKeyFromParts,
        participantMatches: participantMatches,

        // Structural Getters (return defensive copies)
        getParticipants: getParticipants,
        getRounds: getRounds,
        getEliminations: getEliminations,
        getWinner: getWinner,

        // Derivation
        deriveAdvancing: deriveAdvancing,
        deriveLoser: deriveLoser,

        // Structural Validation (ONLY - no lifecycle/business rules)
        isValidMode: isValidMode,
        isValidStatus: isValidStatus,
        isValidMatchType: isValidMatchType,
        isValidMatchStatus: isValidMatchStatus,
        isValidParticipantType: isValidParticipantType,
        isValidGroupExamResult: isValidGroupExamResult,
        isValidGraduatingClassId: isValidGraduatingClassId,
        isParticipantEliminated: isParticipantEliminated,

        validateTournament: validateTournament,
        getValidationReport: getValidationReport,
        validateMatch: validateMatch,
        validateParticipant: validateParticipant,
        validateRound: validateRound,
        validateElimination: validateElimination
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TournamentSchema;
        var missing = [];

        var required = [
            'normaliseId', 'deepClone',
            'cloneTournament', 'cloneParticipant', 'cloneMatch', 'cloneRound', 'cloneElimination',
            'normaliseTournament', 'normaliseParticipant', 'normaliseMatch', 'normaliseRound', 'normaliseElimination',
            'getCanonicalParticipantType', 'isParticipantTypeCanonical',
            'getParticipantTypeFromRecord', 'isParticipantInTournament',
            'getParticipantIdKey', 'getParticipantIdKeyFromParts', 'participantMatches',
            'getParticipants', 'getRounds', 'getEliminations', 'getWinner',
            'deriveAdvancing', 'deriveLoser',
            'isValidMode', 'isValidStatus', 'isValidMatchType', 'isValidMatchStatus',
            'isValidParticipantType', 'isValidGroupExamResult', 'isValidGraduatingClassId',
            'isParticipantEliminated',
            'validateTournament', 'getValidationReport',
            'validateMatch', 'validateParticipant', 'validateRound', 'validateElimination'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[TournamentSchema] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[TournamentSchema] All exports verified successfully.');
        }
    })();

})();
