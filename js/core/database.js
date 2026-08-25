/**
 * js/core/database.js - IndexedDB Operations
 * Path: js/core/database.js
 */

var DB_NAME = 'HollowBladesDB';
var DB_VERSION = 12; // Increment version to force upgrade
var STORE_NAME = 'appData';

// INTERNAL: The actual IndexedDB connection (private)
var _indexedDB = null;
// INTERNAL: The application data cache
var _data = null;
// INTERNAL: Promise for database open operation
var _dbOpenPromise = null;
// INTERNAL: Loading state flags
var _isLoading = false;
var _isSaving = false;
var _dataLoadedDispatched = false;
// INTERNAL: Database initialization promise
var _dbInitPromise = null;

// ============================================================
// DATABASE OPENING - WITH STORE CREATION
// ============================================================

function openDatabase() {
    if (_indexedDB) {
        return Promise.resolve(_indexedDB);
    }
    if (_dbOpenPromise) {
        return _dbOpenPromise;
    }

    _dbOpenPromise = new Promise(function(resolve) {
        try {
            var request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onerror = function(event) {
                var error = event.target.error;
                
                console.error('=================================');
                console.error('INDEXEDDB OPEN FAILED');
                console.error('Name:', error && error.name);
                console.error('Message:', error && error.message);
                console.error('Error:', error);
                console.error('=================================');
                
                _dbOpenPromise = null;
                resolve(null);
            };
            
            request.onsuccess = function(event) {
                _indexedDB = event.target.result;
                _dbOpenPromise = null;
                console.log('IndexedDB opened successfully:', _indexedDB.name, 'v' + _indexedDB.version);
                
                // Verify the store exists
                if (!_indexedDB.objectStoreNames.contains(STORE_NAME)) {
                    console.warn('Store "' + STORE_NAME + '" not found! Closing and reopening with upgrade...');
                    _indexedDB.close();
                    _indexedDB = null;
                    _dbOpenPromise = null;
                    // Reopen with a higher version to trigger upgrade
                    var upgradeRequest = indexedDB.open(DB_NAME, DB_VERSION + 1);
                    upgradeRequest.onupgradeneeded = function(upgradeEvent) {
                        var db = upgradeEvent.target.result;
                        if (!db.objectStoreNames.contains(STORE_NAME)) {
                            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                            console.log('Store "' + STORE_NAME + '" created during upgrade');
                        }
                    };
                    upgradeRequest.onsuccess = function(upgradeEvent) {
                        _indexedDB = upgradeEvent.target.result;
                        _dbOpenPromise = null;
                        console.log('IndexedDB reopened successfully with store');
                        resolve(_indexedDB);
                    };
                    upgradeRequest.onerror = function(upgradeEvent) {
                        console.error('Failed to reopen database with upgrade:', upgradeEvent.target.error);
                        resolve(null);
                    };
                    return;
                }
                
                resolve(_indexedDB);
            };
            
            request.onupgradeneeded = function(event) {
                var database = event.target.result;
                console.log('Upgrade needed - creating/updating stores...');
                if (!database.objectStoreNames.contains(STORE_NAME)) {
                    database.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    console.log('IndexedDB store "' + STORE_NAME + '" created');
                } else {
                    console.log('Store "' + STORE_NAME + '" already exists');
                }
            };
        } catch (err) {
            console.error('=================================');
            console.error('INDEXEDDB EXCEPTION');
            console.error('Error:', err);
            console.error('=================================');
            _dbOpenPromise = null;
            resolve(null);
        }
    });

    return _dbOpenPromise;
}

function ensureDatabaseReady() {
    if (_dbInitPromise) {
        return _dbInitPromise;
    }
    
    _dbInitPromise = openDatabase().then(function(result) {
        if (result) {
            _indexedDB = result;
        }
        return _indexedDB;
    });
    
    return _dbInitPromise;
}

// ============================================================
// DATA STRUCTURES
// ============================================================

function getDefaultMagicProficiencies() {
    var types = ['earth','water','fire','air','metal','wood',
                 'blood','bone','mind','morphic','life','death',
                 'space','time','dimension','void','reality','transference'];
    var proficiencies = {};
    types.forEach(function(key) { proficiencies[key] = 0; });
    return proficiencies;
}

