/**
 * js/export/csv-schema.js - CSV Schema Definitions
 * Defines what gets exported/imported and how
 * Path: js/export/csv-schema.js
 * 
 * IMPORTANT: Import order matters for referential integrity.
 * Dependencies must be imported before dependent records.
 * 
 * DEPENDENCY ORDER:
 *   Characters (charMap)
 *   Teams (teamMap) ─────┐
 *   Team Members          │
 *   Team Rankings         │
 *   Tournaments (tournMap)│
 *   Tournament Teams      │
 *   Tournament Matches    │
 *   Tournament Eliminations│
 *   Tournament Participants│
 *   Missions              │
 *   Disciplines           │
 *                         │
 *   └── All relationships ─┘
 * 
 * IMPORT PHILOSOPHY:
 *   - Missing optional reference → null it (missions)
 *   - Missing required reference → skip relationship (team members, tournament records)
 *   - Malformed primary entity → abort import with error
 *   - Invalid enum values → abort import with error
 *   - Blank rows → silently skipped
 *   - Warnings are capped at 50 to prevent UI explosion
 *   - JSON fields are type-validated (arrays must be arrays, etc.)
 *   - Numeric fields are strictly validated (no "12garbage" allowed)
 */

(function() {
    'use strict';

    // Use shared utilities
    var utils = window.ExportUtils;

    var CSV_SCHEMA = {
        // Format version marker - CANONICAL VERSION PARSING
        version: {
            sectionMarker: '# HOLLOW BLADES CSV',
            import: function(row) {
                return {
                    version: (row[2] || '1').trim()
                };
            },
            export: function() {
                return ['# HOLLOW BLADES CSV', 'FORMAT VERSION', '1'];
            },
            detect: function(records) {
                for (var i = 0; i < records.length; i++) {
                    var row = records[i];
                    if (row.length === 0) continue;
                    var first = (row[0] || '').trim();
                    if (first === '# HOLLOW BLADES CSV') {
                        return (row[2] || '1').trim();
                    }
                }
                return 'unknown';
            }
        },
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
            import: function(row, context) {
                var id = String(row[0] == null ? '' : row[0]).trim() || utils.generateImportId('char');
                var firstName = utils.requireField(row, 1, 'FirstName');
                var lastName = utils.requireField(row, 3, 'LastName');

                // Use typed JSON parsing - expects arrays
                var careerStatus = utils.parseJSONArray(row, 20, 'CareerStatus', [], context.addWarning);
                var eliminatedWeeks = utils.parseJSONArray(row, 21, 'EliminatedWeeks', [], context.addWarning);

                return {
                    id: id,
                    firstName: firstName,
                    middleName: String(row[2] == null ? '' : row[2]).trim(),
                    lastName: lastName,
                    birthYear: String(row[4] == null ? '' : row[4]).trim(),
                    gender: String(row[5] == null ? '' : row[5]).trim(),
                    associatedNames: String(row[6] == null ? '' : row[6]).trim(),
                    eyes: String(row[7] == null ? '' : row[7]).trim(),
                    hair: String(row[8] == null ? '' : row[8]).trim(),
                    skin: String(row[9] == null ? '' : row[9]).trim(),
                    height: String(row[10] == null ? '' : row[10]).trim(),
                    weight: String(row[11] == null ? '' : row[11]).trim(),
                    build: String(row[12] == null ? '' : row[12]).trim(),
                    appearanceNotes: String(row[13] == null ? '' : row[13]).trim(),
                    notes: String(row[14] == null ? '' : row[14]).trim(),
                    deceased: String(row[15] == null ? '' : row[15]).trim() === 'true',
                    deathYear: String(row[16] == null ? '' : row[16]).trim(),
                    deathCause: String(row[17] == null ? '' : row[17]).trim(),
                    deathAge: String(row[18] == null ? '' : row[18]).trim(),
                    specialty: String(row[19] == null ? '' : row[19]).trim(),
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
            },
            validateHeader: function(header) {
                var expected = this.header;
                if (header.length < expected.length) return false;
                for (var i = 0; i < expected.length; i++) {
                    if ((header[i] == null ? '' : header[i]).trim() !== expected[i]) {
                        return false;
                    }
                }
                return true;
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
            import: function(row, context) {
                var id = String(row[0] == null ? '' : row[0]).trim() || utils.generateImportId('team');
                var name = utils.requireField(row, 1, 'TeamName');

                var type = utils.requireEnum(row, 2, 'TeamType',
                    ['academic', 'professional', 'temporary', 'civilian'], 'academic');

                var nameHistory = utils.parseJSONArray(row, 7, 'NameHistory', [], context.addWarning);

                return {
                    id: id,
                    name: name,
                    type: type,
                    startPeriod: String(row[3] == null ? '' : row[3]).trim(),
                    endPeriod: String(row[4] == null ? '' : row[4]).trim(),
                    currentRank: String(row[5] == null ? '' : row[5]).trim(),
                    status: utils.requireEnum(row, 6, 'Status',
                        ['active', 'inactive', 'deprecated'], 'active'),
                    nameHistory: nameHistory,
                    temporaryMission: String(row[8] == null ? '' : row[8]).trim() || null,
                    teamNumber: String(row[9] == null ? '' : row[9]).trim(),
                    classId: String(row[10] == null ? '' : row[10]).trim() || null,
                    members: [],
                    rankingHistory: [],
                    createdAt: new Date().toISOString()
                };
            },
            validateHeader: function(header) {
                var expected = this.header;
                if (header.length < expected.length) return false;
                for (var i = 0; i < expected.length; i++) {
                    if ((header[i] == null ? '' : header[i]).trim() !== expected[i]) {
                        return false;
                    }
                }
                return true;
            }
        },
        teamMembers: {
            header: ['TeamId', 'CharacterId', 'Role', 'JoinPeriod', 'LeavePeriod', 'Status'],
            sectionMarker: '# TEAM MEMBERS',
            export: function(team) {
                var rows = [];
                if (!Array.isArray(team.members)) return rows;
                team.members.forEach(function(m) {
                    // Status is derived/presentation-only - not stored
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
                        status // Read-only - not imported
                    ]);
                });
                return rows;
            },
            import: function(row, context) {
                var teamId = utils.requireField(row, 0, 'TeamId');
                var charId = utils.requireField(row, 1, 'CharacterId');
                var team = context.teamMap[utils.normaliseId(teamId)];

                if (!team) {
                    context.addWarning('Team member references unknown team "' + teamId + '"');
                    return null;
                }

                if (!context.charMap[utils.normaliseId(charId)]) {
                    context.addWarning('Team member references unknown character "' + charId + '"');
                    return null;
                }

                // Check for duplicate membership
                var exists = team.members.some(function(m) {
                    return utils.normaliseId(m.characterId) === utils.normaliseId(charId);
                });

                if (exists) {
                    context.addWarning('Duplicate team member: "' + charId + '" already in team "' + teamId + '"');
                    return null;
                }

                team.members.push({
                    characterId: charId,
                    role: String(row[2] == null ? '' : row[2]).trim() || 'Member',
                    joinPeriod: String(row[3] == null ? '' : row[3]).trim(),
                    leavePeriod: String(row[4] == null ? '' : row[4]).trim()
                });
                return null;
            },
            validateHeader: function(header) {
                var expected = this.header;
                if (header.length < expected.length) return false;
                for (var i = 0; i < expected.length; i++) {
                    if ((header[i] == null ? '' : header[i]).trim() !== expected[i]) {
                        return false;
                    }
                }
                return true;
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
                var teamId = utils.requireField(row, 0, 'TeamId');
                var team = context.teamMap[utils.normaliseId(teamId)];
                if (!team) {
                    context.addWarning('Team ranking references unknown team "' + teamId + '"');
                    return null;
                }

                var period = utils.requireField(row, 1, 'Period');
                var rank = utils.requireField(row, 2, 'Rank');

                // Check for duplicate ranking entry
                var exists = team.rankingHistory.some(function(r) {
                    return r.period === period;
                });

                if (exists) {
                    context.addWarning('Duplicate ranking for team "' + teamId + '" period "' + period + '"');
                    return null;
                }

                if (!Array.isArray(team.rankingHistory)) team.rankingHistory = [];
                team.rankingHistory.push({
                    period: period,
                    rank: rank
                });
                return null;
            },
            validateHeader: function(header) {
                var expected = this.header;
                if (header.length < expected.length) return false;
                for (var i = 0; i < expected.length; i++) {
                    if ((header[i] == null ? '' : header[i]).trim() !== expected[i]) {
                        return false;
                    }
                }
                return true;
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
                var id = String(row[0] == null ? '' : row[0]).trim() || utils.generateImportId('tourn');
                var name = utils.requireField(row, 1, 'TournamentName');
                var mode = utils.requireEnum(row, 2, 'Mode', ['teams', 'individuals'], 'teams');

                var startWeek = utils.requireInteger(row, 3, 'StartWeek', 1);
                var endWeek = utils.requireInteger(row, 4, 'EndWeek', 52);
                var totalRounds = utils.requireInteger(row, 5, 'TotalRounds', 1);
                var status = utils.requireEnum(row, 7, 'Status', ['draft', 'active', 'completed'], 'draft');

                if (startWeek > endWeek) {
                    throw new Error('StartWeek (' + startWeek + ') cannot be greater than EndWeek (' + endWeek + ')');
                }

                var tourn = {
                    id: id,
                    name: name,
                    mode: mode,
                    startWeek: startWeek,
                    endWeek: endWeek,
                    totalRounds: totalRounds,
                    academicYear: String(row[6] == null ? '' : row[6]).trim(),
                    status: status,
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

                var winnerType = String(row[8] == null ? '' : row[8]).trim();
                var winnerId = String(row[9] == null ? '' : row[9]).trim();
                if (winnerId) {
                    if (winnerType === 'team' && context.teamMap[utils.normaliseId(winnerId)]) {
                        tourn.winner = winnerId;
                    } else if (winnerType === 'character' && context.charMap[utils.normaliseId(winnerId)]) {
                        tourn.winner = winnerId;
                    } else {
                        context.addWarning('Tournament "' + name + '" references unknown winner "' + winnerId + '"');
                    }
                }
                return tourn;
            },
            validateHeader: function(header) {
                var expected = this.header;
                if (header.length < expected.length) return false;
                for (var i = 0; i < expected.length; i++) {
                    if ((header[i] == null ? '' : header[i]).trim() !== expected[i]) {
                        return false;
                    }
                }
                return true;
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
                var tournId = utils.requireField(row, 0, 'TournamentId');
                var teamId = utils.requireField(row, 1, 'TeamId');
                var tourn = context.tournMap[utils.normaliseId(tournId)];

                if (!tourn) {
                    context.addWarning('Tournament team references unknown tournament "' + tournId + '"');
                    return null;
                }

                if (!context.teamMap[utils.normaliseId(teamId)]) {
                    context.addWarning('Tournament team references unknown team "' + teamId + '"');
                    return null;
                }

                // Check for duplicate
                var exists = tourn.teams.some(function(t) {
                    return utils.normaliseId(t.teamId) === utils.normaliseId(teamId);
                });

                if (exists) {
                    context.addWarning('Duplicate tournament team: "' + teamId + '" already in tournament "' + tournId + '"');
                    return null;
                }

                tourn.teams.push({ teamId: teamId });
                return null;
            },
            validateHeader: function(header) {
                var expected = this.header;
                if (header.length < expected.length) return false;
                for (var i = 0; i < expected.length; i++) {
                    if ((header[i] == null ? '' : header[i]).trim() !== expected[i]) {
                        return false;
                    }
                }
                return true;
            }
        },
        tournamentMatches: {
            header: ['TournamentId', 'WinnerType', 'Team1Id', 'Team2Id', 'WinnerId'],
            sectionMarker: '# TOURNAMENT MATCHES',
            export: function(tourn) {
                var rows = [];
                if (!Array.isArray(tourn.matches)) return rows;
                tourn.matches.forEach(function(m) {
                    var winnerType = '';
                    var winnerId = m.winner || '';
                    if (winnerId) {
                        var winnerTeam = window.getTeamById ? window.getTeamById(winnerId) : null;
                        var winnerChar = window.getCharacterById ? window.getCharacterById(winnerId) : null;
                        if (winnerTeam) {
                            winnerType = 'team';
                        } else if (winnerChar) {
                            winnerType = 'character';
                        }
                    }
                    rows.push([
                        tourn.id || '',
                        winnerType,
                        m.team1Id || '',
                        m.team2Id || '',
                        winnerId
                    ]);
                });
                return rows;
            },
            import: function(row, context) {
                var tournId = utils.requireField(row, 0, 'TournamentId');
                var tourn = context.tournMap[utils.normaliseId(tournId)];
                if (!tourn) {
                    context.addWarning('Tournament match references unknown tournament "' + tournId + '"');
                    return null;
                }

                var winnerType = String(row[1] == null ? '' : row[1]).trim();
                var team1Id = String(row[2] == null ? '' : row[2]).trim();
                var team2Id = String(row[3] == null ? '' : row[3]).trim();
                var winnerId = String(row[4] == null ? '' : row[4]).trim();
                var valid = true;

                // Validate team references
                if (team1Id && !context.teamMap[utils.normaliseId(team1Id)]) {
                    context.addWarning('Tournament match references unknown team "' + team1Id + '" - skipping match');
                    valid = false;
                }
                if (team2Id && !context.teamMap[utils.normaliseId(team2Id)]) {
                    context.addWarning('Tournament match references unknown team "' + team2Id + '" - skipping match');
                    valid = false;
                }

                // Validate winner with type and match participation
                if (winnerId) {
                    var winnerExists = false;
                    if (winnerType === 'team' && context.teamMap[utils.normaliseId(winnerId)]) {
                        winnerExists = true;
                        // Check if winner is one of the match participants
                        if (winnerId !== team1Id && winnerId !== team2Id) {
                            context.addWarning('Tournament match winner "' + winnerId + '" is not one of the match teams - skipping match');
                            valid = false;
                        }
                    } else if (winnerType === 'character' && context.charMap[utils.normaliseId(winnerId)]) {
                        winnerExists = true;
                        // For character winners, we can't easily validate against participants
                        // since matches are between teams - this depends on tournament model
                    }
                    if (!winnerExists) {
                        context.addWarning('Tournament match references unknown winner "' + winnerId + '" - skipping match');
                        valid = false;
                    }
                }

                if (!valid) {
                    return null;
                }

                tourn.matches.push({
                    team1Id: team1Id,
                    team2Id: team2Id,
                    winner: winnerId,
                    winnerType: winnerType
                });
                return null;
            },
            validateHeader: function(header) {
                var expected = this.header;
                if (header.length < expected.length) return false;
                for (var i = 0; i < expected.length; i++) {
                    if ((header[i] == null ? '' : header[i]).trim() !== expected[i]) {
                        return false;
                    }
                }
                return true;
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
                var tournId = utils.requireField(row, 0, 'TournamentId');
                var tourn = context.tournMap[utils.normaliseId(tournId)];
                if (!tourn) {
                    context.addWarning('Tournament elimination references unknown tournament "' + tournId + '"');
                    return null;
                }

                var participantId = String(row[1] == null ? '' : row[1]).trim();
                var participantType = utils.requireEnum(row, 2, 'ParticipantType', ['character', 'team'], 'character');
                var teamId = String(row[3] == null ? '' : row[3]).trim();
                var week = utils.requireInteger(row, 4, 'Week', 1);

                if (week < 1 || week > 52) {
                    context.addWarning('Invalid week "' + week + '" for elimination - must be 1-52, using 1');
                    week = 1;
                }

                var valid = true;

                // Validate references
                if (participantType === 'character' && participantId && !context.charMap[utils.normaliseId(participantId)]) {
                    context.addWarning('Tournament elimination references unknown character "' + participantId + '" - skipping elimination');
                    valid = false;
                }
                if (participantType === 'team' && participantId && !context.teamMap[utils.normaliseId(participantId)]) {
                    context.addWarning('Tournament elimination references unknown team "' + participantId + '" - skipping elimination');
                    valid = false;
                }
                if (teamId && !context.teamMap[utils.normaliseId(teamId)]) {
                    context.addWarning('Tournament elimination references unknown team "' + teamId + '" - skipping elimination');
                    valid = false;
                }

                if (!valid) {
                    return null;
                }

                // Check for duplicate elimination
                var exists = tourn.eliminations.some(function(e) {
                    return utils.normaliseId(e.participantId) === utils.normaliseId(participantId) &&
                           e.participantType === participantType;
                });

                if (exists) {
                    context.addWarning('Duplicate elimination for "' + participantId + '" in tournament "' + tournId + '"');
                    return null;
                }

                tourn.eliminations.push({
                    participantId: participantId,
                    participantType: participantType,
                    teamId: teamId,
                    week: week
                });

                if (participantType === 'character' && context.charMap[utils.normaliseId(participantId)]) {
                    var char = context.charMap[utils.normaliseId(participantId)];
                    if (!Array.isArray(char.eliminatedWeeks)) char.eliminatedWeeks = [];
                    if (char.eliminatedWeeks.indexOf(week) === -1) {
                        char.eliminatedWeeks.push(week);
                    }
                }
                return null;
            },
            validateHeader: function(header) {
                var expected = this.header;
                if (header.length < expected.length) return false;
                for (var i = 0; i < expected.length; i++) {
                    if ((header[i] == null ? '' : header[i]).trim() !== expected[i]) {
                        return false;
                    }
                }
                return true;
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
                var tournId = utils.requireField(row, 0, 'TournamentId');
                var tourn = context.tournMap[utils.normaliseId(tournId)];
                if (!tourn) {
                    context.addWarning('Tournament participant references unknown tournament "' + tournId + '"');
                    return null;
                }

                var participantId = String(row[1] == null ? '' : row[1]).trim();
                var participantType = utils.requireEnum(row, 2, 'ParticipantType', ['character', 'team'], 'character');

                // Validate reference
                var valid = true;
                if (participantType === 'character' && participantId && !context.charMap[utils.normaliseId(participantId)]) {
                    context.addWarning('Tournament participant references unknown character "' + participantId + '" - skipping participant');
                    valid = false;
                }
                if (participantType === 'team' && participantId && !context.teamMap[utils.normaliseId(participantId)]) {
                    context.addWarning('Tournament participant references unknown team "' + participantId + '" - skipping participant');
                    valid = false;
                }

                if (!valid) {
                    return null;
                }

                // Check for duplicate participant
                var exists = tourn.participants.some(function(p) {
                    return utils.normaliseId(p.id) === utils.normaliseId(participantId) &&
                           p.type === participantType;
                });

                if (exists) {
                    context.addWarning('Duplicate participant "' + participantId + '" in tournament "' + tournId + '"');
                    return null;
                }

                tourn.participants.push({
                    id: participantId,
                    type: participantType
                });
                return null;
            },
            validateHeader: function(header) {
                var expected = this.header;
                if (header.length < expected.length) return false;
                for (var i = 0; i < expected.length; i++) {
                    if ((header[i] == null ? '' : header[i]).trim() !== expected[i]) {
                        return false;
                    }
                }
                return true;
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
                var id = String(row[0] == null ? '' : row[0]).trim() || utils.generateImportId('miss');
                var title = utils.requireField(row, 1, 'Title');

                var status = utils.requireEnum(row, 2, 'Status',
                    ['active', 'completed', 'cancelled'], 'active');
                var priority = utils.requireEnum(row, 3, 'Priority',
                    ['low', 'medium', 'high', 'critical'], 'medium');
                var difficulty = utils.requireEnum(row, 4, 'Difficulty',
                    ['easy', 'medium', 'hard', 'expert'], 'medium');
                var progress = utils.requireInteger(row, 9, 'Progress', 0);

                // Validate progress range
                if (progress < 0) progress = 0;
                if (progress > 100) progress = 100;

                var teamId = String(row[5] == null ? '' : row[5]).trim() || null;

                // Use typed JSON parsing - expects array of objectives
                var objectives = utils.parseJSONArray(row, 10, 'Objectives', [], context.addWarning);

                // Validate team reference - null it if invalid
                if (teamId && !context.teamMap[utils.normaliseId(teamId)]) {
                    context.addWarning('Mission "' + title + '" references unknown team "' + teamId + '" - unassigning mission');
                    teamId = null;
                }

                return {
                    id: id,
                    title: title,
                    status: status,
                    priority: priority,
                    difficulty: difficulty,
                    assignedTeamId: teamId,
                    location: String(row[6] == null ? '' : row[6]).trim(),
                    duration: String(row[7] == null ? '' : row[7]).trim(),
                    pay: String(row[8] == null ? '' : row[8]).trim(),
                    progress: progress,
                    objectives: objectives,
                    description: '',
                    notes: '',
                    tags: [],
                    log: [],
                    createdAt: new Date().toISOString(),
                    completedAt: null
                };
            },
            validateHeader: function(header) {
                var expected = this.header;
                if (header.length < expected.length) return false;
                for (var i = 0; i < expected.length; i++) {
                    if ((header[i] == null ? '' : header[i]).trim() !== expected[i]) {
                        return false;
                    }
                }
                return true;
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
            import: function(row, context) {
                var id = String(row[0] == null ? '' : row[0]).trim() || utils.generateImportId('disc');
                var name = utils.requireField(row, 1, 'DisciplineName');
                var type = utils.requireEnum(row, 2, 'Type', ['mandatory', 'optional'], 'mandatory');

                // Use typed JSON parsing - expects array of instructor IDs
                var instructorIds = utils.parseJSONArray(row, 3, 'Instructors', [], context.addWarning);

                // Validate instructor references - filter out invalid ones
                if (Array.isArray(instructorIds)) {
                    var validInstructors = instructorIds.filter(function(instrId) {
                        var normalisedId = utils.normaliseId(instrId);
                        if (instrId && context.charMap && !context.charMap[normalisedId]) {
                            context.addWarning('Discipline "' + name + '" references unknown instructor "' + instrId + '" - removing');
                            return false;
                        }
                        return true;
                    });
                    instructorIds = validInstructors;
                }

                var startWeek = utils.requireInteger(row, 4, 'StartWeek', 1);
                var endWeek = utils.requireInteger(row, 5, 'EndWeek', 52);
                var weeklyHours = utils.requireNumber(row, 6, 'WeeklyHours', 1);
                var maxStudents = utils.requireInteger(row, 7, 'MaxStudents', 0);
                var weight = utils.requireNumber(row, 8, 'Weight', 1);

                if (startWeek > endWeek) {
                    throw new Error('StartWeek (' + startWeek + ') cannot be greater than EndWeek (' + endWeek + ')');
                }

                return {
                    id: id,
                    name: name,
                    type: type,
                    instructorIds: instructorIds,
                    startWeek: startWeek,
                    endWeek: endWeek,
                    weeklyHours: weeklyHours,
                    maxStudents: maxStudents,
                    weight: weight,
                    curriculum: '',
                    gradingSystem: [],
                    createdAt: new Date().toISOString()
                };
            },
            validateHeader: function(header) {
                var expected = this.header;
                if (header.length < expected.length) return false;
                for (var i = 0; i < expected.length; i++) {
                    if ((header[i] == null ? '' : header[i]).trim() !== expected[i]) {
                        return false;
                    }
                }
                return true;
            }
        }
    };

    // Expose
    window.CSVSchema = CSV_SCHEMA;

})();
