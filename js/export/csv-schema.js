/**
 * js/export/csv-schema.js - CSV Schema Definitions
 * Defines what gets exported/imported and how
 * Path: js/export/csv-schema.js
 */

(function() {
    'use strict';

    var CSV_SCHEMA = {
        characters: {
            header: ['CharacterId', 'FirstName', 'MiddleName', 'LastName', 'BirthYear', 'Gender', 'AssociatedNames',
                     'EyeColor', 'HairColor', 'SkinColor', 'Height', 'Weight', 'Build', 'AppearanceNotes',
                     'Notes', 'Deceased', 'DeathYear', 'DeathCause', 'DeathAge', 'Specialty',
                     'CareerStatus', 'EliminatedWeeks'],
            sectionMarker: '# CHARACTERS',
            export: function(char) {
                return [
                    char.id || '',
                    char.firstName || '',
                    char.middleName || '',
                    char.lastName || '',
                    char.birthYear || '',
                    char.gender || '',
                    char.associatedNames || '',
                    char.eyes || '',
                    char.hair || '',
                    char.skin || '',
                    char.height || '',
                    char.weight || '',
                    char.build || '',
                    char.appearanceNotes || '',
                    char.notes || '',
                    char.deceased ? 'true' : 'false',
                    char.deathYear || '',
                    char.deathCause || '',
                    char.deathAge || '',
                    char.specialty || '',
                    JSON.stringify(char.careerStatus || []),
                    JSON.stringify(char.eliminatedWeeks || [])
                ];
            },
            import: function(row) {
                var id = row[0] || generateImportId('char');
                var careerStatus = safeJSONParse(row[20], []);
                var eliminatedWeeks = safeJSONParse(row[21], []);
                return {
                    id: id,
                    firstName: row[1] || '',
                    middleName: row[2] || '',
                    lastName: row[3] || '',
                    birthYear: row[4] || '',
                    gender: row[5] || '',
                    associatedNames: row[6] || '',
                    eyes: row[7] || '',
                    hair: row[8] || '',
                    skin: row[9] || '',
                    height: row[10] || '',
                    weight: row[11] || '',
                    build: row[12] || '',
                    appearanceNotes: row[13] || '',
                    notes: row[14] || '',
                    deceased: row[15] === 'true',
                    deathYear: row[16] || '',
                    deathCause: row[17] || '',
                    deathAge: row[18] || '',
                    specialty: row[19] || '',
                    careerStatus: careerStatus,
                    eliminatedWeeks: eliminatedWeeks,
                    // These will be filled by normalisation
                    eliminations: [],
                    stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
                    magic: {},
                    personality: {},
                    specialMoves: { physical: [], magical: [] },
                    previousNames: [],
                    nameFormat: 'firstlast',
                    classIds: [],
                    createdAt: new Date().toISOString()
                };
            }
        },
        teams: {
            header: ['TeamId', 'TeamName', 'TeamType', 'StartPeriod', 'EndPeriod', 'CurrentRank', 'Status',
                     'NameHistory', 'TemporaryMission', 'TeamNumber', 'ClassId'],
            sectionMarker: '# TEAMS',
            export: function(team) {
                return [
                    team.id || '',
                    team.name || '',
                    team.type || 'academic',
                    team.startPeriod || '',
                    team.endPeriod || '',
                    team.currentRank || '',
                    team.status || 'active',
                    JSON.stringify(team.nameHistory || []),
                    team.temporaryMission || '',
                    team.teamNumber || '',
                    team.classId || ''
                ];
            },
            import: function(row) {
                var id = row[0] || generateImportId('team');
                var nameHistory = safeJSONParse(row[7], []);
                return {
                    id: id,
                    name: row[1] || '',
                    type: row[2] || 'academic',
                    startPeriod: row[3] || '',
                    endPeriod: row[4] || '',
                    currentRank: row[5] || '',
                    status: row[6] || 'active',
                    nameHistory: nameHistory,
                    temporaryMission: row[8] || null,
                    teamNumber: row[9] || '',
                    classId: row[10] || null,
                    members: [],
                    rankingHistory: [],
                    createdAt: new Date().toISOString()
                };
            }
        },
        teamMembers: {
            header: ['TeamId', 'CharacterId', 'Role', 'JoinPeriod', 'LeavePeriod', 'Status'],
            sectionMarker: '# TEAM MEMBERS',
            export: function(team) {
                var rows = [];
                if (!Array.isArray(team.members)) return rows;
                team.members.forEach(function(m) {
                    var status = 'active';
                    var char = window.getCharacterById ? window.getCharacterById(m.characterId) : null;
                    if (char && char.deceased) status = 'deceased';
                    else if (char && Array.isArray(char.eliminatedWeeks) && char.eliminatedWeeks.length > 0) status = 'eliminated';
                    else if (m.leavePeriod) status = 'left';
                    rows.push([
                        team.id || '',
                        m.characterId || '',
                        m.role || '',
                        m.joinPeriod || '',
                        m.leavePeriod || '',
                        status
                    ]);
                });
                return rows;
            },
            import: function(row, context) {
                // context: { teamMap, charMap }
                var teamId = row[0];
                var charId = row[1];
                var team = context.teamMap[teamId];
                if (team && context.charMap[charId]) {
                    team.members.push({
                        characterId: charId,
                        role: row[2] || 'Member',
                        joinPeriod: row[3] || '',
                        leavePeriod: row[4] || ''
                    });
                }
                return null; // Returns nothing, mutates team
            }
        },
        teamRankings: {
            header: ['TeamId', 'Period', 'Rank'],
            sectionMarker: '# TEAM RANKINGS',
            export: function(team) {
                var rows = [];
                if (!Array.isArray(team.rankingHistory)) return rows;
                team.rankingHistory.forEach(function(r) {
                    rows.push([
                        team.id || '',
                        r.period || '',
                        r.rank || ''
                    ]);
                });
                return rows;
            },
            import: function(row, context) {
                var teamId = row[0];
                var team = context.teamMap[teamId];
                if (team) {
                    if (!Array.isArray(team.rankingHistory)) team.rankingHistory = [];
                    team.rankingHistory.push({
                        period: row[1] || '',
                        rank: row[2] || ''
                    });
                }
                return null;
            }
        },
        tournaments: {
            header: ['TournamentId', 'TournamentName', 'Mode', 'StartWeek', 'EndWeek', 'TotalRounds',
                     'AcademicYear', 'Status', 'WinnerType', 'WinnerId'],
            sectionMarker: '# TOURNAMENTS',
            export: function(tourn) {
                var winnerType = '';
                var winnerId = '';
                if (tourn.winner) {
                    var winnerTeam = window.getTeamById ? window.getTeamById(tourn.winner) : null;
                    var winnerChar = window.getCharacterById ? window.getCharacterById(tourn.winner) : null;
                    if (winnerTeam) {
                        winnerType = 'team';
                        winnerId = tourn.winner;
                    } else if (winnerChar) {
                        winnerType = 'character';
                        winnerId = tourn.winner;
                    }
                }
                return [
                    tourn.id || '',
                    tourn.name || '',
                    tourn.mode || 'teams',
                    tourn.startWeek || '',
                    tourn.endWeek || '',
                    tourn.totalRounds || 1,
                    tourn.academicYear || '',
                    tourn.status || 'draft',
                    winnerType,
                    winnerId
                ];
            },
            import: function(row, context) {
                var id = row[0] || generateImportId('tourn');
                var tourn = {
                    id: id,
                    name: row[1] || '',
                    mode: row[2] || 'teams',
                    startWeek: parseInt(row[3]) || 1,
                    endWeek: parseInt(row[4]) || 52,
                    totalRounds: parseInt(row[5]) || 1,
                    academicYear: row[6] || '',
                    status: row[7] || 'draft',
                    winner: null,
                    teams: [],
                    matches: [],
                    eliminations: [],
                    participants: [],
                    rounds: [],
                    winners: [],
                    currentRound: 0,
                    createdAt: new Date().toISOString()
                };
                if (row[8] && row[9]) {
                    var winnerType = row[8];
                    var winnerId = row[9];
                    if (winnerType === 'team' && context.teamMap[winnerId]) {
                        tourn.winner = winnerId;
                    } else if (winnerType === 'character' && context.charMap[winnerId]) {
                        tourn.winner = winnerId;
                    }
                }
                return tourn;
            }
        },
        tournamentTeams: {
            header: ['TournamentId', 'TeamId'],
            sectionMarker: '# TOURNAMENT TEAMS',
            export: function(tourn) {
                var rows = [];
                if (!Array.isArray(tourn.teams)) return rows;
                tourn.teams.forEach(function(entry) {
                    rows.push([
                        tourn.id || '',
                        entry.teamId || ''
                    ]);
                });
                return rows;
            },
            import: function(row, context) {
                var tournId = row[0];
                var teamId = row[1];
                var tourn = context.tournMap[tournId];
                if (tourn && context.teamMap[teamId]) {
                    tourn.teams.push({ teamId: teamId });
                }
                return null;
            }
        },
        tournamentMatches: {
            header: ['TournamentId', 'Team1Id', 'Team2Id', 'WinnerId'],
            sectionMarker: '# TOURNAMENT MATCHES',
            export: function(tourn) {
                var rows = [];
                if (!Array.isArray(tourn.matches)) return rows;
                tourn.matches.forEach(function(m) {
                    rows.push([
                        tourn.id || '',
                        m.team1Id || '',
                        m.team2Id || '',
                        m.winner || ''
                    ]);
                });
                return rows;
            },
            import: function(row, context) {
                var tournId = row[0];
                var tourn = context.tournMap[tournId];
                if (tourn) {
                    tourn.matches.push({
                        team1Id: row[1] || '',
                        team2Id: row[2] || '',
                        winner: row[3] || ''
                    });
                }
                return null;
            }
        },
        tournamentEliminations: {
            header: ['TournamentId', 'ParticipantId', 'ParticipantType', 'TeamId', 'Week'],
            sectionMarker: '# TOURNAMENT ELIMINATIONS',
            export: function(tourn) {
                var rows = [];
                if (!Array.isArray(tourn.eliminations)) return rows;
                tourn.eliminations.forEach(function(e) {
                    var participantType = e.participantType || 'character';
                    rows.push([
                        tourn.id || '',
                        e.participantId || '',
                        participantType,
                        e.teamId || '',
                        e.week || ''
                    ]);
                });
                return rows;
            },
            import: function(row, context) {
                var tournId = row[0];
                var tourn = context.tournMap[tournId];
                if (tourn) {
                    var participantId = row[1];
                    var participantType = row[2] || 'character';
                    var teamId = row[3] || '';
                    var week = parseInt(row[4]) || 1;
                    tourn.eliminations.push({
                        participantId: participantId,
                        participantType: participantType,
                        teamId: teamId,
                        week: week
                    });
                    if (participantType === 'character' && context.charMap[participantId]) {
                        var char = context.charMap[participantId];
                        if (!Array.isArray(char.eliminatedWeeks)) char.eliminatedWeeks = [];
                        if (char.eliminatedWeeks.indexOf(week) === -1) {
                            char.eliminatedWeeks.push(week);
                        }
                    }
                }
                return null;
            }
        },
        tournamentParticipants: {
            header: ['TournamentId', 'ParticipantId', 'ParticipantType'],
            sectionMarker: '# TOURNAMENT PARTICIPANTS',
            export: function(tourn) {
                var rows = [];
                if (!Array.isArray(tourn.participants)) return rows;
                tourn.participants.forEach(function(p) {
                    var type = p.type || 'character';
                    rows.push([
                        tourn.id || '',
                        p.id || '',
                        type
                    ]);
                });
                return rows;
            },
            import: function(row, context) {
                var tournId = row[0];
                var tourn = context.tournMap[tournId];
                if (tourn) {
                    tourn.participants.push({
                        id: row[1] || '',
                        type: row[2] || 'character'
                    });
                }
                return null;
            }
        },
        missions: {
            header: ['MissionId', 'Title', 'Status', 'Priority', 'Difficulty', 'TeamId', 'Location',
                     'Duration', 'Pay', 'Progress', 'Objectives'],
            sectionMarker: '# MISSIONS',
            export: function(mission) {
                return [
                    mission.id || '',
                    mission.title || '',
                    mission.status || 'active',
                    mission.priority || 'medium',
                    mission.difficulty || 'medium',
                    mission.assignedTeamId || '',
                    mission.location || '',
                    mission.duration || '',
                    mission.pay || '',
                    mission.progress || '0',
                    JSON.stringify(mission.objectives || [])
                ];
            },
            import: function(row, context) {
                var id = row[0] || generateImportId('miss');
                var objectives = safeJSONParse(row[10], []);
                var teamId = row[5] || null;
                if (teamId && !context.teamMap[teamId]) {
                    console.warn('Mission "' + (row[1] || '') + '" references unknown team: ' + teamId);
                }
                return {
                    id: id,
                    title: row[1] || '',
                    status: row[2] || 'active',
                    priority: row[3] || 'medium',
                    difficulty: row[4] || 'medium',
                    assignedTeamId: teamId,
                    location: row[6] || '',
                    duration: row[7] || '',
                    pay: row[8] || '',
                    progress: parseInt(row[9]) || 0,
                    objectives: objectives,
                    description: '',
                    notes: '',
                    tags: [],
                    log: [],
                    createdAt: new Date().toISOString(),
                    completedAt: null
                };
            }
        },
        disciplines: {
            header: ['DisciplineId', 'DisciplineName', 'Type', 'Instructors', 'StartWeek', 'EndWeek',
                     'WeeklyHours', 'MaxStudents', 'Weight'],
            sectionMarker: '# DISCIPLINES',
            export: function(discipline) {
                return [
                    discipline.id || '',
                    discipline.name || '',
                    discipline.type || 'mandatory',
                    JSON.stringify(discipline.instructorIds || []),
                    discipline.startWeek || '',
                    discipline.endWeek || '',
                    discipline.weeklyHours || '',
                    discipline.maxStudents || '',
                    discipline.weight || '1'
                ];
            },
            import: function(row) {
                var id = row[0] || generateImportId('disc');
                var instructorIds = safeJSONParse(row[3], []);
                return {
                    id: id,
                    name: row[1] || '',
                    type: row[2] || 'mandatory',
                    instructorIds: instructorIds,
                    startWeek: row[4] || '',
                    endWeek: row[5] || '',
                    weeklyHours: row[6] || '',
                    maxStudents: row[7] || '',
                    weight: parseFloat(row[8]) || 1,
                    curriculum: '',
                    gradingSystem: [],
                    createdAt: new Date().toISOString()
                };
            }
        }
    };

    // Helper: Safe JSON parse with fallback
    function safeJSONParse(str, fallback) {
        if (!str) return fallback;
        try {
            var parsed = JSON.parse(str);
            return parsed !== undefined && parsed !== null ? parsed : fallback;
        } catch (e) {
            return fallback;
        }
    }

    // Helper: Generate import ID
    function generateImportId(prefix) {
        if (typeof window.generateId === 'function') {
            return window.generateId(prefix);
        }
        return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    }

    // Expose
    window.CSVSchema = CSV_SCHEMA;
    window.safeJSONParse = safeJSONParse;

})();
