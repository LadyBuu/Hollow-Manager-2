/**
 * js/core/database.js - IndexedDB Operations
 * Path: js/core/database.js
 */

var DB_NAME = 'HollowBladesDB';
var DB_VERSION = 11;
var STORE_NAME = 'appData';

var db = null;
var data = null;
var dbOpenPromise = null;
var isLoading = false;
var isSaving = false;
var _dataLoadedDispatched = false;

function openDatabase() {
    if (db) {
        return Promise.resolve(db);
    }
    if (dbOpenPromise) {
        return dbOpenPromise;
    }

    dbOpenPromise = new Promise(function(resolve) {
        try {
            var request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onerror = function(event) {
                console.error('IndexedDB open error:', event.target.error);
                dbOpenPromise = null;
                resolve(null);
            };
            
            request.onsuccess = function(event) {
                db = event.target.result;
                dbOpenPromise = null;
                console.log('IndexedDB opened');
                resolve(db);
            };
            
            request.onupgradeneeded = function(event) {
                var database = event.target.result;
                if (!database.objectStoreNames.contains(STORE_NAME)) {
                    database.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    console.log('IndexedDB store created');
                }
            };
        } catch (err) {
            console.error('IndexedDB exception:', err);
            dbOpenPromise = null;
            resolve(null);
        }
    });

    return dbOpenPromise;
}

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
        data.curriculum = {
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
    
    if (!data.social) {
        data.social = {
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
    if (!data.social.relationships) data.social.relationships = [];
    if (!data.social.nextId) data.social.nextId = 1;
    
    if (!data.statsConfig) {
        data.statsConfig = getEmptyData().statsConfig;
    }
}

function migrateData(data) {
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
// CIRCULAR REFERENCE SAFE STRINGIFY
// ============================================================

function safeStringify(obj) {
    var seen = [];
    var MAX_DEPTH = 50;
    var depth = 0;
    
    function replacer(key, value) {
        depth++;
        
        if (depth > MAX_DEPTH) {
            return '[MaxDepth]';
        }
        
        if (typeof value === 'object' && value !== null) {
            if (seen.indexOf(value) !== -1) {
                return '[Circular]';
            }
            seen.push(value);
        }
        return value;
    }
    
    try {
        return JSON.stringify(obj, replacer);
    } catch (e) {
        console.error('safeStringify error:', e);
        return '{}';
    }
}

// ============================================================
// SAFE DATA COPY FOR STORAGE
// ============================================================

function createSafeCopy(data) {
    // Use the safe stringify/parse method
    try {
        var json = safeStringify(data);
        return JSON.parse(json);
    } catch (e) {
        console.warn('Safe copy failed, using manual copy:', e);
        return createManualSafeCopy(data);
    }
}

function createManualSafeCopy(data) {
    var copy = {};
    
    // Only copy primitive values and simple arrays/objects
    var safeKeys = [
        'characters', 'teams', 'tournaments', 'missions', 
        'activities', 'classes', 'currentYear', 'currentWeek'
    ];
    
    safeKeys.forEach(function(key) {
        if (data[key] !== undefined && data[key] !== null) {
            if (Array.isArray(data[key])) {
                copy[key] = data[key].map(function(item) {
                    if (item && typeof item === 'object') {
                        var clean = {};
                        for (var prop in item) {
                            var val = item[prop];
                            if (typeof val !== 'function' && 
                                typeof val !== 'undefined' &&
                                !(typeof val === 'object' && val === item)) {
                                if (typeof val === 'object' && val !== null) {
                                    try {
                                        clean[prop] = JSON.parse(JSON.stringify(val));
                                    } catch (e) {
                                        clean[prop] = null;
                                    }
                                } else {
                                    clean[prop] = val;
                                }
                            }
                        }
                        return clean;
                    }
                    return item;
                });
            } else {
                copy[key] = data[key];
            }
        } else {
            copy[key] = Array.isArray(data[key]) ? [] : null;
        }
    });
    
    // Copy curriculum - only safe fields
    if (data.curriculum) {
        var curriculum = {};
        var curriculumKeys = [
            'disciplines', 'schedules', 'restDays', 'examDays', 
            'grades', 'rankings', 'currentWeek', 'classInstructors',
            'classLabels', 'classGroupLabels', 'classDurations',
            'instructorClasses', 'instructorTemplates', 'instructorBlocks',
            'instructorGroups', 'disciplineGroups', 'autoGroups'
        ];
        
        curriculumKeys.forEach(function(key) {
            if (data.curriculum[key] !== undefined) {
                if (Array.isArray(data.curriculum[key])) {
                    curriculum[key] = data.curriculum[key].slice(0, 500);
                } else if (typeof data.curriculum[key] === 'object' && data.curriculum[key] !== null) {
                    try {
                        curriculum[key] = JSON.parse(JSON.stringify(data.curriculum[key]));
                    } catch (e) {
                        curriculum[key] = {};
                    }
                } else {
                    curriculum[key] = data.curriculum[key];
                }
            } else {
                curriculum[key] = Array.isArray(data.curriculum[key]) ? [] : {};
            }
        });
        copy.curriculum = curriculum;
    } else {
        copy.curriculum = getEmptyData().curriculum;
    }
    
    // Copy social - only safe fields
    if (data.social) {
        var social = {
            relationships: [],
            relationshipTypes: [],
            nextId: data.social.nextId || 1
        };
        
        if (data.social.relationships && Array.isArray(data.social.relationships)) {
            social.relationships = data.social.relationships.slice(0, 500);
        }
        
        if (data.social.relationshipTypes && Array.isArray(data.social.relationshipTypes)) {
            social.relationshipTypes = data.social.relationshipTypes.slice(0, 20);
        }
        
        copy.social = social;
    } else {
        copy.social = getEmptyData().social;
    }
    
    // Copy statsConfig
    if (data.statsConfig) {
        try {
            copy.statsConfig = JSON.parse(JSON.stringify(data.statsConfig));
        } catch (e) {
            copy.statsConfig = getEmptyData().statsConfig;
        }
    } else {
        copy.statsConfig = getEmptyData().statsConfig;
    }
    
    return copy;
}

// ============================================================
// LOAD DATA
// ============================================================

function loadData() {
    if (isLoading) {
        return new Promise(function(resolve) {
            var checkInterval = setInterval(function() {
                if (!isLoading) {
                    clearInterval(checkInterval);
                    resolve(window.data || data || getEmptyData());
                }
            }, 50);
        });
    }
    
    isLoading = true;
    
    return new Promise(function(resolve) {
        if (db && typeof db.transaction === 'function') {
            doLoadData(resolve);
            return;
        }
        
        openDatabase()
            .then(function(result) {
                if (result && typeof result.transaction === 'function') {
                    db = result;
                    doLoadData(resolve);
                } else {
                    console.warn('Database not available, using empty data');
                    data = getEmptyData();
                    window.data = data;
                    isLoading = false;
                    resolve(data);
                }
            })
            .catch(function(err) {
                console.error('Failed to open database:', err);
                data = getEmptyData();
                window.data = data;
                isLoading = false;
                resolve(data);
            });
    });
}

function doLoadData(resolve) {
    if (!db || typeof db.transaction !== 'function') {
        console.warn('Database not available, using empty data');
        data = getEmptyData();
        window.data = data;
        isLoading = false;
        resolve(data);
        return;
    }

    try {
        var transaction = db.transaction([STORE_NAME], 'readonly');
        var store = transaction.objectStore(STORE_NAME);
        var request = store.get('mainData');
        
        request.onsuccess = function() {
            isLoading = false;
            if (request.result && request.result.data) {
                data = request.result.data;
                ensureDataStructure(data);
                migrateData(data);
                window.data = data;
                console.log('Data loaded from IndexedDB');
                resolve(data);
            } else {
                console.log('No data in IndexedDB, using empty data');
                data = getEmptyData();
                window.data = data;
                resolve(data);
            }
        };
        request.onerror = function(event) {
            isLoading = false;
            console.error('IndexedDB load error:', event.target.error);
            data = getEmptyData();
            window.data = data;
            resolve(data);
        };
        transaction.onerror = function(event) {
            isLoading = false;
            console.error('Transaction error:', event.target.error);
            data = getEmptyData();
            window.data = data;
            resolve(data);
        };
    } catch (err) {
        isLoading = false;
        console.error('Error in doLoadData:', err);
        data = getEmptyData();
        window.data = data;
        resolve(data);
    }
}

// ============================================================
// SAVE DATA - FIXED
// ============================================================

function saveData() {
    if (isSaving) {
        return Promise.resolve();
    }
    
    isSaving = true;
    
    return new Promise(function(resolve) {
        // Ensure database is open
        function doSave() {
            if (!db || typeof db.transaction !== 'function') {
                openDatabase()
                    .then(function(result) {
                        if (result && typeof result.transaction === 'function') {
                            db = result;
                            doSave();
                        } else {
                            isSaving = false;
                            console.warn('Database not available, skipping save');
                            resolve();
                        }
                    })
                    .catch(function(err) {
                        isSaving = false;
                        console.error('Failed to open database for save:', err);
                        resolve();
                    });
                return;
            }
            
            try {
                if (window.data) {
                    data = window.data;
                }
                
                if (!data) {
                    data = getEmptyData();
                    window.data = data;
                }
                
                ensureDataStructure(data);
                
                // Create a clean copy for storage
                var safeData = createSafeCopy(data);
                
                var transaction = db.transaction([STORE_NAME], 'readwrite');
                var store = transaction.objectStore(STORE_NAME);
                var record = {
                    id: 'mainData',
                    data: safeData,
                    updatedAt: new Date().toISOString()
                };
                var request = store.put(record);
                
                request.onsuccess = function() {
                    isSaving = false;
                    console.log('Data saved to IndexedDB');
                    resolve();
                };
                request.onerror = function(event) {
                    isSaving = false;
                    console.error('IndexedDB save error:', event.target.error);
                    resolve();
                };
                transaction.onerror = function(event) {
                    isSaving = false;
                    console.error('Transaction error:', event.target.error);
                    resolve();
                };
            } catch (err) {
                isSaving = false;
                console.error('Error in saveData:', err);
                resolve();
            }
        }
        
        doSave();
    });
}

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

// Expose globals
window.db = {
    openDatabase: openDatabase,
    loadData: loadData,
    saveData: saveData,
    getEmptyData: getEmptyData,
    getDefaultMagicProficiencies: getDefaultMagicProficiencies,
    autoLoadData: autoLoadData,
    createSafeCopy: createSafeCopy,
    safeStringify: safeStringify
};

window.loadData = loadData;
window.saveData = saveData;
window.getEmptyData = getEmptyData;
window.getDefaultMagicProficiencies = getDefaultMagicProficiencies;

// Auto-load immediately with a slight delay
setTimeout(autoLoadData, 50);

console.log('database.js loaded - auto-loading data');
