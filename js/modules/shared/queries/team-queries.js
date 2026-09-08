/**
 * shared/queries/team-queries.js - Team Queries
 * Read-only team domain queries
 * 
 * IMPORTANT:
 *   - READ ONLY - no mutations
 *   - No dependencies on other modules
 *   - Reads from window.data directly
 * 
 * DEPENDENCIES:
 *   - window.data (canonical state)
 *   - CharacterQueries (for member name resolution)
 */

(function() {
    'use strict';

    if (window.__teamQueriesLoaded) { return; }
    window.__teamQueriesLoaded = true;

    var CharacterQueries = window.CharacterQueries;

    function getTeamData() {
        var data = window.data || {};
        return Array.isArray(data.teams) ? data.teams : [];
    }

    function getTeamById(teamId) {
        if (!teamId) { return null; }
        var target = String(teamId);
        var teams = getTeamData();
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (team && typeof team === 'object' && String(team.id) === target) {
                return team;
            }
        }
        return null;
    }

    function getTeamName(teamId) {
        if (!teamId) { return 'Unassigned'; }
        var team = getTeamById(teamId);
        return team ? team.name : 'Unknown Team';
    }

    function isTeamOperational(team) {
        if (!team || typeof team !== 'object') { return false; }
        if (!team.status) { return true; }
        return team.status !== 'deleted';
    }

    function isTeamActive(team) {
        if (!team || typeof team !== 'object') { return false; }
        return team.status === 'active';
    }

    function isValidTeamStatus(status) {
        var valid = ['active', 'inactive', 'deprecated', 'deleted'];
        return valid.indexOf(status) !== -1;
    }

    function normalizeTeamType(type) {
        if (!type) { return null; }
        var normalized = String(type).toLowerCase().trim();
        if (normalized === 'internship') { return 'professional'; }
        var valid = ['academic', 'professional', 'temporary', 'civilian'];
        return valid.indexOf(normalized) !== -1 ? normalized : null;
    }

    function getTypeLabel(type) {
        var normalized = normalizeTeamType(type);
        var labels = {
            'academic': 'Academic',
            'professional': 'Professional',
            'temporary': 'Temporary',
            'civilian': 'Civilian'
        };
        return labels[normalized] || String(type || 'Unknown');
    }

    function getTeams(type, status, includeDeleted) {
        var teams = getTeamData();
        var result = [];
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (team && typeof team === 'object') { result.push(team); }
        }

        if (type) {
            var normalizedType = normalizeTeamType(type);
            if (normalizedType === null) { return []; }
            var filtered = [];
            for (var j = 0; j < result.length; j++) {
                var t = result[j];
                if (normalizeTeamType(t.type) === normalizedType) { filtered.push(t); }
            }
            result = filtered;
        }

        if (status === 'active') {
            var filtered2 = [];
            for (var k = 0; k < result.length; k++) {
                if (isTeamActive(result[k])) { filtered2.push(result[k]); }
            }
            result = filtered2;
        } else if (status === 'operational') {
            var filtered3 = [];
            for (var l = 0; l < result.length; l++) {
                if (isTeamOperational(result[l])) { filtered3.push(result[l]); }
            }
            result = filtered3;
        }

        if (!includeDeleted) {
            var filtered4 = [];
            for (var m = 0; m < result.length; m++) {
                if (result[m].status !== 'deleted') { filtered4.push(result[m]); }
            }
            result = filtered4;
        }

        result.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        return result;
    }

    function getAllOperationalTeams() {
        return getTeams(null, 'operational', false);
    }

    function getAllActiveTeams() {
        return getTeams(null, 'active', false);
    }

    function getTeamsByType(type, status) {
        return getTeams(type, status || 'operational', false);
    }

    function getActiveTeamMembers(team, period) {
        if (!team || !Array.isArray(team.members)) { return []; }
        var periodNum = parseInt(period, 10);
        if (isNaN(periodNum)) { return []; }
        var result = [];
        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (!member || typeof member !== 'object') { continue; }
            var join = parseInt(member.joinPeriod, 10);
            var leave = parseInt(member.leavePeriod, 10);
            var hasJoin = member.joinPeriod !== undefined && member.joinPeriod !== null && member.joinPeriod !== '';
            var hasLeave = member.leavePeriod !== undefined && member.leavePeriod !== null && member.leavePeriod !== '';
            if (hasJoin && isNaN(join)) { continue; }
            if (hasLeave && isNaN(leave)) { continue; }
            var joined = !hasJoin || join <= periodNum;
            var notLeft = !hasLeave || leave >= periodNum;
            if (joined && notLeft) { result.push(member); }
        }
        return result;
    }

    function getActiveTeamMemberCount(team, period) {
        return getActiveTeamMembers(team, period).length;
    }

    function isCharacterInTeamAtPeriod(team, characterId, period) {
        if (!team || !characterId) { return false; }
        var members = getActiveTeamMembers(team, period);
        var target = String(characterId);
        for (var i = 0; i < members.length; i++) {
            if (members[i] && String(members[i].characterId) === target) {
                return true;
            }
        }
        return false;
    }

    function getTeamMember(team, characterId) {
        if (!team || !Array.isArray(team.members)) { return null; }
        var target = String(characterId);
        for (var i = 0; i < team.members.length; i++) {
            var member = team.members[i];
            if (member && typeof member === 'object' && String(member.characterId) === target) {
                return member;
            }
        }
        return null;
    }

    function getTeamsForCharacter(characterId, period, teamType) {
        if (!characterId) { return []; }
        var periodNum = parseInt(period, 10);
        if (isNaN(periodNum)) { return []; }
        var teams = getTeamData();
        var result = [];
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || typeof team !== 'object') { continue; }
            if (!isTeamOperational(team)) { continue; }
            if (teamType) {
                var normalizedType = normalizeTeamType(teamType);
                if (normalizedType !== null && normalizeTeamType(team.type) !== normalizedType) {
                    continue;
                }
            }
            if (isCharacterInTeamAtPeriod(team, characterId, periodNum)) {
                result.push(team);
            }
        }
        result.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });
        return result;
    }

    function getCharacterTeamMembership(teamId, characterId) {
        var team = getTeamById(teamId);
        if (!team) { return null; }
        return getTeamMember(team, characterId);
    }

    function getTeamPeriodDisplay(team) {
        if (!team) { return '-'; }
        var normalizedType = normalizeTeamType(team.type);
        var start = team.startPeriod || '';
        var end = team.endPeriod || '';
        if (normalizedType === 'academic') {
            if (start && end) { return 'Wk ' + start + ' - Wk ' + end; }
            if (start) { return 'From Wk ' + start; }
            return '-';
        } else {
            if (start && end) { return start + ' - ' + end; }
            if (start) { return 'From ' + start; }
            return '-';
        }
    }

    function getTeamsByClass(classId, status) {
        if (!classId) { return []; }
        var teams = getTeams(null, status || 'operational', false);
        var target = String(classId);
        var result = [];
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (team && team.type === 'academic' && String(team.classId) === target) {
                result.push(team);
            }
        }
        return result;
    }

    window.TeamQueries = {
        getTeamById: getTeamById,
        getTeamName: getTeamName,
        isTeamOperational: isTeamOperational,
        isTeamActive: isTeamActive,
        isValidTeamStatus: isValidTeamStatus,
        normalizeTeamType: normalizeTeamType,
        getTypeLabel: getTypeLabel,
        getTeams: getTeams,
        getAllOperationalTeams: getAllOperationalTeams,
        getAllActiveTeams: getAllActiveTeams,
        getTeamsByType: getTeamsByType,
        getTeamsByClass: getTeamsByClass,
        getActiveTeamMembers: getActiveTeamMembers,
        getActiveTeamMemberCount: getActiveTeamMemberCount,
        isCharacterInTeamAtPeriod: isCharacterInTeamAtPeriod,
        getTeamMember: getTeamMember,
        getTeamsForCharacter: getTeamsForCharacter,
        getCharacterTeamMembership: getCharacterTeamMembership,
        getTeamPeriodDisplay: getTeamPeriodDisplay
    };

})();
