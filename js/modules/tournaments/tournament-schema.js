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
 * MATCH TYPES:
 *   - 'standard'    : legacy 2-participant match. Read-only compat. No
 *                     longer produced by the UI. Uses winner/loser.
 *   - 'group_exam'  : open assessment. 2+ participants. Per-participant
 *                     results (pass | fail | retry). No winner/loser.
 *   - 'team_vs_team': adversarial team match. 2+ teams. Two-layer
 *                     results: teamResults (per team) and
 *                     individualResults (per member character). No
 *                     winner/loser.
 *
 * PAIR EXAM:
 *   - A pair exam is a 'group_exam' with `isPairExam: true`.
 *   - The `pairings` field records which participants worked together.
 *   - Pairings partition the participants into groups of size 2 or 3.
 *   - It is not a distinct match type; the UI renders it differently.
 *
 * RESULT VOCABULARY:
 *   - 'pass'  : advanced and successful
 *   - 'retry' : advanced but not successful; tries again next round
 *   - 'fail'  : not advanced; eliminated from this tournament
 *   - Advancement = result is 'pass' OR 'retry'.
 *
 * YEAR SEMANTICS:
 *   - Years are UNBOUNDED positive integers.
 *   - There is no MIN_YEAR or MAX_YEAR.
 *   - Tournaments are scoped to WEEKS (bounded 1-52).
 *
 * DEPRECATED FIELDS:
 *   - match.winner, match.loser: accepted on read, never produced.
 *   - tournament.winner: accepted on read, never produced.
 *   - The UI never displays or sets these. New mutations emit null.
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
        return window.CalendarConstants || null;
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
            return {
                MIN_WEEK: 1,
                MAX_WEEK: 52
            };
        }
        return {
            MIN_WEEK: CC.MIN_WEEK || 1,
            MAX_WEEK: CC.MAX_WEEK || 52
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

    // Match types accepted by the schema. 'standard' is legacy —
    // readable but not produced by the UI going forward.
    var VALID_MATCH_TYPES = Object.freeze(['standard', 'group_exam', 'team_vs_team']);

    var VALID_MATCH_STATUSES = Object.freeze(['pending', 'in_progress', 'completed']);
    var VALID_PARTICIPANT_TYPES = Object.freeze(['character', 'team']);

    // Result vocabulary. Used by group_exam.results,
    // team_vs_team.teamResults, and team_vs_team.individualResults.
    var VALID_RESULTS = Object.freeze(['pass', 'fail', 'retry']);

    // Legacy. Only accepted on 'standard' matches.
    var VALID_GROUP_EXAM_RESULTS = VALID_RESULTS;

    // Pairings constraints.
    var MIN_PAIR_SIZE = 2;
    var MAX_PAIR_SIZE = 3;

    // ============================================================
    // ID NORMALISATION - Delegates to IdUtils
    // ============================================================

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

    function cloneParticipant(participant) {
        if (!participant || typeof participant !== 'object') {
            return null;
        }
        return deepClone(participant);
    }

    function cloneMatch(match) {
        if (!match || typeof match !== 'object') {
            return null;
        }
        return deepClone(match);
    }

    function cloneRound(round) {
        if (!round || typeof round !== 'object') {
            return null;
        }
        return deepClone(round);
    }

    function cloneElimination(elimination) {
        if (!elimination || typeof elimination !== 'object') {
            return null;
        }
        return deepClone(elimination);
    }

    function cloneTournament(tournament) {
        if (!tournament || typeof tournament !== 'object') {
            return null;
        }
        return deepClone(tournament);
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

    function isValidResult(value) {
        return VALID_RESULTS.indexOf(value) !== -1;
    }

    // Legacy alias. Keep for callers that haven't migrated.
    function isValidGroupExamResult(value) {
        return isValidResult(value);
    }

    function isValidGraduatingClassId(value) {
        if (value === undefined || value === null || value === '') {
            return true;
        }
        return normaliseId(value) !== null;
    }

    // ============================================================
    // PAIRINGS HELPERS
    // ============================================================

    /**
     * Normalise a single pairing array.
     * A pairing is an array of 2 or 3 participant IDs.
     * Returns null if invalid.
     */
    function normalisePairing(pairing) {
        if (!Array.isArray(pairing)) {
            return null;
        }
        if (pairing.length < MIN_PAIR_SIZE || pairing.length > MAX_PAIR_SIZE) {
            return null;
        }
        var result = [];
        var seen = {};
        for (var i = 0; i < pairing.length; i++) {
            var id = normaliseId(pairing[i]);
            if (id === null) { return null; }
            if (seen[id]) { return null; }
            seen[id] = true;
            result.push(id);
        }
        return result;
    }

    /**
     * Normalise a pairings array.
     * Returns null if any pairing is invalid or if the union of all
     * pairings contains duplicates. Does NOT require the pairings to
     * exactly cover the participants — that's a validation concern,
     * not a normalisation one.
     */
    function normalisePairings(pairings) {
        if (!Array.isArray(pairings)) {
            return null;
        }
        var result = [];
        var globalSeen = {};
        for (var i = 0; i < pairings.length; i++) {
            var normalised = normalisePairing(pairings[i]);
            if (normalised === null) { return null; }
            for (var j = 0; j < normalised.length; j++) {
                if (globalSeen[normalised[j]]) { return null; }
                globalSeen[normalised[j]] = true;
            }
            result.push(normalised);
        }
        return result;
    }

    /**
     * Check whether pairings form a valid partition of the given
     * participant IDs. Each participant must appear exactly once,
     * and each pairing must be of size 2 or 3.
     */
    function pairingsCoverParticipants(pairings, participantIds) {
        if (!Array.isArray(pairings) || !Array.isArray(participantIds)) {
            return false;
        }
        var wanted = {};
        for (var i = 0; i < participantIds.length; i++) {
            var id = normaliseId(participantIds[i]);
            if (id === null) { return false; }
            wanted[id] = true;
        }
        var seen = {};
        for (var j = 0; j < pairings.length; j++) {
            var pairing = pairings[j];
            if (!Array.isArray(pairing)) { return false; }
            if (pairing.length < MIN_PAIR_SIZE || pairing.length > MAX_PAIR_SIZE) {
                return false;
            }
            for (var k = 0; k < pairing.length; k++) {
                var pid = normaliseId(pairing[k]);
                if (pid === null) { return false; }
                if (!wanted[pid]) { return false; }
                if (seen[pid]) { return false; }
                seen[pid] = true;
            }
        }
        for (var checkId in wanted) {
            if (!seen[checkId]) { return false; }
        }
        return true;
    }

    // ============================================================
    // RESULT MAP HELPERS
    // ============================================================

    /**
     * Normalise a results map: { id: 'pass' | 'fail' | 'retry' }.
     * Returns null if any value is invalid or any key isn't a valid ID.
     * Preserves only valid entries.
     */
    function normaliseResultsMap(map) {
        if (!map || typeof map !== 'object' || Array.isArray(map)) {
            return null;
        }
        var result = {};
        var keys = Object.keys(map);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var id = normaliseId(key);
            if (id === null) { return null; }
            var value = map[key];
            if (!isValidResult(value)) { return null; }
            result[id] = value;
        }
        return result;
    }

    // ============================================================
    // CANONICAL NORMALISATION - Structural representation
    // ============================================================

    /**
     * Normalise a participant to canonical form.
     * Preserves unknown properties.
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
     * Handles all three match types (plus the pair-exam UI hint).
     * Deprecated winner/loser are stripped to null.
     */
    function normaliseMatch(match, expectedSize) {
        if (!match || typeof match !== 'object') {
            return null;
        }

        // ---- participants ----
        var participants = [];
        if (Array.isArray(match.participants)) {
            var seen = {};
            for (var i = 0; i < match.participants.length; i++) {
                var id = normaliseId(match.participants[i]);
                if (id === null) { continue; }
                if (seen[id]) { continue; }
                seen[id] = true;
                participants.push(id);
            }
        }

        // ---- type ----
        var type = match.type || 'group_exam';
        if (VALID_MATCH_TYPES.indexOf(type) === -1) {
            return null;
        }

        // ---- status ----
        var status = match.status || 'pending';
        if (VALID_MATCH_STATUSES.indexOf(status) === -1) {
            return null;
        }

        // ---- pair exam hint ----
        var isPairExam = match.isPairExam === true;

        // ---- result shape depends on type ----
        var result = {
            participants: participants,
            type: type,
            status: status,
            // Deprecated. Always null in normalised output.
            winner: null,
            loser: null,
            advancing: []
        };

        if (isPairExam) {
            result.isPairExam = true;
        }

        if (type === 'standard') {
            // Legacy shape. Preserve winner/loser as-is for read compat.
            // NOTE: we still normalise them to their ID strings, but
            // they are the only type where these fields are meaningful.
            var winnerId = match.winner !== undefined && match.winner !== null
                ? normaliseId(match.winner)
                : null;
            var loserId = match.loser !== undefined && match.loser !== null
                ? normaliseId(match.loser)
                : null;

            // Only keep them if the participant list validates them.
            if (winnerId !== null && participants.indexOf(winnerId) !== -1) {
                result.winner = winnerId;
            }
            if (loserId !== null && participants.indexOf(loserId) !== -1) {
                result.loser = loserId;
            }
        }

        if (type === 'group_exam') {
            var results = {};
            if (match.results && typeof match.results === 'object' && !Array.isArray(match.results)) {
                var keys = Object.keys(match.results);
                for (var k = 0; k < keys.length; k++) {
                    var key = keys[k];
                    var keyId = normaliseId(key);
                    if (keyId === null) { continue; }
                    var val = match.results[key];
                    if (!isValidResult(val)) { continue; }
                    results[keyId] = val;
                }
            }
            result.results = results;

            if (isPairExam) {
                var pairings = normalisePairings(match.pairings);
                if (pairings !== null) {
                    result.pairings = pairings;
                } else {
                    result.pairings = [];
                }
            }
        }

        if (type === 'team_vs_team') {
            var teamResults = normaliseResultsMap(match.teamResults);
            if (teamResults !== null) {
                result.teamResults = teamResults;
            } else {
                result.teamResults = {};
            }

            var individualResults = normaliseResultsMap(match.individualResults);
            if (individualResults !== null) {
                result.individualResults = individualResults;
            } else {
                result.individualResults = {};
            }
        }

        // ---- expected size (round-level constraint) ----
        // For group_exam and pair_exam, participants must equal
        // round.matchSize. For team_vs_team, teams must equal round.matchSize.
        // Skip the check when expectedSize is undefined (e.g. during
        // normalising a match detached from its round).
        if (typeof expectedSize === 'number' && expectedSize >= 2) {
            if (participants.length !== expectedSize) {
                return null;
            }
        }

        // ---- preserve unknown properties ----
        var knownKeys = [
            'participants', 'type', 'status', 'winner', 'loser',
            'advancing', 'results', 'isPairExam', 'pairings',
            'teamResults', 'individualResults'
        ];
        Object.keys(match).forEach(function(key) {
            if (knownKeys.indexOf(key) === -1) {
                result[key] = match[key];
            }
        });

        return result;
    }

    /**
     * Normalise a round to canonical form.
     * A round can hold zero or more matches.
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

        var matchType = round.matchType || 'group_exam';
        if (VALID_MATCH_TYPES.indexOf(matchType) === -1) {
            return null;
        }

        var isPairExam = round.isPairExam === true;

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

        if (isPairExam) {
            result.isPairExam = true;
        }

        // Preserve unknown properties
        var knownKeys = ['roundNumber', 'status', 'matchSize', 'matchType', 'matches', 'isPairExam'];
        Object.keys(round).forEach(function(key) {
            if (knownKeys.indexOf(key) === -1) {
                result[key] = round[key];
            }
        });

        return result;
    }

    /**
     * Normalise an elimination record to canonical form.
     */
    function normaliseElimination(elimination) {
        if (!elimination || typeof elimination !== 'object') {
            return null;
        }

        var participantId = normaliseId(elimination.participantId);
        if (participantId === null) { return null; }

        var tournamentId = normaliseId(elimination.tournamentId);
        if (tournamentId === null) { return null; }

        var week = typeof elimination.week === 'number' &&
            elimination.week >= MIN_WEEK &&
            elimination.week <= MAX_WEEK
            ? elimination.week
            : null;

        if (week === null) { return null; }

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
     * Deprecated winner is stripped to null.
     */
    function normaliseTournament(tournament) {
        if (!tournament || typeof tournament !== 'object') {
            return null;
        }

        var id = normaliseId(tournament.id);
        if (id === null) { return null; }

        var name = typeof tournament.name === 'string' ? tournament.name.trim() : '';
        if (name === '') { return null; }

        var mode = tournament.mode || 'individuals';
        if (VALID_MODES.indexOf(mode) === -1) { return null; }

        var startWeek = typeof tournament.startWeek === 'number' &&
            tournament.startWeek >= MIN_WEEK &&
            tournament.startWeek <= MAX_WEEK
            ? tournament.startWeek
            : null;
        if (startWeek === null) { return null; }

        var endWeek = typeof tournament.endWeek === 'number' &&
            tournament.endWeek >= MIN_WEEK &&
            tournament.endWeek <= MAX_WEEK
            ? tournament.endWeek
            : null;
        if (endWeek === null) { return null; }

        if (startWeek > endWeek) { return null; }

        var totalRounds = typeof tournament.totalRounds === 'number' &&
            tournament.totalRounds >= 1
            ? tournament.totalRounds
            : null;
        if (totalRounds === null) { return null; }

        var status = tournament.status || 'draft';
        if (VALID_STATUSES.indexOf(status) === -1) { return null; }

        // Participants
        var participants = [];
        if (Array.isArray(tournament.participants)) {
            for (var i = 0; i < tournament.participants.length; i++) {
                var normalisedParticipant = normaliseParticipant(tournament.participants[i], mode);
                if (normalisedParticipant !== null) {
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

        // Rounds
        var rounds = [];
        if (Array.isArray(tournament.rounds)) {
            for (var r = 0; r < tournament.rounds.length; r++) {
                var normalisedRound = normaliseRound(tournament.rounds[r], r);
                if (normalisedRound !== null) {
                    rounds.push(normalisedRound);
                }
            }
        }

        // Eliminations
        var eliminations = [];
        if (Array.isArray(tournament.eliminations)) {
            for (var e = 0; e < tournament.eliminations.length; e++) {
                var normalisedElimination = normaliseElimination(tournament.eliminations[e]);
                if (normalisedElimination !== null) {
                    var dupE = false;
                    for (var f = 0; f < eliminations.length; f++) {
                        if (eliminations[f].participantId === normalisedElimination.participantId &&
                            eliminations[f].tournamentId === normalisedElimination.tournamentId) {
                            dupE = true;
                            break;
                        }
                    }
                    if (!dupE) {
                        eliminations.push(normalisedElimination);
                    }
                }
            }
        }

        // Graduating class fields
        var graduatingClassId = tournament.graduatingClassId !== undefined &&
            tournament.graduatingClassId !== null
            ? normaliseId(tournament.graduatingClassId)
            : null;

        var classFilterEnabled = typeof tournament.classFilterEnabled === 'boolean'
            ? tournament.classFilterEnabled
            : false;

        // Created at - preserve if valid string
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
            // Deprecated. Always null going forward.
            winner: null,
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
        if (id === null) { return null; }

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
        if (id === null) { return false; }

        for (var i = 0; i < tournament.participants.length; i++) {
            var p = tournament.participants[i];
            if (!p) { continue; }
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
        if (id === null) { return null; }
        return id + ':' + (participant.type || 'unknown');
    }

    function getParticipantIdKeyFromParts(id, type) {
        var normId = normaliseId(id);
        if (normId === null) { return null; }
        return normId + ':' + (type || 'unknown');
    }

    function participantMatches(p1, p2) {
        if (!p1 || !p2) { return false; }
        var id1 = normaliseId(p1.id);
        var id2 = normaliseId(p2.id);
        if (id1 === null || id2 === null) { return false; }
        if (id1 !== id2) { return false; }
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
        if (id === null) { return false; }

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
        return tournament.participants.map(cloneParticipant).filter(function(p) {
            return p !== null;
        });
    }

    function getRounds(tournament) {
        if (!tournament || !Array.isArray(tournament.rounds)) {
            return [];
        }
        return tournament.rounds.map(cloneRound).filter(function(r) {
            return r !== null;
        });
    }

    function getEliminations(tournament) {
        if (!tournament || !Array.isArray(tournament.eliminations)) {
            return [];
        }
        return tournament.eliminations.map(cloneElimination).filter(function(e) {
            return e !== null;
        });
    }

    /**
     * @deprecated Use getFinalPassers instead. Returns the deprecated
     * winner field for legacy read compat, always null on new data.
     */
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
     * This is the SINGLE SOURCE OF TRUTH for advancement.
     *
     * Rules by type:
     *   group_exam  : participants whose results[id] is 'pass' or 'retry'
     *   team_vs_team: teams whose teamResults[teamId] is 'pass' or 'retry'
     *   standard    : legacy. The winner advances (if set).
     *
     * @param {object} match
     * @returns {array} Array of advancing participant (or team) IDs
     */
    function deriveAdvancing(match) {
        if (!match || typeof match !== 'object') {
            return [];
        }

        var type = match.type || 'group_exam';

        if (type === 'group_exam') {
            var participants = Array.isArray(match.participants) ? match.participants : [];
            var results = match.results || {};
            var advancing = [];
            for (var i = 0; i < participants.length; i++) {
                var id = normaliseId(participants[i]);
                if (id === null) { continue; }
                var r = results[id];
                if (r === 'pass' || r === 'retry') {
                    advancing.push(id);
                }
            }
            return advancing;
        }

        if (type === 'team_vs_team') {
            var teams = Array.isArray(match.participants) ? match.participants : [];
            var teamResults = match.teamResults || {};
            var advancingTeams = [];
            for (var j = 0; j < teams.length; j++) {
                var tid = normaliseId(teams[j]);
                if (tid === null) { continue; }
                var tr = teamResults[tid];
                if (tr === 'pass' || tr === 'retry') {
                    advancingTeams.push(tid);
                }
            }
            return advancingTeams;
        }

        if (type === 'standard') {
            if (match.winner) {
                var winnerId = normaliseId(match.winner);
                return winnerId !== null ? [winnerId] : [];
            }
            return [];
        }

        return [];
    }

    /**
     * Derive the final passers from a tournament's last round.
     * Returns the union of advancing IDs across all matches in the
     * last round.
     */
    function deriveFinalPassers(tournament) {
        if (!tournament || !Array.isArray(tournament.rounds)) {
            return [];
        }
        if (tournament.rounds.length === 0) {
            return [];
        }

        var lastRound = tournament.rounds[tournament.rounds.length - 1];
        if (!lastRound || !Array.isArray(lastRound.matches)) {
            return [];
        }

        var seen = {};
        var result = [];
        for (var i = 0; i < lastRound.matches.length; i++) {
            var advancing = deriveAdvancing(lastRound.matches[i]);
            for (var j = 0; j < advancing.length; j++) {
                var id = advancing[j];
                if (!seen[id]) {
                    seen[id] = true;
                    result.push(id);
                }
            }
        }
        return result;
    }

    /**
     * @deprecated Use deriveAdvancing or deriveFinalPassers. Kept for
     * legacy callers that used deriveLoser for standard matches.
     */
    function deriveLoser(participants, winner) {
        if (!Array.isArray(participants) || participants.length !== 2) {
            return null;
        }
        if (!winner) { return null; }
        var winnerId = normaliseId(winner);
        if (winnerId === null) { return null; }

        for (var i = 0; i < participants.length; i++) {
            var id = normaliseId(participants[i]);
            if (id !== null && id !== winnerId) {
                return id;
            }
        }
        return null;
    }

    // ============================================================
    // STRUCTURAL VALIDATION
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
            errors.push('Participant type "' + type + '" does not match tournament mode "' +
                mode + '" (expected "' + canonicalType + '").');
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

    function validateMatch(match, round, strict) {
        var errors = [];

        if (!match || typeof match !== 'object') {
            errors.push('Match must be an object.');
            return errors;
        }

        var type = match.type || 'group_exam';
        if (!isValidMatchType(type)) {
            errors.push('Invalid match type: ' + type);
            return errors;
        }

        var status = match.status || 'pending';
        if (!isValidMatchStatus(status)) {
            errors.push('Invalid match status: ' + status);
        }

        var participants = Array.isArray(match.participants) ? match.participants : [];
        var expectedSize = round && typeof round.matchSize === 'number'
            ? round.matchSize
            : null;

        // Size check: participants must equal round.matchSize
        // (skip for 'standard' — legacy matches were 2-participant and
        // may not have carried matchSize).
        if (type !== 'standard' && expectedSize !== null) {
            if (participants.length !== expectedSize) {
                errors.push('Match has ' + participants.length +
                    ' participants, expected ' + expectedSize);
            }
        }

        // Participant ID validity + uniqueness
        var participantSeen = Object.create(null);
        for (var i = 0; i < participants.length; i++) {
            var pid = normaliseId(participants[i]);
            if (pid === null) {
                errors.push('Participant ' + i + ': Invalid ID');
                continue;
            }
            if (participantSeen[pid]) {
                errors.push('Duplicate participant: ' + pid);
            }
            participantSeen[pid] = true;
        }

        // ---- per-type validation ----

        if (type === 'group_exam') {
            validateGroupExamResults(match, participants, errors);

            if (match.isPairExam === true) {
                validatePairings(match, participants, errors);
            }
        }

        if (type === 'team_vs_team') {
            validateTeamResults(match, participants, errors);
            validateIndividualResults(match, participants, errors);
        }

        if (type === 'standard') {
            // Legacy. Keep the old checks light.
            if (status === 'completed') {
                if (!match.winner) {
                    errors.push('Completed standard match has no winner.');
                } else {
                    var winnerId = normaliseId(match.winner);
                    if (winnerId === null || participants.indexOf(winnerId) === -1) {
                        errors.push('Winner ' + winnerId + ' is not a participant.');
                    }
                }
            }
        }

        // Advancing must be participant IDs that are present
        if (Array.isArray(match.advancing)) {
            for (var k = 0; k < match.advancing.length; k++) {
                var advId = normaliseId(match.advancing[k]);
                if (advId === null) {
                    errors.push('Invalid advancing ID: ' + match.advancing[k]);
                } else if (participants.indexOf(advId) === -1) {
                    errors.push('Advancing participant ' + advId + ' is not a participant.');
                }
            }
        }

        return errors;
    }

    function validateGroupExamResults(match, participants, errors) {
        var results = match.results;

        if (results === undefined || results === null) {
            // A completed group exam must have results.
            if (match.status === 'completed') {
                errors.push('Completed group exam has no results.');
            }
            return;
        }

        if (typeof results !== 'object' || Array.isArray(results)) {
            errors.push('Group exam results must be an object.');
            return;
        }

        var keys = Object.keys(results);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var id = normaliseId(key);
            if (id === null) {
                errors.push('Invalid result key: ' + key);
                continue;
            }
            if (participants.indexOf(id) === -1) {
                errors.push('Result for ' + id + ' is not a participant.');
            }
            var value = results[key];
            if (!isValidResult(value)) {
                errors.push('Invalid result for ' + id + ': ' + value +
                    ' (expected pass, fail, or retry)');
            }
        }

        if (match.status === 'completed') {
            for (var j = 0; j < participants.length; j++) {
                var pid = normaliseId(participants[j]);
                if (pid !== null && results[pid] === undefined) {
                    errors.push('Completed group exam missing result for ' + pid);
                }
            }
        }
    }

    function validatePairings(match, participants, errors) {
        if (!Array.isArray(match.pairings)) {
            errors.push('Pair exam requires a pairings array.');
            return;
        }

        if (!pairingsCoverParticipants(match.pairings, participants)) {
            errors.push('Pairings must partition all participants into groups of 2 or 3.');
        }
    }

    function validateTeamResults(match, participants, errors) {
        var teamResults = match.teamResults;

        if (teamResults === undefined || teamResults === null) {
            if (match.status === 'completed') {
                errors.push('Completed team match has no teamResults.');
            }
            return;
        }

        if (typeof teamResults !== 'object' || Array.isArray(teamResults)) {
            errors.push('teamResults must be an object.');
            return;
        }

        var keys = Object.keys(teamResults);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var id = normaliseId(key);
            if (id === null) {
                errors.push('Invalid team result key: ' + key);
                continue;
            }
            if (participants.indexOf(id) === -1) {
                errors.push('Team result for ' + id + ' is not a participating team.');
            }
            var value = teamResults[key];
            if (!isValidResult(value)) {
                errors.push('Invalid team result for ' + id + ': ' + value);
            }
        }

        if (match.status === 'completed') {
            for (var j = 0; j < participants.length; j++) {
                var tid = normaliseId(participants[j]);
                if (tid !== null && teamResults[tid] === undefined) {
                    errors.push('Completed team match missing result for team ' + tid);
                }
            }
        }
    }

    function validateIndividualResults(match, participants, errors) {
        var individualResults = match.individualResults;

        if (individualResults === undefined || individualResults === null) {
            // Allowed to be empty. Individual results are informational.
            return;
        }

        if (typeof individualResults !== 'object' || Array.isArray(individualResults)) {
            errors.push('individualResults must be an object.');
            return;
        }

        var keys = Object.keys(individualResults);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var id = normaliseId(key);
            if (id === null) {
                errors.push('Invalid individual result key: ' + key);
                continue;
            }
            var value = individualResults[key];
            if (!isValidResult(value)) {
                errors.push('Invalid individual result for ' + id + ': ' + value);
            }
        }
        // Structural validation does NOT verify that each character is
        // on one of the participating teams. That's a domain rule and
        // belongs in TournamentRules, not the schema.
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

    function validateRound(round, strict) {
        var errors = [];

        if (!round || typeof round !== 'object') {
            errors.push('Round must be an object.');
            return errors;
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

        if (round.matchType !== undefined && round.matchType !== null) {
            if (!isValidMatchType(round.matchType)) {
                errors.push('Invalid matchType: ' + round.matchType);
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

            if (rounds[i] && Array.isArray(rounds[i].matches)) {
                var mErrors = validateMatches(rounds[i], strict);
                if (mErrors.length > 0) {
                    errors = errors.concat(mErrors);
                }
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
            if (typeof elimination.week !== 'number' ||
                elimination.week < MIN_WEEK ||
                elimination.week > MAX_WEEK) {
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

    /**
     * Validate a tournament against the schema.
     * STRUCTURAL ONLY - no lifecycle or business rules.
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

        var id = normaliseId(tournament.id);
        if (id === null) {
            errors.push('Tournament ID is required.');
        }

        if (!tournament.name || typeof tournament.name !== 'string' ||
            tournament.name.trim() === '') {
            errors.push('Tournament name is required.');
        }

        if (!isValidMode(tournament.mode)) {
            errors.push('Invalid mode: ' + tournament.mode);
        }

        if (!isValidStatus(tournament.status)) {
            errors.push('Invalid status: ' + tournament.status);
        }

        var startWeek = typeof tournament.startWeek === 'number'
            ? tournament.startWeek
            : parseInt(tournament.startWeek, 10);
        var endWeek = typeof tournament.endWeek === 'number'
            ? tournament.endWeek
            : parseInt(tournament.endWeek, 10);

        if (isNaN(startWeek) || startWeek < MIN_WEEK || startWeek > MAX_WEEK) {
            errors.push('Invalid startWeek: ' + tournament.startWeek);
        }
        if (isNaN(endWeek) || endWeek < MIN_WEEK || endWeek > MAX_WEEK) {
            errors.push('Invalid endWeek: ' + tournament.endWeek);
        }
        if (!isNaN(startWeek) && !isNaN(endWeek) && startWeek > endWeek) {
            errors.push('startWeek (' + startWeek + ') cannot be after endWeek (' + endWeek + ').');
        }

        var totalRounds = typeof tournament.totalRounds === 'number'
            ? tournament.totalRounds
            : parseInt(tournament.totalRounds, 10);
        if (isNaN(totalRounds) || totalRounds < 1) {
            errors.push('totalRounds must be >= 1');
        }

        if (tournament.graduatingClassId !== undefined && tournament.graduatingClassId !== null) {
            var gradId = normaliseId(tournament.graduatingClassId);
            if (gradId === null) {
                errors.push('Invalid graduatingClassId.');
            }
        }

        if (tournament.classFilterEnabled !== undefined &&
            typeof tournament.classFilterEnabled !== 'boolean') {
            errors.push('classFilterEnabled must be a boolean.');
        }

        // Deprecation warning: tournament.winner set
        if (tournament.winner !== undefined && tournament.winner !== null) {
            warnings.push('tournament.winner is deprecated and ignored. Use rounds[].matches[].results instead.');
        }

        if (strict) {
            var allowedKeys = [
                'id', 'name', 'mode', 'startWeek', 'endWeek', 'totalRounds',
                'status', 'participants', 'rounds', 'eliminations', 'winner',
                'createdAt', '_schemaVersion',
                'graduatingClassId', 'classFilterEnabled'
            ];
            for (var key in tournament) {
                if (Object.prototype.hasOwnProperty.call(tournament, key) &&
                    allowedKeys.indexOf(key) === -1) {
                    warnings.push('Unknown top-level property: ' + key);
                }
            }
        }

        if (tournament.participants !== undefined) {
            var pErrors = validateParticipants(tournament.participants, tournament.mode);
            if (pErrors.length > 0) {
                errors = errors.concat(pErrors);
            }
        }

        if (tournament.rounds !== undefined) {
            var rErrors = validateRounds(tournament.rounds, strict);
            if (rErrors.length > 0) {
                errors = errors.concat(rErrors);
            }
        }

        if (tournament.eliminations !== undefined) {
            var eErrors = validateEliminations(tournament.eliminations, strict);
            if (eErrors.length > 0) {
                errors = errors.concat(eErrors);
            }
        }

        // Deprecation warning: match.winner / match.loser set
        if (strict && Array.isArray(tournament.rounds)) {
            for (var ri = 0; ri < tournament.rounds.length; ri++) {
                var rnd = tournament.rounds[ri];
                if (!rnd || !Array.isArray(rnd.matches)) { continue; }
                for (var mi = 0; mi < rnd.matches.length; mi++) {
                    var m = rnd.matches[mi];
                    if (!m) { continue; }
                    if (m.type === 'standard') { continue; }
                    if (m.winner !== undefined && m.winner !== null) {
                        warnings.push('Round ' + ri + ' Match ' + mi + ': match.winner is deprecated.');
                    }
                    if (m.loser !== undefined && m.loser !== null) {
                        warnings.push('Round ' + ri + ' Match ' + mi + ': match.loser is deprecated.');
                    }
                }
            }
        }

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
            graduatingClassId: tournament.graduatingClassId !== undefined &&
                tournament.graduatingClassId !== null
                ? String(tournament.graduatingClassId)
                : null,
            classFilterEnabled: typeof tournament.classFilterEnabled === 'boolean'
                ? tournament.classFilterEnabled
                : null,
            participantCount: Array.isArray(tournament.participants)
                ? tournament.participants.length
                : 0,
            roundCount: Array.isArray(tournament.rounds)
                ? tournament.rounds.length
                : 0,
            eliminationCount: Array.isArray(tournament.eliminations)
                ? tournament.eliminations.length
                : 0,
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
        VALID_RESULTS: VALID_RESULTS,
        // Legacy alias. Same object as VALID_RESULTS.
        VALID_GROUP_EXAM_RESULTS: VALID_GROUP_EXAM_RESULTS,
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        MIN_PAIR_SIZE: MIN_PAIR_SIZE,
        MAX_PAIR_SIZE: MAX_PAIR_SIZE,

        // ID Normalisation
        normaliseId: normaliseId,

        // Cloning
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
        normalisePairing: normalisePairing,
        normalisePairings: normalisePairings,
        normaliseResultsMap: normaliseResultsMap,

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
        getWinner: getWinner,   // @deprecated

        // Derivation
        deriveAdvancing: deriveAdvancing,
        deriveFinalPassers: deriveFinalPassers,
        deriveLoser: deriveLoser,   // @deprecated
        pairingsCoverParticipants: pairingsCoverParticipants,

        // Structural Validation
        isValidMode: isValidMode,
        isValidStatus: isValidStatus,
        isValidMatchType: isValidMatchType,
        isValidMatchStatus: isValidMatchStatus,
        isValidParticipantType: isValidParticipantType,
        isValidResult: isValidResult,
        isValidGroupExamResult: isValidGroupExamResult,   // legacy alias
        isValidGraduatingClassId: isValidGraduatingClassId,
        isParticipantEliminated: isParticipantEliminated,

        validateTournament: validateTournament,
        getValidationReport: getValidationReport,
        validateMatch: validateMatch,
        validateParticipant: validateParticipant,
        validateRound: validateRound,
        validateRounds: validateRounds,
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
            'normalisePairing', 'normalisePairings', 'normaliseResultsMap',
            'getCanonicalParticipantType', 'isParticipantTypeCanonical',
            'getParticipantTypeFromRecord', 'isParticipantInTournament',
            'getParticipantIdKey', 'getParticipantIdKeyFromParts', 'participantMatches',
            'getParticipants', 'getRounds', 'getEliminations', 'getWinner',
            'deriveAdvancing', 'deriveFinalPassers', 'deriveLoser',
            'pairingsCoverParticipants',
            'isValidMode', 'isValidStatus', 'isValidMatchType', 'isValidMatchStatus',
            'isValidParticipantType', 'isValidResult', 'isValidGroupExamResult',
            'isValidGraduatingClassId', 'isParticipantEliminated',
            'validateTournament', 'getValidationReport',
            'validateMatch', 'validateParticipant', 'validateRound',
            'validateRounds', 'validateElimination'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[TournamentSchema] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();