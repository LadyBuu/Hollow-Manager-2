/**
 * js/core/database.js - IndexedDB Operations
 * Path: js/core/database.js
 */

var DB_NAME = 'HollowBladesDB';
var DB_VERSION = 11; // Incremented for class support
var STORE_NAME = 'appData';

var db = null;
var data = null;
var dbOpenPromise = null;
var isLoading = false;
var isSaving = false;

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
        classes: [], // NEW: classes collection
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
                { id: 'warrior', label: 'Warrior', icon: '⚔️', primaryStats: ['str', 'con'], secondaryStats: ['dex'], statWeights: { str: 0.4, con: 0.3, dex: 0.2, wis: 0.1 }, minStats: { str: 13, con: 12 } },
                { id: 'skirmisher', label: 'Skirmisher', icon: '🏹', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'str'], statWeights: { dex: 0.35, wis: 0.25, con: 0.2, str: 0.15, int: 0.05 }, minStats: { dex: 13, wis: 12 } },
                { id: 'protector', label: 'Protector', icon: '🛡️', primaryStats: ['str', 'con'], secondaryStats: ['wis', 'cha'], statWeights: { str: 0.3, con: 0.3, wis: 0.2, cha: 0.15, dex: 0.05 }, minStats: { str: 13, con: 12 } },
                { id: 'sage', label: 'Sage', icon: '📚', primaryStats: ['int', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { int: 0.35, wis: 0.25, con: 0.2, dex: 0.15, cha: 0.05 }, minStats: { int: 13, wis: 12 } },
                { id: 'mystic', label: 'Mystic', icon: '🔮', primaryStats: ['wis', 'cha'], secondaryStats: ['con', 'int'], statWeights: { wis: 0.35, cha: 0.25, con: 0.2, int: 0.15, dex: 0.05 }, minStats: { wis: 13, cha: 12 } },
                { id: 'stalker', label: 'Stalker', icon: '🗡️', primaryStats: ['dex', 'int'], secondaryStats: ['cha', 'wis'], statWeights: { dex: 0.35, int: 0.25, cha: 0.2, wis: 0.15, str: 0.05 }, minStats: { dex: 13, int: 12 } },
                { id: 'spellblade', label: 'Spellblade', icon: '⚡', primaryStats: ['str', 'int'], secondaryStats: ['dex', 'con'], statWeights: { str: 0.3, int: 0.3, dex: 0.2, con: 0.15, wis: 0.05 }, minStats: { str: 13, int: 12 } },
                { id: 'channeler', label: 'Channeler', icon: '🌀', primaryStats: ['cha', 'con'], secondaryStats: ['dex', 'int'], statWeights: { cha: 0.35, con: 0.25, dex: 0.2, int: 0.15, wis: 0.05 }, minStats: { cha: 13, con: 12 } },
                { id: 'warden', label: 'Warden', icon: '🌿', primaryStats: ['str', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { str: 0.3, wis: 0.25, con: 0.2, dex: 0.2, cha: 0.05 }, minStats: { str: 13, wis: 12 } },
                { id: 'adept', label: 'Adept', icon: '🧘', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'str'], statWeights: { dex: 0.3, wis: 0.3, con: 0.2, str: 0.15, int: 0.05 }, minStats: { dex: 13, wis: 13 } },
                { id: 'artificer', label: 'Artificer', icon: '🔧', primaryStats: ['int', 'dex'], secondaryStats: ['con', 'wis'], statWeights: { int: 0.35, dex: 0.25, con: 0.2, wis: 0.15, cha: 0.05 }, minStats: { int: 13, dex: 12 } },
                { id: 'occultist', label: 'Occultist', icon: '🌙', primaryStats: ['int', 'cha'], secondaryStats: ['con', 'dex'], statWeights: { int: 0.3, cha: 0.3, con: 0.2, dex: 0.15, wis: 0.05 }, minStats: { int: 13, cha: 13 } },
                { id: 'blade_dancer', label: 'Blade Dancer', icon: '🗡️', primaryStats: ['dex', 'cha'], secondaryStats: ['str', 'con'], statWeights: { dex: 0.35, cha: 0.25, str: 0.2, con: 0.15, wis: 0.05 }, minStats: { dex: 13, cha: 12 } },
                { id: 'elementalist', label: 'Elementalist', icon: '🌪️', primaryStats: ['int', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { int: 0.35, wis: 0.25, con: 0.2, dex: 0.15, cha: 0.05 }, minStats: { int: 13, wis: 12 } },
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
    if (!data.classes) data.classes = []; // NEW
    if (!data.currentYear) data.currentYear = new Date().getFullYear();
    if (!data.currentWeek) data.currentWeek = 1;
    
    // Ensure characters have classIds
    data.characters.forEach(function(char) {
        if (!char.classIds) char.classIds = [];
    });
    
    // Ensure teams have classId
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
        data.statsConfig = {
            classes: [
                { id: 'warrior', label: 'Warrior', icon: '⚔️', primaryStats: ['str', 'con'], secondaryStats: ['dex'], statWeights: { str: 0.4, con: 0.3, dex: 0.2, wis: 0.1 }, minStats: { str: 13, con: 12 } },
                { id: 'skirmisher', label: 'Skirmisher', icon: '🏹', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'str'], statWeights: { dex: 0.35, wis: 0.25, con: 0.2, str: 0.15, int: 0.05 }, minStats: { dex: 13, wis: 12 } },
                { id: 'protector', label: 'Protector', icon: '🛡️', primaryStats: ['str', 'con'], secondaryStats: ['wis', 'cha'], statWeights: { str: 0.3, con: 0.3, wis: 0.2, cha: 0.15, dex: 0.05 }, minStats: { str: 13, con: 12 } },
                { id: 'sage', label: 'Sage', icon: '📚', primaryStats: ['int', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { int: 0.35, wis: 0.25, con: 0.2, dex: 0.15, cha: 0.05 }, minStats: { int: 13, wis: 12 } },
                { id: 'mystic', label: 'Mystic', icon: '🔮', primaryStats: ['wis', 'cha'], secondaryStats: ['con', 'int'], statWeights: { wis: 0.35, cha: 0.25, con: 0.2, int: 0.15, dex: 0.05 }, minStats: { wis: 13, cha: 12 } },
                { id: 'stalker', label: 'Stalker', icon: '🗡️', primaryStats: ['dex', 'int'], secondaryStats: ['cha', 'wis'], statWeights: { dex: 0.35, int: 0.25, cha: 0.2, wis: 0.15, str: 0.05 }, minStats: { dex: 13, int: 12 } },
                { id: 'spellblade', label: 'Spellblade', icon: '⚡', primaryStats: ['str', 'int'], secondaryStats: ['dex', 'con'], statWeights: { str: 0.3, int: 0.3, dex: 0.2, con: 0.15, wis: 0.05 }, minStats: { str: 13, int: 12 } },
                { id: 'channeler', label: 'Channeler', icon: '🌀', primaryStats: ['cha', 'con'], secondaryStats: ['dex', 'int'], statWeights: { cha: 0.35, con: 0.25, dex: 0.2, int: 0.15, wis: 0.05 }, minStats: { cha: 13, con: 12 } },
                { id: 'warden', label: 'Warden', icon: '🌿', primaryStats: ['str', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { str: 0.3, wis: 0.25, con: 0.2, dex: 0.2, cha: 0.05 }, minStats: { str: 13, wis: 12 } },
                { id: 'adept', label: 'Adept', icon: '🧘', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'str'], statWeights: { dex: 0.3, wis: 0.3, con: 0.2, str: 0.15, int: 0.05 }, minStats: { dex: 13, wis: 13 } },
                { id: 'artificer', label: 'Artificer', icon: '🔧', primaryStats: ['int', 'dex'], secondaryStats: ['con', 'wis'], statWeights: { int: 0.35, dex: 0.25, con: 0.2, wis: 0.15, cha: 0.05 }, minStats: { int: 13, dex: 12 } },
                { id: 'occultist', label: 'Occultist', icon: '🌙', primaryStats: ['int', 'cha'], secondaryStats: ['con', 'dex'], statWeights: { int: 0.3, cha: 0.3, con: 0.2, dex: 0.15, wis: 0.05 }, minStats: { int: 13, cha: 13 } },
                { id: 'blade_dancer', label: 'Blade Dancer', icon: '🗡️', primaryStats: ['dex', 'cha'], secondaryStats: ['str', 'con'], statWeights: { dex: 0.35, cha: 0.25, str: 0.2, con: 0.15, wis: 0.05 }, minStats: { dex: 13, cha: 12 } },
                { id: 'elementalist', label: 'Elementalist', icon: '🌪️', primaryStats: ['int', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { int: 0.35, wis: 0.25, con: 0.2, dex: 0.15, cha: 0.05 }, minStats: { int: 13, wis: 12 } },
                { id: 'sentinel', label: 'Sentinel', icon: '🏰', primaryStats: ['str', 'con'], secondaryStats: ['wis', 'dex'], statWeights: { str: 0.3, con: 0.3, wis: 0.2, dex: 0.15, cha: 0.05 }, minStats: { str: 13, con: 12 } }
            ]
        };
    }
}

function migrateData(data) {
    // Characters
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
        if (!char.classIds) char.classIds = []; // NEW
        
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
    
    // Teams
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
        if (!team.classId && team.type === 'academic') team.classId = null; // NEW
        if (!team.teamNumber) team.teamNumber = ''; // NEW
        team.members.forEach(function(member) {
            if (!member.role) member.role = 'Member';
            if (!member.joinPeriod) member.joinPeriod = '';
            if (!member.leavePeriod) member.leavePeriod = '';
        });
    });
    
    // Tournaments
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
    
    // Missions
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

