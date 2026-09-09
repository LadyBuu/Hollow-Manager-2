/**
 * modules/tournaments/tournament-aggregator.js - Tournament Aggregator
 * Cross-domain projection builder for tournament UI
 * Path: js/modules/tournaments/tournament-aggregator.js
 * 
 * This module provides Tournament-specific projections by composing
 * data from TournamentQueries, CharacterQueries, TeamQueries, and AcademyQueries.
 * 
 * IMPORTANT:
 *   - Projection builder, not a query registry
 *   - Composes TournamentQueries + CharacterQueries + TeamQueries + AcademyQueries
 *   - Returns Tournament-shaped view models for UI
 *   - Never exposes external query APIs directly
 *   - Never mutates data
 *   - No UI dependencies
 *   - No passthrough methods
 *   - This is where name resolution happens (getParticipantName, getWinnerName)
 * 
 * API:
 *   - getTournamentViewModel(tournamentId, options)
 *   - getTournamentListViewModel(options)
 *   - getRoundViewModel(tournamentId, roundIndex, options)
 *   - getMatchViewModel(tournamentId, roundIndex, matchIndex, options)
 *   - getParticipantName(tournamentId, participantId)
 *   - getWinnerName(tournamentId)
 *   - getParticipantDisplay(tournamentId, participantId)
 *   - getMatchDisplay(tournamentId, roundIndex, matchIndex)
 *   - getTournamentOverview(tournamentId)
 *   - getActiveTournamentsViewModel()
 * 
 * DEPENDENCIES:
 *   - window.TournamentQueries (from tournament-queries.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.TeamQueries (from team-queries.js) - MANDATORY
 *   - window.AcademyQueries (from academy-queries.js) - MANDATORY
 *   - window.TournamentConstants (from tournament-constants.js) - MANDATORY
 * 
 * USAGE:
 *   var Agg = window.TournamentAggregator;
 *   var vm = Agg.getTournamentViewModel('tourn_123');
 *   var name = Agg.getParticipantName('tourn_123', 'char_456');
 *   var winner = Agg.getWinnerName('tourn_123');
 */

