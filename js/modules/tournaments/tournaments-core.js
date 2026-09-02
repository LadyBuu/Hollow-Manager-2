/**
 * js/modules/tournaments/tournaments-core.js - Core Tournament Operations
 * CANONICAL mutation API for tournaments.
 */

(function() {
    'use strict';

    // Guard: allow re-initialisation if Schema loads later
    if (window.__tournamentsCoreLoaded) return;

    // ============================================================
    // DEPENDENCIES - Schema is the SOLE source of truth
    // ============================================================

    var Schema = window.TournamentsSchema;
    if (!Schema) {
        console.error('TournamentsCore: TournamentsSchema is required but not loaded.');
        return;
    }

    // Check CALENDAR_CONSTANTS
    var CALENDAR = window.CALENDAR_CONSTANTS || {};
    var MIN_WEEK = Number.isInteger(CALENDAR.MIN_WEEK) ? CALENDAR.MIN_WEEK : 1;
    var MAX_WEEK = Number.isInteger(CALENDAR.MAX_WEEK) ? CALENDAR.MAX_WEEK : 52;

    // Mark as loaded ONLY after Schema is confirmed
    window.__tournamentsCoreLoaded = true;

    // Import from Schema - NO DUPLICATED CONSTANTS OR VALIDATION
    var VALID_MODES = Schema.VALID_MODES;
    var VALID_STATUSES = Schema.VALID_STATUSES;
    var VALID_PARTICIPANT_TYPES = Schema.VALID_PARTICIPANT_TYPES;
    
    // UPDATEABLE_PROPERTIES - includes class fields
    var UPDATEABLE_PROPERTIES = [
        'name', 'mode', 'startWeek', 'endWeek', 'totalRounds', 'status',
        'graduatingClassId', 'classFilterEnabled'
    ];

    var isObject = Schema.isObject;
    var parsePositiveInteger = Schema.parsePositiveInteger;
    var isValidWeek = Schema.isValidWeek;
    var isValidMode = Schema.isValidMode;
    var isValidStatus = Schema.isValidStatus;
    var isValidParticipantType = Schema.isValidParticipantType;
    var isValidMatchType = Schema.isValidMatchType;
    var normaliseId = Schema.normaliseId;

    // ============================================================
    // LIFECYCLE RULE HELPERS
    // ============================================================

    function isStatusMutable(status) {
        return status === 'draft';
    }

    function isStatusParticipantMutable(status) {
        return status === 'draft';
    }

    function isStatusEliminationMutable(status) {
        return status === 'active';
    }

    function isStatusRoundMutable(status) {
        return status === 'draft' || status === 'active';
    }

    function isStatusTerminal(status) {
        return status === 'completed';
    }

    // ============================================================
    // INTERNAL HELPERS
    // ============================================================

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') return null;
        if (!Array.isArray(window.data.tournaments)) return null;
        return window.data;
    }

    function validateTournament(tournament, strict) {
        strict = strict !== false;
        return Schema.validateTournament(tournament, { strict: strict });
    }

    function getValidatedTournament(id, strict) {
        strict = strict === true;
        var tournament = getTournamentInternal(id);
        if (!tournament) return null;
        var validation = validateTournament(tournament, strict);
        if (!validation.valid) return null;
        return tournament;
    }

    function getTournamentInternal(id) {
        var normalisedId = normaliseId(id);
        if (normalisedId === null) return null;
        var data = getDataStore();
        if (!data) return null;
        return data.tournaments.find(function(t) {
            return t && normaliseId(t.id) === normalisedId;
        }) || null;
    }

    function cloneRound(round) {
        if (!round || typeof round !== 'object') return round;
        var copy = Object.assign({}, round);
        if (Array.isArray(round.matches)) {
            copy.matches = round.matches.map(function(match) {
                var matchCopy = Object.assign({}, match);
                if (match.results && typeof match.results === 'object') {
                    matchCopy.results = Object.assign({}, match.results);
                }
                if (match.participants && Array.isArray(match.participants)) {
                    matchCopy.participants = match.participants.slice();
                }
                if (match.advancing && Array.isArray(match.advancing)) {
                    matchCopy.advancing = match.advancing.slice();
                }
                return matchCopy;
            });
        }
        return copy;
    }

    function cloneParticipant(participant) {
        if (!participant || typeof participant !== 'object') return participant;
        return Object.assign({}, participant);
    }

    function cloneElimination(elimination) {
        if (!elimination || typeof elimination !== 'object') return elimination;
        return Object.assign({}, elimination);
    }

    function canonicaliseUpdateValue(key, value) {
        if (key === 'startWeek' || key === 'endWeek' || key === 'totalRounds') {
            var num = Number(value);
            return Number.isFinite(num) ? num : value;
        }
        return value;
    }

    function buildProposedState(tournament, updates) {
        var proposed = Object.assign({}, tournament);
        Object.keys(updates).forEach(function(key) {
            if (updates[key] !== undefined) {
                proposed[key] = canonicaliseUpdateValue(key, updates[key]);
            }
        });
        return proposed;
    }

    function generateUniqueId(appData) {
        var attempts = 0;
        var maxAttempts = 10;
        var id;
        var generated = false;
        var prefix = 'tourn';

        if (window.ID_CONSTANTS && window.ID_CONSTANTS.PREFIXES) {
            prefix = window.ID_CONSTANTS.PREFIXES.TOURNAMENT || 'tourn';
        }

        while (!generated && attempts < maxAttempts) {
            id = typeof window.generateId === 'function'
                ? window.generateId(prefix)
                : prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
            attempts++;

            var normalisedId = normaliseId(id);
            if (normalisedId === null) continue;

            var collision = appData.tournaments.some(function(t) {
                return t && normaliseId(t.id) === normalisedId;
            });

            if (!collision) {
                generated = true;
            }
        }

        if (!generated) return null;
        return normaliseId(id);
    }

    function rebuildEliminatedWeeks(char) {
        if (!char || typeof char !== 'object') {
            return;
        }

        if (!Array.isArray(char.eliminations)) {
            char.eliminatedWeeks = [];
            return;
        }

        var weeks = [];
        var seen = {};

        for (var i = 0; i < char.eliminations.length; i++) {
            var elim = char.eliminations[i];
            if (!elim || typeof elim !== 'object') continue;

            var week = parsePositiveInteger(elim.week);
            if (week === null) continue;

            var key = String(week);
            if (!seen[key]) {
                seen[key] = true;
                weeks.push(week);
            }
        }

        weeks.sort(function(a, b) { return a - b; });
        char.eliminatedWeeks = weeks;
    }

    function buildProposedCharacterState(char, tournamentId, charElimination) {
        var proposedChar = Object.assign({}, char);
        proposedChar.eliminations = char.eliminations ? char.eliminations.slice() : [];
        proposedChar.eliminations.push(charElimination);

        var tempChar = Object.assign({}, proposedChar);
        rebuildEliminatedWeeks(tempChar);
        proposedChar.eliminatedWeeks = tempChar.eliminatedWeeks;

        return proposedChar;
    }

    function isEliminationWeekInBounds(tournament, week) {
        var start = Number(tournament.startWeek);
        var end = Number(tournament.endWeek);
        var weekNum = Number(week);
        return Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(weekNum) &&
            weekNum >= start && weekNum <= end;
    }

    function recordActivity(message) {
        try {
            if (typeof window.logActivity === 'function') {
                window.logActivity(message);
            }
        } catch (err) {
            // Swallow logging errors
        }
    }

    // ============================================================
    // CORE API
    // ============================================================

    var TournamentsCore = {
        VALID_MODES: VALID_MODES,
        VALID_STATUSES: VALID_STATUSES,
        VALID_PARTICIPANT_TYPES: VALID_PARTICIPANT_TYPES,
        Schema: Schema,

        getTournament: function(id) {
            return getTournamentInternal(id);
        },

        getTournaments: function() {
            var data = getDataStore();
            return data ? data.tournaments.slice() : [];
        },

        getAllTournaments: function() {
            return this.getTournaments();
        },

        createTournament: function(data) {
            if (!isObject(data)) return null;

            if (data.name === undefined || data.name === null || String(data.name).trim() === '') {
                return null;
            }
            var name = String(data.name).trim();

            var mode = data.mode !== undefined ? data.mode : 'teams';
            if (!isValidMode(mode)) return null;

            var startWeek = data.startWeek !== undefined ? data.startWeek : MIN_WEEK;
            if (!isValidWeek(startWeek)) return null;

            var endWeek = data.endWeek !== undefined ? data.endWeek : MAX_WEEK;
            if (!isValidWeek(endWeek)) return null;

            var totalRounds = data.totalRounds !== undefined ? data.totalRounds : 1;
            if (parsePositiveInteger(totalRounds) === null) return null;

            var status = data.status !== undefined ? data.status : 'draft';
            if (!isValidStatus(status)) return null;

            if (Number(startWeek) > Number(endWeek)) return null;

            // Class fields
            var graduatingClassId = data.graduatingClassId !== undefined ? data.graduatingClassId : null;
            var classFilterEnabled = data.classFilterEnabled !== false;

            var appData = getDataStore();
            if (!appData) return null;

            var id = generateUniqueId(appData);
            if (id === null) return null;

            var newTournament = {
                id: id,
                name: name,
                mode: mode,
                startWeek: Number(startWeek),
                endWeek: Number(endWeek),
                totalRounds: Number(totalRounds),
                status: status,
                participants: [],
                rounds: [],
                eliminations: [],
                winner: null,
                createdAt: new Date().toISOString(),
                _schemaVersion: Schema.SCHEMA_VERSION,
                graduatingClassId: graduatingClassId,
                classFilterEnabled: classFilterEnabled
            };

            var validation = validateTournament(newTournament, true);
            if (!validation.valid) return null;

            appData.tournaments.push(newTournament);
            recordActivity('Created tournament: ' + newTournament.name);

            return newTournament;
        },

        updateTournament: function(id, updates) {
            if (!isObject(updates)) return null;

            // Reject undefined values
            var hasUndefined = Object.keys(updates).some(function(key) {
                return updates[key] === undefined;
            });
            if (hasUndefined) return null;

            var tournament = getValidatedTournament(id, false);
            if (!tournament) return null;

            // Check if we're updating class fields (always allowed regardless of status)
            var isClassUpdate = Object.keys(updates).every(function(key) {
                return key === 'graduatingClassId' || key === 'classFilterEnabled';
            });

            // For non-class updates, check lifecycle
            if (!isClassUpdate) {
                var isStructuralUpdate = Object.keys(updates).some(function(key) {
                    return ['name', 'mode', 'startWeek', 'endWeek', 'totalRounds'].indexOf(key) !== -1;
                });

                if (isStructuralUpdate) {
                    var onlyNameChange = Object.keys(updates).every(function(key) {
                        return key === 'name';
                    });

                    if (!onlyNameChange && !isStatusMutable(tournament.status)) {
                        return null;
                    }
                }
            }

            // Reject unknown update keys
            var unknownKeys = Object.keys(updates).filter(function(key) {
                return UPDATEABLE_PROPERTIES.indexOf(key) === -1;
            });
            if (unknownKeys.length > 0) return null;

            // Build proposed state
            var proposed = buildProposedState(tournament, updates);

            // Check totalRounds constraint
            if (updates.totalRounds !== undefined) {
                var newTotal = parsePositiveInteger(proposed.totalRounds);
                if (newTotal !== null && Array.isArray(tournament.rounds) && tournament.rounds.length > newTotal) {
                    return null;
                }
            }

            // mode cannot change if participants exist
            if (updates.mode !== undefined && updates.mode !== tournament.mode) {
                if (Array.isArray(tournament.participants) && tournament.participants.length > 0) {
                    return null;
                }
            }

            // Validate proposed against schema (lenient)
            var validation = validateTournament(proposed, false);
            if (!validation.valid) return null;

            // Apply validated updates
            var changes = [];
            var hasChanges = false;

            UPDATEABLE_PROPERTIES.forEach(function(key) {
                if (updates[key] === undefined) return;
                if (tournament[key] !== proposed[key]) {
                    tournament[key] = proposed[key];
                    changes.push(key);
                    hasChanges = true;
                }
            });

            if (hasChanges && changes.length > 0) {
                recordActivity('Updated tournament: ' + tournament.name + ' (' + changes.join(', ') + ')');
            }

            return tournament;
        },

        deleteTournament: function(id) {
            var normalisedId = normaliseId(id);
            if (normalisedId === null) return false;

            var tournament = getValidatedTournament(normalisedId, false);
            if (!tournament) return false;

            var data = getDataStore();
            if (!data) return false;

            var name = tournament.name;
            data.tournaments = data.tournaments.filter(function(t) {
                return t && normaliseId(t.id) !== normalisedId;
            });

            recordActivity('Deleted tournament: ' + name);

            return true;
        },

        addParticipant: function(tournamentId, participant) {
            var id = normaliseId(participant && participant.id);
            if (id === null) return false;

            var tournament = getValidatedTournament(tournamentId, false);
            if (!tournament) return false;

            if (!Array.isArray(tournament.participants)) return false;

            if (!isStatusParticipantMutable(tournament.status)) {
                return false;
            }

            var type = participant.type !== undefined ? participant.type : 'character';
            if (!isValidParticipantType(type)) return false;

            if (tournament.mode === 'teams' && type !== 'team') return false;
            if (tournament.mode === 'individuals' && type !== 'character') return false;

            // Check class filter
            if (tournament.classFilterEnabled !== false && tournament.graduatingClassId) {
                var data = getDataStore();
                if (data && type === 'character') {
                    var char = data.characters.find(function(c) {
                        return c && normaliseId(c.id) === id;
                    });
                    if (char && String(char.graduatingClassId) !== String(tournament.graduatingClassId)) {
                        return false;
                    }
                }
            }

            var data = getDataStore();
            if (!data) return false;

            if (type === 'character') {
                var charExists = Array.isArray(data.characters) &&
                    data.characters.some(function(c) {
                        return c && normaliseId(c.id) === id;
                    });
                if (!charExists) return false;
            } else if (type === 'team') {
                var teamExists = Array.isArray(data.teams) &&
                    data.teams.some(function(t) {
                        return t && normaliseId(t.id) === id;
                    });
                if (!teamExists) return false;
            }

            var exists = tournament.participants.some(function(p) {
                return p && normaliseId(p.id) === id && p.type === type;
            });

            if (exists) return false;

            var proposed = Object.assign({}, tournament);
            proposed.participants = tournament.participants.map(cloneParticipant);
            proposed.participants.push({
                id: id,
                type: type,
                addedAt: new Date().toISOString()
            });

            var validation = validateTournament(proposed, false);
            if (!validation.valid) return false;

            tournament.participants = proposed.participants;
            recordActivity('Added participant to tournament: ' + tournament.name);

            return true;
        },

        removeParticipant: function(tournamentId, participantId) {
            var id = normaliseId(participantId);
            if (id === null) return false;

            var tournament = getValidatedTournament(tournamentId, false);
            if (!tournament || !Array.isArray(tournament.participants)) return false;

            if (!isStatusParticipantMutable(tournament.status)) {
                return false;
            }

            if (Array.isArray(tournament.rounds) && tournament.rounds.length > 0) return false;

            var exists = tournament.participants.some(function(p) {
                return p && normaliseId(p.id) === id;
            });
            if (!exists) return false;

            var proposed = Object.assign({}, tournament);
            proposed.participants = tournament.participants
                .map(cloneParticipant)
                .filter(function(p) {
                    return p && normaliseId(p.id) !== id;
                });

            var validation = validateTournament(proposed, false);
            if (!validation.valid) return false;

            tournament.participants = proposed.participants;
            recordActivity('Removed participant from tournament: ' + tournament.name);

            return true;
        },

        addRound: function(tournamentId, roundData) {
            var tournament = getValidatedTournament(tournamentId, false);
            if (!tournament) return false;

            if (!Array.isArray(tournament.rounds)) return false;

            if (!isStatusRoundMutable(tournament.status)) {
                return false;
            }

            if (tournament.rounds.length >= tournament.totalRounds) return false;

            var matchSize = 2;
            var matchType = 'standard';

            if (roundData && typeof roundData === 'object') {
                if (roundData.matchSize !== undefined) {
                    var size = parsePositiveInteger(roundData.matchSize);
                    if (size === null || size < 2) return false;
                    matchSize = size;
                }

                if (roundData.matchType !== undefined) {
                    if (!isValidMatchType(roundData.matchType)) return false;
                    matchType = roundData.matchType;
                }
            }

            var round = {
                roundNumber: tournament.rounds.length + 1,
                status: 'pending',
                matchSize: matchSize,
                matchType: matchType,
                matches: []
            };

            var proposed = Object.assign({}, tournament);
            proposed.rounds = tournament.rounds.map(cloneRound);
            proposed.rounds.push(round);

            if (proposed.status === 'draft') {
                proposed.status = 'active';
            }

            var validation = validateTournament(proposed, false);
            if (!validation.valid) return false;

            tournament.rounds = proposed.rounds;
            if (proposed.status !== tournament.status) {
                tournament.status = proposed.status;
            }

            recordActivity('Added round ' + round.roundNumber + ' to tournament: ' + tournament.name);

            return true;
        },

        removeRound: function(tournamentId, roundIndex) {
            var index = Number(roundIndex);
            if (!Number.isInteger(index)) return false;

            var tournament = getValidatedTournament(tournamentId, false);
            if (!tournament || !Array.isArray(tournament.rounds)) return false;

            if (index < 0 || index >= tournament.rounds.length) return false;

            if (!isStatusMutable(tournament.status)) {
                return false;
            }

            var proposed = Object.assign({}, tournament);
            proposed.rounds = tournament.rounds
                .filter(function(_, idx) {
                    return idx !== index;
                })
                .map(function(round, idx) {
                    var copy = cloneRound(round);
                    copy.roundNumber = idx + 1;
                    return copy;
                });

            if (proposed.rounds.length === 0) {
                proposed.status = 'draft';
                proposed.winner = null;
            }

            var validation = validateTournament(proposed, false);
            if (!validation.valid) return false;

            var removedRound = tournament.rounds[index];
            tournament.rounds = proposed.rounds;
            tournament.status = proposed.status;
            tournament.winner = proposed.winner;

            var roundNum = removedRound ? removedRound.roundNumber : index + 1;
            recordActivity('Removed round ' + roundNum + ' from tournament: ' + tournament.name);

            return true;
        },

        markCharacterEliminated: function(tournamentId, characterId, week, reason) {
            if (!isValidWeek(week)) return false;
            var weekNum = Number(week);

            var eliminationReason;
            if (reason === undefined) {
                eliminationReason = 'Eliminated from tournament';
            } else {
                if (typeof reason !== 'string') return false;
                eliminationReason = reason;
            }

            var id = normaliseId(characterId);
            if (id === null) return false;

            var tournament = getValidatedTournament(tournamentId, false);
            if (!tournament) return false;

            if (!Array.isArray(tournament.eliminations)) return false;

            if (!isStatusEliminationMutable(tournament.status)) {
                return false;
            }

            if (!isEliminationWeekInBounds(tournament, weekNum)) {
                return false;
            }

            var data = getDataStore();
            if (!data || !Array.isArray(data.characters)) return false;

            var char = data.characters.find(function(c) {
                return c && normaliseId(c.id) === id;
            });

            if (!char) return false;

            if (!Array.isArray(char.eliminations)) return false;

            var isParticipant = Array.isArray(tournament.participants) &&
                tournament.participants.some(function(p) {
                    return p &&
                        p.type === 'character' &&
                        normaliseId(p.id) === id;
                });

            if (!isParticipant) return false;

            var exists = tournament.eliminations.some(function(e) {
                return e && normaliseId(e.participantId) === id;
            });

            if (exists) return false;

            var tournamentIdNormalised = normaliseId(tournamentId);

            var charElimination = {
                tournamentId: tournamentIdNormalised,
                week: weekNum,
                reason: eliminationReason,
                standalone: false,
                fromMatch: true
            };

            var proposedChar = buildProposedCharacterState(char, tournamentIdNormalised, charElimination);

            if (!Array.isArray(proposedChar.eliminations)) {
                return false;
            }

            var dupCheck = proposedChar.eliminations.filter(function(e) {
                return e && !e.standalone && normaliseId(e.tournamentId) === tournamentIdNormalised;
            });
            if (dupCheck.length > 1) {
                return false;
            }

            var tournamentElimination = {
                participantId: id,
                participantType: 'character',
                week: weekNum,
                reason: eliminationReason
            };

            var proposedTournament = Object.assign({}, tournament);
            proposedTournament.eliminations = tournament.eliminations.map(cloneElimination);
            proposedTournament.eliminations.push(tournamentElimination);

            var validation = validateTournament(proposedTournament, false);
            if (!validation.valid) return false;

            tournament.eliminations = proposedTournament.eliminations;
            char.eliminations = proposedChar.eliminations;
            char.eliminatedWeeks = proposedChar.eliminatedWeeks;

            recordActivity('Eliminated character from tournament: ' + tournament.name);

            return true;
        },

        unmarkCharacterEliminated: function(tournamentId, characterId) {
            var id = normaliseId(characterId);
            if (id === null) return false;

            var tournament = getValidatedTournament(tournamentId, false);
            if (!tournament || !Array.isArray(tournament.eliminations)) return false;

            if (!isStatusEliminationMutable(tournament.status)) {
                return false;
            }

            var data = getDataStore();
            if (!data || !Array.isArray(data.characters)) return false;

            var char = data.characters.find(function(c) {
                return c && normaliseId(c.id) === id;
            });

            if (!char || !Array.isArray(char.eliminations)) return false;

            var tournamentIdNormalised = normaliseId(tournamentId);

            var elimToRemove = tournament.eliminations.find(function(e) {
                return e &&
                    e.participantType === 'character' &&
                    normaliseId(e.participantId) === id;
            });

            if (!elimToRemove) return false;

            var charElimExists = char.eliminations.some(function(e) {
                return e && !e.standalone && normaliseId(e.tournamentId) === tournamentIdNormalised;
            });

            if (!charElimExists) return false;

            var proposedChar = Object.assign({}, char);
            proposedChar.eliminations = char.eliminations.filter(function(e) {
                return !(e && !e.standalone && normaliseId(e.tournamentId) === tournamentIdNormalised);
            });
            rebuildEliminatedWeeks(proposedChar);

            var proposedTournament = Object.assign({}, tournament);
            proposedTournament.eliminations = tournament.eliminations
                .map(cloneElimination)
                .filter(function(e) {
                    return !(e && e.participantType === 'character' && normaliseId(e.participantId) === id);
                });

            var validation = validateTournament(proposedTournament, false);
            if (!validation.valid) return false;

            tournament.eliminations = proposedTournament.eliminations;
            char.eliminations = proposedChar.eliminations;
            char.eliminatedWeeks = proposedChar.eliminatedWeeks;

            recordActivity('Restored character from tournament: ' + tournament.name);

            return true;
        },

        isComplete: function(tournamentId) {
            var tournament = getTournamentInternal(tournamentId);
            if (!tournament) return false;
            return Schema.isTournamentComplete(tournament);
        },

        completeTournament: function(tournamentId, force) {
            force = force === true;

            var tournament = getValidatedTournament(tournamentId, false);
            if (!tournament) return false;

            if (!isStatusEliminationMutable(tournament.status)) {
                return false;
            }

            if (tournament.status === 'completed') return false;

            if (!force) {
                if (!Schema.isTournamentComplete(tournament)) return false;
            }

            var proposed = Object.assign({}, tournament);
            proposed.status = 'completed';

            var validation = validateTournament(proposed, false);
            if (!validation.valid) return false;

            tournament.status = proposed.status;
            recordActivity('Completed tournament: ' + tournament.name);

            return true;
        },

        // ============================================================
        // DELEGATED SCHEMA HELPERS
        // ============================================================

        getParticipantType: function(tournament, participantId) {
            return Schema.getParticipantType(tournament, participantId);
        },

        isParticipantInTournament: function(tournament, participantId) {
            return Schema.isParticipantInTournament(tournament, participantId);
        },

        getParticipants: function(tournament) {
            return Schema.getParticipants(tournament);
        },

        getActiveParticipants: function(tournament) {
            return Schema.getActiveParticipants(tournament);
        },

        isParticipantEliminated: function(tournament, participantId) {
            return Schema.isParticipantEliminated(tournament, participantId);
        },

        validateTournament: function(tournament, strict) {
            strict = strict !== false;
            return Schema.validateTournament(tournament, { strict: strict });
        },

        getValidationReport: function(tournament) {
            return Schema.getValidationReport(tournament);
        },

        getCurrentRound: function(tournament) {
            return Schema.getCurrentRound(tournament);
        },

        getLifecycleStatus: function(tournament) {
            if (!tournament) {
                return { status: 'unknown', mutable: false };
            }
            return {
                status: tournament.status,
                mutable: isStatusMutable(tournament.status),
                participantMutable: isStatusParticipantMutable(tournament.status),
                eliminationMutable: isStatusEliminationMutable(tournament.status),
                roundMutable: isStatusRoundMutable(tournament.status),
                terminal: isStatusTerminal(tournament.status)
            };
        }
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentsCore = TournamentsCore;

})();
