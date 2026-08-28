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
 * 
 * CONSTITUTIONAL DECISIONS:
 *   - currentRound is DERIVED from rounds.length and is NOT stored in canonical data
 *   - status: 'completed' is AUTHORITATIVE (trust the declared status)
 *   - Elimination is final: a winner cannot be eliminated
 *   - Legacy fields (teams, winners, flat matches) are NOT part of canonical schema
 *   - Canonical IDs are strings (non-empty)
 *   - Canonical numbers are actual numbers (not strings)
 *   - Canonical createdAt is ISO 8601 string
 *   - participants, rounds, eliminations are REQUIRED canonical arrays (may be empty)
 * 
 * STRICTNESS SEMANTICS:
 *   - strict: false → "Is this structurally understandable tournament data?"
 *     (allows legacy unknown properties and numeric strings, validates known structure)
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
 */

(function() {
    'use strict';

    if (window.__tournamentsSchemaLoaded) return;
    window.__tournamentsSchemaLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_MODES = ['teams', 'individuals'];
    var VALID_STATUSES = ['draft', 'active', 'completed'];
    var VALID_PARTICIPANT_TYPES = ['character', 'team'];
    var VALID_MATCH_TYPES = ['standard', 'group_exam'];
    var VALID_MATCH_STATUSES = ['pending', 'in_progress', 'completed'];
    var VALID_GROUP_EXAM_RESULTS = ['pass', 'fail'];

    // ============================================================
    // TYPE HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function parsePositiveInteger(value) {
        var num = Number(value);
        return Number.isInteger(num) && num >= 1 ? num : null;
    }

    function isStrictPositiveInteger(value) {
        return typeof value === 'number' && Number.isInteger(value) && value >= 1;
    }

    function isValidWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 52;
    }

    function isStrictValidWeek(value) {
        return isStrictPositiveInteger(value) && value >= 1 && value <= 52;
    }

    function normaliseId(id) {
        if (id === undefined || id === null) return null;
        if (typeof id === 'object') return null;
        var normalised = String(id).trim();
        return normalised !== '' ? normalised : null;
    }

    function isStrictId(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isStrictDate(value) {
        if (typeof value !== 'string') return false;
        var date = new Date(value);
        return !isNaN(date.getTime()) && value === date.toISOString();
    }

    /**
     * Normalise an ID for lenient mode, or validate for strict mode.
     * Returns the normalised ID on success, null on failure.
     */
    function normaliseIdLenient(id) {
        return normaliseId(id);
    }

    function normaliseIdStrict(id) {
        return isStrictId(id) ? id : null;
    }

    // ============================================================
    // INTERNAL VALIDATION HELPERS
    // ============================================================

    function validateParticipantReferenceStrict(participant) {
        var errors = [];

        if (!participant || typeof participant !== 'object') {
            return { valid: false, errors: ['Participant must be an object.'] };
        }

        if (!isStrictId(participant.id)) {
            errors.push('Participant ID is required and must be a non-empty string.');
        }

        if (!isValidParticipantType(participant.type)) {
            errors.push('Participant type is required. Must be "character" or "team".');
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

        if (participant.type !== undefined && !isValidParticipantType(participant.type)) {
            errors.push('Invalid participant type. Must be "character" or "team".');
        }

        return { valid: errors.length === 0, errors: errors };
    }

    // ============================================================
    // SCHEMA VALIDATORS - DEEP VALIDATION
    // ============================================================

    var TournamentSchema = {
        // Constants
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
        isStrictId: isStrictId,
        isStrictDate: isStrictDate,
        isValidMode: function(mode) {
            return mode && VALID_MODES.indexOf(mode) !== -1;
        },
        isValidStatus: function(status) {
            return status && VALID_STATUSES.indexOf(status) !== -1;
        },
        isValidParticipantType: function(type) {
            return type && VALID_PARTICIPANT_TYPES.indexOf(type) !== -1;
        },
        isValidMatchType: function(type) {
            return type && VALID_MATCH_TYPES.indexOf(type) !== -1;
        },
        isValidMatchStatus: function(status) {
            return status && VALID_MATCH_STATUSES.indexOf(status) !== -1;
        },
        isValidGroupExamResult: function(result) {
            return result && VALID_GROUP_EXAM_RESULTS.indexOf(result) !== -1;
        },

        /**
         * Get the current round from a tournament (derived from rounds.length).
         * This is a QUERY, not a stored value.
         */
        getCurrentRound: function(tournament) {
            if (!tournament || !Array.isArray(tournament.rounds)) return 0;
            return tournament.rounds.length;
        },

        // ============================================================
        // DEEP VALIDATION
        // ============================================================

        /**
         * Validate a complete tournament object recursively.
         * Returns { valid: boolean, errors: array }
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

            // ---- TOP-LEVEL FIELDS ----
            if (strict) {
                if (!isStrictId(tournament.id)) {
                    errors.push('Tournament ID is required and must be a non-empty string.');
                }

                if (!isNonEmptyString(tournament.name)) {
                    errors.push('Tournament name is required.');
                }

                if (!this.isValidMode(tournament.mode)) {
                    errors.push('Invalid tournament mode. Must be "teams" or "individuals".');
                }

                if (!isStrictValidWeek(tournament.startWeek)) {
                    errors.push('Start week must be a number between 1 and 52.');
                }

                if (!isStrictValidWeek(tournament.endWeek)) {
                    errors.push('End week must be a number between 1 and 52.');
                }

                if (!isStrictPositiveInteger(tournament.totalRounds)) {
                    errors.push('Total rounds must be a positive integer.');
                }

                if (!this.isValidStatus(tournament.status)) {
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

                // createdAt: ISO 8601 string
                if (tournament.createdAt !== undefined && tournament.createdAt !== null) {
                    if (!isStrictDate(tournament.createdAt)) {
                        errors.push('Created at must be a valid ISO 8601 date string.');
                    }
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

                if (!this.isValidMode(tournament.mode)) {
                    errors.push('Invalid tournament mode. Must be "teams" or "individuals".');
                }

                if (!isValidWeek(tournament.startWeek)) {
                    errors.push('Start week must be between 1 and 52.');
                }

                if (!isValidWeek(tournament.endWeek)) {
                    errors.push('End week must be between 1 and 52.');
                }

                var totalRounds = parsePositiveInteger(tournament.totalRounds);
                if (totalRounds === null) {
                    errors.push('Total rounds must be a positive integer.');
                }

                if (!this.isValidStatus(tournament.status)) {
                    errors.push('Invalid tournament status.');
                }

                // createdAt: lenient - accept parseable dates
                if (tournament.createdAt !== undefined && tournament.createdAt !== null) {
                    var date = new Date(tournament.createdAt);
                    if (isNaN(date.getTime())) {
                        errors.push('Created at must be a valid date.');
                    }
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

                if (tournament.matches !== undefined) {
                    if (!Array.isArray(tournament.matches)) {
                        errors.push('Matches must be an array.');
                    } else {
                        tournament.matches.forEach(function(match, index) {
                            var result = this.validateMatch(match, tournament, strict);
                            if (!result.valid) {
                                result.errors.forEach(function(err) {
                                    errors.push('Match ' + (index + 1) + ': ' + err);
                                });
                            }
                        }, this);
                    }
                }
            }

            // Week range validation (works for both modes)
            var start = parsePositiveInteger(tournament.startWeek);
            var end = parsePositiveInteger(tournament.endWeek);
            if (start !== null && end !== null && start > end) {
                errors.push('Start week must be before or equal to end week.');
            }

            // ---- PARTICIPANTS ----
            if (Array.isArray(tournament.participants)) {
                var seenParticipantIds = Object.create(null);

                tournament.participants.forEach(function(p, index) {
                    var result = strict
                        ? validateParticipantReferenceStrict(p)
                        : validateParticipantReferenceLenient(p);
                    if (!result.valid) {
                        result.errors.forEach(function(err) {
                            errors.push('Participant ' + (index + 1) + ': ' + err);
                        });
                    }

                    // Duplicate check (only if ID is present)
                    if (p && p.id !== undefined && p.id !== null) {
                        var pid = strict
                            ? normaliseIdStrict(p.id)
                            : normaliseIdLenient(p.id);
                        if (pid !== null) {
                            if (seenParticipantIds[pid]) {
                                errors.push('Duplicate participant: "' + pid + '"');
                            }
                            seenParticipantIds[pid] = true;
                        }
                    }
                }, this);

                // Mode compatibility
                if (tournament.mode && Array.isArray(tournament.participants)) {
                    var incompatible = tournament.participants.some(function(p) {
                        return (tournament.mode === 'teams' && p.type !== 'team') ||
                               (tournament.mode === 'individuals' && p.type !== 'character');
                    });
                    if (incompatible) {
                        errors.push('Participant type incompatible with tournament mode.');
                    }
                }
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
                if (tournament.winner && tournament.winner.id && Array.isArray(tournament.participants)) {
                    var winnerId = strict
                        ? normaliseIdStrict(tournament.winner.id)
                        : normaliseIdLenient(tournament.winner.id);
                    if (winnerId !== null) {
                        var winnerParticipant = tournament.participants.find(function(p) {
                            var pid = strict
                                ? normaliseIdStrict(p.id)
                                : normaliseIdLenient(p.id);
                            return pid === winnerId;
                        });
                        if (!winnerParticipant) {
                            errors.push('Winner must be a tournament participant.');
                        } else {
                            // Only compare type if winner has a type (lenient mode may not)
                            if (tournament.winner.type !== undefined &&
                                winnerParticipant.type !== tournament.winner.type) {
                                errors.push('Winner participant type does not match tournament participant type.');
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
                    'status', 'participants', 'rounds', 'eliminations', 'winner', 'createdAt'
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

                if (!this.isValidMatchStatus(round.status)) {
                    errors.push('Invalid round status. Must be "pending", "in_progress", or "completed".');
                }

                if (!isStrictPositiveInteger(round.matchSize) || round.matchSize < 2) {
                    errors.push('Match size must be a positive integer >= 2.');
                }

                if (!this.isValidMatchType(round.matchType)) {
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

                if (round.status !== undefined && !this.isValidMatchStatus(round.status)) {
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

                if (round.matchType !== undefined && !this.isValidMatchType(round.matchType)) {
                    errors.push('Invalid match type. Must be "standard" or "group_exam".');
                }
            }

            // ---- MATCHES ----
            if (round.matches !== undefined) {
                if (!Array.isArray(round.matches)) {
                    errors.push('Matches must be an array.');
                } else {
                    round.matches.forEach(function(match, index) {
                        var result = this.validateMatch(match, tournament, strict);
                        if (!result.valid) {
                            result.errors.forEach(function(err) {
                                errors.push('Match ' + (index + 1) + ': ' + err);
                            });
                        }
                    }, this);
                }
            }

            return { valid: errors.length === 0, errors: errors };
        },

        /**
         * Validate a match object deeply.
         * Returns { valid: boolean, errors: array }
         */
        validateMatch: function(match, tournament, strict) {
            var errors = [];

            if (!match || typeof match !== 'object') {
                return { valid: false, errors: ['Match must be an object.'] };
            }

            // ---- TYPE ----
            if (strict) {
                if (!this.isValidMatchType(match.type)) {
                    errors.push('Match type is required. Must be "standard" or "group_exam".');
                }

                if (!this.isValidMatchStatus(match.status)) {
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
                if (match.type !== undefined && !this.isValidMatchType(match.type)) {
                    errors.push('Invalid match type. Must be "standard" or "group_exam".');
                }

                if (match.status !== undefined && !this.isValidMatchStatus(match.status)) {
                    errors.push('Invalid match status. Must be "pending", "in_progress", or "completed".');
                }
            }

            // ---- PARTICIPANTS ----
            var participantIds = [];
            var hasInvalidParticipant = false;

            if (!Array.isArray(match.participants)) {
                errors.push('Match participants must be an array.');
            } else if (match.participants.length < 2) {
                errors.push('Match must have at least 2 participants.');
            } else {
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

                    // Verify participant exists in tournament
                    if (tournament && Array.isArray(tournament.participants)) {
                        var exists = tournament.participants.some(function(p) {
                            var pid = strict
                                ? normaliseIdStrict(p.id)
                                : normaliseIdLenient(p.id);
                            return pid === normalised;
                        });
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
                var winnerId = strict
                    ? normaliseIdStrict(match.winner)
                    : normaliseIdLenient(match.winner);
                if (winnerId === null) {
                    errors.push('Invalid winner ID.');
                } else if (participantIds.indexOf(winnerId) === -1) {
                    errors.push('Winner must be a participant in the match.');
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
                    } else if (match.winner && loserId === strict
                        ? normaliseIdStrict(match.winner)
                        : normaliseIdLenient(match.winner)) {
                        errors.push('Loser cannot be the same as winner.');
                    }
                }
            }

            // ---- ADVANCING ----
            if (match.advancing !== undefined) {
                if (!Array.isArray(match.advancing)) {
                    errors.push('Advancing must be an array.');
                } else {
                    match.advancing.forEach(function(id) {
                        var normalised = strict
                            ? normaliseIdStrict(id)
                            : normaliseIdLenient(id);
                        if (normalised === null) {
                            errors.push('Invalid advancing participant ID.');
                        } else if (participantIds.indexOf(normalised) === -1) {
                            errors.push('Advancing participant must be in the match.');
                        }
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
                        if (!TournamentSchema.isValidGroupExamResult(value)) {
                            errors.push('Invalid result for participant "' + key + '". Must be "pass" or "fail".');
                        }
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
                            if (!match.results[id] || !TournamentSchema.isValidGroupExamResult(match.results[id])) {
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

            if (!this.isValidParticipantType(elimination.participantType)) {
                errors.push('Invalid participant type. Must be "character" or "team".');
            }

            if (strict) {
                if (!isStrictValidWeek(elimination.week)) {
                    errors.push('Elimination week must be a number between 1 and 52.');
                }

                var knownKeys = ['participantId', 'participantType', 'week', 'reason'];
                Object.keys(elimination).forEach(function(key) {
                    if (knownKeys.indexOf(key) === -1) {
                        errors.push('Unknown elimination property: "' + key + '"');
                    }
                });

            } else {
                if (!isValidWeek(elimination.week)) {
                    errors.push('Elimination week must be between 1 and 52.');
                }
            }

            if (elimination.reason !== undefined && typeof elimination.reason !== 'string') {
                errors.push('Elimination reason must be a string.');
            }

            // Verify participant exists in tournament with matching type
            if (tournament && participantId !== null && Array.isArray(tournament.participants)) {
                var participant = tournament.participants.find(function(p) {
                    var pid = strict
                        ? normaliseIdStrict(p.id)
                        : normaliseIdLenient(p.id);
                    return pid === participantId;
                });
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
         * status: 'completed' is AUTHORITATIVE - trust the declared status.
         * This is a query, not a validator.
         */
        isTournamentComplete: function(tournament) {
            if (!tournament || typeof tournament !== 'object') return false;

            if (tournament.status === 'completed') return true;

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
        // PARTICIPANT HELPERS
        // ============================================================

        isParticipantEliminated: function(tournament, participantId) {
            if (!tournament || !Array.isArray(tournament.eliminations)) return false;
            var id = normaliseId(participantId);
            if (id === null) return false;
            return tournament.eliminations.some(function(e) {
                return e && normaliseId(e.participantId) === id;
            });
        },

        getParticipantType: function(tournament, participantId) {
            var id = normaliseId(participantId);
            if (id === null) return null;
            if (!Array.isArray(tournament.participants)) return null;
            var record = tournament.participants.find(function(p) {
                return p && normaliseId(p.id) === id;
            });
            return record ? record.type : null;
        },

        isParticipantInTournament: function(tournament, participantId) {
            var id = normaliseId(participantId);
            if (id === null) return false;
            if (!Array.isArray(tournament.participants)) return false;
            return tournament.participants.some(function(p) {
                return p && normaliseId(p.id) === id;
            });
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
                    tournament: null,
                    participants: [],
                    rounds: [],
                    eliminations: [],
                    winner: null
                }
            };

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
