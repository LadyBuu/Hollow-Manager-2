/**
 * js/core/database.js - IndexedDB Operations
 * Path: js/core/database.js
 *
 * Data Version History (updated):
 *   - Version 23: Repairs legacy tournaments (assigns round/match IDs,
 *                strips retired fields, backfills elimination tournamentId)
 *                and backfills academy.weeklyTeams windows for classed
 *                academic teams. Orphan teams (classId: null) are left
 *                alone; the Weekly Teams view surfaces them for manual
 *                assignment.
 *   - Version 24: Member intervals refactor. Every team member entry
 *                is reshaped from flat joinPeriod / leavePeriod fields
 *                to a single-element `intervals` array. Every entry
 *                also receives a stable `memberId` if it lacks one.
 *                The flat fields are removed. Entries that already
 *                carry `intervals` are left alone. Entries that carry
 *                neither flat fields nor intervals get an empty
 *                intervals array (the member exists but has no stints;
 *                the UI surfaces this).
 *
 * ACADEMY STORES (v20+):
 *   ...
 *
 * RETIRED STORES (removed in v23):
 *   tournament.winner
 *   tournament.currentRound
 *   tournament.teams
 *   tournament.matches
 *   tournament.winners
 *   match.winner
 *   match.loser
 *   match.advancing
 */

