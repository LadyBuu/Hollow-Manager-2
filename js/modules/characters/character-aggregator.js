/**
 * modules/characters/character-aggregator.js - Character Aggregator
 * Character's integration boundary with external domains.
 *
 * Path: js/modules/characters/character-aggregator.js
 *
 * RESPONSIBILITIES:
 *   - Build character projections by composing shared queries and
 *     domain modules.
 *   - Return display-ready view models. No raw domain entities escape.
 *   - Never mutate. Never touch persistence. No UI dependencies.
 *
 * PROJECTIONS:
 *   - getCharacterDetail(id, options)
 *   - getCharacterListViewModel(options)
 *   - getCharacterAcademicData(id, week)
 *   - getCharacterProfessionalData(id)
 *   - getCharacterSocialData(id)
 *
 * LIST PROJECTION (this revision):
 *   - Accepts hideFiller, classFilter (including the __no_class__
 *     sentinel), sort.
 *   - Rows carry age and ageDisplay, plus a year-scoped deceased and
 *     elimination status.
 *   - Sort is applied once, after filtering; ages are computed once
 *     and reused by both the sort and the row build.
 *
 * __no_class__ SEMANTICS:
 *   A character matches __no_class__ when classIds is empty, OR when
 *   every entry in classIds fails to resolve against the live class
 *   set. The class set is owned by AcademyClasses. If that module is
 *   unavailable, this projection throws rather than silently
 *   returning wrong results.
 *
 * DEATH MODEL:
 *   char.deceased is a cached boolean. All projections compute
 *   deceased via CharacterQueries.isDeceased(char, year) so year
 *   changes are respected even if the cache is stale.
 *
 * DEPENDENCIES (lazily loaded):
 *   - window.CharacterQueries
 *   - window.AcademyClasses
 *   - window.AcademyGrades
 *   - window.AcademyDisciplines
 *   - window.TeamQueries
 *   - window.SocialQueries
 *   - window.MissionQueries
 *   - window.EliminationQueries
 *   - window.TournamentQueries
 *   - window.CalendarQueries
 *   - window.CharacterStats
 *   - window.CharacterConstants
 *   - window.CalendarConstants
 */