(function() {
    'use strict';

    if (window.__tournamentAggregatorLoaded) {
        return;
    }

    // ============================================================
    // LAZY LOADING HELPERS
    // ============================================================

    function getTournamentQueries() {
        return window.TournamentQueries || null;
    }

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    function getTeamQueries() {
        return window.TeamQueries || null;
    }

    function getAcademyQueries() {
        return window.AcademyQueries || null;
    }

    function getConstants() {
        return window.TournamentConstants || null;
    }

    function getObjectUtils() {
        return window.ObjectUtils || null;
    }

    // ============================================================
    // DEPENDENCY CHECK - Warns but doesn't fail
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!getTournamentQueries()) {
            missing.push('TournamentQueries (lazy)');
        }
        if (!getCharacterQueries()) {
            missing.push('CharacterQueries (lazy)');
        }
        if (!getTeamQueries()) {
            missing.push('TeamQueries (lazy)');
        }
        if (!getAcademyQueries()) {
            missing.push('AcademyQueries (lazy)');
        }
        if (!getConstants()) {
            missing.push('TournamentConstants (lazy)');
        }

        if (missing.length > 0) {
            console.warn('[TournamentAggregator] Some dependencies not yet loaded:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

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

    function getCharacterDisplayName(characterId) {
        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) {
            return 'Unknown';
        }
        var char = CharacterQueries.getCharacterById(characterId);
        if (!char) {
            return 'Unknown';
        }
        return CharacterQueries.getDisplayName(char);
    }

    function getTeamName(teamId) {
        var TeamQueries = getTeamQueries();
        if (!TeamQueries) {
            return 'Unknown Team';
        }
        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return 'Unknown Team';
        }
        return team.name || 'Unknown Team';
    }

    function getAcademyClassDisplayName(classId) {
        var AcademyQueries = getAcademyQueries();
        if (!AcademyQueries || !classId) {
            return '';
        }
        return AcademyQueries.getClassDisplayName(classId) || '';
    }

    function getParticipantTypeName(type) {
        if (type === 'character') {
            return 'Character';
        }
        if (type === 'team') {
            return 'Team';
        }
        return 'Unknown';
    }

    function getOutcomeDisplay(outcome) {
        var map = {
            'winner': { text: '★', class: 'outcome-winner', label: 'Winner' },
            'advancing': { text: '→', class: 'outcome-advancing', label: 'Advancing' },
            'eliminated': { text: '✘', class: 'outcome-eliminated', label: 'Eliminated' },
            'passed': { text: '✓', class: 'outcome-passed', label: 'Passed' },
            'failed': { text: '✗', class: 'outcome-failed', label: 'Failed' },
            'pending': { text: '⏳', class: 'outcome-pending', label: 'Pending' },
            'unknown': { text: '?', class: 'outcome-unknown', label: 'Unknown' }
        };
        return map[outcome] || { text: '?', class: 'outcome-unknown', label: 'Unknown' };
    }

    function getStatusDisplay(status) {
        var map = {
            'draft': { text: 'Draft', class: 'status-draft' },
            'active': { text: 'Active', class: 'status-active' },
            'completed': { text: 'Completed', class: 'status-completed' }
        };
        return map[status] || { text: status || 'Unknown', class: 'status-unknown' };
    }

    function getMatchStatusDisplay(status) {
        var map = {
            'pending': { text: 'Pending', class: 'match-status-pending' },
            'in_progress': { text: 'In Progress', class: 'match-status-in-progress' },
            'completed': { text: 'Completed', class: 'match-status-completed' }
        };
        return map[status] || { text: status || 'Unknown', class: 'match-status-unknown' };
    }

    function getCanonicalParticipantType(mode) {
        var Constants = getConstants();
        if (Constants && typeof Constants.getCanonicalParticipantType === 'function') {
            return Constants.getCanonicalParticipantType(mode);
        }
        return mode === 'teams' ? 'team' : 'character';
    }

    function getParticipantTypeLabel(type) {
        if (type === 'character') {
            return 'Character';
        }
        if (type === 'team') {
            return 'Team';
        }
        return 'Unknown';
    }

    function getParticipantDisplayName(tournamentId, participantId) {
        var Queries = getTournamentQueries();
        if (!Queries) {
            return 'Unknown';
        }

        var participantType = Queries.getParticipantTypeFromRecord(tournamentId, participantId);

        if (participantType === 'character') {
            return getCharacterDisplayName(participantId);
        }
        if (participantType === 'team') {
            return getTeamName(participantId);
        }

        return 'Unknown';
    }

    function getMatchOutcome(participantId, match) {
        if (!match || !participantId) {
            return 'unknown';
        }

        if (match.type === 'group_exam') {
            var resultValue = match.results && match.results[participantId];
            if (resultValue === 'pass') {
                return 'passed';
            }
            if (resultValue === 'fail') {
                return 'failed';
            }
            if (match.status === 'completed') {
                return 'unknown';
            }
            return 'pending';
        }

        // Standard match
        if (match.winner && String(match.winner) === String(participantId)) {
            return 'winner';
        }
        if (match.loser && String(match.loser) === String(participantId)) {
            return 'eliminated';
        }
        if (match.advancing && match.advancing.indexOf(participantId) !== -1) {
            return 'advancing';
        }
        if (match.status === 'completed') {
            return 'unknown';
        }
        return 'pending';
    }

    // ============================================================
    // CORE PROJECTIONS
    // ============================================================

    /**
     * Get a complete tournament view model for UI display.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {object} options - Options
     * @param {boolean} options.includeParticipants - Include participant details (default: true)
     * @param {boolean} options.includeRounds - Include rounds with matches (default: true)
     * @param {boolean} options.includeEliminations - Include eliminations (default: true)
     * @param {boolean} options.includeWinner - Include winner details (default: true)
     * @param {boolean} options.includeStatistics - Include statistics (default: true)
     * @returns {object|null} Tournament view model or null
     */
    function getTournamentViewModel(tournamentId, options) {
        options = options || {};

        var Queries = getTournamentQueries();
        if (!Queries) {
            return null;
        }

        var tournament = Queries.getTournament(tournamentId);
        if (!tournament) {
            return null;
        }

        var includeParticipants = options.includeParticipants !== false;
        var includeRounds = options.includeRounds !== false;
        var includeEliminations = options.includeEliminations !== false;
        var includeWinner = options.includeWinner !== false;
        var includeStatistics = options.includeStatistics !== false;

        var viewModel = {
            id: tournament.id,
            name: tournament.name,
            mode: tournament.mode,
            modeLabel: tournament.mode === 'teams' ? 'Teams' : 'Individuals',
            startWeek: tournament.startWeek,
            endWeek: tournament.endWeek,
            totalRounds: tournament.totalRounds,
            status: tournament.status,
            statusDisplay: getStatusDisplay(tournament.status),
            graduatingClassId: tournament.graduatingClassId || null,
            graduatingClassName: tournament.graduatingClassId ? getAcademyClassDisplayName(tournament.graduatingClassId) : '',
            classFilterEnabled: tournament.classFilterEnabled || false,
            createdAt: tournament.createdAt
        };

        // Participants
        if (includeParticipants) {
            var participants = Queries.getParticipants(tournamentId);
            viewModel.participants = participants.map(function(p) {
                return {
                    id: p.id,
                    type: p.type,
                    typeLabel: getParticipantTypeLabel(p.type),
                    name: getParticipantDisplayName(tournamentId, p.id),
                    eliminated: Queries.isParticipantEliminated(tournamentId, p.id),
                    addedAt: p.addedAt || null
                };
            });
            viewModel.participantCount = viewModel.participants.length;
        }

        // Rounds
        if (includeRounds) {
            var rounds = Queries.getRounds(tournamentId);
            viewModel.rounds = rounds.map(function(round, index) {
                var matches = Queries.getMatches(tournamentId, index);
                return {
                    index: index,
                    roundNumber: round.roundNumber || (index + 1),
                    status: round.status || 'pending',
                    statusDisplay: getMatchStatusDisplay(round.status || 'pending'),
                    matchSize: round.matchSize || 2,
                    matchType: round.matchType || 'standard',
                    matchTypeLabel: round.matchType === 'group_exam' ? 'Group Exam' : 'Standard',
                    matches: matches.map(function(match, matchIndex) {
                        return getMatchViewModel(tournamentId, index, matchIndex, {
                            includeParticipants: true
                        });
                    }),
                    matchCount: matches.length
                };
            });
            viewModel.roundCount = viewModel.rounds.length;
        }

        // Eliminations
        if (includeEliminations) {
            var eliminations = Queries.getEliminations(tournamentId);
            viewModel.eliminations = eliminations.map(function(e) {
                return {
                    participantId: e.participantId,
                    participantType: e.participantType,
                    participantName: getParticipantDisplayName(tournamentId, e.participantId),
                    week: e.week,
                    reason: e.reason || 'Eliminated',
                    standalone: e.standalone || false
                };
            });
            viewModel.eliminationCount = viewModel.eliminations.length;
        }

        // Winner
        if (includeWinner) {
            var winner = Queries.getWinner(tournamentId);
            if (winner) {
                viewModel.winner = {
                    id: winner.id,
                    type: winner.type,
                    typeLabel: getParticipantTypeLabel(winner.type),
                    name: getParticipantDisplayName(tournamentId, winner.id)
                };
            } else {
                viewModel.winner = null;
            }
            viewModel.hasWinner = !!viewModel.winner;
        }

        // Statistics
        if (includeStatistics) {
            viewModel.statistics = Queries.getTournamentStatistics(tournamentId);
        }

        return viewModel;
    }

    // ============================================================
    // LIST VIEW MODEL
    // ============================================================

    /**
     * Get a tournament list view model for the UI.
     * 
     * @param {object} options - Options
     * @param {string} options.filter - Status filter ('active', 'completed', 'draft')
     * @param {string} options.search - Search by name
     * @param {string} options.sort - Sort field ('name', 'createdAt', 'status')
     * @param {string} options.sortDirection - 'asc' or 'desc'
     * @param {number} options.limit - Max number of tournaments to return
     * @returns {object} { tournaments: Array, total: number, filtered: number }
     */
    function getTournamentListViewModel(options) {
        options = options || {};

        var Queries = getTournamentQueries();
        if (!Queries) {
            return { tournaments: [], total: 0, filtered: 0 };
        }

        var filter = options.filter || null;
        var search = options.search || '';
        var sort = options.sort || 'createdAt';
        var sortDirection = options.sortDirection || 'desc';
        var limit = options.limit || 0;

        var tournaments = Queries.getTournaments(filter);

        // Apply search filter
        if (search) {
            var lowerSearch = search.toLowerCase();
            tournaments = tournaments.filter(function(t) {
                return t.name && t.name.toLowerCase().indexOf(lowerSearch) !== -1;
            });
        }

        var total = tournaments.length;

        // Build list items
        var listItems = tournaments.map(function(t) {
            var participants = Queries.getParticipants(t.id);
            var rounds = Queries.getRounds(t.id);
            var winner = Queries.getWinner(t.id);
            var stats = Queries.getTournamentStatistics(t.id);

            return {
                id: t.id,
                name: t.name,
                mode: t.mode,
                modeLabel: t.mode === 'teams' ? 'Teams' : 'Individuals',
                status: t.status,
                statusDisplay: getStatusDisplay(t.status),
                participantCount: participants.length,
                roundCount: rounds.length,
                hasWinner: !!winner,
                winnerName: winner ? getParticipantDisplayName(t.id, winner.id) : null,
                totalRounds: t.totalRounds || 1,
                createdAt: t.createdAt || '',
                graduatingClassName: t.graduatingClassId ? getAcademyClassDisplayName(t.graduatingClassId) : '',
                // Raw tournament reference for detail expansion
                _tournament: t
            };
        });

        // Sort
        listItems.sort(function(a, b) {
            var aVal, bVal;

            switch (sort) {
                case 'name':
                    aVal = a.name || '';
                    bVal = b.name || '';
                    break;
                case 'status':
                    var order = { 'draft': 0, 'active': 1, 'completed': 2 };
                    aVal = order[a.status] || 999;
                    bVal = order[b.status] || 999;
                    break;
                case 'participantCount':
                    aVal = a.participantCount;
                    bVal = b.participantCount;
                    break;
                case 'createdAt':
                default:
                    aVal = a.createdAt || '';
                    bVal = b.createdAt || '';
                    break;
            }

            if (typeof aVal === 'string') {
                var result = aVal.localeCompare(bVal);
                return sortDirection === 'desc' ? -result : result;
            }

            if (aVal < bVal) {
                return sortDirection === 'desc' ? 1 : -1;
            }
            if (aVal > bVal) {
                return sortDirection === 'desc' ? -1 : 1;
            }
            return 0;
        });

        // Apply limit
        if (limit > 0 && listItems.length > limit) {
            listItems = listItems.slice(0, limit);
        }

        return {
            tournaments: listItems,
            total: total,
            filtered: listItems.length
        };
    }

    // ============================================================
    // ROUND VIEW MODEL
    // ============================================================

    /**
     * Get a round view model with match details.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of the round
     * @param {object} options - Options
     * @param {boolean} options.includeMatchDetails - Include match participant details (default: true)
     * @returns {object|null} Round view model or null
     */
    function getRoundViewModel(tournamentId, roundIndex, options) {
        options = options || {};

        var Queries = getTournamentQueries();
        if (!Queries) {
            return null;
        }

        var tournament = Queries.getTournament(tournamentId);
        if (!tournament) {
            return null;
        }

        var rounds = Queries.getRounds(tournamentId);
        var index = parseInt(roundIndex, 10);
        if (isNaN(index) || index < 0 || index >= rounds.length) {
            return null;
        }

        var round = rounds[index];
        if (!round) {
            return null;
        }

        var includeMatchDetails = options.includeMatchDetails !== false;

        var matches = Queries.getMatches(tournamentId, index);

        return {
            tournamentId: tournamentId,
            tournamentName: tournament.name,
            index: index,
            roundNumber: round.roundNumber || (index + 1),
            status: round.status || 'pending',
            statusDisplay: getMatchStatusDisplay(round.status || 'pending'),
            matchSize: round.matchSize || 2,
            matchType: round.matchType || 'standard',
            matchTypeLabel: round.matchType === 'group_exam' ? 'Group Exam' : 'Standard',
            matchCount: matches.length,
            matches: includeMatchDetails ? matches.map(function(match, matchIndex) {
                return getMatchViewModel(tournamentId, index, matchIndex, {
                    includeParticipants: true
                });
            }) : matches.map(function(match, matchIndex) {
                return {
                    index: matchIndex,
                    id: match.id || null,
                    type: match.type || 'standard',
                    status: match.status || 'pending',
                    statusDisplay: getMatchStatusDisplay(match.status || 'pending'),
                    participantCount: Array.isArray(match.participants) ? match.participants.length : 0,
                    hasWinner: !!match.winner,
                    isComplete: match.status === 'completed'
                };
            })
        };
    }

    // ============================================================
    // MATCH VIEW MODEL
    // ============================================================

    /**
     * Get a match view model with participant names and outcomes.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of the round
     * @param {number} matchIndex - Index of the match
     * @param {object} options - Options
     * @param {boolean} options.includeParticipants - Include participant details (default: true)
     * @returns {object|null} Match view model or null
     */
    function getMatchViewModel(tournamentId, roundIndex, matchIndex, options) {
        options = options || {};

        var Queries = getTournamentQueries();
        if (!Queries) {
            return null;
        }

        var match = Queries.getMatch(tournamentId, roundIndex, matchIndex);
        if (!match) {
            return null;
        }

        var includeParticipants = options.includeParticipants !== false;

        var viewModel = {
            tournamentId: tournamentId,
            roundIndex: roundIndex,
            index: matchIndex,
            id: match.id || null,
            type: match.type || 'standard',
            typeLabel: match.type === 'group_exam' ? 'Group Exam' : 'Standard',
            status: match.status || 'pending',
            statusDisplay: getMatchStatusDisplay(match.status || 'pending'),
            winner: match.winner || null,
            loser: match.loser || null,
            advancing: match.advancing || [],
            results: match.results || {},
            isGroupExam: match.type === 'group_exam',
            isComplete: match.status === 'completed'
        };

        if (includeParticipants && Array.isArray(match.participants)) {
            viewModel.participants = match.participants.map(function(participantId) {
                var outcome = getMatchOutcome(participantId, match);
                var outcomeDisplay = getOutcomeDisplay(outcome);

                return {
                    id: participantId,
                    name: getParticipantDisplayName(tournamentId, participantId),
                    type: Queries.getParticipantTypeFromRecord(tournamentId, participantId) || 'unknown',
                    typeLabel: getParticipantTypeLabel(Queries.getParticipantTypeFromRecord(tournamentId, participantId)),
                    outcome: outcome,
                    outcomeDisplay: outcomeDisplay,
                    isWinner: outcome === 'winner',
                    isEliminated: outcome === 'eliminated',
                    isAdvancing: outcome === 'advancing',
                    isPassed: outcome === 'passed',
                    isFailed: outcome === 'failed'
                };
            });
            viewModel.participantCount = viewModel.participants.length;
        } else {
            viewModel.participantCount = Array.isArray(match.participants) ? match.participants.length : 0;
        }

        return viewModel;
    }

    // ============================================================
    // NAME RESOLUTION HELPERS (Cross-domain)
    // ============================================================

    /**
     * Get the display name of a participant in a tournament.
     * Resolves character or team names.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {string} participantId - Participant ID
     * @returns {string} Display name
     */
    function getParticipantName(tournamentId, participantId) {
        if (!tournamentId || !participantId) {
            return 'Unknown';
        }

        var Queries = getTournamentQueries();
        if (!Queries) {
            return 'Unknown';
        }

        var participantType = Queries.getParticipantTypeFromRecord(tournamentId, participantId);

        if (participantType === 'character') {
            return getCharacterDisplayName(participantId);
        }
        if (participantType === 'team') {
            return getTeamName(participantId);
        }

        return 'Unknown';
    }

    /**
     * Get the display name of a tournament winner.
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {string} Winner display name or 'Not determined'
     */
    function getWinnerName(tournamentId) {
        var Queries = getTournamentQueries();
        if (!Queries) {
            return 'Not determined';
        }

        var winner = Queries.getWinner(tournamentId);
        if (!winner) {
            return 'Not determined';
        }

        return getParticipantName(tournamentId, winner.id);
    }

    /**
     * Get a participant display object with name and type.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {string} participantId - Participant ID
     * @returns {object} { id, name, type, typeLabel }
     */
    function getParticipantDisplay(tournamentId, participantId) {
        if (!tournamentId || !participantId) {
            return { id: null, name: 'Unknown', type: null, typeLabel: 'Unknown' };
        }

        var Queries = getTournamentQueries();
        if (!Queries) {
            return { id: participantId, name: 'Unknown', type: null, typeLabel: 'Unknown' };
        }

        var type = Queries.getParticipantTypeFromRecord(tournamentId, participantId);
        var name = getParticipantName(tournamentId, participantId);

        return {
            id: participantId,
            name: name,
            type: type,
            typeLabel: getParticipantTypeLabel(type)
        };
    }

    /**
     * Get the display name of a class.
     * 
     * @param {string} classId - Class ID
     * @returns {string} Class display name
     */
    function getClassName(classId) {
        if (!classId) {
            return '';
        }
        return getAcademyClassDisplayName(classId);
    }

    // ============================================================
    // MATCH DISPLAY HELPERS
    // ============================================================

    /**
     * Get a match display object for UI.
     * 
     * @param {string} tournamentId - Tournament ID
     * @param {number} roundIndex - Index of the round
     * @param {number} matchIndex - Index of the match
     * @returns {object|null} Match display object or null
     */
    function getMatchDisplay(tournamentId, roundIndex, matchIndex) {
        var Queries = getTournamentQueries();
        if (!Queries) {
            return null;
        }

        var match = Queries.getMatch(tournamentId, roundIndex, matchIndex);
        if (!match) {
            return null;
        }

        var participants = Array.isArray(match.participants) ? match.participants : [];
        var participantDisplays = participants.map(function(id) {
            var outcome = getMatchOutcome(id, match);
            var outcomeDisplay = getOutcomeDisplay(outcome);
            return {
                id: id,
                name: getParticipantDisplayName(tournamentId, id),
                outcome: outcome,
                outcomeDisplay: outcomeDisplay
            };
        });

        return {
            id: match.id || null,
            type: match.type || 'standard',
            typeLabel: match.type === 'group_exam' ? 'Group Exam' : 'Standard',
            status: match.status || 'pending',
            statusDisplay: getMatchStatusDisplay(match.status || 'pending'),
            participants: participantDisplays,
            winner: match.winner || null,
            winnerName: match.winner ? getParticipantDisplayName(tournamentId, match.winner) : null,
            loser: match.loser || null,
            loserName: match.loser ? getParticipantDisplayName(tournamentId, match.loser) : null,
            advancing: match.advancing || [],
            advancingNames: (match.advancing || []).map(function(id) {
                return getParticipantDisplayName(tournamentId, id);
            }),
            results: match.results || {},
            isGroupExam: match.type === 'group_exam',
            isComplete: match.status === 'completed'
        };
    }

    // ============================================================
    // OVERVIEW PROJECTION
    // ============================================================

    /**
     * Get a tournament overview for dashboard display.
     * 
     * @param {string} tournamentId - Tournament ID
     * @returns {object|null} Overview object or null
     */
    function getTournamentOverview(tournamentId) {
        var Queries = getTournamentQueries();
        if (!Queries) {
            return null;
        }

        var tournament = Queries.getTournament(tournamentId);
        if (!tournament) {
            return null;
        }

        var participants = Queries.getParticipants(tournamentId);
        var rounds = Queries.getRounds(tournamentId);
        var stats = Queries.getTournamentStatistics(tournamentId);

        var activeParticipants = participants.filter(function(p) {
            return !Queries.isParticipantEliminated(tournamentId, p.id);
        });

        var roundStatuses = rounds.map(function(round, index) {
            var matches = Queries.getMatches(tournamentId, index);
            var completed = 0;
            for (var i = 0; i < matches.length; i++) {
                if (matches[i].status === 'completed') {
                    completed++;
                }
            }
            return {
                roundNumber: round.roundNumber || (index + 1),
                matchCount: matches.length,
                completedCount: completed,
                isComplete: completed === matches.length && matches.length > 0
            };
        });

        var completedRounds = roundStatuses.filter(function(r) { return r.isComplete; }).length;

        return {
            id: tournament.id,
            name: tournament.name,
            mode: tournament.mode,
            modeLabel: tournament.mode === 'teams' ? 'Teams' : 'Individuals',
            status: tournament.status,
            statusDisplay: getStatusDisplay(tournament.status),
            startWeek: tournament.startWeek,
            endWeek: tournament.endWeek,
            participantCount: participants.length,
            activeParticipantCount: activeParticipants.length,
            roundCount: rounds.length,
            totalRounds: tournament.totalRounds || 1,
            completedRounds: completedRounds,
            hasWinner: stats.hasWinner,
            winnerName: stats.hasWinner ? getWinnerName(tournamentId) : null,
            eliminationCount: stats.eliminationCount,
            matchCount: stats.matchCount,
            isComplete: stats.hasWinner && completedRounds === rounds.length && rounds.length > 0,
            graduatingClassName: tournament.graduatingClassId ? getAcademyClassDisplayName(tournament.graduatingClassId) : ''
        };
    }

    // ============================================================
    // ACTIVE TOURNAMENTS VIEW MODEL
    // ============================================================

    /**
     * Get a view model for active tournaments.
     * 
     * @param {object} options - Options
     * @param {number} options.limit - Max number of tournaments
     * @returns {object} { tournaments: Array, count: number }
     */
    function getActiveTournamentsViewModel(options) {
        options = options || {};
        var limit = options.limit || 0;

        var Queries = getTournamentQueries();
        if (!Queries) {
            return { tournaments: [], count: 0 };
        }

        var tournaments = Queries.getActiveTournaments();

        var items = tournaments.map(function(t) {
            return {
                id: t.id,
                name: t.name,
                mode: t.mode,
                modeLabel: t.mode === 'teams' ? 'Teams' : 'Individuals',
                participantCount: Queries.getParticipantCount(t.id),
                roundCount: Queries.getRoundCount(t.id),
                startWeek: t.startWeek,
                endWeek: t.endWeek,
                graduatingClassName: t.graduatingClassId ? getAcademyClassDisplayName(t.graduatingClassId) : ''
            };
        });

        if (limit > 0 && items.length > limit) {
            items = items.slice(0, limit);
        }

        return {
            tournaments: items,
            count: items.length
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TournamentAggregator = {
        // Core projections
        getTournamentViewModel: getTournamentViewModel,
        getTournamentListViewModel: getTournamentListViewModel,
        getRoundViewModel: getRoundViewModel,
        getMatchViewModel: getMatchViewModel,

        // Name resolution (cross-domain)
        getParticipantName: getParticipantName,
        getWinnerName: getWinnerName,
        getParticipantDisplay: getParticipantDisplay,
        getClassName: getClassName,

        // Display helpers
        getMatchDisplay: getMatchDisplay,
        getStatusDisplay: getStatusDisplay,
        getMatchStatusDisplay: getMatchStatusDisplay,
        getOutcomeDisplay: getOutcomeDisplay,

        // Overview
        getTournamentOverview: getTournamentOverview,
        getActiveTournamentsViewModel: getActiveTournamentsViewModel
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.TournamentAggregator;
        var missing = [];

        var required = [
            'getTournamentViewModel', 'getTournamentListViewModel',
            'getRoundViewModel', 'getMatchViewModel',
            'getParticipantName', 'getWinnerName',
            'getParticipantDisplay', 'getClassName',
            'getMatchDisplay', 'getStatusDisplay',
            'getMatchStatusDisplay', 'getOutcomeDisplay',
            'getTournamentOverview', 'getActiveTournamentsViewModel'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[TournamentAggregator] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[TournamentAggregator] All exports verified successfully.');
        }
    })();

})();
