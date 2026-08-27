/**
 * js/modules/tournaments/tournaments-core.js - Core Tournament Operations
 * CANONICAL mutation API for tournaments.
 * 
 * MUTATION PHILOSOPHY:
 *   - Caller is responsible for persistence (saveData)
 *   - Invalid inputs are REJECTED (operation returns null/false)
 *   - Mutations are ATOMIC: if any part is invalid, nothing changes
 *   - Malformed existing data is NOT silently repaired
 *   - Getters do NOT mutate data
 * 
 * PERSISTENCE CONTRACT:
 *   - This module does NOT call saveData()
 *   - Callers own persistence
 */

(function() {
    'use strict';

    if (window.__tournamentsCoreLoaded) return;
    window.__tournamentsCoreLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_MODES = ['teams', 'individuals'];
    var VALID_STATUSES = ['draft', 'active', 'completed'];
    var UPDATEABLE_PROPERTIES = [
        'name', 'mode', 'startWeek', 'endWeek', 'totalRounds', 'status'
    ];

    // ============================================================
    // VALIDATION HELPERS
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

    function isValidMode(mode) {
        return mode && VALID_MODES.indexOf(mode) !== -1;
    }

    function isValidStatus(status) {
        return status && VALID_STATUSES.indexOf(status) !== -1;
    }

    function hasValue(value) {
        return value !== undefined && value !== null && String(value).trim() !== '';
    }

    function getDataStore() {
        if (!window.data || typeof window.data !== 'object') return null;
        if (!Array.isArray(window.data.tournaments)) return null;
        return window.data;
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    function validateTournament(tournament, isUpdate) {
        var errors = [];

        if (!isUpdate || tournament.name !== undefined) {
            if (!isNonEmptyString(tournament.name)) {
                errors.push('Tournament name is required.');
            }
        }

        if (tournament.mode !== undefined && !isValidMode(tournament.mode)) {
            errors.push('Invalid tournament mode. Must be "teams" or "individuals".');
        }

        if (tournament.startWeek !== undefined && tournament.startWeek !== null && tournament.startWeek !== '') {
            if (!isValidWeek(tournament.startWeek)) {
                errors.push('Start week must be between 1 and 52.');
            }
        }

        if (tournament.endWeek !== undefined && tournament.endWeek !== null && tournament.endWeek !== '') {
            if (!isValidWeek(tournament.endWeek)) {
                errors.push('End week must be between 1 and 52.');
            }
        }

        if (tournament.totalRounds !== undefined && tournament.totalRounds !== null && tournament.totalRounds !== '') {
            var rounds = parsePositiveInteger(tournament.totalRounds);
            if (rounds === null) {
                errors.push('Total rounds must be a positive integer.');
            }
        }

        if (tournament.status !== undefined && !isValidStatus(tournament.status)) {
            errors.push('Invalid tournament status.');
        }

        // Validate week range
        var start = parsePositiveInteger(tournament.startWeek);
        var end = parsePositiveInteger(tournament.endWeek);
        if (start !== null && end !== null && start > end) {
            errors.push('Start week must be before or equal to end week.');
        }

        return { valid: errors.length === 0, errors: errors };
    }

    // ============================================================
    // CORE API
    // ============================================================

    var TournamentsCore = {
        // Constants exposed for callers
        VALID_MODES: VALID_MODES,
        VALID_STATUSES: VALID_STATUSES,

        /**
         * Get a tournament by ID. PURE.
         */
        getTournament: function(id) {
            if (!id) return null;
            var data = getDataStore();
            if (!data) return null;
            return data.tournaments.find(function(t) {
                return t && String(t.id) === String(id);
            }) || null;
        },

        /**
         * Get all tournaments. PURE - returns shallow copy.
         * Objects are live references; do not mutate them directly.
         */
        getTournaments: function() {
            var data = getDataStore();
            return data ? data.tournaments.slice() : [];
        },

        /**
         * Create a tournament. Atomic.
         */
        createTournament: function(data) {
            if (!isObject(data)) {
                console.warn('TournamentsCore.createTournament: Data must be an object.');
                return null;
            }

            var tournament = {
                name: String(data.name || '').trim(),
                mode: isValidMode(data.mode) ? data.mode : 'teams',
                startWeek: isValidWeek(data.startWeek) ? Number(data.startWeek) : 1,
                endWeek: isValidWeek(data.endWeek) ? Number(data.endWeek) : 52,
                totalRounds: parsePositiveInteger(data.totalRounds) || 1,
                status: isValidStatus(data.status) ? data.status : 'draft'
            };

            var validation = validateTournament(tournament, false);
            if (!validation.valid) {
                console.warn('TournamentsCore.createTournament:', validation.errors.join(', '));
                return null;
            }

            var appData = getDataStore();
            if (!appData) {
                console.warn('TournamentsCore.createTournament: Data store unavailable.');
                return null;
            }

            var newTournament = {
                id: typeof window.generateId === 'function'
                    ? window.generateId('tourn')
                    : 'tourn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
                name: tournament.name,
                mode: tournament.mode,
                startWeek: tournament.startWeek,
                endWeek: tournament.endWeek,
                totalRounds: tournament.totalRounds,
                currentRound: 0,
                status: tournament.status,
                participants: [],
                teams: [],
                rounds: [],
                matches: [],
                eliminations: [],
                winners: [],
                winner: null,
                createdAt: new Date().toISOString()
            };

            appData.tournaments.push(newTournament);

            if (typeof window.logActivity === 'function') {
                window.logActivity('Created tournament: ' + newTournament.name);
            }

            return newTournament;
        },

        /**
         * Update a tournament. Atomic: validates the COMPLETE proposed state.
         */
        updateTournament: function(id, updates) {
            if (!isObject(updates)) {
                console.warn('TournamentsCore.updateTournament: Updates must be an object.');
                return null;
            }

            var tournament = this.getTournament(id);
            if (!tournament) {
                console.warn('TournamentsCore.updateTournament: Tournament not found.');
                return null;
            }

            // Build proposed state
            var proposed = Object.assign({}, tournament);
            UPDATEABLE_PROPERTIES.forEach(function(key) {
                if (updates[key] !== undefined) {
                    proposed[key] = updates[key];
                }
            });

            // Validate proposed state
            var validation = validateTournament(proposed, false);
            if (!validation.valid) {
                console.warn('TournamentsCore.updateTournament:', validation.errors.join(', '));
                return null;
            }

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

            if (hasChanges && typeof window.logActivity === 'function') {
                window.logActivity('Updated tournament: ' + tournament.name + ' (' + changes.join(', ') + ')');
            }

            return tournament;
        },

        /**
         * Delete a tournament permanently.
         */
        deleteTournament: function(id) {
            var tournament = this.getTournament(id);
            if (!tournament) return false;

            var data = getDataStore();
            if (!data) return false;

            var name = tournament.name;
            data.tournaments = data.tournaments.filter(function(t) {
                return t && String(t.id) !== String(id);
            });

            if (typeof window.logActivity === 'function') {
                window.logActivity('Deleted tournament: ' + name);
            }

            return true;
        },

        /**
         * Add a participant. Atomic.
         */
        addParticipant: function(tournamentId, participant) {
            if (!participant || !participant.id) {
                console.warn('TournamentsCore.addParticipant: Participant ID required.');
                return false;
            }

            var tournament = this.getTournament(tournamentId);
            if (!tournament) {
                console.warn('TournamentsCore.addParticipant: Tournament not found.');
                return false;
            }

            if (!Array.isArray(tournament.participants)) {
                console.warn('TournamentsCore.addParticipant: Malformed participants data.');
                return false;
            }

            var type = participant.type || 'character';
            if (!isValidMode(type) && type !== 'character' && type !== 'team') {
                console.warn('TournamentsCore.addParticipant: Invalid participant type.');
                return false;
            }

            // Check if already exists
            var exists = tournament.participants.some(function(p) {
                return p && String(p.id) === String(participant.id);
            });

            if (exists) {
                console.warn('TournamentsCore.addParticipant: Participant already in tournament.');
                return false;
            }

            tournament.participants.push({
                id: String(participant.id),
                type: type === 'team' ? 'team' : 'character',
                addedAt: new Date().toISOString()
            });

            if (typeof window.logActivity === 'function') {
                window.logActivity('Added participant to tournament: ' + tournament.name);
            }

            return true;
        },

        /**
         * Remove a participant. Does NOT clean up matches/eliminations.
         */
        removeParticipant: function(tournamentId, participantId) {
            var tournament = this.getTournament(tournamentId);
            if (!tournament || !Array.isArray(tournament.participants)) return false;

            var originalLength = tournament.participants.length;
            tournament.participants = tournament.participants.filter(function(p) {
                return p && String(p.id) !== String(participantId);
            });

            if (tournament.participants.length === originalLength) return false;

            if (typeof window.logActivity === 'function') {
                window.logActivity('Removed participant from tournament: ' + tournament.name);
            }

            return true;
        },

        /**
         * Add a round. Validates matchSize and matchType.
         */
        addRound: function(tournamentId, roundData) {
            var tournament = this.getTournament(tournamentId);
            if (!tournament) {
                console.warn('TournamentsCore.addRound: Tournament not found.');
                return false;
            }

            if (!Array.isArray(tournament.rounds)) {
                console.warn('TournamentsCore.addRound: Malformed rounds data.');
                return false;
            }

            if (tournament.rounds.length >= tournament.totalRounds) {
                console.warn('TournamentsCore.addRound: Maximum rounds reached.');
                return false;
            }

            var matchSize = 2;
            var matchType = 'standard';

            if (roundData && typeof roundData === 'object') {
                var size = parsePositiveInteger(roundData.matchSize);
                if (size !== null) matchSize = size;

                var type = roundData.matchType;
                if (type === 'standard' || type === 'group_exam') {
                    matchType = type;
                }
            }

            var round = {
                roundNumber: tournament.rounds.length + 1,
                status: 'pending',
                matchSize: matchSize,
                matchType: matchType,
                matches: []
            };

            tournament.rounds.push(round);

            // Update currentRound to 1-based index
            tournament.currentRound = tournament.rounds.length;

            // Auto-activate if draft
            if (tournament.status === 'draft') {
                tournament.status = 'active';
            }

            if (typeof window.logActivity === 'function') {
                window.logActivity('Added round ' + round.roundNumber + ' to tournament: ' + tournament.name);
            }

            return true;
        },

        /**
         * Remove a round. Re-numbers remaining rounds.
         */
        removeRound: function(tournamentId, roundIndex) {
            var tournament = this.getTournament(tournamentId);
            if (!tournament || !Array.isArray(tournament.rounds)) return false;

            if (roundIndex < 0 || roundIndex >= tournament.rounds.length) {
                console.warn('TournamentsCore.removeRound: Invalid round index.');
                return false;
            }

            tournament.rounds.splice(roundIndex, 1);

            // Re-number rounds
            tournament.rounds.forEach(function(r, idx) {
                r.roundNumber = idx + 1;
            });

            // Update currentRound
            tournament.currentRound = tournament.rounds.length;

            if (tournament.rounds.length === 0) {
                tournament.status = 'draft';
                tournament.winner = null;
                tournament.winners = [];
            }

            if (typeof window.logActivity === 'function') {
                window.logActivity('Removed round from tournament: ' + tournament.name);
            }

            return true;
        },

        /**
         * Mark character eliminated. Atomic: validates before mutating.
         * Verifies character exists and is a participant.
         */
        markCharacterEliminated: function(tournamentId, characterId, week, reason) {
            // Validate character exists
            var data = getDataStore();
            if (!data || !Array.isArray(data.characters)) {
                console.warn('TournamentsCore.markCharacterEliminated: Character data unavailable.');
                return false;
            }

            var char = data.characters.find(function(c) {
                return c && String(c.id) === String(characterId);
            });

            if (!char) {
                console.warn('TournamentsCore.markCharacterEliminated: Character not found.');
                return false;
            }

            var tournament = this.getTournament(tournamentId);
            if (!tournament) {
                console.warn('TournamentsCore.markCharacterEliminated: Tournament not found.');
                return false;
            }

            if (!Array.isArray(tournament.eliminations)) {
                console.warn('TournamentsCore.markCharacterEliminated: Malformed eliminations data.');
                return false;
            }

            // Verify character is a participant
            var isParticipant = Array.isArray(tournament.participants) &&
                tournament.participants.some(function(p) {
                    return p && String(p.id) === String(characterId);
                });

            if (!isParticipant) {
                console.warn('TournamentsCore.markCharacterEliminated: Character is not a participant.');
                return false;
            }

            var weekNum = parsePositiveInteger(week);
            if (weekNum === null) {
                console.warn('TournamentsCore.markCharacterEliminated: Invalid week.');
                return false;
            }

            // Check if already eliminated from this tournament
            var exists = tournament.eliminations.some(function(e) {
                return e && String(e.participantId) === String(characterId);
            });

            if (exists) {
                console.warn('TournamentsCore.markCharacterEliminated: Already eliminated.');
                return false;
            }

            // Mutate tournament
            tournament.eliminations.push({
                participantId: String(characterId),
                participantType: 'character',
                week: weekNum,
                reason: reason || 'Eliminated from tournament'
            });

            // Mutate character
            if (!Array.isArray(char.eliminations)) {
                char.eliminations = [];
            }

            var charExists = char.eliminations.some(function(e) {
                return e && !e.standalone && String(e.tournamentId) === String(tournamentId);
            });

            if (!charExists) {
                char.eliminations.push({
                    tournamentId: tournamentId,
                    week: weekNum,
                    reason: reason || 'Eliminated from tournament',
                    standalone: false,
                    fromMatch: true
                });
                // Rebuild eliminatedWeeks (requires external helper)
                if (typeof window.rebuildEliminatedWeeks === 'function') {
                    window.rebuildEliminatedWeeks(char);
                }
            }

            if (typeof window.logActivity === 'function') {
                window.logActivity('Eliminated character from tournament: ' + tournament.name);
            }

            return true;
        },

        /**
         * Unmark character eliminated.
         */
        unmarkCharacterEliminated: function(tournamentId, characterId) {
            var tournament = this.getTournament(tournamentId);
            if (!tournament || !Array.isArray(tournament.eliminations)) return false;

            var originalLength = tournament.eliminations.length;

            tournament.eliminations = tournament.eliminations.filter(function(e) {
                return e && String(e.participantId) !== String(characterId);
            });

            if (tournament.eliminations.length === originalLength) return false;

            // Remove from character
            var data = getDataStore();
            if (data && Array.isArray(data.characters)) {
                var char = data.characters.find(function(c) {
                    return c && String(c.id) === String(characterId);
                });

                if (char && Array.isArray(char.eliminations)) {
                    char.eliminations = char.eliminations.filter(function(e) {
                        return !(e && !e.standalone && String(e.tournamentId) === String(tournamentId));
                    });
                    if (typeof window.rebuildEliminatedWeeks === 'function') {
                        window.rebuildEliminatedWeeks(char);
                    }
                }
            }

            if (typeof window.logActivity === 'function') {
                window.logActivity('Restored character from tournament: ' + tournament.name);
            }

            return true;
        }
    };

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentsCore = TournamentsCore;

})();
