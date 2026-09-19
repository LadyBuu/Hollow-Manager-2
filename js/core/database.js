/**
 * js/core/database.js - IndexedDB Operations
 * Path: js/core/database.js
 *
 * DATA_VERSION: 29
 *
 * Version history (one line per version; the full narrative for each
 * lives on its migration function, or has been dropped once stable):
 *   23 — Repair legacy tournaments; backfill weekly-team windows.
 *   24 — Member intervals refactor (flat fields → intervals array).
 *   25 — Year-scoped eliminations.
 *   26 — Discipline record-shape canonicalisation.
 *   27 — Class-discipline marker-only store; character mode;
 *        instructor retirement (discipline- and class-discipline-level).
 *   28 — Stats-config icon normalisation (emoji → monochrome).
 *   29 — Class-level instructorId retirement.
 *
 * RETIRED FIELDS (one line each):
 *   v23  tournament.winner, tournament.currentRound, tournament.teams,
 *        tournament.matches, tournament.winners, match.winner,
 *        match.loser, match.advancing
 *   v26  discipline.curriculum, discipline.maxStudents,
 *        discipline.gradingSystem, discipline.instructorId
 *   v27  discipline.instructorIds, classDiscipline.startWeek,
 *        classDiscipline.endWeek, classDiscipline.weeklyHours,
 *        classDiscipline.weight, classDiscipline.gradeSchemeId,
 *        classDiscipline.assessmentWeights, classDiscipline.instructorIds
 *   v28  legacy stats-config emoji icons (⚔ 🏹 🛡 📚 🗡 ⚡ ⚙ ✦)
 *   v29  class.instructorId
 */

