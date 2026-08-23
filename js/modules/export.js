/**
 * js/export.js - CSV/JSON Import/Export
 * Handles data import and export in various formats
 * Path: js/export.js
 */

(function() {
    'use strict';

    function csvField(value) {
        if (value === null || value === undefined) return '';
        var str = String(value);
        if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }

    function parseCSVLine(line) {
        var values = [];
        var current = '';
        var inQuotes = false;

        for (var i = 0; i < line.length; i++) {
            var ch = line[i];
            if (inQuotes) {
                if (ch === '"' && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else if (ch === '"') {
                    inQuotes = false;
                } else {
                    current += ch;
                }
            } else {
                if (ch === '"') {
                    inQuotes = true;
                } else if (ch === ',') {
                    values.push(current.trim());
                    current = '';
                } else if (ch === '\n' || ch === '\r') {
                    // skip
                } else {
                    current += ch;
                }
            }
        }
        values.push(current.trim());
        return values;
    }

    function exportCSV() {
        var data = window.data || {};
        var lines = [];

        // Characters
        lines.push('# CHARACTERS');
        lines.push('FirstName,MiddleName,LastName,BirthYear,Gender,AssociatedNames,EyeColor,HairColor,SkinColor,Height,Build,AppearanceNotes,Notes,Deceased,DeathYear,DeathCause,DeathAge,Specialty,CareerStatus,EliminatedWeeks');

        data.characters.forEach(function(c) {
            var careerStr = '';
            if (c.careerStatus) {
                careerStr = c.careerStatus.map(function(s) {
                    return s.status + ':' + s.startYear + '-' + (s.endYear || 'present');
                }).join(';');
            }
            var elimWeeks = (c.eliminatedWeeks || []).join(';');
            lines.push([
                csvField(c.firstName || ''),
                csvField(c.middleName || ''),
                csvField(c.lastName || ''),
                c.birthYear || '',
                csvField(c.gender || ''),
                csvField(c.associatedNames || ''),
                csvField(c.eyes || ''),
                csvField(c.hair || ''),
                csvField(c.skin || ''),
                csvField(c.height || ''),
                csvField(c.build || ''),
                csvField(c.appearanceNotes || ''),
                csvField(c.notes || ''),
                c.deceased ? 'true' : 'false',
                c.deathYear || '',
                csvField(c.deathCause || ''),
                c.deathAge || '',
                csvField(c.specialty || ''),
                csvField(careerStr),
                csvField(elimWeeks)
            ].join(','));
        });

        // Teams
        lines.push('\n# TEAMS');
        lines.push('TeamName,TeamType,StartPeriod,EndPeriod,CurrentRank,Status,NameHistory,TemporaryMission');
        data.teams.forEach(function(t) {
            var nameHistoryStr = '';
            if (t.nameHistory) {
                nameHistoryStr = t.nameHistory.map(function(n) {
                    return n.name + ':' + n.startPeriod + '-' + (n.endPeriod || 'present');
                }).join(';');
            }
            lines.push([
                csvField(t.name),
                csvField(t.type),
                t.startPeriod || '',
                t.endPeriod || '',
                t.currentRank || '',
                csvField(t.status || 'active'),
                csvField(nameHistoryStr),
                csvField(t.temporaryMission || '')
            ].join(','));
        });

        // Team Members
        lines.push('\n# TEAM MEMBERS');
        lines.push('TeamName,CharacterName,Role,JoinPeriod,LeavePeriod,Status');
        data.teams.forEach(function(t) {
            if (t.members) {
                t.members.forEach(function(m) {
                    var char = window.getCharacterById(m.characterId);
                    var name = char ? window.getDisplayName(char) : 'Unknown';
                    var status = 'active';
                    if (char && char.deceased) status = 'deceased';
                    else if (char && char.eliminatedWeeks && char.eliminatedWeeks.length > 0) status = 'eliminated';
                    else if (m.leavePeriod) status = 'left';
                    lines.push([
                        csvField(t.name),
                        csvField(name),
                        csvField(m.role || ''),
                        m.joinPeriod || '',
                        m.leavePeriod || '',
                        csvField(status)
                    ].join(','));
                });
            }
        });

        // Team Rankings
        lines.push('\n# TEAM RANKINGS');
        lines.push('TeamName,Period,Rank');
        data.teams.forEach(function(t) {
            if (t.rankingHistory) {
                t.rankingHistory.forEach(function(r) {
                    lines.push([
                        csvField(t.name),
                        r.period || '',
                        r.rank || ''
                    ].join(','));
                });
            }
        });

        // Tournaments
        lines.push('\n# TOURNAMENTS');
        lines.push('TournamentName,StartWeek,EndWeek,AcademicYear,Status,Winner');
        data.tournaments.forEach(function(t) {
            var winnerName = '';
            if (t.winner) {
                var winnerTeam = window.getTeamById(t.winner);
                if (winnerTeam) winnerName = winnerTeam.name;
                var winnerChar = window.getCharacterById(t.winner);
                if (winnerChar) winnerName = window.getDisplayName(winnerChar);
            }
            lines.push([
                csvField(t.name),
                t.startWeek || '',
                t.endWeek || '',
                csvField(t.academicYear || ''),
                csvField(t.status || 'active'),
                csvField(winnerName)
            ].join(','));
        });

        // Tournament Teams
        lines.push('\n# TOURNAMENT TEAMS');
        lines.push('TournamentName,TeamName');
        data.tournaments.forEach(function(t) {
            if (t.teams) {
                t.teams.forEach(function(entry) {
                    var team = window.getTeamById(entry.teamId);
                    lines.push([
                        csvField(t.name),
                        csvField(team ? team.name : '')
                    ].join(','));
                });
            }
        });

        // Tournament Matches
        lines.push('\n# TOURNAMENT MATCHES');
        lines.push('TournamentName,Team1,Team2,Winner');
        data.tournaments.forEach(function(t) {
            if (t.matches) {
                t.matches.forEach(function(m) {
                    var team1 = window.getTeamById(m.team1Id);
                    var team2 = window.getTeamById(m.team2Id);
                    var winner = m.winner ? window.getTeamById(m.winner) : null;
                    lines.push([
                        csvField(t.name),
                        csvField(team1 ? team1.name : ''),
                        csvField(team2 ? team2.name : ''),
                        csvField(winner ? winner.name : '')
                    ].join(','));
                });
            }
        });

        // Tournament Eliminations
        lines.push('\n# TOURNAMENT ELIMINATIONS');
        lines.push('TournamentName,CharacterName,TeamName,Week');
        data.tournaments.forEach(function(t) {
            if (t.eliminations) {
                t.eliminations.forEach(function(e) {
                    var char = window.getCharacterById(e.characterId);
                    var charName = char ? window.getDisplayName(char) : 'Unknown';
                    var team = e.teamId ? window.getTeamById(e.teamId) : null;
                    lines.push([
                        csvField(t.name),
                        csvField(charName),
                        csvField(team ? team.name : ''),
                        e.week || ''
                    ].join(','));
                });
            }
        });

        // Missions
        lines.push('\n# MISSIONS');
        lines.push('Title,Status,Priority,Difficulty,Team,Location,Duration,Pay,Progress,Objectives');
        if (data.missions) {
            data.missions.forEach(function(m) {
                var teamName = m.assignedTeamId ? window.getTeamName(m.assignedTeamId) : '';
                var objectivesStr = '';
                if (m.objectives) {
                    objectivesStr = m.objectives.map(function(o) {
                        return o.text + (o.done ? '\u2713' : '');
                    }).join(';');
                }
                lines.push([
                    csvField(m.title || ''),
                    csvField(m.status || 'active'),
                    csvField(m.priority || 'medium'),
                    csvField(m.difficulty || 'medium'),
                    csvField(teamName),
                    csvField(m.location || ''),
                    csvField(m.duration || ''),
                    csvField(m.pay || ''),
                    m.progress || '0',
                    csvField(objectivesStr)
                ].join(','));
            });
        }

        // Curriculum - Disciplines
        lines.push('\n# DISCIPLINES');
        lines.push('DisciplineName,Type,Instructors,StartWeek,EndWeek,WeeklyHours,MaxStudents,Weight');
        if (data.curriculum && data.curriculum.disciplines) {
            data.curriculum.disciplines.forEach(function(d) {
                var instructors = '';
                if (d.instructorIds) {
                    instructors = d.instructorIds.map(function(id) {
                        var inst = window.getCharacterById(id);
                        return inst ? window.getDisplayName(inst) : '';
                    }).filter(function(n) { return n; }).join(';');
                }
                lines.push([
                    csvField(d.name || ''),
                    csvField(d.type || 'mandatory'),
                    csvField(instructors),
                    d.startWeek || '',
                    d.endWeek || '',
                    d.weeklyHours || '',
                    d.maxStudents || '',
                    d.weight || '1'
                ].join(','));
            });
        }

        var csvContent = lines.join('\n');
        var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'hollow-blades-data-' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        if (typeof window.logActivity === 'function') {
            window.logActivity('Exported data to CSV');
        }
    }

    function importCSV(file) {
        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                if (!confirm('This will replace all current data. Continue?')) return;

                var lines = e.target.result.split('\n');
                var section = '';
                var data = window.data || {};
                var newData = {
                    characters: [],
                    teams: [],
                    tournaments: [],
                    missions: [],
                    activities: [],
                    currentYear: data.currentYear || new Date().getFullYear(),
                    currentWeek: 1,
                    curriculum: {
                        disciplines: [],
                        schedules: {},
                        restDays: {},
                        examDays: {},
                        grades: {},
                        rankings: {},
                        currentWeek: 1,
                        classInstructors: {},
                        classLabels: {},
                        classGroupLabels: {},
                        classDurations: {},
                        instructorClasses: {},
                        instructorTemplates: {},
                        instructorBlocks: {},
                        instructorGroups: {},
                        disciplineGroups: {},
                        autoGroups: {}
                    },
                    social: {
                        relationships: [],
                        relationshipTypes: [
                            { id: 'familiar', label: 'Familiar', color: '#8cbb3a' },
                            { id: 'professional', label: 'Professional', color: '#c9a24b' },
                            { id: 'romantic', label: 'Romantic', color: '#c1453c' },
                            { id: 'friendship', label: 'Friendship', color: '#4a9bc7' },
                            { id: 'mentor', label: 'Mentor/Mentee', color: '#9b59b6' },
                            { id: 'rivalry', label: 'Rivalry', color: '#e67e22' },
                            { id: 'alliance', label: 'Alliance', color: '#27ae60' },
                            { id: 'other', label: 'Other', color: '#7f8c8d' }
                        ],
                        nextId: 1
                    }
                };
                var charMap = {};
                var teamMap = {};
                var missionMap = {};
                var tournMap = {};

                for (var i = 0; i < lines.length; i++) {
                    var line = lines[i].trim();
                    if (!line) continue;

                    if (line.startsWith('# CHARACTERS')) { section = 'characters'; continue; }
                    if (line.startsWith('# TEAMS')) { section = 'teams'; continue; }
                    if (line.startsWith('# TEAM MEMBERS')) { section = 'members'; continue; }
                    if (line.startsWith('# TEAM RANKINGS')) { section = 'rankings'; continue; }
                    if (line.startsWith('# TOURNAMENTS')) { section = 'tournaments'; continue; }
                    if (line.startsWith('# TOURNAMENT TEAMS')) { section = 'tournament_teams'; continue; }
                    if (line.startsWith('# TOURNAMENT MATCHES')) { section = 'tournament_matches'; continue; }
                    if (line.startsWith('# TOURNAMENT ELIMINATIONS')) { section = 'tournament_eliminations'; continue; }
                    if (line.startsWith('# MISSIONS')) { section = 'missions'; continue; }
                    if (line.startsWith('# DISCIPLINES')) { section = 'disciplines'; continue; }
                    if (line.startsWith('FirstName,') || line.startsWith('TeamName,') || line.startsWith('TournamentName,') || line.startsWith('Title,')) {
                        continue;
                    }

                    var values = parseCSVLine(line);

                    if (section === 'characters' && values.length >= 20) {
                        var careerStatus = [];
                        if (values[18]) {
                            var careerParts = values[18].split(';');
                            careerParts.forEach(function(part) {
                                var match = part.match(/([^:]+):([^-]+)-(.+)/);
                                if (match) {
                                    careerStatus.push({
                                        status: match[1],
                                        startYear: match[2],
                                        endYear: match[3] === 'present' ? '' : match[3]
                                    });
                                }
                            });
                        }
                        var eliminatedWeeks = [];
                        if (values[19]) {
                            eliminatedWeeks = values[19].split(';').map(function(w) { return parseInt(w); }).filter(function(w) { return !isNaN(w); });
                        }
                        var char = {
                            id: window.generateId('char'),
                            firstName: values[0] || '',
                            middleName: values[1] || '',
                            lastName: values[2] || '',
                            birthYear: values[3] || '',
                            gender: values[4] || '',
                            associatedNames: values[5] || '',
                            eyes: values[6] || '',
                            hair: values[7] || '',
                            skin: values[8] || '',
                            height: values[9] || '',
                            build: values[10] || '',
                            appearanceNotes: values[11] || '',
                            notes: values[12] || '',
                            deceased: values[13] === 'true',
                            deathYear: values[14] || '',
                            deathCause: values[15] || '',
                            deathAge: values[16] || '',
                            specialty: values[17] || '',
                            careerStatus: careerStatus,
                            eliminatedWeeks: eliminatedWeeks,
                            eliminations: [],
                            createdAt: new Date().toISOString()
                        };
                        newData.characters.push(char);
                        var key = (char.firstName + '|' + (char.lastName || '')).toLowerCase();
                        charMap[key] = char;
                    } else if (section === 'teams' && values.length >= 8) {
                        var nameHistory = [];
                        if (values[6]) {
                            var nameParts = values[6].split(';');
                            nameParts.forEach(function(part) {
                                var match = part.match(/([^:]+):([^-]+)-(.+)/);
                                if (match) {
                                    nameHistory.push({
                                        name: match[1],
                                        startPeriod: match[2],
                                        endPeriod: match[3] === 'present' ? '' : match[3]
                                    });
                                }
                            });
                        }
                        var team = {
                            id: window.generateId('team'),
                            name: values[0] || '',
                            type: values[1] || 'academic',
                            startPeriod: values[2] || '',
                            endPeriod: values[3] || '',
                            currentRank: values[4] || '',
                            status: values[5] || 'active',
                            nameHistory: nameHistory,
                            temporaryMission: values[7] || null,
                            members: [],
                            rankingHistory: [],
                            createdAt: new Date().toISOString()
                        };
                        newData.teams.push(team);
                        teamMap[team.name.toLowerCase()] = team;
                    } else if (section === 'members' && values.length >= 6) {
                        var teamName = values[0];
                        var charName = values[1];
                        var team = teamMap[teamName.toLowerCase()];
                        if (team) {
                            var charKey = charName.toLowerCase();
                            var char = Object.values(charMap).find(function(c) {
                                var fullName = window.getFullName(c).toLowerCase();
                                return fullName === charKey;
                            });
                            if (char) {
                                team.members.push({
                                    characterId: char.id,
                                    role: values[2] || 'Member',
                                    joinPeriod: values[3] || '',
                                    leavePeriod: values[4] || ''
                                });
                            }
                        }
                    } else if (section === 'rankings' && values.length >= 3) {
                        var teamName = values[0];
                        var team = teamMap[teamName.toLowerCase()];
                        if (team) {
                            if (!team.rankingHistory) team.rankingHistory = [];
                            team.rankingHistory.push({
                                period: values[1] || '',
                                rank: values[2] || ''
                            });
                        }
                    } else if (section === 'tournaments' && values.length >= 6) {
                        var tourn = {
                            id: window.generateId('tourn'),
                            name: values[0] || '',
                            startWeek: values[1] || '1',
                            endWeek: values[2] || '4',
                            academicYear: values[3] || '',
                            status: values[4] || 'active',
                            winner: null,
                            teams: [],
                            matches: [],
                            eliminations: [],
                            participants: [],
                            rounds: [],
                            winners: [],
                            totalRounds: 1,
                            currentRound: 0,
                            createdAt: new Date().toISOString()
                        };
                        if (values[5]) {
                            var winnerTeam = Object.values(teamMap).find(function(t) { return t.name === values[5]; });
                            if (winnerTeam) tourn.winner = winnerTeam.id;
                        }
                        newData.tournaments.push(tourn);
                        tournMap[tourn.name.toLowerCase()] = tourn;
                    } else if (section === 'tournament_teams' && values.length >= 2) {
                        var tournName = values[0];
                        var teamName = values[1];
                        var tourn = newData.tournaments.find(function(t) { return t.name === tournName; });
                        var team = teamMap[teamName.toLowerCase()];
                        if (tourn && team) {
                            tourn.teams.push({ teamId: team.id });
                        }
                    } else if (section === 'tournament_matches' && values.length >= 4) {
                        var tournName = values[0];
                        var tourn = newData.tournaments.find(function(t) { return t.name === tournName; });
                        if (tourn) {
                            var team1 = teamMap[values[1].toLowerCase()];
                            var team2 = teamMap[values[2].toLowerCase()];
                            var winner = values[3] ? teamMap[values[3].toLowerCase()] : null;
                            if (team1 && team2) {
                                tourn.matches.push({
                                    team1Id: team1.id,
                                    team2Id: team2.id,
                                    winner: winner ? winner.id : null
                                });
                            }
                        }
                    } else if (section === 'tournament_eliminations' && values.length >= 4) {
                        var tournName = values[0];
                        var tourn = newData.tournaments.find(function(t) { return t.name === tournName; });
                        if (tourn) {
                            var charName = values[1];
                            var char = Object.values(charMap).find(function(c) {
                                return window.getDisplayName(c) === charName;
                            });
                            if (char) {
                                var teamName = values[2];
                                var team = teamMap[teamName.toLowerCase()];
                                tourn.eliminations.push({
                                    characterId: char.id,
                                    week: parseInt(values[3]) || 1,
                                    teamId: team ? team.id : null
                                });
                                if (!char.eliminatedWeeks) char.eliminatedWeeks = [];
                                if (char.eliminatedWeeks.indexOf(parseInt(values[3])) === -1) {
                                    char.eliminatedWeeks.push(parseInt(values[3]));
                                }
                            }
                        }
                    } else if (section === 'missions' && values.length >= 10) {
                        var objectives = [];
                        if (values[9]) {
                            var objParts = values[9].split(';');
                            objParts.forEach(function(part) {
                                if (part.trim()) {
                                    var done = part.endsWith('\u2713');
                                    var text = part.replace('\u2713', '').trim();
                                    objectives.push({ text: text, done: done });
                                }
                            });
                        }
                        var mission = {
                            id: window.generateId('miss'),
                            title: values[0] || '',
                            status: values[1] || 'active',
                            priority: values[2] || 'medium',
                            difficulty: values[3] || 'medium',
                            assignedTeamId: null,
                            location: values[5] || '',
                            duration: values[6] || '',
                            pay: values[7] || '',
                            progress: parseInt(values[8]) || 0,
                            objectives: objectives,
                            description: '',
                            notes: '',
                            tags: [],
                            log: [],
                            createdAt: new Date().toISOString(),
                            completedAt: null
                        };
                        if (values[4]) {
                            var team = teamMap[values[4].toLowerCase()];
                            if (team) mission.assignedTeamId = team.id;
                        }
                        newData.missions.push(mission);
                    } else if (section === 'disciplines' && values.length >= 8) {
                        var instructorIds = [];
                        if (values[2]) {
                            var instructorNames = values[2].split(';');
                            instructorNames.forEach(function(name) {
                                var inst = Object.values(charMap).find(function(c) {
                                    return window.getDisplayName(c) === name;
                                });
                                if (inst) instructorIds.push(inst.id);
                            });
                        }
                        var discipline = {
                            id: window.generateId('disc'),
                            name: values[0] || '',
                            type: values[1] || 'mandatory',
                            instructorIds: instructorIds,
                            startWeek: values[3] || '',
                            endWeek: values[4] || '',
                            weeklyHours: values[5] || '',
                            maxStudents: values[6] || '',
                            weight: parseFloat(values[7]) || 1,
                            curriculum: '',
                            gradingSystem: [],
                            createdAt: new Date().toISOString()
                        };
                        newData.curriculum.disciplines.push(discipline);
                    }
                }

                if (newData.characters.length === 0 && newData.teams.length === 0 && newData.tournaments.length === 0) {
                    alert('No valid data found in CSV file.');
                    return;
                }

                window.data = newData;
                if (typeof window.saveData === 'function') {
                    window.saveData().then(function() {
                        if (typeof window.logActivity === 'function') {
                            window.logActivity('Imported data from CSV');
                        }
                        if (typeof window.renderAll === 'function') {
                            window.renderAll();
                        }
                        alert('Imported successfully!\nCharacters: ' + newData.characters.length +
                            '\nTeams: ' + newData.teams.length +
                            '\nTournaments: ' + newData.tournaments.length +
                            '\nMissions: ' + (newData.missions ? newData.missions.length : 0));
                    }).catch(function(err) {
                        alert('Failed to save data: ' + err.message);
                    });
                } else {
                    alert('Data imported but save failed.');
                }
            } catch (err) {
                alert('Failed to import CSV: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    function exportTemplateCSV() {
        var lines = [
            '# CHARACTERS',
            'FirstName,MiddleName,LastName,BirthYear,Gender,AssociatedNames,EyeColor,HairColor,SkinColor,Height,Build,AppearanceNotes,Notes,Deceased,DeathYear,DeathCause,DeathAge,Specialty,CareerStatus,EliminatedWeeks',
            'John,,Doe,1990,Male,,Blue,Brown,Fair,5\'10",Athletic,,Example character,false,,,,,,',
            'Jane,Mary,Smith,1992,Female,The Shadow,Green,Black,Olive,5\'7",Slim,Scar on cheek,,false,,,,,trainee:1920-1923;rookie:1923-,',
            '',
            '# TEAMS',
            'TeamName,TeamType,StartPeriod,EndPeriod,CurrentRank,Status,NameHistory,TemporaryMission',
            'Example Team,academic,1,2,1,active,Example Team:1-2,',
            'Another Team,academic,3,4,2,active,Another Team:3-4,',
            'Professional Team,professional,1920,1925,1,active,,',
            '',
            '# TEAM MEMBERS',
            'TeamName,CharacterName,Role,JoinPeriod,LeavePeriod,Status',
            'Example Team,John Doe,Captain,1,,active',
            'Example Team,Jane Smith,Member,1,2,left',
            '',
            '# TEAM RANKINGS',
            'TeamName,Period,Rank',
            'Example Team,1,1',
            'Another Team,3,2',
            '',
            '# TOURNAMENTS',
            'TournamentName,StartWeek,EndWeek,AcademicYear,Status,Winner',
            'Spring Cup,1,4,1920-1921,active,',
            '',
            '# TOURNAMENT TEAMS',
            'TournamentName,TeamName',
            'Spring Cup,Example Team',
            'Spring Cup,Another Team',
            '',
            '# TOURNAMENT MATCHES',
            'TournamentName,Team1,Team2,Winner',
            'Spring Cup,Example Team,Another Team,Example Team',
            '',
            '# TOURNAMENT ELIMINATIONS',
            'TournamentName,CharacterName,TeamName,Week',
            'Spring Cup,Jane Smith,Another Team,2',
            '',
            '# MISSIONS',
            'Title,Status,Priority,Difficulty,Team,Location,Duration,Pay,Progress,Objectives',
            'Operation Nightfall,active,high,hard,Example Team,Berlin,2 weeks,5000 credits,50,Infiltrate base;Retrieve documents\u2713',
            'Rescue Mission,active,medium,medium,Another Team,London,3 days,2000 credits,0,Find hostages;Extract safely',
            '',
            '# DISCIPLINES',
            'DisciplineName,Type,Instructors,StartWeek,EndWeek,WeeklyHours,MaxStudents,Weight',
            'Combat Training,mandatory,John Doe,1,10,4,20,2',
            'Stealth,mandatory,Jane Smith,1,8,3,15,1.5'
        ];

        var csvContent = lines.join('\n');
        var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'hollow-blades-template.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        if (typeof window.logActivity === 'function') {
            window.logActivity('Exported template CSV');
        }
    }

    function exportJSON() {
        var data = window.data || {};
        var jsonData = JSON.stringify(data, null, 2);
        var blob = new Blob([jsonData], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'hollow-blades-data-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        if (typeof window.logActivity === 'function') {
            window.logActivity('Exported data to JSON');
        }
    }

    function importJSON(file) {
        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var imported = JSON.parse(e.target.result);
                if (!imported.characters || !imported.teams || !imported.tournaments) {
                    alert('Invalid data format. Missing required fields.');
                    return;
                }
                if (!confirm('This will replace all current data. Continue?')) return;

                window.data = imported;
                if (!window.data.currentYear) window.data.currentYear = new Date().getFullYear();
                if (!window.data.currentWeek) window.data.currentWeek = 1;
                if (!window.data.missions) window.data.missions = [];
                if (!window.data.curriculum) {
                    window.data.curriculum = {
                        disciplines: [],
                        schedules: {},
                        restDays: {},
                        examDays: {},
                        grades: {},
                        rankings: {},
                        currentWeek: 1,
                        classInstructors: {},
                        classLabels: {},
                        classGroupLabels: {},
                        classDurations: {},
                        instructorClasses: {},
                        instructorTemplates: {},
                        instructorBlocks: {},
                        instructorGroups: {},
                        disciplineGroups: {},
                        autoGroups: {}
                    };
                }
                if (!window.data.social) {
                    window.data.social = {
                        relationships: [],
                        relationshipTypes: [
                            { id: 'familiar', label: 'Familiar', color: '#8cbb3a' },
                            { id: 'professional', label: 'Professional', color: '#c9a24b' },
                            { id: 'romantic', label: 'Romantic', color: '#c1453c' },
                            { id: 'friendship', label: 'Friendship', color: '#4a9bc7' },
                            { id: 'mentor', label: 'Mentor/Mentee', color: '#9b59b6' },
                            { id: 'rivalry', label: 'Rivalry', color: '#e67e22' },
                            { id: 'alliance', label: 'Alliance', color: '#27ae60' },
                            { id: 'other', label: 'Other', color: '#7f8c8d' }
                        ],
                        nextId: 1
                    };
                }

                if (typeof window.migrateData === 'function') {
                    window.migrateData();
                }

                if (typeof window.saveData === 'function') {
                    window.saveData().then(function() {
                        if (typeof window.logActivity === 'function') {
                            window.logActivity('Imported data from JSON');
                        }
                        if (typeof window.renderAll === 'function') {
                            window.renderAll();
                        }
                        alert('Data imported successfully!');
                    }).catch(function(err) {
                        alert('Failed to save data: ' + err.message);
                    });
                } else {
                    alert('Data imported but save failed.');
                }
            } catch (err) {
                alert('Failed to import JSON: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    function initImportExport() {
        document.querySelectorAll('#export-json-btn').forEach(function(btn) {
            btn.addEventListener('click', exportJSON);
        });
        document.querySelectorAll('#import-json-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                document.getElementById('json-file-input').click();
            });
        });
        document.querySelectorAll('#json-file-input').forEach(function(input) {
            input.addEventListener('change', function(e) {
                if (this.files.length > 0) {
                    importJSON(this.files[0]);
                    this.value = '';
                }
            });
        });

        document.querySelectorAll('#export-csv-btn').forEach(function(btn) {
            btn.addEventListener('click', exportCSV);
        });
        document.querySelectorAll('#import-csv-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                document.getElementById('csv-file-input').click();
            });
        });
        document.querySelectorAll('#csv-file-input').forEach(function(input) {
            input.addEventListener('change', function(e) {
                if (this.files.length > 0) {
                    importCSV(this.files[0]);
                    this.value = '';
                }
            });
        });

        document.querySelectorAll('#template-csv-btn').forEach(function(btn) {
            btn.addEventListener('click', exportTemplateCSV);
        });
    }

    window.initImportExport = initImportExport;
    window.exportCSV = exportCSV;
    window.importCSV = importCSV;
    window.exportTemplateCSV = exportTemplateCSV;
    window.exportJSON = exportJSON;
    window.importJSON = importJSON;
    window.csvField = csvField;
    window.parseCSVLine = parseCSVLine;

})();