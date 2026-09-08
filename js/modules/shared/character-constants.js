/**
 * shared/constants/character-constants.js - Character Constants
 * Single source of truth for all character-related constants
 * 
 * DEPENDENCIES:
 *   - None (self-contained)
 */

(function() {
    'use strict';

    if (window.__characterConstantsLoaded) { return; }
    window.__characterConstantsLoaded = true;

    function deepFreeze(obj) {
        if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) { return obj; }
        var keys = Object.getOwnPropertyNames(obj);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var value = obj[key];
            if (value && typeof value === 'object') { deepFreeze(value); }
        }
        return Object.freeze(obj);
    }

    var STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    var STAT_MIN = 1;
    var STAT_MAX = 50;
    var STAT_DEFAULT = 10;

    var STAT_DEFINITIONS = {
        str: { label: 'Strength', abbreviation: 'STR', description: 'Physical power and athletic ability' },
        dex: { label: 'Dexterity', abbreviation: 'DEX', description: 'Agility, reflexes, and coordination' },
        con: { label: 'Constitution', abbreviation: 'CON', description: 'Endurance, health, and vitality' },
        int: { label: 'Intelligence', abbreviation: 'INT', description: 'Reasoning, memory, and logical thinking' },
        wis: { label: 'Wisdom', abbreviation: 'WIS', description: 'Perception, intuition, and insight' },
        cha: { label: 'Charisma', abbreviation: 'CHA', description: 'Force of personality and social influence' }
    };

    var MAX_SPECIAL_MOVES = 20;
    var MAX_MOVE_NAME_LENGTH = 100;
    var MAX_MOVE_DESCRIPTION_LENGTH = 500;

    var CAREER_STATUS_OPTIONS = [
        { value: '', label: 'Select status...' },
        { value: 'civilian', label: 'Civilian' },
        { value: 'trainee', label: 'Trainee' },
        { value: 'rookie', label: 'Rookie' },
        { value: 'junior', label: 'Junior' },
        { value: 'senior', label: 'Senior' },
        { value: 'instructor', label: 'Instructor' },
        { value: 'support', label: 'Support' }
    ];

    var STUDENT_STATUSES = ['trainee', 'rookie', 'junior'];
    var INSTRUCTOR_STATUSES = ['instructor', 'teacher', 'professor', 'senior'];

    var NAME_FORMATS = ['firstlast', 'lastfirst', 'nicklast', 'firstnick', 'alias'];
    var DEFAULT_NAME_FORMAT = 'firstlast';
    var MAX_PREVIOUS_NAMES = 10;
    var MAX_CAREER_STATUS = 20;

    var ATTRACTION_VALUES = ['', 'Women', 'Men', 'All', 'None', 'Other'];
    var SEXUALITY_VALUES = ['', 'Heterosexual', 'Homosexual', 'Bisexual', 'Pansexual', 'Asexual', 'Questioning', 'Other'];

    function getStatKeys() { return STAT_KEYS.slice(); }
    function getStatDefinitions() { return Object.assign({}, STAT_DEFINITIONS); }
    function getStatDefinition(key) { return STAT_DEFINITIONS[key] || null; }
    function getCareerStatusOptions() { return CAREER_STATUS_OPTIONS.slice(); }
    function getCareerStatusLabels() {
        var labels = {};
        CAREER_STATUS_OPTIONS.forEach(function(opt) {
            if (opt.value) { labels[opt.value] = opt.label; }
        });
        return labels;
    }
    function isStudentStatus(status) {
        if (!status || typeof status !== 'string') { return false; }
        return STUDENT_STATUSES.indexOf(status.toLowerCase()) !== -1;
    }
    function isInstructorStatus(status) {
        if (!status || typeof status !== 'string') { return false; }
        return INSTRUCTOR_STATUSES.indexOf(status.toLowerCase()) !== -1;
    }
    function getAttractionValues() { return ATTRACTION_VALUES.slice(); }
    function getSexualityValues() { return SEXUALITY_VALUES.slice(); }
    function isValidNameFormat(format) { return NAME_FORMATS.indexOf(format) !== -1; }
    function getNameFormatLabels() {
        return {
            'firstlast': 'First + Last',
            'lastfirst': 'Last, First',
            'nicklast': 'Nickname + Last',
            'firstnick': 'First "Nickname"',
            'alias': 'Alias'
        };
    }

    deepFreeze(STAT_KEYS);
    deepFreeze(STAT_DEFINITIONS);
    deepFreeze(CAREER_STATUS_OPTIONS);
    deepFreeze(STUDENT_STATUSES);
    deepFreeze(INSTRUCTOR_STATUSES);
    deepFreeze(NAME_FORMATS);
    deepFreeze(ATTRACTION_VALUES);
    deepFreeze(SEXUALITY_VALUES);

    window.CharacterConstants = Object.freeze({
        STAT_KEYS: STAT_KEYS,
        STAT_MIN: STAT_MIN,
        STAT_MAX: STAT_MAX,
        STAT_DEFAULT: STAT_DEFAULT,
        STAT_DEFINITIONS: STAT_DEFINITIONS,
        MAX_SPECIAL_MOVES: MAX_SPECIAL_MOVES,
        MAX_MOVE_NAME_LENGTH: MAX_MOVE_NAME_LENGTH,
        MAX_MOVE_DESCRIPTION_LENGTH: MAX_MOVE_DESCRIPTION_LENGTH,
        CAREER_STATUS_OPTIONS: CAREER_STATUS_OPTIONS,
        STUDENT_STATUSES: STUDENT_STATUSES,
        INSTRUCTOR_STATUSES: INSTRUCTOR_STATUSES,
        NAME_FORMATS: NAME_FORMATS,
        DEFAULT_NAME_FORMAT: DEFAULT_NAME_FORMAT,
        MAX_PREVIOUS_NAMES: MAX_PREVIOUS_NAMES,
        MAX_CAREER_STATUS: MAX_CAREER_STATUS,
        ATTRACTION_VALUES: ATTRACTION_VALUES,
        SEXUALITY_VALUES: SEXUALITY_VALUES,
        getStatKeys: getStatKeys,
        getStatDefinitions: getStatDefinitions,
        getStatDefinition: getStatDefinition,
        getCareerStatusOptions: getCareerStatusOptions,
        getCareerStatusLabels: getCareerStatusLabels,
        isStudentStatus: isStudentStatus,
        isInstructorStatus: isInstructorStatus,
        getAttractionValues: getAttractionValues,
        getSexualityValues: getSexualityValues,
        isValidNameFormat: isValidNameFormat,
        getNameFormatLabels: getNameFormatLabels
    });

})();
