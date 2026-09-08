/**
 * modules/teams/team-aggregator.js - Team Aggregator
 * Team's integration boundary with external domains
 * 
 * This module provides Team-specific projections by composing
 * data from TeamQueries and external queries.
 * 
 * IMPORTANT:
 *   - Projection builder, not a query registry
 *   - Composes TeamQueries + CharacterQueries + AcademyQueries
 *   - Returns Team-shaped view models
 *   - Never exposes external query APIs directly
 *   - Never mutates data
 *   - No UI dependencies
 *   - No passthrough methods
 * 
 * API:
 *   - getTeamViewModel(teamId, options)
 *   - getTeamListViewModel(options)
 *   - getTeamMembersViewModel(teamId, period)
 *   - getTeamPageViewModel(options)
 *   - getCandidateCharactersAtPeriod(teamType, period)
 * 
 * DEPENDENCIES:
 *   - window.TeamQueries (from team-queries.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.AcademyQueries (from academy-queries.js) - MANDATORY
 *   - window.TeamConstants (from team-constants.js) - MANDATORY
 * 
 * USAGE:
 *   var vm = TeamAggregator.getTeamViewModel('team_123');
 *   var list = TeamAggregator.getTeamListViewModel({ type: 'professional' });
 *   var members = TeamAggregator.getTeamMembersViewModel('team_123', 5);
 *   var candidates = TeamAggregator.getCandidateCharactersAtPeriod('professional', 2025);
 */