function getEmptyData() {
    return {
        characters: [],
        teams: [],
        tournaments: [],
        missions: [],
        activities: [],
        classes: [],
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
                { id: 'mystic', label: 'Mystic', icon: '🔮', primaryStats: ['wis', 'cha'], secondaryStats: ['con', 'int'], statWeights: { wis: 0.35, cha: 0.25, con: 0.2, int: 0.15, dex: 0.05 }, minStats: { wis: 13, cha: 12 } },
                { id: 'stalker', label: 'Stalker', icon: '🗡', primaryStats: ['dex', 'int'], secondaryStats: ['cha', 'wis'], statWeights: { dex: 0.35, int: 0.25, cha: 0.2, wis: 0.15, str: 0.05 }, minStats: { dex: 13, int: 12 } },
                { id: 'spellblade', label: 'Spellblade', icon: '⚡', primaryStats: ['str', 'int'], secondaryStats: ['dex', 'con'], statWeights: { str: 0.3, int: 0.3, dex: 0.2, con: 0.15, wis: 0.05 }, minStats: { str: 13, int: 12 } },
                { id: 'channeler', label: 'Channeler', icon: '🌀', primaryStats: ['cha', 'con'], secondaryStats: ['dex', 'int'], statWeights: { cha: 0.35, con: 0.25, dex: 0.2, int: 0.15, wis: 0.05 }, minStats: { cha: 13, con: 12 } },
                { id: 'warden', label: 'Warden', icon: '🌿', primaryStats: ['str', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { str: 0.3, wis: 0.25, con: 0.2, dex: 0.2, cha: 0.05 }, minStats: { str: 13, wis: 12 } },
                { id: 'adept', label: 'Adept', icon: '🧘', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'str'], statWeights: { dex: 0.3, wis: 0.3, con: 0.2, str: 0.15, int: 0.05 }, minStats: { dex: 13, wis: 13 } },
                { id: 'artificer', label: 'Artificer', icon: '🔧', primaryStats: ['int', 'dex'], secondaryStats: ['con', 'wis'], statWeights: { int: 0.35, dex: 0.25, con: 0.2, wis: 0.15, cha: 0.05 }, minStats: { int: 13, dex: 12 } },
                { id: 'occultist', label: 'Occultist', icon: '🌙', primaryStats: ['int', 'cha'], secondaryStats: ['con', 'dex'], statWeights: { int: 0.3, cha: 0.3, con: 0.2, dex: 0.15, wis: 0.05 }, minStats: { int: 13, cha: 13 } },
                { id: 'blade_dancer', label: 'Blade Dancer', icon: '🗡', primaryStats: ['dex', 'cha'], secondaryStats: ['str', 'con'], statWeights: { dex: 0.35, cha: 0.25, str: 0.2, con: 0.15, wis: 0.05 }, minStats: { dex: 13, cha: 12 } },
                { id: 'elementalist', label: 'Elementalist', icon: '🌀', primaryStats: ['int', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { int: 0.35, wis: 0.25, con: 0.2, dex: 0.15, cha: 0.05 }, minStats: { int: 13, wis: 12 } },
                { id: 'sentinel', label: 'Sentinel', icon: '🏰', primaryStats: ['str', 'con'], secondaryStats: ['wis', 'dex'], statWeights: { str: 0.3, con: 0.3, wis: 0.2, dex: 0.15, cha: 0.05 }, minStats: { str: 13, con: 12 } }
            ]
        }
    };
}

function ensureDataStructure(data) {
    if (!data.tournaments) data.tournaments = [];
    if (!data.characters) data.characters = [];
    if (!data.teams) data.teams = [];
    if (!data.missions) data.missions = [];
    if (!data.activities) data.activities = [];
    if (!data.classes) data.classes = [];
    if (!data.currentYear) data.currentYear = new Date().getFullYear();
    if (!data.currentWeek) data.currentWeek = 1;
    
    data.characters.forEach(function(char) {
        if (!char.classIds) char.classIds = [];
    });
    
    data.teams.forEach(function(team) {
        if (team.type === 'academic' && !team.classId) {
            team.classId = null;
        }
        if (!team.teamNumber) team.teamNumber = '';
    });
    
    if (!data.curriculum) {
        data.curriculum = getEmptyData().curriculum;
    }
    
    if (!data.social) {
        data.social = getEmptyData().social;
    }
    if (!data.social.relationships) data.social.relationships = [];
    if (!data.social.nextId) data.social.nextId = 1;
    
    if (!data.statsConfig) {
        data.statsConfig = getEmptyData().statsConfig;
    }
}