(function() {
    'use strict';

    var DB_NAME = 'HollowBladesDB';
    var DB_VERSION = 1;
    var DATA_VERSION = 29;
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

    /**
     * Default stats configuration.
     *
     * ICONS (v28): the icons are monochrome Unicode glyphs. They were
     * previously emoji. The v28 migration rewrites any persisted
     * record still carrying one of the legacy emoji. New configs
     * emitted by this factory are already monochrome.
     */
    function getDefaultStatsConfig() {
        return {
            classes: [
                { id: 'warrior', label: 'Warrior', icon: '\u2020', primaryStats: ['str', 'con'], secondaryStats: ['dex'], statWeights: { str: 0.4, con: 0.3, dex: 0.2, wis: 0.1 }, minStats: { str: 13, con: 12 } },
                { id: 'skirmisher', label: 'Skirmisher', icon: '\u27b6', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'str'], statWeights: { dex: 0.35, wis: 0.25, con: 0.2, str: 0.15, int: 0.05 }, minStats: { dex: 13, wis: 12 } },
                { id: 'protector', label: 'Protector', icon: '\u25c8', primaryStats: ['str', 'con'], secondaryStats: ['wis', 'cha'], statWeights: { str: 0.3, con: 0.3, wis: 0.2, cha: 0.15, dex: 0.05 }, minStats: { str: 13, con: 12 } },
                { id: 'sage', label: 'Sage', icon: '\u25a4', primaryStats: ['int', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { int: 0.35, wis: 0.25, con: 0.2, dex: 0.15, cha: 0.05 }, minStats: { int: 13, wis: 12 } },
                { id: 'mystic', label: 'Mystic', icon: '\u2727', primaryStats: ['wis', 'cha'], secondaryStats: ['con', 'int'], statWeights: { wis: 0.35, cha: 0.25, con: 0.2, int: 0.15, dex: 0.05 }, minStats: { wis: 13, cha: 12 } },
                { id: 'stalker', label: 'Stalker', icon: '\u2020', primaryStats: ['dex', 'int'], secondaryStats: ['cha', 'wis'], statWeights: { dex: 0.35, int: 0.25, cha: 0.2, wis: 0.15, str: 0.05 }, minStats: { dex: 13, int: 12 } },
                { id: 'spellblade', label: 'Spellblade', icon: '\u2301', primaryStats: ['str', 'int'], secondaryStats: ['dex', 'con'], statWeights: { str: 0.3, int: 0.3, dex: 0.2, con: 0.15, wis: 0.05 }, minStats: { str: 13, int: 12 } },
                { id: 'channeler', label: 'Channeler', icon: '\u2727', primaryStats: ['cha', 'con'], secondaryStats: ['dex', 'int'], statWeights: { cha: 0.35, con: 0.25, dex: 0.2, int: 0.15, wis: 0.05 }, minStats: { cha: 13, con: 12 } },
                { id: 'warden', label: 'Warden', icon: '\u2020', primaryStats: ['str', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { str: 0.3, wis: 0.25, con: 0.2, dex: 0.2, cha: 0.05 }, minStats: { str: 13, wis: 12 } },
                { id: 'adept', label: 'Adept', icon: '\u2727', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'str'], statWeights: { dex: 0.3, wis: 0.3, con: 0.2, str: 0.15, int: 0.05 }, minStats: { dex: 13, wis: 13 } },
                { id: 'artificer', label: 'Artificer', icon: '\u2731', primaryStats: ['int', 'dex'], secondaryStats: ['con', 'wis'], statWeights: { int: 0.35, dex: 0.25, con: 0.2, wis: 0.15, cha: 0.05 }, minStats: { int: 13, dex: 12 } },
                { id: 'occultist', label: 'Occultist', icon: '\u2727', primaryStats: ['int', 'cha'], secondaryStats: ['con', 'dex'], statWeights: { int: 0.3, cha: 0.3, con: 0.2, dex: 0.15, wis: 0.05 }, minStats: { int: 13, cha: 13 } },
                { id: 'blade_dancer', label: 'Blade Dancer', icon: '\u2020', primaryStats: ['dex', 'cha'], secondaryStats: ['str', 'con'], statWeights: { dex: 0.35, cha: 0.25, str: 0.2, con: 0.15, wis: 0.05 }, minStats: { dex: 13, cha: 12 } },
                { id: 'elementalist', label: 'Elementalist', icon: '\u2727', primaryStats: ['int', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { int: 0.35, wis: 0.25, con: 0.2, dex: 0.15, cha: 0.05 }, minStats: { int: 13, wis: 12 } },
                { id: 'sentinel', label: 'Sentinel', icon: '\u25c8', primaryStats: ['str', 'con'], secondaryStats: ['wis', 'dex'], statWeights: { str: 0.3, con: 0.3, wis: 0.2, dex: 0.15, cha: 0.05 }, minStats: { str: 13, con: 12 } }
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
    //
    // deepMergeDefaults returns:
    //   {
    //     merged:  the merged value,
    //     changed: true when any key was added or any nested merge
    //              reported a change. false when the input already
    //              contained every key the defaults would have
    //              contributed, with identical leaf values.
    //   }
    //
    // This shape is what lets normaliseDataStructure decide whether
    // to set repaired = true. Prior to this change, every whole-store
    // merge flipped the flag unconditionally, which made every load
    // persist to IndexedDB regardless of whether anything changed.

    function deepMergeDefaults(target, defaults) {
        // Primitives or arrays: the target wins unchanged.
        if (!target || typeof target !== 'object' || Array.isArray(target)) {
            if (target === undefined) {
                return { merged: defaults, changed: true };
            }
            return { merged: target, changed: false };
        }

        if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
            return { merged: target, changed: false };
        }

        var result = {};
        var changed = false;
        var keys = Object.keys(defaults);

        keys.forEach(function(key) {
            if (target[key] === undefined) {
                result[key] = deepClone(defaults[key]);
                changed = true;
            } else if (
                target[key] &&
                typeof target[key] === 'object' &&
                !Array.isArray(target[key]) &&
                defaults[key] &&
                typeof defaults[key] === 'object' &&
                !Array.isArray(defaults[key])
            ) {
                var nested = deepMergeDefaults(target[key], defaults[key]);
                result[key] = nested.merged;
                if (nested.changed) { changed = true; }
            } else {
                result[key] = target[key];
            }
        });

        // Preserve target-only keys.
        Object.keys(target).forEach(function(key) {
            if (result[key] === undefined) {
                result[key] = target[key];
            }
        });

        return { merged: result, changed: changed };
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
                case 24: migrateToVersion25(data); break;
                case 25: migrateToVersion26(data); break;
                case 26: migrateToVersion27(data); break;
                case 27: migrateToVersion28(data); break;
                case 28: migrateToVersion29(data); break;
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

    /**
     * Version 25 migration — Year-scoped eliminations.
     *
     * WHY:
     *   Before v25, elimination records carried only a `week` (1-52).
     *   That was fine for tournament-internal ordering, but it was the
     *   wrong unit for the character list's "is this character
     *   eliminated?" filter. Weeks are relative to a year. Without a
     *   year, the filter either defaulted to week 1 (nothing ever
     *   filtered) or was ambiguous across year boundaries.
     *
     *   v25 adds a required integer `year` to every elimination record
     *   on every character. The year is the year the character was
     *   eliminated — the year of the class that ran the exam, or the
     *   year of the drop-out.
     *
     * SEMANTICS (going forward):
     *   An elimination at year Y means eliminated from year Y onward.
     *   A query "is this character eliminated as of year Y?" answers
     *   yes iff the character has an elimination record with
     *   `year <= Y`.
     *
     * RESOLUTION ORDER (backfill, existing records):
     *   1. If the elimination's `tournamentId` resolves to a tournament
     *      whose `graduatingClassId` resolves to a class with a numeric
     *      `year`, use that class's year.
     *   2. Otherwise, if the character is a member of exactly one class
     *      with a numeric `year`, use that class's year.
     *   3. Otherwise, fall back to `data.currentYear` (or the current
     *      calendar year if that is missing) and count the record as
     *      "unresolved".
     *
     * WHAT THIS MIGRATION DOES:
     *   - Adds `year` to every elimination record that lacks one.
     *   - Logs a summary count of resolved, unresolved, and skipped
     *     records.
     *
     * WHAT THIS MIGRATION DOES NOT DO:
     *   - It does NOT touch the `week` field. Week is retained as-is.
     *   - It does NOT re-derive eliminations from any other source.
     *   - It does NOT delete any elimination.
     *   - It does NOT touch tournament-side elimination records. Only
     *     character-side records carry a year; the tournament itself is
     *     year-scoped and its eliminations inherit that scope.
     *
     * @param {object} data
     */
    function migrateToVersion25(data) {
        if (!Array.isArray(data.characters)) {
            data._dataVersion = 25;
            return;
        }

        var fallbackYear;
        if (typeof data.currentYear === 'number' &&
            isFinite(data.currentYear) &&
            data.currentYear > 0) {
            fallbackYear = Math.floor(data.currentYear);
        } else {
            fallbackYear = new Date().getFullYear();
        }

        var classes = (data.academy && data.academy.graduatingClasses)
            ? data.academy.graduatingClasses
            : {};
        var tournaments = Array.isArray(data.tournaments) ? data.tournaments : [];

        function findClassYear(classId) {
            if (!classId) { return null; }
            var cls = classes[classId];
            if (!cls) { return null; }
            var y = parseInt(cls.year, 10);
            return isNaN(y) ? null : y;
        }

        function findTournamentYear(tournamentId) {
            if (!tournamentId) { return null; }
            for (var i = 0; i < tournaments.length; i++) {
                var t = tournaments[i];
                if (t && String(t.id) === String(tournamentId)) {
                    return findClassYear(t.graduatingClassId);
                }
            }
            return null;
        }

        function findSoleClassYearForCharacter(char) {
            var ids = Array.isArray(char.classIds) ? char.classIds : [];
            if (ids.length !== 1) { return null; }
            return findClassYear(ids[0]);
        }

        var resolvedFromTournament = 0;
        var resolvedFromSoleClass = 0;
        var resolvedFromFallback = 0;
        var alreadyPresent = 0;
        var recordsSeen = 0;

        for (var c = 0; c < data.characters.length; c++) {
            var char = data.characters[c];
            if (!char || !Array.isArray(char.eliminations)) { continue; }

            for (var e = 0; e < char.eliminations.length; e++) {
                var elim = char.eliminations[e];
                if (!elim || typeof elim !== 'object') { continue; }

                recordsSeen++;

                if (typeof elim.year === 'number' &&
                    isFinite(elim.year) &&
                    elim.year > 0) {
                    alreadyPresent++;
                    continue;
                }

                var resolved = null;
                var source = null;

                if (elim.tournamentId) {
                    resolved = findTournamentYear(elim.tournamentId);
                    if (resolved !== null) { source = 'tournament'; }
                }

                if (resolved === null) {
                    resolved = findSoleClassYearForCharacter(char);
                    if (resolved !== null) { source = 'sole-class'; }
                }

                if (resolved === null) {
                    resolved = fallbackYear;
                    source = 'fallback';
                }

                elim.year = resolved;

                if (source === 'tournament') { resolvedFromTournament++; }
                else if (source === 'sole-class') { resolvedFromSoleClass++; }
                else { resolvedFromFallback++; }
            }
        }

        console.log(
            '[Database] v25: year-scoped eliminations. ' +
            'Records seen: ' + recordsSeen + '. ' +
            'Already had year: ' + alreadyPresent + '. ' +
            'Resolved from tournament: ' + resolvedFromTournament + '. ' +
            'Resolved from sole class: ' + resolvedFromSoleClass + '. ' +
            'Fallback to currentYear: ' + resolvedFromFallback + '.'
        );

        if (resolvedFromFallback > 0) {
            console.warn(
                '[Database] v25: ' + resolvedFromFallback +
                ' elimination record(s) could not be resolved from their ' +
                'class context and were stamped with the fallback year (' +
                fallbackYear + '). Review if these records matter. ' +
                'The character list will filter them as eliminated for ' +
                'year ' + fallbackYear + ' and later.'
            );
        }

        data._dataVersion = 25;
    }

    /**
     * Version 26 migration — Discipline record-shape canonicalisation.
     *
     * WHY:
     *   Stored disciplines predate the current canonical shape
     *   written by AcademyDisciplines.create. They carry string-
     *   typed startWeek / endWeek fields, a set of retired fields
     *   from an earlier discipline model, and a legacy singular
     *   instructorId alongside the canonical instructorIds array.
     *
     *   The read path (AcademyDisciplines.getDiscipline →
     *   attachNormalizedConfig) normalises gradeScheme and
     *   assessmentWeights on read, but it does NOT coerce integer-
     *   typed fields and it does NOT strip retired fields. That is
     *   deliberate — the read path is display-facing, not a
     *   repair path.
     *
     *   The consequence is that the discipline editor's type
     *   checks — which test `typeof draft.startWeek === 'number'` —
     *   fail for string-typed weeks, and the editor falls back to
     *   its default (1). The canonical value is on disk but the     *   editor never sees it.
     *
     * STRICT MODE:
     *   Unparseable weeks are LEFT UNTOUCHED, LOGGED, and counted
     *   as malformed. No clamping. No record deletion. This is
     *   consistent with how migrateToVersion23 treats tournaments
     *   that cannot be normalised: preserve the record, surface
     *   the problem, let the caller decide.
     *
     *   A discipline with startWeek: "garbage" is a data-quality
     *   problem. Silently coercing it to MIN_WEEK would hide the
     *   problem. Silently deleting the record would destroy data.
     *   Neither is acceptable.
     *
     * WHAT THIS MIGRATION DOES:
     *   For every record in data.curriculum.disciplines[]:
     *     1. Coerce startWeek and endWeek from string to integer
     *        via CalendarValidation.parseWeek. Valid strings become
     *        integers. Invalid values are left in place and the
     *        record is counted as malformed.
     *     2. Delete retired fields: `curriculum`, `maxStudents`,
     *        `gradingSystem`, `instructorId` (singular).
     *     3. Ensure `instructorIds` is an array of strings. When
     *        only the singular `instructorId` is present (and the
     *        array is absent or empty), promote the singular value
     *        to `instructorIds: [id]`.
     *     4. Ensure `type` is `'mandatory'` or `'optional'`. If
     *        absent, default to `'mandatory'`. If present and
     *        unknown, preserve and log.
     *     5. Ensure `weeklyHours` and `weight` are numbers. A
     *        string-typed numeric is coerced. A non-numeric value
     *        is left in place and the record is counted as
     *        malformed.
     *     6. Leave `gradeScheme` and `assessmentWeights` alone.
     *        Their read-time normalisation already handles absence
     *        and malformed shapes.
     *
     * WHAT THIS MIGRATION DOES NOT DO:
     *   - It does NOT touch `data.curriculum.disciplines` when the
     *     store is absent or not an array. The migration is a no-op
     *     in that case.
     *   - It does NOT delete a record for any reason.
     *   - It does NOT clamp an out-of-range week.
     *   - It does NOT validate `gradeScheme` or
     *     `assessmentWeights`.
     *   - It does NOT touch any other curriculum sub-store.
     *
     * @param {object} data
     */
    function migrateToVersion26(data) {
        if (!data.curriculum ||
            typeof data.curriculum !== 'object' ||
            Array.isArray(data.curriculum)) {
            data._dataVersion = 26;
            return;
        }

        var disciplines = data.curriculum.disciplines;
        if (!Array.isArray(disciplines)) {
            data._dataVersion = 26;
            return;
        }

        var CalendarValidation = window.CalendarValidation;
        var hasParser = CalendarValidation &&
            typeof CalendarValidation.parseWeek === 'function';

        if (!hasParser) {
            console.warn(
                '[Database] v26: CalendarValidation.parseWeek is not ' +
                'available. Week coercion skipped. The migration will ' +
                'still strip retired fields and canonicalise ' +
                'instructorIds, type, weeklyHours, and weight.'
            );
        }

        var recordsSeen = 0;
        var startWeeksCoerced = 0;
        var endWeeksCoerced = 0;
        var weekMalformed = 0;
        var instructorIdsPromoted = 0;
        var instructorIdsNormalised = 0;
        var retiredFieldRecordsTouched = 0;
        var retiredFieldsDeleted = 0;
        var typeDefaulted = 0;
        var typeUnknown = 0;
        var weeklyHoursCoerced = 0;
        var weeklyHoursMalformed = 0;
        var weightCoerced = 0;
        var weightMalformed = 0;
        var recordsUnchanged = 0;

        function coerceWeekField(record, fieldName, counterKey) {
            var value = record[fieldName];
            if (value === undefined || value === null) {
                return false;
            }
            if (typeof value === 'number' && Number.isInteger(value)) {
                return false;
            }
            if (!hasParser) {
                return false;
            }
            var parsed = CalendarValidation.parseWeek(value);
            if (parsed === null) {
                return false;
            }
            record[fieldName] = parsed;
            return true;
        }

        function coerceNumericField(record, fieldName) {
            var value = record[fieldName];
            if (value === undefined || value === null) {
                return 'absent';
            }
            if (typeof value === 'number' && isFinite(value)) {
                return 'ok';
            }
            var num = Number(value);
            if (isFinite(num)) {
                record[fieldName] = num;
                return 'coerced';
            }
            return 'malformed';
        }

        for (var i = 0; i < disciplines.length; i++) {
            var record = disciplines[i];
            if (!record || typeof record !== 'object' || Array.isArray(record)) {
                continue;
            }

            recordsSeen++;

            var touched = false;

            // ---- 1. Coerce startWeek / endWeek ----
            if (coerceWeekField(record, 'startWeek')) {
                startWeeksCoerced++;
                touched = true;
            } else {
                var sw = record.startWeek;
                if (sw !== undefined && sw !== null &&
                    !(typeof sw === 'number' && Number.isInteger(sw))) {
                    if (hasParser && CalendarValidation.parseWeek(sw) === null) {
                        weekMalformed++;
                    } else if (!hasParser) {
                        weekMalformed++;
                    }
                }
            }

            if (coerceWeekField(record, 'endWeek')) {
                endWeeksCoerced++;
                touched = true;
            } else {
                var ew = record.endWeek;
                if (ew !== undefined && ew !== null &&
                    !(typeof ew === 'number' && Number.isInteger(ew))) {
                    if (hasParser && CalendarValidation.parseWeek(ew) === null) {
                        weekMalformed++;
                    } else if (!hasParser) {
                        weekMalformed++;
                    }
                }
            }

            // ---- 2. Promote singular instructorId BEFORE deleting ----
            var singularInstructorId = record.instructorId;
            var hasSingular =
                typeof singularInstructorId === 'string' &&
                singularInstructorId.trim() !== '';
            var hasArray =
                Array.isArray(record.instructorIds) &&
                record.instructorIds.length > 0;

            if (hasSingular && !hasArray) {
                record.instructorIds = [singularInstructorId.trim()];
                instructorIdsPromoted++;
                touched = true;
            } else if (!Array.isArray(record.instructorIds)) {
                record.instructorIds = [];
                touched = true;
            } else {
                // Ensure every entry is a trimmed string.
                var normalisedIds = [];
                var anyChanged = false;
                for (var idIdx = 0; idIdx < record.instructorIds.length; idIdx++) {
                    var raw = record.instructorIds[idIdx];
                    if (raw === undefined || raw === null) {
                        anyChanged = true;
                        continue;
                    }
                    var str = String(raw).trim();
                    if (str === '') {
                        anyChanged = true;
                        continue;
                    }
                    if (str !== raw) {
                        anyChanged = true;
                    }
                    normalisedIds.push(str);
                }
                if (anyChanged) {
                    record.instructorIds = normalisedIds;
                    instructorIdsNormalised++;
                    touched = true;
                }
            }

            // ---- 3. Delete retired fields ----
            var retiredFields = [
                'curriculum',
                'maxStudents',
                'gradingSystem',
                'instructorId'
            ];
            var anyRetiredDeleted = false;
            for (var rf = 0; rf < retiredFields.length; rf++) {
                var fieldName = retiredFields[rf];
                if (Object.prototype.hasOwnProperty.call(record, fieldName)) {
                    delete record[fieldName];
                    retiredFieldsDeleted++;
                    anyRetiredDeleted = true;
                    touched = true;
                }
            }
            if (anyRetiredDeleted) {
                retiredFieldRecordsTouched++;
            }

            // ---- 4. Ensure type ----
            var t = record.type;
            if (t === undefined || t === null || t === '') {
                record.type = 'mandatory';
                typeDefaulted++;
                touched = true;
            } else if (t !== 'mandatory' && t !== 'optional') {
                typeUnknown++;
                console.warn(
                    '[Database] v26: discipline "' +
                    (record.id || 'at index ' + i) +
                    '" has unknown type "' + t +
                    '". Preserved as-is.'
                );
            }

            // ---- 5. weeklyHours and weight ----
            var whResult = coerceNumericField(record, 'weeklyHours');
            if (whResult === 'coerced') {
                weeklyHoursCoerced++;
                touched = true;
            } else if (whResult === 'malformed') {
                weeklyHoursMalformed++;
                console.warn(
                    '[Database] v26: discipline "' +
                    (record.id || 'at index ' + i) +
                    '" has non-numeric weeklyHours "' +
                    record.weeklyHours + '". Left untouched.'
                );
            }

            var wResult = coerceNumericField(record, 'weight');
            if (wResult === 'coerced') {
                weightCoerced++;
                touched = true;
            } else if (wResult === 'malformed') {
                weightMalformed++;
                console.warn(
                    '[Database] v26: discipline "' +
                    (record.id || 'at index ' + i) +
                    '" has non-numeric weight "' +
                    record.weight + '". Left untouched.'
                );
            }

            if (!touched) {
                recordsUnchanged++;
            }
        }

        console.log(
            '[Database] v26: discipline record-shape canonicalisation. ' +
            'Records seen: ' + recordsSeen + '. ' +
            'Unchanged: ' + recordsUnchanged + '. ' +
            'startWeek coerced: ' + startWeeksCoerced + '. ' +
            'endWeek coerced: ' + endWeeksCoerced + '. ' +
            'Weeks malformed (left in place): ' + weekMalformed + '. ' +
            'instructorIds promoted from singular: ' + instructorIdsPromoted + '. ' +
            'instructorIds normalised: ' + instructorIdsNormalised + '. ' +
            'Retired-field records touched: ' + retiredFieldRecordsTouched + '. ' +
            'Retired fields deleted (total): ' + retiredFieldsDeleted + '. ' +
            'type defaulted: ' + typeDefaulted + '. ' +
            'type unknown (preserved): ' + typeUnknown + '. ' +
            'weeklyHours coerced: ' + weeklyHoursCoerced + '. ' +
            'weeklyHours malformed (left in place): ' + weeklyHoursMalformed + '. ' +
            'weight coerced: ' + weightCoerced + '. ' +
            'weight malformed (left in place): ' + weightMalformed + '.'
        );

        if (weekMalformed > 0) {
            console.warn(
                '[Database] v26: ' + weekMalformed +
                ' week field(s) could not be parsed and were left ' +
                'untouched. These records will continue to fail the ' +
                'discipline editor\'s type checks until manually ' +
                'corrected. Review the disciplines whose startWeek or ' +
                'endWeek is not an integer.'
            );
        }

        data._dataVersion = 26;
    }

    /**
     * Version 27 migration — Class-discipline marker-only store,
     * character mode, and global instructor retirement.
     *
     * WHY:
     *   Three concerns, all in one version because they land together
     *   and none of them is coherent without the others.
     *
     *   (a) CLASS-DISCIPLINE MARKER REWRITE.
     *       Before v27, a class-discipline record carried a full
     *       config blob: startWeek, endWeek, weeklyHours, weight,
     *       gradeSchemeId, assessmentWeights, instructorIds. The
     *       audit confirmed that disciplines are global and that
     *       classes only track availability. The config blob is
     *       legacy. It duplicated discipline data and made the
     *       "who owns this value" question ambiguous.
     *
     *       v27 rewrites every class-discipline record to a marker
     *       shape:
     *
     *         { classId, disciplineId, mandatory,
     *           createdAt, updatedAt }
     *
     *       Every config field is dropped. The discipline entity is
     *       the sole source of startWeek, endWeek, weeklyHours,
     *       weight, gradeSchemeId, and assessmentWeights.
     *
     *       `mandatory` is per-class. It is derived from the
     *       discipline's `type` field: 'mandatory' → true, anything
     *       else → false. When the discipline no longer exists, the
     *       legacy record's `mandatory` field is used as a fallback;
     *       when that is also absent, the default is false.
     *
     *   (b) INSTRUCTOR-OF-DISCIPLINE-FOR-CLASS MIGRATION.
     *       Under the new model, "instructor X teaches discipline D
     *       for class C" is an ENROLMENT, not a field on the
     *       class-discipline record. The enrolment store is the
     *       same one students use:
     *
     *         academy.enrolments[classId][charId]
     *           = [{ disciplineId, startWeek, endWeek }, ...]
     *
     *       Any legacy `instructorIds` array on a class-discipline
     *       record is converted:
     *
     *         For each instructorId in the array, ensure the
     *         instructor has an interval for `disciplineId` in that
     *         class, spanning the class-discipline's
     *         startWeek..endWeek.
     *
     *       If the instructor is already enrolled in that discipline
     *       for that class during the span, the existing interval is
     *       kept. No duplicate intervals are created. After
     *       conversion, the `instructorIds` field is dropped.
     *
     *       The conversion runs BEFORE the marker rewrite, because
     *       the marker rewrite drops startWeek and endWeek — the
     *       weeks the conversion needs.
     *
     *   (c) CHARACTER MODE BACKFILL.
     *       Characters gain a persisted `mode` field:
     *
     *         mode: 'student' | 'instructor'   (default 'student')
     *
     *       The mode is a domain fact. It drives which tabs the
     *       Academy character detail panel renders and how enrolments
     *       for the character are interpreted. Existing characters
     *       default to 'student'.
     *
     *   (d) GLOBAL DISCIPLINE INSTRUCTOR RETIREMENT.
     *       The `instructorIds` field on every discipline in
     *       data.curriculum.disciplines[] is dropped. Its semantics
     *       are now expressed through enrolments, and
     *       AcademyDisciplines no longer exports
     *       getDisciplinesByInstructor. Removing the field without
     *       conversion is safe because the new read path (the
     *       character detail aggregator's buildInstructorDisciplines)
     *       walks enrolments directly and does not consult the
     *       field.
     *
     * WHAT THIS MIGRATION DOES NOT DO:
     *   - It does NOT touch teachingGroups or teachingSessions.
     *   - It does NOT create enrolment records for instructors who
     *     were assigned via the global discipline field only. That
     *     assignment was never class-scoped, so there is nothing to
     *     convert to a class-scoped enrolment. If a user wants a
     *     former global-instructor assignment to survive, they
     *     re-assign the instructor via the class-discipline picker.
     *     This is a real data-loss boundary and is logged.
     *   - It does NOT delete any class-discipline record. Only its
     *     retired fields are dropped.
     *   - It does NOT re-derive `mandatory` from anything other than
     *     the discipline's `type` field.
     *
     * @param {object} data
     */
    function migrateToVersion27(data) {
        var disciplineTypeById = Object.create(null);

        // ---- Collect discipline types for mandatory derivation ----
        if (data.curriculum &&
            typeof data.curriculum === 'object' &&
            !Array.isArray(data.curriculum) &&
            Array.isArray(data.curriculum.disciplines)) {
            for (var di = 0; di < data.curriculum.disciplines.length; di++) {
                var disc = data.curriculum.disciplines[di];
                if (!disc || typeof disc !== 'object' || !disc.id) {
                    continue;
                }
                var type = (typeof disc.type === 'string' && disc.type !== '')
                    ? disc.type
                    : 'mandatory';
                disciplineTypeById[String(disc.id)] = type;
            }
        }

        // ============================================================
        // Part A+B: Class-discipline marker rewrite with instructor
        // conversion
        // ============================================================

        var recordsSeen = 0;
        var recordsRewritten = 0;
        var recordsMalformedSkipped = 0;
        var instructorEntriesConverted = 0;
        var instructorEntriesAlreadyPresent = 0;
        var instructorEntriesWithoutWeeks = 0;
        var emptyBucketsPruned = 0;

        var academy = (data.academy && typeof data.academy === 'object' && !Array.isArray(data.academy))
            ? data.academy
            : null;

        if (academy &&
            academy.classDisciplines &&
            typeof academy.classDisciplines === 'object' &&
            !Array.isArray(academy.classDisciplines)) {

            if (!academy.enrolments ||
                typeof academy.enrolments !== 'object' ||
                Array.isArray(academy.enrolments)) {
                academy.enrolments = {};
            }

            var classIds = Object.keys(academy.classDisciplines);

            for (var ci = 0; ci < classIds.length; ci++) {
                var classId = classIds[ci];
                var byClass = academy.classDisciplines[classId];
                if (!byClass || typeof byClass !== 'object' || Array.isArray(byClass)) {
                    recordsMalformedSkipped++;
                    continue;
                }

                var disciplineIds = Object.keys(byClass);
                var keptRecords = 0;

                for (var di2 = 0; di2 < disciplineIds.length; di2++) {
                    var disciplineId = disciplineIds[di2];
                    var legacy = byClass[disciplineId];

                    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) {
                        recordsMalformedSkipped++;
                        delete byClass[disciplineId];
                        continue;
                    }

                    recordsSeen++;

                    // ---- Step 1: convert instructorIds[] to enrolments ----
                    var legacyInstructors = Array.isArray(legacy.instructorIds)
                        ? legacy.instructorIds
                        : [];

                    var legacyStartWeek = legacy.startWeek;
                    var legacyEndWeek = legacy.endWeek;

                    var hasWeeks =
                        typeof legacyStartWeek === 'number' &&
                        isFinite(legacyStartWeek);

                    if (legacyInstructors.length > 0) {
                        if (!hasWeeks) {
                            // We cannot convert without a start week.
                            // Count and skip; the assignment is lost.
                            // Logged in the summary.
                            instructorEntriesWithoutWeeks += legacyInstructors.length;
                        } else {
                            for (var ii = 0; ii < legacyInstructors.length; ii++) {
                                var instructorId = legacyInstructors[ii];
                                if (instructorId === undefined ||
                                    instructorId === null ||
                                    String(instructorId).trim() === '') {
                                    continue;
                                }
                                var instructorIdStr = String(instructorId).trim();

                                var result = convertInstructorAssignment(
                                    academy,
                                    classId,
                                    instructorIdStr,
                                    disciplineId,
                                    legacyStartWeek,
                                    legacyEndWeek
                                );

                                if (result === 'converted') {
                                    instructorEntriesConverted++;
                                } else if (result === 'already-present') {
                                    instructorEntriesAlreadyPresent++;
                                }
                            }
                        }
                    }

                    // ---- Step 2: derive mandatory ----
                    var derivedMandatory;
                    var knownType = disciplineTypeById[String(disciplineId)];
                    if (knownType !== undefined) {
                        derivedMandatory = (knownType === 'mandatory');
                    } else if (typeof legacy.mandatory === 'boolean') {
                        derivedMandatory = legacy.mandatory;
                    } else {
                        derivedMandatory = false;
                    }

                    // ---- Step 3: build the marker ----
                    var now = new Date().toISOString();
                    var createdAt = (typeof legacy.createdAt === 'string' && legacy.createdAt)
                        ? legacy.createdAt
                        : now;
                    var updatedAt = (typeof legacy.updatedAt === 'string' && legacy.updatedAt)
                        ? legacy.updatedAt
                        : now;

                    byClass[disciplineId] = {
                        classId: String(classId),
                        disciplineId: String(disciplineId),
                        mandatory: derivedMandatory,
                        createdAt: createdAt,
                        updatedAt: updatedAt
                    };

                    keptRecords++;
                    recordsRewritten++;
                }

                if (keptRecords === 0) {
                    delete academy.classDisciplines[classId];
                    emptyBucketsPruned++;
                }
            }
        }

        // ============================================================
        // Part C: Character mode backfill
        // ============================================================

        var charactersSeen = 0;
        var modesAdded = 0;

        if (Array.isArray(data.characters)) {
            for (var cc = 0; cc < data.characters.length; cc++) {
                var char = data.characters[cc];
                if (!char || typeof char !== 'object') { continue; }
                charactersSeen++;

                if (char.mode !== 'student' && char.mode !== 'instructor') {
                    char.mode = 'student';
                    modesAdded++;
                }
            }
        }

        // ============================================================
        // Part D: Global discipline instructorIds retirement
        // ============================================================

        var disciplinesSeen = 0;
        var disciplineInstructorFieldsDropped = 0;
        var disciplineInstructorEntriesDropped = 0;

        if (data.curriculum &&
            typeof data.curriculum === 'object' &&
            !Array.isArray(data.curriculum) &&
            Array.isArray(data.curriculum.disciplines)) {

            for (var d = 0; d < data.curriculum.disciplines.length; d++) {
                var record = data.curriculum.disciplines[d];
                if (!record || typeof record !== 'object') { continue; }
                disciplinesSeen++;

                if (Object.prototype.hasOwnProperty.call(record, 'instructorIds')) {
                    if (Array.isArray(record.instructorIds)) {
                        disciplineInstructorEntriesDropped += record.instructorIds.length;
                    }
                    delete record.instructorIds;
                    disciplineInstructorFieldsDropped++;
                }
            }
        }

        // ============================================================
        // Summary log
        // ============================================================

        console.log(
            '[Database] v27: class-discipline marker rewrite, character ' +
            'mode backfill, and global instructor retirement. ' +
            'Class-discipline records seen: ' + recordsSeen + '. ' +
            'Rewritten: ' + recordsRewritten + '. ' +
            'Malformed skipped: ' + recordsMalformedSkipped + '. ' +
            'Empty buckets pruned: ' + emptyBucketsPruned + '. ' +
            'Instructor assignments converted to enrolments: ' +
            instructorEntriesConverted + '. ' +
            'Instructor assignments already present as enrolments: ' +
            instructorEntriesAlreadyPresent + '. ' +
            'Instructor assignments lost (no week bounds): ' +
            instructorEntriesWithoutWeeks + '. ' +
            'Characters seen: ' + charactersSeen + '. ' +
            'Modes added: ' + modesAdded + '. ' +
            'Disciplines seen: ' + disciplinesSeen + '. ' +
            'Discipline instructorIds fields dropped: ' +
            disciplineInstructorFieldsDropped + '. ' +
            'Discipline instructor entries dropped: ' +
            disciplineInstructorEntriesDropped + '.'
        );

        if (instructorEntriesWithoutWeeks > 0) {
            console.warn(
                '[Database] v27: ' + instructorEntriesWithoutWeeks +
                ' instructor assignment(s) could not be converted to ' +
                'enrolments because the class-discipline record they ' +
                'belonged to had no valid startWeek. These assignments ' +
                'are lost. To restore them, re-assign the instructors ' +
                'via the class-discipline picker.'
            );
        }

        if (disciplineInstructorEntriesDropped > 0) {
            console.warn(
                '[Database] v27: ' + disciplineInstructorEntriesDropped +
                ' entry(ies) in the global discipline.instructorIds field(s) ' +
                'were dropped. This field expressed an instructor-of-a-' +
                'discipline relationship that was never class-scoped, so ' +
                'there is no enrolment to convert it to. If any of these ' +
                'assignments matter, re-assign the instructors via the ' +
                'class-discipline picker.'
            );
        }

        data._dataVersion = 27;
    }

    /**
     * Ensure the instructor has an enrolment interval for the given
     * (classId, disciplineId) spanning [startWeek, endWeek].
     *
     * Returns:
     *   'converted'      — a new interval was added
     *   'already-present'— an existing interval already covers the span
     *   'invalid'        — inputs were malformed (should not happen,
     *                      defended for safety)
     *
     * If the instructor has an interval for the discipline that does
     * not cover the span, it is left alone. The migration does NOT
     * merge or extend existing intervals; that would be a semantic
     * change, and this migration is about preserving what was there.
     */
    function convertInstructorAssignment(
        academy,
        classId,
        instructorId,
        disciplineId,
        startWeek,
        endWeek
    ) {
        if (!academy || !academy.enrolments) {
            return 'invalid';
        }
        if (!classId || !instructorId || !disciplineId) {
            return 'invalid';
        }

        var classKey = String(classId);
        var charKey = String(instructorId);
        var discKey = String(disciplineId);

        var byClass = academy.enrolments[classKey];
        if (!byClass || typeof byClass !== 'object' || Array.isArray(byClass)) {
            byClass = {};
            academy.enrolments[classKey] = byClass;
        }

        var intervals = byClass[charKey];
        if (!Array.isArray(intervals)) {
            intervals = [];
            byClass[charKey] = intervals;
        }

        // Search for an existing interval for this discipline that
        // already covers [startWeek, endWeek].
        for (var i = 0; i < intervals.length; i++) {
            var iv = intervals[i];
            if (!iv || typeof iv !== 'object') { continue; }
            if (String(iv.disciplineId) !== discKey) { continue; }

            var ivStart = (typeof iv.startWeek === 'number') ? iv.startWeek : null;
            var ivEnd = (iv.endWeek === null || iv.endWeek === undefined)
                ? Infinity
                : (typeof iv.endWeek === 'number' ? iv.endWeek : null);

            if (ivStart === null || ivEnd === null) { continue; }

            if (ivStart <= startWeek && ivEnd >= endWeek) {
                return 'already-present';
            }
        }

        // No covering interval. Append a new one.
        intervals.push({
            disciplineId: discKey,
            startWeek: startWeek,
            endWeek: (endWeek === null || endWeek === undefined) ? null : endWeek
        });

        return 'converted';
    }

    /**
     * Version 28 migration — Stats-config icon normalisation.
     *
     * WHY:
     *   The default stats config used pictographic emoji for class
     *   icons: ⚔ 🏹 🛡 📚 🗡 ⚡ ⚙ ✦. Emoji are inconsistent across
     *   platforms, do not scale with text weight, and cannot be
     *   styled with a single color. The whole application has moved
     *   to monochrome Unicode glyphs for symbolic markers. The stats
     *   config is a persisted data shape (`statsConfig.classes[].icon`),
     *   so the change requires a migration.
     *
     * SCOPE:
     *   Rewrites ONLY icon values that match a legacy emoji in the
     *   known lookup table. Custom icons that a user added to their
     *   own class entries are left alone. The migration does not
     *   guess at meaning; it replaces a known string with a known
     *   replacement.
     *
     * @param {object} data
     */
    function migrateToVersion28(data) {
        if (!data.statsConfig ||
            typeof data.statsConfig !== 'object' ||
            Array.isArray(data.statsConfig)) {
            data._dataVersion = 28;
            return;
        }

        var classes = data.statsConfig.classes;
        if (!Array.isArray(classes)) {
            data._dataVersion = 28;
            return;
        }

        // ---- Legacy-emoji lookup table ----
        //
        // Key is the legacy string as it appeared in persisted data.
        // Value is the monochrome replacement. Keys are the raw
        // surrogate-pair emoji strings, written in \u escapes so the
        // source file carries no pictographic characters.
        var ICON_REPLACEMENTS = Object.create(null);
        ICON_REPLACEMENTS['\u2694'] = '\u2020';        // crossed swords → dagger
        ICON_REPLACEMENTS['\uD83C\uDFF9'] = '\u27b6';  // bow and arrow → heavy arrow
        ICON_REPLACEMENTS['\uD83D\uDEE1'] = '\u25c8';  // shield → diamond centre dot
        ICON_REPLACEMENTS['\uD83D\uDCDA'] = '\u25a4';  // books → square horiz fill
        ICON_REPLACEMENTS['\uD83D\uDDE1'] = '\u2020';  // dagger → dagger
        ICON_REPLACEMENTS['\u26A1'] = '\u2301';        // high voltage → electric arrow
        ICON_REPLACEMENTS['\u2699'] = '\u2731';        // gear → heavy asterisk
        ICON_REPLACEMENTS['\u2726'] = '\u2727';        // black star → white star

        // Some emoji are written as single \u codepoints in source but
        // as surrogate pairs on disk. Add the codepoint form as well
        // so both spellings are caught.
        ICON_REPLACEMENTS['\u2694\uFE0F'] = '\u2020';  // crossed swords + VS16
        ICON_REPLACEMENTS['\u26A1\uFE0F'] = '\u2301';  // high voltage + VS16
        ICON_REPLACEMENTS['\u2699\uFE0F'] = '\u2731';  // gear + VS16

        var recordsSeen = 0;
        var iconsRewritten = 0;
        var iconsAlreadyMonochrome = 0;
        var iconsCustom = 0;
        var recordsMalformed = 0;

        for (var i = 0; i < classes.length; i++) {
            var record = classes[i];
            if (!record || typeof record !== 'object' || Array.isArray(record)) {
                recordsMalformed++;
                continue;
            }
            recordsSeen++;

            if (typeof record.icon !== 'string' || record.icon === '') {
                // No icon: nothing to rewrite. The UI will fall back.
                continue;
            }

            if (ICON_REPLACEMENTS[record.icon] !== undefined) {
                record.icon = ICON_REPLACEMENTS[record.icon];
                iconsRewritten++;
                continue;
            }

            // Is the existing value already one of the monochrome
            // replacements? Then the record has been migrated (or was
            // created after the change). Leave it alone.
            var alreadyMono = false;
            var monoKeys = ['\u2020', '\u27b6', '\u25c8', '\u25a4',
                            '\u2301', '\u2731', '\u2727'];
            for (var mk = 0; mk < monoKeys.length; mk++) {
                if (record.icon === monoKeys[mk]) {
                    alreadyMono = true;
                    break;
                }
            }
            if (alreadyMono) {
                iconsAlreadyMonochrome++;
            } else {
                iconsCustom++;
            }
        }

        console.log(
            '[Database] v28: stats-config icon normalisation. ' +
            'Records seen: ' + recordsSeen + '. ' +
            'Icons rewritten: ' + iconsRewritten + '. ' +
            'Already monochrome: ' + iconsAlreadyMonochrome + '. ' +
            'Custom icons left alone: ' + iconsCustom + '. ' +
            'Malformed records skipped: ' + recordsMalformed + '.'
        );

        data._dataVersion = 28;
    }

    /**
     * Version 29 migration — Class-level instructorId retirement.
     *
     * WHY:
     *   Prior to this revision, a class record carried `instructorId`
     *   — a single instructor per class. The relationship it expressed
     *   is discipline-scoped: an instructor teaches a discipline FOR a
     *   class, not the class as a whole. Two instructors may teach a
     *   class different disciplines; the same instructor may teach one
     *   class several disciplines.
     *
     *   The relationship is now expressed as an enrolment (v27):
     *
     *     academy.enrolments[classId][charId] = [
     *       { disciplineId, startWeek, endWeek }, ...
     *     ]
     *
     *   with the character's mode set to 'instructor'. The class's
     *   instructors are derived from those enrolments via
     *   AcademyClasses.getClassInstructorIds(classId, week).
     *
     * WHAT THIS MIGRATION DOES:
     *   For every class record in academy.graduatingClasses:
     *     - delete `instructorId` if present.
     *
     * WHAT THIS MIGRATION DOES NOT DO:
     *   - It does NOT convert the retired field into an enrolment.
     *     There is nothing to convert: the field was never writable
     *     through the UI (the class form does not render an instructor
     *     input), so any surviving value is either null or a
     *     programmatic write from a caller that no longer exists.
     *   - It does NOT touch any other class field.
     *   - It does NOT create or modify enrolments.
     *
     * @param {object} data
     */
    function migrateToVersion29(data) {
        var academy = data.academy;

        if (!academy ||
            typeof academy !== 'object' ||
            Array.isArray(academy) ||
            !academy.graduatingClasses ||
            typeof academy.graduatingClasses !== 'object' ||
            Array.isArray(academy.graduatingClasses)) {
            data._dataVersion = 29;
            return;
        }

        var recordsSeen = 0;
        var fieldsDropped = 0;

        var classIds = Object.keys(academy.graduatingClasses);
        for (var i = 0; i < classIds.length; i++) {
            var record = academy.graduatingClasses[classIds[i]];
            if (!record || typeof record !== 'object' || Array.isArray(record)) {
                continue;
            }
            recordsSeen++;

            if (Object.prototype.hasOwnProperty.call(record, 'instructorId')) {
                delete record.instructorId;
                fieldsDropped++;
            }
        }

        console.log(
            '[Database] v29: class-level instructorId retirement. ' +
            'Records seen: ' + recordsSeen + '. ' +
            'instructorId fields dropped: ' + fieldsDropped + '. ' +
            'Class instructors are now derived from per-discipline ' +
            'enrolments via AcademyClasses.getClassInstructorIds.'
        );

        data._dataVersion = 29;
    }

    // ============================================================
    // NORMALISE DATA STRUCTURE
    // ============================================================
    //
    // Every guard below sets `repaired = true` only when it actually
    // changed something. Prior to this revision, every whole-store
    // merge set the flag unconditionally, which caused every load to
    // persist to IndexedDB even when the stored data was already in
    // canonical shape.
    //
    // The deepMergeDefaults helper now returns { merged, changed }.
    // Every merge call site reads `.changed` to decide whether to flip
    // the flag. Every leaf-level guard still flips the flag only when
    // it writes.

    function normaliseDataStructure(data) {
        var repaired = false;

        // ---- Top-level arrays ----
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

        // ---- Characters ----
        data.characters.forEach(function(char) {
            if (!Array.isArray(char.classIds)) {
                char.classIds = [];
                repaired = true;
            }
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

            // v27 shape guard: every character must carry a valid mode.
            if (char.mode !== 'student' && char.mode !== 'instructor') {
                char.mode = 'student';
                repaired = true;
            }
        });

        // ---- Teams (top-level shape) ----
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

        // ---- Curriculum ----
        if (!data.curriculum || typeof data.curriculum !== 'object' || Array.isArray(data.curriculum)) {
            data.curriculum = getDefaultCurriculumData();
            repaired = true;
        } else {
            if (data.curriculum.schedules !== undefined) { delete data.curriculum.schedules; repaired = true; }
            if (data.curriculum.locationSchedules !== undefined) { delete data.curriculum.locationSchedules; repaired = true; }
            if (data.curriculum.metadata !== undefined) { delete data.curriculum.metadata; repaired = true; }
            var curriculumMerge = deepMergeDefaults(data.curriculum, getDefaultCurriculumData());
            data.curriculum = curriculumMerge.merged;
            if (curriculumMerge.changed) { repaired = true; }
        }

        // ---- Social ----
        if (!data.social || typeof data.social !== 'object' || Array.isArray(data.social)) {
            data.social = getDefaultSocialData();
            repaired = true;
        } else {
            var socialMerge = deepMergeDefaults(data.social, getDefaultSocialData());
            data.social = socialMerge.merged;
            if (socialMerge.changed) { repaired = true; }
        }

        // ---- Stats config ----
        if (!data.statsConfig || typeof data.statsConfig !== 'object' || Array.isArray(data.statsConfig)) {
            data.statsConfig = getDefaultStatsConfig();
            repaired = true;
        } else {
            var statsMerge = deepMergeDefaults(data.statsConfig, getDefaultStatsConfig());
            data.statsConfig = statsMerge.merged;
            if (statsMerge.changed) { repaired = true; }
        }

        // ---- Academy ----
        if (!data.academy || typeof data.academy !== 'object' || Array.isArray(data.academy)) {
            data.academy = getDefaultAcademyData();
            repaired = true;
        } else {
            var academyMerge = deepMergeDefaults(data.academy, getDefaultAcademyData());
            data.academy = academyMerge.merged;
            if (academyMerge.changed) { repaired = true; }

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

        // ---- v22 shape guard: weekly-team records must not carry members ----
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

        // ---- v24 shape guard: intervals array + memberId on every member entry ----
        data.teams.forEach(function(team) {
            if (!team || typeof team !== 'object') return;
            if (!Array.isArray(team.members)) return;

            for (var i = 0; i < team.members.length; i++) {
                var member = team.members[i];
                if (!member || typeof member !== 'object' || Array.isArray(member)) {
                    continue;
                }

                if (!Array.isArray(member.intervals)) {
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

        // ---- v25 shape guard: every elimination record carries a year ----
        (function ensureEliminationYears() {
            var fallbackYear = (typeof data.currentYear === 'number' &&
                                isFinite(data.currentYear) &&
                                data.currentYear > 0)
                ? Math.floor(data.currentYear)
                : new Date().getFullYear();

            var classes = (data.academy && data.academy.graduatingClasses)
                ? data.academy.graduatingClasses
                : {};
            var tournaments = Array.isArray(data.tournaments) ? data.tournaments : [];

            function findClassYear(classId) {
                if (!classId) { return null; }
                var cls = classes[classId];
                if (!cls) { return null; }
                var y = parseInt(cls.year, 10);
                return isNaN(y) ? null : y;
            }

            function findTournamentYear(tournamentId) {
                if (!tournamentId) { return null; }
                for (var i = 0; i < tournaments.length; i++) {
                    var t = tournaments[i];
                    if (t && String(t.id) === String(tournamentId)) {
                        return findClassYear(t.graduatingClassId);
                    }
                }
                return null;
            }

            if (!Array.isArray(data.characters)) { return; }

            data.characters.forEach(function(char) {
                if (!char || !Array.isArray(char.eliminations)) { return; }

                char.eliminations.forEach(function(elim) {
                    if (!elim || typeof elim !== 'object') { return; }

                    if (typeof elim.year === 'number' &&
                        isFinite(elim.year) &&
                        elim.year > 0) {
                        return;
                    }

                    var resolved = null;

                    if (elim.tournamentId) {
                        resolved = findTournamentYear(elim.tournamentId);
                    }

                    if (resolved === null) {
                        var ids = Array.isArray(char.classIds) ? char.classIds : [];
                        if (ids.length === 1) {
                            resolved = findClassYear(ids[0]);
                        }
                    }

                    if (resolved === null) {
                        resolved = fallbackYear;
                    }

                    elim.year = resolved;
                    repaired = true;
                });
            });
        })();

        // ---- v26 shape guard: discipline canonical shape ----
        (function ensureDisciplineShape() {
            var CV = window.CalendarValidation;
            var hasParser = CV && typeof CV.parseWeek === 'function';

            if (!data.curriculum ||
                typeof data.curriculum !== 'object' ||
                Array.isArray(data.curriculum)) {
                return;
            }

            var disciplines = data.curriculum.disciplines;
            if (!Array.isArray(disciplines)) { return; }

            function coerceWeek(record, field) {
                var v = record[field];
                if (v === undefined || v === null) { return false; }
                if (typeof v === 'number' && Number.isInteger(v)) {
                    return false;
                }
                if (!hasParser) { return false; }
                var parsed = CV.parseWeek(v);
                if (parsed === null) { return false; }
                record[field] = parsed;
                return true;
            }

            function coerceNumeric(record, field) {
                var v = record[field];
                if (v === undefined || v === null) { return false; }
                if (typeof v === 'number' && isFinite(v)) { return false; }
                var num = Number(v);
                if (!isFinite(num)) { return false; }
                record[field] = num;
                return true;
            }

            for (var i = 0; i < disciplines.length; i++) {
                var record = disciplines[i];
                if (!record || typeof record !== 'object' || Array.isArray(record)) {
                    continue;
                }

                if (coerceWeek(record, 'startWeek')) { repaired = true; }
                if (coerceWeek(record, 'endWeek')) { repaired = true; }

                // Promote singular instructorId before deletion.
                var singular = record.instructorId;
                var hasSingular =
                    typeof singular === 'string' &&
                    singular.trim() !== '';
                var hasArray =
                    Array.isArray(record.instructorIds) &&
                    record.instructorIds.length > 0;
                if (hasSingular && !hasArray) {
                    record.instructorIds = [singular.trim()];
                    repaired = true;
                } else if (!Array.isArray(record.instructorIds)) {
                    record.instructorIds = [];
                    repaired = true;
                }

                if (Object.prototype.hasOwnProperty.call(record, 'curriculum')) {
                    delete record.curriculum;
                    repaired = true;
                }
                if (Object.prototype.hasOwnProperty.call(record, 'maxStudents')) {
                    delete record.maxStudents;
                    repaired = true;
                }
                if (Object.prototype.hasOwnProperty.call(record, 'gradingSystem')) {
                    delete record.gradingSystem;
                    repaired = true;
                }
                if (Object.prototype.hasOwnProperty.call(record, 'instructorId')) {
                    delete record.instructorId;
                    repaired = true;
                }

                if (record.type === undefined ||
                    record.type === null ||
                    record.type === '') {
                    record.type = 'mandatory';
                    repaired = true;
                }

                if (coerceNumeric(record, 'weeklyHours')) { repaired = true; }
                if (coerceNumeric(record, 'weight')) { repaired = true; }

                // v27: drop the global discipline instructorIds field.
                if (Object.prototype.hasOwnProperty.call(record, 'instructorIds')) {
                    delete record.instructorIds;
                    repaired = true;
                }
            }
        })();

        // ---- v27 shape guard: class-discipline marker shape ----
        (function ensureClassDisciplineMarkerShape() {
            if (!data.academy ||
                !data.academy.classDisciplines ||
                typeof data.academy.classDisciplines !== 'object' ||
                Array.isArray(data.academy.classDisciplines)) {
                return;
            }

            var disciplineTypeById = Object.create(null);
            if (data.curriculum &&
                Array.isArray(data.curriculum.disciplines)) {
                for (var di = 0; di < data.curriculum.disciplines.length; di++) {
                    var d = data.curriculum.disciplines[di];
                    if (!d || typeof d !== 'object' || !d.id) { continue; }
                    var t = (typeof d.type === 'string' && d.type !== '')
                        ? d.type
                        : 'mandatory';
                    disciplineTypeById[String(d.id)] = t;
                }
            }

            var classIds = Object.keys(data.academy.classDisciplines);
            for (var ci = 0; ci < classIds.length; ci++) {
                var classId = classIds[ci];
                var byClass = data.academy.classDisciplines[classId];
                if (!byClass || typeof byClass !== 'object' || Array.isArray(byClass)) {
                    delete data.academy.classDisciplines[classId];
                    repaired = true;
                    continue;
                }

                var disciplineIds = Object.keys(byClass);
                var kept = 0;
                for (var di2 = 0; di2 < disciplineIds.length; di2++) {
                    var disciplineId = disciplineIds[di2];
                    var record = byClass[disciplineId];
                    if (!record || typeof record !== 'object' || Array.isArray(record)) {
                        delete byClass[disciplineId];
                        repaired = true;
                        continue;
                    }

                    var needsRewrite = false;

                    // Retired config fields.
                    var retired = [
                        'startWeek', 'endWeek', 'weeklyHours', 'weight',
                        'gradeSchemeId', 'assessmentWeights', 'instructorIds'
                    ];
                    for (var rf = 0; rf < retired.length; rf++) {
                        if (Object.prototype.hasOwnProperty.call(record, retired[rf])) {
                            delete record[retired[rf]];
                            needsRewrite = true;
                        }
                    }

                    if (record.classId === undefined ||
                        String(record.classId) !== String(classId)) {
                        record.classId = String(classId);
                        needsRewrite = true;
                    }
                    if (record.disciplineId === undefined ||
                        String(record.disciplineId) !== String(disciplineId)) {
                        record.disciplineId = String(disciplineId);
                        needsRewrite = true;
                    }
                    if (typeof record.mandatory !== 'boolean') {
                        var knownType = disciplineTypeById[String(disciplineId)];
                        record.mandatory = (knownType === 'mandatory');
                        needsRewrite = true;
                    }
                    if (typeof record.createdAt !== 'string' || record.createdAt === '') {
                        record.createdAt = new Date().toISOString();
                        needsRewrite = true;
                    }
                    if (typeof record.updatedAt !== 'string' || record.updatedAt === '') {
                        record.updatedAt = new Date().toISOString();
                        needsRewrite = true;
                    }

                    if (needsRewrite) {
                        repaired = true;
                    }
                    kept++;
                }

                if (kept === 0) {
                    delete data.academy.classDisciplines[classId];
                    repaired = true;
                }
            }
        })();

        // ---- v28 shape guard: stats-config icons are monochrome ----
        //
        // Symmetric with the migration. Any record that still carries
        // a legacy emoji icon is rewritten to its monochrome
        // replacement. Custom icons are left alone.
        (function ensureStatsConfigMonochromeIcons() {
            if (!data.statsConfig ||
                typeof data.statsConfig !== 'object' ||
                Array.isArray(data.statsConfig)) {
                return;
            }

            var classes = data.statsConfig.classes;
            if (!Array.isArray(classes)) { return; }

            var ICON_REPLACEMENTS = Object.create(null);
            ICON_REPLACEMENTS['\u2694'] = '\u2020';
            ICON_REPLACEMENTS['\uD83C\uDFF9'] = '\u27b6';
            ICON_REPLACEMENTS['\uD83D\uDEE1'] = '\u25c8';
            ICON_REPLACEMENTS['\uD83D\uDCDA'] = '\u25a4';
            ICON_REPLACEMENTS['\uD83D\uDDE1'] = '\u2020';
            ICON_REPLACEMENTS['\u26A1'] = '\u2301';
            ICON_REPLACEMENTS['\u2699'] = '\u2731';
            ICON_REPLACEMENTS['\u2726'] = '\u2727';
            ICON_REPLACEMENTS['\u2694\uFE0F'] = '\u2020';
            ICON_REPLACEMENTS['\u26A1\uFE0F'] = '\u2301';
            ICON_REPLACEMENTS['\u2699\uFE0F'] = '\u2731';

            for (var i = 0; i < classes.length; i++) {
                var record = classes[i];
                if (!record || typeof record !== 'object' || Array.isArray(record)) {
                    continue;
                }
                if (typeof record.icon !== 'string' || record.icon === '') {
                    continue;
                }
                if (ICON_REPLACEMENTS[record.icon] !== undefined) {
                    record.icon = ICON_REPLACEMENTS[record.icon];
                    repaired = true;
                }
            }
        })();

        // ---- v29 shape guard: class records carry no instructorId ----
        //
        // Symmetric with the v29 migration. Any class record that
        // still carries the retired field is cleaned, so imported
        // envelopes or direct writes never reintroduce it.
        (function ensureClassNoInstructorField() {
            if (!data.academy ||
                !data.academy.graduatingClasses ||
                typeof data.academy.graduatingClasses !== 'object' ||
                Array.isArray(data.academy.graduatingClasses)) {
                return;
            }

            var classIds = Object.keys(data.academy.graduatingClasses);
            for (var i = 0; i < classIds.length; i++) {
                var record = data.academy.graduatingClasses[classIds[i]];
                if (!record || typeof record !== 'object' || Array.isArray(record)) {
                    continue;
                }
                if (Object.prototype.hasOwnProperty.call(record, 'instructorId')) {
                    delete record.instructorId;
                    repaired = true;
                }
            }
        })();

        // ---- Orphan classId pruning ----
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

    window.db = Object.freeze({
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
    });

    window.loadData = loadData;
    window.saveData = saveData;
    window.getEmptyData = getEmptyData;
    window.getDefaultMagicProficiencies = getDefaultMagicProficiencies;

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var required = [
            'openDatabase',
            'ensureDatabaseReady',
            'loadData',
            'saveData',
            'getEmptyData',
            'autoLoadData',
            'createSafeCopy',
            'getDatabaseStatus',
            'isDatabaseReady',
            'getLoadError',
            'deleteDatabase'
        ];
        var missing = [];
        for (var i = 0; i < required.length; i++) {
            if (typeof window.db[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }
        if (missing.length > 0) {
            console.warn(
                '[Database] Verification - some exports may be missing:',
                missing.join(', ')
            );
        }
    })();

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