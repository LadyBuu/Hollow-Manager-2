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
 * - DEFENSIVE version-mismatch recovery (auto-delete stale databases)
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
 * VERSION MISMATCH RECOVERY:
 * - IndexedDB enforces that a database cannot be opened with a lower
 *   version than it was created with.
 * - If the stored database is newer than our DB_VERSION (e.g., because
 *   an earlier iteration of the code used a higher DB_VERSION), we cannot
 *   downgrade.
 * - In that case, we DESTROY the local database and recreate it fresh.
 * - This loses all locally stored data. In practice this only happens in
 *   development or during a schema rollback, and is preferable to a
 *   permanently broken application.
 * - If recovery fails (e.g., another tab holds the database open), we
 *   surface a clear error so the user can close other tabs and retry.
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
 * - Version 14: Added hp, mp, weapons, combatNotes to characters
 * - Version 15: Added canonical academy structure; consolidated class
 *               membership onto character.classIds; removed the legacy
 *               academy.classStudents roster as an independent authority.
 * - Version 16: Added academy.enrolments, academy.socialScores,
 *               academy.settings.
 * - Version 17: Assigns stable IDs to tournament rounds and matches.
 * - Version 18: Assigns stable IDs to characters whose id is null,
 *               undefined, or empty string.
 * - Version 19: Resets academy.weeklyTeams. The old shape
 *               (per-week snapshots) is incompatible with the ranged
 *               model that replaced it. The persistent Team entities
 *               (window.data.teams) are NOT affected; only the
 *               per-week assignment map is reset.
 * - Version 20: Adds the teaching-model stores to academy:
 *               classDisciplines, teachingGroups, teachingGroupSequences,
 *               teachingSessions. These back the schedule redesign.
 * - Version 21: Removes the retired stored-schedule maps:
 *               curriculum.schedules, curriculum.locationSchedules,
 *               curriculum.metadata, and the unused top-level
 *               data.locationSchedules store.
 *               The teaching projector is now the sole source of
 *               schedule data.
 * - Version 22: Collapses the redundant `members` array out of
 *               academy.weeklyTeams records. Weekly-team records now
 *               carry ONLY the week window ({ classId, teamId,
 *               startWeek, endWeek }). Team membership lives
 *               exclusively on the persistent Team entity's
 *               members[] array (with joinPeriod / leavePeriod as
 *               the week range). The migration walks every
 *               weekly-team member and ensures the corresponding
 *               entry exists on teams[teamId].members[], copying
 *               startWeek → joinPeriod and endWeek → leavePeriod
 *               when the target entry has no range yet. The
 *               redundant `members` array is then deleted.
 * 
 * ACADEMY MEMBERSHIP MODEL (v15+):
 * - character.classIds[] is the SINGLE SOURCE OF TRUTH for class membership.
 * - The academy roster is DERIVED: characters.filter(c => c.classIds.includes(classId)).
 * - academy.classStudents no longer exists after migration.
 * - Class deletion cascades: removes the class, all character references,
 *   weekly teams for the class, and grades/rankings keyed to the class.
 * - normaliseDataStructure() enforces these invariants on every load and
 *   prunes orphaned classId references (with a dev-mode warning).
 * 
 * ACADEMY STORES (v20):
 *   academy.graduatingClasses      { [classId]: classRecord }
 *   academy.grades                 { [gradeId]: gradeRecord }
 *   academy.rankings               { [rankingId]: rankingRecord }
 *   academy.weeklyTeams            { [classId]: { [teamId]: teamRecord } }
 *   academy.enrolments             { [classId]: { [charId]: [interval] } }
 *   academy.socialScores           { [classId]: { [charId]: { [week]: number } } }
 *   academy.settings               { ranking: { academic, social } }
 *   academy.classDisciplines       { [classId]: { [disciplineId]: cdRecord } }
 *   academy.teachingGroups         { [groupId]: groupRecord }
 *   academy.teachingGroupSequences { ["classId|disc|inst"]: number }
 *   academy.teachingSessions       { [sessionId]: sessionRecord }
 * 
 * WEEKLY-TEAM RECORD SHAPE (v22+):
 *   academy.weeklyTeams[classId][teamId] = {
 *     id, classId, teamId,
 *     startWeek, endWeek,       // null = ongoing; endWeek inclusive
 *     createdAt, updatedAt
 *   }
 *   NO members array. The roster is the persistent Team entity's
 *   members[] array, filtered by the week.
 * 
 * RETIRED STORES (removed in v21):
 *   curriculum.schedules
 *   curriculum.locationSchedules
 *   curriculum.metadata
 *   data.locationSchedules (top-level, unused duplicate)
 * 
 * RETIRED STORES (removed in v22):
 *   academy.weeklyTeams[classId][teamId].members
 */

