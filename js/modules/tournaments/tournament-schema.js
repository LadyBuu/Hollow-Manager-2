/**
 * modules/tournaments/tournament-schema.js - Tournament Schema
 * Single source of truth for tournament structure and validation.
 *
 * Path: js/modules/tournaments/tournament-schema.js
 *
 * RESPONSIBILITIES:
 *   - Structural validation of tournaments
 *   - Canonical representation rules
 *   - Participant identity management
 *   - Round and match identity (stable IDs)
 *   - Domain derivations that are purely structural
 *
 * IMPORTANT:
 *   - Schema is the CONSTITUTIONAL AUTHORITY for tournament structure.
 *   - Does NOT know about characters/teams in the wider application.
 *   - Does NOT call saveData().
 *   - Does NOT perform business-rule validation (that belongs in Rules).
 *   - Exported constants are FROZEN to prevent mutation.
 *   - cloneTournament() preserves ALL properties (exact defensive copy).
 *   - normaliseTournament() produces canonical structural representation.
 *
 * NORMALISATION CONTRACT (STRICT CANONICALISER):
 *   normalise*() functions either return a canonical representation or
 *   null. They never drop invalid records silently. They never invent
 *   missing required fields. They never generate missing IDs.
 *
 *   PERMITTED transformations:
 *     - String trimming.
 *     - Numeric coercion of strings that came from JSON storage
 *       ("5" → 5) when the canonical field type is number.
 *     - Sorting bands / normalising key order.
 *     - Rebuilding derived structure from source facts.
 *     - Positional recomputation (roundNumber = index + 1).
 *
 *   FORBIDDEN:
 *     - Dropping invalid participants/rounds/matches/eliminations.
 *     - Filling in missing required fields with defaults.
 *     - Generating missing round or match IDs.
 *     - Coercing malformed participant types to canonical types.
 *     - Converting invalid result values to a placeholder.
 *
 *   If the input is not canonically constructible, return null. The
 *   caller decides what to do (reject the write, or run an explicit
 *   migration/repair script against a specific known corruption).
 *
 * IDENTITY MODEL:
 *   - Rounds carry a stable `id` (prefixed 'round').
 *     roundNumber remains POSITIONAL (index + 1) and is recomputed on
 *     read. The ID survives sibling removal; the position does not.
 *   - Matches carry a stable `id` (prefixed 'match').
 *     Match IDs are GLOBALLY UNIQUE WITHIN A TOURNAMENT. The schema
 *     rejects duplicate match IDs across rounds.
 *   - Participant identity is (id, type); no separate participant ID.
 *   - Elimination identity is (participantId, tournamentId).
 *
 *   ID GENERATION POLICY:
 *     generateRoundId() and generateMatchId() exist for CREATION. The
 *     normalise*() functions DO NOT generate IDs. A persisted record
 *     without a valid id is malformed; normalisation returns null and
 *     validation reports the error. Historical identity is never
 *     silently rewritten.
 *
 * MATCH TYPES:
 *   - 'group_exam'  : open assessment. participants.length === round.matchSize.
 *     May be isPairExam (see below).
 *   - 'team_vs_team': adversarial team match. participants.length >= 2.
 *
 *   'standard' has been removed. It was a legacy 2-participant match
 *   with a winner/loser concept. The current model has no winner, no
 *   loser, and no standard match type. Any persisted standard match is
 *   malformed and will be rejected by validation.
 *
 * MATCH TYPE — PARTICIPANT COUNT RULES:
 *   'group_exam'  : participants.length === round.matchSize
 *   'team_vs_team': participants.length >= 2 (no upper bound from
 *                   matchSize; matchSize is a hint for group_exam
 *                   sizing only)
 *
 *   The round's `matchSize` field is authoritative ONLY for group_exam.
 *   A team match with 3 teams in a round whose matchSize is 2 is valid.
 *
 * PAIR EXAM:
 *   - A pair exam is a 'group_exam' with `isPairExam: true`.
 *   - `pairings` partitions the participants into groups of size 2 or 3.
 *   - `isPairExam` is REJECTED on any non-group_exam match.
 *   - `pairings` is REJECTED unless `isPairExam === true`.
 *
 * RESULT VOCABULARY:
 *   - 'pass'  : advanced and successful
 *   - 'retry' : advanced but not successful
 *   - 'fail'  : not advanced; eliminated from this tournament
 *   - Advancement = result is 'pass' OR 'retry'.
 *
 * DERIVED vs PERSISTED:
 *   - `advancing` is DERIVED from results. It is not persisted on the
 *     canonical match shape. deriveAdvancing() computes it on demand.
 *   - `finalPassers` is DERIVED from the last round. Not persisted.
 *   - `winner` / `loser` are not part of the model at all.
 *
 * YEAR SEMANTICS:
 *   - Years are UNBOUNDED positive integers.
 *   - Tournaments are scoped to WEEKS (bounded 1-52).
 *
 * EXPORT SURFACE (v2, trimmed):
 *   Removed from the public export in this revision (kept as private
 *   helpers where used internally):
 *
 *     - getParticipantIdKey, getParticipantIdKeyFromParts,
 *       participantMatches
 *         Participant identity helpers. No external caller. If a
 *         caller needs the composite key, it builds it locally or
 *         asks for the helper to be re-exported.
 *
 *     - getParticipants, getRounds, getEliminations
 *         Defensive-copy getters. TournamentQueries owns the query
 *         surface for these. No external caller.
 *
 *     - getValidationReport
 *         Diagnostic-only. No caller.
 *
 *     - validateParticipant, validateParticipants,
 *       validateRound, validateRounds,
 *       validateElimination, validateEliminations
 *         Used internally by validateTournament. No external caller
 *         except validateTournament itself.
 *
 *     - cloneTournament, cloneParticipant, cloneElimination
 *         Convenience wrappers around deepClone. No external caller.
 *         cloneRound and cloneMatch are kept because the public
 *         findRoundById / findMatchById use them.
 *
 *     - normalisePairing, normaliseResultsMap
 *         Used internally by normalisePairings and normaliseMatch.
 *         No external caller.
 *
 *   Deleted outright in this revision:
 *     - isValidGroupExamResult
 *         Pure alias of isValidResult. No caller.
 *     - isValidGraduatingClassId
 *         No caller. The check is trivial and inlined where needed.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CalendarConstants
 *   - window.ObjectUtils
 *   - window.IdUtils
 */

