/**
 * js/modules/tournaments/tournaments-schema.js - Tournament Schema
 * SINGLE SOURCE OF TRUTH for tournament data validation.
 * 
 * SCHEMA PHILOSOPHY:
 *   - One constitution, not two competing constitutions
 *   - Used by Core, Queries, Repair, and Matches
 *   - All validation rules are centralised here
 *   - Prevents validator drift between modules
 * 
 * USAGE:
 *   - Core uses validateTournament() to reject mutations
 *   - Repair uses validateTournament() to identify things needing repair
 *   - Queries assumes canonical data (but can check)
 *   - Matches uses validateMatch() and validateRound()
 * 
 * PERSISTENCE CONTRACT:
 *   - This module is PURE: no side effects, no mutation, no persistence
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

    function isValidWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 52;
    }

    function normaliseId(id) {
        return id !== undefined && id !== null ? String(id) : null;
    }

    function hasValue(value) {
        return value !== undefined && value !== null && String(value).trim() !== '';
    }

    // ============================================================
    // SCHEMA VALIDATORS
    // ============================================================

    var TournamentSchema = {
        // Expose constants
        VALID_MODES: VALID_MODES,
        VALID_STATUSES: VALID_STATUSES,
        VALID_PARTICIPANT_TYPES: VALID_PARTICIPANT_TYPES,
        VALID_MATCH_TYPES: VALID_MATCH_TYPES,
        VALID_MATCH_STATUSES: VALID_MATCH_STATUSES,
        VALID_GROUP_EXAM_RESULTS: VALID_GROUP_EXAM_RESULTS,

        // ============================================================
        // TOURNAMENT VALIDATION
        // ============================================================

        /**
         * Validate a complete tournament object.
         * Returns { valid: boolean, errors: array }
         */
        validateTournament: function(tournament, options) {
            options = options || {};
            var strict = options.strict !== false;
            var errors = [];

            if (!tournament || typeof tournament !== 'object') {
                return { valid: false, errors: ['Tournament must be an object.'] };
            }

            // ID: must be present and non-empty
            if (!tournament.id || String(tournament.id).trim() === '') {
                errors.push('Tournament ID is required.');
            }

            // Name: required
            if (!isNonEmptyString(tournament.name)) {
                errors.push('Tournament name is required.');
            }

            // Mode: must be valid
            if (!tournament.mode || VALID_MODES.indexOf(tournament.mode) === -1) {
                errors.push('Invalid tournament mode. Must be "teams" or "individuals".');
            }

            // Start week: must be 1-52
            if (!isValidWeek(tournament.startWeek)) {
                errors.push('Start week must be between 1 and 52.');
            }

            // End week: must be 1-52
            if (!isValidWeek(tournament.endWeek)) {
                errors.push('End week must be between 1 and 52.');
            }

            // Week range: start <= end
            var start = parsePositiveInteger(tournament.startWeek);
            var end = parsePositiveInteger(tournament.endWeek);
            if (start !== null && end !== null && start > end) {
                errors.push('Start week must be before or equal to end week.');
            }

            // Total rounds: positive integer
            var totalRounds = parsePositiveInteger(tournament.totalRounds);
            if (totalRounds === null) {
                errors.push('Total rounds must be a positive integer.');
            }

            // Status: must be valid
            if (!tournament.status || VALID_STATUSES.indexOf(tournament.status) === -1) {
                errors.push('Invalid tournament status.');
            }

            // Current round: must be >= 0 and <= totalRounds
            var currentRound = parsePositiveInteger(tournament.currentRound);
            if (currentRound === null && tournament.currentRound !== 0) {
                errors.push('Current round must be a non-negative integer.');
            } else if (currentRound !== null && totalRounds !== null && currentRound > totalRounds) {
                errors.push('Current round cannot exceed total rounds.');
            }

            // Participants: must be an array
            if (tournament.participants !== undefined && !Array.isArray(tournament.participants)) {
                errors.push('Participants must be an array.');
            }

            // Rounds: must be an array
            if (tournament.rounds !== undefined && !Array.isArray(tournament.rounds)) {
                errors.push('Rounds must be an array.');
            }

            // Eliminations: must be an array
            if (tournament.eliminations !== undefined && !Array.isArray(tournament.eliminations)) {
                errors.push('Eliminations must be an array.');
            }

            // Winner: if present, must be a valid participant reference
            if (tournament.winner !== undefined && tournament.winner !== null) {
                var winnerValidation = this.validateParticipantReference(tournament.winner);
                if (!winnerValidation.valid) {
                    winnerValidation.errors.forEach(function(err) {
                        errors.push('Winner: ' + err);
                    });
                }
            }

            // Created at: must be a valid date string
            if (tournament.createdAt !== undefined && tournament.createdAt !== null) {
                var date = new Date(tournament.createdAt);
                if (isNaN(date.getTime())) {
                    errors.push('Created at must be a valid date.');
                }
            }

            // Unknown properties (strict mode only)
            if (strict) {
                var knownKeys = [
                    'id', 'name', 'mode', 'startWeek', 'endWeek', 'totalRounds',
                    'currentRound', 'status', 'participants', 'teams', 'rounds',
                    'matches', 'eliminations', 'winners', 'winner', 'createdAt'
                ];
                Object.keys(tournament).forEach(function(key) {
                    if (knownKeys.indexOf(key) === -1) {
                        errors.push('Unknown property: "' + key + '"');
                    }
                });
            }

            return { valid: errors.length === 0, errors: errors };
        },

        // ============================================================
        // PARTICIPANT VALIDATION
        // ============================================================

        /**
         * Validate a participant reference.
         * Returns { valid: boolean, errors: array }
         */
        validateParticipantReference: function(participant) {
            var errors = [];

            if (!participant || typeof participant !== 'object') {
                return { valid: false, errors: ['Participant must be an object.'] };
            }

            // ID: required
            var id = normaliseId(participant.id);
            if (id === null) {
                errors.push('Participant ID is required.');
            }

            // Type: must be valid
            if (participant.type !== undefined && VALID_PARTICIPANT_TYPES.indexOf(participant.type) === -1) {
                errors.push('Invalid participant type. Must be "character" or "team".');
            }

            return { valid: errors.length === 0, errors: errors };
        },

        /**
         * Validate a participant in the context of a tournament.
         * Checks that the participant exists in the tournament and is not eliminated.
         */
        validateParticipantInTournament: function(tournament, participantId, expectedType) {
            var errors = [];

            var id = normaliseId(participantId);
            if (id === null) {
                return { valid: false, errors: ['Invalid participant ID.'] };
            }

            // Check if tournament exists
            if (!tournament || typeof tournament !== 'object') {
                return { valid: false, errors: ['Tournament is required.'] };
            }

            // Check if participant is in the tournament
            var isInTournament = Array.isArray(tournament.participants) &&
                tournament.participants.some(function(p) {
                    return p && normaliseId(p.id) === id;
                });

            if (!isInTournament) {
                errors.push('Participant is not in the tournament.');
            }

            // Check if participant is eliminated
            var isEliminated = Array.isArray(tournament.eliminations) &&
                tournament.eliminations.some(function(e) {
                    return e && normaliseId(e.participantId) === id;
                });

            if (isEliminated) {
                errors.push('Participant has been eliminated from the tournament.');
            }

            // Check type if expected
            if (expectedType && isInTournament) {
                var participantRecord = tournament.participants.find(function(p) {
                    return p && normaliseId(p.id) === id;
                });
                if (participantRecord && participantRecord.type !== expectedType) {
                    errors.push('Participant type mismatch. Expected: "' + expectedType + '", got: "' + participantRecord.type + '"');
                }
            }

            return { valid: errors.length === 0, errors: errors };
        },

        // ============================================================
        // ROUND VALIDATION
        // ============================================================

        /**
         * Validate a round object.
         * Returns { valid: boolean, errors: array }
         */
        validateRound: function(round, roundIndex) {
            var errors = [];

            if (!round || typeof round !== 'object') {
                return { valid: false, errors: ['Round must be an object.'] };
            }

            // Round number: positive integer
            var roundNumber = parsePositiveInteger(round.roundNumber);
            if (roundNumber === null) {
                errors.push('Round number must be a positive integer.');
            }

            // Status: must be valid
            if (round.status !== undefined && VALID_MATCH_STATUSES.indexOf(round.status) === -1) {
                errors.push('Invalid round status. Must be "pending", "in_progress", or "completed".');
            }

            // Match size: positive integer
            var matchSize = parsePositiveInteger(round.matchSize);
            if (matchSize === null) {
                errors.push('Match size must be a positive integer.');
            } else if (matchSize < 2) {
                errors.push('Match size must be at least 2.');
            }

            // Match type: must be valid
            if (round.matchType !== undefined && VALID_MATCH_TYPES.indexOf(round.matchType) === -1) {
                errors.push('Invalid match type. Must be "standard" or "group_exam".');
            }

            // Matches: must be an array
            if (round.matches !== undefined && !Array.isArray(round.matches)) {
                errors.push('Matches must be an array.');
            }

            return { valid: errors.length === 0, errors: errors };
        },

        /**
         * Validate a round in the context of a tournament.
         */
        validateRoundInTournament: function(tournament, roundIndex) {
            var errors = [];

            if (!tournament || typeof tournament !== 'object') {
                return { valid: false, errors: ['Tournament is required.'] };
            }

            if (!Array.isArray(tournament.rounds)) {
                return { valid: false, errors: ['Tournament rounds data is malformed.'] };
            }

            if (roundIndex < 0 || roundIndex >= tournament.rounds.length) {
                errors.push('Round index out of bounds.');
                return { valid: errors.length === 0, errors: errors };
            }

            var round = tournament.rounds[roundIndex];
            var roundValidation = this.validateRound(round, roundIndex);
            if (!roundValidation.valid) {
                roundValidation.errors.forEach(function(err) {
                    errors.push('Round ' + (roundIndex + 1) + ': ' + err);
                });
            }

            // Check if round is completed (can't modify completed rounds)
            if (round && round.status === 'completed') {
                errors.push('Cannot modify a completed round.');
            }

            return { valid: errors.length === 0, errors: errors };
        },

        // ============================================================
        // MATCH VALIDATION
        // ============================================================

        /**
         * Validate a match object.
         * Returns { valid: boolean, errors: array }
         */
        validateMatch: function(match, matchIndex) {
            var errors = [];

            if (!match || typeof match !== 'object') {
                return { valid: false, errors: ['Match must be an object.'] };
            }

            // Participants: array with at least 2 entries
            if (!Array.isArray(match.participants)) {
                errors.push('Match participants must be an array.');
            } else if (match.participants.length < 2) {
                errors.push('Match must have at least 2 participants.');
            } else {
                // Check for duplicate participants
                var seen = {};
                match.participants.forEach(function(id) {
                    var normalised = normaliseId(id);
                    if (normalised !== null) {
                        if (seen[normalised]) {
                            errors.push('Duplicate participant in match: "' + normalised + '"');
                        }
                        seen[normalised] = true;
                    } else {
                        errors.push('Invalid participant ID in match.');
                    }
                });
            }

            // Type: must be valid
            if (match.type !== undefined && VALID_MATCH_TYPES.indexOf(match.type) === -1) {
                errors.push('Invalid match type. Must be "standard" or "group_exam".');
            }

            // Status: must be valid
            if (match.status !== undefined && VALID_MATCH_STATUSES.indexOf(match.status) === -1) {
                errors.push('Invalid match status. Must be "pending", "in_progress", or "completed".');
            }

            // Winner: if present, must be a valid participant
            if (match.winner !== undefined && match.winner !== null) {
                var winnerId = normaliseId(match.winner);
                if (winnerId === null) {
                    errors.push('Invalid winner ID.');
                } else if (Array.isArray(match.participants) && match.participants.indexOf(winnerId) === -1) {
                    errors.push('Winner must be a participant in the match.');
                }
            }

            // Loser: if present, must be a valid participant (standard matches only)
            if (match.loser !== undefined && match.loser !== null) {
                if (match.type === 'group_exam') {
                    errors.push('Group exam matches do not have a loser field.');
                } else {
                    var loserId = normaliseId(match.loser);
                    if (loserId === null) {
                        errors.push('Invalid loser ID.');
                    } else if (Array.isArray(match.participants) && match.participants.indexOf(loserId) === -1) {
                        errors.push('Loser must be a participant in the match.');
                    } else if (match.winner && loserId === normaliseId(match.winner)) {
                        errors.push('Loser cannot be the same as winner.');
                    }
                }
            }

            // Advancing: if present, must be an array of valid participants
            if (match.advancing !== undefined) {
                if (!Array.isArray(match.advancing)) {
                    errors.push('Advancing must be an array.');
                } else {
                    match.advancing.forEach(function(id) {
                        var normalised = normaliseId(id);
                        if (normalised === null) {
                            errors.push('Invalid advancing participant ID.');
                        } else if (Array.isArray(match.participants) && match.participants.indexOf(normalised) === -1) {
                            errors.push('Advancing participant must be in the match.');
                        }
                    });
                }
            }

            // Results: if present, must be an object with valid results (group_exam only)
            if (match.results !== undefined) {
                if (match.type !== 'group_exam') {
                    errors.push('Results are only valid for group_exam matches.');
                } else if (!isObject(match.results)) {
                    errors.push('Results must be an object.');
                } else {
                    Object.keys(match.results).forEach(function(key) {
                        var value = match.results[key];
                        if (VALID_GROUP_EXAM_RESULTS.indexOf(value) === -1) {
                            errors.push('Invalid result for participant "' + key + '". Must be "pass" or "fail".');
                        }
                        var id = normaliseId(key);
                        if (id !== null && Array.isArray(match.participants) && match.participants.indexOf(id) === -1) {
                            errors.push('Result participant "' + key + '" is not in the match.');
                        }
                    });
                }
            }

            // Completed match validation
            if (match.status === 'completed') {
                if (match.type === 'standard' && !match.winner) {
                    errors.push('Completed standard match must have a winner.');
                }
                if (match.type === 'group_exam' && (!match.results || Object.keys(match.results).length === 0)) {
                    errors.push('Completed group exam match must have results.');
                }
            }

            return { valid: errors.length === 0, errors: errors };
        },

        /**
         * Validate a match in the context of a tournament and round.
         */
        validateMatchInTournament: function(tournament, roundIndex, matchIndex) {
            var errors = [];

            if (!tournament || typeof tournament !== 'object') {
                return { valid: false, errors: ['Tournament is required.'] };
            }

            if (!Array.isArray(tournament.rounds)) {
                return { valid: false, errors: ['Tournament rounds data is malformed.'] };
            }

            if (roundIndex < 0 || roundIndex >= tournament.rounds.length) {
                errors.push('Round index out of bounds.');
                return { valid: errors.length === 0, errors: errors };
            }

            var round = tournament.rounds[roundIndex];
            if (!round || typeof round !== 'object') {
                errors.push('Round is malformed.');
                return { valid: errors.length === 0, errors: errors };
            }

            if (!Array.isArray(round.matches)) {
                errors.push('Round matches data is malformed.');
                return { valid: errors.length === 0, errors: errors };
            }

            if (matchIndex < 0 || matchIndex >= round.matches.length) {
                errors.push('Match index out of bounds.');
                return { valid: errors.length === 0, errors: errors };
            }

            var match = round.matches[matchIndex];
            var matchValidation = this.validateMatch(match, matchIndex);
            if (!matchValidation.valid) {
                matchValidation.errors.forEach(function(err) {
                    errors.push('Match ' + (matchIndex + 1) + ': ' + err);
                });
            }

            // Check if match is completed (can't modify completed matches)
            if (match && match.status === 'completed') {
                errors.push('Cannot modify a completed match.');
            }

            // Check if round is completed
            if (round.status === 'completed') {
                errors.push('Cannot modify matches in a completed round.');
            }

            return { valid: errors.length === 0, errors: errors };
        },

        // ============================================================
        // ELIMINATION VALIDATION
        // ============================================================

        /**
         * Validate an elimination record.
         * Returns { valid: boolean, errors: array }
         */
        validateElimination: function(elimination) {
            var errors = [];

            if (!elimination || typeof elimination !== 'object') {
                return { valid: false, errors: ['Elimination must be an object.'] };
            }

            // Participant ID: required
            var participantId = normaliseId(elimination.participantId);
            if (participantId === null) {
                errors.push('Elimination participant ID is required.');
            }

            // Participant type: must be valid
            if (elimination.participantType !== undefined &&
                VALID_PARTICIPANT_TYPES.indexOf(elimination.participantType) === -1) {
                errors.push('Invalid participant type. Must be "character" or "team".');
            }

            // Week: must be 1-52
            if (!isValidWeek(elimination.week)) {
                errors.push('Elimination week must be between 1 and 52.');
            }

            // Reason: optional string
            if (elimination.reason !== undefined && typeof elimination.reason !== 'string') {
                errors.push('Elimination reason must be a string.');
            }

            return { valid: errors.length === 0, errors: errors };
        },

        // ============================================================
        // COMPLETENESS CHECKS
        // ============================================================

        /**
         * Check if a tournament is complete.
         * Canonical definition: status === 'completed' OR (all rounds complete AND winner exists)
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

        /**
         * Check if a round is complete.
         */
        isRoundComplete: function(round) {
            if (!round || typeof round !== 'object') return false;
            return round.status === 'completed';
        },

        /**
         * Check if a match is complete.
         */
        isMatchComplete: function(match) {
            if (!match || typeof match !== 'object') return false;
            return match.status === 'completed';
        },

        // ============================================================
        // PARTICIPANT HELPERS
        // ============================================================

        /**
         * Check if a participant is eliminated from a tournament.
         */
        isParticipantEliminated: function(tournament, participantId) {
            if (!tournament || !Array.isArray(tournament.eliminations)) return false;
            var id = normaliseId(participantId);
            if (id === null) return false;
            return tournament.eliminations.some(function(e) {
                return e && normaliseId(e.participantId) === id;
            });
        },

        /**
         * Get the participant type from a tournament's participant list.
         */
        getParticipantType: function(tournament, participantId) {
            var id = normaliseId(participantId);
            if (id === null) return null;
            if (!Array.isArray(tournament.participants)) return null;
            var record = tournament.participants.find(function(p) {
                return p && normaliseId(p.id) === id;
            });
            return record ? record.type : null;
        },

        /**
         * Check if a participant is in a tournament.
         */
        isParticipantInTournament: function(tournament, participantId) {
            var id = normaliseId(participantId);
            if (id === null) return false;
            if (!Array.isArray(tournament.participants)) return false;
            return tournament.participants.some(function(p) {
                return p && normaliseId(p.id) === id;
            });
        },

        /**
         * Get all participants of a tournament (normalised).
         */
        getParticipants: function(tournament) {
            if (!Array.isArray(tournament.participants)) return [];
            return tournament.participants.map(function(p) {
                return {
                    id: normaliseId(p.id) || p.id,
                    type: p.type || 'character',
                    addedAt: p.addedAt || null
                };
            });
        },

        /**
         * Get active participants (not eliminated) of a tournament.
         */
        getActiveParticipants: function(tournament) {
            var participants = this.getParticipants(tournament);
            return participants.filter(function(p) {
                return !this.isParticipantEliminated(tournament, p.id);
            }, this);
        },

        // ============================================================
        // REPORTING
        // ============================================================

        /**
         * Get a validation report for a tournament.
         * Returns a detailed report with all validation issues.
         */
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

            // Validate tournament
            var tournamentValidation = this.validateTournament(tournament);
            if (!tournamentValidation.valid) {
                report.valid = false;
                tournamentValidation.errors.forEach(function(err) {
                    report.errors.push('[Tournament] ' + err);
                });
            }

            // Validate participants
            if (Array.isArray(tournament.participants)) {
                tournament.participants.forEach(function(p, index) {
                    var validation = this.validateParticipantReference(p);
                    if (!validation.valid) {
                        report.valid = false;
                        validation.errors.forEach(function(err) {
                            report.errors.push('[Participant ' + (index + 1) + '] ' + err);
                        });
                    }
                }, this);
            }

            // Validate rounds
            if (Array.isArray(tournament.rounds)) {
                tournament.rounds.forEach(function(round, index) {
                    var validation = this.validateRound(round, index);
                    if (!validation.valid) {
                        report.valid = false;
                        validation.errors.forEach(function(err) {
                            report.errors.push('[Round ' + (index + 1) + '] ' + err);
                        });
                    }
                    // Validate matches within round
                    if (Array.isArray(round.matches)) {
                        round.matches.forEach(function(match, matchIndex) {
                            var matchValidation = this.validateMatch(match, matchIndex);
                            if (!matchValidation.valid) {
                                report.valid = false;
                                matchValidation.errors.forEach(function(err) {
                                    report.errors.push('[Round ' + (index + 1) + ', Match ' + (matchIndex + 1) + '] ' + err);
                                });
                            }
                        }, this);
                    }
                }, this);
            }

            // Validate eliminations
            if (Array.isArray(tournament.eliminations)) {
                tournament.eliminations.forEach(function(e, index) {
                    var validation = this.validateElimination(e);
                    if (!validation.valid) {
                        report.valid = false;
                        validation.errors.forEach(function(err) {
                            report.errors.push('[Elimination ' + (index + 1) + '] ' + err);
                        });
                    }
                }, this);
            }

            // Validate winner
            if (tournament.winner) {
                var winnerValidation = this.validateParticipantReference(tournament.winner);
                if (!winnerValidation.valid) {
                    report.valid = false;
                    winnerValidation.errors.forEach(function(err) {
                        report.errors.push('[Winner] ' + err);
                    });
                }
                // Check if winner is in participants
                if (tournament.winner.id && !this.isParticipantInTournament(tournament, tournament.winner.id)) {
                    report.valid = false;
                    report.errors.push('[Winner] Winner is not in the tournament participants list.');
                }
            }

            // Add warnings for completeness
            if (this.isTournamentComplete(tournament)) {
                report.warnings.push('Tournament is marked as complete.');
            }

            return report;
        }
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentsSchema = TournamentSchema;

    // Also add to TournamentsCore for backward compatibility
    if (window.TournamentsCore) {
        window.TournamentsCore.validateTournament = TournamentSchema.validateTournament;
        window.TournamentsCore.isComplete = TournamentSchema.isTournamentComplete;
        window.TournamentsCore.isParticipantEliminated = TournamentSchema.isParticipantEliminated;
        window.TournamentsCore.getParticipantType = TournamentSchema.getParticipantType;
        window.TournamentsCore.isParticipantInTournament = TournamentSchema.isParticipantInTournament;
        window.TournamentsCore.getParticipants = TournamentSchema.getParticipants;
        window.TournamentsCore.getActiveParticipants = TournamentSchema.getActiveParticipants;
    }

    // Also add to TournamentsQueries for consistency
    if (window.TournamentsQueries) {
        window.TournamentsQueries.validateTournament = TournamentSchema.validateTournament;
        window.TournamentsQueries.getValidationReport = TournamentSchema.getValidationReport;
    }

})();
