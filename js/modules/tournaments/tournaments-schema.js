/**
 * js/modules/tournaments/tournaments-schema.js - Tournament Schema
 * SINGLE SOURCE OF TRUTH for all tournament validation rules.
 * 
 * SCHEMA PHILOSOPHY:
 *   - One constitution, not two competing constitutions
 *   - Used by Core, Queries, Repair, and Matches
 *   - All validation rules are centralised here
 *   - Prevents validator drift between modules
 *   - PURE: no side effects, no mutation, no persistence
 *   - DEEP VALIDATION: validates entire object graph, not just top-level
 *   - CRASH-SAFE: never throws on malformed input; returns errors
 * 
 * CONSTITUTIONAL DECISIONS:
 *   - currentRound is DERIVED from rounds.length and is NOT stored in canonical data
 *   - Tournament status: 'completed' is AUTHORITATIVE for completion queries
 *   - Elimination is final: a winner cannot be eliminated
 *   - Legacy fields (teams, winners, flat matches) are NOT part of canonical schema
 *   - Canonical IDs are strings (non-empty, no surrounding whitespace) or numbers (converted to strings)
 *   - Canonical numbers are actual numbers (not strings) in strict mode
 *   - Canonical timestamps are ISO 8601 strings in UTC (optional for legacy compatibility)
 *   - participants, rounds, eliminations are REQUIRED canonical arrays (may be empty)
 *   - Participant type is SEMANTIC IDENTITY: mode determines canonical type
 *   - Group exams: winner and loser MUST be null (properties MUST exist)
 *   - Round matchSize MUST be enforced on all matches in the round
 *   - Round matchType MUST be enforced on all matches in the round
 *   - _schemaVersion: if present, must be a positive integer <= SCHEMA_VERSION
 *   - addedAt: if present, must be a valid canonical JavaScript ISO timestamp in UTC
 *   - rounds.length <= totalRounds (actual rounds cannot exceed configured maximum)
 *   - advancing semantics are structural only; business rules belong in Core
 *   - graduatingClassId: optional, null or non-empty string (valid graduating class ID)
 *   - classFilterEnabled: optional, boolean (defaults to true in UI)
 * 
 * STRICTNESS SEMANTICS:
 *   - strict: false → "Is this structurally understandable tournament data?"
 *     (allows legacy unknown properties, numeric strings, and optional fields)
 * 
 *   - strict: true → "Is this a valid canonical tournament object?"
 *     (rejects unknown properties, enforces all field requirements, requires actual types)
 * 
 * INVARIANTS ENFORCED:
 *   - No duplicate participant IDs
 *   - No duplicate elimination records per participant
 *   - Elimination week within tournament week range
 *   - Elimination participant exists in tournament with matching type
 *   - Winner exists in tournament with matching type
 *   - Winner is NOT eliminated
 *   - Group exam winner/loser MUST be null
 *   - Match participant count MUST match round.matchSize
 *   - Match type MUST match round.matchType
 *   - Completed group exam MUST have results for all participants
 *   - Completed standard match MUST have a winner
 *   - No duplicate advancing IDs
 *   - rounds.length <= totalRounds
 *   - Completed rounds MUST have all matches completed
 *   - graduatingClassId: must be a valid ID or null
 *   - classFilterEnabled: must be a boolean
 * 
 * SCHEMA VERSIONING:
 *   - SCHEMA_VERSION is the current version
 *   - New tournaments get _schemaVersion set on creation
 *   - Existing tournaments without _schemaVersion are assumed version 1
 *   - Future migrations can use _schemaVersion to upgrade data
 * 
 * DEPENDENCIES:
 *   - window.CALENDAR_CONSTANTS (from constants.js)
 */