(function() {
    'use strict';

    var DB_NAME = 'HollowBladesDB';
    var DB_VERSION = 1;
    var DATA_VERSION = 24;
    var STORE_NAME = 'appData';

    var _indexedDB = null;
    var _data = null;
    var _dbOpenPromise = null;
    var _dbInitPromise = null;
    var _loadPromise = null;
    var _dataReadyDispatched = false;
    var _dbStatus = 'uninitialized';
    var _loadError = null;

    var _isSaving = false;
    var _saveWaiters = [];

    var _recoveryAttempted = false;

    // ============================================================
    // DEFAULT FACTORIES
    // ============================================================

    function getDefaultMagicProficiencies() {
        var types = ['earth','water','fire','air','metal','wood',
                     'blood','bone','mind','morphic','life','death',
                     'space','time','dimension','void','reality','transference'];
        var proficiencies = {};
        types.forEach(function(key) { proficiencies[key] = 0; });
        return proficiencies;
    }

    function getDefaultSocialData() {
        return {
            relationships: [],
            relationshipTypes: [
                { id: 'familial', label: 'Familial', color: '#8cbb3a' },
                { id: 'professional', label: 'Professional', color: '#c9a24b' },
                { id: 'romantic', label: 'Romantic', color: '#c1453c' },
                { id: 'friendship', label: 'Friendship', color: '#4a9bc7' },
                { id: 'mentor', label: 'Mentor', color: '#9b59b6', directional: true },
                { id: 'rivalry', label: 'Rivalry', color: '#e67e22' },
                { id: 'alliance', label: 'Alliance', color: '#27ae60' },
                { id: 'other', label: 'Other', color: '#7f8c8d' }
            ],
            nextId: 1
        };
    }

    function getDefaultCurriculumData() {
        return {
            disciplines: [],
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
        };
    }

    function getDefaultStatsConfig() {
        return {
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
        };
    }

    function getDefaultAcademyData() {
        return {
            graduatingClasses: {},
            grades: {},
            rankings: {},
            weeklyTeams: {},
            enrolments: {},
            socialScores: {},
            settings: {},
            classDisciplines: {},
            teachingGroups: {},
            teachingGroupSequences: {},
            teachingSessions: {}
        };
    }

    function getEmptyData() {
        return {
            _dataVersion: DATA_VERSION,
            characters: [],
            teams: [],
            tournaments: [],
            missions: [],
            activities: [],
            classes: [],
            locations: [],
            currentYear: new Date().getFullYear(),
            currentWeek: 1,
            curriculum: getDefaultCurriculumData(),
            social: getDefaultSocialData(),
            statsConfig: getDefaultStatsConfig(),
            academy: getDefaultAcademyData()
        };
    }

    // ============================================================
    // DEEP MERGE HELPERS
    // ============================================================

    function deepMergeDefaults(target, defaults) {
        if (!target || typeof target !== 'object' || Array.isArray(target)) {
            return target === undefined ? defaults : target;
        }

        if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
            return target;
        }

        var result = {};
        var keys = Object.keys(defaults);

        keys.forEach(function(key) {
            if (target[key] === undefined) {
                result[key] = deepClone(defaults[key]);
            } else if (
                target[key] &&
                typeof target[key] === 'object' &&
                !Array.isArray(target[key]) &&
                defaults[key] &&
                typeof defaults[key] === 'object' &&
                !Array.isArray(defaults[key])
            ) {
                result[key] = deepMergeDefaults(target[key], defaults[key]);
            } else {
                result[key] = target[key];
            }
        });

        Object.keys(target).forEach(function(key) {
            if (result[key] === undefined) {
                result[key] = target[key];
            }
        });

        return result;
    }

    function deepClone(value) {
        if (value === null || typeof value !== 'object') {
            return value;
        }

        if (typeof structuredClone === 'function') {
            try {
                return structuredClone(value);
            } catch (e) {
                // Fall through to JSON fallback
            }
        }

        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            throw new Error('Database: Failed to clone value: ' + e.message);
        }
    }

    // ============================================================
    // DATABASE DELETION - Used for version-mismatch recovery
    // ============================================================

    function deleteDatabase() {
        return new Promise(function(resolve, reject) {
            try {
                var request = indexedDB.deleteDatabase(DB_NAME);

                request.onsuccess = function() {
                    resolve();
                };

                request.onerror = function(event) {
                    var error = event.target.error || new Error('Delete failed');
                    console.error('[Database] Failed to delete database:', error);
                    reject(error);
                };

                request.onblocked = function() {
                    var error = new Error(
                        'Database deletion blocked. Another tab may have the database open. ' +
                        'Please close other tabs and retry.'
                    );
                    console.error('[Database]', error.message);
                    reject(error);
                };
            } catch (err) {
                reject(err);
            }
        });
    }

    // ============================================================
    // DATABASE OPENING
    // ============================================================

    function openDatabase() {
        if (_indexedDB && _dbStatus === 'ready') {
            return Promise.resolve(_indexedDB);
        }
        if (_dbOpenPromise) {
            return _dbOpenPromise;
        }

        _dbOpenPromise = new Promise(function(resolve, reject) {
            try {
                var request = indexedDB.open(DB_NAME, DB_VERSION);

                request.onerror = function(event) {
                    var error = event.target.error;
                    _dbOpenPromise = null;

                    if (error && error.name === 'VersionError' && !_recoveryAttempted) {
                        _recoveryAttempted = true;

                        console.warn(
                            '[Database] Version mismatch detected. ' +
                            'Stored database is newer than requested version ' + DB_VERSION + '. ' +
                            'This usually means an earlier build used a higher DB_VERSION. ' +
                            'Attempting recovery by deleting and recreating the local database.'
                        );

                        _dbStatus = 'recovering';

                        deleteDatabase()
                            .then(function() {
                                _dbOpenPromise = null;
                                _dbStatus = 'uninitialized';
                                return openDatabase();
                            })
                            .then(resolve)
                            .catch(function(recoveryError) {
                                _dbStatus = 'failed';
                                _dbOpenPromise = null;
                                _dbInitPromise = null;

                                console.error(
                                    '[Database] Recovery failed. ' +
                                    'The local database could not be deleted. ' +
                                    'Please close all other tabs using this application ' +
                                    'and reload the page. ' +
                                    'Recovery error: ' + recoveryError.message
                                );

                                reject(new Error(
                                    'Database version mismatch recovery failed: ' +
                                    recoveryError.message +
                                    '. Please close other tabs and reload.'
                                ));
                            });
                        return;
                    }

                    if (error && error.name === 'VersionError' && _recoveryAttempted) {
                        console.error(
                            '[Database] Version mismatch persists after recovery attempt. ' +
                            'The database may be locked by another tab. ' +
                            'Please close all other tabs using this application and reload.'
                        );
                    }

                    _dbStatus = 'failed';
                    reject(error);
                };

                request.onblocked = function() {
                    console.warn(
                        '[Database] IndexedDB open blocked. ' +
                        'Another tab may have the database open with a different version. ' +
                        'Please close other tabs and retry.'
                    );
                };

                request.onsuccess = function(event) {
                    _indexedDB = event.target.result;
                    _dbOpenPromise = null;
                    _dbStatus = 'ready';
                    _recoveryAttempted = false;

                    _indexedDB.onversionchange = function() {
                        if (_indexedDB) {
                            _indexedDB.close();
                            _indexedDB = null;
                        }
                        _dbInitPromise = null;
                        _dbStatus = 'uninitialized';
                    };

                    _indexedDB.onclose = function() {
                        _indexedDB = null;
                        _dbInitPromise = null;
                        _dbStatus = 'uninitialized';
                    };

                    _indexedDB.onerror = function(event) {
                        console.error('IndexedDB connection error:', event.target.error);
                        _dispatchSaveFailure(event.target.error);
                    };

                    resolve(_indexedDB);
                };

                request.onupgradeneeded = function(event) {
                    var database = event.target.result;
                    if (!database.objectStoreNames.contains(STORE_NAME)) {
                        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    }
                };
            } catch (err) {
                _dbOpenPromise = null;
                _dbStatus = 'failed';
                reject(err);
            }
        });

        return _dbOpenPromise;
    }

    // ============================================================
    // DATABASE STATUS
    // ============================================================

    function getDatabaseStatus() { return _dbStatus; }
    function isDatabaseReady() { return _dbStatus === 'ready' && _indexedDB !== null; }
    function getLoadError() { return _loadError; }

    function ensureDatabaseReady() {
        if (_dbInitPromise) { return _dbInitPromise; }

        _dbStatus = 'initializing';
        _dbInitPromise = openDatabase()
            .then(function(result) {
                if (result) {
                    _indexedDB = result;
                    _dbStatus = 'ready';
                }
                return _indexedDB;
            })
            .catch(function(err) {
                _dbStatus = 'failed';
                _dbInitPromise = null;
                throw err;
            });

        return _dbInitPromise;
    }

    // ============================================================
    // DATA MIGRATION - VERSIONED
    // ============================================================

    function migrateData(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error('Invalid database data format');
        }

        if (!Array.isArray(data.characters)) data.characters = [];
        if (!Array.isArray(data.teams)) data.teams = [];
        if (!Array.isArray(data.tournaments)) data.tournaments = [];
        if (!Array.isArray(data.missions)) data.missions = [];

        if (
            typeof data._dataVersion !== 'number' ||
            !Number.isFinite(data._dataVersion) ||
            !Number.isInteger(data._dataVersion) ||
            data._dataVersion < 1
        ) {
            data._dataVersion = 1;
        }

        if (data._dataVersion > DATA_VERSION) {
            throw new Error(
                'Data version ' + data._dataVersion +
                ' is newer than supported version ' + DATA_VERSION
            );
        }

        var originalVersion = data._dataVersion;

        while (data._dataVersion < DATA_VERSION) {
            var currentVersion = data._dataVersion;
            switch (currentVersion) {
                case 1: migrateToVersion2(data); break;
                case 2: migrateToVersion3(data); break;
                case 3: migrateToVersion4(data); break;
                case 4: migrateToVersion5(data); break;
                case 5: migrateToVersion6(data); break;
                case 6: migrateToVersion7(data); break;
                case 7: migrateToVersion8(data); break;
                case 8: migrateToVersion9(data); break;
                case 9: migrateToVersion10(data); break;
                case 10: migrateToVersion11(data); break;
                case 11: migrateToVersion12(data); break;
                case 12: migrateToVersion13(data); break;
                case 13: migrateToVersion14(data); break;
                case 14: migrateToVersion15(data); break;
                case 15: migrateToVersion16(data); break;
                case 16: migrateToVersion17(data); break;
                case 17: migrateToVersion18(data); break;
                case 18: migrateToVersion19(data); break;
                case 19: migrateToVersion20(data); break;
                case 20: migrateToVersion21(data); break;
                case 21: migrateToVersion22(data); break;
                case 22: migrateToVersion23(data); break;
                case 23: migrateToVersion24(data); break;
                default: data._dataVersion = DATA_VERSION; break;
            }
        }

        return originalVersion;
    }

    function migrateToVersion2(data) {
        data.characters.forEach(function(char) {
            if (char.deceased === undefined) char.deceased = false;
            if (!Array.isArray(char.careerStatus)) char.careerStatus = [];
            if (!Array.isArray(char.eliminatedWeeks)) char.eliminatedWeeks = [];
            if (!Array.isArray(char.eliminations)) char.eliminations = [];
            if (char.middleName === undefined) char.middleName = '';
            if (char.nickname === undefined) char.nickname = '';
            if (char.alias === undefined) char.alias = '';
            if (!Array.isArray(char.previousNames)) char.previousNames = [];
            if (char.nameFormat === undefined) char.nameFormat = 'firstlast';
            if (char.eyes === undefined) char.eyes = '';
            if (char.hair === undefined) char.hair = '';
            if (char.skin === undefined) char.skin = '';
            if (char.height === undefined) char.height = '';
            if (char.weight === undefined) char.weight = '';
            if (char.build === undefined) char.build = '';
            if (char.appearanceNotes === undefined) char.appearanceNotes = '';
            if (char.specialty === undefined) char.specialty = '';
            if (char.deathYear === undefined) char.deathYear = '';
            if (char.deathCause === undefined) char.deathCause = '';
            if (char.deathAge === undefined) char.deathAge = '';
            if (char.notes === undefined) char.notes = '';
            if (char.gender === undefined) char.gender = '';
            if (!Array.isArray(char.classIds)) char.classIds = [];
            if (!char.stats || typeof char.stats !== 'object' || Array.isArray(char.stats)) {
                char.stats = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
            }
        });
        data._dataVersion = 2;
    }

    function migrateToVersion3(data) {
        data.characters.forEach(function(char) {
            if (!char.stats || typeof char.stats !== 'object' || Array.isArray(char.stats)) {
                char.stats = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
            }
            ['str','dex','con','int','wis','cha'].forEach(function(key) {
                if (char.stats[key] === undefined || char.stats[key] === null) {
                    char.stats[key] = 10;
                }
            });
            if (!char.magic || typeof char.magic !== 'object' || Array.isArray(char.magic)) {
                char.magic = getDefaultMagicProficiencies();
            }
            var magicTypes = ['earth','water','fire','air','metal','wood',
                              'blood','bone','mind','morphic','life','death',
                              'space','time','dimension','void','reality','transference'];
            magicTypes.forEach(function(key) {
                if (char.magic[key] === undefined || char.magic[key] === null) {
                    char.magic[key] = 0;
                }
            });
        });
        data._dataVersion = 3;
    }

    function migrateToVersion4(data) {
        data.teams.forEach(function(team) {
            if (!Array.isArray(team.nameHistory)) team.nameHistory = [];
            if (!Array.isArray(team.rankingHistory)) team.rankingHistory = [];
            if (!Array.isArray(team.members)) team.members = [];
            if (team.status === undefined) team.status = 'active';
            if (team.currentRank === undefined) team.currentRank = '';
            if (team.startPeriod === undefined) team.startPeriod = '';
            if (team.endPeriod === undefined) team.endPeriod = '';
            if (team.type === undefined) team.type = 'academic';
            if (team.temporaryMission === undefined) team.temporaryMission = null;
            if (team.type === 'academic' && team.classId === undefined) team.classId = null;
            if (team.teamNumber === undefined) team.teamNumber = '';
        });
        data._dataVersion = 4;
    }

    function migrateToVersion5(data) {
        data.teams.forEach(function(team) {
            if (!Array.isArray(team.members)) team.members = [];
            team.members.forEach(function(member) {
                if (member.role === undefined) member.role = 'Member';
                if (member.joinPeriod === undefined) member.joinPeriod = '';
                if (member.leavePeriod === undefined) member.leavePeriod = '';
            });
        });
        data._dataVersion = 5;
    }

    function migrateToVersion6(data) {
        data.tournaments.forEach(function(tourn) {
            if (tourn.mode === undefined) tourn.mode = 'teams';
            if (tourn.status === undefined) tourn.status = 'draft';
            if (!Array.isArray(tourn.participants)) tourn.participants = [];
            if (!Array.isArray(tourn.rounds)) tourn.rounds = [];
            if (!Array.isArray(tourn.eliminations)) tourn.eliminations = [];
            if (!Array.isArray(tourn.winners)) tourn.winners = [];
            if (tourn.totalRounds === undefined) tourn.totalRounds = 1;
            if (tourn.startWeek === undefined) tourn.startWeek = 1;
            if (tourn.endWeek === undefined) tourn.endWeek = 52;
            if (tourn.winner === undefined) tourn.winner = null;
            if (tourn.currentRound === undefined) tourn.currentRound = 0;
            if (!Array.isArray(tourn.teams)) tourn.teams = [];
            if (!Array.isArray(tourn.matches)) tourn.matches = [];
            if (tourn.createdAt === undefined) tourn.createdAt = new Date().toISOString();
        });
        data._dataVersion = 6;
    }

    function migrateToVersion7(data) {
        data.missions.forEach(function(mission) {
            if (mission.status === undefined) mission.status = 'active';
            if (mission.createdAt === undefined) mission.createdAt = new Date().toISOString();
            if (mission.completedAt === undefined) mission.completedAt = null;
            if (mission.assignedTeamId === undefined) mission.assignedTeamId = null;
            if (mission.priority === undefined) mission.priority = 'medium';
            if (!Array.isArray(mission.tags)) mission.tags = [];
            if (!Array.isArray(mission.objectives)) mission.objectives = [];
            if (mission.progress === undefined) mission.progress = 0;
            if (!Array.isArray(mission.log)) mission.log = [];
            if (mission.notes === undefined) mission.notes = '';
            if (mission.location === undefined) mission.location = '';
            if (mission.duration === undefined) mission.duration = '';
            if (mission.difficulty === undefined) mission.difficulty = 'medium';
            if (mission.pay === undefined) mission.pay = '';
            if (mission.objective === undefined) mission.objective = '';
        });
        data._dataVersion = 7;
    }

    function migrateToVersion8(data) {
        if (!data.curriculum || typeof data.curriculum !== 'object' || Array.isArray(data.curriculum)) {
            data.curriculum = getDefaultCurriculumData();
        }
        data._dataVersion = 8;
    }

    function migrateToVersion9(data) {
        if (!data.social || typeof data.social !== 'object' || Array.isArray(data.social)) {
            data.social = getDefaultSocialData();
        }
        if (!Array.isArray(data.social.relationships)) data.social.relationships = [];
        if (data.social.nextId === undefined) data.social.nextId = 1;
        data._dataVersion = 9;
    }

    function migrateToVersion10(data) {
        if (!Array.isArray(data.classes)) data.classes = [];
        if (!Array.isArray(data.locations)) data.locations = [];
        if (!data.locationSchedules || typeof data.locationSchedules !== 'object') data.locationSchedules = {};
        if (data.curriculum) {
            if (!data.curriculum.classLocations || typeof data.curriculum.classLocations !== 'object' || Array.isArray(data.curriculum.classLocations)) {
                data.curriculum.classLocations = {};
            }
        }
        data._dataVersion = 10;
    }

    function migrateToVersion11(data) {
        if (!data.statsConfig || typeof data.statsConfig !== 'object' || Array.isArray(data.statsConfig)) {
            data.statsConfig = getDefaultStatsConfig();
        }
        data._dataVersion = 11;
    }

    function migrateToVersion12(data) {
        data.characters.forEach(function(char) {
            if (!char.personality || typeof char.personality !== 'object' || Array.isArray(char.personality)) {
                char.personality = {};
            }
            if (!char.specialMoves || typeof char.specialMoves !== 'object' || Array.isArray(char.specialMoves)) {
                char.specialMoves = { physical: [], magical: [] };
            } else {
                if (!Array.isArray(char.specialMoves.physical)) {
                    char.specialMoves.physical = [];
                }
                if (!Array.isArray(char.specialMoves.magical)) {
                    char.specialMoves.magical = [];
                }
            }
        });
        data._dataVersion = 12;
    }

    function migrateToVersion13(data) {
        data.characters.forEach(function(char) {
            if (char.attraction === undefined) char.attraction = '';
            if (char.sexuality === undefined) char.sexuality = '';
        });
        data._dataVersion = 13;
    }

    function migrateToVersion14(data) {
        data.characters.forEach(function(char) {
            if (typeof char.hp !== 'number' || isNaN(char.hp) || char.hp < 0) char.hp = 0;
            if (char.hp > 999) char.hp = 999;
            if (typeof char.mp !== 'number' || isNaN(char.mp) || char.mp < 0) char.mp = 0;
            if (char.mp > 999) char.mp = 999;
            if (typeof char.combatNotes !== 'string') char.combatNotes = '';
            if (!Array.isArray(char.weapons)) {
                char.weapons = [];
            } else {
                char.weapons = char.weapons.filter(function(w) {
                    return w && typeof w === 'object';
                }).map(function(w) {
                    return {
                        id:    typeof w.id === 'string' && w.id ? w.id : ('weapon_' + Math.random().toString(36).slice(2, 10)),
                        name:  typeof w.name === 'string' ? w.name : '',
                        type:  typeof w.type === 'string' ? w.type : 'sharp',
                        notes: typeof w.notes === 'string' ? w.notes : ''
                    };
                });
            }
        });
        data._dataVersion = 14;
    }

    function migrateToVersion15(data) {
        if (!data.academy || typeof data.academy !== 'object' || Array.isArray(data.academy)) {
            data.academy = {};
        }
        var academy = data.academy;

        if (!academy.graduatingClasses || typeof academy.graduatingClasses !== 'object' || Array.isArray(academy.graduatingClasses)) {
            academy.graduatingClasses = {};
        }
        if (!academy.grades || typeof academy.grades !== 'object' || Array.isArray(academy.grades)) {
            academy.grades = {};
        }
        if (!academy.rankings || typeof academy.rankings !== 'object' || Array.isArray(academy.rankings)) {
            academy.rankings = {};
        }
        if (!academy.weeklyTeams || typeof academy.weeklyTeams !== 'object' || Array.isArray(academy.weeklyTeams)) {
            academy.weeklyTeams = {};
        }

        var legacy = academy.classStudents;
        var legacyMergedCount = 0;

        if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
            Object.keys(legacy).forEach(function(classId) {
                var students = legacy[classId];
                if (!Array.isArray(students)) return;
                students.forEach(function(studentId) {
                    if (!studentId) return;
                    var targetId = String(studentId);
                    var char = data.characters.find(function(c) {
                        return c && String(c.id) === targetId;
                    });
                    if (!char) return;
                    if (!Array.isArray(char.classIds)) char.classIds = [];
                    var alreadyPresent = char.classIds.some(function(existingId) {
                        return String(existingId) === String(classId);
                    });
                    if (!alreadyPresent) {
                        char.classIds.push(classId);
                        legacyMergedCount++;
                    }
                });
            });
        }

        delete academy.classStudents;

        data.characters.forEach(function(char) {
            if (!Array.isArray(char.classIds)) char.classIds = [];
        });

        var validClassIds = Object.create(null);
        Object.keys(academy.graduatingClasses).forEach(function(id) {
            validClassIds[id] = true;
        });

        var prunedCount = 0;
        data.characters.forEach(function(char) {
            var before = char.classIds.length;
            char.classIds = char.classIds.filter(function(id) {
                return validClassIds[id] === true;
            });
            prunedCount += before - char.classIds.length;
        });

        if (prunedCount > 0) {
            console.warn('[Database] v15: pruned ' + prunedCount + ' classId references to non-existent classes.');
        }

        data._dataVersion = 15;
    }

    function migrateToVersion16(data) {
        if (!data.academy || typeof data.academy !== 'object' || Array.isArray(data.academy)) {
            data.academy = {};
        }
        var academy = data.academy;

        if (!academy.enrolments || typeof academy.enrolments !== 'object' || Array.isArray(academy.enrolments)) {
            academy.enrolments = {};
        }
        if (!academy.socialScores || typeof academy.socialScores !== 'object' || Array.isArray(academy.socialScores)) {
            academy.socialScores = {};
        }
        if (!academy.settings || typeof academy.settings !== 'object' || Array.isArray(academy.settings)) {
            academy.settings = {};
        }

        data._dataVersion = 16;
    }

    function migrateToVersion17(data) {
        if (!Array.isArray(data.tournaments)) {
            data.tournaments = [];
            data._dataVersion = 17;
            return;
        }

        var Schema = window.TournamentSchema;

        if (!Schema || typeof Schema.normaliseTournament !== 'function') {
            console.warn(
                '[Database] v17 skipped: TournamentSchema.normaliseTournament ' +
                'is not available.'
            );
            data._dataVersion = 17;
            return;
        }

        var normalisedCount = 0;
        var preservedCount = 0;

        for (var i = 0; i < data.tournaments.length; i++) {
            var t = data.tournaments[i];
            if (!t || typeof t !== 'object' || Array.isArray(t)) {
                preservedCount++;
                continue;
            }

            var normalised = null;
            try {
                normalised = Schema.normaliseTournament(t);
            } catch (err) {
                console.warn(
                    '[Database] v17: normaliseTournament threw for tournament ' +
                    (t.id ? '"' + t.id + '"' : 'at index ' + i) + ': ' +
                    (err && err.message ? err.message : 'unknown error')
                );
                preservedCount++;
                continue;
            }

            if (normalised === null) {
                preservedCount++;
                continue;
            }

            data.tournaments[i] = normalised;
            normalisedCount++;
        }

        data._dataVersion = 17;
    }

    function migrateToVersion18(data) {
        if (!Array.isArray(data.characters)) {
            data._dataVersion = 18;
            return;
        }

        var IdUtils = window.IdUtils;
        if (!IdUtils || typeof IdUtils.generateId !== 'function') {
            console.warn('[Database] v18 skipped: IdUtils.generateId is not available.');
            data._dataVersion = 18;
            return;
        }

        var seenIds = Object.create(null);
        for (var i = 0; i < data.characters.length; i++) {
            var existing = data.characters[i];
            if (existing && typeof existing.id === 'string' && existing.id !== '') {
                seenIds[existing.id] = true;
            }
        }

        var repairedCount = 0;
        var collisionCount = 0;

        for (var j = 0; j < data.characters.length; j++) {
            var c = data.characters[j];
            if (!c || typeof c !== 'object') continue;

            var id = c.id;
            if (id !== null && id !== undefined && id !== '') continue;

            var newId = IdUtils.generateId('char');
            while (seenIds[newId]) {
                collisionCount++;
                newId = IdUtils.generateId('char');
                if (collisionCount > 1000) {
                    throw new Error(
                        '[Database] v18: cannot generate a unique ID after 1000 attempts.'
                    );
                }
            }

            seenIds[newId] = true;
            c.id = newId;
            repairedCount++;
        }

        if (repairedCount > 0) {
            console.log('[Database] v18: assigned IDs to ' + repairedCount + ' character(s).');
        }
        if (collisionCount > 0) {
            console.warn('[Database] v18: resolved ' + collisionCount + ' ID collision(s).');
        }

        data._dataVersion = 18;
    }

    function migrateToVersion19(data) {
        if (!data.academy || typeof data.academy !== 'object') {
            data._dataVersion = 19;
            return;
        }

        var oldStore = data.academy.weeklyTeams;
        var classCount = 0;
        var keyCount = 0;

        if (oldStore && typeof oldStore === 'object' && !Array.isArray(oldStore)) {
            classCount = Object.keys(oldStore).length;
            Object.keys(oldStore).forEach(function(classId) {
                var byClass = oldStore[classId];
                if (byClass && typeof byClass === 'object') {
                    keyCount += Object.keys(byClass).length;
                }
            });
        }

        if (classCount > 0 || keyCount > 0) {
            console.warn(
                '[Database] v19: resetting academy.weeklyTeams. ' +
                classCount + ' class bucket(s), ' + keyCount + ' key(s) removed.'
            );
        }

        data.academy.weeklyTeams = {};
        data._dataVersion = 19;
    }

    function migrateToVersion20(data) {
        if (!data.academy || typeof data.academy !== 'object' || Array.isArray(data.academy)) {
            data.academy = {};
        }
        var academy = data.academy;

        if (!academy.classDisciplines || typeof academy.classDisciplines !== 'object' || Array.isArray(academy.classDisciplines)) {
            academy.classDisciplines = {};
        }
        if (!academy.teachingGroups || typeof academy.teachingGroups !== 'object' || Array.isArray(academy.teachingGroups)) {
            academy.teachingGroups = {};
        }
        if (!academy.teachingGroupSequences || typeof academy.teachingGroupSequences !== 'object' || Array.isArray(academy.teachingGroupSequences)) {
            academy.teachingGroupSequences = {};
        }
        if (!academy.teachingSessions || typeof academy.teachingSessions !== 'object' || Array.isArray(academy.teachingSessions)) {
            academy.teachingSessions = {};
        }

        data._dataVersion = 20;
    }

    function migrateToVersion21(data) {
        if (data.curriculum && typeof data.curriculum === 'object') {
            delete data.curriculum.schedules;
            delete data.curriculum.locationSchedules;
            delete data.curriculum.metadata;
        }
        delete data.locationSchedules;
        data._dataVersion = 21;
    }

    function migrateToVersion22(data) {
        if (!data.academy || typeof data.academy !== 'object' || Array.isArray(data.academy)) {
            data._dataVersion = 22;
            return;
        }

        var weeklyTeams = data.academy.weeklyTeams;
        if (!weeklyTeams || typeof weeklyTeams !== 'object' || Array.isArray(weeklyTeams)) {
            data._dataVersion = 22;
            return;
        }

        if (!Array.isArray(data.teams)) data.teams = [];

        var teamById = Object.create(null);
        for (var t = 0; t < data.teams.length; t++) {
            var team = data.teams[t];
            if (team && typeof team.id === 'string' && team.id) {
                teamById[team.id] = team;
            }
        }

        var membersMigrated = 0;
        var membersAlreadyPresent = 0;
        var teamsMissing = 0;
        var recordsProcessed = 0;

        var classIds = Object.keys(weeklyTeams);
        for (var c = 0; c < classIds.length; c++) {
            var classId = classIds[c];
            var byClass = weeklyTeams[classId];
            if (!byClass || typeof byClass !== 'object' || Array.isArray(byClass)) continue;

            var teamIds = Object.keys(byClass);
            for (var i = 0; i < teamIds.length; i++) {
                var teamId = teamIds[i];
                var record = byClass[teamId];
                if (!record || typeof record !== 'object' || Array.isArray(record)) continue;

                recordsProcessed++;

                var redundantMembers = Array.isArray(record.members) ? record.members : [];
                if (redundantMembers.length === 0) {
                    delete record.members;
                    continue;
                }

                var persistentTeam = teamById[teamId];
                if (!persistentTeam) {
                    teamsMissing++;
                    delete record.members;
                    continue;
                }

                if (!Array.isArray(persistentTeam.members)) persistentTeam.members = [];

                for (var m = 0; m < redundantMembers.length; m++) {
                    var redundant = redundantMembers[m];
                    if (!redundant || typeof redundant !== 'object') continue;
                    var charId = redundant.characterId;
                    if (charId === null || charId === undefined || charId === '') continue;
                    var charIdStr = String(charId);

                    var existing = null;
                    for (var p = 0; p < persistentTeam.members.length; p++) {
                        var candidate = persistentTeam.members[p];
                        if (candidate && String(candidate.characterId) === charIdStr) {
                            existing = candidate;
                            break;
                        }
                    }

                    var joinStr = (redundant.startWeek !== undefined && redundant.startWeek !== null)
                        ? String(redundant.startWeek) : '';
                    var leaveStr = (redundant.endWeek !== undefined && redundant.endWeek !== null)
                        ? String(redundant.endWeek) : '';

                    if (existing) {
                        if ((existing.joinPeriod === undefined || existing.joinPeriod === null || existing.joinPeriod === '') && joinStr !== '') {
                            existing.joinPeriod = joinStr;
                        }
                        if ((existing.leavePeriod === undefined || existing.leavePeriod === null || existing.leavePeriod === '') && leaveStr !== '') {
                            existing.leavePeriod = leaveStr;
                        }
                        membersAlreadyPresent++;
                    } else {
                        persistentTeam.members.push({
                            characterId: charIdStr,
                            role: (typeof redundant.role === 'string' && redundant.role) ? redundant.role : 'Member',
                            joinPeriod: joinStr,
                            leavePeriod: leaveStr
                        });
                        membersMigrated++;
                    }
                }

                delete record.members;
            }
        }

        console.log(
            '[Database] v22: collapsed weekly-team member arrays. ' +
            'Records processed: ' + recordsProcessed + '. ' +
            'Members merged into persistent roster: ' + membersMigrated + '. ' +
            'Members already present: ' + membersAlreadyPresent + '. ' +
            'Records dropped due to missing persistent team: ' + teamsMissing + '.'
        );

        data._dataVersion = 22;
    }

    /**
     * Version 23 migration — Repair legacy tournaments and backfill
     * weekly-team windows for classed academic teams.
     *
     * WHY:
     *   1. Legacy tournaments (pre-v17) carried empty round/match
     *      IDs, retired fields (`winner`, `loser`, `advancing`,
     *      `currentRound`, `teams`, `matches`, `winners`), and
     *      eliminations with empty `tournamentId`. The current
     *      TournamentSchema rejects these shapes, so they were
     *      frozen by the v17 migration. v23 canonicalises them.
     *
     *   2. Old academic Teams created before the class-association
     *      feature carry `classId: null` and have no corresponding
     *      `academy.weeklyTeams` window record. Without a window, the
     *      Weekly Teams view cannot show them even when they do have
     *      a class. v23 backfills a window for every academic team
     *      that HAS a class.
     *
     *      Teams with `classId: null` are left alone. The Weekly
     *      Teams view surfaces them for manual assignment.
     *
     * WHAT THIS DOES NOT DO:
     *   - It does NOT infer classes from member overlap. No guessing.
     *   - It does NOT touch teams with `classId: null`.
     *   - It does NOT delete any tournament.
     *   - It does NOT touch non-tournament, non-weekly-team data.
     *
     * @param {object} data
     */
    function migrateToVersion23(data) {
        var Schema = window.TournamentSchema;
        var IdUtils = window.IdUtils;

        // ---- Part 1: Tournament repair ----
        if (Array.isArray(data.tournaments) &&
            Schema &&
            typeof Schema.generateRoundId === 'function' &&
            typeof Schema.generateMatchId === 'function' &&
            typeof Schema.normaliseTournament === 'function' &&
            IdUtils &&
            typeof IdUtils.generateId === 'function') {

            var tRepaired = 0;
            var tPreserved = 0;

            for (var i = 0; i < data.tournaments.length; i++) {
                var t = data.tournaments[i];
                if (!t || typeof t !== 'object' || Array.isArray(t)) {
                    tPreserved++;
                    continue;
                }

                var tournamentId = (typeof t.id === 'string' && t.id)
                    ? t.id
                    : null;
                if (!tournamentId) {
                    tPreserved++;
                    continue;
                }

                // Strip retired tournament-level fields.
                delete t.winner;
                delete t.currentRound;
                delete t.teams;
                delete t.matches;
                delete t.winners;

                var rounds = Array.isArray(t.rounds) ? t.rounds : [];
                var seenRoundIds = Object.create(null);
                var seenMatchIds = Object.create(null);

                for (var r = 0; r < rounds.length; r++) {
                    var round = rounds[r];
                    if (!round || typeof round !== 'object') continue;

                    // Assign a round ID if missing.
                    if (typeof round.id !== 'string' || round.id === '') {
                        var newRoundId;
                        do {
                            newRoundId = Schema.generateRoundId();
                        } while (seenRoundIds[newRoundId]);
                        round.id = newRoundId;
                    }
                    seenRoundIds[round.id] = true;

                    // Recompute positional roundNumber.
                    round.roundNumber = r + 1;

                    if (!round.matchType) round.matchType = 'group_exam';
                    if (typeof round.matchSize !== 'number' || round.matchSize < 2) {
                        round.matchSize = 2;
                    }
                    if (!Array.isArray(round.matches)) round.matches = [];

                    for (var m = 0; m < round.matches.length; m++) {
                        var match = round.matches[m];
                        if (!match || typeof match !== 'object') continue;

                        // Assign a match ID if missing.
                        if (typeof match.id !== 'string' || match.id === '') {
                            var newMatchId;
                            do {
                                newMatchId = Schema.generateMatchId();
                            } while (seenMatchIds[newMatchId]);
                            match.id = newMatchId;
                        }
                        seenMatchIds[match.id] = true;

                        // Strip retired match-level fields.
                        delete match.winner;
                        delete match.loser;
                        delete match.advancing;

                        // Ensure match.type matches round.matchType.
                        if (!match.type) match.type = round.matchType;

                        // Ensure type-appropriate result maps exist.
                        if (match.type === 'group_exam') {
                            if (!match.results || typeof match.results !== 'object' || Array.isArray(match.results)) {
                                match.results = {};
                            }
                            delete match.teamResults;
                            delete match.individualResults;
                        } else if (match.type === 'team_vs_team') {
                            if (!match.teamResults || typeof match.teamResults !== 'object' || Array.isArray(match.teamResults)) {
                                match.teamResults = {};
                            }
                            if (!match.individualResults || typeof match.individualResults !== 'object' || Array.isArray(match.individualResults)) {
                                match.individualResults = {};
                            }
                            delete match.results;
                        }
                    }
                }

                // Backfill empty tournamentId on eliminations.
                if (Array.isArray(t.eliminations)) {
                    for (var e = 0; e < t.eliminations.length; e++) {
                        var elim = t.eliminations[e];
                        if (!elim || typeof elim !== 'object') continue;
                        if (elim.tournamentId === undefined ||
                            elim.tournamentId === null ||
                            elim.tournamentId === '') {
                            elim.tournamentId = tournamentId;
                        }
                        if (elim.standalone === undefined) elim.standalone = false;
                    }
                }

                // Final schema pass. If normalisation succeeds, adopt
                // the canonical record. If it fails, preserve the
                // partially-repaired record and log.
                try {
                    var normalised = Schema.normaliseTournament(t);
                    if (normalised !== null) {
                        data.tournaments[i] = normalised;
                        tRepaired++;
                    } else {
                        tPreserved++;
                        console.warn(
                            '[Database] v23: tournament "' + tournamentId +
                            '" could not be normalised after repair. Preserved as-is.'
                        );
                    }
                } catch (err) {
                    tPreserved++;
                    console.warn(
                        '[Database] v23: normaliseTournament threw for "' +
                        tournamentId + '": ' +
                        (err && err.message ? err.message : 'unknown error')
                    );
                }
            }

            console.log(
                '[Database] v23: tournament repair complete. ' +
                'Repaired: ' + tRepaired + '. Preserved: ' + tPreserved + '.'
            );
        } else {
            console.warn(
                '[Database] v23: tournament repair skipped. ' +
                'TournamentSchema or IdUtils not available at migration time.'
            );
        }

        // ---- Part 2: Weekly-team window backfill ----
        if (!data.academy || typeof data.academy !== 'object' || Array.isArray(data.academy)) {
            data._dataVersion = 23;
            return;
        }

        if (!Array.isArray(data.teams)) data.teams = [];
        if (!data.academy.weeklyTeams || typeof data.academy.weeklyTeams !== 'object' || Array.isArray(data.academy.weeklyTeams)) {
            data.academy.weeklyTeams = {};
        }

        var TeamConstants = window.TeamConstants;
        var parsePeriod = (TeamConstants && typeof TeamConstants.parsePeriod === 'function')
            ? TeamConstants.parsePeriod
            : null;

        var weeklyTeams = data.academy.weeklyTeams;
        var windowsCreated = 0;
        var orphansSkipped = 0;
        var alreadyPresent = 0;
        var malformedSkipped = 0;

        function ensureClassBucket(classId) {
            if (!weeklyTeams[classId] || typeof weeklyTeams[classId] !== 'object' || Array.isArray(weeklyTeams[classId])) {
                weeklyTeams[classId] = {};
            }
            return weeklyTeams[classId];
        }

        for (var ti = 0; ti < data.teams.length; ti++) {
            var team = data.teams[ti];
            if (!team || typeof team !== 'object') continue;

            // Only academic teams participate in weekly windows.
            var normalizedType = TeamConstants && typeof TeamConstants.normalizeTeamType === 'function'
                ? TeamConstants.normalizeTeamType(team.type)
                : (team.type === 'academic' ? 'academic' : null);
            if (normalizedType !== 'academic') continue;

            var teamId = team.id;
            if (typeof teamId !== 'string' || teamId === '') {
                malformedSkipped++;
                continue;
            }

            var classId = team.classId;
            if (classId === null || classId === undefined || classId === '') {
                // Orphan: leave alone. The Weekly Teams view will
                // surface it for manual class assignment.
                orphansSkipped++;
                continue;
            }

            classId = String(classId);

            // Check for an existing window across every class bucket.
            var existingWindow = false;
            var bucketKeys = Object.keys(weeklyTeams);
            for (var bk = 0; bk < bucketKeys.length; bk++) {
                var bucket = weeklyTeams[bucketKeys[bk]];
                if (bucket && typeof bucket === 'object' && bucket[teamId]) {
                    existingWindow = true;
                    break;
                }
            }
            if (existingWindow) {
                alreadyPresent++;
                continue;
            }

            // Parse team's own period as the window.
            var startWeek = parsePeriod ? parsePeriod(team.startPeriod) : null;
            var endWeek = parsePeriod ? parsePeriod(team.endPeriod) : null;

            if (startWeek === null) {
                // No valid start: cannot backfill a meaningful window.
                malformedSkipped++;
                continue;
            }

            var bucket = ensureClassBucket(classId);
            var now = new Date().toISOString();
            bucket[teamId] = {
                id: teamId,
                classId: classId,
                teamId: teamId,
                startWeek: startWeek,
                endWeek: endWeek,
                createdAt: (typeof team.createdAt === 'string' && team.createdAt)
                    ? team.createdAt
                    : now,
                updatedAt: now
            };
            windowsCreated++;
        }

        console.log(
            '[Database] v23: weekly-team window backfill complete. ' +
            'Windows created: ' + windowsCreated + '. ' +
            'Already present: ' + alreadyPresent + '. ' +
            'Orphan teams skipped (no classId): ' + orphansSkipped + '. ' +
            'Malformed skipped: ' + malformedSkipped + '.'
        );

        data._dataVersion = 23;
    }

    /**
     * Version 24 migration — Member intervals refactor.
     *
     * WHY:
     *   Before v24, a team member entry carried flat `joinPeriod` and
     *   `leavePeriod` fields. A single entry could only describe one
     *   stint. A character who left a team and later rejoined had to
     *   be handled by purging the existing entry and appending a new
     *   one — which lost the previous stint's history and made "edit
     *   this stint's leave week" ambiguous when the same character
     *   appeared twice.
     *
     *   v24 changes the member entry shape to:
     *
     *     {
     *       memberId,        // stable per-entry identifier
     *       characterId,
     *       role,
     *       intervals: [
     *         { joinPeriod, leavePeriod },
     *         ...
     *       ]
     *     }
     *
     *   Multiple stints for the same character now live in one entry's
     *   intervals array. A rejoin appends a new interval instead of
     *   replacing the entry. Each interval is identified by its
     *   joinPeriod (which is unique per character within a team).
     *
     * WHAT THIS MIGRATION DOES:
     *   1. For every team, for every member entry:
     *      a. If the entry has flat `joinPeriod` or `leavePeriod` and
     *         no `intervals` array, wrap them into a single-element
     *         intervals array and delete the flat fields.
     *      b. If the entry already has an `intervals` array, leave it
     *         alone (defensive — this shape shouldn't exist before
     *         v24 runs, but data from a partially-migrated build
     *         might).
     *      c. If the entry has neither flat fields nor an intervals
     *         array, create `intervals: []`. The member exists but
     *         has no stints; the UI surfaces this rather than
     *         silently dropping the member.
     *      d. Ensure the entry has a `memberId`. Entries that already
     *         carry one keep it. Entries that don't receive a fresh
     *         one in the same `mem_<timestamp>_<random>` format that
     *         the mutation layer uses at write time.
     *
     *   2. Log counts: entries migrated, entries with pre-existing
     *      intervals (skipped), entries that became empty-interval,
     *      memberIds generated, malformed entries skipped.
     *
     * WHAT THIS MIGRATION DOES NOT DO:
     *   - It does NOT touch `academy.weeklyTeams`. That store is a
     *     window-only wrapper and never carried member data (v22
     *     already stripped the redundant members array).
     *   - It does NOT re-derive or repair interval bounds beyond
     *     preserving what the flat fields already contained. If a
     *     legacy entry had invalid bounds, they remain invalid in the
     *     interval. The domain layer (TeamCore) is where interval
     *     validation happens on write.
     *   - It does NOT reorder or merge intervals. If a legacy entry
     *     somehow produced two intervals that overlap, they stay
     *     overlapping. Cleaning that up is a data-quality task, not
     *     a schema migration.
     *   - It does NOT delete any team or member.
     *
     * @param {object} data
     */
    function migrateToVersion24(data) {
        if (!Array.isArray(data.teams)) {
            data._dataVersion = 24;
            return;
        }

        var teamsProcessed = 0;
        var membersSeen = 0;
        var membersMigrated = 0;
        var membersAlreadyIntervals = 0;
        var membersBecameEmpty = 0;
        var memberIdsGenerated = 0;
        var malformedMembersSkipped = 0;

        function generateMemberId() {
            return 'mem_' + Date.now() + '_' +
                Math.random().toString(36).slice(2, 8);
        }

        function hasFlatPeriodField(member) {
            var hasJoin = member.joinPeriod !== undefined &&
                          member.joinPeriod !== null &&
                          member.joinPeriod !== '';
            var hasLeave = member.leavePeriod !== undefined &&
                           member.leavePeriod !== null &&
                           member.leavePeriod !== '';
            return hasJoin || hasLeave;
        }

        function flatPeriodToString(value) {
            if (value === undefined || value === null) {
                return '';
            }
            return String(value);
        }

        for (var i = 0; i < data.teams.length; i++) {
            var team = data.teams[i];
            if (!team || typeof team !== 'object' || Array.isArray(team)) {
                continue;
            }
            if (!Array.isArray(team.members)) {
                continue;
            }

            teamsProcessed++;

            for (var j = 0; j < team.members.length; j++) {
                var member = team.members[j];
                if (!member || typeof member !== 'object' || Array.isArray(member)) {
                    malformedMembersSkipped++;
                    continue;
                }

                membersSeen++;

                // ---- Step 1: reshape flat fields into intervals ----
                if (Array.isArray(member.intervals)) {
                    // Defensive: shape already present. Leave alone.
                    membersAlreadyIntervals++;
                } else if (hasFlatPeriodField(member)) {
                    // Wrap the flat fields into a single interval.
                    var joinStr = flatPeriodToString(member.joinPeriod);
                    var leaveStr = flatPeriodToString(member.leavePeriod);
                    member.intervals = [
                        { joinPeriod: joinStr, leavePeriod: leaveStr }
                    ];
                    delete member.joinPeriod;
                    delete member.leavePeriod;
                    membersMigrated++;
                } else {
                    // No flat fields, no intervals. Give it an empty
                    // intervals array so downstream code has a
                    // consistent shape. The UI surfaces this.
                    member.intervals = [];
                    delete member.joinPeriod;
                    delete member.leavePeriod;
                    membersBecameEmpty++;
                }

                // ---- Step 2: ensure a memberId ----
                var hasMemberId =
                    member.memberId !== undefined &&
                    member.memberId !== null &&
                    String(member.memberId).trim() !== '';

                if (!hasMemberId) {
                    member.memberId = generateMemberId();
                    memberIdsGenerated++;
                }
            }
        }

        console.log(
            '[Database] v24: member intervals refactor complete. ' +
            'Teams processed: ' + teamsProcessed + '. ' +
            'Members seen: ' + membersSeen + '. ' +
            'Reshaped from flat fields: ' + membersMigrated + '. ' +
            'Already had intervals (skipped): ' + membersAlreadyIntervals + '. ' +
            'Became empty-interval entries: ' + membersBecameEmpty + '. ' +
            'MemberIds generated: ' + memberIdsGenerated + '. ' +
            'Malformed members skipped: ' + malformedMembersSkipped + '.'
        );

        data._dataVersion = 24;
    }

    // ============================================================
    // NORMALISE DATA STRUCTURE
    // ============================================================

    function normaliseDataStructure(data) {
        var repaired = false;

        if (!Array.isArray(data.tournaments)) { data.tournaments = []; repaired = true; }
        if (!Array.isArray(data.characters)) { data.characters = []; repaired = true; }
        if (!Array.isArray(data.teams)) { data.teams = []; repaired = true; }
        if (!Array.isArray(data.missions)) { data.missions = []; repaired = true; }
        if (!Array.isArray(data.activities)) { data.activities = []; repaired = true; }
        if (!Array.isArray(data.classes)) { data.classes = []; repaired = true; }
        if (!Array.isArray(data.locations)) { data.locations = []; repaired = true; }

        if (data.locationSchedules !== undefined) {
            delete data.locationSchedules;
            repaired = true;
        }

        if (data.currentYear === undefined || data.currentYear === null) {
            data.currentYear = new Date().getFullYear();
            repaired = true;
        }
        if (data.currentWeek === undefined || data.currentWeek === null) {
            data.currentWeek = 1;
            repaired = true;
        }

        data.characters.forEach(function(char) {
            if (!Array.isArray(char.classIds)) { char.classIds = []; repaired = true; }
            if (!char.personality || typeof char.personality !== 'object' || Array.isArray(char.personality)) {
                char.personality = {};
                repaired = true;
            }
            if (!char.specialMoves || typeof char.specialMoves !== 'object' || Array.isArray(char.specialMoves)) {
                char.specialMoves = { physical: [], magical: [] };
                repaired = true;
            } else {
                if (!Array.isArray(char.specialMoves.physical)) {
                    char.specialMoves.physical = [];
                    repaired = true;
                }
                if (!Array.isArray(char.specialMoves.magical)) {
                    char.specialMoves.magical = [];
                    repaired = true;
                }
            }
            if (char.attraction === undefined) { char.attraction = ''; repaired = true; }
            if (char.sexuality === undefined) { char.sexuality = ''; repaired = true; }

            if (typeof char.hp !== 'number' || isNaN(char.hp) || char.hp < 0) {
                char.hp = 0;
                repaired = true;
            }
            if (typeof char.mp !== 'number' || isNaN(char.mp) || char.mp < 0) {
                char.mp = 0;
                repaired = true;
            }
            if (typeof char.combatNotes !== 'string') {
                char.combatNotes = '';
                repaired = true;
            }
            if (!Array.isArray(char.weapons)) {
                char.weapons = [];
                repaired = true;
            } else {
                var needsWeaponRepair = false;
                char.weapons.forEach(function(w) {
                    if (!w || typeof w !== 'object') { needsWeaponRepair = true; return; }
                    if (typeof w.id !== 'string' || !w.id) { needsWeaponRepair = true; }
                    if (typeof w.name !== 'string') { needsWeaponRepair = true; }
                    if (typeof w.type !== 'string') { needsWeaponRepair = true; }
                    if (typeof w.notes !== 'string') { needsWeaponRepair = true; }
                });
                if (needsWeaponRepair) {
                    char.weapons = char.weapons.filter(function(w) {
                        return w && typeof w === 'object';
                    }).map(function(w) {
                        return {
                            id:    typeof w.id === 'string' && w.id ? w.id : ('weapon_' + Math.random().toString(36).slice(2, 10)),
                            name:  typeof w.name === 'string' ? w.name : '',
                            type:  typeof w.type === 'string' ? w.type : 'sharp',
                            notes: typeof w.notes === 'string' ? w.notes : ''
                        };
                    });
                    repaired = true;
                }
            }
        });

        data.teams.forEach(function(team) {
            if (team.type === 'academic' && team.classId === undefined) {
                team.classId = null;
                repaired = true;
            }
            if (team.teamNumber === undefined) {
                team.teamNumber = '';
                repaired = true;
            }
        });

        if (!data.curriculum || typeof data.curriculum !== 'object' || Array.isArray(data.curriculum)) {
            data.curriculum = getDefaultCurriculumData();
            repaired = true;
        } else {
            if (data.curriculum.schedules !== undefined) { delete data.curriculum.schedules; repaired = true; }
            if (data.curriculum.locationSchedules !== undefined) { delete data.curriculum.locationSchedules; repaired = true; }
            if (data.curriculum.metadata !== undefined) { delete data.curriculum.metadata; repaired = true; }
            data.curriculum = deepMergeDefaults(data.curriculum, getDefaultCurriculumData());
            repaired = true;
        }

        if (!data.social || typeof data.social !== 'object' || Array.isArray(data.social)) {
            data.social = getDefaultSocialData();
            repaired = true;
        } else {
            data.social = deepMergeDefaults(data.social, getDefaultSocialData());
            repaired = true;
        }

        if (!data.statsConfig || typeof data.statsConfig !== 'object' || Array.isArray(data.statsConfig)) {
            data.statsConfig = getDefaultStatsConfig();
            repaired = true;
        } else {
            data.statsConfig = deepMergeDefaults(data.statsConfig, getDefaultStatsConfig());
            repaired = true;
        }

        if (!data.academy || typeof data.academy !== 'object' || Array.isArray(data.academy)) {
            data.academy = getDefaultAcademyData();
            repaired = true;
        } else {
            data.academy = deepMergeDefaults(data.academy, getDefaultAcademyData());
            repaired = true;

            if (data.academy.classStudents !== undefined) {
                delete data.academy.classStudents;
                repaired = true;
            }
        }

        if (!data.academy.classDisciplines || typeof data.academy.classDisciplines !== 'object' || Array.isArray(data.academy.classDisciplines)) {
            data.academy.classDisciplines = {};
            repaired = true;
        }
        if (!data.academy.teachingGroups || typeof data.academy.teachingGroups !== 'object' || Array.isArray(data.academy.teachingGroups)) {
            data.academy.teachingGroups = {};
            repaired = true;
        }
        if (!data.academy.teachingGroupSequences || typeof data.academy.teachingGroupSequences !== 'object' || Array.isArray(data.academy.teachingGroupSequences)) {
            data.academy.teachingGroupSequences = {};
            repaired = true;
        }
        if (!data.academy.teachingSessions || typeof data.academy.teachingSessions !== 'object' || Array.isArray(data.academy.teachingSessions)) {
            data.academy.teachingSessions = {};
            repaired = true;
        }

        // v22 shape guard: weekly-team records must not carry members.
        if (data.academy.weeklyTeams &&
            typeof data.academy.weeklyTeams === 'object' &&
            !Array.isArray(data.academy.weeklyTeams)) {
            Object.keys(data.academy.weeklyTeams).forEach(function(classId) {
                var byClass = data.academy.weeklyTeams[classId];
                if (!byClass || typeof byClass !== 'object' || Array.isArray(byClass)) return;
                Object.keys(byClass).forEach(function(teamId) {
                    var record = byClass[teamId];
                    if (!record || typeof record !== 'object' || Array.isArray(record)) return;
                    if (record.members !== undefined) {
                        delete record.members;
                        repaired = true;
                    }
                });
            });
        }

        // v24 shape guard: every team member entry must have an
        // intervals array and a memberId. This catches data that
        // somehow bypassed the migration (e.g. was created by a
        // pre-v24 build and then loaded with the new code without a
        // version bump, or was directly injected by an import).
        data.teams.forEach(function(team) {
            if (!team || typeof team !== 'object') return;
            if (!Array.isArray(team.members)) return;

            for (var i = 0; i < team.members.length; i++) {
                var member = team.members[i];
                if (!member || typeof member !== 'object' || Array.isArray(member)) {
                    continue;
                }

                if (!Array.isArray(member.intervals)) {
                    // Reshape flat fields if present, else empty array.
                    var joinStr = (member.joinPeriod !== undefined && member.joinPeriod !== null)
                        ? String(member.joinPeriod) : '';
                    var leaveStr = (member.leavePeriod !== undefined && member.leavePeriod !== null)
                        ? String(member.leavePeriod) : '';
                    if (joinStr !== '' || leaveStr !== '') {
                        member.intervals = [{ joinPeriod: joinStr, leavePeriod: leaveStr }];
                    } else {
                        member.intervals = [];
                    }
                    delete member.joinPeriod;
                    delete member.leavePeriod;
                    repaired = true;
                }

                if (member.memberId === undefined ||
                    member.memberId === null ||
                    String(member.memberId).trim() === '') {
                    member.memberId = 'mem_' + Date.now() + '_' +
                        Math.random().toString(36).slice(2, 8);
                    repaired = true;
                }
            }
        });

        var validClassIds = Object.create(null);
        Object.keys(data.academy.graduatingClasses).forEach(function(id) {
            validClassIds[id] = true;
        });

        var prunedClassRefs = 0;
        data.characters.forEach(function(char) {
            if (!Array.isArray(char.classIds)) return;
            var before = char.classIds.length;
            char.classIds = char.classIds.filter(function(id) {
                return validClassIds[id] === true;
            });
            if (char.classIds.length !== before) {
                prunedClassRefs += (before - char.classIds.length);
                repaired = true;
            }
        });

        if (prunedClassRefs > 0) {
            console.warn(
                '[Database] normaliseDataStructure pruned ' + prunedClassRefs +
                ' orphaned classId reference(s).'
            );
        }

        if (data.academy.weeklyTeams && typeof data.academy.weeklyTeams === 'object') {
            Object.keys(data.academy.weeklyTeams).forEach(function(classId) {
                if (!validClassIds[classId]) {
                    delete data.academy.weeklyTeams[classId];
                    repaired = true;
                }
            });
        }

        function pruneByClassId(storeName) {
            var store = data.academy[storeName];
            if (!store || typeof store !== 'object') return;
            Object.keys(store).forEach(function(recordId) {
                var record = store[recordId];
                if (!record || typeof record !== 'object') return;
                if (record.classId && !validClassIds[record.classId]) {
                    delete store[recordId];
                    repaired = true;
                }
            });
        }
        pruneByClassId('grades');
        pruneByClassId('rankings');

        function pruneClassBucket(storeName) {
            var store = data.academy[storeName];
            if (!store || typeof store !== 'object') return;
            Object.keys(store).forEach(function(classId) {
                if (!validClassIds[classId]) {
                    delete store[classId];
                    repaired = true;
                }
            });
        }
        pruneClassBucket('enrolments');
        pruneClassBucket('socialScores');
        pruneClassBucket('classDisciplines');

        return repaired;
    }

    // ============================================================
    // CREATE SAFE COPY
    // ============================================================

    function createSafeCopy(data) {
        if (data === null || typeof data !== 'object') {
            throw new Error('Cannot clone non-object data');
        }
        if (typeof structuredClone !== 'function') {
            throw new Error('This browser does not support structuredClone().');
        }
        return structuredClone(data);
    }

    // ============================================================
    // LOAD DATA
    // ============================================================

    function loadData() {
        if (_loadPromise) return _loadPromise;

        _loadError = null;
        _loadPromise = new Promise(function(resolve, reject) {
            if (!_indexedDB || _dbStatus !== 'ready') {
                var error = new Error('Database not available');
                _loadError = error;
                _loadPromise = null;
                reject(error);
                return;
            }
            doLoadData(resolve, reject);
        });

        return _loadPromise;
    }

    function doLoadData(resolve, reject) {
        try {
            var transaction = _indexedDB.transaction([STORE_NAME], 'readonly');
            var store = transaction.objectStore(STORE_NAME);
            var request = store.get('mainData');

            request.onsuccess = function() {
                try {
                    var dataLoaded = false;

                    if (request.result && request.result.data) {
                        _data = createSafeCopy(request.result.data);
                        dataLoaded = true;
                    }

                    if (!dataLoaded) {
                        _data = getEmptyData();
                    }

                    var originalVersion = migrateData(_data);
                    var repaired = normaliseDataStructure(_data);

                    window.data = _data;

                    var needsPersistence = false;
                    if (originalVersion !== undefined && originalVersion !== _data._dataVersion) {
                        needsPersistence = true;
                    }
                    if (repaired) {
                        needsPersistence = true;
                    }

                    var migrationPromise = Promise.resolve();
                    if (needsPersistence) {
                        migrationPromise = saveData();
                    }

                    migrationPromise
                        .then(function() {
                            _loadPromise = null;
                            resolve(_data);
                        })
                        .catch(function(err) {
                            _loadError = err;
                            _loadPromise = null;
                            reject(err);
                        });

                } catch (err) {
                    _loadError = err;
                    _loadPromise = null;
                    reject(err);
                }
            };
            request.onerror = function(event) {
                _loadError = event.target.error;
                _loadPromise = null;
                reject(event.target.error);
            };
            transaction.onerror = function(event) {
                _loadError = event.target.error;
                _loadPromise = null;
                reject(event.target.error);
            };
            transaction.onabort = function(event) {
                _loadError = event.target.error || new Error('IndexedDB transaction aborted');
                _loadPromise = null;
                reject(_loadError);
            };
        } catch (err) {
            _loadError = err;
            _loadPromise = null;
            reject(err);
        }
    }

    // ============================================================
    // SAVE DATA
    // ============================================================

    function saveData() {
        return new Promise(function(resolve, reject) {
            _saveWaiters.push({ resolve: resolve, reject: reject });
            processSaveQueue();
        });
    }

    function processSaveQueue() {
        if (_isSaving || _saveWaiters.length === 0) return;

        _isSaving = true;
        var currentWaiters = _saveWaiters;
        _saveWaiters = [];

        performSave()
            .then(function() {
                _isSaving = false;
                currentWaiters.forEach(function(waiter) {
                    try { waiter.resolve(true); } catch (err) {}
                });
                if (_saveWaiters.length > 0) processSaveQueue();
            })
            .catch(function(err) {
                _isSaving = false;
                currentWaiters.forEach(function(waiter) {
                    try { waiter.reject(err); } catch (rejectErr) {}
                });
                if (_saveWaiters.length > 0) processSaveQueue();
            });
    }

    function performSave() {
        return new Promise(function(resolve, reject) {
            if (!_indexedDB || _dbStatus !== 'ready') {
                reject(new Error('Database not available'));
                return;
            }

            var settled = false;
            function succeed() { if (settled) return; settled = true; resolve(); }
            function fail(error) {
                if (settled) return;
                settled = true;
                _dispatchSaveFailure(error);
                reject(error);
            }

            try {
                var sourceData = _data;
                if (!sourceData) {
                    sourceData = getEmptyData();
                }

                window.data = sourceData;
                _data = sourceData;

                normaliseDataStructure(sourceData);
                var safeData = createSafeCopy(sourceData);

                var transaction = _indexedDB.transaction([STORE_NAME], 'readwrite');
                var store = transaction.objectStore(STORE_NAME);
                var record = {
                    id: 'mainData',
                    data: safeData,
                    updatedAt: new Date().toISOString()
                };
                var request = store.put(record);

                transaction.oncomplete = function() { succeed(); };
                transaction.onerror = function(event) { fail(event.target.error); };
                transaction.onabort = function(event) {
                    fail(event.target.error || new Error('IndexedDB transaction aborted'));
                };
                request.onerror = function(event) { fail(event.target.error); };
            } catch (err) {
                fail(err);
            }
        });
    }

    // ============================================================
    // SAVE FAILURE DISPATCH
    // ============================================================

    function _dispatchSaveFailure(error) {
        if (typeof window.dispatchEvent === 'function') {
            try {
                var event = new CustomEvent('dataSaveFailed', {
                    detail: { error: error },
                    bubbles: false,
                    cancelable: false
                });
                window.dispatchEvent(event);
            } catch (e) {}
        }
    }

    // ============================================================
    // AUTO LOAD
    // ============================================================

    function autoLoadData() {
        if (window.data && window.data === _data) {
            _dispatchDataReady(window.data);
            return Promise.resolve(window.data);
        }

        return loadData()
            .then(function(result) {
                if (result) _dispatchDataReady(result);
                return result;
            })
            .catch(function(err) {
                _loadError = err;
                _dispatchDataFailure(err);
                throw err;
            });
    }

    // ============================================================
    // DATA READY / FAILURE DISPATCH
    // ============================================================

    function _dispatchDataReady(data) {
        if (_dataReadyDispatched) return;
        _dataReadyDispatched = true;

        setTimeout(function() {
            var event = new CustomEvent('dataReady', {
                detail: { data: data, status: 'ready' },
                bubbles: false,
                cancelable: false
            });
            document.dispatchEvent(event);
        }, 10);
    }

    function _dispatchDataFailure(err) {
        if (_dataReadyDispatched) return;
        _dataReadyDispatched = true;

        setTimeout(function() {
            var event = new CustomEvent('dataReady', {
                detail: { data: null, status: 'failed', error: err },
                bubbles: false,
                cancelable: false
            });
            document.dispatchEvent(event);
        }, 10);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.db = {
        openDatabase: openDatabase,
        ensureDatabaseReady: ensureDatabaseReady,
        loadData: loadData,
        saveData: saveData,
        getEmptyData: getEmptyData,
        getDefaultMagicProficiencies: getDefaultMagicProficiencies,
        autoLoadData: autoLoadData,
        createSafeCopy: createSafeCopy,
        getDatabaseStatus: getDatabaseStatus,
        isDatabaseReady: isDatabaseReady,
        getLoadError: getLoadError,
        deleteDatabase: deleteDatabase
    };

    window.loadData = loadData;
    window.saveData = saveData;
    window.getEmptyData = getEmptyData;
    window.getDefaultMagicProficiencies = getDefaultMagicProficiencies;

    // ============================================================
    // INITIALIZE
    // ============================================================

    ensureDatabaseReady()
        .then(function() { return autoLoadData(); })
        .catch(function(err) {
            _loadError = err;
            _dispatchDataFailure(err);
        });

})();