(function() {
    'use strict';

    if (window.__teamAggregatorLoaded) {
        return;
    }
    window.__teamAggregatorLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var TeamQueries = window.TeamQueries;
    var CharacterQueries = window.CharacterQueries;
    var AcademyQueries = window.AcademyQueries;
    var TeamConstants = window.TeamConstants;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!TeamQueries || typeof TeamQueries.getTeamById !== 'function') {
            missing.push('TeamQueries.getTeamById');
        }
        if (!TeamQueries || typeof TeamQueries.getTeams !== 'function') {
            missing.push('TeamQueries.getTeams');
        }
        if (!TeamQueries || typeof TeamQueries.getActiveTeamMembers !== 'function') {
            missing.push('TeamQueries.getActiveTeamMembers');
        }
        if (!TeamQueries || typeof TeamQueries.getCurrentRank !== 'function') {
            missing.push('TeamQueries.getCurrentRank');
        }
        if (!TeamQueries || typeof TeamQueries.getTeamPeriodDisplay !== 'function') {
            missing.push('TeamQueries.getTeamPeriodDisplay');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCurrentStatus !== 'function') {
            missing.push('CharacterQueries.getCurrentStatus');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterAge !== 'function') {
            missing.push('CharacterQueries.getCharacterAge');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacters !== 'function') {
            missing.push('CharacterQueries.getCharacters');
        }

        if (!AcademyQueries || typeof AcademyQueries.getClassDisplayName !== 'function') {
            missing.push('AcademyQueries.getClassDisplayName');
        }

        if (!TeamConstants) {
            missing.push('TeamConstants');
        }

        if (missing.length > 0) {
            console.warn('[TeamAggregator] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HELPERS
    // ============================================================

    function getCharacterDisplayName(charId) {
        if (!charId) {
            return 'Unknown';
        }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return 'Unknown';
        }
        return CharacterQueries.getDisplayName(char);
    }

    function getCharacterStatus(charId) {
        if (!charId) {
            return '';
        }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return '';
        }
        return CharacterQueries.getCurrentStatus(char);
    }

    function getCharacterAge(charId) {
        if (!charId) {
            return '';
        }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return '';
        }
        return CharacterQueries.getCharacterAge(char);
    }

    function getCharacterDeceased(charId) {
        if (!charId) {
            return false;
        }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return false;
        }
        return char.deceased || false;
    }

    function getClassDisplayName(classId) {
        if (!classId) {
            return '';
        }
        return AcademyQueries.getClassDisplayName(classId) || '';
    }

    function getTypeLabel(type) {
        return TeamConstants.getTypeLabel(type);
    }

    function getPeriodLabel(type) {
        return TeamConstants.getPeriodLabel(type);
    }

    function getPeriodBounds(type) {
        return TeamConstants.getPeriodBounds(type);
    }

    // ============================================================
    // TEAM VIEW MODEL
    // ============================================================

    /**
     * Get a complete view model for a single team.
     * 
     * @param {string} teamId - Team ID
     * @param {object} options - Options
     * @param {number} options.period - Period for member resolution (default: 1)
     * @param {boolean} options.includeMembers - Include member details (default: true)
     * @param {boolean} options.includeRankings - Include ranking history (default: true)
     * @param {boolean} options.includeClass - Include class display name (default: true)
     * @returns {object|null} Team view model or null
     */
    function getTeamViewModel(teamId, options) {
        if (!teamId) {
            return null;
        }

        options = options || {};
        var period = options.period || 1;
        var includeMembers = options.includeMembers !== false;
        var includeRankings = options.includeRankings !== false;
        var includeClass = options.includeClass !== false;

        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return null;
        }

        var typeLabel = getTypeLabel(team.type);
        var periodLabel = getPeriodLabel(team.type);
        var type = team.type || 'professional';

        var classDisplay = '';
        if (includeClass && team.classId) {
            classDisplay = getClassDisplayName(team.classId);
        }

        var currentRank = TeamQueries.getCurrentRank(team);

        var periodDisplay = TeamQueries.getTeamPeriodDisplay(team);

        // Build view model
        var viewModel = {
            id: team.id,
            name: team.name,
            type: team.type,
            typeLabel: typeLabel,
            periodLabel: periodLabel,
            startPeriod: team.startPeriod || '',
            endPeriod: team.endPeriod || '',
            periodDisplay: periodDisplay,
            status: team.status || 'active',
            currentRank: currentRank,
            classId: team.classId || null,
            classDisplay: classDisplay,
            teamNumber: team.teamNumber || '',
            temporaryMission: team.temporaryMission || null,
            nameHistory: Array.isArray(team.nameHistory) ? team.nameHistory.slice() : [],
            memberCount: team.members ? team.members.length : 0,
            isActive: team.status === 'active',
            isOperational: TeamQueries.isTeamOperational(team),
            createdAt: team.createdAt || ''
        };

        // Include members if requested
        if (includeMembers) {
            var members = TeamQueries.getActiveTeamMembers(team, period);
            viewModel.members = members.map(function(member) {
                return {
                    characterId: member.characterId,
                    displayName: getCharacterDisplayName(member.characterId),
                    status: getCharacterStatus(member.characterId),
                    age: getCharacterAge(member.characterId),
                    deceased: getCharacterDeceased(member.characterId),
                    role: member.role || 'Member',
                    joinPeriod: member.joinPeriod || '',
                    leavePeriod: member.leavePeriod || '',
                    active: true
                };
            });
            viewModel.activeMemberCount = viewModel.members.length;
            viewModel.totalMemberCount = team.members ? team.members.length : 0;
        }

        // Include rankings if requested
        if (includeRankings) {
            var rankingSummary = TeamQueries.getRankingSummary(team);
            viewModel.rankingHistory = rankingSummary.history;
            viewModel.rankingCount = rankingSummary.total;
            viewModel.currentRank = rankingSummary.current;
            viewModel.mostRecentRanking = rankingSummary.mostRecent;
        }

        return viewModel;
    }

    // ============================================================
    // TEAM LIST VIEW MODEL
    // ============================================================

    /**
     * Get a view model for a list of teams.
     * Collection-level projection - avoids per-team N+1 queries.
     * 
     * @param {object} options - Options
     * @param {string} options.type - Team type filter
     * @param {string} options.status - Team status filter
     * @param {number} options.period - Period for member count
     * @param {boolean} options.includeInactive - Include inactive teams
     * @param {string} options.search - Search by name
     * @param {string} options.sort - Sort field (name, type, rank, members)
     * @param {string} options.sortDirection - 'asc' or 'desc'
     * @returns {object} { teams: Array, total: number, filtered: number }
     */
    function getTeamListViewModel(options) {
        options = options || {};
        var type = options.type || null;
        var status = options.status || null;
        var period = options.period || 1;
        var includeInactive = options.includeInactive || false;
        var search = options.search || '';
        var sort = options.sort || 'name';
        var sortDirection = options.sortDirection || 'asc';

        // Get teams from TeamQueries
        var teams = TeamQueries.getTeams(type, status, includeInactive);

        // Apply search filter
        if (search) {
            var lowerSearch = search.toLowerCase();
            teams = teams.filter(function(team) {
                return team.name && team.name.toLowerCase().indexOf(lowerSearch) !== -1;
            });
        }

        // Build list items
        var listItems = teams.map(function(team) {
            var activeMembers = TeamQueries.getActiveTeamMembers(team, period);
            var currentRank = TeamQueries.getCurrentRank(team);
            var typeLabel = getTypeLabel(team.type);

            return {
                id: team.id,
                name: team.name,
                type: team.type,
                typeLabel: typeLabel,
                status: team.status || 'active',
                currentRank: currentRank,
                activeMemberCount: activeMembers.length,
                totalMemberCount: team.members ? team.members.length : 0,
                periodDisplay: TeamQueries.getTeamPeriodDisplay(team),
                isActive: team.status === 'active',
                isOperational: TeamQueries.isTeamOperational(team),
                classDisplay: team.classId ? getClassDisplayName(team.classId) : '',
                teamNumber: team.teamNumber || '',
                temporaryMission: team.temporaryMission || null,
                createdAt: team.createdAt || '',
                // Raw team reference for detail expansion
                _team: team
            };
        });

        // Sort
        var total = listItems.length;

        listItems.sort(function(a, b) {
            var aVal, bVal;

            switch (sort) {
                case 'name':
                    aVal = a.name || '';
                    bVal = b.name || '';
                    break;
                case 'type':
                    aVal = a.typeLabel || '';
                    bVal = b.typeLabel || '';
                    break;
                case 'rank':
                    aVal = parseInt(a.currentRank, 10) || 999;
                    bVal = parseInt(b.currentRank, 10) || 999;
                    break;
                case 'members':
                    aVal = a.activeMemberCount;
                    bVal = b.activeMemberCount;
                    break;
                case 'status':
                    aVal = a.isActive ? 0 : 1;
                    bVal = b.isActive ? 0 : 1;
                    break;
                default:
                    aVal = a.name || '';
                    bVal = b.name || '';
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

        return {
            teams: listItems,
            total: total,
            filtered: listItems.length
        };
    }

    // ============================================================
    // TEAM MEMBERS VIEW MODEL
    // ============================================================

    /**
     * Get a view model for team members at a specific period.
     * 
     * @param {string} teamId - Team ID
     * @param {number} period - Period for member resolution
     * @returns {object|null} Members view model or null
     */
    function getTeamMembersViewModel(teamId, period) {
        if (!teamId) {
            return null;
        }

        var periodNum = period || 1;

        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return null;
        }

        var typeLabel = getTypeLabel(team.type);
        var periodLabel = getPeriodLabel(team.type);

        // Get active members at period
        var activeMembers = TeamQueries.getActiveTeamMembers(team, periodNum);

        // Get all members for full history
        var allMembers = Array.isArray(team.members) ? team.members : [];

        var memberViewModels = allMembers.map(function(member) {
            var displayName = getCharacterDisplayName(member.characterId);
            var status = getCharacterStatus(member.characterId);
            var age = getCharacterAge(member.characterId);
            var deceased = getCharacterDeceased(member.characterId);

            // Determine if member is active at this period
            var join = parseInt(member.joinPeriod, 10);
            var leave = parseInt(member.leavePeriod, 10);
            var hasJoin = member.joinPeriod !== undefined && member.joinPeriod !== null && member.joinPeriod !== '';
            var hasLeave = member.leavePeriod !== undefined && member.leavePeriod !== null && member.leavePeriod !== '';

            var joined = !hasJoin || join <= periodNum;
            var notLeft = !hasLeave || leave >= periodNum;
            var isActiveAtPeriod = joined && notLeft;

            return {
                characterId: member.characterId,
                displayName: displayName,
                status: status,
                age: age,
                deceased: deceased,
                role: member.role || 'Member',
                joinPeriod: member.joinPeriod || '',
                leavePeriod: member.leavePeriod || '',
                activeAtPeriod: isActiveAtPeriod
            };
        });

        // Sort: active at period first, then by name
        memberViewModels.sort(function(a, b) {
            if (a.activeAtPeriod && !b.activeAtPeriod) {
                return -1;
            }
            if (!a.activeAtPeriod && b.activeAtPeriod) {
                return 1;
            }
            return a.displayName.localeCompare(b.displayName);
        });

        return {
            teamId: team.id,
            teamName: team.name,
            teamType: team.type,
            typeLabel: typeLabel,
            period: periodNum,
            periodLabel: periodLabel,
            activeCount: activeMembers.length,
            totalCount: allMembers.length,
            members: memberViewModels
        };
    }

    // ============================================================
    // TEAM PAGE VIEW MODEL
    // ============================================================

    /**
     * Get a complete team page view model.
     * Combines list and detail projections for the main team page.
     * 
     * @param {object} options - Options
     * @param {string} options.type - Team type filter
     * @param {string} options.status - Team status filter
     * @param {number} options.period - Period for member counts
     * @param {string} options.expandedTeamId - Team to expand
     * @param {string} options.search - Search by name
     * @returns {object} Team page view model
     */
    function getTeamPageViewModel(options) {
        options = options || {};
        var type = options.type || 'professional';
        var status = options.status || null;
        var period = options.period || 1;
        var expandedTeamId = options.expandedTeamId || null;
        var search = options.search || '';

        // Get list view model
        var listVM = getTeamListViewModel({
            type: type,
            status: status,
            period: period,
            search: search
        });

        // If a team is expanded, get its detail
        var expandedTeam = null;
        if (expandedTeamId) {
            expandedTeam = getTeamViewModel(expandedTeamId, {
                period: period,
                includeMembers: true,
                includeRankings: true
            });
        }

        // Get counts by type for tab labels
        var allProfessional = TeamQueries.getTeams('professional', null, false);
        var allTemporary = TeamQueries.getTeams('temporary', null, false);
        var allCivilian = TeamQueries.getTeams('civilian', null, false);

        return {
            activeTab: type,
            period: period,
            teams: listVM.teams,
            totalTeams: listVM.total,
            filteredTeams: listVM.filtered,
            expandedTeam: expandedTeam,
            expandedTeamId: expandedTeamId,
            counts: {
                professional: allProfessional.length,
                temporary: allTemporary.length,
                civilian: allCivilian.length
            },
            types: {
                professional: {
                    label: getTypeLabel('professional'),
                    periodLabel: getPeriodLabel('professional'),
                    teams: allProfessional
                },
                temporary: {
                    label: getTypeLabel('temporary'),
                    periodLabel: getPeriodLabel('temporary'),
                    teams: allTemporary
                },
                civilian: {
                    label: getTypeLabel('civilian'),
                    periodLabel: getPeriodLabel('civilian'),
                    teams: allCivilian
                }
            }
        };
    }

    // ============================================================
    // CANDIDATE CHARACTERS (moved from team-members.js)
    // ============================================================

    /**
     * Get candidate characters for a team type at a period.
     * This crosses Team + Character domains.
     * 
     * @param {string} teamType - Team type ('professional', 'temporary', 'civilian', 'academic')
     * @param {number|string} period - Period to check
     * @returns {array} Array of character objects
     */
    function getCandidateCharactersAtPeriod(teamType, period) {
        var characters = CharacterQueries.getCharacters() || [];
        var periodNum = parseInt(period, 10);
        if (isNaN(periodNum) || periodNum < 0) {
            return [];
        }

        // Validate period against team type
        var bounds = getPeriodBounds(teamType);
        if (periodNum < bounds.min || periodNum > bounds.max) {
            return [];
        }

        // Determine eligible statuses based on team type
        var eligibleStatuses = [];
        if (teamType === 'academic') {
            eligibleStatuses = ['trainee', 'rookie', 'junior', 'student'];
        } else if (teamType === 'civilian') {
            eligibleStatuses = ['civilian'];
        } else {
            eligibleStatuses = ['trainee', 'rookie', 'junior', 'senior', 'instructor', 'support'];
        }

        var result = [];
        for (var i = 0; i < characters.length; i++) {
            var char = characters[i];
            if (!char) {
                continue;
            }

            var status = CharacterQueries.getCurrentStatus(char);
            if (!status) {
                continue;
            }

            var isEligible = false;
            for (var j = 0; j < eligibleStatuses.length; j++) {
                if (status.toLowerCase() === eligibleStatuses[j].toLowerCase()) {
                    isEligible = true;
                    break;
                }
            }

            if (isEligible) {
                result.push(char);
            }
        }

        // Sort by display name
        result.sort(function(a, b) {
            var nameA = CharacterQueries.getDisplayName(a);
            var nameB = CharacterQueries.getDisplayName(b);
            return nameA.localeCompare(nameB);
        });

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamAggregator = {
        // Projections
        getTeamViewModel: getTeamViewModel,
        getTeamListViewModel: getTeamListViewModel,
        getTeamMembersViewModel: getTeamMembersViewModel,
        getTeamPageViewModel: getTeamPageViewModel,

        // Cross-domain
        getCandidateCharactersAtPeriod: getCandidateCharactersAtPeriod,

        // Helpers (exposed for views that need formatting)
        getCharacterDisplayName: getCharacterDisplayName,
        getCharacterStatus: getCharacterStatus,
        getCharacterAge: getCharacterAge,
        getCharacterDeceased: getCharacterDeceased,
        getClassDisplayName: getClassDisplayName,
        getTypeLabel: getTypeLabel,
        getPeriodLabel: getPeriodLabel,
        getPeriodBounds: getPeriodBounds
    };

})();