(function() {
    'use strict';

    if (window.__tournamentsSchemaLoaded) return;
    window.__tournamentsSchemaLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var SCHEMA_VERSION = 2;
    var VALID_MODES = ['teams', 'individuals'];
    var VALID_STATUSES = ['draft', 'active', 'completed'];
    var VALID_PARTICIPANT_TYPES = ['character', 'team'];
    var VALID_MATCH_TYPES = ['standard', 'group_exam'];
    var VALID_MATCH_STATUSES = ['pending', 'in_progress', 'completed'];
    var VALID_GROUP_EXAM_RESULTS = ['pass', 'fail'];

    // ============================================================
    // CALENDAR CONSTANTS - Use from global constants when available
    // ============================================================

    var CALENDAR = window.CALENDAR_CONSTANTS || {};
    var MIN_WEEK = Number.isInteger(CALENDAR.MIN_WEEK) ? CALENDAR.MIN_WEEK : 1;
    var MAX_WEEK = Number.isInteger(CALENDAR.MAX_WEEK) ? CALENDAR.MAX_WEEK : 52;

    // ============================================================
    // TYPE HELPERS - STRICT INPUT VALIDATION
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    /**
     * Parse a positive integer from a value.
     * Accepts numbers and numeric strings. Rejects booleans, null, undefined, objects.
     * Returns null for invalid values.
     */
    function parsePositiveInteger(value) {
        // Reject null, undefined, boolean, object, array
        if (value === null || value === undefined) return null;
        if (typeof value === 'boolean') return null;
        if (typeof value === 'object') return null;

        // Accept number or string
        if (typeof value === 'number') {
            return Number.isInteger(value) && value >= 1 ? value : null;
        }

        if (typeof value === 'string' && value.trim() !== '') {
            var num = Number(value);
            return Number.isInteger(num) && num >= 1 ? num : null;
        }

        return null;
    }

    function isStrictPositiveInteger(value) {
        return typeof value === 'number' && Number.isInteger(value) && value >= 1;
    }

    function isValidWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= MIN_WEEK && num <= MAX_WEEK;
    }

    function isStrictValidWeek(value) {
        return isStrictPositiveInteger(value) && value >= MIN_WEEK && value <= MAX_WEEK;
    }

    /**
     * Normalise an ID to a canonical string.
     * Accepts strings and numbers only. Rejects booleans, objects, arrays.
     * Trims whitespace. Returns null for empty or invalid values.
     * This is the LENIENT normalisation for legacy data.
     */
    function normaliseId(id) {
        if (id === undefined || id === null) return null;

        // Only accept strings and numbers
        if (typeof id !== 'string' && typeof id !== 'number') {
            return null;
        }

        var str = String(id);
        var trimmed = str.trim();
        return trimmed !== '' ? trimmed : null;
    }

    /**
     * Strict ID validation: must already be a non-empty string with no surrounding whitespace.
     * This is the CANONICAL normalisation for strict mode.
     */
    function isStrictId(value) {
        return typeof value === 'string' &&
               value.trim() !== '' &&
               value === value.trim();
    }

    /**
     * Strict ID normalisation: returns the ID only if it is already canonical.
     * Returns null for invalid IDs.
     */
    function normaliseIdStrict(id) {
        return isStrictId(id) ? id : null;
    }

    /**
     * Lenient ID normalisation (alias for normaliseId).
     */
    function normaliseIdLenient(id) {
        return normaliseId(id);
    }

    /**
     * Strict ISO 8601 UTC date validation.
     * Requires exact canonical JavaScript timestamp format.
     * This is intentional: canonical serialisation, not general ISO 8601 parsing.
     */
    function isStrictDate(value) {
        if (typeof value !== 'string') return false;
        var date = new Date(value);
        return !isNaN(date.getTime()) && value === date.toISOString();
    }

    // ============================================================
    // VALIDATION HELPERS - CANONICAL TYPE CHECKS
    // ============================================================

    function isValidMode(mode) {
        return mode && VALID_MODES.indexOf(mode) !== -1;
    }

    function isValidStatus(status) {
        return status && VALID_STATUSES.indexOf(status) !== -1;
    }

    function isValidParticipantType(type) {
        return type && VALID_PARTICIPANT_TYPES.indexOf(type) !== -1;
    }

    function isValidMatchType(type) {
        return type && VALID_MATCH_TYPES.indexOf(type) !== -1;
    }

    function isValidMatchStatus(status) {
        return status && VALID_MATCH_STATUSES.indexOf(status) !== -1;
    }

    function isValidGroupExamResult(result) {
        return result && VALID_GROUP_EXAM_RESULTS.indexOf(result) !== -1;
    }

    // ============================================================
    // CRASH-SAFE PARTICIPANT HELPERS
    // ============================================================

    /**
     * Safely extract a participant's ID from a potentially malformed record.
     * Returns null if the participant or its ID is invalid.
     */
    function safeGetParticipantId(participant, strict) {
        if (!participant || typeof participant !== 'object') return null;
        var id = participant.id;
        if (id === undefined || id === null) return null;
        return strict ? normaliseIdStrict(id) : normaliseIdLenient(id);
    }

    /**
     * Safely get a participant's type from a potentially malformed record.
     * Returns null if the participant or its type is invalid.
     */
    function safeGetParticipantType(participant) {
        if (!participant || typeof participant !== 'object') return null;
        var type = participant.type;
        return isValidParticipantType(type) ? type : null;
    }

    // ============================================================
    // PARTICIPANT REFERENCE VALIDATION
    // ============================================================

    function validateParticipantReferenceStrict(participant) {
        var errors = [];

        if (!participant || typeof participant !== 'object') {
            return { valid: false, errors: ['Participant must be an object.'] };
        }

        if (!isStrictId(participant.id)) {
            errors.push('Participant ID is required and must be a non-empty string with no surrounding whitespace.');
        }

        if (!isValidParticipantType(participant.type)) {
            errors.push('Participant type is required. Must be "character" or "team".');
        }

        // Validate addedAt if present
        if (participant.addedAt !== undefined && participant.addedAt !== null) {
            if (!isStrictDate(participant.addedAt)) {
                errors.push('Participant addedAt must be a valid canonical JavaScript ISO timestamp in UTC.');
            }
        }

        var knownKeys = ['id', 'type', 'addedAt'];
        Object.keys(participant).forEach(function(key) {
            if (knownKeys.indexOf(key) === -1) {
                errors.push('Unknown participant property: "' + key + '"');
            }
        });

        return { valid: errors.length === 0, errors: errors };
    }

    function validateParticipantReferenceLenient(participant) {
        var errors = [];

        if (!participant || typeof participant !== 'object') {
            return { valid: false, errors: ['Participant must be an object.'] };
        }

        var id = normaliseId(participant.id);
        if (id === null) {
            errors.push('Participant ID is required and must be a non-empty string.');
        }

        // Lenient mode permits missing participant.type for legacy data.
        // If present, type must be valid.
        if (participant.type !== undefined && !isValidParticipantType(participant.type)) {
            errors.push('Invalid participant type. Must be "character" or "team".');
        }

        return { valid: errors.length === 0, errors: errors };
    }

    // ============================================================
    // SCHEMA VALIDATORS - DEEP VALIDATION, CRASH-SAFE
    // ============================================================

    var TournamentSchema = {
        // Constants
        SCHEMA_VERSION: SCHEMA_VERSION,
        VALID_MODES: VALID_MODES,
        VALID_STATUSES: VALID_STATUSES,
        VALID_PARTICIPANT_TYPES: VALID_PARTICIPANT_TYPES,
        VALID_MATCH_TYPES: VALID_MATCH_TYPES,
        VALID_MATCH_STATUSES: VALID_MATCH_STATUSES,
        VALID_GROUP_EXAM_RESULTS: VALID_GROUP_EXAM_RESULTS,

        // Type helpers (exposed for other modules)
        isObject: isObject,
        isNonEmptyString: isNonEmptyString,
        parsePositiveInteger: parsePositiveInteger,
        isStrictPositiveInteger: isStrictPositiveInteger,
        isValidWeek: isValidWeek,
        isStrictValidWeek: isStrictValidWeek,
        normaliseId: normaliseId,
        normaliseIdLenient: normaliseIdLenient,
        normaliseIdStrict: normaliseIdStrict,
        isStrictId: isStrictId,
        isStrictDate: isStrictDate,
        isValidMode: isValidMode,
        isValidStatus: isValidStatus,
        isValidParticipantType: isValidParticipantType,
        isValidMatchType: isValidMatchType,
        isValidMatchStatus: isValidMatchStatus,
        isValidGroupExamResult: isValidGroupExamResult,

        // Week range helpers
        getWeekRange: function() {
            return { min: MIN_WEEK, max: MAX_WEEK };
        },

        /**
         * Get the current round from a tournament (derived from rounds.length).
         * This is a QUERY, not a stored value.
         */
        getCurrentRound: function(tournament) {
            if (!tournament || !Array.isArray(tournament.rounds)) return 0;
            return tournament.rounds.length;
        },

        /**
         * Get the canonical participant type for a tournament mode.
         * Returns null for invalid modes.
         */
        getCanonicalParticipantType: function(mode) {
            if (mode === 'teams') return 'team';
            if (mode === 'individuals') return 'character';
            return null;
        },

        /**
         * Get the participant type from a tournament record.
         * CRASH-SAFE: returns null if participant record is malformed.
         * Uses STRICT normalisation for the stored participant ID.
         */
        getParticipantTypeFromRecord: function(tournament, participantId) {
            var id = normaliseIdStrict(participantId);
            if (id === null) return null;
            if (!Array.isArray(tournament.participants)) return null;

            for (var pIdx = 0; pIdx < tournament.participants.length; pIdx++) {
                var p = tournament.participants[pIdx];
                var pid = safeGetParticipantId(p, true);
                if (pid === id) {
                    return p && p.type ? p.type : null;
                }
            }
            return null;
        },

        /**
         * Check if a participant matches the canonical type for the tournament mode.
         */
        isParticipantTypeCanonical: function(tournament, participantId) {
            var canonicalType = this.getCanonicalParticipantType(tournament.mode);
            if (canonicalType === null) return false;
            var recordType = this.getParticipantTypeFromRecord(tournament, participantId);
            return recordType === canonicalType;
        },

        /**
         * Check if a participant is in a tournament.
         * CRASH-SAFE: handles malformed participant records.
         */
        isParticipantInTournament: function(tournament, participantId) {
            var id = normaliseIdStrict(participantId);
            if (id === null) return false;
            if (!Array.isArray(tournament.participants)) return false;

            for (var pIdx = 0; pIdx < tournament.participants.length; pIdx++) {
                var p = tournament.participants[pIdx];
                var pid = safeGetParticipantId(p, true);
                if (pid === id) {
                    return true;
                }
            }
            return false;
        },

        // ============================================================
        // DEEP VALIDATION - CRASH-SAFE
        // ============================================================

        /**
         * Validate a complete tournament object recursively.
         * Returns { valid: boolean, errors: array }
         * NEVER throws on malformed input.
         * 
         * @param {object} tournament - Tournament object to validate
         * @param {object} options - Validation options
         * @param {boolean} options.strict - If true, enforce canonical field requirements
         */
        validateTournament: function(tournament, options) {
            options = options || {};
            var strict = options.strict === true;
            var errors = [];

            if (!tournament || typeof tournament !== 'object') {
                return { valid: false, errors: ['Tournament must be an object.'] };
            }

            // ---- SCHEMA VERSION CHECK ----
            if (tournament._schemaVersion !== undefined && tournament._schemaVersion !== null) {
                var version = parsePositiveInteger(tournament._schemaVersion);
                if (strict) {
                    if (!isStrictPositiveInteger(tournament._schemaVersion)) {
                        errors.push('Schema version must be a positive integer.');
                    } else if (tournament._schemaVersion > SCHEMA_VERSION) {
                        errors.push(
                            'Tournament schema version ' + tournament._schemaVersion +
                            ' is newer than supported version ' + SCHEMA_VERSION
                        );
                    }
                } else {
                    // Lenient: accept numeric strings, reject non-numeric
                    if (version === null) {
                        errors.push('Schema version must be a positive integer.');
                    } else if (version > SCHEMA_VERSION) {
                        errors.push(
                            'Tournament schema version ' + version +
                            ' is newer than supported version ' + SCHEMA_VERSION
                        );
                    }
                }
            }

            // ---- TOP-LEVEL FIELDS ----
            if (strict) {
                if (!isStrictId(tournament.id)) {
                    errors.push('Tournament ID is required and must be a non-empty string with no surrounding whitespace.');
                }

                if (!isNonEmptyString(tournament.name)) {
                    errors.push('Tournament name is required.');
                }

                if (!isValidMode(tournament.mode)) {
                    errors.push('Invalid tournament mode. Must be "teams" or "individuals".');
                }

                if (!isStrictValidWeek(tournament.startWeek)) {
                    errors.push('Start week must be a number between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.');
                }

                if (!isStrictValidWeek(tournament.endWeek)) {
                    errors.push('End week must be a number between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.');
                }

                if (!isStrictPositiveInteger(tournament.totalRounds)) {
                    errors.push('Total rounds must be a positive integer.');
                }

                if (!isValidStatus(tournament.status)) {
                    errors.push('Invalid tournament status.');
                }

                // participants, rounds, eliminations: REQUIRED canonical arrays
                if (!Array.isArray(tournament.participants)) {
                    errors.push('Participants must be an array.');
                }

                if (!Array.isArray(tournament.rounds)) {
                    errors.push('Rounds must be an array.');
                }

                if (!Array.isArray(tournament.eliminations)) {
                    errors.push('Eliminations must be an array.');
                }

                // currentRound: NOT STORED in canonical data
                if (tournament.currentRound !== undefined) {
                    errors.push('Property "currentRound" is derived from rounds.length and must not be stored.');
                }

                // createdAt: optional for legacy compatibility
                if (tournament.createdAt !== undefined && tournament.createdAt !== null) {
                    if (!isStrictDate(tournament.createdAt)) {
                        errors.push('Created at must be a valid canonical JavaScript ISO timestamp in UTC.');
                    }
                }

                // ---- GRADUATING CLASS FIELDS ----
                // graduatingClassId: optional, null or non-empty string
                if (tournament.graduatingClassId !== undefined &&
                    tournament.graduatingClassId !== null) {

                    if (!isStrictId(tournament.graduatingClassId)) {
                        errors.push(
                            'Graduating class ID must be a non-empty string with no surrounding whitespace, or null.'
                        );
                    }
                }

                // classFilterEnabled: optional, boolean
                if (tournament.classFilterEnabled !== undefined &&
                    typeof tournament.classFilterEnabled !== 'boolean') {

                    errors.push('Class filter enabled must be a boolean.');
                }

                // Legacy fields: NOT part of canonical schema
                if (tournament.teams !== undefined) {
                    errors.push('Legacy property "teams" is not part of the canonical schema.');
                }
                if (tournament.winners !== undefined) {
                    errors.push('Legacy property "winners" is not part of the canonical schema.');
                }
                if (tournament.matches !== undefined) {
                    errors.push('Legacy property "matches" is not part of the canonical schema.');
                }

            } else {
                // Lenient mode: accept numeric strings, missing optional fields
                if (!isNonEmptyString(tournament.name)) {
                    errors.push('Tournament name is required.');
                }

                if (!isValidMode(tournament.mode)) {
                    errors.push('Invalid tournament mode. Must be "teams" or "individuals".');
                }

                if (!isValidWeek(tournament.startWeek)) {
                    errors.push('Start week must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.');
                }

                if (!isValidWeek(tournament.endWeek)) {
                    errors.push('End week must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.');
                }

                var totalRounds = parsePositiveInteger(tournament.totalRounds);
                if (totalRounds === null) {
                    errors.push('Total rounds must be a positive integer.');
                }

                if (!isValidStatus(tournament.status)) {
                    errors.push('Invalid tournament status.');
                }

                // createdAt: lenient - accept parseable dates
                if (tournament.createdAt !== undefined && tournament.createdAt !== null) {
                    var date = new Date(tournament.createdAt);
                    if (isNaN(date.getTime())) {
                        errors.push('Created at must be a valid date.');
                    }
                }

                // ---- GRADUATING CLASS FIELDS (LENIENT) ----
                if (tournament.graduatingClassId !== undefined &&
                    tournament.graduatingClassId !== null) {

                    if (normaliseId(tournament.graduatingClassId) === null) {
                        errors.push('Graduating class ID must be a non-empty ID or null.');
                    }
                }

                if (tournament.classFilterEnabled !== undefined &&
                    typeof tournament.classFilterEnabled !== 'boolean') {

                    errors.push('Class filter enabled must be a boolean.');
                }

                // Validate legacy fields if present
                if (tournament.teams !== undefined) {
                    if (!Array.isArray(tournament.teams)) {
                        errors.push('Teams must be an array.');
                    } else {
                        tournament.teams.forEach(function(team, index) {
                            if (typeof team !== 'string') {
                                errors.push('Team ' + (index + 1) + ' must be a string ID.');
                            }
                        });
                    }
                }

                if (tournament.winners !== undefined) {
                    if (!Array.isArray(tournament.winners)) {
                        errors.push('Winners must be an array.');
                    } else {
                        tournament.winners.forEach(function(winner, index) {
                            if (!winner || typeof winner !== 'object') {
                                errors.push('Winner ' + (index + 1) + ' must be an object.');
                                return;
                            }
                            var winnerId = normaliseId(winner.id);
                            if (winnerId === null) {
                                errors.push('Winner ' + (index + 1) + ' has invalid ID.');
                            }
                            if (winner.type !== undefined && !isValidParticipantType(winner.type)) {
                                errors.push('Winner ' + (index + 1) + ' has invalid type.');
                            }
                        });
                    }
                }
            }

            // Week range validation (works for both modes)
            var start = parsePositiveInteger(tournament.startWeek);
            var end = parsePositiveInteger(tournament.endWeek);
            if (start !== null && end !== null && start > end) {
                errors.push('Start week must be before or equal to end week.');
            }

            // ---- INVARIANT: rounds.length <= totalRounds ----
            var totalRoundsNum = parsePositiveInteger(tournament.totalRounds);
            if (totalRoundsNum !== null && Array.isArray(tournament.rounds)) {
                if (tournament.rounds.length > totalRoundsNum) {
                    errors.push(
                        'Tournament contains ' + tournament.rounds.length +
                        ' rounds but totalRounds is only ' + totalRoundsNum + '.'
                    );
                }
            }

            // ---- PARTICIPANTS (CRASH-SAFE) ----
            var canonicalType = this.getCanonicalParticipantType(tournament.mode);

            if (Array.isArray(tournament.participants)) {
                var seenParticipantIds = Object.create(null);

                tournament.participants.forEach(function(p, index) {
                    // CRASH-SAFE: validate reference first
                    var result = strict
                        ? validateParticipantReferenceStrict(p)
                        : validateParticipantReferenceLenient(p);
                    if (!result.valid) {
                        result.errors.forEach(function(err) {
                            errors.push('Participant ' + (index + 1) + ': ' + err);
                        });
                    }

                    // CRASH-SAFE: extract ID only after validation
                    var pid = safeGetParticipantId(p, strict);
                    if (pid !== null) {
                        if (seenParticipantIds[pid]) {
                            errors.push('Duplicate participant: "' + pid + '"');
                        }
                        seenParticipantIds[pid] = true;

                        // Participant type must match canonical type (if type is present)
                        var pType = safeGetParticipantType(p);
                        if (pType !== null && canonicalType !== null && pType !== canonicalType) {
                            errors.push('Participant "' + pid + '" has type "' + pType +
                                '" but tournament mode "' + tournament.mode + '" requires "' + canonicalType + '".');
                        }
                    }
                }, this);
            }

            // ---- ROUNDS ----
            if (Array.isArray(tournament.rounds)) {
                tournament.rounds.forEach(function(round, index) {
                    var result = this.validateRound(round, tournament, strict);
                    if (!result.valid) {
                        result.errors.forEach(function(err) {
                            errors.push('Round ' + (index + 1) + ': ' + err);
                        });
                    }

                    // Round numbering invariant: roundNumber must equal index + 1
                    if (round && round.roundNumber !== undefined) {
                        var expected = index + 1;
                        if (round.roundNumber !== expected) {
                            errors.push('Round ' + (index + 1) + ' has incorrect roundNumber. Expected ' + expected + ', got ' + round.roundNumber);
                        }
                    }
                }, this);
            }

            // ---- ELIMINATIONS ----
            if (Array.isArray(tournament.eliminations)) {
                var seenEliminations = Object.create(null);

                tournament.eliminations.forEach(function(e, index) {
                    var result = this.validateElimination(e, tournament, strict);
                    if (!result.valid) {
                        result.errors.forEach(function(err) {
                            errors.push('Elimination ' + (index + 1) + ': ' + err);
                        });
                    }

                    // Duplicate check (only if participantId is present)
                    if (e && e.participantId !== undefined && e.participantId !== null) {
                        var eid = strict
                            ? normaliseIdStrict(e.participantId)
                            : normaliseIdLenient(e.participantId);
                        if (eid !== null) {
                            if (seenEliminations[eid]) {
                                errors.push('Duplicate elimination for participant: "' + eid + '"');
                            }
                            seenEliminations[eid] = true;
                        }
                    }
                }, this);
            }

            // ---- WINNER ----
            if (tournament.winner !== undefined && tournament.winner !== null) {
                var winnerResult = strict
                    ? validateParticipantReferenceStrict(tournament.winner)
                    : validateParticipantReferenceLenient(tournament.winner);
                if (!winnerResult.valid) {
                    winnerResult.errors.forEach(function(err) {
                        errors.push('Winner: ' + err);
                    });
                }

                // Winner must be in participants with matching type
                if (tournament.winner && tournament.winner.id !== undefined && tournament.winner.id !== null &&
                    Array.isArray(tournament.participants)) {
                    var winnerId = strict
                        ? normaliseIdStrict(tournament.winner.id)
                        : normaliseIdLenient(tournament.winner.id);
                    if (winnerId !== null) {
                        var winnerParticipant = null;
                        // CRASH-SAFE: find participant safely
                        for (var wp = 0; wp < tournament.participants.length; wp++) {
                            var p = tournament.participants[wp];
                            var pid = safeGetParticipantId(p, strict);
                            if (pid === winnerId) {
                                winnerParticipant = p;
                                break;
                            }
                        }
                        if (!winnerParticipant) {
                            errors.push('Winner must be a tournament participant.');
                        } else {
                            // Only compare type if winner has a type (lenient mode may not)
                            if (tournament.winner.type !== undefined &&
                                winnerParticipant.type !== tournament.winner.type) {
                                errors.push('Winner participant type does not match tournament participant type.');
                            }
                            // Winner type must match canonical type (if winner has type)
                            if (canonicalType !== null && tournament.winner.type !== undefined &&
                                tournament.winner.type !== canonicalType) {
                                errors.push('Winner type "' + tournament.winner.type +
                                    '" does not match tournament mode "' + tournament.mode + '" (requires "' + canonicalType + '").');
                            }
                        }
                    }
                }

                // Winner cannot be eliminated
                if (tournament.winner && tournament.winner.id !== undefined && tournament.winner.id !== null) {
                    var winnerId = strict
                        ? normaliseIdStrict(tournament.winner.id)
                        : normaliseIdLenient(tournament.winner.id);
                    if (winnerId !== null && this.isParticipantEliminated(tournament, winnerId)) {
                        errors.push('Winner cannot be an eliminated participant.');
                    }
                }
            }

            // ---- UNKNOWN PROPERTIES (strict mode only) ----
            if (strict) {
                var strictKnownKeys = [
                    'id', 'name', 'mode', 'startWeek', 'endWeek', 'totalRounds',
                    'status', 'participants', 'rounds', 'eliminations', 'winner',
                    'createdAt', '_schemaVersion',
                    'graduatingClassId', 'classFilterEnabled'
                ];
                Object.keys(tournament).forEach(function(key) {
                    if (strictKnownKeys.indexOf(key) === -1) {
                        errors.push('Unknown tournament property: "' + key + '"');
                    }
                });
            }

            return { valid: errors.length === 0, errors: errors };
        },

        /**
         * Validate a round object deeply.
         * Returns { valid: boolean, errors: array }
         * CRASH-SAFE: never throws on malformed input.
         */
        validateRound: function(round, tournament, strict) {
            var errors = [];

            if (!round || typeof round !== 'object') {
                return { valid: false, errors: ['Round must be an object.'] };
            }

            // Round number is validated at the tournament level for ordering
            if (strict) {
                if (!isStrictPositiveInteger(round.roundNumber)) {
                    errors.push('Round number must be a positive integer.');
                }

                if (!isValidMatchStatus(round.status)) {
                    errors.push('Invalid round status. Must be "pending", "in_progress", or "completed".');
                }

                if (!isStrictPositiveInteger(round.matchSize) || round.matchSize < 2) {
                    errors.push('Match size must be a positive integer >= 2.');
                }

                if (!isValidMatchType(round.matchType)) {
                    errors.push('Invalid match type. Must be "standard" or "group_exam".');
                }

                if (!Array.isArray(round.matches)) {
                    errors.push('Matches array is required.');
                }

                var knownKeys = ['roundNumber', 'status', 'matchSize', 'matchType', 'matches'];
                Object.keys(round).forEach(function(key) {
                    if (knownKeys.indexOf(key) === -1) {
                        errors.push('Unknown round property: "' + key + '"');
                    }
                });

            } else {
                if (round.roundNumber !== undefined) {
                    var roundNumber = parsePositiveInteger(round.roundNumber);
                    if (roundNumber === null) {
                        errors.push('Round number must be a positive integer.');
                    }
                }

                if (round.status !== undefined && !isValidMatchStatus(round.status)) {
                    errors.push('Invalid round status. Must be "pending", "in_progress", or "completed".');
                }

                if (round.matchSize !== undefined) {
                    var matchSize = parsePositiveInteger(round.matchSize);
                    if (matchSize === null) {
                        errors.push('Match size must be a positive integer.');
                    } else if (matchSize < 2) {
                        errors.push('Match size must be at least 2.');
                    }
                }

                if (round.matchType !== undefined && !isValidMatchType(round.matchType)) {
                    errors.push('Invalid match type. Must be "standard" or "group_exam".');
                }
            }

            // ---- MATCHES (CRASH-SAFE) ----
            if (round.matches !== undefined) {
                if (!Array.isArray(round.matches)) {
                    errors.push('Matches must be an array.');
                } else {
                    round.matches.forEach(function(match, index) {
                        var result = this.validateMatch(match, tournament, strict, round);
                        if (!result.valid) {
                            result.errors.forEach(function(err) {
                                errors.push('Match ' + (index + 1) + ': ' + err);
                            });
                        }
                    }, this);
                }
            }

            // ---- COMPLETED ROUND INVARIANT ----
            if (round.status === 'completed' && Array.isArray(round.matches)) {
                round.matches.forEach(function(match, index) {
                    if (match && match.status !== 'completed') {
                        errors.push(
                            'Completed round contains non-completed match ' + (index + 1) + '.'
                        );
                    }
                });
            }

            return { valid: errors.length === 0, errors: errors };
        },

        /**
         * Validate a match object deeply.
         * Returns { valid: boolean, errors: array }
         * CRASH-SAFE: never throws on malformed input.
         * 
         * @param {object} match - Match object to validate
         * @param {object} tournament - Parent tournament context
         * @param {boolean} strict - Strict validation mode
         * @param {object} round - Parent round context (for matchSize enforcement)
         */
        validateMatch: function(match, tournament, strict, round) {
            var errors = [];

            if (!match || typeof match !== 'object') {
                return { valid: false, errors: ['Match must be an object.'] };
            }

            // ---- TYPE ----
            if (strict) {
                if (!isValidMatchType(match.type)) {
                    errors.push('Match type is required. Must be "standard" or "group_exam".');
                }

                if (!isValidMatchStatus(match.status)) {
                    errors.push('Match status is required. Must be "pending", "in_progress", or "completed".');
                }

                var knownKeys = [
                    'participants', 'type', 'status', 'winner', 'loser',
                    'advancing', 'results'
                ];
                Object.keys(match).forEach(function(key) {
                    if (knownKeys.indexOf(key) === -1) {
                        errors.push('Unknown match property: "' + key + '"');
                    }
                });

            } else {
                if (match.type !== undefined && !isValidMatchType(match.type)) {
                    errors.push('Invalid match type. Must be "standard" or "group_exam".');
                }

                if (match.status !== undefined && !isValidMatchStatus(match.status)) {
                    errors.push('Invalid match status. Must be "pending", "in_progress", or "completed".');
                }
            }

            // ---- ENFORCE ROUND MATCHTYPE ----
            if (round && round.matchType !== undefined && match.type !== undefined) {
                if (match.type !== round.matchType) {
                    errors.push(
                        'Match type "' + match.type +
                        '" does not match round type "' + round.matchType + '".'
                    );
                }
            }

            // ---- GROUP EXAM: WINNER AND LOSER MUST BE NULL ----
            // Group exam matches MUST contain winner: null and loser: null
            if (match.type === 'group_exam') {
                if (match.winner !== null) {
                    errors.push('Group exam winner must be null.');
                }
                if (match.loser !== null) {
                    errors.push('Group exam loser must be null.');
                }
            }

            // ---- PARTICIPANTS (CRASH-SAFE) ----
            var participantIds = [];
            var hasInvalidParticipant = false;

            if (!Array.isArray(match.participants)) {
                errors.push('Match participants must be an array.');
            } else if (match.participants.length < 2) {
                errors.push('Match must have at least 2 participants.');
            } else {
                // Enforce round.matchSize
                if (round && round.matchSize !== undefined) {
                    var expectedSize = round.matchSize;
                    if (match.participants.length !== expectedSize) {
                        errors.push('Match participants (' + match.participants.length +
                            ') do not match round size (' + expectedSize + ').');
                    }
                }

                var seen = Object.create(null);
                match.participants.forEach(function(id) {
                    var normalised = strict
                        ? normaliseIdStrict(id)
                        : normaliseIdLenient(id);
                    if (normalised === null) {
                        errors.push('Invalid participant ID in match.');
                        hasInvalidParticipant = true;
                        return;
                    }
                    participantIds.push(normalised);
                    if (seen[normalised]) {
                        errors.push('Duplicate participant in match: "' + normalised + '"');
                    }
                    seen[normalised] = true;

                    // CRASH-SAFE: verify participant exists in tournament
                    if (tournament && Array.isArray(tournament.participants)) {
                        var exists = false;
                        for (var pIdx = 0; pIdx < tournament.participants.length; pIdx++) {
                            var p = tournament.participants[pIdx];
                            var pid = safeGetParticipantId(p, strict);
                            if (pid === normalised) {
                                exists = true;
                                break;
                            }
                        }
                        if (!exists) {
                            errors.push('Participant "' + normalised + '" not found in tournament.');
                        }
                    }
                });
            }

            if (hasInvalidParticipant) {
                return { valid: false, errors: errors };
            }

            // ---- WINNER ----
            if (match.winner !== undefined && match.winner !== null) {
                if (match.type === 'group_exam') {
                    // Already handled
                } else {
                    var winnerId = strict
                        ? normaliseIdStrict(match.winner)
                        : normaliseIdLenient(match.winner);
                    if (winnerId === null) {
                        errors.push('Invalid winner ID.');
                    } else if (participantIds.indexOf(winnerId) === -1) {
                        errors.push('Winner must be a participant in the match.');
                    }
                }
            }

            // ---- LOSER (standard matches only) ----
            if (match.loser !== undefined && match.loser !== null) {
                if (match.type === 'group_exam') {
                    errors.push('Group exam matches do not have a loser field.');
                } else {
                    var loserId = strict
                        ? normaliseIdStrict(match.loser)
                        : normaliseIdLenient(match.loser);
                    if (loserId === null) {
                        errors.push('Invalid loser ID.');
                    } else if (participantIds.indexOf(loserId) === -1) {
                        errors.push('Loser must be a participant in the match.');
                    } else {
                        if (match.winner) {
                            var winnerNormalised = strict
                                ? normaliseIdStrict(match.winner)
                                : normaliseIdLenient(match.winner);
                            if (loserId === winnerNormalised) {
                                errors.push('Loser cannot be the same as winner.');
                            }
                        }
                    }
                }
            }

            // ---- ADVANCING ----
            if (match.advancing !== undefined) {
                if (!Array.isArray(match.advancing)) {
                    errors.push('Advancing must be an array.');
                } else {
                    var advancingSeen = Object.create(null);
                    match.advancing.forEach(function(id) {
                        var normalised = strict
                            ? normaliseIdStrict(id)
                            : normaliseIdLenient(id);
                        if (normalised === null) {
                            errors.push('Invalid advancing participant ID.');
                        } else if (participantIds.indexOf(normalised) === -1) {
                            errors.push('Advancing participant must be in the match.');
                        } else if (advancingSeen[normalised]) {
                            errors.push('Duplicate advancing participant: "' + normalised + '"');
                        }
                        advancingSeen[normalised] = true;
                    });
                }
            }

            // ---- RESULTS (group_exam only) ----
            if (match.results !== undefined) {
                if (match.type !== 'group_exam') {
                    errors.push('Results are only valid for group_exam matches.');
                } else if (!isObject(match.results)) {
                    errors.push('Results must be an object.');
                } else {
                    var resultKeys = Object.keys(match.results);
                    var resultSeen = Object.create(null);
                    resultKeys.forEach(function(key) {
                        var id = strict
                            ? normaliseIdStrict(key)
                            : normaliseIdLenient(key);
                        var value = match.results[key];
                        if (id === null) {
                            errors.push('Invalid result participant ID: "' + key + '"');
                            return;
                        }
                        if (participantIds.indexOf(id) === -1) {
                            errors.push('Result participant "' + key + '" is not in the match.');
                        }
                        if (!isValidGroupExamResult(value)) {
                            errors.push('Invalid result for participant "' + key + '". Must be "pass" or "fail".');
                        }
                        if (resultSeen[id]) {
                            errors.push('Duplicate result participant: "' + id + '"');
                        }
                        resultSeen[id] = true;
                    });
                }
            }

            // ---- COMPLETED MATCH VALIDATION ----
            if (match.status === 'completed') {
                if (match.type === 'standard' && !match.winner) {
                    errors.push('Completed standard match must have a winner.');
                }
                if (match.type === 'group_exam') {
                    if (!match.results || typeof match.results !== 'object') {
                        errors.push('Completed group exam must have results.');
                    } else {
                        participantIds.forEach(function(id) {
                            if (!match.results[id] || !isValidGroupExamResult(match.results[id])) {
                                errors.push('Completed group exam must have valid results for all participants.');
                            }
                        });
                    }
                }
            }

            return { valid: errors.length === 0, errors: errors };
        },

        /**
         * Validate an elimination record.
         * Returns { valid: boolean, errors: array }
         * CRASH-SAFE: never throws on malformed input.
         */
        validateElimination: function(elimination, tournament, strict) {
            var errors = [];

            if (!elimination || typeof elimination !== 'object') {
                return { valid: false, errors: ['Elimination must be an object.'] };
            }

            var participantId = strict
                ? normaliseIdStrict(elimination.participantId)
                : normaliseIdLenient(elimination.participantId);
            if (participantId === null) {
                errors.push('Elimination participant ID is required and must be a non-empty string.');
            }

            if (!isValidParticipantType(elimination.participantType)) {
                errors.push('Invalid participant type. Must be "character" or "team".');
            }

            if (strict) {
                if (!isStrictValidWeek(elimination.week)) {
                    errors.push('Elimination week must be a number between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.');
                }

                var knownKeys = ['participantId', 'participantType', 'week', 'reason'];
                Object.keys(elimination).forEach(function(key) {
                    if (knownKeys.indexOf(key) === -1) {
                        errors.push('Unknown elimination property: "' + key + '"');
                    }
                });

            } else {
                if (!isValidWeek(elimination.week)) {
                    errors.push('Elimination week must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.');
                }
            }

            if (elimination.reason !== undefined && typeof elimination.reason !== 'string') {
                errors.push('Elimination reason must be a string.');
            }

            // CRASH-SAFE: verify participant exists in tournament with matching type
            if (tournament && participantId !== null && Array.isArray(tournament.participants)) {
                var participant = null;
                for (var pIdx = 0; pIdx < tournament.participants.length; pIdx++) {
                    var p = tournament.participants[pIdx];
                    var pid = safeGetParticipantId(p, strict);
                    if (pid === participantId) {
                        participant = p;
                        break;
                    }
                }
                if (!participant) {
                    errors.push('Eliminated participant "' + participantId + '" not found in tournament.');
                } else if (participant.type !== elimination.participantType) {
                    errors.push('Elimination participant type "' + elimination.participantType +
                        '" does not match tournament participant type "' + participant.type + '".');
                }
            }

            // Verify elimination week is within tournament range
            if (tournament && tournament.startWeek !== undefined && tournament.endWeek !== undefined) {
                var startWeek = parsePositiveInteger(tournament.startWeek);
                var endWeek = parsePositiveInteger(tournament.endWeek);
                var elimWeek = parsePositiveInteger(elimination.week);
                if (startWeek !== null && endWeek !== null && elimWeek !== null) {
                    if (elimWeek < startWeek || elimWeek > endWeek) {
                        errors.push('Elimination week ' + elimWeek + ' is outside tournament week range ' +
                            startWeek + '-' + endWeek + '.');
                    }
                }
            }

            return { valid: errors.length === 0, errors: errors };
        },

        // ============================================================
        // COMPLETENESS CHECKS
        // ============================================================

        /**
         * Check if a tournament is complete.
         * 
         * NOTE: This is a QUERY-LAYER projection.
         * It does NOT mutate or validate - it observes.
         * 
         * status: 'completed' is AUTHORITATIVE.
         * For non-completed statuses, checks structural completion.
         * 
         * This means the function answers: "Should the application consider
         * this tournament complete?" not "Is this object valid?"
         */
        isTournamentComplete: function(tournament) {
            if (!tournament || typeof tournament !== 'object') return false;

            // status is authoritative
            if (tournament.status === 'completed') return true;

            // For active/draft tournaments, check structural completion
            if (!Array.isArray(tournament.rounds) || tournament.rounds.length === 0) {
                return false;
            }

            var allRoundsComplete = tournament.rounds.every(function(r) {
                return r && r.status === 'completed';
            });

            return allRoundsComplete && !!tournament.winner;
        },

        isRoundComplete: function(round) {
            if (!round || typeof round !== 'object') return false;
            return round.status === 'completed';
        },

        isMatchComplete: function(match) {
            if (!match || typeof match !== 'object') return false;
            return match.status === 'completed';
        },

        // ============================================================
        // PARTICIPANT HELPERS - CRASH-SAFE
        // ============================================================

        isParticipantEliminated: function(tournament, participantId) {
            if (!tournament || !Array.isArray(tournament.eliminations)) return false;
            var id = normaliseIdStrict(participantId);
            if (id === null) return false;

            for (var eIdx = 0; eIdx < tournament.eliminations.length; eIdx++) {
                var e = tournament.eliminations[eIdx];
                if (e && normaliseId(e.participantId) === id) {
                    return true;
                }
            }
            return false;
        },

        getParticipantType: function(tournament, participantId) {
            return this.getParticipantTypeFromRecord(tournament, participantId);
        },

        /**
         * Get participants of a tournament.
         * Returns the participants as-is, without modification.
         * Does NOT repair malformed data.
         */
        getParticipants: function(tournament) {
            if (!Array.isArray(tournament.participants)) return [];
            return tournament.participants.slice();
        },

        getActiveParticipants: function(tournament) {
            var participants = this.getParticipants(tournament);
            return participants.filter(function(p) {
                return !this.isParticipantEliminated(tournament, p.id);
            }, this);
        },

        // ============================================================
        // REPORTING
        // ============================================================

        getValidationReport: function(tournament) {
            var report = {
                valid: true,
                errors: [],
                warnings: [],
                details: {
                    tournament: {
                        id: tournament && tournament.id ? String(tournament.id) : null,
                        name: tournament && tournament.name ? String(tournament.name) : null,
                        mode: tournament && tournament.mode ? String(tournament.mode) : null,
                        status: tournament && tournament.status ? String(tournament.status) : null,
                        startWeek: tournament && tournament.startWeek !== undefined ? Number(tournament.startWeek) : null,
                        endWeek: tournament && tournament.endWeek !== undefined ? Number(tournament.endWeek) : null,
                        totalRounds: tournament && tournament.totalRounds !== undefined ? Number(tournament.totalRounds) : null,
                        graduatingClassId: tournament && tournament.graduatingClassId !== undefined ? String(tournament.graduatingClassId) : null,
                        classFilterEnabled: tournament && tournament.classFilterEnabled !== undefined ? Boolean(tournament.classFilterEnabled) : null
                    },
                    participants: [],
                    rounds: [],
                    eliminations: [],
                    winner: null
                }
            };

            // Populate tournament details
            if (tournament && typeof tournament === 'object') {
                var details = report.details.tournament;
                if (tournament.id !== undefined) details.id = String(tournament.id);
                if (tournament.name !== undefined) details.name = String(tournament.name);
                if (tournament.mode !== undefined) details.mode = String(tournament.mode);
                if (tournament.status !== undefined) details.status = String(tournament.status);
                if (tournament.startWeek !== undefined) details.startWeek = Number(tournament.startWeek);
                if (tournament.endWeek !== undefined) details.endWeek = Number(tournament.endWeek);
                if (tournament.totalRounds !== undefined) details.totalRounds = Number(tournament.totalRounds);
                if (tournament.graduatingClassId !== undefined) details.graduatingClassId = String(tournament.graduatingClassId);
                if (tournament.classFilterEnabled !== undefined) details.classFilterEnabled = Boolean(tournament.classFilterEnabled);

                // Count participants, rounds, eliminations
                if (Array.isArray(tournament.participants)) {
                    report.details.participants = tournament.participants.map(function(p) {
                        if (!p || typeof p !== 'object') {
                            return { id: null, type: null };
                        }
                        return {
                            id: p.id ? String(p.id) : null,
                            type: p.type ? String(p.type) : null
                        };
                    });
                }

                if (Array.isArray(tournament.rounds)) {
                    report.details.rounds = tournament.rounds.map(function(r) {
                        if (!r || typeof r !== 'object') {
                            return { roundNumber: null, status: null, matchCount: 0 };
                        }
                        return {
                            roundNumber: r.roundNumber !== undefined ? Number(r.roundNumber) : null,
                            status: r.status ? String(r.status) : null,
                            matchCount: Array.isArray(r.matches) ? r.matches.length : 0
                        };
                    });
                }

                if (Array.isArray(tournament.eliminations)) {
                    report.details.eliminations = tournament.eliminations.map(function(e) {
                        if (!e || typeof e !== 'object') {
                            return { participantId: null, participantType: null, week: null };
                        }
                        return {
                            participantId: e.participantId ? String(e.participantId) : null,
                            participantType: e.participantType ? String(e.participantType) : null,
                            week: e.week !== undefined ? Number(e.week) : null
                        };
                    });
                }

                if (tournament.winner !== undefined && tournament.winner !== null && typeof tournament.winner === 'object') {
                    report.details.winner = {
                        id: tournament.winner.id ? String(tournament.winner.id) : null,
                        type: tournament.winner.type ? String(tournament.winner.type) : null
                    };
                }
            }

            var validation = this.validateTournament(tournament, { strict: false });
            if (!validation.valid) {
                report.valid = false;
                validation.errors.forEach(function(err) {
                    report.errors.push(err);
                });
            }

            // Additional warnings
            if (this.isTournamentComplete(tournament)) {
                report.warnings.push('Tournament is marked as complete.');
            }

            return report;
        }
    };

    // ============================================================
    // EXPOSE - No monkey-patching
    // ============================================================

    window.TournamentsSchema = TournamentSchema;

})();
