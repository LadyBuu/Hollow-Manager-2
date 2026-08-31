/**
 * js/core/database.js - IndexedDB Operations
 * Path: js/core/database.js
 * 
 * This module handles all IndexedDB persistence operations with:
 * - Safe migration system
 * - Coalescing save queue (pending saves are batched)
 * - Proper error handling with events
 * - Data cloning to prevent reference issues
 * - Status tracking for UI feedback
 * 
 * PERSISTENCE CONTRACT:
 * - saveData() returns a Promise that resolves to true on success
 * - Save failures dispatch 'dataSaveFailed' events
 * - All mutations are applied to window.data in memory
 * - Persistence is explicitly triggered by callers
 * 
 * SAVE QUEUE SEMANTICS:
 * - Multiple saves requested while one is in progress are coalesced
 * - Waiters are frozen at the start of each save operation
 * - All waiters in the batch share the result of that save
 * - New waiters arriving during a save belong to the next save
 * - This prevents "saved successfully" responses for unsaved data
 * 
 * SNAPSHOT SEMANTICS:
 * - saveData() persists a snapshot of the current in-memory state
 * - The snapshot is taken when the save operation actually begins
 * - Mutations made after saveData() is called but before the snapshot
 *   may be included in the saved state. This is intentional and matches
 *   typical client-side persistence patterns.
 * - Callers should ensure their mutation is complete before calling saveData()
 *   if they require precise transaction boundaries.
 * 
 * DATA VERSION HISTORY:
 * - Version 1: Initial character data
 * - Version 2: Added careerStatus, eliminatedWeeks, eliminations, name fields
 * - Version 3: Added stats and magic proficiencies
 * - Version 4: Added team fields (nameHistory, rankingHistory, members, status, etc.)
 * - Version 5: Added team member role, joinPeriod, leavePeriod
 * - Version 6: Added tournament fields
 * - Version 7: Added mission fields
 * - Version 8: Added curriculum data
 * - Version 9: Added social data
 * - Version 10: Added classes, locations, locationSchedules, classLocations
 * - Version 11: Added statsConfig
 * - Version 12: Added personality and specialMoves to characters
 * - Version 13: Added attraction and sexuality to characters
 */

