/**
 * js/modules/tournaments/tournaments-repair.js - Tournament Repair
 * Explicit repair functions for legacy/malformed data.
 * NOT called automatically by getters.
 * 
 * REPAIR PHILOSOPHY:
 *   - Explicit repair is allowed, but CONSERVATIVE
 *   - Repairs STRUCTURE where intent is unambiguous
 *   - Preserves unknown historical data where possible
 *   - NEVER fabricates identity, participant type, dates, or events
 *   - NEVER fabricates default values for missing semantic fields
 *   - NEVER silently deletes historical events
 *   - Rejects records requiring semantic inference
 *   - Produces objects that pass strict schema validation
 *   - Does NOT auto-save; caller is responsible for persistence
 * 
 * REPAIR RULES:
 *   - Missing required fields → reject
 *   - Invalid values → reject (do not default)
 *   - Malformed nested data → reject if ambiguous (do not delete)
 *   - Unknown properties → preserved (where schema permits)
 *   - Duplicate participants → reject
 *   - Duplicate eliminations → reject
 *   - Duplicate advancing participants → reject
 *   - Duplicate result participants → reject
 *   - Winner type mismatch → reject
 *   - Invalid createdAt → reject (not silently removed)
 *   - Missing loser is derived ONLY for completed standard 2-person matches when winner is present
 *   - Conflicting loser → reject
 *   - Final repaired object MUST pass structural/semantic validation via Schema
 * 
 * SEMANTIC NOTES:
 *   - roundNumber is POSITIONAL per schema definition (index + 1)
 *   - Numeric-string canonicalisation is allowed for week/round values
 *   - addedAt is preserved as-is if present (schema-validated at final gate)
 *   - Advancing semantic rules are owned entirely by TournamentsSchema
 *   - Winner unknown properties are preserved where schema permits
 *   - Missing fields are represented as null/empty per schema canonicalisation
 * 
 * DEPENDENCIES:
 *   - TournamentsSchema is a HARD dependency (single source of truth)
 */