(function() {
    'use strict';

    if (window.__characterAggregatorLoaded) {
        return;
    }
    window.__characterAggregatorLoaded = true;

    // ============================================================
    // LAZY DEPENDENCIES
    // ============================================================

    function getCharacterQueries() { return window.CharacterQueries || null; }
    function getAcademyClasses() { return window.AcademyClasses || null; }
    function getAcademyGrades() { return window.AcademyGrades || null; }
    function getAcademyDisciplines() { return window.AcademyDisciplines || null; }
    function getTeamQueries() { return window.TeamQueries || null; }
    function getSocialQueries() { return window.SocialQueries || null; }
    function getMissionQueries() { return window.MissionQueries || null; }
    function getEliminationQueries() { return window.EliminationQueries || null; }
    function getTournamentQueries() { return window.TournamentQueries || null; }
    function getCalendarQueries() { return window.CalendarQueries || null; }
    function getCharacterStats() { return window.CharacterStats || null; }
    function getCharacterConstants() { return window.CharacterConstants || null; }
    function getCalendarConstants() { return window.CalendarConstants || null; }

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!getCharacterQueries()) { missing.push('CharacterQueries'); }
        if (!getAcademyClasses()) { missing.push('AcademyClasses'); }
        if (!getAcademyGrades()) { missing.push('AcademyGrades'); }
        if (!getAcademyDisciplines()) { missing.push('AcademyDisciplines'); }
        if (!getTeamQueries()) { missing.push('TeamQueries'); }
        if (!getSocialQueries()) { missing.push('SocialQueries'); }
        if (!getMissionQueries()) { missing.push('MissionQueries'); }
        if (!getEliminationQueries()) { missing.push('EliminationQueries'); }
        if (!getTournamentQueries()) { missing.push('TournamentQueries'); }
        if (!getCalendarQueries()) { missing.push('CalendarQueries'); }
        if (!getCharacterStats()) { missing.push('CharacterStats'); }
        if (!getCharacterConstants()) { missing.push('CharacterConstants'); }
        if (!getCalendarConstants()) { missing.push('CalendarConstants'); }

        if (missing.length > 0) {
            console.warn(
                '[CharacterAggregator] Dependencies not yet loaded:',
                missing.join(', ')
            );
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // CONSTANTS
    // ============================================================

    var NO_CLASS_FILTER = '__no_class__';

    var VALID_SORTS = {
        'name-asc': true,
        'name-desc': true,
        'age-asc': true,
        'age-desc': true
    };

    var DEFAULT_SORT = 'name-asc';

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

    function resolveFilterYear(options) {
        if (options &&
            options.year !== undefined &&
            options.year !== null) {
            var explicit = parseInt(options.year, 10);
            if (!isNaN(explicit) && explicit >= 1) {
                return explicit;
            }
        }

        var data = window.data || {};
        if (typeof data.currentYear === 'number' &&
            isFinite(data.currentYear) &&
            data.currentYear > 0) {
            return Math.floor(data.currentYear);
        }

        return new Date().getFullYear();
    }

    function isDeceased(char, year) {
        var CharacterQueries = getCharacterQueries();

        if (CharacterQueries &&
            typeof CharacterQueries.isDeceased === 'function') {
            return CharacterQueries.isDeceased(char, year);
        }

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
        if (window.MagicConstants &&
            typeof window.MagicConstants.getTypeLabel === 'function') {
            return window.MagicConstants.getTypeLabel(key);
        }
        return key.charAt(0).toUpperCase() + key.slice(1);
    }

    function formatPeriod(join, leave, prefix) {
        prefix = prefix || '';
        var joinStr = (join !== undefined && join !== null && join !== '')
            ? String(join) : '';
        var leaveStr = (leave !== undefined && leave !== null && leave !== '')
            ? String(leave) : '';

        if (joinStr && leaveStr) {
            return prefix + joinStr + ' -> ' + prefix + leaveStr;
        }
        if (joinStr) { return prefix + joinStr + ' -> Present'; }
        if (leaveStr) { return 'Until ' + prefix + leaveStr; }
        return prefix + '?';
    }

    function formatTeams(teams, charId, prefix) {
        prefix = prefix || '';
        var TeamQueries = getTeamQueries();
        var AcademyClasses = getAcademyClasses();
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
            var member = TeamQueries.getCharacterTeamMembership(
                team.id, charId
            );
            var classDisplay = '';
            if (team.classId && AcademyClasses) {
                var className = AcademyClasses.getDisplayName(team.classId);
                if (className && className !== 'Unknown Class') {
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
        var maxNum = Number(grade.maxScore);
        var AcademyDisciplines = getAcademyDisciplines();
        var discipline = null;
        if (AcademyDisciplines &&
            typeof AcademyDisciplines.getDiscipline === 'function') {
            discipline = AcademyDisciplines.getDiscipline(grade.disciplineId);
        }

        var percentage;
        if (!isNaN(scoreNum) && !isNaN(maxNum) && maxNum > 0) {
            percentage = Math.round((scoreNum / maxNum) * 100);
        } else {
            percentage = null;
        }

        return {
            week: grade.week,
            disciplineId: grade.disciplineId,
            disciplineName: discipline ? discipline.name : 'Unknown',
            score: scoreNum,
            maxScore: maxNum,
            scoreDisplay: percentage !== null ? percentage + '%' : 'Invalid',
            percentage: percentage
        };
    }

    function formatElimination(elim, charId) {
        if (!elim) { return null; }

        var TournamentQueries = getTournamentQueries();

        var year = parseInt(elim.year, 10);
        if (isNaN(year) || year < 1) { year = null; }

        var week = parseInt(elim.week, 10);
        if (isNaN(week) || week < 1) { week = null; }

        if (elim.standalone) {
            return {
                id: elim.id,
                year: year,
                week: week,
                reason: elim.reason || '',
                standalone: true
            };
        }

        var tournamentName = 'Unknown Tournament';
        if (elim.tournamentId && TournamentQueries) {
            var tourn = null;
            try {
                if (typeof TournamentQueries.getTournament === 'function') {
                    tourn = TournamentQueries.getTournament(
                        elim.tournamentId
                    );
                } else if (typeof TournamentQueries.getTournamentById ===
                    'function') {
                    tourn = TournamentQueries.getTournamentById(
                        elim.tournamentId
                    );
                }
            } catch (e) {
                console.warn(
                    '[CharacterAggregator] Tournament lookup failed:',
                    elim.tournamentId, e
                );
                tourn = null;
            }
            if (tourn) {
                tournamentName = tourn.name || 'Unknown Tournament';
            }
        }

        return {
            id: elim.id,
            tournamentId: elim.tournamentId,
            tournamentName: tournamentName,
            year: year,
            week: week,
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

        var otherId = String(rel.character1) === String(charId)
            ? rel.character2
            : rel.character1;
        var other = CharacterQueries.getCharacterById(otherId);
        var otherName = other
            ? CharacterQueries.getDisplayName(other)
            : 'Unknown';

        var typeLabel = SocialQueries.getRelationshipTypeLabel(rel.typeId);
        var typeColor = SocialQueries.getRelationshipTypeColor(rel.typeId) ||
            '#7f8c8d';

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
    // ACADEMY READS
    // ============================================================

    function academyGetCharacterClasses(char) {
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses ||
            typeof AcademyClasses.getCharacterClasses !== 'function') {
            return [];
        }
        return AcademyClasses.getCharacterClasses(char) || [];
    }

    function academyGetCharacterClassNames(char) {
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses ||
            typeof AcademyClasses.getCharacterClassNames !== 'function') {
            return [];
        }
        return AcademyClasses.getCharacterClassNames(char) || [];
    }

    function academyGetClassDisplayName(classId) {
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses ||
            typeof AcademyClasses.getDisplayName !== 'function') {
            return '';
        }
        return AcademyClasses.getDisplayName(classId) || '';
    }

    function academyGetStudentGrades(studentId, week) {
        var AcademyGrades = getAcademyGrades();
        if (!AcademyGrades ||
            typeof AcademyGrades.getStudentGrades !== 'function') {
            return [];
        }
        return AcademyGrades.getStudentGrades(studentId, week) || [];
    }

    function academyGetDiscipline(disciplineId) {
        var AcademyDisciplines = getAcademyDisciplines();
        if (!AcademyDisciplines ||
            typeof AcademyDisciplines.getDiscipline !== 'function') {
            return null;
        }
        return AcademyDisciplines.getDiscipline(disciplineId);
    }

    // ============================================================
    // TEAM READS (LIST)
    // ============================================================

    function getCurrentProfessionalTeamsForList(charId, year) {
        if (!charId) { return []; }

        var TeamQueries = getTeamQueries();
        if (!TeamQueries ||
            typeof TeamQueries.getTeamsForCharacter !== 'function') {
            return [];
        }

        var yearNum = parseInt(year, 10);
        if (isNaN(yearNum) || yearNum < 1) { return []; }

        var teams = TeamQueries.getTeamsForCharacter(
            charId, yearNum, 'professional'
        ) || [];

        var result = [];
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || !team.id) { continue; }
            if (team.status === 'deprecated') { continue; }
            result.push({
                id: String(team.id),
                name: team.name || 'Unnamed Team'
            });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    // ============================================================
    // CHARACTER DETAIL PROJECTION
    // ============================================================

    function getCharacterDetail(characterId, options) {
        if (!characterId) { return null; }

        var CharacterQueries = getCharacterQueries();
        var TeamQueries = getTeamQueries();
        var SocialQueries = getSocialQueries();
        var MissionQueries = getMissionQueries();
        var EliminationQueries = getEliminationQueries();
        var CharacterStats = getCharacterStats();

        if (!CharacterQueries) {
            console.warn(
                '[CharacterAggregator] CharacterQueries unavailable ' +
                'for getCharacterDetail'
            );
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
        if (!char) { return null; }

        // ---- Character info ----
        var displayName = CharacterQueries.getDisplayName(char);
        var fullName = CharacterQueries.getFullName(char);
        var age = CharacterQueries.getCharacterAge(char);
        var status = CharacterQueries.getCurrentStatus(char);
        var isStudent = CharacterQueries.isStudent(char);
        var isInstructor = CharacterQueries.isInstructor(char);
        var isCivilian = CharacterQueries.isCivilian(char);

        // ---- Death timeline ----
        var deceasedNow = isDeceased(char);
        var deathYear = char.deathYear
            ? String(char.deathYear).trim() : '';
        var deathCause = char.deathCause
            ? String(char.deathCause).trim() : '';
        var deathAge = char.deathAge
            ? String(char.deathAge).trim() : '';
        var deathWeek = char.deathWeek
            ? String(char.deathWeek).trim() : '';

        // ---- Stats ----
        var statsWithModifiers = {};
        var statKeys = getStatKeys();
        var statDefault = getStatDefault();

        if (CharacterStats) {
            var stats = CharacterStats.getCharacterStats(char);
            statKeys.forEach(function(key) {
                var value = stats[key] !== undefined
                    ? stats[key] : statDefault;
                statsWithModifiers[key] = {
                    value: value,
                    modifier: getModifier(value),
                    modifierDisplay: getModifierDisplay(value)
                };
            });
        } else {
            statKeys.forEach(function(key) {
                var value = (char.stats && char.stats[key] !== undefined)
                    ? char.stats[key] : statDefault;
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

        // ---- Class names ----
        var classNames = academyGetCharacterClassNames(char);

        // ---- Teams ----
        var academicTeams = [];
        var professionalTeams = [];
        var temporaryTeams = [];
        var civilianTeams = [];

        if (includeTeams && TeamQueries) {
            var allTeams = TeamQueries.getTeamsForCharacter(characterId);
            if (allTeams) {
                academicTeams = formatTeams(
                    allTeams.filter(function(t) {
                        return t.type === 'academic';
                    }),
                    characterId,
                    'Wk '
                );
                professionalTeams = formatTeams(
                    allTeams.filter(function(t) {
                        return t.type === 'professional';
                    }),
                    characterId
                );
                temporaryTeams = formatTeams(
                    allTeams.filter(function(t) {
                        return t.type === 'temporary';
                    }),
                    characterId
                );
                civilianTeams = formatTeams(
                    allTeams.filter(function(t) {
                        return t.type === 'civilian';
                    }),
                    characterId
                );
            }
        }

        // ---- Grades ----
        var grades = [];
        if (includeGrades) {
            var rawGrades = academyGetStudentGrades(characterId);
            grades = rawGrades.map(formatGrade);
            grades.sort(function(a, b) {
                return parseInt(a.week, 10) - parseInt(b.week, 10);
            });
        }

        // ---- Missions ----
        var missions = [];
        if (includeMissions && MissionQueries) {
            var rawMissions =
                MissionQueries.getMissionsForCharacter(characterId) || [];
            missions = rawMissions.map(formatMission);
        }

        // ---- Relationships ----
        var relationships = [];
        if (includeRelationships && SocialQueries) {
            var rawRelationships =
                SocialQueries.getCharacterRelationships(characterId) || [];
            relationships = rawRelationships.map(function(rel) {
                return formatRelationship(rel, characterId);
            });
        }

        // ---- Eliminations ----
        var tournamentEliminations = [];
        var standaloneEliminations = [];
        var isEliminated = false;
        var eliminationWeek = null;
        var eliminationYear = null;
        var eliminationReason = 'Unknown';

        if (includeEliminations && EliminationQueries) {
            isEliminated = EliminationQueries.isCharacterEliminatedByWeek(
                characterId, weekNum
            );
            eliminationWeek = EliminationQueries.getEliminationWeek(
                characterId
            );
            eliminationYear =
                (typeof EliminationQueries.getEliminationYear === 'function')
                    ? EliminationQueries.getEliminationYear(characterId)
                    : null;
            eliminationReason =
                EliminationQueries.getEliminationReason(characterId) ||
                'Unknown';

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
        if (includeSchedule &&
            CalendarQueries &&
            CalendarQueries.getStudentSchedule) {
            var schedule = CalendarQueries.getStudentSchedule(
                characterId, weekNum
            );
            if (schedule) {
                var count = 0;
                for (var day in schedule) {
                    if (!Object.prototype.hasOwnProperty.call(schedule, day)) {
                        continue;
                    }
                    var daySchedule = schedule[day];
                    if (daySchedule && typeof daySchedule === 'object') {
                        for (var hour in daySchedule) {
                            if (Object.prototype.hasOwnProperty.call(
                                daySchedule, hour
                            ) && daySchedule[hour]) {
                                count++;
                            }
                        }
                    }
                }
                scheduleCount = count;
            }
        }

        // ---- Career status ----
        var careerStatus = char.careerStatus || [];
        var careerHistory = careerStatus.map(function(statusItem) {
            return {
                status: statusItem.status || 'Unknown',
                startYear: statusItem.startYear || '',
                endYear: statusItem.endYear || '',
                period: formatPeriod(
                    statusItem.startYear, statusItem.endYear
                )
            };
        });

        // ---- Special moves ----
        var specialMoves = { physical: [], magical: [] };
        if (char.specialMoves) {
            if (Array.isArray(char.specialMoves.physical)) {
                specialMoves.physical = char.specialMoves.physical.map(
                    function(m) {
                        return {
                            name: m.name || 'Unnamed Move',
                            description: m.description || ''
                        };
                    }
                );
            }
            if (Array.isArray(char.specialMoves.magical)) {
                specialMoves.magical = char.specialMoves.magical.map(
                    function(m) {
                        return {
                            name: m.name || 'Unnamed Move',
                            description: m.description || ''
                        };
                    }
                );
            }
        }

        // ---- Personality ----
        var personality = char.personality || {};

        // ---- Classes (actual class objects) ----
        var classes = academyGetCharacterClasses(char);

        // ---- Result ----
        return {
            character: char,
            id: char.id,
            name: displayName,
            fullName: fullName,
            age: age,
            status: status,
            isStudent: isStudent,
            isInstructor: isInstructor,
            isCivilian: isCivilian,

            deceased: deceasedNow,
            deathYear: deathYear,
            deathCause: deathCause,
            deathAge: deathAge,
            deathWeek: deathWeek,

            stats: statsWithModifiers,
            magic: magic,

            classes: classes,
            classNames: classNames,

            academicTeams: academicTeams,
            professionalTeams: professionalTeams,
            temporaryTeams: temporaryTeams,
            civilianTeams: civilianTeams,

            grades: grades,
            missions: missions,
            relationships: relationships,

            isEliminated: isEliminated,
            eliminationWeek: eliminationWeek,
            eliminationYear: eliminationYear,
            eliminationReason: eliminationReason,
            tournamentEliminations: tournamentEliminations,
            standaloneEliminations: standaloneEliminations,

            scheduleCount: scheduleCount,

            careerStatus: char.careerStatus || [],
            careerHistory: careerHistory,
            specialty: char.specialty || '',

            personality: personality,
            specialMoves: specialMoves,
            notes: char.notes || '',

            week: weekNum
        };
    }

    // ============================================================
    // LIST VIEW MODEL
    // ============================================================

    function getCharacterListViewModel(options) {
        var CharacterQueries = getCharacterQueries();
        var AcademyClasses = getAcademyClasses();
        var EliminationQueries = getEliminationQueries();

        if (!CharacterQueries) {
            console.warn(
                '[CharacterAggregator] CharacterQueries unavailable ' +
                'for getCharacterListViewModel'
            );
            return [];
        }

        options = options || {};
        var weekNum = options.week || getCurrentWeek();
        var classFilter = options.classFilter || 'all';
        var nameFilter = options.nameFilter || '';
        var hideDeceased = options.hideDeceased !== false;
        var hideEliminated = options.hideEliminated !== false;
        var hideFiller = options.hideFiller !== false;
        var sortMode = VALID_SORTS[options.sort]
            ? options.sort
            : DEFAULT_SORT;

        var statusFilter = null;
        if (Array.isArray(options.statusFilter) &&
            options.statusFilter.length > 0) {
            statusFilter = options.statusFilter.map(function(s) {
                return String(s).toLowerCase().trim();
            }).filter(function(s) { return s !== ''; });
            if (statusFilter.length === 0) { statusFilter = null; }
        }

        var characters = CharacterQueries.getCharacters() || [];

        // ---- Class membership + class map ----
        var classMembership = {};
        var classMap = {};

        if (AcademyClasses) {
            var allClasses = AcademyClasses.getClasses() || [];
            allClasses.forEach(function(cls) {
                if (cls && cls.id) {
                    classMap[cls.id] = cls.name;
                }
            });

            characters.forEach(function(char) {
                if (!char || !char.id) { return; }
                classMembership[char.id] = char.classIds || [];
            });
        }

        // The __no_class__ filter needs the class map. If AcademyClasses
        // is unavailable, this filter cannot produce correct results.
        if (classFilter === NO_CLASS_FILTER && !AcademyClasses) {
            throw new Error(
                '[CharacterAggregator] __no_class__ filter requires ' +
                'AcademyClasses to resolve live class IDs.'
            );
        }

        // ---- Pre-compute filter year and ages ----
        var filterYear = resolveFilterYear(options);
        var agesById = Object.create(null);

        characters.forEach(function(char) {
            if (!char || !char.id) { return; }
            agesById[char.id] = CharacterQueries.calculateAge(
                char, filterYear
            );
        });

        // ---- Pre-compute elimination status ----
        var eliminationStatus = {};
        if (EliminationQueries) {
            characters.forEach(function(char) {
                if (!char || !char.id) { return; }

                var eliminated = false;
                if (typeof EliminationQueries.isCharacterEliminatedByYear ===
                    'function') {
                    eliminated = EliminationQueries
                        .isCharacterEliminatedByYear(char.id, filterYear);
                }

                eliminationStatus[char.id] = {
                    eliminated: eliminated,
                    year: (typeof EliminationQueries.getEliminationYear ===
                        'function')
                        ? EliminationQueries.getEliminationYear(char.id)
                        : null,
                    week: (typeof EliminationQueries.getEliminationWeek ===
                        'function')
                        ? EliminationQueries.getEliminationWeek(char.id)
                        : null,
                    reason: (typeof EliminationQueries
                        .getEliminationReason === 'function')
                        ? EliminationQueries.getEliminationReason(char.id)
                        : 'Unknown'
                };
            });
        }

        // ---- Pre-compute deceased status ----
        var deceasedStatus = {};
        characters.forEach(function(char) {
            if (!char || !char.id) { return; }
            deceasedStatus[char.id] = isDeceased(char, filterYear);
        });

        // ---- Pre-compute current professional teams ----
        var teamStatus = {};
        characters.forEach(function(char) {
            if (!char || !char.id) { return; }
            teamStatus[char.id] = getCurrentProfessionalTeamsForList(
                char.id, filterYear
            );
        });

        // ---- Filter ----
        var filtered = characters.filter(function(char) {
            if (!char || typeof char !== 'object') { return false; }

            if (hideFiller && char.isFiller === true) {
                return false;
            }

            if (nameFilter) {
                var displayName = CharacterQueries
                    .getDisplayName(char)
                    .toLowerCase();
                if (displayName.indexOf(nameFilter.toLowerCase()) === -1) {
                    return false;
                }
            }

            if (classFilter === NO_CLASS_FILTER) {
                var charClasses = classMembership[char.id] || [];
                if (charClasses.length === 0) {
                    // Empty: matches.
                } else {
                    var hasReal = false;
                    for (var n = 0; n < charClasses.length; n++) {
                        if (classMap[charClasses[n]]) {
                            hasReal = true;
                            break;
                        }
                    }
                    if (hasReal) { return false; }
                }
            } else if (classFilter !== 'all' && classFilter !== '') {
                var charClasses2 = classMembership[char.id] || [];
                var found = false;
                for (var i = 0; i < charClasses2.length; i++) {
                    if (String(charClasses2[i]) === String(classFilter)) {
                        found = true;
                        break;
                    }
                }
                if (!found) { return false; }
            }

            if (statusFilter !== null) {
                var charStatus = '';
                if (typeof CharacterQueries.getCurrentStatus === 'function') {
                    charStatus = CharacterQueries.getCurrentStatus(char) || '';
                }

                var baseStatus = String(charStatus).toLowerCase();
                var formerIdx = baseStatus.indexOf(' (former)');
                if (formerIdx !== -1) {
                    baseStatus = baseStatus.substring(0, formerIdx).trim();
                } else {
                    baseStatus = baseStatus.trim();
                }

                if (statusFilter.indexOf(baseStatus) === -1) {
                    return false;
                }
            }

            if (hideDeceased && deceasedStatus[char.id]) {
                return false;
            }

            if (hideEliminated &&
                eliminationStatus[char.id] &&
                eliminationStatus[char.id].eliminated) {
                return false;
            }

            return true;
        });

        // ---- Sort ----
        filtered.sort(makeComparator(sortMode, agesById, CharacterQueries));

        // ---- Build result ----
        return filtered.map(function(char) {
            var charClasses = classMembership[char.id] || [];
            var classNames = charClasses.map(function(id) {
                return classMap[id] || 'Unknown';
            }).filter(function(name) {
                return name && name !== 'Unknown';
            });

            var elimStatus = eliminationStatus[char.id] || {
                eliminated: false,
                year: null,
                week: null,
                reason: 'Unknown'
            };

            var teams = teamStatus[char.id] || [];
            var teamNames = teams.map(function(t) { return t.name; });
            var teamIds = teams.map(function(t) { return t.id; });

            var ageValue = agesById[char.id];
            if (ageValue === undefined) { ageValue = null; }
            var ageDisplay = (ageValue === null || ageValue === undefined)
                ? ''
                : String(ageValue);

            return {
                id: char.id,
                name: CharacterQueries.getDisplayName(char),
                status: CharacterQueries.getCurrentStatus(char),
                age: ageValue,
                ageDisplay: ageDisplay,
                deceased: deceasedStatus[char.id] === true,
                eliminated: elimStatus.eliminated,
                eliminationYear: elimStatus.year,
                eliminationWeek: elimStatus.week,
                eliminationReason: elimStatus.reason,

                classNames: classNames,
                classIds: charClasses,

                teamNames: teamNames,
                teamIds: teamIds,
                teamObjects: teams
            };
        });
    }

    // ============================================================
    // LIST SORT
    // ============================================================

    function makeComparator(sortMode, agesById, CharacterQueries) {
        return function(a, b) {
            var nameA = CharacterQueries.getDisplayName(a);
            var nameB = CharacterQueries.getDisplayName(b);

            if (sortMode === 'name-desc') {
                return nameB.localeCompare(nameA);
            }

            if (sortMode === 'age-asc' || sortMode === 'age-desc') {
                var ageA = agesById[a.id];
                var ageB = agesById[b.id];

                if (ageA === undefined) { ageA = null; }
                if (ageB === undefined) { ageB = null; }

                if (ageA === null && ageB === null) {
                    return nameA.localeCompare(nameB);
                }
                if (ageA === null) { return 1; }
                if (ageB === null) { return -1; }
                if (ageA !== ageB) {
                    return sortMode === 'age-asc'
                        ? ageA - ageB
                        : ageB - ageA;
                }
            }

            return nameA.localeCompare(nameB);
        };
    }

    // ============================================================
    // ACADEMIC DATA PROJECTION
    // ============================================================

    function getCharacterAcademicData(characterId, week) {
        if (!characterId) { return null; }

        var CharacterQueries = getCharacterQueries();
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
                    allTeams.filter(function(t) {
                        return t.type === 'academic';
                    }),
                    characterId,
                    'Wk '
                );
            }
        }

        var grades = [];
        var rawGrades = academyGetStudentGrades(characterId);
        grades = rawGrades.map(formatGrade);
        grades.sort(function(a, b) {
            return parseInt(a.week, 10) - parseInt(b.week, 10);
        });

        var classNames = academyGetCharacterClassNames(char);

        var isEliminated = false;
        var eliminationWeek = null;
        var eliminationYear = null;
        var eliminationReason = 'Unknown';
        var tournamentEliminations = [];

        if (EliminationQueries) {
            isEliminated = EliminationQueries.isCharacterEliminatedByWeek(
                characterId, weekNum
            );
            eliminationWeek = EliminationQueries.getEliminationWeek(
                characterId
            );
            eliminationYear =
                (typeof EliminationQueries.getEliminationYear === 'function')
                    ? EliminationQueries.getEliminationYear(characterId)
                    : null;
            eliminationReason =
                EliminationQueries.getEliminationReason(characterId) ||
                'Unknown';

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
            eliminationYear: eliminationYear,
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
                    allTeams.filter(function(t) {
                        return t.type === 'professional';
                    }),
                    characterId
                );
                temporaryTeams = formatTeams(
                    allTeams.filter(function(t) {
                        return t.type === 'temporary';
                    }),
                    characterId
                );
                civilianTeams = formatTeams(
                    allTeams.filter(function(t) {
                        return t.type === 'civilian';
                    }),
                    characterId
                );
            }
        }

        var missions = [];
        if (MissionQueries) {
            var rawMissions =
                MissionQueries.getMissionsForCharacter(characterId) || [];
            missions = rawMissions.map(formatMission);
        }

        var careerStatus = char.careerStatus || [];
        var careerHistory = careerStatus.map(function(statusItem) {
            return {
                status: statusItem.status || 'Unknown',
                startYear: statusItem.startYear || '',
                endYear: statusItem.endYear || '',
                period: formatPeriod(
                    statusItem.startYear, statusItem.endYear
                )
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
            var rawRelationships =
                SocialQueries.getCharacterRelationships(characterId) || [];
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
    // STAT ACCESSORS
    // ============================================================

    function getStatKeys() {
        var CC = getCharacterConstants();
        if (CC && Array.isArray(CC.STAT_KEYS)) {
            return CC.STAT_KEYS;
        }
        return ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    }

    function getStatDefault() {
        var CC = getCharacterConstants();
        if (CC && typeof CC.STAT_DEFAULT === 'number') {
            return CC.STAT_DEFAULT;
        }
        return 10;
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
            console.warn(
                '[CharacterAggregator] Verification — some exports ' +
                'may be missing:', missing.join(', ')
            );
        }
    })();

})();
