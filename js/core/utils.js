/**
 * js/core/utils.js - Utility Functions
 * Shared helper functions used across the application
 * Path: js/core/utils.js
 */

function generateId(prefix) {
    prefix = prefix || 'id';
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function getWeekBlock(weekNum) {
    var num = parseInt(weekNum) || 1;
    var start = Math.floor((num - 1) / 2) * 2 + 1;
    return {
        start: start,
        end: start + 1,
        label: start + '-' + (start + 1)
    };
}

function getRankingBlock(period) {
    var num = parseInt(period);
    if (isNaN(num)) return null;
    return getWeekBlock(num);
}

function calculateAge(char) {
    if (!char || !char.birthYear) return null;
    var birthYear = parseInt(char.birthYear);
    if (isNaN(birthYear)) return null;
    
    if (char.deceased) {
        if (char.deathAge) return parseInt(char.deathAge);
        if (char.deathYear) {
            var deathYear = parseInt(char.deathYear);
            if (!isNaN(deathYear)) return deathYear - birthYear;
        }
        return null;
    }
    
    var currentYear = window.data ? window.data.currentYear : new Date().getFullYear();
    return currentYear - birthYear;
}

function getCharacterAge(char) {
    var age = calculateAge(char);
    return age !== null ? age + ' yrs' : '-';
}

function getDisplayName(char) {
    if (!char) return 'Unknown';
    
    var firstName = char.firstName || '';
    var lastName = char.lastName || '';
    var nickname = char.nickname || '';
    var alias = char.alias || '';
    var format = char.nameFormat || 'firstlast';
    
    switch(format) {
        case 'lastfirst':
            return lastName + ', ' + firstName;
        case 'nicklast':
            return (nickname || firstName) + ' ' + lastName;
        case 'firstnick':
            return firstName + ' "' + (nickname || '') + '"' + (lastName ? ' ' + lastName : '');
        case 'alias':
            return alias || firstName + ' ' + lastName;
        case 'firstlast':
        default:
            return firstName + ' ' + lastName;
    }
}

function getFullName(char) {
    if (!char) return 'Unknown';
    var parts = [];
    if (char.firstName) parts.push(char.firstName);
    if (char.middleName) parts.push(char.middleName);
    if (char.lastName) parts.push(char.lastName);
    return parts.length > 0 ? parts.join(' ') : 'Unknown';
}

function getNicknameOrFirstName(char) {
    if (!char) return 'Unknown';
    return char.nickname || char.firstName || 'Unknown';
}

function getCurrentStatus(char) {
    if (!char || !char.careerStatus || char.careerStatus.length === 0) {
        return 'Civilian';
    }
    
    var currentYear = window.data ? window.data.currentYear : new Date().getFullYear();
    var mostRecentStatus = 'Civilian';
    var mostRecentStart = -Infinity;
    var hasExactMatch = false;
    
    char.careerStatus.forEach(function(status) {
        var start = parseInt(status.startYear);
        var end = status.endYear ? parseInt(status.endYear) : null;
        
        if (!isNaN(start)) {
            if (start <= currentYear && (end === null || currentYear <= end)) {
                mostRecentStatus = status.status.charAt(0).toUpperCase() + status.status.slice(1);
                hasExactMatch = true;
            }
        }
    });
    
    if (hasExactMatch) {
        return mostRecentStatus;
    }
    
    char.careerStatus.forEach(function(status) {
        var start = parseInt(status.startYear);
        var end = status.endYear ? parseInt(status.endYear) : null;
        
        if (!isNaN(start) && start <= currentYear) {
            if (start > mostRecentStart) {
                mostRecentStart = start;
                mostRecentStatus = status.status.charAt(0).toUpperCase() + status.status.slice(1);
            }
        }
    });
    
    var allEnded = true;
    char.careerStatus.forEach(function(status) {
        var start = parseInt(status.startYear);
        var end = status.endYear ? parseInt(status.endYear) : null;
        if (!isNaN(start) && start <= currentYear && (end === null || end >= currentYear)) {
            allEnded = false;
        }
    });
    
    if (allEnded && mostRecentStatus !== 'Civilian' && mostRecentStart > -Infinity) {
        return mostRecentStatus + ' (Former)';
    }
    
    return mostRecentStatus;
}

function getCharacterTeamCount(charId) {
    var count = 0;
    var teams = window.data ? window.data.teams : [];
    teams.forEach(function(team) {
        if (team.members && team.members.some(function(m) { return String(m.characterId) === String(charId); })) {
            count++;
        }
    });
    return count > 0 ? count : '-';
}

function getCharacterNameById(charId) {
    if (!charId) return 'Unknown';
    var chars = window.data ? window.data.characters : [];
    var char = chars.find(function(c) { return String(c.id) === String(charId); });
    if (char) {
        return getDisplayName(char);
    }
    return 'Unknown';
}

function getCharacterById(charId) {
    if (!charId) return null;
    var chars = window.data ? window.data.characters : [];
    return chars.find(function(c) { return String(c.id) === String(charId); });
}

function getTeamName(teamId) {
    if (!teamId) return 'Unassigned';
    var teams = window.data ? window.data.teams : [];
    var team = teams.find(function(t) { return String(t.id) === String(teamId); });
    return team ? team.name : 'Unknown Team';
}

function getTeamById(teamId) {
    if (!teamId) return null;
    var teams = window.data ? window.data.teams : [];
    return teams.find(function(t) { return String(t.id) === String(teamId); });
}

function getDiscipline(id) {
    if (!window.data || !window.data.curriculum || !window.data.curriculum.disciplines) return null;
    return window.data.curriculum.disciplines.find(function(d) { return String(d.id) === String(id); });
}

function getAvailableDisciplines(week) {
    if (!window.data || !window.data.curriculum || !window.data.curriculum.disciplines) return [];
    var weekNum = parseInt(week) || 1;
    return window.data.curriculum.disciplines.filter(function(d) {
        var start = parseInt(d.startWeek);
        var end = parseInt(d.endWeek);
        return !isNaN(start) && start <= weekNum && (isNaN(end) || end >= weekNum);
    });
}

function getStudents() {
    if (!window.data || !window.data.characters) return [];
    return window.data.characters.filter(function(c) {
        if (c.deceased) return false;
        var status = getCurrentStatus(c).toLowerCase();
        return status === 'trainee' || status === 'rookie' || 
               status === 'junior' || status === 'student' ||
               status.startsWith('trainee') || status.startsWith('rookie') || 
               status.startsWith('junior') || status.startsWith('student');
    }).sort(function(a, b) { return a.firstName.localeCompare(b.firstName); });
}

function getInstructors() {
    if (!window.data || !window.data.characters) return [];
    return window.data.characters.filter(function(c) {
        if (c.deceased) return false;
        var status = getCurrentStatus(c).toLowerCase();
        return status === 'instructor' || status === 'teacher' || 
               status === 'professor' || status === 'senior' ||
               status.startsWith('instructor') || status.startsWith('teacher') ||
               status.startsWith('professor') || status.startsWith('senior');
    }).sort(function(a, b) { return a.firstName.localeCompare(b.firstName); });
}

function getStudentSchedule(studentId, week) {
    if (!window.data || !window.data.curriculum) {
        return {};
    }
    if (!window.data.curriculum.schedules) {
        window.data.curriculum.schedules = {};
    }
    if (!window.data.curriculum.schedules[studentId]) {
        window.data.curriculum.schedules[studentId] = {};
    }
    if (!window.data.curriculum.schedules[studentId][week]) {
        window.data.curriculum.schedules[studentId][week] = {};
    }
    return window.data.curriculum.schedules[studentId][week];
}

function isCharacterEliminated(charId, week) {
    var char = getCharacterById(charId);
    if (!char) return false;
    if (char.deceased) return true;
    
    if (char.eliminatedWeeks && char.eliminatedWeeks.length > 0) {
        var weekNum = parseInt(week) || 1;
        for (var i = 0; i < char.eliminatedWeeks.length; i++) {
            var elimWeek = parseInt(char.eliminatedWeeks[i]);
            if (!isNaN(elimWeek) && elimWeek <= weekNum) {
                return true;
            }
        }
    }
    return false;
}

function getEliminatedCharacters(week) {
    var weekNum = parseInt(week) || 1;
    var result = [];
    var chars = window.data ? window.data.characters : [];
    chars.forEach(function(char) {
        if (isCharacterEliminated(char.id, weekNum)) {
            result.push(char.id);
        }
    });
    return result;
}

function getActiveTeamMemberCount(team, week) {
    if (!team || !team.members) return 0;
    var weekNum = parseInt(week) || 1;
    var count = 0;
    team.members.forEach(function(member) {
        var join = parseInt(member.joinPeriod);
        var leave = parseInt(member.leavePeriod);
        if (!isNaN(join) && join <= weekNum && (isNaN(leave) || leave >= weekNum)) {
            count++;
        }
    });
    return count;
}

function getActiveTeamMembers(team, week) {
    if (!team || !team.members) return [];
    var weekNum = parseInt(week) || 1;
    var result = [];
    team.members.forEach(function(member) {
        var join = parseInt(member.joinPeriod);
        var leave = parseInt(member.leavePeriod);
        if (!isNaN(join) && join <= weekNum && (isNaN(leave) || leave >= weekNum)) {
            result.push(member);
        }
    });
    return result;
}

function getParticipantName(participant, tourn) {
    if (!participant) return 'Unknown';
    
    if (typeof participant === 'string') {
        var team = getTeamById(participant);
        if (team) return team.name;
        var char = getCharacterById(participant);
        if (char) return getDisplayName(char);
        return participant;
    }
    
    if (participant.type === 'char') {
        var char = getCharacterById(participant.id);
        if (char) return getDisplayName(char);
        for (var i = 0; i < (window.data ? window.data.characters.length : 0); i++) {
            if (String(window.data.characters[i].id) === String(participant.id)) {
                return getDisplayName(window.data.characters[i]);
            }
        }
        return 'Unknown Character';
    } else if (participant.type === 'team') {
        var team = getTeamById(participant.id);
        if (team) return team.name;
        for (var i = 0; i < (window.data ? window.data.teams.length : 0); i++) {
            if (String(window.data.teams[i].id) === String(participant.id)) {
                return window.data.teams[i].name;
            }
        }
        return 'Unknown Team';
    }
    
    return 'Unknown';
}

function getActiveTeamsForWeek(week, excludeTournamentId) {
    var weekNum = parseInt(week) || 1;
    var block = getWeekBlock(weekNum);
    var teams = window.data ? window.data.teams : [];
    
    return teams.filter(function(team) {
        if (team.status === 'deleted' || team.status === 'inactive') return false;
        if (team.type !== 'academic') return false;
        var start = parseInt(team.startPeriod);
        var end = parseInt(team.endPeriod);
        if (isNaN(start)) return false;
        return start <= block.end && (isNaN(end) || end >= block.start);
    }).sort(function(a, b) { return a.name.localeCompare(b.name); });
}

function getAllActiveTeams(excludeTournamentId) {
    var teams = window.data ? window.data.teams : [];
    return teams.filter(function(team) {
        if (team.status === 'deleted' || team.status === 'inactive') return false;
        return true;
    }).sort(function(a, b) { return a.name.localeCompare(b.name); });
}

function getTeamsByType(type, status) {
    var teams = window.data ? window.data.teams : [];
    teams = teams.filter(function(t) {
        if (t.status === 'deleted') return false;
        if (t.type !== type) return false;
        return true;
    });
    
    if (status === 'active') {
        teams = teams.filter(function(t) { return t.status === 'active'; });
    } else if (status === 'inactive') {
        teams = teams.filter(function(t) { return t.status === 'inactive' || t.status === 'deprecated'; });
    }
    
    return teams.sort(function(a, b) {
        return a.name.localeCompare(b.name);
    });
}

function logActivity(message, type) {
    type = type || 'info';
    if (!window.data) return;
    if (!window.data.activities) window.data.activities = [];
    window.data.activities.unshift({
        id: generateId(),
        message: message,
        type: type,
        timestamp: new Date().toISOString()
    });
    
    if (window.data.activities.length > 100) {
        window.data.activities = window.data.activities.slice(0, 100);
    }
    
    if (typeof window.saveData === 'function') {
        window.saveData().catch(function(err) { /* ignore */ });
    }
}

function getNonCivilianCharacters() {
    if (!window.data || !window.data.characters) return [];
    return window.data.characters.filter(function(c) {
        if (c.deceased) return false;
        var status = getCurrentStatus(c).toLowerCase();
        return status !== 'civilian' && status !== '';
    }).sort(function(a, b) { return a.firstName.localeCompare(b.firstName); });
}

function generateRandomStats() {
    return {
        str: Math.floor(Math.random() * 13) + 6,
        dex: Math.floor(Math.random() * 13) + 6,
        con: Math.floor(Math.random() * 13) + 6,
        int: Math.floor(Math.random() * 13) + 6,
        wis: Math.floor(Math.random() * 13) + 6,
        cha: Math.floor(Math.random() * 13) + 6
    };
}

function generateRandomMagic() {
    var magic = {};
    var types = ['earth','water','fire','air','metal','wood',
                 'blood','bone','mind','morphic','life','death',
                 'space','time','dimension','void','reality','transference'];
    types.forEach(function(key) {
        var roll = Math.random();
        if (roll < 0.4) {
            magic[key] = 0;
        } else if (roll < 0.7) {
            magic[key] = Math.floor(Math.random() * 4) + 1;
        } else if (roll < 0.9) {
            magic[key] = Math.floor(Math.random() * 4) + 5;
        } else {
            magic[key] = Math.floor(Math.random() * 3) + 8;
        }
    });
    return magic;
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    var date = new Date(dateString);
    return date.toLocaleDateString();
}

function truncateString(str, length) {
    if (!str) return '';
    if (str.length <= length) return str;
    return str.substring(0, length) + '...';
}

function debounce(func, wait) {
    var timeout;
    return function() {
        var context = this;
        var args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(function() {
            func.apply(context, args);
        }, wait);
    };
}

function getClassInstructor(studentId, week, day, hour) {
    if (!window.data || !window.data.curriculum || !window.data.curriculum.classInstructors) return null;
    var key = studentId + '_' + week + '_' + day + '_' + hour;
    return window.data.curriculum.classInstructors[key] || null;
}

function setClassInstructor(studentId, week, day, hour, instructorId) {
    if (!window.data || !window.data.curriculum) return;
    if (!window.data.curriculum.classInstructors) {
        window.data.curriculum.classInstructors = {};
    }
    var key = studentId + '_' + week + '_' + day + '_' + hour;
    if (instructorId) {
        window.data.curriculum.classInstructors[key] = instructorId;
    } else {
        delete window.data.curriculum.classInstructors[key];
    }
}

function getClassLabel(studentId, week, day, hour) {
    if (!window.data || !window.data.curriculum || !window.data.curriculum.classLabels) return null;
    var key = studentId + '_' + week + '_' + day + '_' + hour;
    return window.data.curriculum.classLabels[key] || null;
}

function setClassLabel(studentId, week, day, hour, label) {
    if (!window.data || !window.data.curriculum) return;
    if (!window.data.curriculum.classLabels) {
        window.data.curriculum.classLabels = {};
    }
    var key = studentId + '_' + week + '_' + day + '_' + hour;
    if (label) {
        window.data.curriculum.classLabels[key] = label;
    } else {
        delete window.data.curriculum.classLabels[key];
    }
}

function getClassGroupLabel(studentId, week, day, hour) {
    if (!window.data || !window.data.curriculum || !window.data.curriculum.classGroupLabels) return null;
    var key = studentId + '_' + week + '_' + day + '_' + hour;
    return window.data.curriculum.classGroupLabels[key] || null;
}

function setClassGroupLabel(studentId, week, day, hour, groupLabel) {
    if (!window.data || !window.data.curriculum) return;
    if (!window.data.curriculum.classGroupLabels) {
        window.data.curriculum.classGroupLabels = {};
    }
    var key = studentId + '_' + week + '_' + day + '_' + hour;
    if (groupLabel) {
        window.data.curriculum.classGroupLabels[key] = groupLabel;
    } else {
        delete window.data.curriculum.classGroupLabels[key];
    }
}

function getClassDuration(studentId, week, day, hour) {
    if (!window.data || !window.data.curriculum || !window.data.curriculum.classDurations) return null;
    var key = studentId + '_' + week + '_' + day + '_' + hour;
    return window.data.curriculum.classDurations[key] || null;
}

function setClassDuration(studentId, week, day, hour, duration) {
    if (!window.data || !window.data.curriculum) return;
    if (!window.data.curriculum.classDurations) {
        window.data.curriculum.classDurations = {};
    }
    var key = studentId + '_' + week + '_' + day + '_' + hour;
    if (duration && duration > 0) {
        window.data.curriculum.classDurations[key] = duration;
    } else {
        delete window.data.curriculum.classDurations[key];
    }
}

// ============================================================
// CLASS FUNCTIONS
// ============================================================

function getClasses() {
    var data = window.data || {};
    if (!data.classes) {
        data.classes = [];
        return [];
    }
    return data.classes.slice().sort(function(a, b) {
        return a.name.localeCompare(b.name);
    });
}

function getClass(id) {
    if (!id) return null;
    var data = window.data || {};
    if (!data.classes) return null;
    return data.classes.find(function(c) { return String(c.id) === String(id); }) || null;
}

function getClassByName(name) {
    if (!name) return null;
    var data = window.data || {};
    if (!data.classes) return null;
    return data.classes.find(function(c) { return c.name.toLowerCase() === name.toLowerCase(); }) || null;
}

function createClass(name) {
    if (!name || !name.trim()) {
        return { success: false, message: 'Class name is required.' };
    }
    
    var data = window.data || {};
    if (!data.classes) data.classes = [];
    
    var existing = data.classes.find(function(c) { return c.name.toLowerCase() === name.trim().toLowerCase(); });
    if (existing) {
        return { success: false, message: 'A class with this name already exists.' };
    }
    
    var newClass = {
        id: generateId('class'),
        name: name.trim(),
        createdAt: new Date().toISOString()
    };
    
    data.classes.push(newClass);
    window.data = data;
    
    if (typeof window.saveData === 'function') {
        window.saveData().catch(function(err) { /* ignore */ });
    }
    
    return { success: true, class: newClass };
}

function deleteClass(id) {
    if (!id) return { success: false, message: 'Class ID is required.' };
    
    var data = window.data || {};
    if (!data.classes) return { success: false, message: 'No classes found.' };
    
    var cls = data.classes.find(function(c) { return String(c.id) === String(id); });
    if (!cls) {
        return { success: false, message: 'Class not found.' };
    }
    
    var charactersInClass = data.characters ? data.characters.filter(function(c) {
        return c.classIds && c.classIds.some(function(cid) { return String(cid) === String(id); });
    }) : [];
    
    var teamsInClass = data.teams ? data.teams.filter(function(t) {
        return t.type === 'academic' && String(t.classId) === String(id);
    }) : [];
    
    if (charactersInClass.length > 0 || teamsInClass.length > 0) {
        var msg = 'This class has:\n';
        if (charactersInClass.length > 0) {
            msg += '• ' + charactersInClass.length + ' character(s)\n';
        }
        if (teamsInClass.length > 0) {
            msg += '• ' + teamsInClass.length + ' academic team(s)\n';
        }
        msg += '\nDeleting this class will unassign it from all characters and teams. Continue?';
        
        if (!confirm(msg)) {
            return { success: false, message: 'Deletion cancelled.' };
        }
        
        charactersInClass.forEach(function(char) {
            char.classIds = char.classIds.filter(function(cid) { return String(cid) !== String(id); });
        });
        
        teamsInClass.forEach(function(team) {
            team.classId = null;
        });
    }
    
    data.classes = data.classes.filter(function(c) { return String(c.id) !== String(id); });
    window.data = data;
    
    if (typeof window.saveData === 'function') {
        window.saveData().catch(function(err) { /* ignore */ });
    }
    
    if (typeof window.logActivity === 'function') {
        window.logActivity('Deleted class: ' + cls.name);
    }
    
    return { success: true, message: 'Class deleted successfully.' };
}

function getCharactersByClass(classId) {
    if (!classId) return [];
    var data = window.data || {};
    if (!data.characters) return [];
    return data.characters.filter(function(c) {
        return c.classIds && c.classIds.some(function(cid) { return String(cid) === String(classId); });
    });
}

function getTeamsByClass(classId) {
    if (!classId) return [];
    var data = window.data || {};
    if (!data.teams) return [];
    return data.teams.filter(function(t) {
        return t.type === 'academic' && String(t.classId) === String(classId);
    });
}

function getAvailableStudentsForClass(classId, week) {
    if (!classId) return [];
    var weekNum = parseInt(week) || 1;
    var data = window.data || {};
    
    var classChars = getCharactersByClass(classId);
    
    var available = classChars.filter(function(char) {
        if (char.deceased) return false;
        
        var inTeam = false;
        if (data.teams) {
            for (var i = 0; i < data.teams.length; i++) {
                var team = data.teams[i];
                if (team.type !== 'academic') continue;
                if (team.status === 'deleted') continue;
                if (String(team.classId) !== String(classId)) continue;
                
                if (team.members) {
                    for (var j = 0; j < team.members.length; j++) {
                        var member = team.members[j];
                        if (String(member.characterId) === String(char.id)) {
                            var join = parseInt(member.joinPeriod);
                            var leave = parseInt(member.leavePeriod);
                            if (!isNaN(join) && join <= weekNum && (isNaN(leave) || leave >= weekNum)) {
                                inTeam = true;
                                break;
                            }
                        }
                    }
                }
                if (inTeam) break;
            }
        }
        
        return !inTeam;
    });
    
    return available;
}

function getClassOptions() {
    var classes = getClasses();
    var options = [];
    classes.forEach(function(c) {
        var count = getCharactersByClass(c.id).length;
        options.push({
            id: c.id,
            name: c.name,
            count: count
        });
    });
    return options;
}

function getClassDisplayName(classId) {
    var cls = getClass(classId);
    return cls ? cls.name : 'Unassigned';
}

function getCharacterClasses(char) {
    if (!char || !char.classIds) return [];
    var classes = getClasses();
    return classes.filter(function(c) {
        return char.classIds.some(function(cid) { return String(cid) === String(c.id); });
    });
}

function getCharacterClassNames(char) {
    var classes = getCharacterClasses(char);
    return classes.map(function(c) { return c.name; });
}

function addCharacterToClass(charId, classId) {
    if (!charId || !classId) return { success: false, message: 'Character and class are required.' };
    
    var data = window.data || {};
    var char = data.characters.find(function(c) { return String(c.id) === String(charId); });
    if (!char) {
        return { success: false, message: 'Character not found.' };
    }
    
    var cls = getClass(classId);
    if (!cls) {
        return { success: false, message: 'Class not found.' };
    }
    
    if (!char.classIds) char.classIds = [];
    
    if (char.classIds.some(function(cid) { return String(cid) === String(classId); })) {
        return { success: false, message: 'Character is already in this class.' };
    }
    
    char.classIds.push(classId);
    window.data = data;
    
    if (typeof window.saveData === 'function') {
        window.saveData().catch(function(err) { /* ignore */ });
    }
    
    return { success: true, message: 'Character added to class.' };
}

function removeCharacterFromClass(charId, classId) {
    if (!charId || !classId) return { success: false, message: 'Character and class are required.' };
    
    var data = window.data || {};
    var char = data.characters.find(function(c) { return String(c.id) === String(charId); });
    if (!char) {
        return { success: false, message: 'Character not found.' };
    }
    
    if (!char.classIds) char.classIds = [];
    
    if (!char.classIds.some(function(cid) { return String(cid) === String(classId); })) {
        return { success: false, message: 'Character is not in this class.' };
    }
    
    char.classIds = char.classIds.filter(function(cid) { return String(cid) !== String(classId); });
    window.data = data;
    
    if (typeof window.saveData === 'function') {
        window.saveData().catch(function(err) { /* ignore */ });
    }
    
    return { success: true, message: 'Character removed from class.' };
}

// ============================================================
// EXPOSE ALL FUNCTIONS
// ============================================================

window.generateId = generateId;
window.getWeekBlock = getWeekBlock;
window.getRankingBlock = getRankingBlock;
window.calculateAge = calculateAge;
window.getCharacterAge = getCharacterAge;
window.getDisplayName = getDisplayName;
window.getFullName = getFullName;
window.getNicknameOrFirstName = getNicknameOrFirstName;
window.getCurrentStatus = getCurrentStatus;
window.getCharacterTeamCount = getCharacterTeamCount;
window.getCharacterNameById = getCharacterNameById;
window.getCharacterById = getCharacterById;
window.getTeamName = getTeamName;
window.getTeamById = getTeamById;
window.getDiscipline = getDiscipline;
window.getAvailableDisciplines = getAvailableDisciplines;
window.getStudents = getStudents;
window.getInstructors = getInstructors;
window.getStudentSchedule = getStudentSchedule;
window.isCharacterEliminated = isCharacterEliminated;
window.getEliminatedCharacters = getEliminatedCharacters;
window.getActiveTeamMemberCount = getActiveTeamMemberCount;
window.getActiveTeamMembers = getActiveTeamMembers;
window.getParticipantName = getParticipantName;
window.getActiveTeamsForWeek = getActiveTeamsForWeek;
window.getAllActiveTeams = getAllActiveTeams;
window.getTeamsByType = getTeamsByType;
window.logActivity = logActivity;
window.getNonCivilianCharacters = getNonCivilianCharacters;
window.generateRandomStats = generateRandomStats;
window.generateRandomMagic = generateRandomMagic;
window.formatDate = formatDate;
window.truncateString = truncateString;
window.debounce = debounce;
window.getClassInstructor = getClassInstructor;
window.setClassInstructor = setClassInstructor;
window.getClassLabel = getClassLabel;
window.setClassLabel = setClassLabel;
window.getClassGroupLabel = getClassGroupLabel;
window.setClassGroupLabel = setClassGroupLabel;
window.getClassDuration = getClassDuration;
window.setClassDuration = setClassDuration;

// Class functions
window.getClasses = getClasses;
window.getClass = getClass;
window.getClassByName = getClassByName;
window.createClass = createClass;
window.deleteClass = deleteClass;
window.getCharactersByClass = getCharactersByClass;
window.getTeamsByClass = getTeamsByClass;
window.getAvailableStudentsForClass = getAvailableStudentsForClass;
window.getClassOptions = getClassOptions;
window.getClassDisplayName = getClassDisplayName;
window.getCharacterClasses = getCharacterClasses;
window.getCharacterClassNames = getCharacterClassNames;
window.addCharacterToClass = addCharacterToClass;
window.removeCharacterFromClass = removeCharacterFromClass;

console.log('utils.js loaded');
