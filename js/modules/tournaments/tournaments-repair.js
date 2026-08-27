/**
 * js/modules/tournaments/tournaments-repair.js - Tournament Repair
 * Explicit repair functions for legacy/malformed data.
 * NOT called automatically by getters.
 * Path: js/modules/tournaments/tournaments-repair.js
 */

(function() {
    'use strict';

    if (window.__tournamentsRepairLoaded) return;
    window.__tournamentsRepairLoaded = true;

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function parsePositiveInteger(value) {
        var num = Number(value);
        return Number.isInteger(num) && num >= 1 ? num : null;
    }

    function isValidMode(mode) {
        return mode && ['teams', 'individuals'].indexOf(mode) !== -1;
    }

    function isValidStatus(status) {
        return status && ['draft', 'active', 'completed'].indexOf(status) !== -1;
    }

    function isValidWeek(value) {
        var num = parsePositiveInteger(value);
        return num !== null && num >= 1 && num <= 52;
    }

    var TournamentsRepair = {
        /**
         * Repair a single tournament to canonical form.
         * Does NOT auto-save; caller is responsible for persistence.
         */
        repairTournament: function(tourn) {
            if (!tourn || typeof tourn !== 'object') return null;

            var id = tourn.id;
            if (!id) {
                id = typeof window.generateId === 'function'
                    ? window.generateId('tourn')
                    : 'tourn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
            }

            var repaired = {
                id: id,
                name: String(tourn.name || 'Untitled Tournament').trim(),
                mode: isValidMode(tourn.mode) ? tourn.mode : 'teams',
                startWeek: isValidWeek(tourn.startWeek) ? Number(tourn.startWeek) : 1,
                endWeek: isValidWeek(tourn.endWeek) ? Number(tourn.endWeek) : 52,
                totalRounds: parsePositiveInteger(tourn.totalRounds) || 1,
                status: isValidStatus(tourn.status) ? tourn.status : 'draft',
                currentRound: parsePositiveInteger(tourn.currentRound) || 0,
                participants: Array.isArray(tourn.participants) ? tourn.participants.slice() : [],
                teams: Array.isArray(tourn.teams) ? tourn.teams.slice() : [],
                rounds: Array.isArray(tourn.rounds) ? tourn.rounds.slice() : [],
                matches: Array.isArray(tourn.matches) ? tourn.matches.slice() : [],
                eliminations: Array.isArray(tourn.eliminations) ? tourn.eliminations.slice() : [],
                winners: Array.isArray(tourn.winners) ? tourn.winners.slice() : [],
                winner: tourn.winner || null,
                createdAt: tourn.createdAt || new Date().toISOString()
            };

            // Fix currentRound if out of sync
            if (repaired.currentRound !== repaired.rounds.length) {
                repaired.currentRound = repaired.rounds.length;
            }

            // Fix status if complete
            var allRoundsComplete = repaired.rounds.every(function(r) {
                return r.status === 'completed';
            });

            if (allRoundsComplete && repaired.rounds.length > 0 && repaired.status !== 'completed') {
                repaired.status = 'completed';
            }

            return repaired;
        },

        /**
         * Repair all tournaments in the data store.
         * Returns count of repaired tournaments.
         */
        repairAllTournaments: function() {
            var data = window.data || {};
            if (!Array.isArray(data.tournaments)) {
                data.tournaments = [];
                return 0;
            }

            var repairedCount = 0;
            for (var i = 0; i < data.tournaments.length; i++) {
                var repaired = this.repairTournament(data.tournaments[i]);
                if (repaired) {
                    data.tournaments[i] = repaired;
                    repairedCount++;
                }
            }

            return repairedCount;
        },

        /**
         * Validate a tournament without mutating.
         */
        validateTournament: function(tourn) {
            if (!tourn || typeof tourn !== 'object') {
                return { valid: false, errors: ['Tournament must be an object.'] };
            }

            var errors = [];

            if (!tourn.name || String(tourn.name).trim() === '') {
                errors.push('Name is required.');
            }

            if (!isValidMode(tourn.mode)) {
                errors.push('Invalid mode. Must be "teams" or "individuals".');
            }

            if (!isValidWeek(tourn.startWeek)) {
                errors.push('Start week must be between 1 and 52.');
            }

            if (!isValidWeek(tourn.endWeek)) {
                errors.push('End week must be between 1 and 52.');
            }

            var start = parsePositiveInteger(tourn.startWeek);
            var end = parsePositiveInteger(tourn.endWeek);
            if (start !== null && end !== null && start > end) {
                errors.push('Start week must be before end week.');
            }

            if (!isValidStatus(tourn.status)) {
                errors.push('Invalid status.');
            }

            return { valid: errors.length === 0, errors: errors };
        }
    };

    window.TournamentsRepair = TournamentsRepair;

})();
