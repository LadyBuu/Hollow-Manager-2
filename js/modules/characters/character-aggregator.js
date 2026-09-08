/**
 * modules/characters/character-aggregator.js - Character Aggregator
 * Character's integration boundary with external domains
 * 
 * This module provides Character-specific projections by composing
 * data from multiple shared queries.
 * 
 * IMPORTANT:
 *   - Projection builder, not a query registry
 *   - Composes canonical shared Queries
 *   - Never accesses window.data directly
 *   - Never mutates application/domain data
 *   - Never calls MutationUtils, saveData(), or UI APIs
 *   - Exposes Character-specific projections only
 *   - No passthrough methods
 *   - List projections avoid per-character N+1 aggregation
 * 
 * DEPENDENCIES:
 *   - window.CharacterQueries (from shared/queries)
 *   - window.AcademyQueries (from shared/queries)
 *   - window.TeamQueries (from shared/queries)
 *   - window.SocialQueries (from shared/queries)
 *   - window.MissionQueries (from shared/queries)
 *   - window.DisciplineQueries (from shared/queries)
 *   - window.EliminationQueries (from shared/queries)
 *   - window.TournamentQueries (from shared/queries)
 *   - window.CalendarQueries (from shared/queries)
 *   - window.CharacterStats (from character-stats.js)
 *   - window.CharacterConstants (from shared/constants)
 *   - window.CalendarConstants (from shared/constants)
 */

