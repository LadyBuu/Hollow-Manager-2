/**
 * js/constants.js - Shared Constants Module
 * Single source of truth for all application constants
 * Path: js/constants.js
 * 
 * This module provides:
 *   - Calendar constants (week, day, hour ranges)
 *   - Magic system constants (types, categories, max values)
 *   - Stats constants (min, max, defaults)
 *   - Relationship constants (color whitelist)
 *   - UI constants (animation, breakpoints, delays)
 *   - Status constants (valid statuses for all entity types)
 *   - Validation constants (length limits, counts)
 *   - Data version constants
 *   - Character constants (magic, stats, classes - SINGLE SOURCE OF TRUTH)
 * 
 * IMPORTANT:
 *   - Load this module FIRST before any other module
 *   - All constants are exposed on the window object
 *   - Constants are READ-ONLY - do not modify them at runtime
 *   - Use these constants instead of duplicating values
 *   - Helper functions are provided for derived values
 *   - This is the SINGLE SOURCE OF TRUTH for character constants
 * 
 * LOAD ORDER:
 *   <script src="js/constants.js"></script>  <!-- FIRST -->
 *   <script src="js/utils/dom-utils.js"></script>
 *   <script src="js/utils/core-utils.js"></script>
 *   <!-- All other modules -->
 */