(function() {
    'use strict';

    if (window.__tournamentSchemaLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var CalendarConstants = window.CalendarConstants;
    var ObjectUtils = window.ObjectUtils;
    var IdUtils = window.IdUtils;

    var _missing = [];

    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        _missing.push('CalendarConstants.MIN_WEEK / MAX_WEEK');
    }
    if (!ObjectUtils || typeof ObjectUtils.deepClone !== 'function') {
        _missing.push('ObjectUtils.deepClone');
    }
    if (!IdUtils || typeof IdUtils.generateId !== 'function') {
        _missing.push('IdUtils.generateId');
    }
    if (!IdUtils || typeof IdUtils.normaliseId !== 'function') {
        _missing.push('IdUtils.normaliseId');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TournamentSchema] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__tournamentSchemaLoaded = true;

    // ============================================================
    // BOUNDS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    // ============================================================
    // CONSTANTS - DEEP FROZEN
    // ============================================================

    var VALID_STATUSES = Object.freeze(['draft', 'active', 'completed']);
    var VALID_MODES = Object.freeze(['teams', 'individuals']);

    var VALID_MATCH_TYPES = Object.freeze([
        'group_exam',
        'team_vs_team'
    ]);

    var VALID_MATCH_STATUSES = Object.freeze([
        'pending',
        'in_progress',
        'completed'
    ]);

    var VALID_PARTICIPANT_TYPES = Object.freeze(['character', 'team']);
    var VALID_RESULTS = Object.freeze(['pass', 'fail', 'retry']);

    var MIN_PAIR_SIZE = 2;
    var MAX_PAIR_SIZE = 3;

    var SCHEMA_VERSION = 3;

    // ============================================================
    // ID HELPERS
    // ============================================================

    function normaliseId(value) {
        return IdUtils.normaliseId(value);
    }

    function generateRoundId() {
        return IdUtils.generateId('round');
    }

    function generateMatchId() {
        return IdUtils.generateId('match');
    }

    // ============================================================
    // SMALL HELPERS
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
     * Coerce a value to a canonical integer, or return null.
     *
     * Accepts:
     *   - an integer number
     *   - a string whose trimmed value is a pure digit sequence
     *     with an optional leading minus sign
     *
     * Rejects everything else. Does not accept "12abc", "12.5",
     * "1e2", Infinity, NaN, booleans, objects.
     *
     * NOTE: This is a SAFE-INTEGER parser and permits negatives.
     * Years and deltas use it directly. Bounds-checking (e.g.
     * "must be >= 1") is the caller's job. The tournament
     * module's strict positive-only parser is
     * TournamentConstants.parsePositiveInteger.
     *
     * This is the ONLY numeric coercion permitted by the strict
     * normalisation contract.
     */
    function coerceInteger(value) {
        if (typeof value === 'number') {
            return Number.isInteger(value) ? value : null;
        }
        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '' || !/^-?\d+$/.test(trimmed)) {
                return null;
            }
            var n = Number(trimmed);
            return Number.isSafeInteger(n) ? n : null;
        }
        return null;
    }

    // ============================================================
    // CLONING
    // ============================================================

    function deepClone(value) {
        return ObjectUtils.deepClone(value);
    }

    // Kept as private helpers. cloneRound and cloneMatch are used by
    // the public findRoundById / findMatchById (defensive-copy
    // lookups). The others are unused internally and not exported.
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

    // ============================================================
    // PAIRINGS HELPERS
    // ============================================================

    // Private helper. Used by normalisePairings; not exported.
    function normalisePairing(pairing) {
        if (!Array.isArray(pairing)) {
            return null;
        }
        if (pairing.length < MIN_PAIR_SIZE ||
            pairing.length > MAX_PAIR_SIZE) {
            return null;
        }
        var result = [];
        var seen = Object.create(null);
        for (var i = 0; i < pairing.length; i++) {
            var id = normaliseId(pairing[i]);
            if (id === null) { return null; }
            if (seen[id]) { return null; }
            seen[id] = true;
            result.push(id);
        }
        return result;
    }

    function normalisePairings(pairings) {
        if (!Array.isArray(pairings)) {
            return null;
        }
        var result = [];
        var globalSeen = Object.create(null);
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

    function pairingsCoverParticipants(pairings, participantIds) {
        if (!Array.isArray(pairings) || !Array.isArray(participantIds)) {
            return false;
        }
        var wanted = Object.create(null);
        for (var i = 0; i < participantIds.length; i++) {
            var id = normaliseId(participantIds[i]);
            if (id === null) { return false; }
            wanted[id] = true;
        }
        var seen = Object.create(null);
        for (var j = 0; j < pairings.length; j++) {
            var pairing = pairings[j];
            if (!Array.isArray(pairing)) { return false; }
            if (pairing.length < MIN_PAIR_SIZE ||
                pairing.length > MAX_PAIR_SIZE) {
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

    // Private helper. Used by normaliseMatch; not exported.
    function normaliseResultsMap(map) {
        if (!isObject(map)) {
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
    // CANONICAL NORMALISATION - STRICT
    // ============================================================
    //
    // Each normalise*() function returns either a canonical object
    // or null. It never drops invalid nested records and pretends the
    // result is fine. If any part of the input is structurally
    // irrecoverable, the whole normalisation returns null.

    /**
     * Normalise a participant record.
     *
     * Required: `id` (coercible via normaliseId), `type` (a valid
     * participant type, and canonical for the tournament's mode).
     *
     * Returns null if either requirement fails. Does NOT default the
     * type from the mode; the persisted type must be correct.
     */
    function normaliseParticipant(participant, mode) {
        if (!isObject(participant)) {
            return null;
        }

        var id = normaliseId(participant.id);
        if (id === null) {
            return null;
        }

        var type = participant.type;
        if (!isValidParticipantType(type)) {
            return null;
        }

        var canonicalType = getCanonicalParticipantType(mode);
        if (canonicalType === null) {
            return null;
        }
        if (type !== canonicalType) {
            return null;
        }

        var result = {
            id: id,
            type: type
        };

        var knownKeys = ['id', 'type'];
        Object.keys(participant).forEach(function(key) {
            if (knownKeys.indexOf(key) === -1) {
                result[key] = deepClone(participant[key]);
            }
        });

        return result;
    }

    /**
     * Normalise a match record.
     *
     * Required:
     *   - `id`             (must already exist; never generated here)
     *   - `type`           (a valid match type)
     *   - `status`         (a valid match status)
     *   - `participants`   (array of normalisable IDs, no duplicates)
     *
     * Optional:
     *   - `results` (group_exam only)         { id: result }
     *   - `teamResults` (team_vs_team only)   { id: result }
     *   - `individualResults` (team_vs_team only) { id: result }
     *   - `isPairExam` (group_exam only)
     *   - `pairings`   (group_exam + isPairExam only)
     *
     * Rejects:
     *   - `winner` / `loser` (no longer part of the model)
     *   - `advancing` (derived, not persisted)
     *   - any result map on the wrong match type
     *   - `isPairExam` on non-group_exam
     *   - `pairings` without `isPairExam`
     *   - participant count mismatch against round.matchSize for
     *     group_exam
     */
    function normaliseMatch(match, expectedSize, expectedMatchType) {
        if (!isObject(match)) {
            return null;
        }

        var id = normaliseId(match.id);
        if (id === null) {
            return null;
        }

        var type = match.type;
        if (!isValidMatchType(type)) {
            return null;
        }

        if (expectedMatchType !== undefined &&
            expectedMatchType !== null &&
            type !== expectedMatchType) {
            return null;
        }

        var status = match.status;
        if (!isValidMatchStatus(status)) {
            return null;
        }

        if (!Array.isArray(match.participants)) {
            return null;
        }

        var participants = [];
        var seen = Object.create(null);
        for (var i = 0; i < match.participants.length; i++) {
            var pid = normaliseId(match.participants[i]);
            if (pid === null) { return null; }
            if (seen[pid]) { return null; }
            seen[pid] = true;
            participants.push(pid);
        }

        if (participants.length < 2) {
            return null;
        }

        // Participant count rules per type.
        if (type === 'group_exam') {
            if (typeof expectedSize === 'number' && expectedSize >= 2) {
                if (participants.length !== expectedSize) {
                    return null;
                }
            }
        } else if (type === 'team_vs_team') {
            if (participants.length < 2) {
                return null;
            }
        }

        // Reject retired fields.
        if (match.winner !== undefined && match.winner !== null) {
            return null;
        }
        if (match.loser !== undefined && match.loser !== null) {
            return null;
        }
        if (match.advancing !== undefined) {
            return null;
        }

        var result = {
            id: id,
            participants: participants,
            type: type,
            status: status
        };

        if (type === 'group_exam') {
            var isPairExam = match.isPairExam === true;
            if (isPairExam) {
                result.isPairExam = true;
            }

            if (match.results !== undefined && match.results !== null) {
                var results = normaliseResultsMap(match.results);
                if (results === null) { return null; }
                // Every key must be a participant.
                var rKeys = Object.keys(results);
                for (var r = 0; r < rKeys.length; r++) {
                    if (participants.indexOf(rKeys[r]) === -1) {
                        return null;
                    }
                }
                result.results = results;
            } else {
                result.results = {};
            }

            if (isPairExam) {
                if (match.pairings === undefined || match.pairings === null) {
                    result.pairings = [];
                } else {
                    var pairings = normalisePairings(match.pairings);
                    if (pairings === null) { return null; }
                    if (!pairingsCoverParticipants(pairings, participants)) {
                        return null;
                    }
                    result.pairings = pairings;
                }
            } else {
                if (match.pairings !== undefined && match.pairings !== null) {
                    // Pairings on a non-pair group_exam are invalid.
                    return null;
                }
            }
        } else if (type === 'team_vs_team') {
            if (match.isPairExam !== undefined && match.isPairExam !== null &&
                match.isPairExam !== false) {
                return null;
            }
            if (match.pairings !== undefined && match.pairings !== null) {
                return null;
            }

            if (match.teamResults !== undefined && match.teamResults !== null) {
                var teamResults = normaliseResultsMap(match.teamResults);
                if (teamResults === null) { return null; }
                var tKeys = Object.keys(teamResults);
                for (var t = 0; t < tKeys.length; t++) {
                    if (participants.indexOf(tKeys[t]) === -1) {
                        return null;
                    }
                }
                result.teamResults = teamResults;
            } else {
                result.teamResults = {};
            }

            if (match.individualResults !== undefined &&
                match.individualResults !== null) {
                var individualResults = normaliseResultsMap(
                    match.individualResults
                );
                if (individualResults === null) { return null; }
                result.individualResults = individualResults;
            } else {
                result.individualResults = {};
            }

            if (match.results !== undefined && match.results !== null) {
                return null;
            }
        }

        // Preserve unknown properties (deep-cloned).
        var knownKeys = [
            'id',
            'participants',
            'type',
            'status',
            'results',
            'isPairExam',
            'pairings',
            'teamResults',
            'individualResults',
            'winner',
            'loser',
            'advancing'
        ];
        Object.keys(match).forEach(function(key) {
            if (knownKeys.indexOf(key) === -1) {
                result[key] = deepClone(match[key]);
            }
        });

        return result;
    }

    /**
     * Normalise a round record.
     *
     * Required:
     *   - `id`           (must already exist; never generated here)
     *   - `status`       (a valid match status)
     *   - `matchSize`    (integer >= 2)
     *   - `matchType`    (a valid match type)
     *   - `matches`      (array of normalisable matches)
     *
     * roundNumber is POSITIONAL and recomputed from `index` when
     * supplied. Otherwise the stored value is validated as a positive
     * integer.
     */
    function normaliseRound(round, index) {
        if (!isObject(round)) {
            return null;
        }

        var id = normaliseId(round.id);
        if (id === null) {
            return null;
        }

        var status = round.status;
        if (!isValidMatchStatus(status)) {
            return null;
        }

        var matchSize = coerceInteger(round.matchSize);
        if (matchSize === null || matchSize < 2) {
            return null;
        }

        var matchType = round.matchType;
        if (!isValidMatchType(matchType)) {
            return null;
        }

        var isPairExam = round.isPairExam === true;
        if (isPairExam && matchType !== 'group_exam') {
            return null;
        }

        if (!Array.isArray(round.matches)) {
            return null;
        }

        var matches = [];
        for (var i = 0; i < round.matches.length; i++) {
            var normalisedMatch = normaliseMatch(
                round.matches[i],
                matchSize,
                matchType
            );
            if (normalisedMatch === null) {
                return null;
            }
            matches.push(normalisedMatch);
        }

        var roundNumber;
        if (typeof index === 'number' && isFinite(index) && index >= 0) {
            roundNumber = index + 1;
        } else {
            var coerced = coerceInteger(round.roundNumber);
            if (coerced === null || coerced < 1) {
                return null;
            }
            roundNumber = coerced;
        }

        var result = {
            id: id,
            roundNumber: roundNumber,
            status: status,
            matchSize: matchSize,
            matchType: matchType,
            matches: matches
        };

        if (isPairExam) {
            result.isPairExam = true;
        }

        var knownKeys = [
            'id',
            'roundNumber',
            'status',
            'matchSize',
            'matchType',
            'matches',
            'isPairExam'
        ];
        Object.keys(round).forEach(function(key) {
            if (knownKeys.indexOf(key) === -1) {
                result[key] = deepClone(round[key]);
            }
        });

        return result;
    }

    /**
     * Normalise an elimination record.
     *
     * Required:
     *   - `participantId`     (coercible via normaliseId)
     *   - `tournamentId`      (coercible via normaliseId)
     *   - `participantType`   (a valid participant type)
     *   - `week`              (integer in [MIN_WEEK, MAX_WEEK])
     *
     * Optional:
     *   - `reason`            (string; missing becomes '')
     *   - `standalone`        (boolean; missing becomes false)
     *   - `fromRoundId`, `fromMatchId` (provenance; preserved as-is)
     */
    function normaliseElimination(elimination) {
        if (!isObject(elimination)) {
            return null;
        }

        var participantId = normaliseId(elimination.participantId);
        if (participantId === null) { return null; }

        var tournamentId = normaliseId(elimination.tournamentId);
        if (tournamentId === null) { return null; }

        var participantType = elimination.participantType;
        if (!isValidParticipantType(participantType)) {
            return null;
        }

        var week = coerceInteger(elimination.week);
        if (week === null || week < MIN_WEEK || week > MAX_WEEK) {
            return null;
        }

        var reason = '';
        if (elimination.reason !== undefined &&
            elimination.reason !== null) {
            if (typeof elimination.reason !== 'string') {
                return null;
            }
            reason = elimination.reason;
        }

        var standalone = elimination.standalone === true;

        var result = {
            participantId: participantId,
            tournamentId: tournamentId,
            participantType: participantType,
            week: week,
            reason: reason,
            standalone: standalone
        };

        // Preserve provenance and any unknown fields.
        var knownKeys = [
            'participantId',
            'tournamentId',
            'participantType',
            'week',
            'reason',
            'standalone'
        ];
        Object.keys(elimination).forEach(function(key) {
            if (knownKeys.indexOf(key) === -1) {
                result[key] = deepClone(elimination[key]);
            }
        });

        return result;
    }

    /**
     * Normalise a tournament record.
     *
     * Required:
     *   - `id`, `name`, `mode`, `status`
     *   - `startWeek`, `endWeek` (integers in [MIN_WEEK, MAX_WEEK])
     *   - `totalRounds` (integer >= 1)
     *   - `participants`, `rounds`, `eliminations` (arrays)
     *
     * Optional:
     *   - `graduatingClassId` (nullable)
     *   - `classFilterEnabled` (boolean; missing becomes false)
     *   - `createdAt` (string; missing becomes null)
     *
     * Rejects:
     *   - `winner` present and non-null
     *   - any nested structural failure
     */
    function normaliseTournament(tournament) {
        if (!isObject(tournament)) {
            return null;
        }

        var id = normaliseId(tournament.id);
        if (id === null) { return null; }

        if (!isNonEmptyString(tournament.name)) {
            return null;
        }
        var name = tournament.name.trim();

        var mode = tournament.mode;
        if (!isValidMode(mode)) { return null; }

        var status = tournament.status;
        if (!isValidStatus(status)) { return null; }

        var startWeek = coerceInteger(tournament.startWeek);
        if (startWeek === null || startWeek < MIN_WEEK || startWeek > MAX_WEEK) {
            return null;
        }

        var endWeek = coerceInteger(tournament.endWeek);
        if (endWeek === null || endWeek < MIN_WEEK || endWeek > MAX_WEEK) {
            return null;
        }

        if (startWeek > endWeek) { return null; }

        var totalRounds = coerceInteger(tournament.totalRounds);
        if (totalRounds === null || totalRounds < 1) {
            return null;
        }

        if (!Array.isArray(tournament.participants)) { return null; }
        if (!Array.isArray(tournament.rounds)) { return null; }
        if (!Array.isArray(tournament.eliminations)) { return null; }

        if (tournament.winner !== undefined && tournament.winner !== null) {
            return null;
        }

        // Participants.
        var participants = [];
        var seenParticipantIds = Object.create(null);
        for (var p = 0; p < tournament.participants.length; p++) {
            var normalisedParticipant = normaliseParticipant(
                tournament.participants[p],
                mode
            );
            if (normalisedParticipant === null) { return null; }
            if (seenParticipantIds[normalisedParticipant.id]) {
                return null;
            }
            seenParticipantIds[normalisedParticipant.id] = true;
            participants.push(normalisedParticipant);
        }

        // Rounds.
        var rounds = [];
        var seenRoundIds = Object.create(null);
        for (var r = 0; r < tournament.rounds.length; r++) {
            var normalisedRound = normaliseRound(tournament.rounds[r], r);
            if (normalisedRound === null) { return null; }
            if (seenRoundIds[normalisedRound.id]) { return null; }
            seenRoundIds[normalisedRound.id] = true;
            rounds.push(normalisedRound);
        }

        // Eliminations.
        var eliminations = [];
        var seenElims = Object.create(null);
        for (var e = 0; e < tournament.eliminations.length; e++) {
            var normalisedElimination = normaliseElimination(
                tournament.eliminations[e]
            );
            if (normalisedElimination === null) { return null; }
            var elimKey = normalisedElimination.participantId + '\u0000' +
                normalisedElimination.tournamentId;
            if (seenElims[elimKey]) { return null; }
            seenElims[elimKey] = true;
            eliminations.push(normalisedElimination);
        }

        // Optional fields.
        var graduatingClassId = null;
        if (tournament.graduatingClassId !== undefined &&
            tournament.graduatingClassId !== null) {
            graduatingClassId = normaliseId(tournament.graduatingClassId);
            if (graduatingClassId === null) { return null; }
        }

        var classFilterEnabled = false;
        if (tournament.classFilterEnabled !== undefined) {
            if (typeof tournament.classFilterEnabled !== 'boolean') {
                return null;
            }
            classFilterEnabled = tournament.classFilterEnabled;
        }

        var createdAt = null;
        if (tournament.createdAt !== undefined &&
            tournament.createdAt !== null) {
            if (typeof tournament.createdAt !== 'string') {
                return null;
            }
            createdAt = tournament.createdAt;
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
            graduatingClassId: graduatingClassId,
            classFilterEnabled: classFilterEnabled,
            createdAt: createdAt,
            _schemaVersion: SCHEMA_VERSION
        };

        var knownTopKeys = [
            'id',
            'name',
            'mode',
            'startWeek',
            'endWeek',
            'totalRounds',
            'status',
            'participants',
            'rounds',
            'eliminations',
            'graduatingClassId',
            'classFilterEnabled',
            'createdAt',
            '_schemaVersion',
            'winner'
        ];

        Object.keys(tournament).forEach(function(key) {
            if (knownTopKeys.indexOf(key) === -1) {
                result[key] = deepClone(tournament[key]);
            }
        });

        return result;
    }

    // ============================================================
    // PARTICIPANT IDENTITY
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
                if (participantType !== undefined &&
                    participantType !== null) {
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

    // Private helpers. Not exported.
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
    // ROUND AND MATCH LOOKUP BY ID - DEFENSIVE COPIES
    // ============================================================
    //
    // Public lookups return DEFENSIVE COPIES. A caller holding a
    // reference cannot mutate the live tournament through it.
    // Internal consumers that need the live reference should use the
    // *Internal variants.

    function findRoundById(tournament, roundId) {
        var live = findRoundByIdInternal(tournament, roundId);
        return live ? cloneRound(live) : null;
    }

    function findRoundByIdInternal(tournament, roundId) {
        if (!tournament || !Array.isArray(tournament.rounds)) {
            return null;
        }
        var target = normaliseId(roundId);
        if (target === null) { return null; }

        for (var i = 0; i < tournament.rounds.length; i++) {
            var r = tournament.rounds[i];
            if (r && normaliseId(r.id) === target) {
                return r;
            }
        }
        return null;
    }

    function findRoundIndexById(tournament, roundId) {
        if (!tournament || !Array.isArray(tournament.rounds)) {
            return -1;
        }
        var target = normaliseId(roundId);
        if (target === null) { return -1; }

        for (var i = 0; i < tournament.rounds.length; i++) {
            var r = tournament.rounds[i];
            if (r && normaliseId(r.id) === target) {
                return i;
            }
        }
        return -1;
    }

    function findMatchById(round, matchId) {
        var live = findMatchByIdInternal(round, matchId);
        return live ? cloneMatch(live) : null;
    }

    function findMatchByIdInternal(round, matchId) {
        if (!round || !Array.isArray(round.matches)) {
            return null;
        }
        var target = normaliseId(matchId);
        if (target === null) { return null; }

        for (var i = 0; i < round.matches.length; i++) {
            var m = round.matches[i];
            if (m && normaliseId(m.id) === target) {
                return m;
            }
        }
        return null;
    }

    function findMatchIndexById(round, matchId) {
        if (!round || !Array.isArray(round.matches)) {
            return -1;
        }
        var target = normaliseId(matchId);
        if (target === null) { return -1; }

        for (var i = 0; i < round.matches.length; i++) {
            var m = round.matches[i];
            if (m && normaliseId(m.id) === target) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Find a match across the whole tournament by match ID.
     * Returns { round, match, roundIndex, matchIndex } or null.
     */
    function findMatchInTournament(tournament, matchId) {
        if (!tournament || !Array.isArray(tournament.rounds)) {
            return null;
        }
        var target = normaliseId(matchId);
        if (target === null) { return null; }

        for (var r = 0; r < tournament.rounds.length; r++) {
            var round = tournament.rounds[r];
            if (!round || !Array.isArray(round.matches)) { continue; }
            for (var m = 0; m < round.matches.length; m++) {
                if (round.matches[m] &&
                    normaliseId(round.matches[m].id) === target) {
                    return {
                        round: round,
                        match: round.matches[m],
                        roundIndex: r,
                        matchIndex: m
                    };
                }
            }
        }
        return null;
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
    // STRUCTURAL GETTERS - DEFENSIVE COPIES
    // ============================================================
    //
    // Private helpers. Kept for internal use; not exported. Callers
    // that want these go through TournamentQueries.

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

    // ============================================================
    // DERIVATION
    // ============================================================
    //
    // All derivations here are PURE and STRUCTURAL. They compute a
    // value from a tournament or match. They never persist, never
    // mutate, never consult external state.

    /**
     * Derive the set of advancing participants from a completed match.
     *
     *   group_exam   : participants whose result is 'pass' or 'retry'
     *   team_vs_team : teams whose teamResults value is 'pass' or 'retry'
     */
    function deriveAdvancing(match) {
        if (!match || typeof match !== 'object') {
            return [];
        }

        var type = match.type || 'group_exam';

        if (type === 'group_exam') {
            var participants = Array.isArray(match.participants)
                ? match.participants
                : [];
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
            var teams = Array.isArray(match.participants)
                ? match.participants
                : [];
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

        return [];
    }

    /**
     * Derive the final passers of a tournament.
     *
     * Final passers are the union of advancing participants across all
     * matches in the LAST round (by array position).
     *
     * ROUND ORDER IS SEMANTICALLY MEANINGFUL. roundNumber is derived
     * from array position. Reordering rounds is not cosmetic; it
     * changes the tournament structure.
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

        var seen = Object.create(null);
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

    // ============================================================
    // STRUCTURAL VALIDATION
    // ============================================================
    //
    // validateMatch is kept public because tournament-matches.js
    // calls it from validateProposedMatch. The others are used
    // internally by validateTournament; they are not exported.

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
            errors.push(
                'Cannot determine canonical participant type for mode: ' +
                mode
            );
        } else if (type !== canonicalType) {
            errors.push(
                'Participant type "' + type +
                '" does not match tournament mode "' +
                mode + '" (expected "' + canonicalType + '").'
            );
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

    /**
     * Validate a match against its round.
     *
     * Participant count rules per type:
     *   group_exam   : participants.length === round.matchSize
     *   team_vs_team : participants.length >= 2
     *
     * This function is part of the public export. It is called from
     * TournamentMatches.validateProposedMatch.
     */
    function validateMatch(match, round, strict) {
        var errors = [];

        if (!match || typeof match !== 'object') {
            errors.push('Match must be an object.');
            return errors;
        }

        if (normaliseId(match.id) === null) {
            errors.push('Match ID is required.');
        }

        var type = match.type;
        if (!isValidMatchType(type)) {
            errors.push('Invalid match type: ' + type);
            return errors;
        }

        if (round && round.matchType && type !== round.matchType) {
            errors.push(
                'Match type "' + type +
                '" does not match round type "' + round.matchType + '".'
            );
        }

        var status = match.status;
        if (!isValidMatchStatus(status)) {
            errors.push('Invalid match status: ' + status);
        }

        if (match.winner !== undefined && match.winner !== null) {
            errors.push('Match has a retired "winner" field.');
        }
        if (match.loser !== undefined && match.loser !== null) {
            errors.push('Match has a retired "loser" field.');
        }
        if (match.advancing !== undefined) {
            errors.push(
                'Match has a persisted "advancing" field. ' +
                'Advancing is derived from results; it is not stored.'
            );
        }

        var participants = Array.isArray(match.participants)
            ? match.participants
            : [];

        if (type === 'group_exam') {
            var expectedSize = round && typeof round.matchSize === 'number'
                ? round.matchSize
                : null;
            if (expectedSize !== null &&
                participants.length !== expectedSize) {
                errors.push(
                    'Match has ' + participants.length +
                    ' participants, expected ' + expectedSize + '.'
                );
            }
        } else if (type === 'team_vs_team') {
            if (participants.length < 2) {
                errors.push(
                    'Team match requires at least 2 teams, has ' +
                    participants.length + '.'
                );
            }
        }

        var participantSeen = Object.create(null);
        for (var i = 0; i < participants.length; i++) {
            var pid = normaliseId(participants[i]);
            if (pid === null) {
                errors.push('Participant ' + i + ': Invalid ID.');
                continue;
            }
            if (participantSeen[pid]) {
                errors.push('Duplicate participant: ' + pid);
            }
            participantSeen[pid] = true;
        }

        if (type === 'group_exam') {
            validateGroupExamResults(match, participants, errors);

            if (match.isPairExam === true) {
                validatePairings(match, participants, errors);
            } else if (match.isPairExam !== undefined &&
                       match.isPairExam !== null &&
                       match.isPairExam !== false) {
                errors.push('isPairExam must be true or absent.');
            }
        } else {
            if (match.isPairExam !== undefined &&
                match.isPairExam !== null &&
                match.isPairExam !== false) {
                errors.push(
                    'isPairExam is only valid on group_exam matches.'
                );
            }
            if (match.pairings !== undefined && match.pairings !== null) {
                errors.push(
                    'pairings is only valid on pair exams (group_exam ' +
                    'with isPairExam === true).'
                );
            }
        }

        if (type === 'team_vs_team') {
            validateTeamResults(match, participants, errors);
            validateIndividualResults(match, errors);
        }

        return errors;
    }

    function validateGroupExamResults(match, participants, errors) {
        var results = match.results;

        if (results === undefined || results === null) {
            if (match.status === 'completed') {
                errors.push('Completed group exam has no results.');
            }
            return;
        }

        if (!isObject(results)) {
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
                errors.push(
                    'Invalid result for ' + id + ': ' + value +
                    ' (expected pass, fail, or retry).'
                );
            }
        }

        if (match.status === 'completed') {
            for (var j = 0; j < participants.length; j++) {
                var pid = normaliseId(participants[j]);
                if (pid !== null && results[pid] === undefined) {
                    errors.push(
                        'Completed group exam missing result for ' + pid + '.'
                    );
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
            errors.push(
                'Pairings must partition all participants into groups ' +
                'of 2 or 3.'
            );
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

        if (!isObject(teamResults)) {
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
                errors.push(
                    'Team result for ' + id +
                    ' is not a participating team.'
                );
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
                    errors.push(
                        'Completed team match missing result for team ' +
                        tid + '.'
                    );
                }
            }
        }
    }

    /**
     * Validate individual results on a team match.
     *
     * NOTE: This function DOES NOT check that the character IDs are
     * members of the participating teams. Schema does not know team
     * membership; that is a cross-domain concern validated at the
     * Rules layer or by the caller. Schema enforces only:
     *   - the map is an object
     *   - keys are normalisable IDs
     *   - values are valid result vocabulary
     */
    function validateIndividualResults(match, errors) {
        var individualResults = match.individualResults;

        if (individualResults === undefined || individualResults === null) {
            return;
        }

        if (!isObject(individualResults)) {
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
                errors.push(
                    'Invalid individual result for ' + id + ': ' + value
                );
            }
        }
    }

    // Private helper.
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

    // Private helper.
    function validateRound(round, strict) {
        var errors = [];

        if (!round || typeof round !== 'object') {
            errors.push('Round must be an object.');
            return errors;
        }

        if (normaliseId(round.id) === null) {
            errors.push('Round ID is required.');
        }

        var status = round.status;
        if (!isValidMatchStatus(status)) {
            errors.push('Invalid round status: ' + status);
        }

        if (round.matchSize !== undefined && round.matchSize !== null) {
            var size = coerceInteger(round.matchSize);
            if (size === null || size < 2) {
                errors.push('matchSize must be an integer >= 2.');
            }
        } else {
            errors.push('matchSize is required.');
        }

        if (round.matchType !== undefined && round.matchType !== null) {
            if (!isValidMatchType(round.matchType)) {
                errors.push('Invalid matchType: ' + round.matchType);
            }
        } else {
            errors.push('matchType is required.');
        }

        if (round.isPairExam === true && round.matchType !== 'group_exam') {
            errors.push('isPairExam requires matchType "group_exam".');
        }

        return errors;
    }

    // Private helper.
    function validateRounds(rounds, strict) {
        var errors = [];

        if (!Array.isArray(rounds)) {
            errors.push('Rounds must be an array.');
            return errors;
        }

        var seenRoundIds = Object.create(null);
        var seenMatchIds = Object.create(null);

        for (var i = 0; i < rounds.length; i++) {
            var rErrors = validateRound(rounds[i], strict);
            if (rErrors.length > 0) {
                errors.push('Round ' + i + ': ' + rErrors.join(' '));
            }

            var roundId = rounds[i] ? normaliseId(rounds[i].id) : null;
            if (roundId !== null) {
                if (seenRoundIds[roundId]) {
                    errors.push('Duplicate round ID: ' + roundId);
                }
                seenRoundIds[roundId] = true;
            }

            if (rounds[i] && Array.isArray(rounds[i].matches)) {
                var mErrors = validateMatches(rounds[i], strict);
                if (mErrors.length > 0) {
                    errors = errors.concat(mErrors);
                }

                // Match IDs must be globally unique within the
                // tournament, not merely within each round.
                for (var m = 0; m < rounds[i].matches.length; m++) {
                    var matchId = rounds[i].matches[m]
                        ? normaliseId(rounds[i].matches[m].id)
                        : null;
                    if (matchId === null) { continue; }
                    if (seenMatchIds[matchId]) {
                        errors.push(
                            'Duplicate match ID across tournament: ' +
                            matchId
                        );
                    }
                    seenMatchIds[matchId] = true;
                }
            }
        }

        return errors;
    }

    // Private helper.
    function validateElimination(elimination, strict) {
        var errors = [];

        if (!elimination || typeof elimination !== 'object') {
            errors.push('Elimination must be an object.');
            return errors;
        }

        if (normaliseId(elimination.participantId) === null) {
            errors.push('Elimination participantId is required.');
        }

        if (normaliseId(elimination.tournamentId) === null) {
            errors.push('Elimination tournamentId is required.');
        }

        if (!isValidParticipantType(elimination.participantType)) {
            errors.push(
                'Invalid participantType: ' +
                elimination.participantType
            );
        }

        var week = coerceInteger(elimination.week);
        if (week === null || week < MIN_WEEK || week > MAX_WEEK) {
            errors.push('Invalid week: ' + elimination.week);
        }

        if (elimination.reason !== undefined &&
            elimination.reason !== null &&
            typeof elimination.reason !== 'string') {
            errors.push('Elimination reason must be a string.');
        }

        if (elimination.standalone !== undefined &&
            elimination.standalone !== null &&
            typeof elimination.standalone !== 'boolean') {
            errors.push('Elimination standalone must be a boolean.');
        }

        return errors;
    }

    // Private helper.
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

            var key = normaliseId(e.participantId) + '\u0000' +
                normaliseId(e.tournamentId);
            if (seen[key]) {
                errors.push(
                    'Duplicate elimination for participant: ' +
                    normaliseId(e.participantId)
                );
            }
            seen[key] = true;
        }

        return errors;
    }

    /**
     * Validate a tournament.
     *
     * STRUCTURAL LAYER: does not check that participant IDs exist in
     * the wider application. That is a Rules concern.
     *
     * CROSS-ENTITY LAYER: DOES check that participants referenced by
     * matches and eliminations actually appear in
     * tournament.participants, and that match IDs are globally unique.
     *
     *   Exception: in `teams` mode, the elimination cross-entity
     *   check for participant IDs is skipped. Team-mode tournaments     *   legitimately carry character-side elimination records
     *   (from individualResults of team matches), and those
     *   characters are not in tournament.participants. The
     *   participantType consistency check still runs and correctly
     *   short-circuits when the ID does not resolve to a
     *   participant record.
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

        if (normaliseId(tournament.id) === null) {
            errors.push('Tournament ID is required.');
        }

        if (!isNonEmptyString(tournament.name)) {
            errors.push('Tournament name is required.');
        }

        if (!isValidMode(tournament.mode)) {
            errors.push('Invalid mode: ' + tournament.mode);
        }

        if (!isValidStatus(tournament.status)) {
            errors.push('Invalid status: ' + tournament.status);
        }

        var startWeek = coerceInteger(tournament.startWeek);
        var endWeek = coerceInteger(tournament.endWeek);

        if (startWeek === null ||
            startWeek < MIN_WEEK ||
            startWeek > MAX_WEEK) {
            errors.push('Invalid startWeek: ' + tournament.startWeek);
        }
        if (endWeek === null ||
            endWeek < MIN_WEEK ||
            endWeek > MAX_WEEK) {
            errors.push('Invalid endWeek: ' + tournament.endWeek);
        }
        if (startWeek !== null && endWeek !== null &&
            startWeek > endWeek) {
            errors.push(
                'startWeek (' + startWeek +
                ') cannot be after endWeek (' + endWeek + ').'
            );
        }

        var totalRounds = coerceInteger(tournament.totalRounds);
        if (totalRounds === null || totalRounds < 1) {
            errors.push('totalRounds must be an integer >= 1.');
        }

        if (tournament.graduatingClassId !== undefined &&
            tournament.graduatingClassId !== null) {
            if (normaliseId(tournament.graduatingClassId) === null) {
                errors.push('Invalid graduatingClassId.');
            }
        }

        if (tournament.classFilterEnabled !== undefined &&
            typeof tournament.classFilterEnabled !== 'boolean') {
            errors.push('classFilterEnabled must be a boolean.');
        }

        if (tournament.winner !== undefined && tournament.winner !== null) {
            errors.push(
                'Tournament has a retired "winner" field. ' +
                'The winner concept has been removed; use finalPassers.'
            );
        }

        if (strict) {
            var allowedKeys = [
                'id',
                'name',
                'mode',
                'startWeek',
                'endWeek',
                'totalRounds',
                'status',
                'participants',
                'rounds',
                'eliminations',
                'graduatingClassId',
                'classFilterEnabled',
                'createdAt',
                '_schemaVersion',
                'winner'
            ];
            for (var key in tournament) {
                if (Object.prototype.hasOwnProperty.call(tournament, key) &&
                    allowedKeys.indexOf(key) === -1) {
                    warnings.push('Unknown top-level property: ' + key);
                }
            }
        }

        if (!Array.isArray(tournament.participants)) {
            errors.push('participants must be an array.');
        } else {
            var pErrors = validateParticipants(
                tournament.participants,
                tournament.mode
            );
            if (pErrors.length > 0) {
                errors = errors.concat(pErrors);
            }
        }

        if (!Array.isArray(tournament.rounds)) {
            errors.push('rounds must be an array.');
        } else {
            var rErrors = validateRounds(tournament.rounds, strict);
            if (rErrors.length > 0) {
                errors = errors.concat(rErrors);
            }
        }

        if (!Array.isArray(tournament.eliminations)) {
            errors.push('eliminations must be an array.');
        } else {
            var eErrors = validateEliminations(
                tournament.eliminations,
                strict
            );
            if (eErrors.length > 0) {
                errors = errors.concat(eErrors);
            }
        }

        // ---- CROSS-ENTITY CHECKS ----
        if (Array.isArray(tournament.participants) &&
            Array.isArray(tournament.rounds)) {

            var participantIds = Object.create(null);
            for (var pi = 0; pi < tournament.participants.length; pi++) {
                var pid = normaliseId(tournament.participants[pi].id);
                if (pid !== null) {
                    participantIds[pid] = true;
                }
            }

            for (var ri = 0; ri < tournament.rounds.length; ri++) {
                var round = tournament.rounds[ri];
                if (!round || !Array.isArray(round.matches)) { continue; }
                for (var mi = 0; mi < round.matches.length; mi++) {
                    var match = round.matches[mi];
                    if (!match || !Array.isArray(match.participants)) {
                        continue;
                    }
                    for (var mpi = 0;
                         mpi < match.participants.length;
                         mpi++) {
                        var matchPid = normaliseId(
                            match.participants[mpi]
                        );
                        if (matchPid === null) { continue; }
                        if (!participantIds[matchPid]) {
                            errors.push(
                                'Round ' + ri + ' Match ' + mi +
                                ': participant ' + matchPid +
                                ' is not in tournament.participants.'
                            );
                        }
                    }
                }
            }
        }

        if (Array.isArray(tournament.participants) &&
            Array.isArray(tournament.eliminations)) {

            var elimParticipantIds = Object.create(null);
            for (var pp = 0; pp < tournament.participants.length; pp++) {
                var epid = normaliseId(tournament.participants[pp].id);
                if (epid !== null) {
                    elimParticipantIds[epid] = true;
                }
            }

            // Team-mode tournaments can legitimately carry
            // elimination records whose participantId is a
            // CHARACTER id, not a team id. The elimination cascade
            // writes character-side records for failing individuals
            // in a team match, and those records live in
            // tournament.eliminations[] alongside the team-side
            // ones. The character is not in tournament.participants
            // (which holds only team ids), so the participant-set
            // check does NOT apply. Skip the missing-participant
            // error in team mode, but still run the participantType
            // consistency check when the ID resolves to a
            // participant record.
            var isTeamMode = tournament.mode === 'teams';

            for (var ei = 0; ei < tournament.eliminations.length; ei++) {
                var elim = tournament.eliminations[ei];
                if (!elim) { continue; }
                var elimPid = normaliseId(elim.participantId);
                if (elimPid === null) { continue; }
                if (!elimParticipantIds[elimPid] && !isTeamMode) {
                    errors.push(
                        'Elimination ' + ei + ': participant ' + elimPid +
                        ' is not in tournament.participants.'
                    );
                }
                if (elim.participantType !== undefined &&
                    elim.participantType !== null) {
                    var actualType = getParticipantTypeFromRecord(
                        tournament,
                        elimPid
                    );
                    if (actualType !== null &&
                        actualType !== elim.participantType) {
                        errors.push(
                            'Elimination ' + ei + ': participantType "' +
                            elim.participantType + '" does not match ' +
                            'participant record type "' + actualType + '".'
                        );
                    }
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors,
            warnings: warnings
        };
    }

    // ============================================================
    // VALIDATION REPORT
    // ============================================================
    //
    // Private helper. Kept for internal use; not exported. If a
    // diagnostic caller needs it, it can be re-exported.

    function getValidationReport(tournament) {
        if (!tournament || typeof tournament !== 'object') {
            return {
                valid: false,
                errors: ['Tournament is null or not an object.']
            };
        }

        var rounds = Array.isArray(tournament.rounds)
            ? tournament.rounds
            : [];

        var roundIds = [];
        var matchIds = [];
        var missingRoundIds = 0;
        var missingMatchIds = 0;

        for (var i = 0; i < rounds.length; i++) {
            var r = rounds[i];
            if (!r) { continue; }
            var rid = normaliseId(r.id);
            if (rid === null) {
                missingRoundIds++;
            } else {
                roundIds.push(rid);
            }

            if (Array.isArray(r.matches)) {
                for (var j = 0; j < r.matches.length; j++) {
                    var m = r.matches[j];
                    if (!m) { continue; }
                    var mid = normaliseId(m.id);
                    if (mid === null) {
                        missingMatchIds++;
                    } else {
                        matchIds.push(mid);
                    }
                }
            }
        }

        return {
            id: tournament.id ? String(tournament.id) : null,
            name: tournament.name || null,
            mode: tournament.mode || null,
            status: tournament.status || null,
            startWeek: tournament.startWeek !== undefined &&
                tournament.startWeek !== null
                ? coerceInteger(tournament.startWeek)
                : null,
            endWeek: tournament.endWeek !== undefined &&
                tournament.endWeek !== null
                ? coerceInteger(tournament.endWeek)
                : null,
            totalRounds: tournament.totalRounds !== undefined &&
                tournament.totalRounds !== null
                ? coerceInteger(tournament.totalRounds)
                : null,
            graduatingClassId: tournament.graduatingClassId !== undefined &&
                tournament.graduatingClassId !== null
                ? String(tournament.graduatingClassId)
                : null,
            classFilterEnabled:
                typeof tournament.classFilterEnabled === 'boolean'
                    ? tournament.classFilterEnabled
                    : null,
            participantCount: Array.isArray(tournament.participants)
                ? tournament.participants.length
                : 0,
            roundCount: rounds.length,
            eliminationCount: Array.isArray(tournament.eliminations)
                ? tournament.eliminations.length
                : 0,
            createdAt: tournament.createdAt || null,
            _schemaVersion: tournament._schemaVersion !== undefined
                ? tournament._schemaVersion
                : null,
            roundIds: roundIds,
            matchIds: matchIds,
            missingRoundIds: missingRoundIds,
            missingMatchIds: missingMatchIds
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentSchema = Object.freeze({
        VALID_STATUSES: VALID_STATUSES,
        VALID_MODES: VALID_MODES,
        VALID_MATCH_TYPES: VALID_MATCH_TYPES,
        VALID_MATCH_STATUSES: VALID_MATCH_STATUSES,
        VALID_PARTICIPANT_TYPES: VALID_PARTICIPANT_TYPES,
        VALID_RESULTS: VALID_RESULTS,
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,
        MIN_PAIR_SIZE: MIN_PAIR_SIZE,
        MAX_PAIR_SIZE: MAX_PAIR_SIZE,
        SCHEMA_VERSION: SCHEMA_VERSION,

        generateRoundId: generateRoundId,
        generateMatchId: generateMatchId,
        normaliseId: normaliseId,

        deepClone: deepClone,
        cloneRound: cloneRound,
        cloneMatch: cloneMatch,

        normaliseTournament: normaliseTournament,
        normaliseParticipant: normaliseParticipant,
        normaliseMatch: normaliseMatch,
        normaliseRound: normaliseRound,
        normaliseElimination: normaliseElimination,
        normalisePairings: normalisePairings,

        getCanonicalParticipantType: getCanonicalParticipantType,
        isParticipantTypeCanonical: isParticipantTypeCanonical,
        getParticipantTypeFromRecord: getParticipantTypeFromRecord,
        isParticipantInTournament: isParticipantInTournament,

        findRoundById: findRoundById,
        findRoundByIdInternal: findRoundByIdInternal,
        findRoundIndexById: findRoundIndexById,
        findMatchById: findMatchById,
        findMatchByIdInternal: findMatchByIdInternal,
        findMatchIndexById: findMatchIndexById,
        findMatchInTournament: findMatchInTournament,

        deriveAdvancing: deriveAdvancing,
        deriveFinalPassers: deriveFinalPassers,
        pairingsCoverParticipants: pairingsCoverParticipants,

        isValidMode: isValidMode,
        isValidStatus: isValidStatus,
        isValidMatchType: isValidMatchType,
        isValidMatchStatus: isValidMatchStatus,
        isValidParticipantType: isValidParticipantType,
        isValidResult: isValidResult,
        isParticipantEliminated: isParticipantEliminated,

        validateTournament: validateTournament,
        validateMatch: validateMatch
    });

})();