function saveData() {
    if (isSaving) {
        return Promise.resolve();
    }
    
    isSaving = true;
    
    return new Promise(function(resolve) {
        if (!db || typeof db.transaction !== 'function') {
            openDatabase()
                .then(function(result) {
                    if (result && typeof result.transaction === 'function') {
                        db = result;
                        saveData().then(resolve);
                    } else {
                        isSaving = false;
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
        
        if (window.data) {
            data = window.data;
        }
        
        if (!data) {
            data = getEmptyData();
            window.data = data;
        }
        
        ensureDataStructure(data);
        
        try {
            var transaction = db.transaction([STORE_NAME], 'readwrite');
            var store = transaction.objectStore(STORE_NAME);
            var record = {
                id: 'mainData',
                data: data,
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
    });
}

// Auto-load data when script loads
function autoLoadData() {
    console.log('Auto-loading data from IndexedDB...');
    loadData().then(function(result) {
        console.log('Data auto-loaded successfully');
        var event = new CustomEvent('dataReady', { detail: { data: result } });
        document.dispatchEvent(event);
    }).catch(function(err) {
        console.error('Auto-load failed:', err);
        var event = new CustomEvent('dataReady', { detail: { data: getEmptyData() } });
        document.dispatchEvent(event);
    });
}

// Expose globals
window.db = {
    openDatabase: openDatabase,
    loadData: loadData,
    saveData: saveData,
    getEmptyData: getEmptyData,
    getDefaultMagicProficiencies: getDefaultMagicProficiencies,
    autoLoadData: autoLoadData
};

window.loadData = loadData;
window.saveData = saveData;
window.getEmptyData = getEmptyData;
window.getDefaultMagicProficiencies = getDefaultMagicProficiencies;

// Auto-load immediately
autoLoadData();

console.log('database.js loaded - auto-loading data');
