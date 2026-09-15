/**
 * modules/tournaments/tournament-aggregator.js - Tournament Aggregator
 * Cross-domain projection builder for tournament UI.
 *
 * Path: js/modules/tournaments/tournament-aggregator.js
 *
 * RESPONSIBILITIES:
 *   - Build tournament-, round-, and match-level view models for UI
 *   - Resolve participant and team display names via CharacterQueries
 *     and TeamQueries
 *   - Resolve class display names via AcademyQueries
 *   - Shape result vocabularies into display objects
 *
 * NOT RESPONSIBILITIES:
 *   - Domain reads beyond the shape of a returned VM
 *   - Mutations
 *   - Rendering
 *
 * IDENTITY:
 *   Rounds and matches are addressed by stable IDs, not indices.
 *   Every round- and match-scoped projection takes the ID.
 *
 *   The returned VMs carry BOTH:
 *     - `id`     : the stable identity
 *     - `index`  : the positional display order (0-based)
 *
 *   Callers that need to act on a round or match use `id`. Callers
 *   that need to display "Round 3" use `roundNumber` (which the
 *   tournament stores positionally). Callers that need a stable sort
 *   tiebreak can use `index`.
 *
 * RESULT VOCABULARY:
 *   - 'pass'  : advanced and successful
 *   - 'retry' : advanced but not successful; tries again next round
 *   - 'fail'  : not advanced; eliminated from this tournament
 *
 * MATCH TYPES:
 *   - 'standard'    : legacy. Read-only.
 *   - 'group_exam'  : per-participant results. Optionally isPairExam.
 *   - 'team_vs_team': two-layer results (team + individual).
 *
 * DEPRECATED:
 *   - getWinnerName is retained for legacy callers. It returns
 *     'Not determined' on new data because no winner is set.
 *   - Use getFinalPassersView instead.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TournamentQueries
 *   - window.TournamentSchema
 *   - window.CharacterQueries
 *   - window.TeamQueries
 *   - window.AcademyQueries
 *   - window.TournamentConstants
 *
 * DEPENDENCIES (OPTIONAL):
 *   - window.ObjectUtils
 */

