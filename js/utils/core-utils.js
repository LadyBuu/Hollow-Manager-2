/**
 * utils/core-utils.js - Core Domain Utilities
 * Shared helper functions for domain operations
 * Path: utils/core-utils.js
 * 
 * This module provides utilities for:
 *   - Characters, teams, classes
 *   - Period parsing
 *   - Type checking
 *   - Activity logging
 *   - Random generation
 * 
 * IMPORTANT:
 *   - All functions are PURE where possible
 *   - No DOM manipulation
 *   - No UI logic
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__coreUtilsLoaded) {
        return;
    }
    window.__coreUtilsLoaded = true;

    // ============================================================
    // TYPE HELPERS
    // ============================================================

    function isObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    function isSafeInteger(value) {
        return Number.isSafeInteger(value);
    }

    function isPositiveInteger(value) {
        return isSafeInteger(value) && value >= 1;
    }

    // ============================================================
    // PERIOD PARSING - Strict integer-string parsing
    // ============================================================

    function parseOptionalPeriod(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        
        var str = String(value).trim();
        if (!/^\d+$/.test(str)) {
            return null;
        }
        
        var parsed = Number(str);
        if (!isSafeInteger(parsed)) {
            return null;
        }
        
        return parsed;
    }

    function parsePositivePeriod(value, fallback) {
        var parsed = parseOptionalPeriod(value);
        return (parsed !== null && parsed >= 1) ? parsed : fallback;
    }

    function parseStrictPositivePeriod(value) {
        var parsed = parseOptionalPeriod(value);
        return (parsed !== null && parsed >= 1) ? parsed : null;
    }

    function hasPeriodValue(value) {
        return value !== undefined && value !== null && String(value).trim() !== '';
    }

    function getPeriodInfo(value) {
        if (!hasPeriodValue(value)) {
            return { present: false, valid: true, value: null };
        }
        
        var parsed = parseOptionalPeriod(value);
        return {
            present: true,
            valid: parsed !== null,
            value: parsed
        };
    }

    // ============================================================
    // ID GENERATION
    // ============================================================

    function generateId(prefix) {
        prefix = prefix || 'id';
        
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return prefix + '_' + window.crypto.randomUUID();
        }
        
        return prefix + '_' +
               Date.now() + '_' +
               Math.random().toString(36).slice(2, 10);
    }

    // ============================================================
    // OPERATIONAL TEAM PREDICATES
    // ============================================================

    function isTeamOperational(team) {
        if (!team || typeof team !== 'object') return false;
        if (!team.status) return true;
        if (team.status === 'deleted' || 
            team.status === 'inactive' || 
            team.status === 'deprecated') {
            return false;
        }
        return true;
    }

    function isTeamActiveCompat(team) {
        if (!team || typeof team !== 'object') return false;
        if (!team.status) return true;
        return team.status === 'active';
    }

    function isTeamStatusActive(team) {
        if (!team || typeof team !== 'object') return false;
        return team.status === 'active';
    }

    function isValidTeamStatus(status) {
        if (status === undefined || status === null) return false;
        var validStatuses = ['active', 'inactive', 'deprecated', 'deleted'];
        return validStatuses.indexOf(String(status)) !== -1;
    }

    function filterOperationalTeams(teams) {
        if (!Array.isArray(teams)) return [];
        return teams.filter(isTeamOperational);
    }

    // ============================================================
    // ACTIVITY LOGGING
    // ============================================================

    function _logActivity(message, type) {
        type = type || 'info';
        
        if (message === undefined || message === null) {
            return;
        }
        
        message = String(message);
        
        if (!window.data || typeof window.data !== 'object') {
            window.data = {};
        }
        
        if (!Array.isArray(window.data.activities)) {
            window.data.activities = [];
        }
        
        window.data.activities.unshift({
            id: generateId(),
            message: message,
            type: type,
            timestamp: new Date().toISOString()
        });
        
        if (window.data.activities.length > 100) {
            window.data.activities.length = 100;
        }
        
        console.log('[' + type + ']', message);
    }

    function recordActivity(message, type) {
        if (typeof window._logActivity !== 'function') return;
        
        try {
            window._logActivity(message, type);
        } catch (error) {
            console.error('Activity logging failed:', error);
        }
    }

    // ============================================================
    // CHARACTER QUERIES
    // ============================================================

    function calculateAge(char) {
        if (!char || typeof char !== 'object') return null;
        
        var birthYear = parseStrictPositivePeriod(char.birthYear);
        if (birthYear === null) return null;
        
        var currentYear = window.data
            ? parseStrictPositivePeriod(window.data.currentYear)
            : null;
        
        if (currentYear === null) {
            currentYear = new Date().getFullYear();
        }
        
        if (birthYear > currentYear) return null;
        
        if (char.deceased) {
            var deathAge = parseStrictPositivePeriod(char.deathAge);
            if (deathAge !== null) return deathAge;
            
            var deathYear = parseStrictPositivePeriod(char.deathYear);
            if (deathYear !== null) {
                if (deathYear < birthYear) return null;
                return deathYear - birthYear;
            }
            
            return null;
        }
        
        return currentYear - birthYear;
    }

    function getCharacterAge(char) {
        var age = calculateAge(char);
        return age !== null ? age + ' yrs' : '-';
    }

    function getDisplayName(char) {
        if (!char || typeof char !== 'object') return 'Unknown';
        
        var firstName = String(char.firstName || '').trim();
        var lastName = String(char.lastName || '').trim();
        var nickname = String(char.nickname || '').trim();
        var alias = String(char.alias || '').trim();
        var format = char.nameFormat || 'firstlast';
        
        switch (format) {
            case 'lastfirst':
                if (lastName && firstName) return lastName + ', ' + firstName;
                return lastName || firstName || 'Unknown';
            
            case 'nicklast':
                return [nickname || firstName, lastName]
                    .filter(Boolean)
                    .join(' ') || 'Unknown';
            
            case 'firstnick':
                if (!firstName && !nickname) {
                    return lastName || 'Unknown';
                }
                
                if (!nickname) {
                    return [firstName, lastName].filter(Boolean).join(' ');
                }
                
                return firstName
                    ? firstName + ' "' + nickname + '"' + (lastName ? ' ' + lastName : '')
                    : '"' + nickname + '"' + (lastName ? ' ' + lastName : '');
            
            case 'alias':
                return alias || [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';
            
            case 'firstlast':
            default:
                return [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';
        }
    }

    function getFullName(char) {
        if (!char || typeof char !== 'object') return 'Unknown';
        
        var parts = [
            char.firstName,
            char.middleName,
            char.lastName
        ].filter(function(part) {
            return part !== undefined &&
                   part !== null &&
                   String(part).trim() !== '';
        }).map(function(part) {
            return String(part).trim();
        });
        
        return parts.length ? parts.join(' ') : 'Unknown';
    }

    function getNicknameOrFirstName(char) {
        if (!char || typeof char !== 'object') return 'Unknown';
        
        var nickname = String(char.nickname || '').trim();
        var firstName = String(char.firstName || '').trim();
        
        return nickname || firstName || 'Unknown';
    }

    function getCurrentStatus(char) {
        if (!char || !char.careerStatus || char.careerStatus.length === 0) {
            return 'Civilian';
        }
        
        var currentYear = window.data
            ? parseStrictPositivePeriod(window.data.currentYear)
            : null;
        
        if (currentYear === null) {
            currentYear = new Date().getFullYear();
        }
        
        var bestStatus = 'Civilian';
        var bestScore = {
            isActive: false,
            endYear: -Infinity,
            startYear: -Infinity,
            index: Infinity
        };

        char.careerStatus.forEach(function(status, index) {
            if (!status || !status.status) return;
            
            var start = parseStrictPositivePeriod(status.startYear);
            if (start === null || start > currentYear) return;
            
            var endInfo = getPeriodInfo(status.endYear);
            if (endInfo.present && !endInfo.valid) return;
            
            var isActive = (!endInfo.present || currentYear <= endInfo.value);
            var endYear = endInfo.present ? endInfo.value : Infinity;
            
            var isBetter = false;
            
            if (isActive !== bestScore.isActive) {
                isBetter = isActive;
            } else if (endYear !== bestScore.endYear) {
                isBetter = endYear > bestScore.endYear;
            } else if (start !== bestScore.startYear) {
                isBetter = start > bestScore.startYear;
            } else {
                isBetter = index < bestScore.index;
            }
            
            if (isBetter) {
                bestScore = {
                    isActive: isActive,
                    endYear: endYear,
                    startYear: start,
                    index: index
                };
                var statusName = String(status.status);
                bestStatus = statusName.charAt(0).toUpperCase() + statusName.slice(1);
            }
        });
        
        if (bestScore.isActive) {
            return bestStatus;
        }
        
        if (bestScore.endYear > -Infinity) {
            return bestStatus + ' (Former)';
        }
        
        return 'Civilian';
    }

    function getCharacterTeamCount(charId, period) {
        var count = 0;
        var teams = window.data ? window.data.teams : [];
        if (!Array.isArray(teams)) return 0;
        
        var periodNum = parseStrictPositivePeriod(period);
        if (periodNum === null) {
            return 0;
        }
        
        teams.forEach(function(team) {
            if (!team || typeof team !== 'object') return;
            if (!isTeamOperational(team)) return;
            
            var activeMembers = getActiveTeamMembers(team, periodNum);
            if (activeMembers.some(function(member) {
                return member && String(member.characterId) === String(charId);
            })) {
                count++;
            }
        });
        
        return count;
    }

    function getCharacterNameById(charId) {
        if (!charId) return 'Unknown';
        var chars = window.data ? window.data.characters : [];
        if (!Array.isArray(chars)) return 'Unknown';
        var char = chars.find(function(c) {
            return c && String(c.id) === String(charId);
        });
        if (char) {
            return getDisplayName(char);
        }
        return 'Unknown';
    }

    function getCharacterById(charId) {
        if (!charId) return null;
        var target = String(charId);
        var chars = window.data ? window.data.characters : [];
        if (!Array.isArray(chars)) return null;
        return chars.find(function(c) {
            return c && typeof c === 'object' && String(c.id) === target;
        }) || null;
    }

    // ============================================================
    // TEAM QUERIES
    // ============================================================

    function getTeamById(teamId) {
        if (!teamId) return null;
        var target = String(teamId);
        var teams = window.data ? window.data.teams : [];
        if (!Array.isArray(teams)) return null;
        return teams.find(function(t) {
            return t && typeof t === 'object' && String(t.id) === target;
        }) || null;
    }

    function getTeamName(teamId) {
        if (!teamId) return 'Unassigned';
        var team = getTeamById(teamId);
        return team ? team.name : 'Unknown Team';
    }

    function getTeams(type, status, includeDeleted) {
        var teams = window.data ? window.data.teams : [];
        if (!Array.isArray(teams)) return [];
        
        var result = teams.slice().filter(function(t) {
            return t && typeof t === 'object';
        });
        
        if (type) {
            result = result.filter(function(t) { return t.type === type; });
        }
        
        if (status === 'active') {
            result = result.filter(isTeamStatusActive);
        } else if (status === 'operational') {
            result = result.filter(isTeamOperational);
        }
        
        if (!includeDeleted) {
            result = result.filter(function(t) { return t.status !== 'deleted'; });
        }
        
        return result.sort(function(a, b) {
            var nameA = String(a.name || '');
            var nameB = String(b.name || '');
            return nameA.localeCompare(nameB);
        });
    }

    function getActiveTeamsForWeek(week) {
        var weekNum = parseStrictPositivePeriod(week);
        if (weekNum === null) return [];
        
        var teams = getTeams('academic', 'operational', false);
        
        return teams.filter(function(team) {
            if (!team || typeof team !== 'object') return false;
            
            var start = parseStrictPositivePeriod(team.startPeriod);
            if (start === null) return false;
            if (start > weekNum) return false;
            
            var endInfo = getPeriodInfo(team.endPeriod);
            if (endInfo.present && !endInfo.valid) return false;
            if (!endInfo.present) return true;
            return endInfo.value >= weekNum;
        });
    }

    function getAllOperationalTeams() {
        return getTeams(null, 'operational', false);
    }

    function getAllActiveTeams() {
        return getAllOperationalTeams();
    }

    function getActiveTeamMembers(team, period) {
        if (!team || !team.members) return [];
        if (!Array.isArray(team.members)) return [];
        
        var periodNum = parseStrictPositivePeriod(period);
        if (periodNum === null) {
            return [];
        }
        
        return team.members.filter(function(member) {
            if (!member || typeof member !== 'object') return false;
            
            var join = parseStrictPositivePeriod(member.joinPeriod);
            if (join === null) return false;
            
            var leaveInfo = getPeriodInfo(member.leavePeriod);
            if (leaveInfo.present && !leaveInfo.valid) return false;
            if (!leaveInfo.present) return join <= periodNum;
            return join <= periodNum && leaveInfo.value >= periodNum;
        });
    }

    function getActiveTeamMemberCount(team, period) {
        return getActiveTeamMembers(team, period).length;
    }

    // ============================================================
    // STUDENT / INSTRUCTOR QUERIES
    // ============================================================

    function getStudents() {
        if (!window.data || !window.data.characters) return [];
        if (!Array.isArray(window.data.characters)) return [];
        return window.data.characters.filter(function(c) {
            if (!c || typeof c !== 'object') return false;
            if (c.deceased) return false;
            
            var status = getCurrentStatus(c).toLowerCase();
            return status === 'trainee' ||
                   status === 'rookie' ||
                   status === 'junior' ||
                   status === 'student';
        }).sort(function(a, b) {
            return getDisplayName(a).localeCompare(getDisplayName(b));
        });
    }

    function getInstructors() {
        if (!window.data || !window.data.characters) return [];
        if (!Array.isArray(window.data.characters)) return [];
        return window.data.characters.filter(function(c) {
            if (!c || typeof c !== 'object') return false;
            if (c.deceased) return false;
            
            var status = getCurrentStatus(c).toLowerCase();
            return status === 'instructor' ||
                   status === 'teacher' ||
                   status === 'professor' ||
                   status === 'senior';
        }).sort(function(a, b) {
            return getDisplayName(a).localeCompare(getDisplayName(b));
        });
    }

    function getNonCivilianCharacters() {
        if (!window.data || !window.data.characters) return [];
        if (!Array.isArray(window.data.characters)) return [];
        return window.data.characters.filter(function(c) {
            if (!c || typeof c !== 'object') return false;
            if (c.deceased) return false;
            var status = getCurrentStatus(c).toLowerCase();
            return status !== 'civilian';
        }).sort(function(a, b) {
            return getDisplayName(a).localeCompare(getDisplayName(b));
        });
    }

    // ============================================================
    // DISCIPLINE QUERIES
    // ============================================================

    function getDiscipline(id) {
        if (!window.data || !window.data.curriculum || !window.data.curriculum.disciplines) return null;
        if (!Array.isArray(window.data.curriculum.disciplines)) return null;
        return window.data.curriculum.disciplines.find(function(d) {
            return d && String(d.id) === String(id);
        }) || null;
    }

    function getAvailableDisciplines(week) {
        var weekNum = parseStrictPositivePeriod(week);
        if (weekNum === null) return [];
        
        if (!window.data || !window.data.curriculum || !Array.isArray(window.data.curriculum.disciplines)) {
            return [];
        }
        
        return window.data.curriculum.disciplines.filter(function(d) {
            if (!d || typeof d !== 'object') return false;
            
            var start = parseStrictPositivePeriod(d.startWeek);
            if (start === null) return false;
            
            var endInfo = getPeriodInfo(d.endWeek);
            if (endInfo.present && !endInfo.valid) return false;
            if (!endInfo.present) return start <= weekNum;
            return start <= weekNum && endInfo.value >= weekNum;
        });
    }

    // ============================================================
    // CLASS FUNCTIONS
    // ============================================================

    function getClasses() {
        var data = window.data || {};
        if (!data.classes) {
            return [];
        }
        if (!Array.isArray(data.classes)) {
            return [];
        }
        return data.classes.slice().filter(function(c) {
            return c && typeof c === 'object';
        }).sort(function(a, b) {
            var nameA = String(a.name || '');
            var nameB = String(b.name || '');
            return nameA.localeCompare(nameB);
        });
    }

    function getClass(id) {
        if (!id) return null;
        var target = String(id);
        var data = window.data || {};
        if (!data.classes) return null;
        if (!Array.isArray(data.classes)) return null;
        return data.classes.find(function(c) {
            return c && typeof c === 'object' && String(c.id) === target;
        }) || null;
    }

    function getClassByName(name) {
        if (!name) return null;
        var data = window.data || {};
        if (!data.classes) return null;
        if (!Array.isArray(data.classes)) return null;
        var target = String(name).toLowerCase();
        return data.classes.find(function(c) {
            if (!c || typeof c !== 'object') return false;
            var className = String(c.name || '');
            return className.toLowerCase() === target;
        }) || null;
    }

    function getCharactersByClass(classId) {
        if (!classId) return [];
        var target = String(classId);
        var data = window.data || {};
        if (!data.characters) return [];
        if (!Array.isArray(data.characters)) return [];
        return data.characters.filter(function(c) {
            return c &&
                   typeof c === 'object' &&
                   Array.isArray(c.classIds) &&
                   c.classIds.some(function(cid) {
                       return String(cid) === target;
                   });
        });
    }

    function getTeamsByClass(classId) {
        if (!classId) return [];
        var target = String(classId);
        var data = window.data || {};
        if (!data.teams) return [];
        if (!Array.isArray(data.teams)) return [];
        return data.teams.filter(function(t) {
            return t &&
                   typeof t === 'object' &&
                   t.type === 'academic' &&
                   String(t.classId) === target &&
                   isTeamOperational(t);
        });
    }

    function getAvailableStudentsForClass(classId, week) {
        if (!classId) return [];
        var weekNum = parseStrictPositivePeriod(week);
        if (weekNum === null) return [];
        
        var data = window.data || {};
        var classChars = getCharactersByClass(classId);
        
        var available = classChars.filter(function(char) {
            if (!char || typeof char !== 'object') return false;
            if (char.deceased) return false;
            
            if (data.teams && Array.isArray(data.teams)) {
                var occupied = data.teams.some(function(team) {
                    if (!team || typeof team !== 'object') return false;
                    if (team.type !== 'academic') return false;
                    if (!isTeamOperational(team)) return false;
                    if (String(team.classId) !== String(classId)) return false;
                    
                    return getActiveTeamMembers(team, weekNum).some(function(member) {
                        return member && String(member.characterId) === String(char.id);
                    });
                });
                
                if (occupied) return false;
            }
            
            return true;
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
        if (!Array.isArray(char.classIds)) return [];
        var classes = getClasses();
        return classes.filter(function(c) {
            return char.classIds.some(function(cid) { return String(cid) === String(c.id); });
        });
    }

    function getCharacterClassNames(char) {
        var classes = getCharacterClasses(char);
        return classes.map(function(c) { return c.name; });
    }

    // ============================================================
    // CLASS MUTATIONS
    // ============================================================

    function createClass(name) {
        if (name === undefined || name === null || String(name).trim() === '') {
            return { success: false, changed: false, message: 'Class name is required.' };
        }
        var target = String(name).trim();
        
        var data = window.data || {};
        if (!data.classes) data.classes = [];
        if (!Array.isArray(data.classes)) {
            return { success: false, changed: false, message: 'Classes data is corrupted.' };
        }
        
        var existing = data.classes.find(function(c) {
            if (!c || typeof c !== 'object') return false;
            var className = String(c.name || '');
            return className.toLowerCase() === target.toLowerCase();
        });
        if (existing) {
            return { success: false, changed: false, message: 'A class with this name already exists.' };
        }
        
        var newClass = {
            id: generateId('class'),
            name: target,
            createdAt: new Date().toISOString()
        };
        
        data.classes.push(newClass);
        window.data = data;
        
        recordActivity('Created class: ' + newClass.name);
        
        return { success: true, changed: true, class: newClass };
    }

    function deleteClass(id, confirmed) {
        confirmed = confirmed === true;
        
        if (!id) return { 
            success: false, 
            changed: false,
            message: 'Class ID is required.',
            affectedCharacters: [],
            affectedTeams: [],
            needsConfirmation: false
        };
        
        var data = window.data || {};
        if (!data.classes) return { 
            success: false, 
            changed: false,
            message: 'No classes found.',
            affectedCharacters: [],
            affectedTeams: [],
            needsConfirmation: false
        };
        if (!Array.isArray(data.classes)) {
            return { 
                success: false, 
                changed: false,
                message: 'Classes data is corrupted.',
                affectedCharacters: [],
                affectedTeams: [],
                needsConfirmation: false
            };
        }
        
        var target = String(id);
        var cls = data.classes.find(function(c) {
            return c && typeof c === 'object' && String(c.id) === target;
        });
        if (!cls) {
            return { 
                success: false, 
                changed: false,
                message: 'Class not found.',
                affectedCharacters: [],
                affectedTeams: [],
                needsConfirmation: false
            };
        }
        
        var affectedCharacters = data.characters && Array.isArray(data.characters) 
            ? data.characters.filter(function(c) {
                return c &&
                       typeof c === 'object' &&
                       Array.isArray(c.classIds) &&
                       c.classIds.some(function(cid) { return String(cid) === target; });
            }).map(function(c) {
                return { id: c.id, name: getDisplayName(c) };
            })
            : [];
        
        var affectedTeams = data.teams && Array.isArray(data.teams) 
            ? data.teams.filter(function(t) {
                return t &&
                       typeof t === 'object' &&
                       t.type === 'academic' &&
                       String(t.classId) === target;
            }).map(function(t) {
                return { id: t.id, name: t.name || 'Unknown' };
            })
            : [];
        
        var hasAffectedEntities = affectedCharacters.length > 0 || affectedTeams.length > 0;
        
        if (hasAffectedEntities && !confirmed) {
            return {
                success: false,
                changed: false,
                message: 'Confirmation required. This class has ' + 
                         affectedCharacters.length + ' characters and ' + 
                         affectedTeams.length + ' teams assigned.',
                affectedCharacters: affectedCharacters,
                affectedTeams: affectedTeams,
                needsConfirmation: true
            };
        }
        
        affectedCharacters.forEach(function(char) {
            var fullChar = data.characters.find(function(c) {
                return c &&
                       typeof c === 'object' &&
                       String(c.id) === String(char.id);
            });
            if (fullChar) {
                fullChar.classIds = fullChar.classIds.filter(function(cid) { return String(cid) !== target; });
            }
        });
        
        affectedTeams.forEach(function(team) {
            var fullTeam = data.teams.find(function(t) {
                return t &&
                       typeof t === 'object' &&
                       String(t.id) === String(team.id);
            });
            if (fullTeam) {
                fullTeam.classId = null;
            }
        });
        
        data.classes = data.classes.filter(function(c) {
            return !c || String(c.id) !== target;
        });
        window.data = data;
        
        recordActivity('Deleted class: ' + cls.name);
        
        return {
            success: true,
            changed: true,
            message: 'Class deleted successfully.',
            affectedCharacters: affectedCharacters,
            affectedTeams: affectedTeams,
            needsConfirmation: false
        };
    }

    function addCharacterToClass(charId, classId) {
        if (!charId || !classId) return { success: false, changed: false, message: 'Character and class are required.' };
        
        var data = window.data || {};
        if (!data.characters || !Array.isArray(data.characters)) {
            return { success: false, changed: false, message: 'No characters found.' };
        }
        
        var char = data.characters.find(function(c) {
            return c && typeof c === 'object' && String(c.id) === String(charId);
        });
        if (!char) {
            return { success: false, changed: false, message: 'Character not found.' };
        }
        
        var cls = getClass(classId);
        if (!cls) {
            return { success: false, changed: false, message: 'Class not found.' };
        }
        
        if (char.classIds === undefined || char.classIds === null) {
            char.classIds = [];
        } else if (!Array.isArray(char.classIds)) {
            return { success: false, changed: false, message: 'Character class data is corrupted.' };
        }
        
        if (char.classIds.some(function(cid) { return String(cid) === String(classId); })) {
            return { success: false, changed: false, message: 'Character is already in this class.' };
        }
        
        char.classIds.push(classId);
        window.data = data;
        
        recordActivity('Added ' + getDisplayName(char) + ' to class: ' + cls.name);
        
        return { success: true, changed: true, message: 'Character added to class.' };
    }

    function removeCharacterFromClass(charId, classId) {
        if (!charId || !classId) return { success: false, changed: false, message: 'Character and class are required.' };
        
        var data = window.data || {};
        if (!data.characters || !Array.isArray(data.characters)) {
            return { success: false, changed: false, message: 'No characters found.' };
        }
        
        var char = data.characters.find(function(c) {
            return c && typeof c === 'object' && String(c.id) === String(charId);
        });
        if (!char) {
            return { success: false, changed: false, message: 'Character not found.' };
        }
        
        if (char.classIds === undefined || char.classIds === null) {
            return { success: false, changed: false, message: 'Character is not in this class.' };
        }
        
        if (!Array.isArray(char.classIds)) {
            return { success: false, changed: false, message: 'Character class data is corrupted.' };
        }
        
        if (!char.classIds.some(function(cid) { return String(cid) === String(classId); })) {
            return { success: false, changed: false, message: 'Character is not in this class.' };
        }
        
        char.classIds = char.classIds.filter(function(cid) { return String(cid) !== String(classId); });
        window.data = data;
        
        recordActivity('Removed ' + getDisplayName(char) + ' from class: ' + getClassDisplayName(classId));
        
        return { success: true, changed: true, message: 'Character removed from class.' };
    }

    // ============================================================
    // CLASS SCHEDULE HELPERS
    // ============================================================

    function getClassInstructor(studentId, week, day, hour) {
        if (!window.data || !window.data.curriculum || !window.data.curriculum.classInstructors) return null;
        var key = getScheduleKey(studentId, week, day, hour);
        var value = window.data.curriculum.classInstructors[key];
        return value !== undefined ? value : null;
    }

    function setClassInstructor(studentId, week, day, hour, instructorId) {
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.success) {
            return { success: false, changed: false, message: validation.message };
        }
        
        var data = ensureCurriculumStructure();
        var key = getScheduleKey(
            validation.studentId,
            validation.week,
            validation.day,
            validation.hour
        );
        
        var existing = data.curriculum.classInstructors[key];
        var newValue = instructorId || null;
        
        if (existing === newValue) {
            return { success: true, changed: false };
        }
        
        if (newValue) {
            data.curriculum.classInstructors[key] = newValue;
        } else {
            delete data.curriculum.classInstructors[key];
        }
        
        window.data = data;
        return { success: true, changed: true };
    }

    function getClassLabel(studentId, week, day, hour) {
        if (!window.data || !window.data.curriculum || !window.data.curriculum.classLabels) return null;
        var key = getScheduleKey(studentId, week, day, hour);
        var value = window.data.curriculum.classLabels[key];
        return value !== undefined ? value : null;
    }

    function setClassLabel(studentId, week, day, hour, label) {
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.success) {
            return { success: false, changed: false, message: validation.message };
        }
        
        var data = ensureCurriculumStructure();
        var key = getScheduleKey(
            validation.studentId,
            validation.week,
            validation.day,
            validation.hour
        );
        
        var existing = data.curriculum.classLabels[key];
        var newValue = (label !== undefined && label !== null && String(label).trim() !== '')
            ? String(label)
            : null;
        
        if (existing === newValue) {
            return { success: true, changed: false };
        }
        
        if (newValue !== null) {
            data.curriculum.classLabels[key] = newValue;
        } else {
            delete data.curriculum.classLabels[key];
        }
        
        window.data = data;
        return { success: true, changed: true };
    }

    function getClassGroupLabel(studentId, week, day, hour) {
        if (!window.data || !window.data.curriculum || !window.data.curriculum.classGroupLabels) return null;
        var key = getScheduleKey(studentId, week, day, hour);
        var value = window.data.curriculum.classGroupLabels[key];
        return value !== undefined ? value : null;
    }

    function setClassGroupLabel(studentId, week, day, hour, groupLabel) {
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.success) {
            return { success: false, changed: false, message: validation.message };
        }
        
        var data = ensureCurriculumStructure();
        var key = getScheduleKey(
            validation.studentId,
            validation.week,
            validation.day,
            validation.hour
        );
        
        var existing = data.curriculum.classGroupLabels[key];
        var newValue = (groupLabel !== undefined && groupLabel !== null && String(groupLabel).trim() !== '')
            ? String(groupLabel)
            : null;
        
        if (existing === newValue) {
            return { success: true, changed: false };
        }
        
        if (newValue !== null) {
            data.curriculum.classGroupLabels[key] = newValue;
        } else {
            delete data.curriculum.classGroupLabels[key];
        }
        
        window.data = data;
        return { success: true, changed: true };
    }

    function getClassDuration(studentId, week, day, hour) {
        if (!window.data || !window.data.curriculum || !window.data.curriculum.classDurations) return null;
        var key = getScheduleKey(studentId, week, day, hour);
        var value = window.data.curriculum.classDurations[key];
        return value !== undefined ? value : null;
    }

    function setClassDuration(studentId, week, day, hour, duration) {
        var validation = validateScheduleSlot(studentId, week, day, hour);
        if (!validation.success) {
            return { success: false, changed: false, message: validation.message };
        }
        
        var numDuration;
        var hasValue = duration !== undefined && duration !== null && String(duration).trim() !== '';
        
        if (hasValue) {
            numDuration = Number(duration);
            
            if (!Number.isFinite(numDuration) || numDuration <= 0) {
                return {
                    success: false,
                    changed: false,
                    message: 'Duration must be a positive number.'
                };
            }
        }
        
        var data = ensureCurriculumStructure();
        var key = getScheduleKey(
            validation.studentId,
            validation.week,
            validation.day,
            validation.hour
        );
        
        var existing = data.curriculum.classDurations[key];
        var newValue = hasValue && numDuration > 0 ? numDuration : null;
        
        if (existing === newValue) {
            return { success: true, changed: false };
        }
        
        if (newValue !== null) {
            data.curriculum.classDurations[key] = newValue;
        } else {
            delete data.curriculum.classDurations[key];
        }
        
        window.data = data;
        return { success: true, changed: true };
    }

    // ============================================================
    // CURRICULUM STRUCTURE INITIALISATION
    // ============================================================

    function ensureCurriculumStructure() {
        var data = window.data || {};
        
        if (!data.curriculum || typeof data.curriculum !== 'object' || Array.isArray(data.curriculum)) {
            data.curriculum = {};
        }
        
        if (!data.curriculum.classInstructors ||
            typeof data.curriculum.classInstructors !== 'object' ||
            Array.isArray(data.curriculum.classInstructors)) {
            data.curriculum.classInstructors = Object.create(null);
        }
        
        if (!data.curriculum.classLabels ||
            typeof data.curriculum.classLabels !== 'object' ||
            Array.isArray(data.curriculum.classLabels)) {
            data.curriculum.classLabels = Object.create(null);
        }
        
        if (!data.curriculum.classGroupLabels ||
            typeof data.curriculum.classGroupLabels !== 'object' ||
            Array.isArray(data.curriculum.classGroupLabels)) {
            data.curriculum.classGroupLabels = Object.create(null);
        }
        
        if (!data.curriculum.classDurations ||
            typeof data.curriculum.classDurations !== 'object' ||
            Array.isArray(data.curriculum.classDurations)) {
            data.curriculum.classDurations = Object.create(null);
        }
        
        if (!data.curriculum.schedules ||
            typeof data.curriculum.schedules !== 'object' ||
            Array.isArray(data.curriculum.schedules)) {
            data.curriculum.schedules = {};
        }
        
        window.data = data;
        return data;
    }

    // ============================================================
    // RANDOM GENERATORS
    // ============================================================

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
                magic[key] = Math.floor(Math.random() * 3) + 9;
            }
        });
        return magic;
    }

    // ============================================================
    // FORMATTING HELPERS
    // ============================================================

    function formatDate(dateString) {
        if (!dateString) return 'N/A';
        
        var date = new Date(dateString);
        if (isNaN(date.getTime())) {
            return 'N/A';
        }
        
        return date.toLocaleDateString();
    }

    function truncateString(str, length) {
        if (str === undefined || str === null) return '';
        
        str = String(str);
        
        if (!Number.isFinite(length) || length < 0) {
            return str;
        }
        
        if (str.length <= length) return str;
        
        return str.substring(0, length) + '...';
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CoreUtils = {
        // Type helpers
        isObject: isObject,
        isSafeInteger: isSafeInteger,
        isPositiveInteger: isPositiveInteger,

        // Period parsing
        parseOptionalPeriod: parseOptionalPeriod,
        parsePositivePeriod: parsePositivePeriod,
        parseStrictPositivePeriod: parseStrictPositivePeriod,
        hasPeriodValue: hasPeriodValue,
        getPeriodInfo: getPeriodInfo,

        // ID generation
        generateId: generateId,

        // Team predicates
        isTeamOperational: isTeamOperational,
        isTeamActiveCompat: isTeamActiveCompat,
        isTeamStatusActive: isTeamStatusActive,
        isValidTeamStatus: isValidTeamStatus,
        filterOperationalTeams: filterOperationalTeams,

        // Activity logging
        _logActivity: _logActivity,
        recordActivity: recordActivity,

        // Character queries
        calculateAge: calculateAge,
        getCharacterAge: getCharacterAge,
        getDisplayName: getDisplayName,
        getFullName: getFullName,
        getNicknameOrFirstName: getNicknameOrFirstName,
        getCurrentStatus: getCurrentStatus,
        getCharacterTeamCount: getCharacterTeamCount,
        getCharacterNameById: getCharacterNameById,
        getCharacterById: getCharacterById,

        // Team queries
        getTeamById: getTeamById,
        getTeamName: getTeamName,
        getTeams: getTeams,
        getActiveTeamsForWeek: getActiveTeamsForWeek,
        getAllOperationalTeams: getAllOperationalTeams,
        getAllActiveTeams: getAllActiveTeams,
        getActiveTeamMembers: getActiveTeamMembers,
        getActiveTeamMemberCount: getActiveTeamMemberCount,

        // Student/Instructor queries
        getStudents: getStudents,
        getInstructors: getInstructors,
        getNonCivilianCharacters: getNonCivilianCharacters,

        // Discipline queries
        getDiscipline: getDiscipline,
        getAvailableDisciplines: getAvailableDisciplines,

        // Class functions
        getClasses: getClasses,
        getClass: getClass,
        getClassByName: getClassByName,
        getCharactersByClass: getCharactersByClass,
        getTeamsByClass: getTeamsByClass,
        getAvailableStudentsForClass: getAvailableStudentsForClass,
        getClassOptions: getClassOptions,
        getClassDisplayName: getClassDisplayName,
        getCharacterClasses: getCharacterClasses,
        getCharacterClassNames: getCharacterClassNames,

        // Class mutations
        createClass: createClass,
        deleteClass: deleteClass,
        addCharacterToClass: addCharacterToClass,
        removeCharacterFromClass: removeCharacterFromClass,

        // Class schedule
        getClassInstructor: getClassInstructor,
        setClassInstructor: setClassInstructor,
        getClassLabel: getClassLabel,
        setClassLabel: setClassLabel,
        getClassGroupLabel: getClassGroupLabel,
        setClassGroupLabel: setClassGroupLabel,
        getClassDuration: getClassDuration,
        setClassDuration: setClassDuration,

        // Random generators
        generateRandomStats: generateRandomStats,
        generateRandomMagic: generateRandomMagic,

        // Formatting
        formatDate: formatDate,
        truncateString: truncateString,

        // Internal helpers
        ensureCurriculumStructure: ensureCurriculumStructure
    };

    // Legacy global exports for backward compatibility
    window.isObject = isObject;
    window.isSafeInteger = isSafeInteger;
    window.isPositiveInteger = isPositiveInteger;
    window.generateId = generateId;
    window.parseOptionalPeriod = parseOptionalPeriod;
    window.parsePositivePeriod = parsePositivePeriod;
    window.parseStrictPositivePeriod = parseStrictPositivePeriod;
    window.hasPeriodValue = hasPeriodValue;
    window.getPeriodInfo = getPeriodInfo;
    window._logActivity = _logActivity;
    window.recordActivity = recordActivity;
    window.calculateAge = calculateAge;
    window.getCharacterAge = getCharacterAge;
    window.getDisplayName = getDisplayName;
    window.getFullName = getFullName;
    window.getNicknameOrFirstName = getNicknameOrFirstName;
    window.getCurrentStatus = getCurrentStatus;
    window.getCharacterTeamCount = getCharacterTeamCount;
    window.getCharacterNameById = getCharacterNameById;
    window.getCharacterById = getCharacterById;
    window.getTeamById = getTeamById;
    window.getTeamName = getTeamName;
    window.getTeams = getTeams;
    window.getActiveTeamsForWeek = getActiveTeamsForWeek;
    window.getAllOperationalTeams = getAllOperationalTeams;
    window.getAllActiveTeams = getAllActiveTeams;
    window.getActiveTeamMembers = getActiveTeamMembers;
    window.getActiveTeamMemberCount = getActiveTeamMemberCount;
    window.getStudents = getStudents;
    window.getInstructors = getInstructors;
    window.getNonCivilianCharacters = getNonCivilianCharacters;
    window.getDiscipline = getDiscipline;
    window.getAvailableDisciplines = getAvailableDisciplines;
    window.getClasses = getClasses;
    window.getClass = getClass;
    window.getClassByName = getClassByName;
    window.getCharactersByClass = getCharactersByClass;
    window.getTeamsByClass = getTeamsByClass;
    window.getAvailableStudentsForClass = getAvailableStudentsForClass;
    window.getClassOptions = getClassOptions;
    window.getClassDisplayName = getClassDisplayName;
    window.getCharacterClasses = getCharacterClasses;
    window.getCharacterClassNames = getCharacterClassNames;
    window.createClass = createClass;
    window.deleteClass = deleteClass;
    window.addCharacterToClass = addCharacterToClass;
    window.removeCharacterFromClass = removeCharacterFromClass;
    window.getClassInstructor = getClassInstructor;
    window.setClassInstructor = setClassInstructor;
    window.getClassLabel = getClassLabel;
    window.setClassLabel = setClassLabel;
    window.getClassGroupLabel = getClassGroupLabel;
    window.setClassGroupLabel = setClassGroupLabel;
    window.getClassDuration = getClassDuration;
    window.setClassDuration = setClassDuration;
    window.isTeamOperational = isTeamOperational;
    window.isTeamActiveCompat = isTeamActiveCompat;
    window.isTeamStatusActive = isTeamStatusActive;
    window.isValidTeamStatus = isValidTeamStatus;
    window.filterOperationalTeams = filterOperationalTeams;
    window.generateRandomStats = generateRandomStats;
    window.generateRandomMagic = generateRandomMagic;
    window.formatDate = formatDate;
    window.truncateString = truncateString;

})();
