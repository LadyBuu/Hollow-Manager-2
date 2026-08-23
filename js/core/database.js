/**
 * js/core/database.js - IndexedDB Operations
 * Handles all persistent storage for the Hollow Blades Manager
 * Path: js/core/database.js
 */

var DB_NAME = 'HollowBladesDB';
var DB_VERSION = 10;
var STORE_NAME = 'appData';

var db = null;
var data = null;

function openDatabase() {
    return new Promise(function(resolve, reject) {
        var request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = function() { reject(request.error); };
        
        request.onsuccess = function() {
            db = request.result;
            resolve(db);
        };
        
        request.onupgradeneeded = function(event) {
            var database = event.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
    });
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
                { id: 'barbarian', label: 'Barbarian', icon: '\uD83D\uDE08', primaryStats: ['str', 'con'], secondaryStats: ['dex'], statWeights: { str: 0.4, con: 0.3, dex: 0.2, wis: 0.1 }, minStats: { str: 13, con: 12 } },
                { id: 'bard', label: 'Bard', icon: '\uD83C\uDFB8', primaryStats: ['cha', 'dex'], secondaryStats: ['int', 'wis'], statWeights: { cha: 0.35, dex: 0.25, int: 0.2, wis: 0.15, con: 0.05 }, minStats: { cha: 13, dex: 12 } },
                { id: 'cleric', label: 'Cleric', icon: '\u2728', primaryStats: ['wis', 'con'], secondaryStats: ['str', 'cha'], statWeights: { wis: 0.35, con: 0.25, str: 0.2, cha: 0.15, dex: 0.05 }, minStats: { wis: 13, con: 12 } },
                { id: 'druid', label: 'Druid', icon: '\uD83C\uDF31', primaryStats: ['wis', 'con'], secondaryStats: ['int', 'dex'], statWeights: { wis: 0.35, con: 0.25, int: 0.2, dex: 0.15, str: 0.05 }, minStats: { wis: 13, con: 12 } },
                { id: 'fighter', label: 'Fighter', icon: '\uD83D\uDDE1\uFE0F', primaryStats: ['str', 'con'], secondaryStats: ['dex'], statWeights: { str: 0.35, con: 0.3, dex: 0.25, wis: 0.1 }, minStats: { str: 13, con: 12 } },
                { id: 'monk', label: 'Monk', icon: '\uD83E\uDDD8', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'str'], statWeights: { dex: 0.35, wis: 0.3, con: 0.2, str: 0.15 }, minStats: { dex: 13, wis: 13 } },
                { id: 'paladin', label: 'Paladin', icon: '\uD83D\uDEE1\uFE0F', primaryStats: ['str', 'cha'], secondaryStats: ['con', 'wis'], statWeights: { str: 0.3, cha: 0.3, con: 0.2, wis: 0.15, dex: 0.05 }, minStats: { str: 13, cha: 13 } },
                { id: 'ranger', label: 'Ranger', icon: '\uD83C\uDFF7\uFE0F', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'str'], statWeights: { dex: 0.35, wis: 0.25, con: 0.2, str: 0.15, int: 0.05 }, minStats: { dex: 13, wis: 12 } },
                { id: 'rogue', label: 'Rogue', icon: '\uD83D\uDD77\uFE0F', primaryStats: ['dex', 'int'], secondaryStats: ['cha', 'wis'], statWeights: { dex: 0.35, int: 0.25, cha: 0.2, wis: 0.15, str: 0.05 }, minStats: { dex: 13, int: 12 } },
                { id: 'sorcerer', label: 'Sorcerer', icon: '\uD83D\uDD25', primaryStats: ['cha', 'con'], secondaryStats: ['dex', 'int'], statWeights: { cha: 0.4, con: 0.2, dex: 0.2, int: 0.15, wis: 0.05 }, minStats: { cha: 13, con: 12 } },
                { id: 'warlock', label: 'Warlock', icon: '\uD83D\uDD6F\uFE0F', primaryStats: ['cha', 'con'], secondaryStats: ['dex', 'int'], statWeights: { cha: 0.35, con: 0.25, dex: 0.2, int: 0.15, wis: 0.05 }, minStats: { cha: 13, con: 12 } },
                { id: 'wizard', label: 'Wizard', icon: '\uD83E\uDDE0', primaryStats: ['int', 'con'], secondaryStats: ['dex', 'wis'], statWeights: { int: 0.4, con: 0.2, dex: 0.2, wis: 0.15, cha: 0.05 }, minStats: { int: 13, con: 12 } },
                { id: 'artificer', label: 'Artificer', icon: '\uD83D\uDD27', primaryStats: ['int', 'con'], secondaryStats: ['dex', 'wis'], statWeights: { int: 0.35, con: 0.25, dex: 0.2, wis: 0.15, cha: 0.05 }, minStats: { int: 13, con: 12 } },
                { id: 'blood_hunter', label: 'Blood Hunter', icon: '\uD83D\uDD2A', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'str'], statWeights: { dex: 0.3, wis: 0.3, con: 0.2, str: 0.15, int: 0.05 }, minStats: { dex: 13, wis: 13 } },
                { id: 'gunslinger', label: 'Gunslinger', icon: '\uD83D\uDD2B', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'int'], statWeights: { dex: 0.35, wis: 0.25, con: 0.2, int: 0.15, str: 0.05 }, minStats: { dex: 13, wis: 12 } },
                { id: 'inquisitive', label: 'Inquisitive', icon: '\uD83D\uDD0D', primaryStats: ['int', 'wis'], secondaryStats: ['dex', 'cha'], statWeights: { int: 0.3, wis: 0.3, dex: 0.2, cha: 0.15, con: 0.05 }, minStats: { int: 13, wis: 13 } },
                { id: 'mystic', label: 'Mystic', icon: '\uD83E\uDDF8', primaryStats: ['int', 'wis'], secondaryStats: ['con', 'cha'], statWeights: { int: 0.3, wis: 0.3, con: 0.2, cha: 0.15, dex: 0.05 }, minStats: { int: 13, wis: 13 } },
                { id: 'samurai', label: 'Samurai', icon: '\uD83D\uDDE1\uFE0F', primaryStats: ['str', 'wis'], secondaryStats: ['dex', 'con'], statWeights: { str: 0.3, wis: 0.25, dex: 0.2, con: 0.2, cha: 0.05 }, minStats: { str: 13, wis: 12 } },
                { id: 'shadow_weaver', label: 'Shadow Weaver', icon: '\uD83C\uDF03', primaryStats: ['int', 'dex'], secondaryStats: ['cha', 'con'], statWeights: { int: 0.3, dex: 0.25, cha: 0.2, con: 0.15, wis: 0.1 }, minStats: { int: 13, dex: 13 } },
                { id: 'warden', label: 'Warden', icon: '\uD83C\uDF33', primaryStats: ['str', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { str: 0.3, wis: 0.25, con: 0.2, dex: 0.2, cha: 0.05 }, minStats: { str: 13, wis: 12 } },
                { id: 'witch_hunter', label: 'Witch Hunter', icon: '\uD83D\uDD6F\uFE0F', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'int'], statWeights: { dex: 0.3, wis: 0.25, con: 0.2, int: 0.15, str: 0.1 }, minStats: { dex: 13, wis: 12 } }
            ]
        }
    };
}