function migrateData(data) {
    if (!data) return;
    
    data.characters.forEach(function(char) {
        if (char.deceased === undefined) char.deceased = false;
        if (!char.careerStatus) char.careerStatus = [];
        if (!char.eliminatedWeeks) char.eliminatedWeeks = [];
        if (!char.eliminations) char.eliminations = [];
        if (!char.middleName) char.middleName = '';
        if (!char.nickname) char.nickname = '';
        if (!char.alias) char.alias = '';
        if (!char.previousNames) char.previousNames = [];
        if (!char.nameFormat) char.nameFormat = 'firstlast';
        if (!char.eyes) char.eyes = '';
        if (!char.hair) char.hair = '';
        if (!char.skin) char.skin = '';
        if (!char.height) char.height = '';
        if (!char.weight) char.weight = '';
        if (!char.build) char.build = '';
        if (!char.appearanceNotes) char.appearanceNotes = '';
        if (!char.specialty) char.specialty = '';
        if (!char.deathYear) char.deathYear = '';
        if (!char.deathCause) char.deathCause = '';
        if (!char.deathAge) char.deathAge = '';
        if (!char.notes) char.notes = '';
        if (!char.gender) char.gender = '';
        if (!char.classIds) char.classIds = [];
        
        if (!char.stats) {
            char.stats = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
        }
        ['str','dex','con','int','wis','cha'].forEach(function(key) {
            if (char.stats[key] === undefined || char.stats[key] === null) {
                char.stats[key] = 10;
            }
        });
        
        if (!char.magic) {
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
        
        char.careerStatus.forEach(function(status) {
            if (!status.status) status.status = 'civilian';
            if (!status.startYear) status.startYear = '';
            if (!status.endYear) status.endYear = '';
        });
        
        char.eliminations.forEach(function(elim) {
            if (!elim.tournamentId) elim.tournamentId = '';
            if (!elim.week) elim.week = '';
            if (!elim.reason) elim.reason = 'Eliminated from tournament';
        });
    });
    
    data.teams.forEach(function(team) {
        if (!team.nameHistory) team.nameHistory = [];
        if (!team.rankingHistory) team.rankingHistory = [];
        if (!team.members) team.members = [];
        if (!team.status) team.status = 'active';
        if (!team.currentRank) team.currentRank = '';
        if (!team.startPeriod) team.startPeriod = '';
        if (!team.endPeriod) team.endPeriod = '';
        if (!team.type) team.type = 'academic';
        if (!team.temporaryMission) team.temporaryMission = null;
        if (!team.classId && team.type === 'academic') team.classId = null;
        if (!team.teamNumber) team.teamNumber = '';
        team.members.forEach(function(member) {
            if (!member.role) member.role = 'Member';
            if (!member.joinPeriod) member.joinPeriod = '';
            if (!member.leavePeriod) member.leavePeriod = '';
        });
    });
    
    data.tournaments.forEach(function(tourn) {
        if (!tourn.mode) tourn.mode = 'teams';
        if (!tourn.status) tourn.status = 'draft';
        if (!tourn.participants) tourn.participants = [];
        if (!tourn.rounds) tourn.rounds = [];
        if (!tourn.eliminations) tourn.eliminations = [];
        if (!tourn.winners) tourn.winners = [];
        if (!tourn.totalRounds) tourn.totalRounds = 1;
        if (!tourn.startWeek) tourn.startWeek = 1;
        if (!tourn.endWeek) tourn.endWeek = 52;
        if (!tourn.winner) tourn.winner = null;
        if (!tourn.currentRound) tourn.currentRound = 0;
        if (!tourn.teams) tourn.teams = [];
        if (!tourn.matches) tourn.matches = [];
        if (!tourn.createdAt) tourn.createdAt = new Date().toISOString();
    });
    
    data.missions.forEach(function(mission) {
        if (!mission.status) mission.status = 'active';
        if (!mission.createdAt) mission.createdAt = new Date().toISOString();
        if (!mission.completedAt) mission.completedAt = null;
        if (!mission.assignedTeamId) mission.assignedTeamId = null;
        if (!mission.priority) mission.priority = 'medium';
        if (!mission.tags) mission.tags = [];
        if (!mission.objectives) mission.objectives = [];
        if (!mission.progress) mission.progress = 0;
        if (!mission.log) mission.log = [];
        if (!mission.notes) mission.notes = '';
        if (!mission.location) mission.location = '';
        if (!mission.duration) mission.duration = '';
        if (!mission.difficulty) mission.difficulty = 'medium';
        if (!mission.pay) mission.pay = '';
        if (!mission.objective) mission.objective = '';
    });
}

// ============================================================
// SAFE CLONE - NO JSON FALLBACK
// ============================================================

function createSafeCopy(data) {
    // Only use structuredClone - fail loudly if it doesn't work
    if (typeof structuredClone !== 'function') {
        throw new Error(
            'This browser does not support structuredClone(). ' +
            'Please use a modern browser.'
        );
    }

    try {
        return structuredClone(data);
    } catch (err) {
        console.error('=================================');
        console.error('STRUCTURED CLONE FAILED');
        console.error('Error:', err);
        console.error('Data type:', typeof data);
        console.error('Data keys:', data ? Object.keys(data) : 'null');
        console.error('=================================');
        throw err;
    }
}

// ============================================================
// LOAD DATA
// ============================================================

function loadData() {
    if (_isLoading) {
        return new Promise(function(resolve) {
            var checkInterval = setInterval(function() {
                if (!_isLoading) {
                    clearInterval(checkInterval);
                    resolve(window.data || _data || getEmptyData());
                }
            }, 50);
        });
    }
    
    _isLoading = true;
    
    return new Promise(function(resolve) {
        ensureDatabaseReady().then(function(database) {
            if (!database) {
                console.warn('Database not available, using empty data');
                _data = getEmptyData();
                window.data = _data;
                _isLoading = false;
                resolve(_data);
                return;
            }
            
            doLoadData(resolve);
        }).catch(function(err) {
            console.error('Failed to ensure database:', err);
            _data = getEmptyData();
            window.data = _data;
            _isLoading = false;
            resolve(_data);
        });
    });
}

function doLoadData(resolve) {
    if (!_indexedDB || typeof _indexedDB.transaction !== 'function') {
        console.warn('Database not available, using empty data');
        _data = getEmptyData();
        window.data = _data;
        _isLoading = false;
        resolve(_data);
        return;
    }

    try {
        var transaction = _indexedDB.transaction([STORE_NAME], 'readonly');
        var store = transaction.objectStore(STORE_NAME);
        var request = store.get('mainData');
        
        request.onsuccess = function() {
            _isLoading = false;
            if (request.result && request.result.data) {
                _data = request.result.data;
                ensureDataStructure(_data);
                migrateData(_data);
                window.data = _data;
                console.log('Data loaded from IndexedDB');
                resolve(_data);
            } else {
                console.log('No data in IndexedDB, using empty data');
                _data = getEmptyData();
                window.data = _data;
                resolve(_data);
            }
        };
        request.onerror = function(event) {
            _isLoading = false;
            console.error('IndexedDB load error:', event.target.error);
            _data = getEmptyData();
            window.data = _data;
            resolve(_data);
        };
        transaction.onerror = function(event) {
            _isLoading = false;
            console.error('Transaction error:', event.target.error);
            _data = getEmptyData();
            window.data = _data;
            resolve(_data);
        };
    } catch (err) {
        _isLoading = false;
        console.error('Error in doLoadData:', err);
        _data = getEmptyData();
        window.data = _data;
        resolve(_data);
    }
}

// ============================================================
// SAVE DATA - WITH STORE VERIFICATION
// ============================================================

function saveData() {
    // If already saving, return the existing promise
    if (_isSaving) {
        return Promise.resolve();
    }
    
    _isSaving = true;
    
    return new Promise(function(resolve) {
        ensureDatabaseReady().then(function(database) {
            if (!database) {
                console.warn('Database not available, skipping save');
                _isSaving = false;
                resolve();
                return;
            }
            
            // Verify the store exists before saving
            if (!_indexedDB.objectStoreNames.contains(STORE_NAME)) {
                console.error('Store "' + STORE_NAME + '" does not exist! Cannot save.');
                _isSaving = false;
                resolve();
                return;
            }
            
            executeSave(resolve);
        }).catch(function(err) {
            console.error('Failed to ensure database for save:', err);
            _isSaving = false;
            resolve();
        });
    });
}

function executeSave(resolve) {
    if (!_indexedDB || typeof _indexedDB.transaction !== 'function') {
        console.warn('Database not available, skipping save');
        _isSaving = false;
        resolve();
        return;
    }
    
    // Double-check store exists
    if (!_indexedDB.objectStoreNames.contains(STORE_NAME)) {
        console.error('Store "' + STORE_NAME + '" does not exist! Cannot save.');
        _isSaving = false;
        resolve();
        return;
    }
    
    try {
        var sourceData = window.data || _data;
        
        if (!sourceData) {
            sourceData = getEmptyData();
            window.data = sourceData;
            _data = sourceData;
        }
        
        ensureDataStructure(sourceData);
        
        // Create a clean copy - this will throw if structuredClone fails
        var safeData = createSafeCopy(sourceData);
        
        var transaction = _indexedDB.transaction([STORE_NAME], 'readwrite');
        var store = transaction.objectStore(STORE_NAME);
        var record = {
            id: 'mainData',
            data: safeData,
            updatedAt: new Date().toISOString()
        };
        var request = store.put(record);
        
        request.onsuccess = function() {
            _isSaving = false;
            console.log('Data saved to IndexedDB');
            resolve();
        };
        
        request.onerror = function(event) {
            _isSaving = false;
            console.error('IndexedDB save error:', event.target.error);
            resolve();
        };
        
        transaction.onerror = function(event) {
            _isSaving = false;
            console.error('Transaction error:', event.target.error);
            resolve();
        };
        
    } catch (err) {
        _isSaving = false;
        console.error('=================================');
        console.error('SAVE ERROR');
        console.error('Error:', err);
        console.error('=================================');
        resolve();
    }
}

// ============================================================
// AUTO LOAD
// ============================================================

function autoLoadData() {
    console.log('Auto-loading data from IndexedDB...');
    
    if (window.data) {
        console.log('Data already exists in window.data, skipping load');
        _dispatchDataReady(window.data);
        return;
    }
    
    loadData().then(function(result) {
        console.log('Data auto-loaded successfully');
        _dispatchDataReady(result);
    }).catch(function(err) {
        console.error('Auto-load failed:', err);
        _dispatchDataReady(getEmptyData());
    });
}

function _dispatchDataReady(data) {
    if (_dataLoadedDispatched) {
        console.log('Data already dispatched, skipping');
        return;
    }
    _dataLoadedDispatched = true;
    
    setTimeout(function() {
        var event = new CustomEvent('dataReady', { 
            detail: { data: data },
            bubbles: false,
            cancelable: false
        });
        document.dispatchEvent(event);
        console.log('dataReady event dispatched');
    }, 10);
}

// ============================================================
// EXPOSE GLOBALS
// ============================================================

// Public API - named window.db to match existing code expectations
window.db = {
    openDatabase: openDatabase,
    ensureDatabaseReady: ensureDatabaseReady,
    loadData: loadData,
    saveData: saveData,
    getEmptyData: getEmptyData,
    getDefaultMagicProficiencies: getDefaultMagicProficiencies,
    autoLoadData: autoLoadData,
    createSafeCopy: createSafeCopy
};

// Also expose individual functions for backward compatibility
window.loadData = loadData;
window.saveData = saveData;
window.getEmptyData = getEmptyData;
window.getDefaultMagicProficiencies = getDefaultMagicProficiencies;

// ============================================================
// INITIALIZE
// ============================================================

// Start database initialization immediately
ensureDatabaseReady().then(function(database) {
    if (database) {
        console.log('Database initialization complete');
        console.log('Available stores:', database.objectStoreNames ? Array.from(database.objectStoreNames) : 'unknown');
    } else {
        console.warn('Database initialization failed - running in memory-only mode');
    }
});

// Auto-load data after a short delay
setTimeout(autoLoadData, 50);



// ============================================================
// DEBUG HELPERS (remove in production)
// ============================================================

console.log('=== DATABASE DEBUG ===');
console.log('window.db API:', window.db);
console.log('Internal connection (_indexedDB):', _indexedDB);

// Check if we have a valid connection
setTimeout(function() {
    console.log('=== CONNECTION CHECK ===');
    console.log('_indexedDB exists:', !!_indexedDB);
    if (_indexedDB) {
        console.log('_indexedDB.transaction type:', typeof _indexedDB.transaction);
        console.log('_indexedDB.name:', _indexedDB.name);
        console.log('_indexedDB.version:', _indexedDB.version);
        console.log('Store names:', _indexedDB.objectStoreNames ? Array.from(_indexedDB.objectStoreNames) : 'none');
        console.log('Has "' + STORE_NAME + '":', _indexedDB.objectStoreNames.contains(STORE_NAME));
    }
}, 100);
