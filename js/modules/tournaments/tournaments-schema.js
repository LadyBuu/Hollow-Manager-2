/**
 * modules/tournaments/tournaments-schema.js - Tournament Schema
 * Single source of truth for tournament structure and validation
 * Path: js/modules/tournaments/tournaments-schema.js
 * 
 * This module is responsible for:
 *   - Structural validation of tournaments
 *   - Canonical representation rules
 *   - Participant identity management
 *   - Tournament lifecycle constants
 *   - Domain derivations (when purely structural)
 *   - Defensive cloning of tournament data
 * 
 * IMPORTANT:
 *   - Schema is the CONSTITUTIONAL AUTHORITY for tournament structure
 *   - Does NOT know about characters/teams in the wider application
 *   - Does NOT call saveData()
 *   - Does NOT perform business-rule validation (that belongs in Core)
 *   - Validation is STRICT: rejects unknown properties by default
 *   - However, the REPAIR module may preserve unknown properties
 *     and Schema's strict mode should tolerate them if present
 * 
 * MUTATION CONTRACT:
 *   - Schema.getters return DEEP CLONES to prevent external mutation
 *   - validateTournament() returns { valid, errors, warnings }
 *   - strict: true → canonical structure enforcement (but allows unknown props)
 *   - strict: false → minimal validation for legacy/repair
 * 
 * DEPENDENCIES:
 *   - window.CALENDAR_CONSTANTS (from constants.js)
 *   - window.CoreUtils (from core-utils.js) - for deepClone, normalizeId
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__tournamentsSchemaLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - Hard failure if missing
    // ============================================================

    var CALENDAR = window.CALENDAR_CONSTANTS;
    if (!CALENDAR) {
        console.error('TournamentsSchema: CALENDAR_CONSTANTS is required.');
        return;
    }

    var CoreUtils = window.CoreUtils;
    if (!CoreUtils || typeof CoreUtils.deepClone !== 'function') {
        console.error('TournamentsSchema: CoreUtils.deepClone is required.');
        return;
    }

    window.__tournamentsSchemaLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CALENDAR.MIN_WEEK || 1;
    var MAX_WEEK = CALENDAR.MAX_WEEK || 52;

    // Valid statuses
    var VALID_STATUSES = ['draft', 'active', 'completed'];
    var VALID_MODES = ['teams', 'individuals'];
    var VALID_MATCH_TYPES = ['standard', 'group_exam'];
    var VALID_MATCH_STATUSES = ['pending', 'in_progress', 'completed'];
    var VALID_PARTICIPANT_TYPES = ['character', 'team'];
    var VALID_GROUP_EXAM_RESULTS = ['pass', 'fail'];

    // Lifecycle rules - declarative
    var LIFECYCLE_RULES = {
        draft: {
            configure: true,
            participants: true,
            rounds: true,
            eliminations: false,
            complete: false
        },
        active: {
            configure: false,
            participants: false,
            rounds: true,
            eliminations: true,
            complete: true
        },
        completed: {
            configure: false,
            participants: false,
            rounds: false,
            eliminations: false,
            complete: false
        }
    };

    // ============================================================
    // ID NORMALISATION
    // ============================================================

    function normaliseId(value) {
        if (value === undefined || value === null) {
            return null;
        }
        var str = String(value).trim();
        return str !== '' ? str : null;
    }

    function normaliseIdStrict(value) {
        var id = normaliseId(value);
        if (id === null) {
            return null;
        }
        // IDs must be non-empty strings
        if (typeof id !== 'string' || id.length === 0) {
            return null;
        }
        return id;
    }

    // ============================================================
    // CLONING - Centralised, defensive
    // ============================================================

    function deepClone(value) {
        return CoreUtils.deepClone(value);
    }

    function cloneParticipant(participant) {
        if (!participant || typeof participant !== 'object') {
            return { id: null, type: null };
        }
        return {
            id: normaliseId(participant.id),
            type: participant.type || null
        };
    }

    function cloneMatch(match) {
        if (!match || typeof match !== 'object') {
            return null;
        }

        var participants = Array.isArray(match.participants)
            ? match.participants.map(function(p) {
                return typeof p === 'string' ? p : normaliseId(p);
            }).filter(function(id) { return id !== null; })
            : [];

        var results = null;
        if (match.type === 'group_exam' && match.results && typeof match.results === 'object') {
            results = {};
            for (var key in match.results) {
                if (Object.prototype.hasOwnProperty.call(match.results, key)) {
                    var normalisedKey = normaliseId(key);
                    if (normalisedKey !== null) {
                        var val = match.results[key];
                        if (val === 'pass' || val === 'fail') {
                            results[normalisedKey] = val;
                        }
                    }
                }
            }
        }

        var advancing = Array.isArray(match.advancing)
            ? match.advancing.map(function(p) {
                return typeof p === 'string' ? p : normaliseId(p);
            }).filter(function(id) { return id !== null; })
            : [];

        return {
            participants: participants,
            type: match.type || 'standard',
            status: match.status || 'pending',
            winner: match.winner !== undefined && match.winner !== null
                ? normaliseId(match.winner)
                : null,
            loser: match.loser !== undefined && match.loser !== null
                ? normaliseId(match.loser)
                : null,
            advancing: advancing,
            results: results
        };
    }

    function cloneRound(round) {
        if (!round || typeof round !== 'object') {
            return null;
        }

        var matches = Array.isArray(round.matches)
            ? round.matches.map(cloneMatch).filter(function(m) { return m !== null; })
            : [];

        return {
            status: round.status || 'pending',
            matchSize: (typeof round.matchSize === 'number' && round.matchSize >= 2) ? round.matchSize : 2,
            matches: matches,
            label: round.label || ''
        };
    }

    function cloneParticipantRecord(record) {
        if (!record || typeof record !== 'object') {
            return { id: null, type: null };
        }
        return {
            id: normaliseId(record.id),
            type: record.type || null
        };
    }

    function cloneElimination(elimination) {
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

        return {
            participantId: participantId,
            tournamentId: tournamentId,
            participantType: elimination.participantType || null,
            week: (typeof elimination.week === 'number') ? elimination.week : null,
            reason: elimination.reason || '',
            standalone: elimination.standalone === true
        };
    }

    function cloneTournament(tournament) {
        if (!tournament || typeof tournament !== 'object') {
            return null;
        }

        var id = normaliseId(tournament.id);
        if (id === null) {
            return null;
        }

        var participants = Array.isArray(tournament.participants)
            ? tournament.participants.map(cloneParticipant).filter(function(p) { return p.id !== null; })
            : [];

        var rounds = Array.isArray(tournament.rounds)
            ? tournament.rounds.map(cloneRound).filter(function(r) { return r !== null; })
            : [];

        var eliminations = Array.isArray(tournament.eliminations)
            ? tournament.eliminations.map(cloneElimination).filter(function(e) { return e !== null; })
            : [];

        return {
            id: id,
            name: tournament.name || '',
            mode: tournament.mode || 'individuals',
            startWeek: (typeof tournament.startWeek === 'number') ? tournament.startWeek : 1,
            endWeek: (typeof tournament.endWeek === 'number') ? tournament.endWeek : 52,
            totalRounds: (typeof tournament.totalRounds === 'number' && tournament.totalRounds >= 1) ? tournament.totalRounds : 1,
            status: tournament.status || 'draft',
            participants: participants,
            rounds: rounds,
            eliminations: eliminations,
            winner: tournament.winner !== undefined && tournament.winner !== null
                ? cloneParticipantRecord(tournament.winner)
                : null,
            createdAt: tournament.createdAt || new Date().toISOString(),
            _schemaVersion: 2,
            graduatingClassId: tournament.graduatingClassId !== undefined && tournament.graduatingClassId !== null
                ? normaliseId(tournament.graduatingClassId)
                : null,
            classFilterEnabled: typeof tournament.classFilterEnabled === 'boolean'
                ? tournament.classFilterEnabled
                : false
        };
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
            return true; // null is allowed
        }
        var id = normaliseId(value);
        return id !== null && id.length > 0;
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
        if (id === null) return null;

        for (var i = 0; i < tournament.participants.length; i++) {
            var p = tournament.participants[i];
            if (p && normaliseId(p.id) === id) {
                return p.type || null;
            }
        }
        return null;
    }

    function isParticipantInTournament(tournament, participantId) {
        if (!tournament || !Array.isArray(tournament.participants)) {
            return false;
        }
        var id = normaliseId(participantId);
        if (id === null) return false;

        for (var i = 0; i < tournament.participants.length; i++) {
            var p = tournament.participants[i];
            if (p && normaliseId(p.id) === id) {
                return true;
            }
        }
        return false;
    }

    function getParticipantIdKey(participant) {
        if (!participant || typeof participant !== 'object') {
            return null;
        }
        var id = normaliseId(participant.id);
        if (id === null) return null;
        return id + ':' + (participant.type || 'unknown');
    }

    function getParticipantIdKeyFromParts(id, type) {
        var normId = normaliseId(id);
        if (normId === null) return null;
        return normId + ':' + (type || 'unknown');
    }

    function participantMatches(p1, p2) {
        if (!p1 || !p2) return false;
        var id1 = normaliseId(p1.id);
        var id2 = normaliseId(p2.id);
        if (id1 === null || id2 === null) return false;
        if (id1 !== id2) return false;
        return (p1.type || null) === (p2.type || null);
    }

    // ============================================================
    // STRUCTURAL GETTERS - Return DEEP CLONES
    // ============================================================

    function getParticipants(tournament) {
        if (!tournament || !Array.isArray(tournament.participants)) {
            return [];
        }
        return tournament.participants.map(cloneParticipant).filter(function(p) { return p.id !== null; });
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
        return cloneParticipantRecord(tournament.winner);
    }

    function getCurrentRound(tournament) {
        if (!tournament || !Array.isArray(tournament.rounds)) {
            return 0;
        }
        return tournament.rounds.length;
    }

    // ============================================================
    // PARTICIPANT ELIMINATION CHECK
    // ============================================================

    function isParticipantEliminated(tournament, participantId) {
        if (!tournament || !Array.isArray(tournament.eliminations)) {
            return false;
        }
        var id = normaliseId(participantId);
        if (id === null) return false;

        for (var i = 0; i < tournament.eliminations.length; i++) {
            var e = tournament.eliminations[i];
            if (e && normaliseId(e.participantId) === id) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // VALIDATION
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
        var seen = {};

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
            // Strict mode: only known fields
            var allowedKeys = ['status', 'matchSize', 'matches', 'label'];
            for (var key in round) {
                if (Object.prototype.hasOwnProperty.call(round, key) && allowedKeys.indexOf(key) === -1) {
                    errors.push('Unknown round property: ' + key);
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
                    errors.push('Unknown elimination property: ' + key);
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

        if (!Array.isArray(eliminations)) {
            errors.push('Eliminations must be an array.');
            return errors;
        }

        var seen = {};
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
                    errors.push('Unknown match property: ' + key);
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
        var startWeek = parseInt(tournament.startWeek, 10);
        var endWeek = parseInt(tournament.endWeek, 10);
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
        var totalRounds = parseInt(tournament.totalRounds, 10);
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

        // Strict mode: reject unknown top-level properties
        if (strict) {
            var allowedKeys = [
                'id', 'name', 'mode', 'startWeek', 'endWeek', 'totalRounds',
                'status', 'participants', 'rounds', 'eliminations', 'winner',
                'createdAt', '_schemaVersion',
                'graduatingClassId', 'classFilterEnabled'
            ];
            for (var key in tournament) {
                if (Object.prototype.hasOwnProperty.call(tournament, key) && allowedKeys.indexOf(key) === -1) {
                    // In strict mode, unknown properties are WARNINGS, not errors
                    // This allows Repair to preserve legacy data while still validating structure
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

        // Winner must be a participant
        if (tournament.winner && tournament.winner !== null) {
            var winner = tournament.winner;
            var winnerId = normaliseId(winner.id);
            if (winnerId === null) {
                errors.push('Winner has invalid ID.');
            } else if (!isParticipantInTournament(tournament, winnerId)) {
                errors.push('Winner ' + winnerId + ' is not a tournament participant.');
            }
        }

        // Status-specific rules
        if (tournament.status === 'completed') {
            if (!tournament.winner) {
                errors.push('Completed tournament has no winner.');
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

        var report = {
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

        return report;
    }

    // ============================================================
    // LIFECYCLE HELPERS
    // ============================================================

    function getLifecycleRules(status) {
        return LIFECYCLE_RULES[status] || LIFECYCLE_RULES.draft;
    }

    function isStatusMutable(status) {
        return status !== 'completed';
    }

    function isStatusParticipantMutable(status) {
        return LIFECYCLE_RULES[status] ? LIFECYCLE_RULES[status].participants : false;
    }

    function isStatusEliminationMutable(status) {
        return LIFECYCLE_RULES[status] ? LIFECYCLE_RULES[status].eliminations : false;
    }

    function isStatusRoundMutable(status) {
        return LIFECYCLE_RULES[status] ? LIFECYCLE_RULES[status].rounds : false;
    }

    function isStatusConfigureMutable(status) {
        return LIFECYCLE_RULES[status] ? LIFECYCLE_RULES[status].configure : false;
    }

    function isStatusTerminal(status) {
        return status === 'completed';
    }

    function canAddRound(status, currentRoundCount, totalRounds) {
        if (!isStatusRoundMutable(status)) return false;
        if (currentRoundCount >= totalRounds) return false;
        return true;
    }

    function canCompleteTournament(status, winnerExists) {
        if (status === 'completed') return false;
        if (status !== 'active') return false;
        if (!winnerExists) return false;
        return true;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentsSchema = {
        // Constants
        VALID_STATUSES: VALID_STATUSES,
        VALID_MODES: VALID_MODES,
        VALID_MATCH_TYPES: VALID_MATCH_TYPES,
        VALID_MATCH_STATUSES: VALID_MATCH_STATUSES,
        VALID_PARTICIPANT_TYPES: VALID_PARTICIPANT_TYPES,
        VALID_GROUP_EXAM_RESULTS: VALID_GROUP_EXAM_RESULTS,
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK,

        // Lifecycle
        LIFECYCLE_RULES: LIFECYCLE_RULES,
        getLifecycleRules: getLifecycleRules,
        isStatusMutable: isStatusMutable,
        isStatusParticipantMutable: isStatusParticipantMutable,
        isStatusEliminationMutable: isStatusEliminationMutable,
        isStatusRoundMutable: isStatusRoundMutable,
        isStatusConfigureMutable: isStatusConfigureMutable,
        isStatusTerminal: isStatusTerminal,
        canAddRound: canAddRound,
        canCompleteTournament: canCompleteTournament,

        // ID Normalisation
        normaliseId: normaliseId,
        normaliseIdStrict: normaliseIdStrict,

        // Cloning
        deepClone: deepClone,
        cloneTournament: cloneTournament,
        cloneParticipant: cloneParticipant,
        cloneMatch: cloneMatch,
        cloneRound: cloneRound,
        cloneElimination: cloneElimination,

        // Participant Identity
        getCanonicalParticipantType: getCanonicalParticipantType,
        isParticipantTypeCanonical: isParticipantTypeCanonical,
        getParticipantTypeFromRecord: getParticipantTypeFromRecord,
        isParticipantInTournament: isParticipantInTournament,
        getParticipantIdKey: getParticipantIdKey,
        getParticipantIdKeyFromParts: getParticipantIdKeyFromParts,
        participantMatches: participantMatches,

        // Structural Getters (return clones)
        getParticipants: getParticipants,
        getRounds: getRounds,
        getEliminations: getEliminations,
        getWinner: getWinner,
        getCurrentRound: getCurrentRound,

        // Validation
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

})();