(function() {
    'use strict';

    var DB_NAME = 'HollowBladesDB';
    var DB_VERSION = 13; // Updated from 1 to 13 to match existing database
    var DATA_VERSION = 13;
    var STORE_NAME = 'appData';

    // INTERNAL: The actual IndexedDB connection (private)
    var _indexedDB = null;
    var _data = null;
    var _dbOpenPromise = null;
    var _dbInitPromise = null;
    var _loadPromise = null;
    var _dataReadyDispatched = false;
    var _dbStatus = 'uninitialized';
    var _loadError = null;

    // Save queue state - coalescing with frozen batches
    var _isSaving = false;
    var _saveWaiters = [];

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
            locationSchedules: {},
            currentYear: new Date().getFullYear(),
            currentWeek: 1,
            curriculum: getDefaultCurriculumData(),
            social: getDefaultSocialData(),
            statsConfig: getDefaultStatsConfig()
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
                console.error('Database: structuredClone failed:', e);
                return null;
            }
        }

        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            console.error('Database: JSON clone failed:', e);
            return null;
        }
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
                    _dbStatus = 'failed';
                    reject(error);
                };
                
                request.onblocked = function() {
                    console.warn('IndexedDB open blocked. Another tab may have the database open.');
                };
                
                request.onsuccess = function(event) {
                    _indexedDB = event.target.result;
                    _dbOpenPromise = null;
                    _dbStatus = 'ready';
                    
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

    function getDatabaseStatus() {
        return _dbStatus;
    }

    function isDatabaseReady() {
        return _dbStatus === 'ready' && _indexedDB !== null;
    }

    function getLoadError() {
        return _loadError;
    }

    // ============================================================
    // ENSURE DATABASE READY
    // ============================================================

    function ensureDatabaseReady() {
        if (_dbInitPromise) {
            return _dbInitPromise;
        }
        
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
    // ENSURE MIGRATION BASE STRUCTURE
    // ============================================================

    function ensureMigrationBaseStructure(data) {
        if (!Array.isArray(data.characters)) data.characters = [];
        if (!Array.isArray(data.teams)) data.teams = [];
        if (!Array.isArray(data.tournaments)) data.tournaments = [];
        if (!Array.isArray(data.missions)) data.missions = [];
    }

    // ============================================================
    // DATA MIGRATION - VERSIONED
    // ============================================================

    function migrateData(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error('Invalid database data format');
        }

        ensureMigrationBaseStructure(data);

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
                case 1:
                    migrateToVersion2(data);
                    break;
                case 2:
                    migrateToVersion3(data);
                    break;
                case 3:
                    migrateToVersion4(data);
                    break;
                case 4:
                    migrateToVersion5(data);
                    break;
                case 5:
                    migrateToVersion6(data);
                    break;
                case 6:
                    migrateToVersion7(data);
                    break;
                case 7:
                    migrateToVersion8(data);
                    break;
                case 8:
                    migrateToVersion9(data);
                    break;
                case 9:
                    migrateToVersion10(data);
                    break;
                case 10:
                    migrateToVersion11(data);
                    break;
                case 11:
                    migrateToVersion12(data);
                    break;
                case 12:
                    migrateToVersion13(data);
                    break;
                default:
                    data._dataVersion = DATA_VERSION;
                    break;
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
            if (char.attraction === undefined) {
                char.attraction = '';
            }
            if (char.sexuality === undefined) {
                char.sexuality = '';
            }
        });
        data._dataVersion = 13;
    }

    // ============================================================
    // ENSURE DATA STRUCTURE - Tracks repairs
    // ============================================================

    function ensureDataStructure(data) {
        var repaired = false;

        if (!Array.isArray(data.tournaments)) { data.tournaments = []; repaired = true; }
        if (!Array.isArray(data.characters)) { data.characters = []; repaired = true; }
        if (!Array.isArray(data.teams)) { data.teams = []; repaired = true; }
        if (!Array.isArray(data.missions)) { data.missions = []; repaired = true; }
        if (!Array.isArray(data.activities)) { data.activities = []; repaired = true; }
        if (!Array.isArray(data.classes)) { data.classes = []; repaired = true; }
        if (!Array.isArray(data.locations)) { data.locations = []; repaired = true; }
        if (!data.locationSchedules || typeof data.locationSchedules !== 'object') { 
            data.locationSchedules = {}; 
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
            if (char.attraction === undefined) {
                char.attraction = '';
                repaired = true;
            }
            if (char.sexuality === undefined) {
                char.sexuality = '';
                repaired = true;
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
            var curriculumDefaults = getDefaultCurriculumData();
            var mergedCurriculum = deepMergeDefaults(data.curriculum, curriculumDefaults);
            for (var key in curriculumDefaults) {
                if (data.curriculum[key] === undefined) {
                    repaired = true;
                    break;
                }
            }
            data.curriculum = mergedCurriculum;
        }

        if (!data.social || typeof data.social !== 'object' || Array.isArray(data.social)) {
            data.social = getDefaultSocialData();
            repaired = true;
        } else {
            var socialDefaults = getDefaultSocialData();
            var mergedSocial = deepMergeDefaults(data.social, socialDefaults);
            for (var key in socialDefaults) {
                if (data.social[key] === undefined) {
                    repaired = true;
                    break;
                }
            }
            data.social = mergedSocial;
        }

        if (!data.statsConfig || typeof data.statsConfig !== 'object' || Array.isArray(data.statsConfig)) {
            data.statsConfig = getDefaultStatsConfig();
            repaired = true;
        } else {
            var statsDefaults = getDefaultStatsConfig();
            var mergedStats = deepMergeDefaults(data.statsConfig, statsDefaults);
            for (var key in statsDefaults) {
                if (data.statsConfig[key] === undefined) {
                    repaired = true;
                    break;
                }
            }
            data.statsConfig = mergedStats;
        }

        return repaired;
    }

    // ============================================================
    // SAFE CLONE
    // ============================================================

    function createSafeCopy(data) {
        if (typeof structuredClone !== 'function') {
            throw new Error('This browser does not support structuredClone().');
        }
        try {
            return structuredClone(data);
        } catch (err) {
            throw err;
        }
    }

    // ============================================================
    // LOAD DATA
    // ============================================================

    function loadData() {
        if (_loadPromise) {
            return _loadPromise;
        }

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
                    var repaired = ensureDataStructure(_data);
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
    // SAVE DATA - Coalescing queue with frozen batches
    // ============================================================

    function saveData() {
        return new Promise(function(resolve, reject) {
            _saveWaiters.push({
                resolve: resolve,
                reject: reject
            });
            processSaveQueue();
        });
    }

    function processSaveQueue() {
        if (_isSaving || _saveWaiters.length === 0) {
            return;
        }

        _isSaving = true;

        var currentWaiters = _saveWaiters;
        _saveWaiters = [];

        performSave()
            .then(function() {
                _isSaving = false;

                currentWaiters.forEach(function(waiter) {
                    try {
                        waiter.resolve(true);
                    } catch (err) {
                        console.error('Error resolving save waiter:', err);
                    }
                });

                if (_saveWaiters.length > 0) {
                    processSaveQueue();
                }
            })
            .catch(function(err) {
                _isSaving = false;

                currentWaiters.forEach(function(waiter) {
                    try {
                        waiter.reject(err);
                    } catch (rejectErr) {
                        console.error('Error rejecting save waiter:', rejectErr);
                    }
                });

                if (_saveWaiters.length > 0) {
                    processSaveQueue();
                }
            });
    }

    function performSave() {
        return new Promise(function(resolve, reject) {
            if (!_indexedDB || _dbStatus !== 'ready') {
                reject(new Error('Database not available'));
                return;
            }

            var settled = false;

            function succeed() {
                if (settled) return;
                settled = true;
                resolve();
            }

            function fail(error) {
                if (settled) return;
                settled = true;
                _dispatchSaveFailure(error);
                reject(error);
            }

            try {
                var sourceData = window.data || _data;

                if (!sourceData) {
                    sourceData = getEmptyData();
                }

                window.data = sourceData;
                _data = sourceData;

                ensureDataStructure(sourceData);
                var safeData = createSafeCopy(sourceData);

                var transaction = _indexedDB.transaction([STORE_NAME], 'readwrite');
                var store = transaction.objectStore(STORE_NAME);
                var record = {
                    id: 'mainData',
                    data: safeData,
                    updatedAt: new Date().toISOString()
                };
                var request = store.put(record);

                transaction.oncomplete = function() {
                    succeed();
                };

                transaction.onerror = function(event) {
                    var error = event.target.error;
                    fail(error);
                };

                transaction.onabort = function(event) {
                    var error = event.target.error || new Error('IndexedDB transaction aborted');
                    fail(error);
                };

                request.onerror = function(event) {
                    var error = event.target.error;
                    fail(error);
                };
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
            } catch (e) {
                // Ignore event dispatch errors
            }
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
                if (result) {
                    _dispatchDataReady(result);
                }
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
    // EXPOSE GLOBALS
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
        getLoadError: getLoadError
    };

    window.loadData = loadData;
    window.saveData = saveData;
    window.getEmptyData = getEmptyData;
    window.getDefaultMagicProficiencies = getDefaultMagicProficiencies;

    // ============================================================
    // INITIALIZE - SEQUENTIAL STARTUP
    // ============================================================

    ensureDatabaseReady()
        .then(function() {
            return autoLoadData();
        })
        .catch(function(err) {
            _loadError = err;
            _dispatchDataFailure(err);
        });

})();
