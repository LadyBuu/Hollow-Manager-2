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
 *   - Uses LAZY LOADING to break circular dependencies
 *   - Never accesses window.data directly
 *   - Never mutates application/domain data
 *   - Never calls MutationUtils, saveData(), or UI APIs
 *   - Exposes Character-specific projections only
 *   - No passthrough methods
 *   - List projections avoid per-character N+1 aggregation
 * 
 * DEATH TIMELINE SEMANTICS:
 *   - "Deceased" is TIME-DEPENDENT. A character with deathYear = 1920
 *     is alive in 1918 and dead in 1922.
 *   - `char.deceased` is a CACHED boolean maintained by CharacterCRUD.
 *     It reflects "dead as of window.data.currentYear".
 *   - All projections in this module compute `deceased` via
 *     CharacterQueries.isDeceased(char) so year changes are respected
 *     even if the cache is stale.
 * 
 * DEPENDENCIES (lazily loaded):
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
    // LAZY LOADING HELPERS - Breaks circular dependencies
    // ============================================================

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    function getAcademyQueries() {
        return window.AcademyQueries || null;
    }

    function getTeamQueries() {
        return window.TeamQueries || null;
    }

    function getSocialQueries() {
        return window.SocialQueries || null;
    }

    function getMissionQueries() {
        return window.MissionQueries || null;
    }

    function getDisciplineQueries() {
        return window.DisciplineQueries || null;
    }

    function getEliminationQueries() {
        return window.EliminationQueries || null;
    }

    function getTournamentQueries() {
        return window.TournamentQueries || null;
    }

    function getCalendarQueries() {
        return window.CalendarQueries || null;
    }

    function getCharacterStats() {
        return window.CharacterStats || null;
    }

    function getCharacterConstants() {
        return window.CharacterConstants || null;
    }

    function getCalendarConstants() {
        return window.CalendarConstants || null;
    }

    function getObjectUtils() {
        return window.ObjectUtils || null;
    }

    // ============================================================
    // DEPENDENCY CHECK - Warns but doesn't fail
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!getCharacterQueries()) {
            missing.push('CharacterQueries');
        }
        if (!getAcademyQueries()) {
            missing.push('AcademyQueries');
        }
        if (!getTeamQueries()) {
            missing.push('TeamQueries');
        }
        if (!getSocialQueries()) {
            missing.push('SocialQueries');
        }
        if (!getMissionQueries()) {
            missing.push('MissionQueries');
        }
        if (!getDisciplineQueries()) {
            missing.push('DisciplineQueries');
        }
        if (!getEliminationQueries()) {
            missing.push('EliminationQueries');
        }
        if (!getTournamentQueries()) {
            missing.push('TournamentQueries');
        }
        if (!getCalendarQueries()) {
            missing.push('CalendarQueries');
        }
        if (!getCharacterStats()) {
            missing.push('CharacterStats');
        }
        if (!getCharacterConstants()) {
            missing.push('CharacterConstants');
        }
        if (!getCalendarConstants()) {
            missing.push('CalendarConstants');
        }

        if (missing.length > 0) {
            console.warn('[CharacterAggregator] Some dependencies not yet loaded:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // CONSTANTS - Lazy loaded from CharacterConstants
    // ============================================================

    function getStatKeys() {
        var CC = getCharacterConstants();
        return CC ? CC.STAT_KEYS || ['str', 'dex', 'con', 'int', 'wis', 'cha'] : ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    }

    function getStatDefault() {
        var CC = getCharacterConstants();
        return CC ? CC.STAT_DEFAULT || 10 : 10;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function getCurrentWeek() {
        var data = window.data || {};
        var CC = getCalendarConstants();
        var week = data.currentWeek;
        var minWeek = CC ? CC.MIN_WEEK || 1 : 1;
        var maxWeek = CC ? CC.MAX_WEEK || 52 : 52;
        if (typeof week === 'number' && week >= minWeek && week <= maxWeek) {
            return week;
        }
        return 1;
    }

    /**
     * Check whether a character is deceased as of the current year.
     * 
     * Prefers CharacterQueries.isDeceased (the canonical query), which
     * computes from deathYear + current year. Falls back to the cached
     * char.deceased boolean if the query isn't available.
     * 
     * @param {object} char - Character object
     * @returns {boolean} True if deceased as of the current year
     */
    function isDeceased(char) {
        var CharacterQueries = getCharacterQueries();

        if (CharacterQueries && typeof CharacterQueries.isDeceased === 'function') {
            return CharacterQueries.isDeceased(char);
        }

        // Fallback: use the cached flag
        return char && char.deceased === true;
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
        var TeamQueries = getTeamQueries();
        var AcademyQueries = getAcademyQueries();
        var CharacterQueries = getCharacterQueries();

        if (!TeamQueries || !CharacterQueries) {
            return teams.map(function(team) {
                return {
                    id: team.id,
                    name: team.name || 'Unknown',
                    type: team.type,
                    classId: team.classId,
                    classDisplay: '',
                    role: '',
                    joinPeriod: '',
                    leavePeriod: '',
                    periodDisplay: '',
                    status: team.status || 'active'
                };
            });
        }

        return teams.map(function(team) {
            var member = TeamQueries.getCharacterTeamMembership(team.id, charId);
            var classDisplay = '';
            if (team.classId && AcademyQueries) {
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
        var DisciplineQueries = getDisciplineQueries();
        var discipline = DisciplineQueries ? DisciplineQueries.getDiscipline(grade.disciplineId) : null;

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

        var TournamentQueries = getTournamentQueries();

        if (elim.standalone) {
            return {
                id: elim.id,
                week: elim.week || '?',
                reason: elim.reason || '',
                standalone: true
            };
        }

        var tournamentName = 'Unknown Tournament';
        if (elim.tournamentId && TournamentQueries) {
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
        var TeamQueries = getTeamQueries();
        var teamName = (TeamQueries && TeamQueries.getTeamName)
            ? TeamQueries.getTeamName(mission.assignedTeamId)
            : 'Unknown Team';

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
        var CharacterQueries = getCharacterQueries();
        var SocialQueries = getSocialQueries();

        if (!CharacterQueries || !SocialQueries) {
            return {
                id: rel.id,
                otherId: '',
                otherName: 'Unknown',
                typeId: rel.typeId || '',
                typeLabel: '',
                typeColor: '#7f8c8d',
                clarification: rel.clarification || '',
                startYear: rel.startYear || '',
                endYear: rel.endYear || '',
                period: '',
                notes: rel.notes || ''
            };
        }

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

        var CharacterQueries = getCharacterQueries();
        var AcademyQueries = getAcademyQueries();
        var TeamQueries = getTeamQueries();
        var SocialQueries = getSocialQueries();
        var MissionQueries = getMissionQueries();
        var DisciplineQueries = getDisciplineQueries();
        var EliminationQueries = getEliminationQueries();
        var TournamentQueries = getTournamentQueries();
        var CalendarQueries = getCalendarQueries();
        var CharacterStats = getCharacterStats();
        var CharacterConstants = getCharacterConstants();

        if (!CharacterQueries) {
            console.warn('[CharacterAggregator] CharacterQueries not available for getCharacterDetail');
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

        // ---- Death Timeline ----
        // Computed via the query so it reflects the current year, not a
        // potentially stale cached char.deceased flag.
        var deceasedNow = isDeceased(char);
        var deathYear = char.deathYear ? String(char.deathYear).trim() : '';
        var deathCause = char.deathCause ? String(char.deathCause).trim() : '';
        var deathAge = char.deathAge ? String(char.deathAge).trim() : '';
        var deathWeek = char.deathWeek ? String(char.deathWeek).trim() : '';

        // ---- Stats ----
        var statsWithModifiers = {};
        var statKeys = getStatKeys();
        var statDefault = getStatDefault();

        if (CharacterStats) {
            var stats = CharacterStats.getCharacterStats(char);
            statKeys.forEach(function(key) {
                var value = stats[key] !== undefined ? stats[key] : statDefault;
                statsWithModifiers[key] = {
                    value: value,
                    modifier: getModifier(value),
                    modifierDisplay: getModifierDisplay(value)
                };
            });
        } else {
            statKeys.forEach(function(key) {
                var value = (char.stats && char.stats[key] !== undefined) ? char.stats[key] : statDefault;
                statsWithModifiers[key] = {
                    value: value,
                    modifier: getModifier(value),
                    modifierDisplay: getModifierDisplay(value)
                };
            });
        }

        // ---- Magic ----
        var magic = {};
        if (CharacterStats) {
            var magicRaw = CharacterStats.getCharacterMagic(char);
            var magicTypeKeys = window.MagicConstants
                ? window.MagicConstants.getTypeKeys()
                : Object.keys(magicRaw);
            magicTypeKeys.forEach(function(key) {
                var value = magicRaw[key] || 0;
                magic[key] = {
                    value: value,
                    label: getMagicTypeLabel(key),
                    level: getMagicLevelLabel(value),
                    color: getMagicLevelColor(value)
                };
            });
        }

        // ---- Class Names ----
        var classNames = [];
        if (AcademyQueries) {
            classNames = AcademyQueries.getCharacterClassNames(char) || [];
        }

        // ---- Teams ----
        var academicTeams = [];
        var professionalTeams = [];
        var temporaryTeams = [];
        var civilianTeams = [];

        if (includeTeams && TeamQueries) {
            var allTeams = TeamQueries.getTeamsForCharacter(characterId);
            if (allTeams) {
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
        }

        // ---- Grades ----
        var grades = [];
        if (includeGrades && AcademyQueries) {
            var rawGrades = AcademyQueries.getStudentGrades
                ? AcademyQueries.getStudentGrades(characterId)
                : [];
            grades = rawGrades.map(formatGrade);
            grades.sort(function(a, b) {
                return parseInt(a.week, 10) - parseInt(b.week, 10);
            });
        }

        // ---- Missions ----
        var missions = [];
        if (includeMissions && MissionQueries) {
            var rawMissions = MissionQueries.getMissionsForCharacter(characterId) || [];
            missions = rawMissions.map(formatMission);
        }

        // ---- Relationships ----
        var relationships = [];
        if (includeRelationships && SocialQueries) {
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

        if (includeEliminations && EliminationQueries) {
            isEliminated = EliminationQueries.isCharacterEliminated(characterId, weekNum);
            eliminationWeek = EliminationQueries.getEliminationWeek(characterId);
            eliminationReason = EliminationQueries.getEliminationReason(characterId) || 'Unknown';

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
        if (includeSchedule && CalendarQueries && CalendarQueries.getStudentSchedule) {
            var schedule = CalendarQueries.getStudentSchedule(characterId, weekNum);
            if (schedule) {
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
        var classes = [];
        if (AcademyQueries) {
            classes = AcademyQueries.getCharacterClasses(char) || [];
        }

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

            // Death timeline (computed)
            deceased: deceasedNow,
            deathYear: deathYear,
            deathCause: deathCause,
            deathAge: deathAge,
            deathWeek: deathWeek,

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
        var CharacterQueries = getCharacterQueries();
        var AcademyQueries = getAcademyQueries();
        var EliminationQueries = getEliminationQueries();

        if (!CharacterQueries) {
            console.warn('[CharacterAggregator] CharacterQueries not available for getCharacterListViewModel');
            return [];
        }

        options = options || {};
        var weekNum = options.week || getCurrentWeek();
        var classFilter = options.classFilter || 'all';
        var nameFilter = options.nameFilter || '';
        var hideDeceased = options.hideDeceased !== false;
        var hideEliminated = options.hideEliminated !== false;

        var characters = CharacterQueries.getCharacters() || [];

        // ---- Pre-compute class membership for all characters ----
        var classMembership = {};
        var classMap = {};
        if (AcademyQueries) {
            var allClasses = AcademyQueries.getClasses() || [];
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
        }

        // ---- Pre-compute elimination status for all characters ----
        var eliminationStatus = {};
        if (EliminationQueries) {
            characters.forEach(function(char) {
                if (!char || !char.id) { return; }
                eliminationStatus[char.id] = {
                    eliminated: EliminationQueries.isCharacterEliminated(char.id, weekNum),
                    week: EliminationQueries.getEliminationWeek
                        ? EliminationQueries.getEliminationWeek(char.id)
                        : null,
                    reason: EliminationQueries.getEliminationReason
                        ? EliminationQueries.getEliminationReason(char.id)
                        : 'Unknown'
                };
            });
        }

        // ---- Pre-compute deceased status for all characters ----
        // Uses the year-aware query, not the cached flag.
        var deceasedStatus = {};
        characters.forEach(function(char) {
            if (!char || !char.id) { return; }
            deceasedStatus[char.id] = isDeceased(char);
        });

        // ---- Filter ----
        var filtered = characters.filter(function(char) {
            if (!char || typeof char !== 'object') { return false; }

            if (nameFilter) {
                var displayName = CharacterQueries.getDisplayName(char).toLowerCase();
                if (displayName.indexOf(nameFilter.toLowerCase()) === -1) {
                    return false;
                }
            }

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

            if (hideDeceased && deceasedStatus[char.id]) {
                return false;
            }

            if (hideEliminated && eliminationStatus[char.id] && eliminationStatus[char.id].eliminated) {
                return false;
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
                deceased: deceasedStatus[char.id] === true,
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

    function getCharacterAcademicData(characterId, week) {
        if (!characterId) { return null; }

        var CharacterQueries = getCharacterQueries();
        var AcademyQueries = getAcademyQueries();
        var TeamQueries = getTeamQueries();
        var EliminationQueries = getEliminationQueries();

        if (!CharacterQueries) { return null; }

        var weekNum = week || getCurrentWeek();
        var char = CharacterQueries.getCharacterById(characterId);
        if (!char) { return null; }

        var academicTeams = [];
        if (TeamQueries) {
            var allTeams = TeamQueries.getTeamsForCharacter(characterId);
            if (allTeams) {
                academicTeams = formatTeams(
                    allTeams.filter(function(t) { return t.type === 'academic'; }),
                    characterId,
                    'Wk '
                );
            }
        }

        var grades = [];
        if (AcademyQueries) {
            var rawGrades = AcademyQueries.getStudentGrades
                ? AcademyQueries.getStudentGrades(characterId)
                : [];
            grades = rawGrades.map(formatGrade);
            grades.sort(function(a, b) {
                return parseInt(a.week, 10) - parseInt(b.week, 10);
            });
        }

        var classNames = [];
        if (AcademyQueries) {
            classNames = AcademyQueries.getCharacterClassNames(char) || [];
        }

        var isEliminated = false;
        var eliminationWeek = null;
        var eliminationReason = 'Unknown';
        var tournamentEliminations = [];

        if (EliminationQueries) {
            isEliminated = EliminationQueries.isCharacterEliminated(characterId, weekNum);
            eliminationWeek = EliminationQueries.getEliminationWeek(characterId);
            eliminationReason = EliminationQueries.getEliminationReason(characterId) || 'Unknown';

            var rawEliminations = char.eliminations || [];
            rawEliminations.forEach(function(elim) {
                if (!elim || elim.standalone) { return; }
                var formatted = formatElimination(elim, characterId);
                if (formatted) {
                    tournamentEliminations.push(formatted);
                }
            });
        }

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

    function getCharacterProfessionalData(characterId) {
        if (!characterId) { return null; }

        var CharacterQueries = getCharacterQueries();
        var TeamQueries = getTeamQueries();
        var MissionQueries = getMissionQueries();

        if (!CharacterQueries) { return null; }

        var char = CharacterQueries.getCharacterById(characterId);
        if (!char) { return null; }

        var professionalTeams = [];
        var temporaryTeams = [];
        var civilianTeams = [];

        if (TeamQueries) {
            var allTeams = TeamQueries.getTeamsForCharacter(characterId);
            if (allTeams) {
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
        }

        var missions = [];
        if (MissionQueries) {
            var rawMissions = MissionQueries.getMissionsForCharacter(characterId) || [];
            missions = rawMissions.map(formatMission);
        }

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

    function getCharacterSocialData(characterId) {
        if (!characterId) { return null; }

        var CharacterQueries = getCharacterQueries();
        var SocialQueries = getSocialQueries();

        if (!CharacterQueries) { return null; }

        var char = CharacterQueries.getCharacterById(characterId);
        if (!char) { return null; }

        var relationships = [];
        if (SocialQueries) {
            var rawRelationships = SocialQueries.getCharacterRelationships(characterId) || [];
            relationships = rawRelationships.map(function(rel) {
                return formatRelationship(rel, characterId);
            });
        }

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
        getCharacterDetail: getCharacterDetail,
        getCharacterListViewModel: getCharacterListViewModel,
        getCharacterAcademicData: getCharacterAcademicData,
        getCharacterProfessionalData: getCharacterProfessionalData,
        getCharacterSocialData: getCharacterSocialData,

        formatPeriod: formatPeriod,
        formatTeams: formatTeams,
        formatGrade: formatGrade,
        formatElimination: formatElimination,
        formatMission: formatMission,
        formatRelationship: formatRelationship,
        getCurrentWeek: getCurrentWeek,
        isDeceased: isDeceased,

        get MIN_WEEK() {
            var CC = getCalendarConstants();
            return CC ? CC.MIN_WEEK || 1 : 1;
        },
        get MAX_WEEK() {
            var CC = getCalendarConstants();
            return CC ? CC.MAX_WEEK || 52 : 52;
        }
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.CharacterAggregator;
        var missing = [];

        var required = [
            'getCharacterDetail',
            'getCharacterListViewModel',
            'getCharacterAcademicData',
            'getCharacterProfessionalData',
            'getCharacterSocialData'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[CharacterAggregator] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[CharacterAggregator] All exports verified successfully.');
        }
    })();

})();