function loadData() {
    return new Promise(function(resolve, reject) {
        if (!db) {
            return openDatabase()
                .then(function() { return loadData(); })
                .then(resolve)
                .catch(reject);
        }
        
        var transaction = db.transaction([STORE_NAME], 'readonly');
        var store = transaction.objectStore(STORE_NAME);
        var request = store.get('mainData');
        
        request.onsuccess = function() {
            if (request.result && request.result.data) {
                data = request.result.data;
                ensureDataStructure(data);
                migrateData(data);
                window.data = data;
                resolve(data);
            } else {
                data = getEmptyData();
                window.data = data;
                resolve(data);
            }
        };
        request.onerror = function() { reject(request.error); };
    });
}

function saveData() {
    return new Promise(function(resolve, reject) {
        if (!db) {
            return openDatabase()
                .then(function() { return saveData(); })
                .then(resolve)
                .catch(reject);
        }
        
        if (window.data) {
            data = window.data;
        }
        
        ensureDataStructure(data);
        
        var transaction = db.transaction([STORE_NAME], 'readwrite');
        var store = transaction.objectStore(STORE_NAME);
        var record = {
            id: 'mainData',
            data: data,
            updatedAt: new Date().toISOString()
        };
        var request = store.put(record);
        
        request.onsuccess = function() { resolve(); };
        request.onerror = function() { reject(request.error); };
        transaction.onerror = function(event) { reject(event.target.error); };
    });
}

