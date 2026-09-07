/**
 * js/modules/academy/academy-class-queries.js - Academy Class Queries
 * Internal class queries for the Academy module
 * Path: js/modules/academy/academy-class-queries.js
 * 
 * This module provides read-only class queries for Academy.
 * All class data is stored in window.data.classes.
 */

(function() {
    'use strict';

    if (window.__academyClassQueriesLoaded) return;
    window.__academyClassQueriesLoaded = true;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var CalendarValidation = window.CalendarValidation;
    var CalendarConstants = window.CalendarConstants;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function getClassData() {
        var data = window.data;
        return data && Array.isArray(data.classes) ? data.classes : [];
    }

    function getCharacterData() {
        var data = window.data;
        return data && Array.isArray(data.characters) ? data.characters : [];
    }

    function getTeamData() {
        var data = window.data;
        return data && Array.isArray(data.teams) ? data.teams : [];
    }

    // ============================================================
    // CLASS LOOKUP
    // ============================================================

    function getClasses() {
        var classes = getClassData();
        return classes.slice().filter(function(cls) {
            return cls && typeof cls === 'object';
        }).sort(function(a, b) {
            return String(a.name || '').localeCompare(String(b.name || ''));
        });
    }

    function getClass(id) {
        if (!id) return null;
        var target = String(id);
        var classes = getClassData();
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (cls && typeof cls === 'object' && String(cls.id) === target) {
                return cls;
            }
        }
        return null;
    }

    function getClassByName(name) {
        if (!name) return null;
        var target = String(name).toLowerCase().trim();
        var classes = getClassData();
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (cls && typeof cls === 'object') {
                if (String(cls.name || '').toLowerCase().trim() === target) {
                    return cls;
                }
            }
        }
        return null;
    }

    function getClassDisplayName(classId) {
        var cls = getClass(classId);
        return cls ? cls.name : 'Unassigned';
    }

    function getClassOptions() {
        var classes = getClasses();
        var options = [];
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var count = getCharactersByClass(cls.id).length;
            options.push({
                id: cls.id,
                name: cls.name,
                count: count
            });
        }
        return options;
    }

    function classExists(id) {
        return getClass(id) !== null;
    }

    // ============================================================
    // CHARACTER-CLASS RELATIONSHIPS
    // ============================================================

    function getCharactersByClass(classId) {
        if (!classId) return [];
        var target = String(classId);
        var chars = getCharacterData();
        var result = [];
        for (var i = 0; i < chars.length; i++) {
            var character = chars[i];
            if (character && typeof character === 'object' && Array.isArray(character.classIds)) {
                for (var j = 0; j < character.classIds.length; j++) {
                    if (String(character.classIds[j]) === target) {
                        result.push(character);
                        break;
                    }
                }
            }
        }
        return result;
    }

    function getCharacterCountByClass(classId) {
        return getCharactersByClass(classId).length;
    }

    function getCharacterClasses(character) {
        if (!character) return [];
        var classIds = Array.isArray(character.classIds) ? character.classIds : [];
        if (classIds.length === 0) return [];

        var classes = getClasses();
        var result = [];
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls) continue;
            for (var j = 0; j < classIds.length; j++) {
                if (String(classIds[j]) === String(cls.id)) {
                    result.push(cls);
                    break;
                }
            }
        }
        return result;
    }

    function getCharacterClassNames(character) {
        var classes = getCharacterClasses(character);
        var names = [];
        for (var i = 0; i < classes.length; i++) {
            names.push(classes[i].name);
        }
        return names;
    }

    function isCharacterInClass(character, classId) {
        if (!character || !classId) return false;
        var classIds = Array.isArray(character.classIds) ? character.classIds : [];
        var target = String(classId);
        for (var i = 0; i < classIds.length; i++) {
            if (String(classIds[i]) === target) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // TEAM-CLASS RELATIONSHIPS
    // ============================================================

    function getTeamsByClass(classId) {
        if (!classId) return [];
        var target = String(classId);
        var teams = getTeamData();
        var result = [];
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (team && typeof team === 'object' && team.type === 'academic' && String(team.classId) === target) {
                if (team.status === 'active' || team.status === 'operational') {
                    result.push(team);
                }
            }
        }
        return result;
    }

    function getTeamCountByClass(classId) {
        return getTeamsByClass(classId).length;
    }

    function getClassForTeam(team) {
        if (!team || team.type !== 'academic' || !team.classId) return null;
        return getClass(team.classId);
    }

    // ============================================================
    // AVAILABLE STUDENTS
    // ============================================================

    function getAvailableStudentsForClass(classId, week) {
        if (!classId) return [];

        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum) || weekNum < 1 || weekNum > 52) return [];

        var classChars = getCharactersByClass(classId);
        var teams = getTeamsByClass(classId);

        var occupiedIds = {};
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team) continue;
            var members = TeamQueries.getActiveTeamMembers(team, weekNum);
            for (var j = 0; j < members.length; j++) {
                var member = members[j];
                if (member && member.characterId) {
                    occupiedIds[String(member.characterId)] = true;
                }
            }
        }

        var result = [];
        for (var k = 0; k < classChars.length; k++) {
            var character = classChars[k];
            if (!character) continue;
            if (character.deceased) continue;
            if (occupiedIds[String(character.id)]) continue;
            result.push(character);
        }

        return result;
    }

    function getAvailableStudentCount(classId, week) {
        return getAvailableStudentsForClass(classId, week).length;
    }

    function isStudentAvailableForClass(classId, studentId, week) {
        if (!classId || !studentId) return false;

        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum) || weekNum < 1 || weekNum > 52) return false;

        var character = CharacterQueries.getCharacterById(studentId);
        if (!character) return false;
        if (!isCharacterInClass(character, classId)) return false;
        if (character.deceased) return false;

        var teams = getTeamsByClass(classId);
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team) continue;
            var members = TeamQueries.getActiveTeamMembers(team, weekNum);
            for (var j = 0; j < members.length; j++) {
                var member = members[j];
                if (member && String(member.characterId) === String(studentId)) {
                    return false;
                }
            }
        }

        return true;
    }

    // ============================================================
    // CLASS STATISTICS
    // ============================================================

    function getClassStats(classId, week) {
        if (!classId) {
            return { totalStudents: 0, totalTeams: 0, availableStudents: null, classExists: false, className: null };
        }

        var cls = getClass(classId);
        if (!cls) {
            return { totalStudents: 0, totalTeams: 0, availableStudents: null, classExists: false, className: null };
        }

        var totalStudents = getCharacterCountByClass(classId);
        var totalTeams = getTeamCountByClass(classId);
        var availableStudents = null;

        if (week !== undefined && week !== null) {
            availableStudents = getAvailableStudentCount(classId, week);
        }

        return {
            totalStudents: totalStudents,
            totalTeams: totalTeams,
            availableStudents: availableStudents,
            classExists: true,
            className: cls.name
        };
    }

    function getClassesWithStats(week) {
        var classes = getClasses();
        var result = [];

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var stats = getClassStats(cls.id, week);
            result.push({
                id: cls.id,
                name: cls.name,
                totalStudents: stats.totalStudents,
                totalTeams: stats.totalTeams,
                availableStudents: stats.availableStudents
            });
        }

        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyClassQueries = {
        // Class lookup
        getClasses: getClasses,
        getClass: getClass,
        getClassByName: getClassByName,
        getClassDisplayName: getClassDisplayName,
        getClassOptions: getClassOptions,
        classExists: classExists,

        // Character-class relationships
        getCharactersByClass: getCharactersByClass,
        getCharacterCountByClass: getCharacterCountByClass,
        getCharacterClasses: getCharacterClasses,
        getCharacterClassNames: getCharacterClassNames,
        isCharacterInClass: isCharacterInClass,

        // Team-class relationships
        getTeamsByClass: getTeamsByClass,
        getTeamCountByClass: getTeamCountByClass,
        getClassForTeam: getClassForTeam,

        // Available students
        getAvailableStudentsForClass: getAvailableStudentsForClass,
        getAvailableStudentCount: getAvailableStudentCount,
        isStudentAvailableForClass: isStudentAvailableForClass,

        // Statistics
        getClassStats: getClassStats,
        getClassesWithStats: getClassesWithStats
    };

})();