(function() {
    'use strict';

    if (window.__tournamentAggregatorLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var Queries = window.TournamentQueries;
    var Schema = window.TournamentSchema;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var AcademyQueries = window.AcademyQueries;
    var Constants = window.TournamentConstants;

    var _missing = [];

    if (!Queries || typeof Queries.getTournament !== 'function') {
        _missing.push('TournamentQueries.getTournament');
    }
    if (!Queries || typeof Queries.getRound !== 'function') {
        _missing.push('TournamentQueries.getRound');
    }
    if (!Queries || typeof Queries.getMatch !== 'function') {
        _missing.push('TournamentQueries.getMatch');
    }
    if (!Queries || typeof Queries.getParticipantResult !== 'function') {
        _missing.push('TournamentQueries.getParticipantResult');
    }
    if (!Schema || typeof Schema.normaliseId !== 'function') {
        _missing.push('TournamentSchema.normaliseId');
    }
    if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!TeamQueries || typeof TeamQueries.getTeamById !== 'function') {
        _missing.push('TeamQueries.getTeamById');
    }
    if (!AcademyQueries || typeof AcademyQueries.getClassDisplayName !== 'function') {
        _missing.push('AcademyQueries.getClassDisplayName');
    }
    if (!Constants) {
        _missing.push('TournamentConstants');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TournamentAggregator] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__tournamentAggregatorLoaded = true;

    // ============================================================
    // OPTIONAL DEPENDENCY
    // ============================================================

    function getObjectUtils() {
        return window.ObjectUtils || null;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function normaliseId(value) {
        return Schema.normaliseId(value);
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
        try { return JSON.parse(JSON.stringify(value)); } catch (_) {
            return value;
        }
    }

    function getCharacterDisplayName(characterId) {
        var char = CharacterQueries.getCharacterById(characterId);
        if (!char) { return 'Unknown'; }
        return CharacterQueries.getDisplayName(char);
    }

    function getTeamName(teamId) {
        var team = TeamQueries.getTeamById(teamId);
        if (!team) { return 'Unknown Team'; }
        return team.name || 'Unknown Team';
    }

    function getAcademyClassDisplayName(classId) {
        if (!classId) { return ''; }
        return AcademyQueries.getClassDisplayName(classId) || '';
    }

    function getParticipantTypeLabel(type) {
        if (type === 'character') { return 'Character'; }
        if (type === 'team') { return 'Team'; }
        return 'Unknown';
    }

    // ============================================================
    // RESULT DISPLAY
    // ============================================================

    function getOutcomeDisplay(outcome) {
        var map = {
            'pass': { text: '\u2713', class: 'outcome-pass', label: 'Pass' },
            'retry': { text: '\u21bb', class: 'outcome-retry', label: 'Retry' },
            'fail': { text: '\u2717', class: 'outcome-fail', label: 'Fail' },
            'winner': { text: '\u2605', class: 'outcome-pass', label: 'Winner' },
            'eliminated': { text: '\u2718', class: 'outcome-fail', label: 'Eliminated' },
            'advancing': { text: '\u2192', class: 'outcome-pass', label: 'Advancing' },
            'passed': { text: '\u2713', class: 'outcome-pass', label: 'Passed' },
            'failed': { text: '\u2717', class: 'outcome-fail', label: 'Failed' },
            'pending': { text: '\u23f3', class: 'outcome-pending', label: 'Pending' },
            'unknown': { text: '?', class: 'outcome-unknown', label: 'Unknown' }
        };
        return map[outcome] || {
            text: '?',
            class: 'outcome-unknown',
            label: 'Unknown'
        };
    }

    function getOutcomeCategory(resultValue) {
        if (resultValue === 'pass') { return 'passed'; }
        if (resultValue === 'retry') { return 'retry'; }
        if (resultValue === 'fail') { return 'failed'; }
        return 'unknown';
    }

    function getStatusDisplay(status) {
        var map = {
            'draft':     { text: 'Draft',     class: 'status-draft' },
            'active':    { text: 'Active',    class: 'status-active' },
            'completed': { text: 'Completed', class: 'status-completed' }
        };
        return map[status] || {
            text: status || 'Unknown',
            class: 'status-unknown'
        };
    }

    function getMatchStatusDisplay(status) {
        var map = {
            'pending':     { text: 'Pending',     class: 'match-status-pending' },
            'in_progress': { text: 'In Progress', class: 'match-status-in-progress' },
            'completed':   { text: 'Completed',   class: 'match-status-completed' }
        };
        return map[status] || {
            text: status || 'Unknown',
            class: 'match-status-unknown'
        };
    }

    function getMatchTypeLabel(type) {
        if (type === 'group_exam') { return 'Group Exam'; }
        if (type === 'team_vs_team') { return 'Team Match'; }
        if (type === 'standard') { return 'Standard'; }
        return type || 'Unknown';
    }

    function getCanonicalParticipantType(mode) {
        if (Constants &&
            typeof Constants.getCanonicalParticipantType === 'function') {
            return Constants.getCanonicalParticipantType(mode);
        }
        return mode === 'teams' ? 'team' : 'character';
    }

    // ============================================================
    // NAME RESOLUTION
    // ============================================================

    function getParticipantDisplayName(tournamentId, participantId) {
        var participantType = Queries.getParticipantTypeFromRecord(
            tournamentId,
            participantId
        );

        if (participantType === 'character') {
            return getCharacterDisplayName(participantId);
        }
        if (participantType === 'team') {
            return getTeamName(participantId);
        }
        return 'Unknown';
    }

    // ============================================================
    // MATCH PARTICIPANT PROJECTION
    // ============================================================

    function buildMatchParticipantVM(
        tournamentId,
        roundId,
        matchId,
        participantId,
        match
    ) {
        var participantType = Queries.getParticipantTypeFromRecord(
            tournamentId,
            participantId
        );

        var result = Queries.getParticipantResult(
            tournamentId,
            roundId,
            matchId,
            participantId
        );

        var outcomeKey = result || 'pending';
        var outcomeDisplay = getOutcomeDisplay(outcomeKey);

        return {
            id: participantId,
            name: getParticipantDisplayName(tournamentId, participantId),
            type: participantType || 'unknown',
            typeLabel: getParticipantTypeLabel(participantType),
            result: result,
            resultCategory: getOutcomeCategory(result),
            outcomeDisplay: outcomeDisplay,
            outcomeKey: outcomeKey,
            isPassing: result === 'pass',
            isRetrying: result === 'retry',
            isFailing: result === 'fail'
        };
    }

    // ============================================================
    // TOURNAMENT VM
    // ============================================================

    function getTournamentViewModel(tournamentId, options) {
        options = options || {};

        var tournament = Queries.getTournament(tournamentId);
        if (!tournament) { return null; }

        var includeParticipants = options.includeParticipants !== false;
        var includeRounds = options.includeRounds !== false;
        var includeEliminations = options.includeEliminations !== false;
        var includeFinalPassers = options.includeFinalPassers !== false;
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
            graduatingClassName: tournament.graduatingClassId
                ? getAcademyClassDisplayName(tournament.graduatingClassId)
                : '',
            classFilterEnabled: tournament.classFilterEnabled || false,
            createdAt: tournament.createdAt
        };

        // ---- Participants ----
        if (includeParticipants) {
            var participants = Queries.getParticipants(tournamentId);
            viewModel.participants = participants.map(function(p) {
                return {
                    id: p.id,
                    type: p.type,
                    typeLabel: getParticipantTypeLabel(p.type),
                    name: getParticipantDisplayName(tournamentId, p.id),
                    eliminated: Queries.isParticipantEliminated(
                        tournamentId,
                        p.id
                    ),
                    addedAt: p.addedAt || null
                };
            });
            viewModel.participantCount = viewModel.participants.length;
        }

        // ---- Rounds ----
        if (includeRounds) {
            var rounds = Queries.getRounds(tournamentId);
            viewModel.rounds = rounds.map(function(round, index) {
                if (!round || !isNonEmptyString(round.id)) {
                    console.warn(
                        '[TournamentAggregator] Round ' + index +
                        ' in tournament ' + tournamentId +
                        ' has no stable id. Skipping.'
                    );
                    return null;
                }

                var matches = Queries.getMatches(tournamentId, round.id);

                return {
                    id: round.id,
                    index: index,
                    roundNumber: round.roundNumber || (index + 1),
                    status: round.status || 'pending',
                    statusDisplay: getMatchStatusDisplay(
                        round.status || 'pending'
                    ),
                    matchSize: round.matchSize || 2,
                    matchType: round.matchType || 'group_exam',
                    matchTypeLabel: getMatchTypeLabel(round.matchType),
                    isPairExam: round.isPairExam === true,
                    matches: matches.map(function(match, matchIndex) {
                        return getMatchViewModel(
                            tournamentId,
                            round.id,
                            match.id,
                            { includeParticipants: true }
                        );
                    }).filter(function(vm) { return vm !== null; }),
                    matchCount: matches.length
                };
            }).filter(function(vm) { return vm !== null; });
            viewModel.roundCount = viewModel.rounds.length;
        }

        // ---- Eliminations ----
        if (includeEliminations) {
            var eliminations = Queries.getEliminations(tournamentId);
            viewModel.eliminations = eliminations.map(function(e) {
                return {
                    participantId: e.participantId,
                    participantType: e.participantType,
                    participantName: getParticipantDisplayName(
                        tournamentId,
                        e.participantId
                    ),
                    week: e.week,
                    reason: e.reason || 'Eliminated',
                    standalone: e.standalone || false
                };
            });
            viewModel.eliminationCount = viewModel.eliminations.length;
        }

        // ---- Final passers ----
        if (includeFinalPassers) {
            var passers = Queries.getFinalPassers(tournamentId) || [];
            viewModel.finalPassers = passers.map(function(id) {
                return {
                    id: id,
                    name: getParticipantDisplayName(tournamentId, id),
                    type: Queries.getParticipantTypeFromRecord(
                        tournamentId,
                        id
                    ) || null
                };
            });
            viewModel.finalPasserCount = viewModel.finalPassers.length;

            // Deprecated. Always null going forward.
            viewModel.winner = null;
            viewModel.hasWinner = false;
        }

        // ---- Statistics ----
        if (includeStatistics) {
            viewModel.statistics = Queries.getTournamentStatistics(
                tournamentId
            );
        }

        return viewModel;
    }

    // ============================================================
    // LIST VM
    // ============================================================

    function getTournamentListViewModel(options) {
        options = options || {};

        var filter = options.filter || null;
        var search = options.search || '';
        var sort = options.sort || 'createdAt';
        var sortDirection = options.sortDirection || 'desc';
        var limit = options.limit || 0;

        var tournaments = Queries.getTournaments(filter);

        if (search) {
            var lowerSearch = search.toLowerCase();
            tournaments = tournaments.filter(function(t) {
                return t.name &&
                    t.name.toLowerCase().indexOf(lowerSearch) !== -1;
            });
        }

        var total = tournaments.length;

        var listItems = tournaments.map(function(t) {
            var participants = Queries.getParticipants(t.id);
            var rounds = Queries.getRounds(t.id);
            var finalPassers = Queries.getFinalPassers(t.id);
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
                finalPasserCount: finalPassers.length,
                totalRounds: t.totalRounds || 1,
                createdAt: t.createdAt || '',
                graduatingClassName: t.graduatingClassId
                    ? getAcademyClassDisplayName(t.graduatingClassId)
                    : '',
                _tournament: t
            };
        });

        listItems.sort(function(a, b) {
            var aVal, bVal;
            switch (sort) {
                case 'name':
                    aVal = a.name || '';
                    bVal = b.name || '';
                    break;
                case 'status':
                    var order = { draft: 0, active: 1, completed: 2 };
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
            if (aVal < bVal) { return sortDirection === 'desc' ? 1 : -1; }
            if (aVal > bVal) { return sortDirection === 'desc' ? -1 : 1; }
            return 0;
        });

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
    // ROUND VM - BY ID
    // ============================================================

    function getRoundViewModel(tournamentId, roundId, options) {
        options = options || {};

        var tournament = Queries.getTournament(tournamentId);
        if (!tournament) { return null; }

        var normalisedRoundId = normaliseId(roundId);
        if (normalisedRoundId === null) { return null; }

        var round = Queries.getRound(tournamentId, normalisedRoundId);
        if (!round) { return null; }

        var roundIndex = Queries.getRoundIndex(
            tournamentId,
            normalisedRoundId
        );

        var includeMatchDetails = options.includeMatchDetails !== false;
        var matches = Queries.getMatches(tournamentId, normalisedRoundId);

        return {
            tournamentId: tournamentId,
            tournamentName: tournament.name,
            id: round.id,
            index: roundIndex >= 0 ? roundIndex : 0,
            roundNumber: round.roundNumber || (roundIndex + 1),
            status: round.status || 'pending',
            statusDisplay: getMatchStatusDisplay(round.status || 'pending'),
            matchSize: round.matchSize || 2,
            matchType: round.matchType || 'group_exam',
            matchTypeLabel: getMatchTypeLabel(round.matchType),
            isPairExam: round.isPairExam === true,
            matchCount: matches.length,
            matches: includeMatchDetails
                ? matches.map(function(match) {
                    return getMatchViewModel(
                        tournamentId,
                        normalisedRoundId,
                        match.id,
                        { includeParticipants: true }
                    );
                }).filter(function(vm) { return vm !== null; })
                : matches.map(function(match) {
                    return {
                        id: match.id,
                        type: match.type || 'group_exam',
                        status: match.status || 'pending',
                        statusDisplay: getMatchStatusDisplay(
                            match.status || 'pending'
                        ),
                        participantCount: Array.isArray(match.participants)
                            ? match.participants.length
                            : 0,
                        isComplete: match.status === 'completed'
                    };
                })
        };
    }

    // ============================================================
    // MATCH VM - BY ID
    // ============================================================

    function getMatchViewModel(tournamentId, roundId, matchId, options) {
        options = options || {};

        var normalisedRoundId = normaliseId(roundId);
        var normalisedMatchId = normaliseId(matchId);
        if (normalisedRoundId === null || normalisedMatchId === null) {
            return null;
        }

        var match = Queries.getMatch(
            tournamentId,
            normalisedRoundId,
            normalisedMatchId
        );
        if (!match) { return null; }

        var includeParticipants = options.includeParticipants !== false;
        var type = match.type || 'group_exam';

        var matchIndex = Queries.getMatchIndex(
            tournamentId,
            normalisedRoundId,
            normalisedMatchId
        );

        var viewModel = {
            tournamentId: tournamentId,
            roundId: normalisedRoundId,
            roundIndex: Queries.getRoundIndex(tournamentId, normalisedRoundId),
            id: normalisedMatchId,
            index: matchIndex >= 0 ? matchIndex : 0,
            type: type,
            typeLabel: getMatchTypeLabel(type),
            status: match.status || 'pending',
            statusDisplay: getMatchStatusDisplay(match.status || 'pending'),
            isPairExam: match.isPairExam === true,
            isGroupExam: type === 'group_exam',
            isTeamMatch: type === 'team_vs_team',
            isStandard: type === 'standard',
            isComplete: match.status === 'completed'
        };

        if (!includeParticipants) {
            viewModel.participantCount = Array.isArray(match.participants)
                ? match.participants.length
                : 0;
            return viewModel;
        }

        if (type === 'group_exam') {
            var participants = Array.isArray(match.participants)
                ? match.participants
                : [];
            viewModel.participants = participants.map(function(pid) {
                return buildMatchParticipantVM(
                    tournamentId,
                    normalisedRoundId,
                    normalisedMatchId,
                    pid,
                    match
                );
            });
            viewModel.participantCount = viewModel.participants.length;

            if (match.isPairExam && Array.isArray(match.pairings)) {
                viewModel.pairings = match.pairings.map(function(pair) {
                    return pair.map(function(pid) {
                        return buildMatchParticipantVM(
                            tournamentId,
                            normalisedRoundId,
                            normalisedMatchId,
                            pid,
                            match
                        );
                    });
                });
            }
        }

        if (type === 'team_vs_team') {
            var teams = Array.isArray(match.participants)
                ? match.participants
                : [];
            viewModel.participants = teams.map(function(tid) {
                return buildMatchParticipantVM(
                    tournamentId,
                    normalisedRoundId,
                    normalisedMatchId,
                    tid,
                    match
                );
            });
            viewModel.participantCount = viewModel.participants.length;

            viewModel.teams = teams.map(function(tid) {
                return buildTeamMatchTeamVM(
                    tournamentId,
                    normalisedRoundId,
                    normalisedMatchId,
                    tid,
                    match
                );
            });
        }

        return viewModel;
    }

    function buildTeamMatchTeamVM(
        tournamentId,
        roundId,
        matchId,
        teamId,
        match
    ) {
        var teamResult = null;
        if (match.teamResults && match.teamResults[teamId] !== undefined) {
            teamResult = match.teamResults[teamId];
        }
        var teamOutcomeDisplay = getOutcomeDisplay(teamResult || 'pending');

        var members = [];

        var teamObj = TeamQueries.getTeamById(teamId);
        if (teamObj && Array.isArray(teamObj.members)) {
            for (var i = 0; i < teamObj.members.length; i++) {
                var member = teamObj.members[i];
                if (!member || !member.characterId) { continue; }

                var charResult = null;
                if (match.individualResults &&
                    match.individualResults[member.characterId] !== undefined) {
                    charResult = match.individualResults[member.characterId];
                }
                var charOutcomeDisplay = getOutcomeDisplay(
                    charResult || 'pending'
                );

                members.push({
                    characterId: member.characterId,
                    name: getCharacterDisplayName(member.characterId),
                    role: member.role || 'Member',
                    result: charResult,
                    resultCategory: getOutcomeCategory(charResult),
                    outcomeDisplay: charOutcomeDisplay,
                    outcomeKey: charResult || 'pending',
                    isPassing: charResult === 'pass',
                    isRetrying: charResult === 'retry',
                    isFailing: charResult === 'fail'
                });
            }
        }

        return {
            teamId: teamId,
            name: getTeamName(teamId),
            result: teamResult,
            resultCategory: getOutcomeCategory(teamResult),
            outcomeDisplay: teamOutcomeDisplay,
            outcomeKey: teamResult || 'pending',
            isPassing: teamResult === 'pass',
            isRetrying: teamResult === 'retry',
            isFailing: teamResult === 'fail',
            members: members,
            memberCount: members.length
        };
    }

    // ============================================================
    // NAME RESOLUTION HELPERS
    // ============================================================

    function getParticipantName(tournamentId, participantId) {
        if (!tournamentId || !participantId) {
            return 'Unknown';
        }

        var participantType = Queries.getParticipantTypeFromRecord(
            tournamentId,
            participantId
        );

        if (participantType === 'character') {
            return getCharacterDisplayName(participantId);
        }
        if (participantType === 'team') {
            return getTeamName(participantId);
        }
        return 'Unknown';
    }

    /**
     * @deprecated No winner concept anymore. Returns 'Not determined'
     * on new data. Use getFinalPassersView instead.
     */
    function getWinnerName(tournamentId) {
        var winner = Queries.getWinner(tournamentId);
        if (!winner) { return 'Not determined'; }
        return getParticipantName(tournamentId, winner.id);
    }

    function getParticipantDisplay(tournamentId, participantId) {
        if (!tournamentId || !participantId) {
            return {
                id: null,
                name: 'Unknown',
                type: null,
                typeLabel: 'Unknown'
            };
        }

        var type = Queries.getParticipantTypeFromRecord(
            tournamentId,
            participantId
        );
        var name = getParticipantName(tournamentId, participantId);

        return {
            id: participantId,
            name: name,
            type: type,
            typeLabel: getParticipantTypeLabel(type)
        };
    }

    function getClassName(classId) {
        if (!classId) { return ''; }
        return getAcademyClassDisplayName(classId);
    }

    // ============================================================
    // FINAL PASSERS
    // ============================================================

    function getFinalPassersView(tournamentId) {
        var passers = Queries.getFinalPassers(tournamentId) || [];

        var items = passers.map(function(id) {
            var type = Queries.getParticipantTypeFromRecord(
                tournamentId,
                id
            );
            return {
                id: id,
                name: getParticipantDisplayName(tournamentId, id),
                type: type,
                typeLabel: getParticipantTypeLabel(type)
            };
        });

        return {
            passers: items,
            count: items.length
        };
    }

    // ============================================================
    // PAIR EXAM GROUPINGS
    // ============================================================

    function getPairExamGroupings(tournamentId, roundId, matchId) {
        var normalisedRoundId = normaliseId(roundId);
        var normalisedMatchId = normaliseId(matchId);
        if (normalisedRoundId === null || normalisedMatchId === null) {
            return null;
        }

        var match = Queries.getMatch(
            tournamentId,
            normalisedRoundId,
            normalisedMatchId
        );
        if (!match || match.isPairExam !== true) {
            return null;
        }

        var pairings = Queries.getPairings(
            tournamentId,
            normalisedRoundId,
            normalisedMatchId
        );
        if (!pairings || pairings.length === 0) {
            return { groups: [], groupCount: 0 };
        }

        var groups = pairings.map(function(pair) {
            return pair.map(function(pid) {
                return buildMatchParticipantVM(
                    tournamentId,
                    normalisedRoundId,
                    normalisedMatchId,
                    pid,
                    match
                );
            });
        });

        return {
            groups: groups,
            groupCount: groups.length
        };
    }

    // ============================================================
    // TEAM MATCH VM
    // ============================================================

    function getTeamMatchViewModel(tournamentId, roundId, matchId) {
        var matchVM = getMatchViewModel(
            tournamentId,
            roundId,
            matchId,
            { includeParticipants: true }
        );
        if (!matchVM || matchVM.type !== 'team_vs_team') {
            return null;
        }
        return {
            id: matchVM.id,
            index: matchVM.index,
            roundId: matchVM.roundId,
            roundIndex: matchVM.roundIndex,
            status: matchVM.status,
            statusDisplay: matchVM.statusDisplay,
            isComplete: matchVM.isComplete,
            teams: matchVM.teams || []
        };
    }

    // ============================================================
    // MATCH DISPLAY
    // ============================================================

    function getMatchDisplay(tournamentId, roundId, matchId) {
        var normalisedRoundId = normaliseId(roundId);
        var normalisedMatchId = normaliseId(matchId);
        if (normalisedRoundId === null || normalisedMatchId === null) {
            return null;
        }

        var match = Queries.getMatch(
            tournamentId,
            normalisedRoundId,
            normalisedMatchId
        );
        if (!match) { return null; }

        var type = match.type || 'group_exam';
        var participants = Array.isArray(match.participants)
            ? match.participants
            : [];

        var participantDisplays = participants.map(function(id) {
            return buildMatchParticipantVM(
                tournamentId,
                normalisedRoundId,
                normalisedMatchId,
                id,
                match
            );
        });

        var display = {
            id: normalisedMatchId,
            type: type,
            typeLabel: getMatchTypeLabel(type),
            status: match.status || 'pending',
            statusDisplay: getMatchStatusDisplay(match.status || 'pending'),
            isPairExam: match.isPairExam === true,
            isGroupExam: type === 'group_exam',
            isTeamMatch: type === 'team_vs_team',
            participants: participantDisplays,
            isComplete: match.status === 'completed'
        };

        if (match.isPairExam && Array.isArray(match.pairings)) {
            display.pairings = match.pairings.map(function(pair) {
                return pair.map(function(pid) {
                    return buildMatchParticipantVM(
                        tournamentId,
                        normalisedRoundId,
                        normalisedMatchId,
                        pid,
                        match
                    );
                });
            });
        }

        if (type === 'team_vs_team') {
            display.teams = participants.map(function(tid) {
                return buildTeamMatchTeamVM(
                    tournamentId,
                    normalisedRoundId,
                    normalisedMatchId,
                    tid,
                    match
                );
            });
        }

        return display;
    }

    // ============================================================
    // OVERVIEW
    // ============================================================

    function getTournamentOverview(tournamentId) {
        var tournament = Queries.getTournament(tournamentId);
        if (!tournament) { return null; }

        var participants = Queries.getParticipants(tournamentId);
        var rounds = Queries.getRounds(tournamentId);
        var stats = Queries.getTournamentStatistics(tournamentId);

        var activeParticipants = participants.filter(function(p) {
            return !Queries.isParticipantEliminated(tournamentId, p.id);
        });

        var roundStatuses = rounds.map(function(round, index) {
            var matches = Queries.getMatches(tournamentId, round.id);
            var completed = 0;
            for (var i = 0; i < matches.length; i++) {
                if (matches[i].status === 'completed') {
                    completed++;
                }
            }
            return {
                id: round.id,
                index: index,
                roundNumber: round.roundNumber || (index + 1),
                matchCount: matches.length,
                completedCount: completed,
                isComplete: completed === matches.length && matches.length > 0
            };
        });

        var completedRounds = roundStatuses.filter(function(r) {
            return r.isComplete;
        }).length;

        var finalPassers = Queries.getFinalPassers(tournamentId) || [];

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
            finalPasserCount: finalPassers.length,
            finalPassers: finalPassers.map(function(id) {
                return {
                    id: id,
                    name: getParticipantDisplayName(tournamentId, id)
                };
            }),
            eliminationCount: stats.eliminationCount,
            matchCount: stats.matchCount,
            completedMatchCount: stats.completedMatchCount,
            isComplete: completedRounds === rounds.length &&
                rounds.length > 0,
            graduatingClassName: tournament.graduatingClassId
                ? getAcademyClassDisplayName(tournament.graduatingClassId)
                : ''
        };
    }

    // ============================================================
    // ACTIVE TOURNAMENTS VM
    // ============================================================

    function getActiveTournamentsViewModel(options) {
        options = options || {};
        var limit = options.limit || 0;

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
                graduatingClassName: t.graduatingClassId
                    ? getAcademyClassDisplayName(t.graduatingClassId)
                    : ''
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

        // Name resolution
        getParticipantName: getParticipantName,
        getParticipantDisplay: getParticipantDisplay,
        getClassName: getClassName,
        getWinnerName: getWinnerName,   // @deprecated

        // Result helpers
        getOutcomeDisplay: getOutcomeDisplay,
        getOutcomeCategory: getOutcomeCategory,
        getMatchTypeLabel: getMatchTypeLabel,
        getStatusDisplay: getStatusDisplay,
        getMatchStatusDisplay: getMatchStatusDisplay,
        getParticipantTypeLabel: getParticipantTypeLabel,

        // Match-specific views
        getMatchDisplay: getMatchDisplay,
        getPairExamGroupings: getPairExamGroupings,
        getTeamMatchViewModel: getTeamMatchViewModel,

        // Final passers
        getFinalPassersView: getFinalPassersView,

        // Overview
        getTournamentOverview: getTournamentOverview,
        getActiveTournamentsViewModel: getActiveTournamentsViewModel
    };

})();
