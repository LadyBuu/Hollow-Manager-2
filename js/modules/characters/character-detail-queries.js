/**
 * modules/characters/character-detail-queries.js - Character Detail Queries
 * Composes view-ready data for the character detail screen
 * Path: js/modules/characters/character-detail-queries.js
 * 
 * This module provides:
 *   - getCharacterDetail - Complete detail view model
 *   - getCharacterCareer - Career information
 *   - getCharacterTeams - Team memberships by type
 *   - getCharacterMissions - Mission assignments
 *   - getCharacterGrades - Grade history
 *   - getCharacterEliminations - Elimination history
 *   - getCharacterRelationships - Social connections
 *   - getCharacterSchedule - Schedule summary
 *   - getCharacterStats - Stats and magic
 * 
 * IMPORTANT:
 *   - READ-ONLY queries - no mutations
 *   - No DOM manipulation
 *   - No persistence
 *   - Composes data from multiple query modules
 *   - Returns VIEW-READY data (formatted, sorted, filtered)
 *   - Single source of truth for detail view data
 * 
 * DEPENDENCIES:
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.ClassesQueries (from classes-queries.js) - MANDATORY
 *   - window.TeamQueries (from team-queries.js) - MANDATORY
 *   - window.GradeQueries (from grade-queries.js) - MANDATORY
 *   - window.MissionQueries (from mission-queries.js) - MANDATORY
 *   - window.SocialQueries (from social-queries.js) - MANDATORY
 *   - window.DisciplineQueries (from discipline-queries.js) - MANDATORY
 *   - window.EliminationQueries (from elimination-queries.js) - MANDATORY
 *   - window.ScheduleQueries (from schedule-queries.js) - MANDATORY
 *   - window.MagicConstants (from magic-constants.js) - MANDATORY
 *   - window.CharacterConstants (from character-constants.js) - MANDATORY
 * 
 * USAGE:
 *   var DQ = window.CharacterDetailQueries;
 *   var detail = DQ.getCharacterDetail('char_123');
 *   // Returns { character, career, teams, missions, grades, ... }
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__characterDetailQueriesLoaded) {
        return;
    }
    window.__characterDetailQueriesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var ClassesQueries = window.ClassesQueries;
    var TeamQueries = window.TeamQueries;
    var GradeQueries = window.GradeQueries;
    var MissionQueries = window.MissionQueries;
    var SocialQueries = window.SocialQueries;
    var DisciplineQueries = window.DisciplineQueries;
    var EliminationQueries = window.EliminationQueries;
    var ScheduleQueries = window.ScheduleQueries;
    var MagicConstants = window.MagicConstants;
    var CharacterConstants = window.CharacterConstants;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var STAT_KEYS = CharacterConstants ? CharacterConstants.STAT_KEYS : ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    var STAT_DEFAULT = CharacterConstants ? CharacterConstants.STAT_DEFAULT : 10;
    var MAGIC_TYPE_KEYS = MagicConstants ? MagicConstants.getTypeKeys() : [];

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (!ClassesQueries || typeof ClassesQueries.getCharacterClasses !== 'function') {
            missing.push('ClassesQueries.getCharacterClasses');
        }

        if (!TeamQueries || typeof TeamQueries.getTeamsForCharacter !== 'function') {
            missing.push('TeamQueries.getTeamsForCharacter');
        }

        if (!GradeQueries || typeof GradeQueries.getCharacterGrades !== 'function') {
            missing.push('GradeQueries.getCharacterGrades');
        }

        if (!MissionQueries || typeof MissionQueries.getMissionsForCharacter !== 'function') {
            missing.push('MissionQueries.getMissionsForCharacter');
        }

        if (!SocialQueries || typeof SocialQueries.getCharacterRelationships !== 'function') {
            missing.push('SocialQueries.getCharacterRelationships');
        }

        if (!DisciplineQueries || typeof DisciplineQueries.getDiscipline !== 'function') {
            missing.push('DisciplineQueries.getDiscipline');
        }

        if (!EliminationQueries || typeof EliminationQueries.isCharacterEliminated !== 'function') {
            missing.push('EliminationQueries.isCharacterEliminated');
        }

        if (!ScheduleQueries || typeof ScheduleQueries.getCharacterScheduleCount !== 'function') {
            missing.push('ScheduleQueries.getCharacterScheduleCount');
        }

        if (missing.length > 0) {
            console.warn('[CharacterDetailQueries] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    /**
     * Format a period string from join/leave dates.
     * 
     * @param {string} join - Join date
     * @param {string} leave - Leave date
     * @param {string} prefix - Prefix for dates (e.g., 'Wk ')
     * @returns {string} Formatted period string
     */
    function formatPeriod(join, leave, prefix) {
        prefix = prefix || '';
        var joinStr = (join !== undefined && join !== null && join !== '') ? String(join) : '';
        var leaveStr = (leave !== undefined && leave !== null && leave !== '') ? String(leave) : '';

        if (joinStr && leaveStr) return prefix + joinStr + ' → ' + prefix + leaveStr;
        if (joinStr) return prefix + joinStr + ' → Present';
        if (leaveStr) return 'Until ' + prefix + leaveStr;
        return prefix + '?';
    }

    /**
     * Get the modifier for a stat value.
     * 
     * @param {number} value - Stat value
     * @returns {number} Modifier
     */
    function getModifier(value) {
        var num = Number(value);
        if (isNaN(num) || !isFinite(num)) return 0;
        return Math.floor((num - 10) / 2);
    }

    /**
     * Get the magic level label for a score.
     * 
     * @param {number} score - Magic proficiency score
     * @returns {string} Magic level label
     */
    function getMagicLevelLabel(score) {
        var num = Number(score);
        if (isNaN(num) || !isFinite(num)) return 'Untrained';

        if (num >= 9) return 'Master';
        if (num >= 7) return 'Expert';
        if (num >= 5) return 'Adept';
        if (num >= 3) return 'Apprentice';
        if (num >= 1) return 'Novice';
        return 'Untrained';
    }

    /**
     * Get the magic level color for a score.
     * 
     * @param {number} score - Magic proficiency score
     * @returns {string} CSS color variable
     */
    function getMagicLevelColor(score) {
        var num = Number(score);
        if (isNaN(num) || !isFinite(num)) return 'var(--border)';

        if (num >= 9) return 'var(--danger)';
        if (num >= 7) return 'var(--warning)';
        if (num >= 5) return 'var(--accent)';
        if (num >= 3) return 'var(--info)';
        if (num >= 1) return 'var(--text-dim)';
        return 'var(--border)';
    }

    /**
     * Get magic type label from key.
     * 
     * @param {string} key - Magic type key
     * @returns {string} Magic type label
     */
    function getMagicTypeLabel(key) {
        if (MagicConstants && typeof MagicConstants.getTypeLabel === 'function') {
            return MagicConstants.getTypeLabel(key);
        }
        return key.charAt(0).toUpperCase() + key.slice(1);
    }

    // ============================================================
    // CHARACTER DETAIL QUERIES
    // ============================================================

    /**
     * Get the complete character detail view model.
     * 
     * @param {string} charId - Character ID
     * @param {object} options - Query options
     * @param {number} options.week - Current week (default: 1)
     * @returns {object} Detail view model
     */
    function getCharacterDetail(charId, options) {
        if (!checkDependencies()) {
            return null;
        }

        options = options || {};
        var week = options.week || 1;

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return null;
        }

        return {
            character: char,
            name: CharacterQueries.getDisplayName(char),
            fullName: CharacterQueries.getFullName(char),
            age: CharacterQueries.getCharacterAge(char),
            status: CharacterQueries.getCurrentStatus(char),
            isStudent: CharacterQueries.isStudent(char),
            isInstructor: CharacterQueries.isInstructor(char),
            isCivilian: CharacterQueries.isCivilian(char),
            career: getCareer(char),
            academicTeams: getAcademicTeams(char),
            professionalTeams: getProfessionalTeams(char),
            temporaryTeams: getTemporaryTeams(char),
            civilianTeams: getCivilianTeams(char),
            missions: getMissions(char),
            grades: getGrades(char),
            tournamentEliminations: getTournamentEliminations(char),
            standaloneEliminations: getStandaloneEliminations(char),
            isEliminated: isEliminated(char, week),
            eliminationWeek: getEliminationWeek(char),
            eliminationReason: getEliminationReason(char),
            scheduleCount: getScheduleCount(char),
            relationships: getRelationships(char),
            stats: getStats(char),
            magic: getMagic(char),
            specialMoves: getSpecialMoves(char),
            classNames: getClassNames(char),
            deceased: char.deceased || false,
            deathYear: char.deathYear || '',
            deathCause: char.deathCause || '',
            deathAge: char.deathAge || '',
            deathWeek: char.deathWeek || ''
        };
    }

    // ============================================================
    // CAREER
    // ============================================================

    /**
     * Get career information for a character.
     * 
     * @param {object} char - Character object
     * @returns {object} Career information
     */
    function getCareer(char) {
        if (!char) return null;

        var careerStatus = Array.isArray(char.careerStatus) ? char.careerStatus : [];
        var currentStatus = CharacterQueries.getCurrentStatus(char);

        return {
            status: currentStatus,
            history: careerStatus.map(function(status) {
                return {
                    status: status.status || 'Unknown',
                    startYear: status.startYear || '',
                    endYear: status.endYear || '',
                    period: formatPeriod(status.startYear, status.endYear)
                };
            }),
            specialty: char.specialty || ''
        };
    }

    // ============================================================
    // TEAMS
    // ============================================================

    /**
     * Get academic teams for a character.
     * 
     * @param {object} char - Character object
     * @returns {Array} Academic teams
     */
    function getAcademicTeams(char) {
        if (!char) return [];

        var teams = TeamQueries.getTeamsForCharacter(char.id, ['academic']);
        return formatTeams(teams, char.id, 'Wk ');
    }

    /**
     * Get professional teams for a character.
     * 
     * @param {object} char - Character object
     * @returns {Array} Professional teams
     */
    function getProfessionalTeams(char) {
        if (!char) return [];

        var teams = TeamQueries.getTeamsForCharacter(char.id, ['professional']);
        return formatTeams(teams, char.id);
    }

    /**
     * Get temporary teams for a character.
     * 
     * @param {object} char - Character object
     * @returns {Array} Temporary teams
     */
    function getTemporaryTeams(char) {
        if (!char) return [];

        var teams = TeamQueries.getTeamsForCharacter(char.id, ['temporary']);
        return formatTeams(teams, char.id);
    }

    /**
     * Get civilian teams for a character.
     * 
     * @param {object} char - Character object
     * @returns {Array} Civilian teams
     */
    function getCivilianTeams(char) {
        if (!char) return [];

        var teams = TeamQueries.getTeamsForCharacter(char.id, ['civilian']);
        return formatTeams(teams, char.id);
    }

    /**
     * Format team data for display.
     * 
     * @param {Array} teams - Team objects
     * @param {string} charId - Character ID
     * @param {string} prefix - Period prefix
     * @returns {Array} Formatted teams
     */
    function formatTeams(teams, charId, prefix) {
        prefix = prefix || '';

        return teams.map(function(team) {
            var member = TeamQueries.getCharacterTeamMembership(team.id, charId);
            var classDisplay = '';
            if (team.classId) {
                var className = ClassesQueries.getClassDisplayName(team.classId);
                if (className) {
                    classDisplay = ' [' + className + ']';
                }
            }

            return {
                id: team.id,
                name: team.name,
                type: team.type,
                classId: team.classId,
                classDisplay: classDisplay,
                role: member ? member.role : '',
                joinPeriod: member ? member.joinPeriod : '',
                leavePeriod: member ? member.leavePeriod : '',
                periodDisplay: formatPeriod(
                    member ? member.joinPeriod : '',
                    member ? member.leavePeriod : '',
                    prefix
                ),
                status: team.status || 'active'
            };
        });
    }

    // ============================================================
    // MISSIONS
    // ============================================================

    /**
     * Get missions for a character.
     * 
     * @param {object} char - Character object
     * @returns {Array} Missions
     */
    function getMissions(char) {
        if (!char) return [];

        var missions = MissionQueries.getMissionsForCharacter(char.id) || [];

        return missions.map(function(m) {
            var teamName = TeamQueries.getTeamName(m.assignedTeamId) || 'Unknown Team';

            return {
                id: m.id,
                title: m.title || 'Untitled',
                status: m.status || 'active',
                location: m.location || '',
                teamId: m.assignedTeamId,
                teamName: teamName,
                priority: m.priority || 'medium',
                progress: m.progress || 0
            };
        });
    }

    // ============================================================
    // GRADES
    // ============================================================

    /**
     * Get grades for a character.
     * 
     * @param {object} char - Character object
     * @returns {Array} Grades (sorted by week)
     */
    function getGrades(char) {
        if (!char) return [];

        var grades = GradeQueries.getCharacterGrades(char.id) || [];

        // Sort by week
        grades.sort(function(a, b) {
            return parseInt(a.week, 10) - parseInt(b.week, 10);
        });

        return grades.map(function(g) {
            var discipline = DisciplineQueries.getDiscipline(g.disciplineId);
            var scoreNum = Number(g.score);

            return {
                week: g.week,
                disciplineId: g.disciplineId,
                disciplineName: discipline ? discipline.name : 'Unknown',
                score: scoreNum,
                scoreDisplay: isNaN(scoreNum) ? 'Invalid' : Math.round(scoreNum) + '%',
                passing: !isNaN(scoreNum) && scoreNum >= 70
            };
        });
    }

    // ============================================================
    // ELIMINATIONS
    // ============================================================

    /**
     * Get tournament eliminations for a character.
     * 
     * @param {object} char - Character object
     * @returns {Array} Tournament eliminations
     */
    function getTournamentEliminations(char) {
        if (!char) return [];

        var eliminations = Array.isArray(char.eliminations) ? char.eliminations : [];
        var tournaments = [];

        eliminations.forEach(function(e) {
            if (!e || e.standalone) return;

            var tournamentName = 'Unknown Tournament';
            if (e.tournamentId) {
                var tourn = window.TournamentQueries && typeof window.TournamentQueries.getTournamentById === 'function'
                    ? window.TournamentQueries.getTournamentById(e.tournamentId)
                    : null;
                if (tourn) tournamentName = tourn.name || 'Unknown Tournament';
            }

            tournaments.push({
                id: e.id,
                tournamentId: e.tournamentId,
                tournamentName: tournamentName,
                week: e.week || '?',
                reason: e.reason || '',
                fromMatch: e.fromMatch || false
            });
        });

        return tournaments;
    }

    /**
     * Get standalone eliminations for a character.
     * 
     * @param {object} char - Character object
     * @returns {Array} Standalone eliminations
     */
    function getStandaloneEliminations(char) {
        if (!char) return [];

        var eliminations = Array.isArray(char.eliminations) ? char.eliminations : [];

        return eliminations.filter(function(e) {
            return e && e.standalone;
        }).map(function(e) {
            return {
                id: e.id,
                week: e.week || '?',
                reason: e.reason || ''
            };
        });
    }

    /**
     * Check if a character is eliminated by a given week.
     * 
     * @param {object} char - Character object
     * @param {number} week - Week number
     * @returns {boolean} True if eliminated
     */
    function isEliminated(char, week) {
        if (!char) return false;

        return EliminationQueries.isCharacterEliminated(char.id, week);
    }

    /**
     * Get the week when a character was eliminated.
     * 
     * @param {object} char - Character object
     * @returns {number|null} Elimination week or null
     */
    function getEliminationWeek(char) {
        if (!char) return null;

        return EliminationQueries.getEliminationWeek(char.id);
    }

    /**
     * Get the reason for elimination.
     * 
     * @param {object} char - Character object
     * @returns {string} Elimination reason
     */
    function getEliminationReason(char) {
        if (!char) return 'Unknown';

        return EliminationQueries.getEliminationReason(char.id) || 'Unknown';
    }

    // ============================================================
    // SCHEDULE
    // ============================================================

    /**
     * Get schedule count for a character.
     * 
     * @param {object} char - Character object
     * @returns {number} Number of scheduled classes
     */
    function getScheduleCount(char) {
        if (!char) return 0;

        return ScheduleQueries.getCharacterScheduleCount(char.id) || 0;
    }

    // ============================================================
    // RELATIONSHIPS
    // ============================================================

    /**
     * Get relationships for a character.
     * 
     * @param {object} char - Character object
     * @returns {Array} Relationships with other character info
     */
    function getRelationships(char) {
        if (!char) return [];

        var rels = SocialQueries.getCharacterRelationships(char.id) || [];

        return rels.map(function(rel) {
            var otherId = String(rel.character1) === String(char.id) ? rel.character2 : rel.character1;
            var other = CharacterQueries.getCharacterById(otherId);
            var otherName = other ? CharacterQueries.getDisplayName(other) : 'Unknown';

            var typeLabel = SocialQueries.getRelationshipTypeLabel(rel.typeId);
            var typeColor = SocialQueries.getRelationshipTypeColor(rel.typeId);
            var isDirectional = SocialQueries.isRelationshipDirectional(rel.typeId);
            var isSource = String(rel.character1) === String(char.id);
            var directionText = isDirectional ? (isSource ? ' → ' : ' ← ') : ' ↔ ';

            var period = '';
            if (rel.startYear && rel.endYear) {
                period = rel.startYear + ' - ' + rel.endYear;
            } else if (rel.startYear) {
                period = 'From ' + rel.startYear;
            }

            return {
                id: rel.id,
                otherId: otherId,
                otherName: otherName,
                typeId: rel.typeId,
                typeLabel: typeLabel,
                typeColor: typeColor,
                isDirectional: isDirectional,
                isSource: isSource,
                directionText: directionText,
                clarification: rel.clarification || '',
                startYear: rel.startYear || '',
                endYear: rel.endYear || '',
                period: period,
                notes: rel.notes || ''
            };
        });
    }

    // ============================================================
    // STATS
    // ============================================================

    /**
     * Get stats for a character.
     * 
     * @param {object} char - Character object
     * @returns {object} Stats with modifiers
     */
    function getStats(char) {
        if (!char) {
            return getDefaultStats();
        }

        var stats = CharacterQueries.getCharacterStats(char);
        var result = {};

        STAT_KEYS.forEach(function(key) {
            var value = stats[key] !== undefined ? stats[key] : STAT_DEFAULT;
            result[key] = {
                value: value,
                modifier: getModifier(value),
                modifierDisplay: (getModifier(value) >= 0 ? '+' : '') + getModifier(value)
            };
        });

        return result;
    }

    /**
     * Get default stats.
     * 
     * @returns {object} Default stats
     */
    function getDefaultStats() {
        var result = {};
        STAT_KEYS.forEach(function(key) {
            result[key] = {
                value: STAT_DEFAULT,
                modifier: getModifier(STAT_DEFAULT),
                modifierDisplay: (getModifier(STAT_DEFAULT) >= 0 ? '+' : '') + getModifier(STAT_DEFAULT)
            };
        });
        return result;
    }

    // ============================================================
    // MAGIC
    // ============================================================

    /**
     * Get magic proficiencies for a character.
     * 
     * @param {object} char - Character object
     * @returns {object} Magic proficiencies with labels and colors
     */
    function getMagic(char) {
        if (!char) {
            return getDefaultMagic();
        }

        var magic = CharacterQueries.getCharacterMagic(char);
        var result = {};

        MAGIC_TYPE_KEYS.forEach(function(key) {
            var value = magic[key] !== undefined ? magic[key] : 0;
            result[key] = {
                value: value,
                label: getMagicTypeLabel(key),
                level: getMagicLevelLabel(value),
                color: getMagicLevelColor(value)
            };
        });

        return result;
    }

    /**
     * Get default magic proficiencies.
     * 
     * @returns {object} Default magic
     */
    function getDefaultMagic() {
        var result = {};
        MAGIC_TYPE_KEYS.forEach(function(key) {
            result[key] = {
                value: 0,
                label: getMagicTypeLabel(key),
                level: 'Untrained',
                color: 'var(--border)'
            };
        });
        return result;
    }

    // ============================================================
    // SPECIAL MOVES
    // ============================================================

    /**
     * Get special moves for a character.
     * 
     * @param {object} char - Character object
     * @returns {object} Special moves by type
     */
    function getSpecialMoves(char) {
        if (!char) {
            return { physical: [], magical: [] };
        }

        var moves = CharacterQueries.getCharacterSpecialMoves(char);

        return {
            physical: moves.physical.map(function(m) {
                return {
                    name: m.name || 'Unnamed Move',
                    description: m.description || ''
                };
            }),
            magical: moves.magical.map(function(m) {
                return {
                    name: m.name || 'Unnamed Move',
                    description: m.description || ''
                };
            })
        };
    }

    // ============================================================
    // CLASS NAMES
    // ============================================================

    /**
     * Get class names for a character.
     * 
     * @param {object} char - Character object
     * @returns {Array} Class names
     */
    function getClassNames(char) {
        if (!char) return [];

        var classes = ClassesQueries.getCharacterClasses(char);
        return classes.map(function(cls) {
            return cls.name || 'Unknown Class';
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterDetailQueries = {
        // Main query
        getCharacterDetail: getCharacterDetail,

        // Career
        getCareer: getCareer,

        // Teams
        getAcademicTeams: getAcademicTeams,
        getProfessionalTeams: getProfessionalTeams,
        getTemporaryTeams: getTemporaryTeams,
        getCivilianTeams: getCivilianTeams,
        formatTeams: formatTeams,

        // Missions
        getMissions: getMissions,

        // Grades
        getGrades: getGrades,

        // Eliminations
        getTournamentEliminations: getTournamentEliminations,
        getStandaloneEliminations: getStandaloneEliminations,
        isEliminated: isEliminated,
        getEliminationWeek: getEliminationWeek,
        getEliminationReason: getEliminationReason,

        // Schedule
        getScheduleCount: getScheduleCount,

        // Relationships
        getRelationships: getRelationships,

        // Stats
        getStats: getStats,

        // Magic
        getMagic: getMagic,

        // Special moves
        getSpecialMoves: getSpecialMoves,

        // Class names
        getClassNames: getClassNames,

        // Helpers
        formatPeriod: formatPeriod,
        getModifier: getModifier,
        getMagicLevelLabel: getMagicLevelLabel,
        getMagicLevelColor: getMagicLevelColor
    };

})();