(function() {
    'use strict';

    var DB_NAME = 'HollowBladesDB';
    var DB_VERSION = 1;
    var DATA_VERSION = 22;
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
            if (char.attraction === undefined) {
                char.attraction = '';
            }
            if (char.sexuality === undefined) {
                char.sexuality = '';
            }
        });
        data._dataVersion = 13;
    }

    function migrateToVersion14(data) {
        data.characters.forEach(function(char) {
            if (typeof char.hp !== 'number' || isNaN(char.hp) || char.hp < 0) {
                char.hp = 0;
            }
            if (char.hp > 999) {
                char.hp = 999;
            }

            if (typeof char.mp !== 'number' || isNaN(char.mp) || char.mp < 0) {
                char.mp = 0;
            }
            if (char.mp > 999) {
                char.mp = 999;
            }

            if (typeof char.combatNotes !== 'string') {
                char.combatNotes = '';
            }

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
                if (!Array.isArray(students)) {
                    return;
                }

                students.forEach(function(studentId) {
                    if (!studentId) {
                        return;
                    }
                    var targetId = String(studentId);
                    var char = data.characters.find(function(c) {
                        return c && String(c.id) === targetId;
                    });
                    if (!char) {
                        return;
                    }

                    if (!Array.isArray(char.classIds)) {
                        char.classIds = [];
                    }

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
            if (!Array.isArray(char.classIds)) {
                char.classIds = [];
            }
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
            console.warn(
                '[Database] v18 skipped: IdUtils.generateId is not available.'
            );
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
            if (!c || typeof c !== 'object') {
                continue;
            }

            var id = c.id;
            if (id !== null && id !== undefined && id !== '') {
                continue;
            }

            var newId = IdUtils.generateId('char');

            while (seenIds[newId]) {
                collisionCount++;
                newId = IdUtils.generateId('char');
                if (collisionCount > 1000) {
                    throw new Error(
                        '[Database] v18: cannot generate a unique ID after ' +
                        '1000 attempts. IdUtils may be broken.'
                    );
                }
            }

            seenIds[newId] = true;
            c.id = newId;
            repairedCount++;
        }

        if (repairedCount > 0) {
            console.log(
                '[Database] v18: assigned IDs to ' + repairedCount +
                ' character(s) that had id: null.'
            );
        }
        if (collisionCount > 0) {
            console.warn(
                '[Database] v18: resolved ' + collisionCount +
                ' ID collision(s) while generating new character IDs.'
            );
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
                'Old shape (per-week snapshots) is incompatible with the ' +
                'ranged model. ' + classCount + ' class bucket(s) and ' +
                keyCount + ' key(s) removed. Team entities are unaffected.'
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

        if (!academy.classDisciplines ||
            typeof academy.classDisciplines !== 'object' ||
            Array.isArray(academy.classDisciplines)) {
            academy.classDisciplines = {};
        }
        if (!academy.teachingGroups ||
            typeof academy.teachingGroups !== 'object' ||
            Array.isArray(academy.teachingGroups)) {
            academy.teachingGroups = {};
        }
        if (!academy.teachingGroupSequences ||
            typeof academy.teachingGroupSequences !== 'object' ||
            Array.isArray(academy.teachingGroupSequences)) {
            academy.teachingGroupSequences = {};
        }
        if (!academy.teachingSessions ||
            typeof academy.teachingSessions !== 'object' ||
            Array.isArray(academy.teachingSessions)) {
            academy.teachingSessions = {};
        }

        data._dataVersion = 20;
    }

    /**
     * Version 21 migration — Retire the stored-schedule maps.
     *
     * WHY:
     *   The teaching model projects schedules on demand from
     *   class-disciplines, enrolments, groups, and sessions. There
     *   is no stored answer; the schedule is a computation.
     *
     *   Four stores existed only to hold the old stored answer:
     *
     *     curriculum.schedules
     *     curriculum.locationSchedules
     *     curriculum.metadata
     *     data.locationSchedules (top-level, unused duplicate)
     *
     *   Nothing reads or writes them after this version ships.
     *
     * WHAT THIS DOES NOT DO:
     *   - It does NOT touch curriculum.autoGroups.
     *   - It does NOT touch curriculum.restDays or examDays.
     *   - It does NOT touch any academy.* store.
     *
     * @param {object} data
     */
    function migrateToVersion21(data) {
        if (data.curriculum && typeof data.curriculum === 'object') {
            delete data.curriculum.schedules;
            delete data.curriculum.locationSchedules;
            delete data.curriculum.metadata;
        }
        delete data.locationSchedules;
        data._dataVersion = 21;
    }

    /**
     * Version 22 migration — Collapse the weekly-team member array.
     *
     * WHY:
     *   Prior to v22, academy.weeklyTeams records carried their own
     *   `members` array, parallel to the persistent Team entity's
     *   members[] array. The two stores drifted independently:
     *   the Weekly Teams view read the weekly-team members array,
     *   while the Tournaments view read the persistent roster. The
     *   same team would show different members in the two views.
     *
     *   The persistent Team entity's members[] array already
     *   carries joinPeriod / leavePeriod, which is the same ranged
     *   semantics the weekly-team member array was invented to
     *   provide. There was never a reason for two ranged rosters.
     *
     * WHAT THIS DOES:
     *   For every weekly-team record:
     *     1. For each member of the redundant weekly-team members
     *        array, find the corresponding entry on
     *        data.teams[teamId].members[] by characterId.
     *     2. If the entry exists and its joinPeriod / leavePeriod
     *        are empty, fill them from the weekly-team member's
     *        startWeek / endWeek.
     *     3. If the entry does not exist, add it with
     *        joinPeriod = String(startWeek) and
     *        leavePeriod = (endWeek === null ? '' : String(endWeek)).
     *     4. Delete the weekly-team record's members array.
     *
     *   The weekly-team record itself survives; it retains its
     *   classId, teamId, startWeek, endWeek, createdAt, updatedAt.
     *
     * WHAT THIS DOES NOT DO:
     *   - It does NOT touch data.teams members that have no
     *     corresponding weekly-team entry. Team entities are
     *     authoritative; missing weekly-team entries simply mean
     *     "no week-scoped assignment exists."
     *   - It does NOT delete weekly-team records that have no
     *     members. A record with an empty members array is a
     *     legitimate state (team scheduled, roster not yet filled).
     *   - It does NOT touch any other store.
     *
     * @param {object} data
     */
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

        if (!Array.isArray(data.teams)) {
            data.teams = [];
        }

        // Build a fast lookup: teamId -> team record (live ref).
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
            if (!byClass || typeof byClass !== 'object' || Array.isArray(byClass)) {
                continue;
            }

            var teamIds = Object.keys(byClass);
            for (var i = 0; i < teamIds.length; i++) {
                var teamId = teamIds[i];
                var record = byClass[teamId];
                if (!record || typeof record !== 'object' || Array.isArray(record)) {
                    continue;
                }

                recordsProcessed++;

                var redundantMembers = Array.isArray(record.members)
                    ? record.members
                    : [];

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

                if (!Array.isArray(persistentTeam.members)) {
                    persistentTeam.members = [];
                }

                for (var m = 0; m < redundantMembers.length; m++) {
                    var redundant = redundantMembers[m];
                    if (!redundant || typeof redundant !== 'object') {
                        continue;
                    }
                    var charId = redundant.characterId;
                    if (charId === null || charId === undefined || charId === '') {
                        continue;
                    }
                    var charIdStr = String(charId);

                    // Find the existing persistent-roster entry.
                    var existing = null;
                    for (var p = 0; p < persistentTeam.members.length; p++) {
                        var candidate = persistentTeam.members[p];
                        if (candidate &&
                            String(candidate.characterId) === charIdStr) {
                            existing = candidate;
                            break;
                        }
                    }

                    var joinStr = (redundant.startWeek !== undefined &&
                                   redundant.startWeek !== null)
                        ? String(redundant.startWeek)
                        : '';
                    var leaveStr = (redundant.endWeek !== undefined &&
                                    redundant.endWeek !== null)
                        ? String(redundant.endWeek)
                        : '';

                    if (existing) {
                        // Fill empty range fields on the persistent entry
                        // from the redundant one. Never overwrite a
                        // non-empty value: the persistent roster is the
                        // canonical source, and a filled value is a
                        // stronger claim than an empty one.
                        if ((existing.joinPeriod === undefined ||
                             existing.joinPeriod === null ||
                             existing.joinPeriod === '') && joinStr !== '') {
                            existing.joinPeriod = joinStr;
                        }
                        if ((existing.leavePeriod === undefined ||
                             existing.leavePeriod === null ||
                             existing.leavePeriod === '') && leaveStr !== '') {
                            existing.leavePeriod = leaveStr;
                        }
                        membersAlreadyPresent++;
                    } else {
                        persistentTeam.members.push({
                            characterId: charIdStr,
                            role: (typeof redundant.role === 'string' && redundant.role)
                                ? redundant.role
                                : 'Member',
                            joinPeriod: joinStr,
                            leavePeriod: leaveStr
                        });
                        membersMigrated++;
                    }
                }

                // The redundant array is now collapsed. Remove it.
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

    // ============================================================
    // NORMALISE DATA STRUCTURE - Current schema defaults
    // ============================================================

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

        // v21: locationSchedules at the top level is retired.
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

        // ---- Character invariants ----
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
            if (char.attraction === undefined) {
                char.attraction = '';
                repaired = true;
            }
            if (char.sexuality === undefined) {
                char.sexuality = '';
                repaired = true;
            }

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

        // ---- Team invariants ----
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
            // v21: strip retired stores if they survived.
            if (data.curriculum.schedules !== undefined) {
                delete data.curriculum.schedules;
                repaired = true;
            }
            if (data.curriculum.locationSchedules !== undefined) {
                delete data.curriculum.locationSchedules;
                repaired = true;
            }
            if (data.curriculum.metadata !== undefined) {
                delete data.curriculum.metadata;
                repaired = true;
            }

            data.curriculum = deepMergeDefaults(data.curriculum, getDefaultCurriculumData());
            repaired = true;
        }

        // ---- Social ----
        if (!data.social || typeof data.social !== 'object' || Array.isArray(data.social)) {
            data.social = getDefaultSocialData();
            repaired = true;
        } else {
            data.social = deepMergeDefaults(data.social, getDefaultSocialData());
            repaired = true;
        }

        // ---- StatsConfig ----
        if (!data.statsConfig || typeof data.statsConfig !== 'object' || Array.isArray(data.statsConfig)) {
            data.statsConfig = getDefaultStatsConfig();
            repaired = true;
        } else {
            data.statsConfig = deepMergeDefaults(data.statsConfig, getDefaultStatsConfig());
            repaired = true;
        }

        // ---- Academy ----
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

        // ---- v20 shape guards ----
        if (!data.academy.classDisciplines ||
            typeof data.academy.classDisciplines !== 'object' ||
            Array.isArray(data.academy.classDisciplines)) {
            data.academy.classDisciplines = {};
            repaired = true;
        }
        if (!data.academy.teachingGroups ||
            typeof data.academy.teachingGroups !== 'object' ||
            Array.isArray(data.academy.teachingGroups)) {
            data.academy.teachingGroups = {};
            repaired = true;
        }
        if (!data.academy.teachingGroupSequences ||
            typeof data.academy.teachingGroupSequences !== 'object' ||
            Array.isArray(data.academy.teachingGroupSequences)) {
            data.academy.teachingGroupSequences = {};
            repaired = true;
        }
        if (!data.academy.teachingSessions ||
            typeof data.academy.teachingSessions !== 'object' ||
            Array.isArray(data.academy.teachingSessions)) {
            data.academy.teachingSessions = {};
            repaired = true;
        }

        // ---- v22 shape guard: weekly-team records MUST NOT carry a
        //      members array. The roster lives exclusively on the
        //      persistent Team entity. Any residual members array is
        //      stripped here as a safety net; the v22 migration is
        //      the authoritative collapse.
        if (data.academy.weeklyTeams &&
            typeof data.academy.weeklyTeams === 'object' &&
            !Array.isArray(data.academy.weeklyTeams)) {
            Object.keys(data.academy.weeklyTeams).forEach(function(classId) {
                var byClass = data.academy.weeklyTeams[classId];
                if (!byClass || typeof byClass !== 'object' || Array.isArray(byClass)) {
                    return;
                }
                Object.keys(byClass).forEach(function(teamId) {
                    var record = byClass[teamId];
                    if (!record || typeof record !== 'object' || Array.isArray(record)) {
                        return;
                    }
                    if (record.members !== undefined) {
                        delete record.members;
                        repaired = true;
                    }
                });
            });
        }

        // ---- Class-membership invariants ----
        var validClassIds = Object.create(null);
        Object.keys(data.academy.graduatingClasses).forEach(function(id) {
            validClassIds[id] = true;
        });

        var prunedClassRefs = 0;
        data.characters.forEach(function(char) {
            if (!Array.isArray(char.classIds)) {
                return;
            }
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
                ' orphaned classId reference(s). A mutation path is not cascading correctly.'
            );
        }

        // ---- Prune orphaned weeklyTeams ----
        if (data.academy.weeklyTeams && typeof data.academy.weeklyTeams === 'object') {
            Object.keys(data.academy.weeklyTeams).forEach(function(classId) {
                if (!validClassIds[classId]) {
                    delete data.academy.weeklyTeams[classId];
                    repaired = true;
                }
            });
        }

        // ---- Prune orphaned grades / rankings ----
        function pruneByClassId(storeName) {
            var store = data.academy[storeName];
            if (!store || typeof store !== 'object') {
                return;
            }
            Object.keys(store).forEach(function(recordId) {
                var record = store[recordId];
                if (!record || typeof record !== 'object') {
                    return;
                }
                if (record.classId && !validClassIds[record.classId]) {
                    delete store[recordId];
                    repaired = true;
                }
            });
        }
        pruneByClassId('grades');
        pruneByClassId('rankings');

        // ---- Prune orphaned enrolments / socialScores / classDisciplines ----
        function pruneClassBucket(storeName) {
            var store = data.academy[storeName];
            if (!store || typeof store !== 'object') {
                return;
            }
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
                        // Ignore resolver errors
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
                        // Ignore rejector errors
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
        .then(function() {
            return autoLoadData();
        })
        .catch(function(err) {
            _loadError = err;
            _dispatchDataFailure(err);
        });

})();