(function() {
    'use strict';

    if (window.__characterAggregatorLoaded) {
        return;
    }
    window.__characterAggregatorLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var AcademyQueries = window.AcademyQueries;
    var TeamQueries = window.TeamQueries;
    var SocialQueries = window.SocialQueries;
    var MissionQueries = window.MissionQueries;
    var DisciplineQueries = window.DisciplineQueries;
    var EliminationQueries = window.EliminationQueries;
    var TournamentQueries = window.TournamentQueries;
    var CalendarQueries = window.CalendarQueries;
    var CharacterStats = window.CharacterStats;
    var CharacterConstants = window.CharacterConstants;
    var CalendarConstants = window.CALENDAR_CONSTANTS;

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

        if (!AcademyQueries || typeof AcademyQueries.getCharacterClasses !== 'function') {
            missing.push('AcademyQueries.getCharacterClasses');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClassDisplayName !== 'function') {
            missing.push('AcademyQueries.getClassDisplayName');
        }

        if (!TeamQueries || typeof TeamQueries.getTeamsForCharacter !== 'function') {
            missing.push('TeamQueries.getTeamsForCharacter');
        }
        if (!TeamQueries || typeof TeamQueries.getTeamName !== 'function') {
            missing.push('TeamQueries.getTeamName');
        }
        if (!TeamQueries || typeof TeamQueries.getCharacterTeamMembership !== 'function') {
            missing.push('TeamQueries.getCharacterTeamMembership');
        }

        if (!SocialQueries || typeof SocialQueries.getCharacterRelationships !== 'function') {
            missing.push('SocialQueries.getCharacterRelationships');
        }
        if (!SocialQueries || typeof SocialQueries.getRelationshipTypeLabel !== 'function') {
            missing.push('SocialQueries.getRelationshipTypeLabel');
        }
        if (!SocialQueries || typeof SocialQueries.getRelationshipTypeColor !== 'function') {
            missing.push('SocialQueries.getRelationshipTypeColor');
        }

        if (!MissionQueries || typeof MissionQueries.getMissionsForCharacter !== 'function') {
            missing.push('MissionQueries.getMissionsForCharacter');
        }

        if (!DisciplineQueries || typeof DisciplineQueries.getDiscipline !== 'function') {
            missing.push('DisciplineQueries.getDiscipline');
        }

        if (!EliminationQueries || typeof EliminationQueries.isCharacterEliminated !== 'function') {
            missing.push('EliminationQueries.isCharacterEliminated');
        }
        if (!EliminationQueries || typeof EliminationQueries.getEliminationWeek !== 'function') {
            missing.push('EliminationQueries.getEliminationWeek');
        }
        if (!EliminationQueries || typeof EliminationQueries.getEliminationReason !== 'function') {
            missing.push('EliminationQueries.getEliminationReason');
        }

        if (!TournamentQueries || typeof TournamentQueries.getTournamentById !== 'function') {
            missing.push('TournamentQueries.getTournamentById');
        }

        if (!CalendarQueries || typeof CalendarQueries.getStudentSchedule !== 'function') {
            missing.push('CalendarQueries.getStudentSchedule');
        }

        if (!CharacterStats || typeof CharacterStats.getCharacterStats !== 'function') {
            missing.push('CharacterStats.getCharacterStats');
        }
        if (!CharacterStats || typeof CharacterStats.getCharacterMagic !== 'function') {
            missing.push('CharacterStats.getCharacterMagic');
        }

        if (!CharacterConstants) {
            missing.push('CharacterConstants');
        }

        if (!CalendarConstants) {
            missing.push('CALENDAR_CONSTANTS');
        }

        if (missing.length > 0) {
            console.warn('[CharacterAggregator] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // CONSTANTS
    // ============================================================

    var STAT_KEYS = CharacterConstants.STAT_KEYS;
    var STAT_DEFAULT = CharacterConstants.STAT_DEFAULT;

    var MIN_WEEK = CalendarConstants ? CalendarConstants.MIN_WEEK : 1;
    var MAX_WEEK = CalendarConstants ? CalendarConstants.MAX_WEEK : 52;
    var DEFAULT_WEEK = 1;

    // ============================================================
    // HELPERS
    // ============================================================

    function getCurrentWeek() {
        var data = window.data || {};
        var week = data.currentWeek;
        if (typeof week === 'number' && week >= MIN_WEEK && week <= MAX_WEEK) {
            return week;
        }
        return DEFAULT_WEEK;
    }

    function getModifier(value) {
        var num = Number(value);
        if (isNaN(num) || !isFinite(num)) { return 0; }
        return Math.floor((num - 10) / 2);
    }

    function getModifierDisplay(value) {
        var mod = getModifier(value);
        return (mod >= 0 ? '+' : '') + mod;
    }

    function getMagicLevelLabel(score) {
        var num = Number(score);
        if (isNaN(num) || !isFinite(num)) { return 'Untrained'; }
        if (num >= 9) { return 'Master'; }
        if (num >= 7) { return 'Expert'; }
        if (num >= 5) { return 'Adept'; }
        if (num >= 3) { return 'Apprentice'; }
        if (num >= 1) { return 'Novice'; }
        return 'Untrained';
    }

    function getMagicLevelColor(score) {
        var num = Number(score);
        if (isNaN(num) || !isFinite(num)) { return 'var(--border)'; }
        if (num >= 9) { return 'var(--danger)'; }
        if (num >= 7) { return 'var(--warning)'; }
        if (num >= 5) { return 'var(--accent)'; }
        if (num >= 3) { return 'var(--info)'; }
        if (num >= 1) { return 'var(--text-dim)'; }
        return 'var(--border)';
    }

    function getMagicTypeLabel(key) {
        if (window.MagicConstants && typeof window.MagicConstants.getTypeLabel === 'function') {
            return window.MagicConstants.getTypeLabel(key);
        }
        return key.charAt(0).toUpperCase() + key.slice(1);
    }

    function formatPeriod(join, leave, prefix) {
        prefix = prefix || '';
        var joinStr = (join !== undefined && join !== null && join !== '') ? String(join) : '';
        var leaveStr = (leave !== undefined && leave !== null && leave !== '') ? String(leave) : '';

        if (joinStr && leaveStr) { return prefix + joinStr + ' -> ' + prefix + leaveStr; }
        if (joinStr) { return prefix + joinStr + ' -> Present'; }
        if (leaveStr) { return 'Until ' + prefix + leaveStr; }
        return prefix + '?';
    }

    function formatTeams(teams, charId, prefix) {
        prefix = prefix || '';

        return teams.map(function(team) {
            var member = TeamQueries.getCharacterTeamMembership(team.id, charId);
            var classDisplay = '';
            if (team.classId) {
                var className = AcademyQueries.getClassDisplayName(team.classId);
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

    function formatGrade(grade) {
        var scoreNum = Number(grade.score);
        var discipline = DisciplineQueries.getDiscipline(grade.disciplineId);

        return {
            week: grade.week,
            disciplineId: grade.disciplineId,
            disciplineName: discipline ? discipline.name : 'Unknown',
            score: scoreNum,
            scoreDisplay: isNaN(scoreNum) ? 'Invalid' : Math.round(scoreNum) + '%',
            passing: !isNaN(scoreNum) && scoreNum >= 70
        };
    }

    function formatElimination(elim, charId) {
        if (!elim) { return null; }

        // Check if this elimination is for this character or stands alone
        if (elim.standalone) {
            return {
                id: elim.id,
                week: elim.week || '?',
                reason: elim.reason || '',
                standalone: true
            };
        }

        // Tournament elimination
        var tournamentName = 'Unknown Tournament';
        if (elim.tournamentId) {
            var tourn = TournamentQueries.getTournamentById(elim.tournamentId);
            if (tourn) { tournamentName = tourn.name || 'Unknown Tournament'; }
        }

        return {
            id: elim.id,
            tournamentId: elim.tournamentId,
            tournamentName: tournamentName,
            week: elim.week || '?',
            reason: elim.reason || '',
            fromMatch: elim.fromMatch || false,
            standalone: false
        };
    }

    function formatMission(mission) {
        var teamName = TeamQueries.getTeamName(mission.assignedTeamId) || 'Unknown Team';

        return {
            id: mission.id,
            title: mission.title || 'Untitled',
            status: mission.status || 'active',
            location: mission.location || '',
            teamId: mission.assignedTeamId,
            teamName: teamName,
            priority: mission.priority || 'medium',
            progress: mission.progress || 0
        };
    }

    function formatRelationship(rel, charId) {
        var otherId = String(rel.character1) === String(charId) ? rel.character2 : rel.character1;
        var other = CharacterQueries.getCharacterById(otherId);
        var otherName = other ? CharacterQueries.getDisplayName(other) : 'Unknown';

        var typeLabel = SocialQueries.getRelationshipTypeLabel(rel.typeId);
        var typeColor = SocialQueries.getRelationshipTypeColor(rel.typeId) || '#7f8c8d';

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
            clarification: rel.clarification || '',
            startYear: rel.startYear || '',
            endYear: rel.endYear || '',
            period: period,
            notes: rel.notes || ''
        };
    }

    // ============================================================
    // CHARACTER DETAIL PROJECTION
    // ============================================================

    /**
     * Get complete character detail projection.
     * Returns everything CharacterDetail.render() needs.
     * 
     * @param {string} characterId - Character ID
     * @param {object} options - Options
     * @param {number} options.week - Week number (default: current)
     * @param {boolean} options.includeSchedule - Include schedule data (default: false)
     * @param {boolean} options.includeGrades - Include grades (default: true)
     * @param {boolean} options.includeRelationships - Include relationships (default: true)
     * @param {boolean} options.includeMissions - Include missions (default: true)
     * @param {boolean} options.includeTeams - Include teams (default: true)
     * @param {boolean} options.includeEliminations - Include eliminations (default: true)
     * @returns {object|null} Character detail projection or null
     */
    function getCharacterDetail(characterId, options) {
        if (!characterId) {
            return null;
        }

        options = options || {};
        var weekNum = options.week || getCurrentWeek();

        var includeSchedule = options.includeSchedule !== false;
        var includeGrades = options.includeGrades !== false;
        var includeRelationships = options.includeRelationships !== false;
        var includeMissions = options.includeMissions !== false;
        var includeTeams = options.includeTeams !== false;
        var includeEliminations = options.includeEliminations !== false;

        var char = CharacterQueries.getCharacterById(characterId);
        if (!char) {
            return null;
        }

        // ---- Character Info ----
        var displayName = CharacterQueries.getDisplayName(char);
        var fullName = CharacterQueries.getFullName(char);
        var age = CharacterQueries.getCharacterAge(char);
        var status = CharacterQueries.getCurrentStatus(char);
        var isStudent = CharacterQueries.isStudent(char);
        var isInstructor = CharacterQueries.isInstructor(char);
        var isCivilian = CharacterQueries.isCivilian(char);

        // ---- Stats ----
        var stats = CharacterStats.getCharacterStats(char);
        var statsWithModifiers = {};
        STAT_KEYS.forEach(function(key) {
            var value = stats[key] !== undefined ? stats[key] : STAT_DEFAULT;
            statsWithModifiers[key] = {
                value: value,
                modifier: getModifier(value),
                modifierDisplay: getModifierDisplay(value)
            };
        });

        // ---- Magic ----
        var magicRaw = CharacterStats.getCharacterMagic(char);
        var magic = {};
        var magicTypeKeys = window.MagicConstants ? window.MagicConstants.getTypeKeys() : Object.keys(magicRaw);
        magicTypeKeys.forEach(function(key) {
            var value = magicRaw[key] || 0;
            magic[key] = {
                value: value,
                label: getMagicTypeLabel(key),
                level: getMagicLevelLabel(value),
                color: getMagicLevelColor(value)
            };
        });

        // ---- Class Names ----
        var classNames = AcademyQueries.getCharacterClassNames(char) || [];

        // ---- Teams ----
        var academicTeams = [];
        var professionalTeams = [];
        var temporaryTeams = [];
        var civilianTeams = [];

        if (includeTeams) {
            var allTeams = TeamQueries.getTeamsForCharacter(characterId);
            academicTeams = formatTeams(
                allTeams.filter(function(t) { return t.type === 'academic'; }),
                characterId,
                'Wk '
            );
            professionalTeams = formatTeams(
                allTeams.filter(function(t) { return t.type === 'professional'; }),
                characterId
            );
            temporaryTeams = formatTeams(
                allTeams.filter(function(t) { return t.type === 'temporary'; }),
                characterId
            );
            civilianTeams = formatTeams(
                allTeams.filter(function(t) { return t.type === 'civilian'; }),
                characterId
            );
        }

        // ---- Grades ----
        var grades = [];
        if (includeGrades) {
            var rawGrades = AcademyQueries.getCharacterGrades ? AcademyQueries.getCharacterGrades(characterId) : [];
            grades = rawGrades.map(formatGrade);
            grades.sort(function(a, b) {
                return parseInt(a.week, 10) - parseInt(b.week, 10);
            });
        }

        // ---- Missions ----
        var missions = [];
        if (includeMissions) {
            var rawMissions = MissionQueries.getMissionsForCharacter(characterId) || [];
            missions = rawMissions.map(formatMission);
        }

        // ---- Relationships ----
        var relationships = [];
        if (includeRelationships) {
            var rawRelationships = SocialQueries.getCharacterRelationships(characterId) || [];
            relationships = rawRelationships.map(function(rel) {
                return formatRelationship(rel, characterId);
            });
        }

        // ---- Eliminations ----
        var tournamentEliminations = [];
        var standaloneEliminations = [];
        var isEliminated = false;
        var eliminationWeek = null;
        var eliminationReason = 'Unknown';

        if (includeEliminations) {
            // Check elimination status
            isEliminated = EliminationQueries.isCharacterEliminated(characterId, weekNum);
            eliminationWeek = EliminationQueries.getEliminationWeek(characterId);
            eliminationReason = EliminationQueries.getEliminationReason(characterId) || 'Unknown';

            // Format eliminations
            var rawEliminations = char.eliminations || [];
            rawEliminations.forEach(function(elim) {
                var formatted = formatElimination(elim, characterId);
                if (formatted) {
                    if (formatted.standalone) {
                        standaloneEliminations.push(formatted);
                    } else {
                        tournamentEliminations.push(formatted);
                    }
                }
            });
        }

        // ---- Schedule ----
        var scheduleCount = 0;
        if (includeSchedule && CalendarQueries.getStudentSchedule) {
            var schedule = CalendarQueries.getStudentSchedule(characterId, weekNum);
            var count = 0;
            for (var day in schedule) {
                if (Object.prototype.hasOwnProperty.call(schedule, day)) {
                    var daySchedule = schedule[day];
                    if (daySchedule && typeof daySchedule === 'object') {
                        for (var hour in daySchedule) {
                            if (Object.prototype.hasOwnProperty.call(daySchedule, hour) && daySchedule[hour]) {
                                count++;
                            }
                        }
                    }
                }
            }
            scheduleCount = count;
        }

        // ---- Career Status ----
        var careerStatus = char.careerStatus || [];
        var careerHistory = careerStatus.map(function(status) {
            return {
                status: status.status || 'Unknown',
                startYear: status.startYear || '',
                endYear: status.endYear || '',
                period: formatPeriod(status.startYear, status.endYear)
            };
        });

        // ---- Special Moves ----
        var specialMoves = {
            physical: [],
            magical: []
        };
        if (char.specialMoves) {
            if (Array.isArray(char.specialMoves.physical)) {
                specialMoves.physical = char.specialMoves.physical.map(function(m) {
                    return {
                        name: m.name || 'Unnamed Move',
                        description: m.description || ''
                    };
                });
            }
            if (Array.isArray(char.specialMoves.magical)) {
                specialMoves.magical = char.specialMoves.magical.map(function(m) {
                    return {
                        name: m.name || 'Unnamed Move',
                        description: m.description || ''
                    };
                });
            }
        }

        // ---- Personality ----
        var personality = char.personality || {};

        // ---- Classes (actual class objects) ----
        var classes = AcademyQueries.getCharacterClasses(char) || [];

        // ---- Result ----
        return {
            // Character basics
            character: char,
            id: char.id,
            name: displayName,
            fullName: fullName,
            age: age,
            status: status,
            isStudent: isStudent,
            isInstructor: isInstructor,
            isCivilian: isCivilian,
            deceased: char.deceased || false,
            deathYear: char.deathYear || '',
            deathCause: char.deathCause || '',
            deathAge: char.deathAge || '',
            deathWeek: char.deathWeek || '',

            // Stats
            stats: statsWithModifiers,

            // Magic
            magic: magic,

            // Classes
            classes: classes,
            classNames: classNames,

            // Teams
            academicTeams: academicTeams,
            professionalTeams: professionalTeams,
            temporaryTeams: temporaryTeams,
            civilianTeams: civilianTeams,

            // Grades
            grades: grades,

            // Missions
            missions: missions,

            // Relationships
            relationships: relationships,

            // Eliminations
            isEliminated: isEliminated,
            eliminationWeek: eliminationWeek,
            eliminationReason: eliminationReason,
            tournamentEliminations: tournamentEliminations,
            standaloneEliminations: standaloneEliminations,

            // Schedule
            scheduleCount: scheduleCount,

            // Career
            careerStatus: char.careerStatus || [],
            careerHistory: careerHistory,
            specialty: char.specialty || '',

            // Personality
            personality: personality,

            // Special moves
            specialMoves: specialMoves,

            // Notes
            notes: char.notes || '',

            // Week
            week: weekNum
        };
    }

    // ============================================================
    // LIST VIEW MODEL PROJECTION
    // ============================================================

    /**
     * Get character list view model.
     * Collection-level projection that avoids per-character N+1 aggregation.
     * 
     * @param {object} options - Options
     * @param {string} options.classFilter - Filter by class ID
     * @param {string} options.nameFilter - Filter by name
     * @param {boolean} options.hideDeceased - Hide deceased characters
     * @param {boolean} options.hideEliminated - Hide eliminated characters
     * @param {number} options.week - Week number (default: current)
     * @returns {Array} Array of character list items
     */
    function getCharacterListViewModel(options) {
        options = options || {};
        var weekNum = options.week || getCurrentWeek();
        var classFilter = options.classFilter || 'all';
        var nameFilter = options.nameFilter || '';
        var hideDeceased = options.hideDeceased !== false;
        var hideEliminated = options.hideEliminated !== false;

        var characters = CharacterQueries.getCharacters() || [];

        // ---- Pre-compute class membership for all characters ----
        var classMembership = {};
        var allClasses = AcademyQueries.getClasses() || [];
        var classMap = {};
        allClasses.forEach(function(cls) {
            if (cls && cls.id) {
                classMap[cls.id] = cls.name;
            }
        });

        characters.forEach(function(char) {
            if (!char || !char.id) { return; }
            var classIds = char.classIds || [];
            classMembership[char.id] = classIds;
        });

        // ---- Pre-compute elimination status for all characters ----
        var eliminationStatus = {};
        if (EliminationQueries.isCharacterEliminated) {
            characters.forEach(function(char) {
                if (!char || !char.id) { return; }
                eliminationStatus[char.id] = {
                    eliminated: EliminationQueries.isCharacterEliminated(char.id, weekNum),
                    week: EliminationQueries.getEliminationWeek ? EliminationQueries.getEliminationWeek(char.id) : null,
                    reason: EliminationQueries.getEliminationReason ? EliminationQueries.getEliminationReason(char.id) : 'Unknown'
                };
            });
        }

        // ---- Filter ----
        var filtered = characters.filter(function(char) {
            if (!char || typeof char !== 'object') { return false; }

            // Name filter
            if (nameFilter) {
                var displayName = CharacterQueries.getDisplayName(char).toLowerCase();
                if (displayName.indexOf(nameFilter.toLowerCase()) === -1) {
                    return false;
                }
            }

            // Class filter
            if (classFilter !== 'all' && classFilter !== '') {
                var charClasses = classMembership[char.id] || [];
                var found = false;
                for (var i = 0; i < charClasses.length; i++) {
                    if (String(charClasses[i]) === String(classFilter)) {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    return false;
                }
            }

            // Hide deceased
            if (hideDeceased && char.deceased) {
                return false;
            }

            // Hide eliminated
            if (hideEliminated) {
                var elimStatus = eliminationStatus[char.id];
                if (elimStatus && elimStatus.eliminated) {
                    return false;
                }
            }

            return true;
        });

        // ---- Sort ----
        filtered.sort(function(a, b) {
            var nameA = CharacterQueries.getDisplayName(a);
            var nameB = CharacterQueries.getDisplayName(b);
            return nameA.localeCompare(nameB);
        });

        // ---- Build result ----
        return filtered.map(function(char) {
            var charClasses = classMembership[char.id] || [];
            var classNames = charClasses.map(function(id) {
                return classMap[id] || 'Unknown';
            }).filter(function(name) { return name && name !== 'Unknown'; });

            var elimStatus = eliminationStatus[char.id] || {
                eliminated: false,
                week: null,
                reason: 'Unknown'
            };

            return {
                id: char.id,
                name: CharacterQueries.getDisplayName(char),
                status: CharacterQueries.getCurrentStatus(char),
                deceased: char.deceased || false,
                eliminated: elimStatus.eliminated,
                eliminationWeek: elimStatus.week,
                eliminationReason: elimStatus.reason,
                classNames: classNames,
                classIds: charClasses
            };
        });
    }

    // ============================================================
    // ACADEMIC DATA PROJECTION
    // ============================================================

    /**
     * Get character academic data projection.
     * Teams, grades, elimination status for academic view.
     * 
     * @param {string} characterId - Character ID
     * @param {number} week - Week number (default: current)
     * @returns {object|null} Academic data projection or null
     */
    function getCharacterAcademicData(characterId, week) {
        if (!characterId) { return null; }

        var weekNum = week || getCurrentWeek();

        var char = CharacterQueries.getCharacterById(characterId);
        if (!char) { return null; }

        // Academic teams
        var allTeams = TeamQueries.getTeamsForCharacter(characterId);
        var academicTeams = formatTeams(
            allTeams.filter(function(t) { return t.type === 'academic'; }),
            characterId,
            'Wk '
        );

        // Grades
        var rawGrades = AcademyQueries.getCharacterGrades ? AcademyQueries.getCharacterGrades(characterId) : [];
        var grades = rawGrades.map(formatGrade);
        grades.sort(function(a, b) {
            return parseInt(a.week, 10) - parseInt(b.week, 10);
        });

        // Class names
        var classNames = AcademyQueries.getCharacterClassNames(char) || [];

        // Elimination status
        var isEliminated = EliminationQueries.isCharacterEliminated(characterId, weekNum);
        var eliminationWeek = EliminationQueries.getEliminationWeek(characterId);
        var eliminationReason = EliminationQueries.getEliminationReason(characterId) || 'Unknown';

        // Tournament eliminations
        var tournamentEliminations = [];
        var rawEliminations = char.eliminations || [];
        rawEliminations.forEach(function(elim) {
            if (!elim || elim.standalone) { return; }
            var formatted = formatElimination(elim, characterId);
            if (formatted) {
                tournamentEliminations.push(formatted);
            }
        });

        return {
            characterId: characterId,
            name: CharacterQueries.getDisplayName(char),
            week: weekNum,
            academicTeams: academicTeams,
            grades: grades,
            classNames: classNames,
            isEliminated: isEliminated,
            eliminationWeek: eliminationWeek,
            eliminationReason: eliminationReason,
            tournamentEliminations: tournamentEliminations
        };
    }

    // ============================================================
    // PROFESSIONAL DATA PROJECTION
    // ============================================================

    /**
     * Get character professional data projection.
     * Teams, missions, career for professional view.
     * 
     * @param {string} characterId - Character ID
     * @returns {object|null} Professional data projection or null
     */
    function getCharacterProfessionalData(characterId) {
        if (!characterId) { return null; }

        var char = CharacterQueries.getCharacterById(characterId);
        if (!char) { return null; }

        // Teams
        var allTeams = TeamQueries.getTeamsForCharacter(characterId);
        var professionalTeams = formatTeams(
            allTeams.filter(function(t) { return t.type === 'professional'; }),
            characterId
        );
        var temporaryTeams = formatTeams(
            allTeams.filter(function(t) { return t.type === 'temporary'; }),
            characterId
        );
        var civilianTeams = formatTeams(
            allTeams.filter(function(t) { return t.type === 'civilian'; }),
            characterId
        );

        // Missions
        var rawMissions = MissionQueries.getMissionsForCharacter(characterId) || [];
        var missions = rawMissions.map(formatMission);

        // Career status
        var careerStatus = char.careerStatus || [];
        var careerHistory = careerStatus.map(function(status) {
            return {
                status: status.status || 'Unknown',
                startYear: status.startYear || '',
                endYear: status.endYear || '',
                period: formatPeriod(status.startYear, status.endYear)
            };
        });

        return {
            characterId: characterId,
            name: CharacterQueries.getDisplayName(char),
            professionalTeams: professionalTeams,
            temporaryTeams: temporaryTeams,
            civilianTeams: civilianTeams,
            missions: missions,
            careerHistory: careerHistory,
            specialty: char.specialty || '',
            status: CharacterQueries.getCurrentStatus(char)
        };
    }

    // ============================================================
    // SOCIAL DATA PROJECTION
    // ============================================================

    /**
     * Get character social data projection.
     * Relationships only.
     * 
     * @param {string} characterId - Character ID
     * @returns {object|null} Social data projection or null
     */
    function getCharacterSocialData(characterId) {
        if (!characterId) { return null; }

        var char = CharacterQueries.getCharacterById(characterId);
        if (!char) { return null; }

        var rawRelationships = SocialQueries.getCharacterRelationships(characterId) || [];
        var relationships = rawRelationships.map(function(rel) {
            return formatRelationship(rel, characterId);
        });

        return {
            characterId: characterId,
            name: CharacterQueries.getDisplayName(char),
            relationships: relationships,
            relationshipCount: relationships.length
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterAggregator = {
        // Projections
        getCharacterDetail: getCharacterDetail,
        getCharacterListViewModel: getCharacterListViewModel,
        getCharacterAcademicData: getCharacterAcademicData,
        getCharacterProfessionalData: getCharacterProfessionalData,
        getCharacterSocialData: getCharacterSocialData,

        // Helpers (exposed for views that need formatting)
        formatPeriod: formatPeriod,
        formatTeams: formatTeams,
        formatGrade: formatGrade,
        formatElimination: formatElimination,
        formatMission: formatMission,
        formatRelationship: formatRelationship,
        getCurrentWeek: getCurrentWeek,

        // Constants
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK
    };

})();