(function() {
    'use strict';

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================
    
    // This is the FIRST module loaded, but we still need the guard
    // in case of script reloading or duplicate script tags
    if (window.__constantsLoaded) {
        return;
    }
    window.__constantsLoaded = true;

    // ============================================================
    // CALENDAR CONSTANTS
    // ============================================================

    window.CALENDAR_CONSTANTS = {
        /** Minimum week number (1-indexed) */
        MIN_WEEK: 1,
        /** Maximum week number (1-indexed) */
        MAX_WEEK: 52,
        /** Minimum day number (Monday = 1) */
        MIN_DAY: 1,
        /** Maximum day number (Sunday = 7) */
        MAX_DAY: 7,
        /** Minimum hour (0 = midnight) */
        MIN_HOUR: 0,
        /** Maximum hour (23 = 11pm) */
        MAX_HOUR: 23,
        /** Calendar display start hour (5am) */
        CALENDAR_START_HOUR: 5,
        /** Calendar display end hour (11pm) */
        CALENDAR_END_HOUR: 23,
        /** Days in a week */
        DAYS_IN_WEEK: 7,
        /** Minimum year for validation */
        MIN_YEAR: 1900,
        /** Maximum year for validation */
        MAX_YEAR: 9999,
        /** Default year (current year) */
        DEFAULT_YEAR: function() {
            return new Date().getFullYear();
        },
        /** Day names (1-indexed: Monday = 1, Sunday = 7) */
        DAY_NAMES: ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        /** Short day names (1-indexed) */
        DAY_NAMES_SHORT: ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        /** Minute day names (1-indexed) */
        DAY_NAMES_MIN: ['', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
        /** Day names (0-indexed: Sunday = 0, Saturday = 6) */
        DAY_NAMES_0: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        /** Short day names (0-indexed) */
        DAY_NAMES_SHORT_0: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        /** Minute day names (0-indexed) */
        DAY_NAMES_MIN_0: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
    };

    // ============================================================
    // MAGIC CONSTANTS
    // ============================================================

    window.MAGIC_CONSTANTS = {
        /** Maximum magic proficiency (0-10 scale) */
        MAX: 10,
        /** All magic type keys in display order */
        TYPES: [
            'earth', 'water', 'fire', 'air', 'metal', 'wood',
            'blood', 'bone', 'mind', 'morphic', 'life', 'death',
            'space', 'time', 'dimension', 'void', 'reality', 'transference'
        ],
        /** Magic type metadata */
        TYPE_METADATA: {
            earth: { id: 'earth', label: 'Earth Magic', category: 'elemental', color: '#8B7355' },
            water: { id: 'water', label: 'Water Magic', category: 'elemental', color: '#4A9BC7' },
            fire: { id: 'fire', label: 'Fire Magic', category: 'elemental', color: '#E67E22' },
            air: { id: 'air', label: 'Air Magic', category: 'elemental', color: '#A8D5E2' },
            metal: { id: 'metal', label: 'Metal Magic', category: 'elemental', color: '#95A5A6' },
            wood: { id: 'wood', label: 'Wood Magic', category: 'elemental', color: '#27AE60' },
            blood: { id: 'blood', label: 'Blood Magic', category: 'body', color: '#C0392B' },
            bone: { id: 'bone', label: 'Bone Magic', category: 'body', color: '#F5F5DC' },
            mind: { id: 'mind', label: 'Mind Magic', category: 'body', color: '#8E44AD' },
            morphic: { id: 'morphic', label: 'Morphic Magic', category: 'body', color: '#1ABC9C' },
            life: { id: 'life', label: 'Life Magic', category: 'body', color: '#2ECC71' },
            death: { id: 'death', label: 'Death Magic', category: 'body', color: '#2C3E50' },
            space: { id: 'space', label: 'Space Magic', category: 'aether', color: '#3498DB' },
            time: { id: 'time', label: 'Time Magic', category: 'aether', color: '#F39C12' },
            dimension: { id: 'dimension', label: 'Dimension Magic', category: 'aether', color: '#9B59B6' },
            void: { id: 'void', label: 'Void Magic', category: 'aether', color: '#1A1A2E' },
            reality: { id: 'reality', label: 'Reality Magic', category: 'aether', color: '#F1C40F' },
            transference: { id: 'transference', label: 'Transference Magic', category: 'aether', color: '#E74C3C' }
        },
        /** Magic categories */
        CATEGORIES: {
            elemental: {
                label: 'Elemental Magic',
                color: '#8cbb3a',
                types: ['earth', 'water', 'fire', 'air', 'metal', 'wood']
            },
            body: {
                label: 'Body Magic',
                color: '#c1453c',
                types: ['blood', 'bone', 'mind', 'morphic', 'life', 'death']
            },
            aether: {
                label: 'Aether Magic',
                color: '#4a9bc7',
                types: ['space', 'time', 'dimension', 'void', 'reality', 'transference']
            }
        },
        /** Balanced mage threshold (minimum proficiency in each type of a category) */
        BALANCED_MAGE_THRESHOLD: 3
    };

    // ============================================================
    // STATS CONSTANTS
    // ============================================================

    window.STATS_CONSTANTS = {
        /** Minimum stat value */
        MIN: 1,
        /** Maximum stat value */
        MAX: 50,
        /** Default stat value */
        DEFAULT: 10,
        /** Maximum number of special moves per type */
        MAX_SPECIAL_MOVES: 20,
        /** Maximum length of a move name */
        MAX_MOVE_NAME_LENGTH: 100,
        /** Maximum length of a move description */
        MAX_MOVE_DESCRIPTION_LENGTH: 500,
        /** Stat keys in display order */
        STAT_KEYS: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
        /** Stat display labels */
        STAT_LABELS: {
            str: { label: 'Strength', abbr: 'STR' },
            dex: { label: 'Dexterity', abbr: 'DEX' },
            con: { label: 'Constitution', abbr: 'CON' },
            int: { label: 'Intelligence', abbr: 'INT' },
            wis: { label: 'Wisdom', abbr: 'WIS' },
            cha: { label: 'Charisma', abbr: 'CHA' }
        }
    };

    // ============================================================
    // RELATIONSHIP CONSTANTS
    // ============================================================

    window.RELATIONSHIP_CONSTANTS = {
        /** Allowed relationship colors (whitelist for XSS prevention) */
        ALLOWED_COLORS: {
            '#8cbb3a': true,  // familial
            '#c9a24b': true,  // professional
            '#c1453c': true,  // romantic
            '#4a9bc7': true,  // friendship
            '#9b59b6': true,  // mentor
            '#e67e22': true,  // rivalry
            '#27ae60': true,  // alliance
            '#7f8c8d': true   // other
        },
        /** Default relationship color */
        DEFAULT_COLOR: '#7f8c8d',
        /** Relationship type IDs */
        TYPES: ['familial', 'professional', 'romantic', 'friendship', 'mentor', 'rivalry', 'alliance', 'other']
    };

    // ============================================================
    // UI CONSTANTS
    // ============================================================

    window.UI_CONSTANTS = {
        /** Animation duration in milliseconds */
        ANIMATION_DURATION: 300,
        /** Default toast duration in milliseconds */
        TOAST_DEFAULT_DURATION: 3000,
        /** Maximum number of simultaneous notifications */
        MAX_NOTIFICATIONS: 5,
        /** Mobile breakpoint in pixels */
        MOBILE_BREAKPOINT: 768,
        /** Tablet breakpoint in pixels */
        TABLET_BREAKPOINT: 1024,
        /** Filter debounce delay in milliseconds */
        DEBOUNCE_DELAY: 300,
        /** Save cooldown in milliseconds */
        SAVE_COOLDOWN: 500
    };

    // ============================================================
    // STATUS CONSTANTS
    // ============================================================

    window.STATUS_CONSTANTS = {
        /** Valid team statuses */
        VALID_TEAM_STATUSES: ['active', 'inactive', 'deprecated', 'deleted'],
        /** Valid location types */
        VALID_LOCATION_TYPES: ['indoor', 'outdoor', 'pool', 'classroom', 'lab', 'field', 'other'],
        /** Valid discipline types */
        VALID_DISCIPLINE_TYPES: ['mandatory', 'optional'],
        /** Valid career statuses (ordered by seniority) */
        VALID_CAREER_STATUSES: ['civilian', 'trainee', 'rookie', 'junior', 'senior', 'instructor', 'support'],
        /** Student statuses (for filtering) */
        STUDENT_STATUSES: ['trainee', 'rookie', 'junior'],
        /** Instructor statuses (for filtering) */
        INSTRUCTOR_STATUSES: ['instructor', 'teacher', 'professor', 'senior'],
        /** Status display colors */
        STATUS_COLORS: {
            'trainee': 'var(--accent)',
            'rookie': 'var(--accent)',
            'junior': 'var(--warning)',
            'senior': 'var(--warning)',
            'instructor': 'var(--info)',
            'support': 'var(--info)',
            'civilian': 'var(--text-dim)'
        }
    };

    // ============================================================
    // GRADE CONSTANTS
    // ============================================================

    window.GRADE_CONSTANTS = {
        /** Minimum grade score */
        MIN_SCORE: 0,
        /** Maximum grade score */
        MAX_SCORE: 100,
        /** Passing grade threshold */
        PASSING_THRESHOLD: 70,
        /** Grade statuses */
        STATUSES: {
            UNKNOWN: 'unknown',
            UNGRADED: 'ungraded',
            UNWEIGHTED: 'unweighted',
            PASSING: 'passing',
            NEEDS_WORK: 'needs_work'
        }
    };

    // ============================================================
    // ID PREFIX CONSTANTS
    // ============================================================

    window.ID_CONSTANTS = {
        /** ID prefixes for different entity types */
        PREFIXES: {
            CHARACTER: 'char',
            TEAM: 'team',
            CLASS: 'class',
            LOCATION: 'loc',
            DISCIPLINE: 'disc',
            TOURNAMENT: 'tourn',
            MISSION: 'miss',
            RELATIONSHIP: 'rel',
            ELIMINATION: 'elim',
            ACTIVITY: 'act',
            GRADUATING_CLASS: 'gradclass'
        }
    };

    // ============================================================
    // DATA VERSION CONSTANTS
    // ============================================================

    window.DATA_CONSTANTS = {
        /** Current application data version */
        VERSION: 13,
        /** Minimum supported version (for migration) */
        MIN_SUPPORTED_VERSION: 1,
        /** Maximum warning limit for CSV import */
        MAX_WARNINGS: 50
    };

    // ============================================================
    // CHARACTER FIELD CONSTANTS
    // ============================================================

    window.CHARACTER_CONSTANTS = {
        /** Valid name formats */
        NAME_FORMATS: ['firstlast', 'lastfirst', 'nicklast', 'firstnick', 'alias'],
        /** Default name format */
        DEFAULT_NAME_FORMAT: 'firstlast',
        /** Maximum previous names */
        MAX_PREVIOUS_NAMES: 10,
        /** Maximum career status entries */
        MAX_CAREER_STATUS: 20,
        /** Valid attraction values (for suggestions) */
        ATTRACTION_VALUES: ['', 'Women', 'Men', 'All', 'None', 'Other'],
        /** Valid sexuality values (for suggestions) */
        SEXUALITY_VALUES: ['', 'Heterosexual', 'Homosexual', 'Bisexual', 'Pansexual', 'Asexual', 'Questioning', 'Other']
    };

    // ============================================================
    // CLASS DEFINITIONS - SINGLE SOURCE OF TRUTH
    // ============================================================

    window.CLASS_DEFINITIONS = [
        {
            id: 'warrior',
            label: 'Warrior',
            icon: '⚔',
            primaryStats: ['str', 'con'],
            secondaryStats: ['dex'],
            statWeights: { str: 0.5, con: 0.3, dex: 0.15, wis: 0.05 },
            minStats: { str: 14, con: 12 },
            priority: 5,
            description: 'Masters of combat who rely on strength and endurance to overpower their foes.'
        },
        {
            id: 'skirmisher',
            label: 'Skirmisher',
            icon: '🏹',
            primaryStats: ['dex', 'wis'],
            secondaryStats: ['con', 'str'],
            statWeights: { dex: 0.45, wis: 0.25, con: 0.15, str: 0.1, int: 0.05 },
            minStats: { dex: 14, wis: 12 },
            priority: 4,
            description: 'Agile fighters who excel at ranged combat and hit-and-run tactics.'
        },
        {
            id: 'protector',
            label: 'Protector',
            icon: '🛡',
            primaryStats: ['str', 'con'],
            secondaryStats: ['wis', 'cha'],
            statWeights: { str: 0.35, con: 0.35, wis: 0.15, cha: 0.1, dex: 0.05 },
            minStats: { str: 14, con: 14 },
            priority: 4,
            description: 'Defenders who shield others from harm and stand firm against any threat.'
        },
        {
            id: 'sage',
            label: 'Sage',
            icon: '📚',
            primaryStats: ['int', 'wis'],
            secondaryStats: ['con', 'dex'],
            statWeights: { int: 0.4, wis: 0.3, con: 0.15, dex: 0.1, cha: 0.05 },
            minStats: { int: 14, wis: 12 },
            priority: 4,
            description: 'Scholars and keepers of ancient knowledge who wield intellect as their weapon.'
        },
        {
            id: 'mystic',
            label: 'Mystic',
            icon: '✦',
            primaryStats: ['wis', 'cha'],
            secondaryStats: ['con', 'int'],
            statWeights: { wis: 0.4, cha: 0.3, con: 0.15, int: 0.1, dex: 0.05 },
            minStats: { wis: 14, cha: 12 },
            priority: 4,
            description: 'Channelers of spiritual and arcane forces who draw power from within.'
        },
        {
            id: 'stalker',
            label: 'Stalker',
            icon: '🗡',
            primaryStats: ['dex', 'int'],
            secondaryStats: ['cha', 'wis'],
            statWeights: { dex: 0.4, int: 0.25, cha: 0.2, wis: 0.1, str: 0.05 },
            minStats: { dex: 14, int: 12 },
            priority: 4,
            description: 'Masters of stealth and subterfuge who strike from the shadows.'
        },
        {
            id: 'spellblade',
            label: 'Spellblade',
            icon: '⚡',
            primaryStats: ['str', 'int'],
            secondaryStats: ['dex', 'con'],
            statWeights: { str: 0.35, int: 0.35, dex: 0.15, con: 0.1, wis: 0.05 },
            minStats: { str: 13, int: 13 },
            priority: 4,
            description: 'Warriors who weave magic into combat, blending steel and sorcery.'
        },
        {
            id: 'channeler',
            label: 'Channeler',
            icon: '✦',
            primaryStats: ['cha', 'con'],
            secondaryStats: ['dex', 'int'],
            statWeights: { cha: 0.4, con: 0.25, dex: 0.2, int: 0.1, wis: 0.05 },
            minStats: { cha: 14, con: 12 },
            priority: 4,
            description: 'Mages who channel raw magical energy through force of personality.'
        },
        {
            id: 'warden',
            label: 'Warden',
            icon: '⚔',
            primaryStats: ['str', 'wis'],
            secondaryStats: ['con', 'dex'],
            statWeights: { str: 0.35, wis: 0.3, con: 0.2, dex: 0.1, cha: 0.05 },
            minStats: { str: 13, wis: 13 },
            priority: 4,
            description: 'Guardians of nature and natural order who protect the wild places.'
        },
        {
            id: 'adept',
            label: 'Adept',
            icon: '✦',
            primaryStats: ['dex', 'wis'],
            secondaryStats: ['con', 'str'],
            statWeights: { dex: 0.4, wis: 0.35, con: 0.15, str: 0.1, int: 0.05 },
            minStats: { dex: 14, wis: 14 },
            priority: 5,
            description: 'Masters of mind-body discipline who achieve perfection through training.'
        },
        {
            id: 'artificer',
            label: 'Artificer',
            icon: '⚙',
            primaryStats: ['int', 'dex'],
            secondaryStats: ['con', 'wis'],
            statWeights: { int: 0.4, dex: 0.25, con: 0.2, wis: 0.1, cha: 0.05 },
            minStats: { int: 14, dex: 12 },
            priority: 4,
            description: 'Inventors and creators of wondrous devices who blend magic with craft.'
        },
        {
            id: 'occultist',
            label: 'Occultist',
            icon: '✦',
            primaryStats: ['int', 'cha'],
            secondaryStats: ['con', 'dex'],
            statWeights: { int: 0.35, cha: 0.35, con: 0.15, dex: 0.1, wis: 0.05 },
            minStats: { int: 14, cha: 14 },
            priority: 5,
            description: 'Seekers of forbidden and hidden knowledge who bargain with dark powers.'
        },
        {
            id: 'blade_dancer',
            label: 'Blade Dancer',
            icon: '🗡',
            primaryStats: ['dex', 'cha'],
            secondaryStats: ['str', 'con'],
            statWeights: { dex: 0.4, cha: 0.3, str: 0.15, con: 0.1, wis: 0.05 },
            minStats: { dex: 14, cha: 12 },
            priority: 4,
            description: 'Graceful warriors who move like the wind, turning combat into art.'
        },
        {
            id: 'elementalist',
            label: 'Elementalist',
            icon: '✦',
            primaryStats: ['int', 'wis'],
            secondaryStats: ['con', 'dex'],
            statWeights: { int: 0.45, wis: 0.25, con: 0.15, dex: 0.1, cha: 0.05 },
            minStats: { int: 14, wis: 12 },
            priority: 4,
            description: 'Masters of the primal elements who command fire, water, earth, and air.'
        },
        {
            id: 'sentinel',
            label: 'Sentinel',
            icon: '🛡',
            primaryStats: ['str', 'con'],
            secondaryStats: ['wis', 'dex'],
            statWeights: { str: 0.3, con: 0.35, wis: 0.2, dex: 0.1, cha: 0.05 },
            minStats: { str: 14, con: 14 },
            priority: 5,
            description: 'Unyielding guardians and protectors who never retreat from their duty.'
        }
    ];

    // ============================================================
    // HELPER FUNCTIONS - Derived from constants
    // ============================================================

    /**
     * Get all magic type keys.
     * @returns {string[]} Array of magic type keys
     */
    window.getMagicTypeKeys = function() {
        return window.MAGIC_CONSTANTS.TYPES.slice();
    };

    /**
     * Get magic type metadata for a specific type.
     * @param {string} key - Magic type key
     * @returns {object|null} Magic type metadata or null if not found
     */
    window.getMagicTypeMetadata = function(key) {
        return window.MAGIC_CONSTANTS.TYPE_METADATA[key] || null;
    };

    /**
     * Get magic types for a category.
     * @param {string} category - 'elemental' | 'body' | 'aether'
     * @returns {string[]} Array of magic type keys for the category
     */
    window.getMagicCategoryTypes = function(category) {
        var cat = window.MAGIC_CONSTANTS.CATEGORIES[category];
        return cat ? cat.types.slice() : [];
    };

    /**
     * Get magic category metadata.
     * @param {string} category - 'elemental' | 'body' | 'aether'
     * @returns {object|null} Category metadata or null if not found
     */
    window.getMagicCategory = function(category) {
        return window.MAGIC_CONSTANTS.CATEGORIES[category] || null;
    };

    /**
     * Get all stat keys.
     * @returns {string[]} Array of stat keys
     */
    window.getStatKeys = function() {
        return window.STATS_CONSTANTS.STAT_KEYS.slice();
    };

    /**
     * Get stat label.
     * @param {string} key - Stat key
     * @returns {string} Stat label or the key if not found
     */
    window.getStatLabel = function(key) {
        var info = window.STATS_CONSTANTS.STAT_LABELS[key];
        return info ? info.label : key.toUpperCase();
    };

    /**
     * Get stat abbreviation.
     * @param {string} key - Stat key
     * @returns {string} Stat abbreviation or the key if not found
     */
    window.getStatAbbr = function(key) {
        var info = window.STATS_CONSTANTS.STAT_LABELS[key];
        return info ? info.abbr : key.toUpperCase();
    };

    /**
     * Check if a relationship color is allowed.
     * @param {string} color - CSS color value
     * @returns {boolean} True if the color is allowed
     */
    window.isAllowedRelationshipColor = function(color) {
        if (!color || typeof color !== 'string') return false;
        return !!window.RELATIONSHIP_CONSTANTS.ALLOWED_COLORS[color.toLowerCase()];
    };

    /**
     * Get the default relationship color.
     * @returns {string} Default color
     */
    window.getDefaultRelationshipColor = function() {
        return window.RELATIONSHIP_CONSTANTS.DEFAULT_COLOR;
    };

    /**
     * Check if a status is a student status.
     * @param {string} status - Status string
     * @returns {boolean} True if the status is a student status
     */
    window.isStudentStatus = function(status) {
        if (!status || typeof status !== 'string') return false;
        return window.STATUS_CONSTANTS.STUDENT_STATUSES.indexOf(status.toLowerCase()) !== -1;
    };

    /**
     * Check if a status is an instructor status.
     * @param {string} status - Status string
     * @returns {boolean} True if the status is an instructor status
     */
    window.isInstructorStatus = function(status) {
        if (!status || typeof status !== 'string') return false;
        return window.STATUS_CONSTANTS.INSTRUCTOR_STATUSES.indexOf(status.toLowerCase()) !== -1;
    };

    /**
     * Get status color.
     * @param {string} status - Status string
     * @returns {string} CSS color value
     */
    window.getStatusColor = function(status) {
        if (!status || typeof status !== 'string') return 'var(--text-dim)';
        var key = status.toLowerCase();
        return window.STATUS_CONSTANTS.STATUS_COLORS[key] || 'var(--text-dim)';
    };

    /**
     * Get the current data version.
     * @returns {number} Current data version
     */
    window.getDataVersion = function() {
        return window.DATA_CONSTANTS.VERSION;
    };

    /**
     * Get character attraction suggestions.
     * @returns {string[]} Array of attraction values
     */
    window.getAttractionValues = function() {
        return window.CHARACTER_CONSTANTS.ATTRACTION_VALUES.slice();
    };

    /**
     * Get character sexuality suggestions.
     * @returns {string[]} Array of sexuality values
     */
    window.getSexualityValues = function() {
        return window.CHARACTER_CONSTANTS.SEXUALITY_VALUES.slice();
    };

    /**
     * Check if a name format is valid.
     * @param {string} format - Name format string
     * @returns {boolean} True if the format is valid
     */
    window.isValidNameFormat = function(format) {
        return window.CHARACTER_CONSTANTS.NAME_FORMATS.indexOf(format) !== -1;
    };

    /**
     * Get a class definition by ID.
     * @param {string} id - Class ID
     * @returns {object|null} Class definition or null if not found
     */
    window.getClassDefinition = function(id) {
        var definitions = window.CLASS_DEFINITIONS;
        for (var i = 0; i < definitions.length; i++) {
            if (definitions[i].id === id) {
                return definitions[i];
            }
        }
        return null;
    };

    /**
     * Check if a class ID is valid.
     * @param {string} id - Class ID
     * @returns {boolean} True if valid
     */
    window.isValidClassId = function(id) {
        var definitions = window.CLASS_DEFINITIONS;
        for (var i = 0; i < definitions.length; i++) {
            if (definitions[i].id === id) {
                return true;
            }
        }
        return false;
    };

    /**
     * Get all class definitions.
     * @returns {object[]} Array of class definitions
     */
    window.getClassDefinitions = function() {
        return window.CLASS_DEFINITIONS.slice();
    };

    /**
     * Get class definitions sorted by priority.
     * @returns {object[]} Array of class definitions sorted by priority
     */
    window.getClassDefinitionsByPriority = function() {
        return window.CLASS_DEFINITIONS.slice().sort(function(a, b) {
            var priorityDiff = (b.priority || 0) - (a.priority || 0);
            if (priorityDiff !== 0) return priorityDiff;
            return (a.label || '').localeCompare(b.label || '');
        });
    };

})();
