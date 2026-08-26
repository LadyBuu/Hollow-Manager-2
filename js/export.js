/**
 * js/export.js - CSV/JSON Import/Export
 * Handles data import and export in various formats
 * Path: js/export.js
 */

(function() {
    'use strict';

    // ============================================================
    // CSV PARSER - FULLY SUPPORTS QUOTED FIELDS WITH NEWLINES
    // ============================================================

    function parseCSV(text) {
        var records = [];
        var current = [];
        var field = '';
        var inQuotes = false;
        var i = 0;

        while (i < text.length) {
            var ch = text[i];

            if (inQuotes) {
                if (ch === '"') {
                    if (i + 1 < text.length && text[i + 1] === '"') {
                        field += '"';
                        i += 2;
                    } else {
                        inQuotes = false;
                        i++;
                    }
                } else {
                    field += ch;
                    i++;
                }
            } else {
                if (ch === '"') {
                    inQuotes = true;
                    i++;
                } else if (ch === ',') {
                    current.push(field);
                    field = '';
                    i++;
                } else if (ch === '\n' || ch === '\r') {
                    if (field.length > 0 || current.length > 0) {
                        current.push(field);
                        records.push(current);
                        current = [];
                        field = '';
                    }
                    if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
                        i++;
                    }
                    i++;
                } else {
                    field += ch;
                    i++;
                }
            }
        }

        if (inQuotes) {
            throw new Error('Invalid CSV: unclosed quoted field.');
        }

        if (field.length > 0 || current.length > 0) {
            current.push(field);
            records.push(current);
        }

        return records;
    }

    function csvField(value) {
        if (value === null || value === undefined) return '';
        var str = String(value);
        if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }

    function recordsToCSV(records) {
        return records.map(function(row) {
            return row.map(csvField).join(',');
        }).join('\r\n');
    }

    // ============================================================
    // NORMALISATION HELPERS
    // ============================================================

    function normaliseName(value) {
        return String(value || '').trim().toLowerCase();
    }

    function createEmptyData() {
        return {
            characters: [],
            teams: [],
            tournaments: [],
            missions: [],
            activities: [],
            classes: [],
            locations: [],
            locationSchedules: {},
            currentYear: new Date().getFullYear(),
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
                classLocations: {},
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
            },
            statsConfig: {
                classes: [
                    { id: 'warrior', label: 'Warrior', icon: '⚔', primaryStats: ['str', 'con'], secondaryStats: ['dex'], statWeights: { str: 0.4, con: 0.3, dex: 0.2, wis: 0.1 }, minStats: { str: 13, con: 12 } },
                    { id: 'skirmisher', label: 'Skirmisher', icon: '🏹', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'str'], statWeights: { dex: 0.35, wis: 0.25, con: 0.2, str: 0.15, int: 0.05 }, minStats: { dex: 13, wis: 12 } },
                    { id: 'protector', label: 'Protector', icon: '🛡', primaryStats: ['str', 'con'], secondaryStats: ['wis', 'cha'], statWeights: { str: 0.3, con: 0.3, wis: 0.2, cha: 0.15, dex: 0.05 }, minStats: { str: 13, con: 12 } },
                    { id: 'sage', label: 'Sage', icon: '📚', primaryStats: ['int', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { int: 0.35, wis: 0.25, con: 0.2, dex: 0.15, cha: 0.05 }, minStats: { int: 13, wis: 12 } },
                    { id: 'mystic', label: 'Mystic', icon: '✦', primaryStats: ['wis', 'cha'], secondaryStats: ['con', 'int'], statWeights: { wis: 0.35, cha: 0.25, con: 0.2, int: 0.15, dex: 0.05 }, minStats: { wis: 13, cha: 12 } },
                    { id: 'stalker', label: 'Stalker', icon: '🗡', primaryStats: ['dex', 'int'], secondaryStats: ['cha', 'wis'], statWeights: { dex: 0.35, int: 0.25, cha: 0.2, wis: 0.15, str: 0.05 }, minStats: { dex: 13, int: 12 } },
                    { id: 'spellblade', label: 'Spellblade', icon: '⚡', primaryStats: ['str', 'int'], secondaryStats: ['dex', 'con'], statWeights: { str: 0.3, int: 0.3, dex: 0.2, con: 0.15, wis: 0.05 }, minStats: { str: 13, int: 12 } },
                    { id: 'channeler', label: 'Channeler', icon: '✦', primaryStats: ['cha', 'con'], secondaryStats: ['dex', 'int'], statWeights: { cha: 0.35, con: 0.25, dex: 0.2, int: 0.15, wis: 0.05 }, minStats: { cha: 13, con: 12 } },
                    { id: 'warden', label: 'Warden', icon: '⚔', primaryStats: ['str', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { str: 0.3, wis: 0.25, con: 0.2, dex: 0.2, cha: 0.05 }, minStats: { str: 13, wis: 12 } },
                    { id: 'adept', label: 'Adept', icon: '✦', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'str'], statWeights: { dex: 0.3, wis: 0.3, con: 0.2, str: 0.15, int: 0.05 }, minStats: { dex: 13, wis: 13 } },
                    { id: 'artificer', label: 'Artificer', icon: '⚙', primaryStats: ['int', 'dex'], secondaryStats: ['con', 'wis'], statWeights: { int: 0.35, dex: 0.25, con: 0.2, wis: 0.15, cha: 0.05 }, minStats: { int: 13, dex: 12 } },
                    { id: 'occultist', label: 'Occultist', icon: '✦', primaryStats: ['int', 'cha'], secondaryStats: ['con', 'dex'], statWeights: { int: 0.3, cha: 0.3, con: 0.2, dex: 0.15, wis: 0.05 }, minStats: { int: 13, cha: 13 } },
                    { id: 'blade_dancer', label: 'Blade Dancer', icon: '🗡', primaryStats: ['dex', 'cha'], secondaryStats: ['str', 'con'], statWeights: { dex: 0.35, cha: 0.25, str: 0.2, con: 0.15, wis: 0.05 }, minStats: { dex: 13, cha: 12 } },
                    { id: 'elementalist', label: 'Elementalist', icon: '✦', primaryStats: ['int', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { int: 0.35, wis: 0.25, con: 0.2, dex: 0.15, cha: 0.05 }, minStats: { int: 13, wis: 12 } },
                    { id: 'sentinel', label: 'Sentinel', icon: '🛡', primaryStats: ['str', 'con'], secondaryStats: ['wis', 'dex'], statWeights: { str: 0.3, con: 0.3, wis: 0.2, dex: 0.15, cha: 0.05 }, minStats: { str: 13, con: 12 } }
                ]
            },
            _dataVersion: 12
        };
    }

    function normaliseData(data) {
        if (!data || typeof data !== 'object') {
            return createEmptyData();
        }

        var defaultData = createEmptyData();

        // Ensure top-level arrays
        ['characters', 'teams', 'tournaments', 'missions', 'activities', 'classes', 'locations'].forEach(function(key) {
            if (!Array.isArray(data[key])) {
                data[key] = defaultData[key];
            }
        });

        // Ensure locationSchedules
        if (!data.locationSchedules || typeof data.locationSchedules !== 'object') {
            data.locationSchedules = {};
        }

        // Ensure primitive fields
        if (typeof data.currentYear !== 'number') data.currentYear = defaultData.currentYear;
        if (typeof data.currentWeek !== 'number') data.currentWeek = defaultData.currentWeek;

        // Ensure curriculum
        data.curriculum = normaliseCurriculum(data.curriculum);

        // Ensure social
        data.social = normaliseSocial(data.social);

        // Ensure statsConfig
        if (!data.statsConfig || typeof data.statsConfig !== 'object') {
            data.statsConfig = defaultData.statsConfig;
        } else {
            if (!Array.isArray(data.statsConfig.classes)) {
                data.statsConfig.classes = defaultData.statsConfig.classes;
            }
        }

        // Normalise each character
        if (Array.isArray(data.characters)) {
            data.characters.forEach(function(char) {
                normaliseCharacter(char);
            });
        }

        // Normalise each team
        if (Array.isArray(data.teams)) {
            data.teams.forEach(function(team) {
                normaliseTeam(team);
            });
        }

        // Normalise each tournament
        if (Array.isArray(data.tournaments)) {
            data.tournaments.forEach(function(tourn) {
                normaliseTournament(tourn);
            });
        }

        // Normalise each mission
        if (Array.isArray(data.missions)) {
            data.missions.forEach(function(mission) {
                normaliseMission(mission);
            });
        }

        // Normalise each activity
        if (Array.isArray(data.activities)) {
            data.activities.forEach(function(activity) {
                if (!activity.id) activity.id = window.generateId('act');
                if (!activity.timestamp) activity.timestamp = new Date().toISOString();
            });
        }

        // Normalise each class
        if (Array.isArray(data.classes)) {
            data.classes.forEach(function(cls) {
                if (!cls.id) cls.id = window.generateId('class');
                if (!cls.name) cls.name = 'Unnamed Class';
                if (!cls.createdAt) cls.createdAt = new Date().toISOString();
            });
        }

        // Normalise each location
        if (Array.isArray(data.locations)) {
            data.locations.forEach(function(loc) {
                if (!loc.id) loc.id = window.generateId('loc');
                if (!loc.name) loc.name = 'Unnamed Location';
                if (!loc.type) loc.type = 'other';
                if (!loc.createdAt) loc.createdAt = new Date().toISOString();
            });
        }

        return data;
    }

    function normaliseCurriculum(curriculum) {
        var defaultCurriculum = createEmptyData().curriculum;
        if (!curriculum || typeof curriculum !== 'object') {
            return JSON.parse(JSON.stringify(defaultCurriculum));
        }

        var curriculumKeys = ['disciplines', 'schedules', 'restDays', 'examDays', 'grades', 'rankings',
                              'currentWeek', 'classInstructors', 'classLabels', 'classGroupLabels',
                              'classDurations', 'classLocations', 'instructorClasses', 'instructorTemplates',
                              'instructorBlocks', 'instructorGroups', 'disciplineGroups', 'autoGroups'];

        curriculumKeys.forEach(function(key) {
            if (curriculum[key] === undefined) {
                curriculum[key] = defaultCurriculum[key];
            }
        });

        if (!Array.isArray(curriculum.disciplines)) {
            curriculum.disciplines = [];
        }

        ['schedules', 'restDays', 'examDays', 'grades', 'rankings',
         'classInstructors', 'classLabels', 'classGroupLabels', 'classDurations',
         'classLocations', 'instructorClasses', 'instructorTemplates',
         'instructorBlocks', 'instructorGroups', 'disciplineGroups', 'autoGroups'].forEach(function(key) {
            if (!curriculum[key] || typeof curriculum[key] !== 'object') {
                curriculum[key] = {};
            }
        });

        return curriculum;
    }

    function normaliseSocial(social) {
        var defaultSocial = createEmptyData().social;
        if (!social || typeof social !== 'object') {
            return JSON.parse(JSON.stringify(defaultSocial));
        }

        if (!Array.isArray(social.relationships)) {
            social.relationships = [];
        }

        if (!Array.isArray(social.relationshipTypes)) {
            social.relationshipTypes = defaultSocial.relationshipTypes;
        }

        if (typeof social.nextId !== 'number') {
            social.nextId = 1;
        }

        return social;
    }

    function normaliseCharacter(char) {
        if (!char || typeof char !== 'object') return;

        var defaultChar = {
            id: window.generateId('char'),
            firstName: '',
            middleName: '',
            lastName: '',
            birthYear: '',
            gender: '',
            associatedNames: '',
            eyes: '',
            hair: '',
            skin: '',
            height: '',
            weight: '',
            build: '',
            appearanceNotes: '',
            notes: '',
            createdAt: new Date().toISOString(),
            deceased: false,
            deathYear: '',
            deathCause: '',
            deathAge: '',
            careerStatus: [],
            specialty: '',
            eliminatedWeeks: [],
            eliminations: [],
            stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
            nickname: '',
            alias: '',
            previousNames: [],
            nameFormat: 'firstlast',
            magic: {},
            personality: {},
            specialMoves: { physical: [], magical: [] },
            classIds: []
        };

        for (var key in defaultChar) {
            if (char[key] === undefined) {
                char[key] = defaultChar[key];
            }
        }

        if (!char.stats || typeof char.stats !== 'object') {
            char.stats = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
        }
        ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach(function(stat) {
            if (typeof char.stats[stat] !== 'number') {
                char.stats[stat] = 10;
            }
        });

        if (!char.magic || typeof char.magic !== 'object') {
            char.magic = {};
        }
        var magicTypes = ['earth','water','fire','air','metal','wood',
                          'blood','bone','mind','morphic','life','death',
                          'space','time','dimension','void','reality','transference'];
        magicTypes.forEach(function(type) {
            if (typeof char.magic[type] !== 'number') {
                char.magic[type] = 0;
            }
        });

        if (!Array.isArray(char.careerStatus)) char.careerStatus = [];
        if (!Array.isArray(char.eliminatedWeeks)) char.eliminatedWeeks = [];
        if (!Array.isArray(char.eliminations)) char.eliminations = [];
        if (!Array.isArray(char.previousNames)) char.previousNames = [];
        if (!Array.isArray(char.classIds)) char.classIds = [];
        if (!char.personality || typeof char.personality !== 'object') char.personality = {};
        if (!char.specialMoves || typeof char.specialMoves !== 'object') {
            char.specialMoves = { physical: [], magical: [] };
        }
        if (!Array.isArray(char.specialMoves.physical)) char.specialMoves.physical = [];
        if (!Array.isArray(char.specialMoves.magical)) char.specialMoves.magical = [];
    }

    function normaliseTeam(team) {
        if (!team || typeof team !== 'object') return;

        var defaultTeam = {
            id: window.generateId('team'),
            name: '',
            type: 'academic',
            startPeriod: '',
            endPeriod: '',
            currentRank: '',
            status: 'active',
            nameHistory: [],
            members: [],
            rankingHistory: [],
            temporaryMission: null,
            classId: null,
            teamNumber: '',
            createdAt: new Date().toISOString()
        };

        for (var key in defaultTeam) {
            if (team[key] === undefined) {
                team[key] = defaultTeam[key];
            }
        }

        if (!Array.isArray(team.nameHistory)) team.nameHistory = [];
        if (!Array.isArray(team.members)) team.members = [];
        if (!Array.isArray(team.rankingHistory)) team.rankingHistory = [];

        team.members.forEach(function(member) {
            if (!member || typeof member !== 'object') return;
            if (typeof member.role !== 'string') member.role = 'Member';
            if (typeof member.joinPeriod !== 'string') member.joinPeriod = '';
            if (typeof member.leavePeriod !== 'string') member.leavePeriod = '';
        });
    }

    function normaliseTournament(tourn) {
        if (!tourn || typeof tourn !== 'object') return;

        var defaultTourn = {
            id: window.generateId('tourn'),
            name: '',
            mode: 'teams',
            startWeek: 1,
            endWeek: 52,
            totalRounds: 1,
            currentRound: 0,
            status: 'draft',
            participants: [],
            teams: [],
            rounds: [],
            matches: [],
            eliminations: [],
            winner: null,
            winners: [],
            createdAt: new Date().toISOString()
        };

        for (var key in defaultTourn) {
            if (tourn[key] === undefined) {
                tourn[key] = defaultTourn[key];
            }
        }

        if (!Array.isArray(tourn.participants)) tourn.participants = [];
        if (!Array.isArray(tourn.teams)) tourn.teams = [];
        if (!Array.isArray(tourn.rounds)) tourn.rounds = [];
        if (!Array.isArray(tourn.matches)) tourn.matches = [];
        if (!Array.isArray(tourn.eliminations)) tourn.eliminations = [];
        if (!Array.isArray(tourn.winners)) tourn.winners = [];

        tourn.eliminations.forEach(function(elim) {
            if (!elim || typeof elim !== 'object') return;
            if (elim.participantId == null) {
                if (elim.characterId != null) {
                    elim.participantId = elim.characterId;
                    elim.participantType = 'character';
                } else if (elim.teamId != null) {
                    elim.participantId = elim.teamId;
                    elim.participantType = 'team';
                }
            }
            delete elim.characterId;
            delete elim.teamId;
        });
    }

    function normaliseMission(mission) {
        if (!mission || typeof mission !== 'object') return;

        var defaultMission = {
            id: window.generateId('miss'),
            title: '',
            status: 'active',
            priority: 'medium',
            difficulty: 'medium',
            assignedTeamId: null,
            location: '',
            duration: '',
            pay: '',
            progress: 0,
            objectives: [],
            description: '',
            notes: '',
            tags: [],
            log: [],
            createdAt: new Date().toISOString(),
            completedAt: null
        };

        for (var key in defaultMission) {
            if (mission[key] === undefined) {
                mission[key] = defaultMission[key];
            }
        }

        if (!Array.isArray(mission.objectives)) mission.objectives = [];
        if (!Array.isArray(mission.tags)) mission.tags = [];
        if (!Array.isArray(mission.log)) mission.log = [];
    }

    function hasExportableData(data) {
        if (!data || typeof data !== 'object') return false;

        var collections = [
            'characters',
            'teams',
            'tournaments',
            'missions',
            'activities',
            'classes',
            'locations'
        ];

        for (var i = 0; i < collections.length; i++) {
            var key = collections[i];
            if (Array.isArray(data[key]) && data[key].length > 0) {
                return true;
            }
        }

        if (data.locationSchedules &&
            typeof data.locationSchedules === 'object' &&
            Object.keys(data.locationSchedules).length > 0) {
            return true;
        }

        if (data.curriculum &&
            typeof data.curriculum === 'object') {
            if (
                (Array.isArray(data.curriculum.disciplines) && data.curriculum.disciplines.length > 0) ||
                Object.keys(data.curriculum.schedules || {}).length > 0 ||
                Object.keys(data.curriculum.grades || {}).length > 0
            ) {
                return true;
            }
        }

        if (data.social &&
            typeof data.social === 'object' &&
            Array.isArray(data.social.relationships) &&
            data.social.relationships.length > 0) {
            return true;
        }

        return false;
    }

    // ============================================================
    // EXPORT FUNCTIONS
    // ============================================================

    function exportCSV() {
        var data = window.data || {};
        if (!hasExportableData(data)) {
            alert('No data to export.');
            return;
        }

        var records = [];

        // Characters
        records.push(['# CHARACTERS']);
        records.push(['CharacterId', 'FirstName', 'MiddleName', 'LastName', 'BirthYear', 'Gender', 'AssociatedNames',
                      'EyeColor', 'HairColor', 'SkinColor', 'Height', 'Weight', 'Build', 'AppearanceNotes',
                      'Notes', 'Deceased', 'DeathYear', 'DeathCause', 'DeathAge', 'Specialty',
                      'CareerStatus', 'EliminatedWeeks']);

        (data.characters || []).forEach(function(c) {
            var careerStr = '';
            if (Array.isArray(c.careerStatus)) {
                careerStr = c.careerStatus.map(function(s) {
                    return s.status + ':' + s.startYear + '-' + (s.endYear || 'present');
                }).join(';');
            }
            var elimWeeks = Array.isArray(c.eliminatedWeeks) ? c.eliminatedWeeks.join(';') : '';
            records.push([
                c.id || '',
                c.firstName || '',
                c.middleName || '',
                c.lastName || '',
                c.birthYear || '',
                c.gender || '',
                c.associatedNames || '',
                c.eyes || '',
                c.hair || '',
                c.skin || '',
                c.height || '',
                c.weight || '',
                c.build || '',
                c.appearanceNotes || '',
                c.notes || '',
                c.deceased ? 'true' : 'false',
                c.deathYear || '',
                c.deathCause || '',
                c.deathAge || '',
                c.specialty || '',
                careerStr,
                elimWeeks
            ]);
        });

        records.push([]);

        // Teams
        records.push(['# TEAMS']);
        records.push(['TeamId', 'TeamName', 'TeamType', 'StartPeriod', 'EndPeriod', 'CurrentRank', 'Status',
                      'NameHistory', 'TemporaryMission', 'TeamNumber', 'ClassId']);

        (data.teams || []).forEach(function(t) {
            var nameHistoryStr = '';
            if (Array.isArray(t.nameHistory)) {
                nameHistoryStr = t.nameHistory.map(function(n) {
                    return n.name + ':' + n.startPeriod + '-' + (n.endPeriod || 'present');
                }).join(';');
            }
            records.push([
                t.id || '',
                t.name || '',
                t.type || 'academic',
                t.startPeriod || '',
                t.endPeriod || '',
                t.currentRank || '',
                t.status || 'active',
                nameHistoryStr,
                t.temporaryMission || '',
                t.teamNumber || '',
                t.classId || ''
            ]);
        });

        records.push([]);

        // Team Members
        records.push(['# TEAM MEMBERS']);
        records.push(['TeamId', 'CharacterId', 'Role', 'JoinPeriod', 'LeavePeriod', 'Status']);

        (data.teams || []).forEach(function(t) {
            if (!Array.isArray(t.members)) return;
            t.members.forEach(function(m) {
                var status = 'active';
                var char = window.getCharacterById ? window.getCharacterById(m.characterId) : null;
                if (char && char.deceased) status = 'deceased';
                else if (char && Array.isArray(char.eliminatedWeeks) && char.eliminatedWeeks.length > 0) status = 'eliminated';
                else if (m.leavePeriod) status = 'left';
                records.push([
                    t.id || '',
                    m.characterId || '',
                    m.role || '',
                    m.joinPeriod || '',
                    m.leavePeriod || '',
                    status
                ]);
            });
        });

        records.push([]);

        // Team Rankings
        records.push(['# TEAM RANKINGS']);
        records.push(['TeamId', 'Period', 'Rank']);

        (data.teams || []).forEach(function(t) {
            if (!Array.isArray(t.rankingHistory)) return;
            t.rankingHistory.forEach(function(r) {
                records.push([
                    t.id || '',
                    r.period || '',
                    r.rank || ''
                ]);
            });
        });

        records.push([]);

        // Tournaments
        records.push(['# TOURNAMENTS']);
        records.push(['TournamentId', 'TournamentName', 'Mode', 'StartWeek', 'EndWeek', 'TotalRounds',
                      'AcademicYear', 'Status', 'WinnerType', 'WinnerId']);

        (data.tournaments || []).forEach(function(t) {
            var winnerType = '';
            var winnerId = '';
            if (t.winner) {
                var winnerTeam = window.getTeamById ? window.getTeamById(t.winner) : null;
                var winnerChar = window.getCharacterById ? window.getCharacterById(t.winner) : null;
                if (winnerTeam) {
                    winnerType = 'team';
                    winnerId = t.winner;
                } else if (winnerChar) {
                    winnerType = 'character';
                    winnerId = t.winner;
                }
            }
            records.push([
                t.id || '',
                t.name || '',
                t.mode || 'teams',
                t.startWeek || '',
                t.endWeek || '',
                t.totalRounds || 1,
                t.academicYear || '',
                t.status || 'draft',
                winnerType,
                winnerId
            ]);
        });

        records.push([]);

        // Tournament Teams
        records.push(['# TOURNAMENT TEAMS']);
        records.push(['TournamentId', 'TeamId']);

        (data.tournaments || []).forEach(function(t) {
            if (!Array.isArray(t.teams)) return;
            t.teams.forEach(function(entry) {
                records.push([
                    t.id || '',
                    entry.teamId || ''
                ]);
            });
        });

        records.push([]);

        // Tournament Matches
        records.push(['# TOURNAMENT MATCHES']);
        records.push(['TournamentId', 'Team1Id', 'Team2Id', 'WinnerId']);

        (data.tournaments || []).forEach(function(t) {
            if (!Array.isArray(t.matches)) return;
            t.matches.forEach(function(m) {
                records.push([
                    t.id || '',
                    m.team1Id || '',
                    m.team2Id || '',
                    m.winner || ''
                ]);
            });
        });

        records.push([]);

        // Tournament Eliminations
        records.push(['# TOURNAMENT ELIMINATIONS']);
        records.push(['TournamentId', 'ParticipantId', 'ParticipantType', 'TeamId', 'Week']);

        (data.tournaments || []).forEach(function(t) {
            if (!Array.isArray(t.eliminations)) return;
            t.eliminations.forEach(function(e) {
                var participantType = e.participantType || 'character';
                records.push([
                    t.id || '',
                    e.participantId || '',
                    participantType,
                    e.teamId || '',
                    e.week || ''
                ]);
            });
        });

        records.push([]);

        // Tournament Participants (for individuals mode)
        records.push(['# TOURNAMENT PARTICIPANTS']);
        records.push(['TournamentId', 'ParticipantId', 'ParticipantType']);

        (data.tournaments || []).forEach(function(t) {
            if (!Array.isArray(t.participants)) return;
            t.participants.forEach(function(p) {
                var type = p.type || 'character';
                records.push([
                    t.id || '',
                    p.id || '',
                    type
                ]);
            });
        });

        records.push([]);

        // Missions
        records.push(['# MISSIONS']);
        records.push(['MissionId', 'Title', 'Status', 'Priority', 'Difficulty', 'TeamId', 'Location',
                      'Duration', 'Pay', 'Progress', 'Objectives']);

        (data.missions || []).forEach(function(m) {
            var objectivesStr = '';
            if (Array.isArray(m.objectives)) {
                objectivesStr = m.objectives.map(function(o) {
                    return o.text + (o.done ? ' \u2713' : '');
                }).join(';');
            }
            records.push([
                m.id || '',
                m.title || '',
                m.status || 'active',
                m.priority || 'medium',
                m.difficulty || 'medium',
                m.assignedTeamId || '',
                m.location || '',
                m.duration || '',
                m.pay || '',
                m.progress || '0',
                objectivesStr
            ]);
        });

        records.push([]);

        // Disciplines
        records.push(['# DISCIPLINES']);
        records.push(['DisciplineId', 'DisciplineName', 'Type', 'Instructors', 'StartWeek', 'EndWeek',
                      'WeeklyHours', 'MaxStudents', 'Weight']);

        if (data.curriculum && Array.isArray(data.curriculum.disciplines)) {
            data.curriculum.disciplines.forEach(function(d) {
                var instructors = '';
                if (Array.isArray(d.instructorIds)) {
                    instructors = d.instructorIds.join(';');
                }
                records.push([
                    d.id || '',
                    d.name || '',
                    d.type || 'mandatory',
                    instructors,
                    d.startWeek || '',
                    d.endWeek || '',
                    d.weeklyHours || '',
                    d.maxStudents || '',
                    d.weight || '1'
                ]);
            });
        }

        var csvContent = recordsToCSV(records);
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

    function exportTemplateCSV() {
        var records = [
            ['# CHARACTERS'],
            ['CharacterId', 'FirstName', 'MiddleName', 'LastName', 'BirthYear', 'Gender', 'AssociatedNames',
             'EyeColor', 'HairColor', 'SkinColor', 'Height', 'Weight', 'Build', 'AppearanceNotes',
             'Notes', 'Deceased', 'DeathYear', 'DeathCause', 'DeathAge', 'Specialty',
             'CareerStatus', 'EliminatedWeeks'],
            ['', 'John', '', 'Doe', '1990', 'Male', '', 'Blue', 'Brown', 'Fair', '5\'10"', '75kg', 'Athletic',
             '', 'Example character', 'false', '', '', '', '', '', ''],
            ['', 'Jane', 'Mary', 'Smith', '1992', 'Female', 'The Shadow', 'Green', 'Black', 'Olive',
             '5\'7"', '60kg', 'Slim', 'Scar on cheek', '', 'false', '', '', '', '', 'trainee:1920-1923;rookie:1923-', ''],
            [],
            ['# TEAMS'],
            ['TeamId', 'TeamName', 'TeamType', 'StartPeriod', 'EndPeriod', 'CurrentRank', 'Status',
             'NameHistory', 'TemporaryMission', 'TeamNumber', 'ClassId'],
            ['', 'Example Team', 'academic', '1', '2', '1', 'active', 'Example Team:1-2', '', '', ''],
            ['', 'Another Team', 'academic', '3', '4', '2', 'active', 'Another Team:3-4', '', '', ''],
            ['', 'Professional Team', 'professional', '1920', '1925', '1', 'active', '', '', '', ''],
            [],
            ['# TEAM MEMBERS'],
            ['TeamId', 'CharacterId', 'Role', 'JoinPeriod', 'LeavePeriod', 'Status'],
            ['', '', 'Captain', '1', '', 'active'],
            ['', '', 'Member', '1', '2', 'left'],
            [],
            ['# TEAM RANKINGS'],
            ['TeamId', 'Period', 'Rank'],
            ['', '1', '1'],
            ['', '3', '2'],
            [],
            ['# TOURNAMENTS'],
            ['TournamentId', 'TournamentName', 'Mode', 'StartWeek', 'EndWeek', 'TotalRounds',
             'AcademicYear', 'Status', 'WinnerType', 'WinnerId'],
            ['', 'Spring Cup', 'teams', '1', '4', '1', '1920-1921', 'active', '', ''],
            [],
            ['# TOURNAMENT TEAMS'],
            ['TournamentId', 'TeamId'],
            ['', ''],
            ['', ''],
            [],
            ['# TOURNAMENT MATCHES'],
            ['TournamentId', 'Team1Id', 'Team2Id', 'WinnerId'],
            ['', '', '', ''],
            [],
            ['# TOURNAMENT ELIMINATIONS'],
            ['TournamentId', 'ParticipantId', 'ParticipantType', 'TeamId', 'Week'],
            ['', '', 'character', '', '2'],
            [],
            ['# TOURNAMENT PARTICIPANTS'],
            ['TournamentId', 'ParticipantId', 'ParticipantType'],
            ['', '', 'character'],
            [],
            ['# MISSIONS'],
            ['MissionId', 'Title', 'Status', 'Priority', 'Difficulty', 'TeamId', 'Location',
             'Duration', 'Pay', 'Progress', 'Objectives'],
            ['', 'Operation Nightfall', 'active', 'high', 'hard', '', 'Berlin',
             '2 weeks', '5000 credits', '50', 'Infiltrate base;Retrieve documents \u2713'],
            ['', 'Rescue Mission', 'active', 'medium', 'medium', '', 'London',
             '3 days', '2000 credits', '0', 'Find hostages;Extract safely'],
            [],
            ['# DISCIPLINES'],
            ['DisciplineId', 'DisciplineName', 'Type', 'Instructors', 'StartWeek', 'EndWeek',
             'WeeklyHours', 'MaxStudents', 'Weight'],
            ['', 'Combat Training', 'mandatory', '', '1', '10', '4', '20', '2'],
            ['', 'Stealth', 'mandatory', '', '1', '8', '3', '15', '1.5']
        ];

        var csvContent = recordsToCSV(records);
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
        if (!hasExportableData(data)) {
            alert('No data to export.');
            return;
        }

        var exportData = JSON.parse(JSON.stringify(data));
        var jsonData = JSON.stringify(exportData, null, 2);
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

    // ============================================================
    // IMPORT FUNCTIONS
    // ============================================================

    function importJSON(file) {
        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var imported = JSON.parse(e.target.result);

                if (!imported || typeof imported !== 'object') {
                    alert('Invalid data format.');
                    return;
                }

                var oldData = window.data;

                imported = normaliseData(imported);

                if (!hasExportableData(imported)) {
                    alert('No valid data found in JSON file.');
                    return;
                }

                if (!confirm('This will replace all current data. Continue?')) return;

                window.data = imported;

                if (typeof window.saveData === 'function') {
                    window.saveData().then(function() {
                        if (typeof window.logActivity === 'function') {
                            window.logActivity('Imported data from JSON');
                        }
                        if (typeof window.renderAll === 'function') {
                            window.renderAll();
                        }
                        if (typeof window.updateDashboardStats === 'function') {
                            window.updateDashboardStats();
                        }
                        var charCount = Array.isArray(imported.characters) ? imported.characters.length : 0;
                        var teamCount = Array.isArray(imported.teams) ? imported.teams.length : 0;
                        var tournCount = Array.isArray(imported.tournaments) ? imported.tournaments.length : 0;
                        alert('Data imported successfully!\n' +
                              'Characters: ' + charCount + '\n' +
                              'Teams: ' + teamCount + '\n' +
                              'Tournaments: ' + tournCount);
                    }).catch(function(err) {
                        window.data = oldData;
                        alert('Failed to save data: ' + err.message + '\n\nData has been rolled back.');
                    });
                } else {
                    alert('Data imported into memory, but could not be saved.');
                }
            } catch (err) {
                alert('Failed to import JSON: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    function importCSV(file) {
        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var records = parseCSV(e.target.result);
                if (records.length === 0) {
                    alert('No data found in CSV file.');
                    return;
                }

                var newData = createEmptyData();
                var charMap = {};
                var teamMap = {};
                var tournMap = {};
                var section = '';
                var headers = [];
                var duplicateWarnings = [];

                for (var i = 0; i < records.length; i++) {
                    var row = records[i];
                    if (row.length === 0) continue;

                    var first = row[0] || '';

                    if (first.startsWith('# CHARACTERS')) {
                        section = 'characters';
                        i++;
                        headers = records[i] || [];
                        continue;
                    }
                    if (first.startsWith('# TEAMS')) {
                        section = 'teams';
                        i++;
                        headers = records[i] || [];
                        continue;
                    }
                    if (first.startsWith('# TEAM MEMBERS')) {
                        section = 'members';
                        i++;
                        headers = records[i] || [];
                        continue;
                    }
                    if (first.startsWith('# TEAM RANKINGS')) {
                        section = 'rankings';
                        i++;
                        headers = records[i] || [];
                        continue;
                    }
                    if (first.startsWith('# TOURNAMENTS')) {
                        section = 'tournaments';
                        i++;
                        headers = records[i] || [];
                        continue;
                    }
                    if (first.startsWith('# TOURNAMENT TEAMS')) {
                        section = 'tournament_teams';
                        i++;
                        headers = records[i] || [];
                        continue;
                    }
                    if (first.startsWith('# TOURNAMENT MATCHES')) {
                        section = 'tournament_matches';
                        i++;
                        headers = records[i] || [];
                        continue;
                    }
                    if (first.startsWith('# TOURNAMENT ELIMINATIONS')) {
                        section = 'tournament_eliminations';
                        i++;
                        headers = records[i] || [];
                        continue;
                    }
                    if (first.startsWith('# TOURNAMENT PARTICIPANTS')) {
                        section = 'tournament_participants';
                        i++;
                        headers = records[i] || [];
                        continue;
                    }
                    if (first.startsWith('# MISSIONS')) {
                        section = 'missions';
                        i++;
                        headers = records[i] || [];
                        continue;
                    }
                    if (first.startsWith('# DISCIPLINES')) {
                        section = 'disciplines';
                        i++;
                        headers = records[i] || [];
                        continue;
                    }

                    if (section === 'characters' && row.length >= 22) {
                        var careerStatus = [];
                        if (row[20]) {
                            var careerParts = row[20].split(';');
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
                        if (row[21]) {
                            eliminatedWeeks = row[21].split(';').map(function(w) { return parseInt(w); }).filter(function(w) { return !isNaN(w); });
                        }
                        var char = {
                            id: row[0] || window.generateId('char'),
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
                        newData.characters.push(char);
                        charMap[char.id] = char;
                    } else if (section === 'teams' && row.length >= 11) {
                        var nameHistory = [];
                        if (row[7]) {
                            var nameParts = row[7].split(';');
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
                            id: row[0] || window.generateId('team'),
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
                        newData.teams.push(team);
                        teamMap[team.id] = team;
                    } else if (section === 'members' && row.length >= 6) {
                        var teamId = row[0];
                        var charId = row[1];
                        var team = teamMap[teamId];
                        if (team && charMap[charId]) {
                            team.members.push({
                                characterId: charId,
                                role: row[2] || 'Member',
                                joinPeriod: row[3] || '',
                                leavePeriod: row[4] || ''
                            });
                        }
                    } else if (section === 'rankings' && row.length >= 3) {
                        var teamId = row[0];
                        var team = teamMap[teamId];
                        if (team) {
                            if (!Array.isArray(team.rankingHistory)) team.rankingHistory = [];
                            team.rankingHistory.push({
                                period: row[1] || '',
                                rank: row[2] || ''
                            });
                        }
                    } else if (section === 'tournaments' && row.length >= 10) {
                        var tourn = {
                            id: row[0] || window.generateId('tourn'),
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
                            if (winnerType === 'team' && teamMap[winnerId]) {
                                tourn.winner = winnerId;
                            } else if (winnerType === 'character' && charMap[winnerId]) {
                                tourn.winner = winnerId;
                            }
                        }
                        newData.tournaments.push(tourn);
                        tournMap[tourn.id] = tourn;
                    } else if (section === 'tournament_teams' && row.length >= 2) {
                        var tournId = row[0];
                        var teamId = row[1];
                        var tourn = tournMap[tournId];
                        if (tourn && teamMap[teamId]) {
                            tourn.teams.push({ teamId: teamId });
                        }
                    } else if (section === 'tournament_matches' && row.length >= 4) {
                        var tournId = row[0];
                        var tourn = tournMap[tournId];
                        if (tourn) {
                            tourn.matches.push({
                                team1Id: row[1] || '',
                                team2Id: row[2] || '',
                                winner: row[3] || ''
                            });
                        }
                    } else if (section === 'tournament_eliminations' && row.length >= 5) {
                        var tournId = row[0];
                        var tourn = tournMap[tournId];
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
                            if (participantType === 'character' && charMap[participantId]) {
                                var char = charMap[participantId];
                                if (!Array.isArray(char.eliminatedWeeks)) char.eliminatedWeeks = [];
                                if (char.eliminatedWeeks.indexOf(week) === -1) {
                                    char.eliminatedWeeks.push(week);
                                }
                            }
                        }
                    } else if (section === 'tournament_participants' && row.length >= 3) {
                        var tournId = row[0];
                        var tourn = tournMap[tournId];
                        if (tourn) {
                            tourn.participants.push({
                                id: row[1] || '',
                                type: row[2] || 'character'
                            });
                        }
                    } else if (section === 'missions' && row.length >= 11) {
                        var objectives = [];
                        if (row[10]) {
                            var objParts = row[10].split(';');
                            objParts.forEach(function(part) {
                                part = part.trim();
                                if (part) {
                                    var done = part.endsWith('\u2713');
                                    var text = part.replace('\u2713', '').trim();
                                    if (text) {
                                        objectives.push({ text: text, done: done });
                                    }
                                }
                            });
                        }
                        var mission = {
                            id: row[0] || window.generateId('miss'),
                            title: row[1] || '',
                            status: row[2] || 'active',
                            priority: row[3] || 'medium',
                            difficulty: row[4] || 'medium',
                            assignedTeamId: row[5] || null,
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
                        newData.missions.push(mission);
                    } else if (section === 'disciplines' && row.length >= 9) {
                        if (!newData.curriculum) newData.curriculum = createEmptyData().curriculum;
                        if (!Array.isArray(newData.curriculum.disciplines)) newData.curriculum.disciplines = [];
                        var instructorIds = [];
                        if (row[3]) {
                            instructorIds = row[3].split(';').filter(function(id) { return id; });
                        }
                        var discipline = {
                            id: row[0] || window.generateId('disc'),
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
                        newData.curriculum.disciplines.push(discipline);
                    }
                }

                newData = normaliseData(newData);

                if (!hasExportableData(newData)) {
                    alert('No valid data found in CSV file.');
                    return;
                }

                if (!confirm('This will replace all current data. Continue?')) return;

                var oldData = window.data;
                window.data = newData;

                if (typeof window.saveData === 'function') {
                    window.saveData().then(function() {
                        if (typeof window.logActivity === 'function') {
                            window.logActivity('Imported data from CSV');
                        }
                        if (typeof window.renderAll === 'function') {
                            window.renderAll();
                        }
                        if (typeof window.updateDashboardStats === 'function') {
                            window.updateDashboardStats();
                        }
                        var charCount = Array.isArray(newData.characters) ? newData.characters.length : 0;
                        var teamCount = Array.isArray(newData.teams) ? newData.teams.length : 0;
                        var tournCount = Array.isArray(newData.tournaments) ? newData.tournaments.length : 0;
                        var missionCount = Array.isArray(newData.missions) ? newData.missions.length : 0;
                        alert('CSV import completed!\n\n' +
                              'Characters: ' + charCount + '\n' +
                              'Teams: ' + teamCount + '\n' +
                              'Tournaments: ' + tournCount + '\n' +
                              'Missions: ' + missionCount);
                    }).catch(function(err) {
                        window.data = oldData;
                        alert('Failed to save data: ' + err.message + '\n\nData has been rolled back.');
                    });
                } else {
                    alert('Data imported into memory, but could not be saved.');
                }

            } catch (err) {
                alert('Failed to import CSV: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    // ============================================================
    // BUTTON BINDING - IDEMPOTENT
    // ============================================================

    function bindButton(id, handler) {
        var btn = document.getElementById(id);
        if (!btn) return;
        if (btn.dataset.exportBound === 'true') return;
        btn.dataset.exportBound = 'true';
        btn.addEventListener('click', handler);
    }

    function initImportExport() {
        bindButton('export-json-btn', function(e) {
            e.preventDefault();
            exportJSON();
        });

        bindButton('import-json-btn', function(e) {
            e.preventDefault();
            var input = document.getElementById('json-file-input');
            if (input) input.click();
        });

        var jsonInput = document.getElementById('json-file-input');
        if (jsonInput) {
            var newInput = jsonInput.cloneNode(true);
            jsonInput.parentNode.replaceChild(newInput, jsonInput);
            newInput.addEventListener('change', function() {
                if (this.files.length > 0) {
                    importJSON(this.files[0]);
                    this.value = '';
                }
            });
        }

        bindButton('export-csv-btn', function(e) {
            e.preventDefault();
            exportCSV();
        });

        bindButton('import-csv-btn', function(e) {
            e.preventDefault();
            var input = document.getElementById('csv-file-input');
            if (input) input.click();
        });

        var csvInput = document.getElementById('csv-file-input');
        if (csvInput) {
            var newInput = csvInput.cloneNode(true);
            csvInput.parentNode.replaceChild(newInput, csvInput);
            newInput.addEventListener('change', function() {
                if (this.files.length > 0) {
                    importCSV(this.files[0]);
                    this.value = '';
                }
            });
        }

        bindButton('template-csv-btn', function(e) {
            e.preventDefault();
            exportTemplateCSV();
        });
    }

    // ============================================================
    // EXPOSE GLOBALS
    // ============================================================

    window.initImportExport = initImportExport;
    window.exportCSV = exportCSV;
    window.importCSV = importCSV;
    window.exportTemplateCSV = exportTemplateCSV;
    window.exportJSON = exportJSON;
    window.importJSON = importJSON;
    window.csvField = csvField;
    window.recordsToCSV = recordsToCSV;
    window.parseCSV = parseCSV;
    window.normaliseData = normaliseData;
    window.hasExportableData = hasExportableData;
    window.normaliseName = normaliseName;

    // Auto-initialize
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(initImportExport, 200);
    } else {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(initImportExport, 200);
        });
    }

    document.addEventListener('dataLoaded', function() {
        setTimeout(initImportExport, 300);
    });

})();