(function() {
    'use strict';

    if (window.__tournamentsRepairLoaded) return;
    window.__tournamentsRepairLoaded = true;

    // ============================================================
    // DEPENDENCIES - Schema is the SOLE source of truth
    // ============================================================

    var Schema = window.TournamentsSchema;
    if (!Schema) {
        return;
    }

    // Import from Schema - NO DUPLICATED CONSTANTS OR VALIDATION
    var normaliseId = Schema.normaliseId;
    var isValidParticipantType = Schema.isValidParticipantType;
    var isValidWeek = Schema.isValidWeek;
    var isValidMode = Schema.isValidMode;
    var isValidStatus = Schema.isValidStatus;
    var isValidMatchType = Schema.isValidMatchType;
    var isValidMatchStatus = Schema.isValidMatchStatus;
    var isValidGroupExamResult = Schema.isValidGroupExamResult;
    var isObject = Schema.isObject;
    var isNonEmptyString = Schema.isNonEmptyString;
    var parsePositiveInteger = Schema.parsePositiveInteger;
    var isStrictDate = Schema.isStrictDate;

    // ============================================================
    // INTERNAL HELPERS
    // ============================================================

    function participantExists(participants, id) {
        var normalised = normaliseId(id);
        if (normalised === null) return false;
        return participants.some(function(p) {
            return normaliseId(p.id) === normalised;
        });
    }

    function getParticipant(participants, id) {
        var normalised = normaliseId(id);
        if (normalised === null) return null;
        return participants.find(function(p) {
            return normaliseId(p.id) === normalised;
        });
    }

    /**
     * Derive loser for a standard match with exactly 2 participants.
     * Returns null if loser cannot be unambiguously derived.
     */
    function deriveLoser(participants, winner) {
        if (!Array.isArray(participants) || participants.length !== 2) return null;
        if (!winner) return null;
        var winnerId = normaliseId(winner);
        if (winnerId === null) return null;
        var loser = participants.find(function(id) {
            return normaliseId(id) !== winnerId;
        });
        return loser || null;
    }

    // ============================================================
    // NESTED REPAIR FUNCTIONS - CONSERVATIVE (NO DEFAULTS)
    // ============================================================

    function repairParticipant(participant, report) {
        if (!participant || typeof participant !== 'object') {
            if (report) report.discarded.push('Participant is not an object');
            return null;
        }

        var id = normaliseId(participant.id);
        if (id === null) {
            if (report) report.discarded.push('Participant has no valid ID');
            return null;
        }

        var type = participant.type;
        if (!isValidParticipantType(type)) {
            if (report) report.discarded.push('Participant "' + id + '" has invalid type: "' + type + '"');
            return null;
        }

        var repaired = {
            id: id,
            type: type
        };

        // addedAt is preserved if present; Schema will validate its format/content
        if (participant.addedAt !== undefined) {
            repaired.addedAt = participant.addedAt;
        }

        var knownKeys = ['id', 'type', 'addedAt'];
        Object.keys(participant).forEach(function(key) {
            if (knownKeys.indexOf(key) === -1) {
                repaired[key] = participant[key];
            }
        });

        return repaired;
    }

    /**
     * Repair a single match record.
     * Validates against round constraints (matchSize, matchType).
     * Derives missing loser only for completed standard 2-person matches when winner is present.
     * Rejects duplicate advancing participants.
     * Rejects duplicate result participants after ID normalisation.
     * Advancing semantic rules are owned by Schema (final validation gate).
     */
    function repairMatch(match, tournamentParticipants, expectedMatchSize, expectedMatchType, report) {
        if (!match || typeof match !== 'object') {
            if (report) report.discarded.push('Match is not an object');
            return null;
        }

        // ---- TYPE: REQUIRED ----
        if (match.type === undefined) {
            if (report) report.discarded.push('Match has no type');
            return null;
        }
        var type = match.type;
        if (!isValidMatchType(type)) {
            if (report) report.discarded.push('Match has invalid type: "' + type + '"');
            return null;
        }

        // Enforce round matchType
        if (expectedMatchType && type !== expectedMatchType) {
            if (report) report.discarded.push('Match type "' + type +
                '" does not match round type "' + expectedMatchType + '"');
            return null;
        }

        // ---- STATUS: REQUIRED ----
        if (match.status === undefined) {
            if (report) report.discarded.push('Match has no status');
            return null;
        }
        var status = match.status;
        if (!isValidMatchStatus(status)) {
            if (report) report.discarded.push('Match has invalid status: "' + status + '"');
            return null;
        }

        // ---- PARTICIPANTS: REQUIRED ----
        var validParticipants = [];
        var seen = Object.create(null);

        if (!Array.isArray(match.participants)) {
            if (report) report.discarded.push('Match participants is not an array');
            return null;
        }

        if (match.participants.length < 2) {
            if (report) report.discarded.push('Match has fewer than 2 participants');
            return null;
        }

        for (var i = 0; i < match.participants.length; i++) {
            var id = match.participants[i];
            var normalised = normaliseId(id);

            if (normalised === null) {
                if (report) report.discarded.push('Match has invalid participant ID: "' + String(id) + '"');
                return null;
            }

            if (seen[normalised] === true) {
                if (report) report.discarded.push('Match has duplicate participant: "' + normalised + '"');
                return null;
            }
            seen[normalised] = true;

            if (!participantExists(tournamentParticipants, normalised)) {
                if (report) report.discarded.push('Match participant "' + normalised + '" not found in tournament');
                return null;
            }

            validParticipants.push(normalised);
        }

        // Enforce round matchSize
        if (validParticipants.length !== expectedMatchSize) {
            if (report) report.discarded.push('Match participant count (' + validParticipants.length +
                ') does not match round matchSize (' + expectedMatchSize + ')');
            return null;
        }

        // ---- WINNER: Optional ----
        var winner = null;
        if (match.winner !== undefined && match.winner !== null) {
            var winnerId = normaliseId(match.winner);
            if (winnerId === null || validParticipants.indexOf(winnerId) === -1) {
                if (report) report.discarded.push('Match winner is not a valid participant');
                return null;
            }
            winner = winnerId;
        }

        // ---- LOSER: Optional ----
        // Missing loser is derived ONLY for completed standard 2-person matches when winner is present
        var loser = null;
        if (match.loser !== undefined && match.loser !== null) {
            if (type === 'group_exam') {
                if (report) report.discarded.push('Group exam matches do not have a loser field');
                return null;
            }
            var loserId = normaliseId(match.loser);
            if (loserId === null || validParticipants.indexOf(loserId) === -1) {
                if (report) report.discarded.push('Match loser is not a valid participant');
                return null;
            }
            if (winner !== null && loserId === winner) {
                if (report) report.discarded.push('Loser cannot be the same as winner');
                return null;
            }
            loser = loserId;
        }

        // Derive missing loser for completed standard 2-person matches
        if (type === 'standard' && validParticipants.length === 2 && status === 'completed') {
            var derivedLoser = deriveLoser(validParticipants, winner);
            if (derivedLoser !== null) {
                if (loser === null) {
                    loser = derivedLoser;
                } else if (loser !== derivedLoser) {
                    if (report) report.discarded.push('Match loser conflicts with derived loser');
                    return null;
                }
            }
        }

        // ---- ADVANCING: Optional ----
        // Semantic rules are owned by Schema (final validation gate)
        var advancing = [];
        if (match.advancing !== undefined) {
            if (!Array.isArray(match.advancing)) {
                if (report) report.discarded.push('Match advancing is not an array');
                return null;
            }
            var advancingSeen = Object.create(null);
            for (var j = 0; j < match.advancing.length; j++) {
                var advId = normaliseId(match.advancing[j]);
                if (advId === null || validParticipants.indexOf(advId) === -1) {
                    if (report) report.discarded.push('Match advancing participant is not valid');
                    return null;
                }
                if (advancingSeen[advId] === true) {
                    if (report) report.discarded.push('Match has duplicate advancing participant: "' + advId + '"');
                    return null;
                }
                advancingSeen[advId] = true;
                advancing.push(advId);
            }
        }

        // ---- RESULTS: Optional (group_exam only) ----
        // Reject duplicate result participants after ID normalisation
        var results = {};
        if (match.results !== undefined) {
            if (type !== 'group_exam') {
                if (report) report.discarded.push('Results only valid for group_exam matches');
                return null;
            }
            if (!isObject(match.results)) {
                if (report) report.discarded.push('Results must be an object');
                return null;
            }
            var resultKeys = Object.keys(match.results);
            var resultSeen = Object.create(null);

            for (var k = 0; k < resultKeys.length; k++) {
                var key = resultKeys[k];
                var id = normaliseId(key);
                if (id === null || validParticipants.indexOf(id) === -1) {
                    if (report) report.discarded.push('Result participant "' + key + '" is not in the match');
                    return null;
                }
                if (resultSeen[id] === true) {
                    if (report) report.discarded.push('Match has duplicate result participant: "' + id + '"');
                    return null;
                }
                resultSeen[id] = true;

                var value = match.results[key];
                if (!isValidGroupExamResult(value)) {
                    if (report) report.discarded.push('Match result for "' + key + '" is invalid: "' + value + '"');
                    return null;
                }
                results[id] = value;
            }
        }

        // ---- COMPLETED MATCH VALIDATION ----
        if (status === 'completed') {
            if (type === 'standard' && !winner) {
                if (report) report.discarded.push('Completed standard match must have a winner');
                return null;
            }
            if (type === 'group_exam') {
                for (var m = 0; m < validParticipants.length; m++) {
                    var pid = validParticipants[m];
                    if (!results[pid]) {
                        if (report) report.discarded.push('Completed group exam must have results for all participants');
                        return null;
                    }
                }
            }
        }

        var repaired = {
            participants: validParticipants,
            type: type,
            status: status,
            winner: winner,
            loser: loser,
            advancing: advancing,
            results: results
        };

        var knownKeys = ['participants', 'type', 'status', 'winner', 'loser', 'advancing', 'results'];
        Object.keys(match).forEach(function(key) {
            if (knownKeys.indexOf(key) === -1) {
                repaired[key] = match[key];
            }
        });

        return repaired;
    }

    function repairRound(round, index, tournamentParticipants, report) {
        if (!round || typeof round !== 'object') {
            if (report) report.discarded.push('Round ' + (index + 1) + ' is not an object');
            return null;
        }

        // ---- STATUS: REQUIRED ----
        if (round.status === undefined) {
            if (report) report.discarded.push('Round ' + (index + 1) + ' has no status');
            return null;
        }
        var status = round.status;
        if (!isValidMatchStatus(status)) {
            if (report) report.discarded.push('Round ' + (index + 1) + ' has invalid status: "' + status + '"');
            return null;
        }

        // ---- MATCH SIZE: REQUIRED ----
        if (round.matchSize === undefined) {
            if (report) report.discarded.push('Round ' + (index + 1) + ' has no match size');
            return null;
        }
        var matchSize = parsePositiveInteger(round.matchSize);
        if (matchSize === null || matchSize < 2) {
            if (report) report.discarded.push('Round ' + (index + 1) + ' has invalid match size: "' + round.matchSize + '"');
            return null;
        }

        // ---- MATCH TYPE: REQUIRED ----
        if (round.matchType === undefined) {
            if (report) report.discarded.push('Round ' + (index + 1) + ' has no match type');
            return null;
        }
        var matchType = round.matchType;
        if (!isValidMatchType(matchType)) {
            if (report) report.discarded.push('Round ' + (index + 1) + ' has invalid match type: "' + matchType + '"');
            return null;
        }

        // ---- MATCHES: REQUIRED ----
        var matches = [];
        if (round.matches === undefined) {
            if (report) report.discarded.push('Round ' + (index + 1) + ' has no matches array');
            return null;
        }
        if (!Array.isArray(round.matches)) {
            if (report) report.discarded.push('Round ' + (index + 1) + ' matches is not an array');
            return null;
        }

        for (var i = 0; i < round.matches.length; i++) {
            var matchReport = { discarded: [] };
            var repairedMatch = repairMatch(
                round.matches[i],
                tournamentParticipants,
                matchSize,
                matchType,
                matchReport
            );
            if (repairedMatch !== null) {
                matches.push(repairedMatch);
            } else {
                if (matchReport.discarded.length > 0) {
                    matchReport.discarded.forEach(function(d) {
                        report.discarded.push('Round ' + (index + 1) + ', Match ' + (i + 1) + ': ' + d);
                    });
                }
                report.discarded.push('Round ' + (index + 1) + ' contains an unrecoverable match');
                return null;
            }
        }

        // roundNumber is POSITIONAL per schema definition
        var repaired = {
            roundNumber: index + 1,
            status: status,
            matchSize: matchSize,
            matchType: matchType,
            matches: matches
        };

        var knownKeys = ['roundNumber', 'status', 'matchSize', 'matchType', 'matches'];
        Object.keys(round).forEach(function(key) {
            if (knownKeys.indexOf(key) === -1) {
                repaired[key] = round[key];
            }
        });

        return repaired;
    }

    function repairElimination(elimination, tournamentParticipants, startWeek, endWeek, report) {
        if (!elimination || typeof elimination !== 'object') {
            if (report) report.discarded.push('Elimination is not an object');
            return null;
        }

        var participantId = normaliseId(elimination.participantId);
        if (participantId === null) {
            if (report) report.discarded.push('Elimination has no valid participant ID');
            return null;
        }

        var participant = getParticipant(tournamentParticipants, participantId);
        if (!participant) {
            if (report) report.discarded.push('Eliminated participant "' + participantId + '" not found in tournament');
            return null;
        }

        if (elimination.participantType === undefined) {
            if (report) report.discarded.push('Elimination has no participant type');
            return null;
        }
        var participantType = elimination.participantType;
        if (!isValidParticipantType(participantType)) {
            if (report) report.discarded.push('Elimination has invalid participant type: "' + participantType + '"');
            return null;
        }

        if (participant.type !== participantType) {
            if (report) report.discarded.push('Elimination participant type "' + participantType +
                '" does not match tournament participant type "' + participant.type + '"');
            return null;
        }

        if (elimination.week === undefined) {
            if (report) report.discarded.push('Elimination has no week');
            return null;
        }
        var week = parsePositiveInteger(elimination.week);
        if (week === null || !isValidWeek(week)) {
            if (report) report.discarded.push('Elimination has invalid week: "' + String(elimination.week) + '"');
            return null;
        }

        if (startWeek !== null && endWeek !== null) {
            if (week < startWeek || week > endWeek) {
                if (report) report.discarded.push('Elimination week ' + week +
                    ' is outside tournament week range ' + startWeek + '-' + endWeek);
                return null;
            }
        }

        if (elimination.reason === undefined) {
            if (report) report.discarded.push('Elimination has no reason');
            return null;
        }
        if (typeof elimination.reason !== 'string') {
            if (report) report.discarded.push('Elimination reason must be a string');
            return null;
        }

        var repaired = {
            participantId: participantId,
            participantType: participantType,
            week: week,
            reason: elimination.reason
        };

        var knownKeys = ['participantId', 'participantType', 'week', 'reason'];
        Object.keys(elimination).forEach(function(key) {
            if (knownKeys.indexOf(key) === -1) {
                repaired[key] = elimination[key];
            }
        });

        return repaired;
    }

    // ============================================================
    // TOURNAMENT REPAIR
    // ============================================================

    var TournamentsRepair = {
        /**
         * Repair a single tournament to canonical form.
         * CONSERVATIVE: rejects ambiguous data, preserves unknowns.
         * Produces an object that passes strict schema validation.
         * Does NOT auto-save; caller is responsible for persistence.
         * 
         * @param {object} tourn - Tournament object to repair
         * @param {object} options - (reserved for future use)
         * @returns {object|null} { tournament: object, report: object } or null if unrecoverable
         */
        repairTournament: function(tourn, options) {
            var report = {
                warnings: [],
                discarded: [],
                repaired: false
            };

            if (!tourn || typeof tourn !== 'object') {
                report.discarded.push('Tournament is not an object');
                return null;
            }

            // ---- ID: REQUIRED ----
            var id = normaliseId(tourn.id);
            if (id === null) {
                report.discarded.push('Tournament has no valid ID');
                return null;
            }

            // ---- NAME: REQUIRED ----
            if (!isNonEmptyString(tourn.name)) {
                report.discarded.push('Tournament has no valid name');
                return null;
            }
            var name = String(tourn.name).trim();

            // ---- MODE: REQUIRED ----
            if (!isValidMode(tourn.mode)) {
                report.discarded.push('Tournament has no valid mode');
                return null;
            }
            var mode = tourn.mode;

            // ---- START WEEK: REQUIRED ----
            if (!isValidWeek(tourn.startWeek)) {
                report.discarded.push('Tournament has no valid start week');
                return null;
            }
            var startWeek = Number(tourn.startWeek);

            // ---- END WEEK: REQUIRED ----
            if (!isValidWeek(tourn.endWeek)) {
                report.discarded.push('Tournament has no valid end week');
                return null;
            }
            var endWeek = Number(tourn.endWeek);

            if (startWeek > endWeek) {
                report.discarded.push('Start week (' + startWeek + ') is after end week (' + endWeek + ')');
                return null;
            }

            // ---- TOTAL ROUNDS: REQUIRED ----
            var totalRounds = parsePositiveInteger(tourn.totalRounds);
            if (totalRounds === null) {
                report.discarded.push('Tournament has no valid total rounds');
                return null;
            }

            // ---- STATUS: REQUIRED ----
            if (!isValidStatus(tourn.status)) {
                report.discarded.push('Tournament has no valid status');
                return null;
            }
            var status = tourn.status;

            // ---- CREATED AT: Optional, but if present must be valid ----
            var createdAt = null;
            if (tourn.createdAt !== undefined && tourn.createdAt !== null) {
                if (!isStrictDate(tourn.createdAt)) {
                    report.discarded.push('Created at is not a valid ISO 8601 date');
                    return null;
                }
                createdAt = tourn.createdAt;
            }

            // ---- PARTICIPANTS: REQUIRED ARRAY ----
            if (!Array.isArray(tourn.participants)) {
                report.discarded.push('Tournament participants is not an array');
                return null;
            }

            // ---- ROUNDS: REQUIRED ARRAY ----
            if (!Array.isArray(tourn.rounds)) {
                report.discarded.push('Tournament rounds is not an array');
                return null;
            }

            // ---- ELIMINATIONS: REQUIRED ARRAY ----
            if (!Array.isArray(tourn.eliminations)) {
                report.discarded.push('Tournament eliminations is not an array');
                return null;
            }

            // ---- BUILD CANONICAL STRUCTURE ----
            var repaired = {
                id: id,
                name: name,
                mode: mode,
                startWeek: startWeek,
                endWeek: endWeek,
                totalRounds: totalRounds,
                status: status,
                participants: [],
                rounds: [],
                eliminations: [],
                winner: null,
                createdAt: createdAt
            };

            // ---- REPAIR PARTICIPANTS ----
            var tournamentParticipants = [];
            var seenParticipantIds = Object.create(null);

            for (var i = 0; i < tourn.participants.length; i++) {
                var pReport = { discarded: [] };
                var repairedP = repairParticipant(tourn.participants[i], pReport);
                if (repairedP !== null) {
                    if (seenParticipantIds[repairedP.id] === true) {
                        report.discarded.push('Duplicate participant: "' + repairedP.id + '"');
                        return null;
                    }
                    seenParticipantIds[repairedP.id] = true;
                    tournamentParticipants.push(repairedP);
                    repaired.participants.push(repairedP);
                } else {
                    if (pReport.discarded.length > 0) {
                        pReport.discarded.forEach(function(d) {
                            report.discarded.push('Participant ' + (i + 1) + ': ' + d);
                        });
                    }
                    report.discarded.push('Participant ' + (i + 1) + ' could not be repaired');
                    return null;
                }
            }

            var incompatible = repaired.participants.some(function(p) {
                return (repaired.mode === 'teams' && p.type !== 'team') ||
                       (repaired.mode === 'individuals' && p.type !== 'character');
            });
            if (incompatible) {
                report.discarded.push('Participant type incompatible with tournament mode');
                return null;
            }

            // ---- REPAIR ROUNDS ----
            for (var r = 0; r < tourn.rounds.length; r++) {
                var roundReport = { discarded: [] };
                var repairedRound = repairRound(tourn.rounds[r], r, tournamentParticipants, roundReport);
                if (repairedRound !== null) {
                    repaired.rounds.push(repairedRound);
                } else {
                    if (roundReport.discarded.length > 0) {
                        roundReport.discarded.forEach(function(d) {
                            report.discarded.push('Round ' + (r + 1) + ': ' + d);
                        });
                    }
                    report.discarded.push('Round ' + (r + 1) + ' could not be repaired');
                    return null;
                }
            }

            // ---- REPAIR ELIMINATIONS ----
            var seenEliminations = Object.create(null);
            for (var e = 0; e < tourn.eliminations.length; e++) {
                var elimReport = { discarded: [] };
                var repairedE = repairElimination(
                    tourn.eliminations[e],
                    tournamentParticipants,
                    startWeek,
                    endWeek,
                    elimReport
                );
                if (repairedE !== null) {
                    if (seenEliminations[repairedE.participantId] === true) {
                        report.discarded.push('Duplicate elimination for participant: "' + repairedE.participantId + '"');
                        return null;
                    }
                    seenEliminations[repairedE.participantId] = true;
                    repaired.eliminations.push(repairedE);
                } else {
                    if (elimReport.discarded.length > 0) {
                        elimReport.discarded.forEach(function(d) {
                            report.discarded.push('Elimination ' + (e + 1) + ': ' + d);
                        });
                    }
                    report.discarded.push('Elimination ' + (e + 1) + ' could not be repaired');
                    return null;
                }
            }

            // ---- REPAIR WINNER ----
            // Preserve unknown winner properties where schema permits
            if (tourn.winner !== undefined && tourn.winner !== null) {
                if (typeof tourn.winner === 'object' && tourn.winner !== null) {
                    var winnerId = normaliseId(tourn.winner.id);
                    var winnerType = tourn.winner.type;

                    if (winnerId !== null && isValidParticipantType(winnerType)) {
                        var participant = getParticipant(tournamentParticipants, winnerId);
                        if (!participant) {
                            report.discarded.push('Winner "' + winnerId + '" is not a tournament participant');
                            return null;
                        }
                        if (participant.type !== winnerType) {
                            report.discarded.push('Winner type "' + winnerType +
                                '" does not match participant type "' + participant.type + '"');
                            return null;
                        }
                        var isEliminated = repaired.eliminations.some(function(elim) {
                            return elim.participantId === winnerId;
                        });
                        if (isEliminated) {
                            report.discarded.push('Winner "' + winnerId + '" has been eliminated');
                            return null;
                        }

                        // Build winner with known fields
                        var winnerObj = {
                            id: participant.id,
                            type: participant.type
                        };

                        // Preserve unknown winner properties
                        var winnerKnownKeys = ['id', 'type'];
                        Object.keys(tourn.winner).forEach(function(key) {
                            if (winnerKnownKeys.indexOf(key) === -1) {
                                winnerObj[key] = tourn.winner[key];
                            }
                        });

                        repaired.winner = winnerObj;
                    } else {
                        report.discarded.push('Winner has invalid ID or type');
                        return null;
                    }
                } else if (tourn.winner !== undefined && tourn.winner !== null) {
                    // Winner is just an ID - resolve from participants
                    var winnerId = normaliseId(tourn.winner);
                    if (winnerId !== null) {
                        var participant = getParticipant(tournamentParticipants, winnerId);
                        if (!participant) {
                            report.discarded.push('Winner "' + winnerId + '" cannot be resolved to a tournament participant');
                            return null;
                        }
                        var isEliminated = repaired.eliminations.some(function(elim) {
                            return elim.participantId === winnerId;
                        });
                        if (isEliminated) {
                            report.discarded.push('Winner "' + winnerId + '" has been eliminated');
                            return null;
                        }
                        repaired.winner = {
                            id: participant.id,
                            type: participant.type
                        };
                    } else {
                        report.discarded.push('Winner has invalid ID');
                        return null;
                    }
                }
            }

            // ---- PRESERVE UNKNOWN TOP-LEVEL PROPERTIES ----
            var knownTopKeys = [
                'id', 'name', 'mode', 'startWeek', 'endWeek', 'totalRounds',
                'status', 'participants', 'rounds', 'eliminations', 'winner', 'createdAt'
            ];
            Object.keys(tourn).forEach(function(key) {
                if (knownTopKeys.indexOf(key) === -1) {
                    repaired[key] = tourn[key];
                }
            });

            // ---- FINAL VALIDATION ----
            // Repaired object MUST pass strict schema validation
            var finalValidation = Schema.validateTournament(repaired, { strict: true });
            if (!finalValidation.valid) {
                finalValidation.errors.forEach(function(error) {
                    report.discarded.push('Repaired tournament failed strict validation: ' + error);
                });
                return null;
            }

            var originalJson = JSON.stringify(tourn);
            var repairedJson = JSON.stringify(repaired);
            report.repaired = (originalJson !== repairedJson);

            return {
                tournament: repaired,
                report: report
            };
        },

        /**
         * Repair all tournaments in the data store.
         * ATOMIC: either all tournaments are repaired, or none are mutated.
         * Returns detailed repair report with all nested failure reasons preserved.
         */
        repairAllTournaments: function() {
            var data = window.data || {};

            if (!Array.isArray(data.tournaments)) {
                return {
                    total: 0,
                    repaired: 0,
                    unchanged: 0,
                    failed: 1,
                    details: [{
                        index: null,
                        id: 'unknown',
                        status: 'failed',
                        message: 'Tournament data is not an array'
                    }],
                    warnings: [],
                    discarded: ['data.tournaments is not an array']
                };
            }

            var report = {
                total: data.tournaments.length,
                repaired: 0,
                unchanged: 0,
                failed: 0,
                details: [],
                warnings: [],
                discarded: []
            };

            var repairedTournaments = [];
            var hadFailure = false;

            for (var i = 0; i < data.tournaments.length; i++) {
                var original = data.tournaments[i];
                var originalJson = JSON.stringify(original);

                var result = this.repairTournament(original);

                if (result === null) {
                    hadFailure = true;
                    report.failed++;
                    report.details.push({
                        index: i,
                        id: original && original.id ? String(original.id) : 'unknown',
                        status: 'failed',
                        message: 'Tournament could not be repaired'
                    });
                    // The detailed discarded reasons were already logged inside repairTournament
                    // but we preserve them in the aggregate report
                    continue;
                }

                var repaired = result.tournament;
                var innerReport = result.report;

                if (innerReport.warnings.length > 0) {
                    innerReport.warnings.forEach(function(w) {
                        report.warnings.push('Tournament ' + (i + 1) + ': ' + w);
                    });
                }
                if (innerReport.discarded.length > 0) {
                    innerReport.discarded.forEach(function(d) {
                        report.discarded.push('Tournament ' + (i + 1) + ': ' + d);
                    });
                }

                var repairedJson = JSON.stringify(repaired);

                if (originalJson === repairedJson) {
                    report.unchanged++;
                    report.details.push({
                        index: i,
                        id: repaired.id,
                        status: 'unchanged'
                    });
                } else {
                    report.repaired++;
                    report.details.push({
                        index: i,
                        id: repaired.id,
                        status: 'repaired',
                        name: repaired.name,
                        warnings: innerReport.warnings.length,
                        discarded: innerReport.discarded.length
                    });
                }

                repairedTournaments.push(repaired);
            }

            // Only mutate if no failures
            if (!hadFailure) {
                data.tournaments = repairedTournaments;
            }

            return report;
        },

        validateTournament: function(tourn) {
            return Schema.validateTournament(tourn, { strict: false });
        },

        needsRepair: function(tourn) {
            var validation = this.validateTournament(tourn);
            return !validation.valid;
        },

        getRepairSummary: function(report) {
            if (!report) return 'No repair report.';
            var summary = 'Tournaments: ' + report.total +
                ' | Repaired: ' + report.repaired +
                ' | Unchanged: ' + report.unchanged +
                ' | Failed: ' + report.failed;
            if (report.warnings && report.warnings.length > 0) {
                summary += ' | Warnings: ' + report.warnings.length;
            }
            if (report.discarded && report.discarded.length > 0) {
                summary += ' | Discarded: ' + report.discarded.length;
            }
            return summary;
        }
    };

    window.TournamentsRepair = TournamentsRepair;

})();