function ensureDataStructure(data) {
    if (!data.tournaments) data.tournaments = [];
    if (!data.characters) data.characters = [];
    if (!data.teams) data.teams = [];
    if (!data.missions) data.missions = [];
    if (!data.activities) data.activities = [];
    if (!data.currentYear) data.currentYear = new Date().getFullYear();
    if (!data.currentWeek) data.currentWeek = 1;
    
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
                { id: 'barbarian', label: 'Barbarian', icon: '\uD83D\uDE08', primaryStats: ['str', 'con'], secondaryStats: ['dex'], statWeights: { str: 0.4, con: 0.3, dex: 0.2, wis: 0.1 }, minStats: { str: 13, con: 12 } },
                { id: 'bard', label: 'Bard', icon: '\uD83C\uDFB8', primaryStats: ['cha', 'dex'], secondaryStats: ['int', 'wis'], statWeights: { cha: 0.35, dex: 0.25, int: 0.2, wis: 0.15, con: 0.05 }, minStats: { cha: 13, dex: 12 } },
                { id: 'cleric', label: 'Cleric', icon: '\u2728', primaryStats: ['wis', 'con'], secondaryStats: ['str', 'cha'], statWeights: { wis: 0.35, con: 0.25, str: 0.2, cha: 0.15, dex: 0.05 }, minStats: { wis: 13, con: 12 } },
                { id: 'druid', label: 'Druid', icon: '\uD83C\uDF31', primaryStats: ['wis', 'con'], secondaryStats: ['int', 'dex'], statWeights: { wis: 0.35, con: 0.25, int: 0.2, dex: 0.15, str: 0.05 }, minStats: { wis: 13, con: 12 } },
                { id: 'fighter', label: 'Fighter', icon: '\uD83D\uDDE1\uFE0F', primaryStats: ['str', 'con'], secondaryStats: ['dex'], statWeights: { str: 0.35, con: 0.3, dex: 0.25, wis: 0.1 }, minStats: { str: 13, con: 12 } },
                { id: 'monk', label: 'Monk', icon: '\uD83E\uDDD8', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'str'], statWeights: { dex: 0.35, wis: 0.3, con: 0.2, str: 0.15 }, minStats: { dex: 13, wis: 13 } },
                { id: 'paladin', label: 'Paladin', icon: '\uD83D\uDEE1\uFE0F', primaryStats: ['str', 'cha'], secondaryStats: ['con', 'wis'], statWeights: { str: 0.3, cha: 0.3, con: 0.2, wis: 0.15, dex: 0.05 }, minStats: { str: 13, cha: 13 } },
                { id: 'ranger', label: 'Ranger', icon: '\uD83C\uDFF7\uFE0F', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'str'], statWeights: { dex: 0.35, wis: 0.25, con: 0.2, str: 0.15, int: 0.05 }, minStats: { dex: 13, wis: 12 } },
                { id: 'rogue', label: 'Rogue', icon: '\uD83D\uDD77\uFE0F', primaryStats: ['dex', 'int'], secondaryStats: ['cha', 'wis'], statWeights: { dex: 0.35, int: 0.25, cha: 0.2, wis: 0.15, str: 0.05 }, minStats: { dex: 13, int: 12 } },
                { id: 'sorcerer', label: 'Sorcerer', icon: '\uD83D\uDD25', primaryStats: ['cha', 'con'], secondaryStats: ['dex', 'int'], statWeights: { cha: 0.4, con: 0.2, dex: 0.2, int: 0.15, wis: 0.05 }, minStats: { cha: 13, con: 12 } },
                { id: 'warlock', label: 'Warlock', icon: '\uD83D\uDD6F\uFE0F', primaryStats: ['cha', 'con'], secondaryStats: ['dex', 'int'], statWeights: { cha: 0.35, con: 0.25, dex: 0.2, int: 0.15, wis: 0.05 }, minStats: { cha: 13, con: 12 } },
                { id: 'wizard', label: 'Wizard', icon: '\uD83E\uDDE0', primaryStats: ['int', 'con'], secondaryStats: ['dex', 'wis'], statWeights: { int: 0.4, con: 0.2, dex: 0.2, wis: 0.15, cha: 0.05 }, minStats: { int: 13, con: 12 } },
                { id: 'artificer', label: 'Artificer', icon: '\uD83D\uDD27', primaryStats: ['int', 'con'], secondaryStats: ['dex', 'wis'], statWeights: { int: 0.35, con: 0.25, dex: 0.2, wis: 0.15, cha: 0.05 }, minStats: { int: 13, con: 12 } },
                { id: 'blood_hunter', label: 'Blood Hunter', icon: '\uD83D\uDD2A', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'str'], statWeights: { dex: 0.3, wis: 0.3, con: 0.2, str: 0.15, int: 0.05 }, minStats: { dex: 13, wis: 13 } },
                { id: 'gunslinger', label: 'Gunslinger', icon: '\uD83D\uDD2B', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'int'], statWeights: { dex: 0.35, wis: 0.25, con: 0.2, int: 0.15, str: 0.05 }, minStats: { dex: 13, wis: 12 } },
                { id: 'inquisitive', label: 'Inquisitive', icon: '\uD83D\uDD0D', primaryStats: ['int', 'wis'], secondaryStats: ['dex', 'cha'], statWeights: { int: 0.3, wis: 0.3, dex: 0.2, cha: 0.15, con: 0.05 }, minStats: { int: 13, wis: 13 } },
                { id: 'mystic', label: 'Mystic', icon: '\uD83E\uDDF8', primaryStats: ['int', 'wis'], secondaryStats: ['con', 'cha'], statWeights: { int: 0.3, wis: 0.3, con: 0.2, cha: 0.15, dex: 0.05 }, minStats: { int: 13, wis: 13 } },
                { id: 'samurai', label: 'Samurai', icon: '\uD83D\uDDE1\uFE0F', primaryStats: ['str', 'wis'], secondaryStats: ['dex', 'con'], statWeights: { str: 0.3, wis: 0.25, dex: 0.2, con: 0.2, cha: 0.05 }, minStats: { str: 13, wis: 12 } },
                { id: 'shadow_weaver', label: 'Shadow Weaver', icon: '\uD83C\uDF03', primaryStats: ['int', 'dex'], secondaryStats: ['cha', 'con'], statWeights: { int: 0.3, dex: 0.25, cha: 0.2, con: 0.15, wis: 0.1 }, minStats: { int: 13, dex: 13 } },
                { id: 'warden', label: 'Warden', icon: '\uD83C\uDF33', primaryStats: ['str', 'wis'], secondaryStats: ['con', 'dex'], statWeights: { str: 0.3, wis: 0.25, con: 0.2, dex: 0.2, cha: 0.05 }, minStats: { str: 13, wis: 12 } },
                { id: 'witch_hunter', label: 'Witch Hunter', icon: '\uD83D\uDD6F\uFE0F', primaryStats: ['dex', 'wis'], secondaryStats: ['con', 'int'], statWeights: { dex: 0.3, wis: 0.25, con: 0.2, int: 0.15, str: 0.1 }, minStats: { dex: 13, wis: 12 } }
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

// Expose globals
window.db = {
    openDatabase: openDatabase,
    loadData: loadData,
    saveData: saveData,
    getEmptyData: getEmptyData,
    getDefaultMagicProficiencies: getDefaultMagicProficiencies
};

window.loadData = loadData;
window.saveData = saveData;
window.getEmptyData = getEmptyData;
window.getDefaultMagicProficiencies = getDefaultMagicProficiencies;