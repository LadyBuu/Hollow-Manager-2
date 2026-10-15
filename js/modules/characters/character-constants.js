/**
 * characters/character-constants.js - Character Constants
 * Single source of truth for all character-related constants
 *
 * STATUS TIERS:
 *   - STUDENT_STATUSES:     trainee, rookie, junior, senior, student
 *   - INSTRUCTOR_STATUSES:  instructor
 *   - SUPPORT_STATUSES:     support
 *   - RETIRED_STATUSES:     retired
 *   - All others fall through as civilian/unknown.
 *
 *   `senior` is a STUDENT tier. A senior is a final-year student,
 *   not a teacher. The previous classification as instructor was a
 *   legacy conflation that excluded seniors from academic team
 *   membership eligibility and from any other student-scoped query.
 *
 *   `support` is its own tier. Support staff (medics, technicians,
 *   administrative roles) are neither students nor instructors.
 *   They are excluded from student-scoped and instructor-scoped
 *   queries alike.
 *
 *   `retired` is its own tier. A retired character left the
 *   organisation's active roster and did NOT take a staff role.
 *   They are neither students, nor instructors, nor support. They
 *   are also NOT civilians: `civilian` describes a character who
 *   has not joined (or has never been part of the organisation);
 *   `retired` describes a character who has left it.
 *
 *   `retired` is a MANUAL-ONLY status. The Career Wizard does not
 *   produce it. The wizard generates the on-ramp ladder (trainee,
 *   rookie, junior, senior, support); terminal post-career states
 *   are set by hand in the career-status form.
 *
 *   The tier arrays are DISJOINT and the validator enforces this.
 *   A status string belongs to at most one tier. `teacher` and
 *   `professor` are not currently synonyms for `instructor` in the
 *   tiers, because they do not appear in CAREER_STATUS_OPTIONS and
 *   would therefore be unreachable through the form. If they are
 *   added as real statuses later, add them to both
 *   INSTRUCTOR_STATUSES and CAREER_STATUS_OPTIONS together.
 *
 * PHYSICAL CLASS WEIGHT VECTORS:
 *   Each class's weights define the stat profile that class
 *   rewards. The vectors are ADVISORY-constrained: for every pair
 *   (A, B), dot(A, A) should be >= dot(A, B), so that a character
 *   whose stats were shaped by applyPhysicalClass(X) derives back
 *   to X under derivePhysicalClass. Before this constraint was
 *   enforced, three pairs (fighter/brawler, brawler/barbarian,
 *   tactician/scholar) collapsed.
 *
 *   The constraint is ADVISORY, not enforced. A violation produces
 *   a console.warn naming the offending pair, not a thrown error.
 *   The override UI does not depend on the derivation for display,
 *   so a marginal drift degrades gracefully rather than blocking
 *   the module.
 *
 *   As of the last review, brawler -> fighter still exceeds its
 *   self-dot. If that warning is not present in the console on
 *   reload, the vectors have been retuned since this comment was
 *   written. If it is present, either retune brawler or accept the
 *   marginal drift and update this comment.
 *
 *   If you edit a weight vector, re-run the collapse check (see
 *   the warning in the console on reload) before committing.
 *
 * PHYSICAL CLASS ICONS (monochrome):
 *   Every physical class carries a single-glyph monochrome icon.
 *   The glyphs are plain Unicode symbols, not emoji. They inherit
 *   `color` from their context, so they theme correctly in dark
 *   and light modes.
 *
 *   Do NOT reintroduce emoji here. An emoji glyph ignores the
 *   surrounding text color, renders in its own baked-in palette,
 *   and appears identical in both themes — which is precisely the
 *   behaviour the icon vocabulary is trying to avoid.
 *
 *   The glyph set is drawn from the same families used elsewhere
 *   in the app (the v28 stats-config normalisation in
 *   database.js):
 *
 *     †  U+2020  dagger          — blade classes
 *     ‡  U+2021  double dagger   — paired blade classes
 *     ◈  U+25C8  diamond in diamond — defensive classes
 *     ➶  U+27B6  bow-arc arrow   — ranged classes
 *     ✦  U+2726  four-point star — striking classes
 *     ◉  U+25C9  fisheye lens    — observational classes
 *     ▣  U+25A3  white square in square — tactical classes
 *     ✪  U+272A  circled star    — command classes
 *     ▤  U+25A4  book block      — scholarly classes
 *
 *   Icons are shared across classes; they are family marks, not
 *   unique identifiers. Two blade classes can carry the same
 *   glyph. The header documents the vocabulary, not a rule that
 *   every class must have a distinct icon.
 *
 * deepFreeze:
 *   Imported from window.Constants when available. A local fallback
 *   is used if constants.js has not loaded yet; the two
 *   implementations are identical.
 *
 * DEPENDENCIES:
 *   - window.Constants (preferred; local fallback otherwise)
 */

(function() {
    'use strict';

    if (window.__characterConstantsLoaded) { return; }
    window.__characterConstantsLoaded = true;

    // ---- deepFreeze: prefer the shared helper, fall back locally ----
    function localDeepFreeze(obj) {
        if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) { return obj; }
        var keys = Object.getOwnPropertyNames(obj);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var value = obj[key];
            if (value && typeof value === 'object') { localDeepFreeze(value); }
        }
        return Object.freeze(obj);
    }

    function deepFreeze(obj) {
        if (window.Constants &&
            typeof window.Constants.deepFreeze === 'function') {
            return window.Constants.deepFreeze(obj);
        }
        return localDeepFreeze(obj);
    }

    // ============================================================
    // PHYSICAL STATS
    // ============================================================

    var STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    var STAT_MIN = 1;
    var STAT_MAX = 30;
    var STAT_DEFAULT = 10;

    // Random generation range for physical stats
    var STAT_RANDOM_MIN = 6;
    var STAT_RANDOM_MAX = 18;

    var STAT_DEFINITIONS = {
        str: { label: 'Strength',     abbreviation: 'STR', description: 'Physical power and athletic ability' },
        dex: { label: 'Dexterity',    abbreviation: 'DEX', description: 'Agility, reflexes, and coordination' },
        con: { label: 'Constitution', abbreviation: 'CON', description: 'Endurance, health, and vitality' },
        int: { label: 'Intelligence', abbreviation: 'INT', description: 'Reasoning, memory, and logical thinking' },
        wis: { label: 'Wisdom',       abbreviation: 'WIS', description: 'Perception, intuition, and insight' },
        cha: { label: 'Charisma',     abbreviation: 'CHA', description: 'Force of personality and social influence' }
    };

    // ============================================================
    // PHYSICAL CLASSES
    // ============================================================
    // Classes are DERIVED from physical stats via weighted scoring.
    // Weights sum to 1.0 per class. Higher weight = stat matters more.
    // hpBonus is added on top of the random HP roll.
    //
    // COLLAPSE CONSTRAINT (advisory):
    //   For every pair (A, B), dot(A.weights, A.weights) should be
    //   >= dot(A.weights, B.weights). If not, a character shaped by
    //   applyPhysicalClass(A) can derive to B under some jitter
    //   rolls.
    //
    //   The constraint is monitored, not guaranteed. The validator
    //   emits a console.warn for each pair that violates it. See
    //   the header for the current status of the vectors.

    var PHYSICAL_CLASSES = [
        {
            id: 'barbarian', label: 'Barbarian', icon: '\u2020',
            description: 'Raw physical power, toughness, aggression',
            weights: { str: 0.45, con: 0.30, dex: 0.15, wis: 0.10, int: 0.00, cha: 0.00 },
            hpBonus: 8
        },
        {
            id: 'fighter', label: 'Fighter', icon: '\u2021',
            description: 'Versatile trained combatant',
            weights: { str: 0.35, dex: 0.35, con: 0.20, wis: 0.05, int: 0.05, cha: 0.00 },
            hpBonus: 5
        },
        {
            id: 'guardian', label: 'Guardian', icon: '\u25c8',
            description: 'Defensive fighter, protects others, holds ground',
            weights: { con: 0.35, str: 0.25, wis: 0.25, dex: 0.05, int: 0.05, cha: 0.05 },
            hpBonus: 10
        },
        {
            id: 'rogue', label: 'Rogue', icon: '\u2021',
            description: 'Agility, precision, opportunism, clever tactics',
            weights: { dex: 0.35, int: 0.30, cha: 0.20, str: 0.05, con: 0.05, wis: 0.05 },
            hpBonus: 2
        },
        {
            id: 'ranger', label: 'Ranger', icon: '\u27b6',
            description: 'Mobility, awareness, ranged combat, survival',
            weights: { wis: 0.35, dex: 0.30, con: 0.20, str: 0.10, int: 0.05, cha: 0.00 },
            hpBonus: 4
        },
        {
            id: 'martialist', label: 'Martialist', icon: '\u2726',
            description: 'Discipline, speed, control and unarmed combat',
            weights: { dex: 0.35, con: 0.30, wis: 0.25, str: 0.10, int: 0.00, cha: 0.00 },
            hpBonus: 5
        },
        {
            id: 'brawler', label: 'Brawler', icon: '\u2020',
            description: 'Close-range fighter relying on physical skill',
            weights: { str: 0.40, dex: 0.35, con: 0.20, wis: 0.05, int: 0.00, cha: 0.00 },
            hpBonus: 6
        },
        {
            id: 'duelist', label: 'Duelist', icon: '\u2021',
            description: 'Precision fighter, confidence, reading opponents',
            weights: { dex: 0.35, cha: 0.30, int: 0.20, str: 0.10, wis: 0.05, con: 0.00 },
            hpBonus: 2
        },
        {
            id: 'scout', label: 'Scout', icon: '\u25c9',
            description: 'Reconnaissance, stealth and situational awareness',
            weights: { wis: 0.30, dex: 0.30, int: 0.25, con: 0.15, str: 0.00, cha: 0.00 },
            hpBonus: 3
        },
        {
            id: 'tactician', label: 'Tactician', icon: '\u25a3',
            description: 'Strategic combatant, planning and battlefield control',
            weights: { int: 0.35, cha: 0.30, wis: 0.25, con: 0.10, str: 0.00, dex: 0.00 },
            hpBonus: 2
        },
        {
            id: 'leader', label: 'Leader', icon: '\u272a',
            description: 'Inspires, commands and coordinates others',
            weights: { cha: 0.40, wis: 0.25, int: 0.20, con: 0.15, str: 0.00, dex: 0.00 },
            hpBonus: 3
        },
        {
            id: 'scholar', label: 'Scholar', icon: '\u25a4',
            description: 'Knowledge-focused, analytical and academically capable',
            weights: { int: 0.45, wis: 0.30, cha: 0.15, con: 0.10, str: 0.00, dex: 0.00 },
            hpBonus: 1
        }
    ];

    // ============================================================
    // WEAPON TYPES
    // ============================================================

    var WEAPON_TYPES = [
        { id: 'blunt',          label: 'Blunt' },
        { id: 'sharp',          label: 'Sharp' },
        { id: 'polearm',        label: 'Polearm' },
        { id: 'ranged',         label: 'Ranged' },
        { id: 'thrown',         label: 'Thrown' },
        { id: 'firearm',        label: 'Firearm' },
        { id: 'automagic_wand', label: 'Automagic Wand' },
        { id: 'shield',         label: 'Shield' },
        { id: 'unarmed',        label: 'Unarmed' }
    ];

    var DEFAULT_WEAPON_TYPE = 'sharp';

    // ============================================================
    // HP / MP
    // ============================================================
    //
    // HP_MAX is the hard cap used by CharacterCRUD.normaliseCharacterData
    // (formerly HP_HARD_CAP) and by the form's input[max]. HP_BASE_MIN
    // and HP_BASE_MAX are the natural roll range from rollHP, before
    // class and CON modifiers. They are separate concepts.

    var HP_MIN = 0;
    var HP_MAX = 999;
    var HP_BASE_MIN = 20;
    var HP_BASE_MAX = 40;

    var MP_MIN = 0;
    var MP_MAX = 200;
    var MP_BASE_DIVISOR = 5;         // totalMagic / 5 as base
    var MP_AETHER_MULTIPLIER = 2;    // aether total × this
    var MP_BODY_MULTIPLIER = 0.5;    // body total × this
    var MP_RANDOM_MAX = 10;

    // ============================================================
    // SPECIAL MOVES
    // ============================================================

    var MAX_SPECIAL_MOVES = 20;
    var MAX_MOVE_NAME_LENGTH = 100;
    var MAX_MOVE_DESCRIPTION_LENGTH = 500;

    // ============================================================
    // WEAPONS
    // ============================================================

    var MAX_WEAPONS = 50;
    var MAX_WEAPON_NAME_LENGTH = 100;
    var MAX_WEAPON_NOTES_LENGTH = 300;

    // ============================================================
    // CAREER STATUS
    // ============================================================

    var CAREER_STATUS_OPTIONS = [
        { value: '', label: 'Select status...' },
        { value: 'civilian',   label: 'Civilian' },
        { value: 'trainee',    label: 'Trainee' },
        { value: 'rookie',     label: 'Rookie' },
        { value: 'junior',     label: 'Junior' },
        { value: 'senior',     label: 'Senior' },
        { value: 'instructor', label: 'Instructor' },
        { value: 'support',    label: 'Support' },
        { value: 'retired',    label: 'Retired' }
    ];

    // ============================================================
    // STATUS TIERS
    // ============================================================
    //
    // The tiers are DISJOINT. A status string belongs to at most
    // one tier. The predicates below are mutually exclusive.
    //
    // `instructor` is the only teaching tier. `teacher` and
    // `professor` are not currently statuses, and are deliberately
    // absent from INSTRUCTOR_STATUSES. If they become statuses,
    // add them here and to CAREER_STATUS_OPTIONS together.

    var STUDENT_STATUSES = ['trainee', 'rookie', 'junior', 'senior', 'student'];
    var INSTRUCTOR_STATUSES = ['instructor'];
    var SUPPORT_STATUSES = ['support'];
    var RETIRED_STATUSES = ['retired'];

    // ---- Canonical terminal set ----
    //
    // A status is "terminal" when a character whose LATEST career
    // entry has that status is off the active roster. The set is
    // derived from the tier arrays so it stays in sync if a tier
    // changes. `support` is terminal even though support staff are
    // still part of the organisation, because support staff are
    // not active competitors.
    //
    // character-crud.js consumes this instead of hardcoding its
    // own set. Do not add statuses here without considering the
    // cascade in CharacterCRUD.applyCareerTransitionCascade.

    var TERMINAL_STATUSES = ['retired', 'support', 'instructor'];

    // ============================================================
    // NAME FORMATS
    // ============================================================

    var NAME_FORMATS = ['firstlast', 'lastfirst', 'nicklast', 'firstnick', 'alias'];
    var DEFAULT_NAME_FORMAT = 'firstlast';
    var MAX_PREVIOUS_NAMES = 10;
    var MAX_CAREER_STATUS = 20;

    // ============================================================
    // SOCIAL FIELDS
    // ============================================================
    //
    // ATTRACTION_VALUES and SEXUALITY_VALUES are the canonical
    // vocabulary. The character form currently uses free-text
    // inputs for both, so these lists are unused by the UI. They
    // are exported for callers that want to validate or display
    // a dropdown. The empty string is a legitimate value (meaning
    // "not specified").

    var ATTRACTION_VALUES = ['', 'Women', 'Men', 'All', 'None', 'Other'];
    var SEXUALITY_VALUES = ['', 'Heterosexual', 'Homosexual', 'Bisexual', 'Pansexual', 'Asexual', 'Questioning', 'Other'];

    // ============================================================
    // LOOKUP FUNCTIONS - Physical classes
    // ============================================================

    function getStatKeys() { return STAT_KEYS.slice(); }

    function getStatDefinitions() {
        var copy = {};
        var keys = Object.keys(STAT_DEFINITIONS);
        for (var i = 0; i < keys.length; i++) {
            copy[keys[i]] = STAT_DEFINITIONS[keys[i]];
        }
        return copy;
    }

    function getStatDefinition(key) {
        if (!key || typeof key !== 'string') { return null; }
        if (!Object.prototype.hasOwnProperty.call(STAT_DEFINITIONS, key)) {
            return null;
        }
        return STAT_DEFINITIONS[key];
    }

    function getPhysicalClasses() { return PHYSICAL_CLASSES.slice(); }

    function getPhysicalClass(classId) {
        if (!classId || typeof classId !== 'string') { return null; }
        for (var i = 0; i < PHYSICAL_CLASSES.length; i++) {
            if (PHYSICAL_CLASSES[i].id === classId) {
                return PHYSICAL_CLASSES[i];
            }
        }
        return null;
    }

    function isValidPhysicalClass(classId) {
        return getPhysicalClass(classId) !== null;
    }

    // ============================================================
    // LOOKUP FUNCTIONS - Weapons
    // ============================================================

    function getWeaponTypes() { return WEAPON_TYPES.slice(); }

    function getWeaponType(typeId) {
        if (!typeId || typeof typeId !== 'string') { return null; }
        for (var i = 0; i < WEAPON_TYPES.length; i++) {
            if (WEAPON_TYPES[i].id === typeId) {
                return WEAPON_TYPES[i];
            }
        }
        return null;
    }

    function isValidWeaponType(typeId) {
        return getWeaponType(typeId) !== null;
    }

    function getWeaponTypeLabel(typeId) {
        var type = getWeaponType(typeId);
        return type ? type.label : 'Unknown';
    }

    function getDefaultWeaponType() {
        return DEFAULT_WEAPON_TYPE;
    }

    // ============================================================
    // LOOKUP FUNCTIONS - Career
    // ============================================================

    function getCareerStatusOptions() { return CAREER_STATUS_OPTIONS.slice(); }

    function getCareerStatusLabels() {
        var labels = {};
        CAREER_STATUS_OPTIONS.forEach(function(opt) {
            if (opt.value) { labels[opt.value] = opt.label; }
        });
        return labels;
    }

    function isTerminalStatus(status) {
        if (!status || typeof status !== 'string') { return false; }
        var base = stripFormerSuffix(status);
        return TERMINAL_STATUSES.indexOf(base) !== -1;
    }

    // ---- Status predicates ----
    //
    // All four route through classifyStatus so that a status with a
    // ' (former)' suffix classifies consistently. A former
    // instructor is still classified as an instructor for tier
    // purposes; if a caller wants "is currently an instructor",
    // they should check the character's career history directly.

    function stripFormerSuffix(status) {
        if (!status || typeof status !== 'string') { return ''; }
        var base = status.toLowerCase();
        var formerIndex = base.indexOf(' (former)');
        if (formerIndex !== -1) {
            base = base.substring(0, formerIndex).trim();
        }
        return base;
    }

    function classifyStatus(status) {
        if (!status || typeof status !== 'string') { return null; }
        var base = stripFormerSuffix(status);
        if (base === '') { return null; }
        if (STUDENT_STATUSES.indexOf(base) !== -1) { return 'student'; }
        if (INSTRUCTOR_STATUSES.indexOf(base) !== -1) { return 'instructor'; }
        if (SUPPORT_STATUSES.indexOf(base) !== -1) { return 'support'; }
        if (RETIRED_STATUSES.indexOf(base) !== -1) { return 'retired'; }
        return null;
    }

    function isStudentStatus(status) {
        return classifyStatus(status) === 'student';
    }

    function isInstructorStatus(status) {
        return classifyStatus(status) === 'instructor';
    }

    function isSupportStatus(status) {
        return classifyStatus(status) === 'support';
    }

    function isRetiredStatus(status) {
        return classifyStatus(status) === 'retired';
    }

    // ============================================================
    // LOOKUP FUNCTIONS - Social vocabulary
    // ============================================================

    function getAttractionValues() { return ATTRACTION_VALUES.slice(); }
    function getSexualityValues() { return SEXUALITY_VALUES.slice(); }

    function isValidNameFormat(format) {
        return NAME_FORMATS.indexOf(format) !== -1;
    }

    function getNameFormatLabels() {
        return {
            'firstlast': 'First + Last',
            'lastfirst': 'Last, First',
            'nicklast': 'Nickname + Last',
            'firstnick': 'First "Nickname"',
            'alias': 'Alias'
        };
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    /**
     * Is this string an emoji rather than a monochrome glyph?
     *
     * Iterates codepoints, not UTF-16 code units. An emoji above
     * U+FFFF is two code units (a high surrogate plus a low
     * surrogate); a code-unit scan misses it.
     *
     * Rejects:
     *   - any codepoint >= U+1F000 (pictographic emoji range)
     *   - any U+FE0F variation selector 16 (force-emoji-presentation)
     *   - any sequence of more than two codepoints
     */
    function isEmojiGlyph(str) {
        if (typeof str !== 'string' || str === '') { return true; }

        var cps = [];
        for (var i = 0; i < str.length; i++) {
            var code = str.charCodeAt(i);
            if (code >= 0xD800 && code <= 0xDBFF && i + 1 < str.length) {
                var next = str.charCodeAt(i + 1);
                if (next >= 0xDC00 && next <= 0xDFFF) {
                    var cp = ((code - 0xD800) * 0x400) +
                             (next - 0xDC00) + 0x10000;
                    cps.push(cp);
                    i++;
                    continue;
                }
            }
            cps.push(code);
        }

        if (cps.length > 2) { return true; }
        for (var k = 0; k < cps.length; k++) {
            if (cps[k] >= 0x1F000) { return true; }
            if (cps[k] === 0xFE0F) { return true; }
        }
        return false;
    }

    /**
     * Validate the constant tables.
     *
     * Returns a boolean. On failure, logs to console.warn with a
     * list of errors and returns false. The module still loads;
     * a broken table does not block the app, but the warning
     * names the offending entry so it can be fixed.
     *
     * Also emits an ADVISORY warning for physical-class pairs that
     * violate the collapse constraint. That warning is not
     * included in the boolean return; it is a diagnostic, not a
     * validation failure.
     */
    function validateConstants() {
        var errors = [];

        if (!Array.isArray(PHYSICAL_CLASSES) || PHYSICAL_CLASSES.length === 0) {
            errors.push('PHYSICAL_CLASSES must be a non-empty array.');
        }

        var classIds = Object.create(null);
        PHYSICAL_CLASSES.forEach(function(cls, index) {
            if (!cls.id || typeof cls.id !== 'string') {
                errors.push('Physical class at index ' + index + ' missing id.');
                return;
            }
            if (classIds[cls.id]) {
                errors.push('Duplicate physical class id "' + cls.id + '".');
            }
            classIds[cls.id] = true;

            if (!cls.label || typeof cls.label !== 'string') {
                errors.push('Physical class "' + cls.id + '" missing label.');
            }

            // ---- Icon must be a monochrome glyph, not emoji ----
            if (typeof cls.icon !== 'string' || cls.icon === '') {
                errors.push('Physical class "' + cls.id + '" missing icon.');
            } else if (isEmojiGlyph(cls.icon)) {
                errors.push(
                    'Physical class "' + cls.id + '" icon "' + cls.icon +
                    '" is or resembles an emoji. Use a monochrome glyph.'
                );
            }

            if (!cls.weights || typeof cls.weights !== 'object') {
                errors.push('Physical class "' + cls.id + '" missing weights.');
                return;
            }

            var weightSum = 0;
            STAT_KEYS.forEach(function(key) {
                var w = cls.weights[key];
                if (typeof w !== 'number' || w < 0 || w > 1) {
                    errors.push('Physical class "' + cls.id + '" weight for "' + key + '" must be between 0 and 1.');
                } else {
                    weightSum += w;
                }
            });
            if (Math.abs(weightSum - 1.0) > 0.01) {
                errors.push('Physical class "' + cls.id + '" weights must sum to ~1.0 (got ' + weightSum.toFixed(2) + ').');
            }

            if (typeof cls.hpBonus !== 'number' || cls.hpBonus < 0) {
                errors.push('Physical class "' + cls.id + '" invalid hpBonus.');
            }
        });

        // ---- Collapse constraint (advisory) ----
        // For every pair (A, B), dot(A, A) should be >= dot(A, B).
        // A violation is a warning, not a validation error.
        var statKeys = STAT_KEYS;
        var collapseWarnings = [];
        function dot(a, b) {
            var s = 0;
            for (var k = 0; k < statKeys.length; k++) {
                var key = statKeys[k];
                s += (a[key] || 0) * (b[key] || 0);
            }
            return s;
        }
        for (var ai = 0; ai < PHYSICAL_CLASSES.length; ai++) {
            var A = PHYSICAL_CLASSES[ai];
            if (!A.weights) { continue; }
            var selfDot = dot(A.weights, A.weights);
            for (var bi = 0; bi < PHYSICAL_CLASSES.length; bi++) {
                if (bi === ai) { continue; }
                var B = PHYSICAL_CLASSES[bi];
                if (!B.weights) { continue; }
                var crossDot = dot(A.weights, B.weights);
                if (crossDot > selfDot + 1e-6) {
                    collapseWarnings.push(
                        A.id + ' -> ' + B.id +
                        ' (dot ' + crossDot.toFixed(3) +
                        ' > self ' + selfDot.toFixed(3) + ')'
                    );
                }
            }
        }
        if (collapseWarnings.length > 0) {
            console.warn(
                '[CharacterConstants] Physical-class collapse warnings ' +
                '(advisory, not fatal):', collapseWarnings
            );
        }

        if (!Array.isArray(WEAPON_TYPES) || WEAPON_TYPES.length === 0) {
            errors.push('WEAPON_TYPES must be a non-empty array.');
        }

        var typeIds = Object.create(null);
        WEAPON_TYPES.forEach(function(t, index) {
            if (!t.id || typeof t.id !== 'string') {
                errors.push('Weapon type at index ' + index + ' missing id.');
                return;
            }
            if (typeIds[t.id]) {
                errors.push('Duplicate weapon type id "' + t.id + '".');
            }
            typeIds[t.id] = true;
            if (!t.label || typeof t.label !== 'string') {
                errors.push('Weapon type "' + t.id + '" missing label.');
            }
        });

        if (STAT_MIN >= STAT_MAX) {
            errors.push('STAT_MIN must be less than STAT_MAX.');
        }
        if (STAT_DEFAULT < STAT_MIN || STAT_DEFAULT > STAT_MAX) {
            errors.push('STAT_DEFAULT must be between STAT_MIN and STAT_MAX.');
        }
        if (STAT_RANDOM_MIN < STAT_MIN || STAT_RANDOM_MAX > STAT_MAX) {
            errors.push('STAT_RANDOM bounds must be within STAT_MIN and STAT_MAX.');
        }

        if (HP_MIN < 0 || HP_MAX <= HP_MIN) {
            errors.push('HP bounds invalid.');
        }
        if (MP_MIN < 0 || MP_MAX <= MP_MIN) {
            errors.push('MP bounds invalid.');
        }

        // ---- Status tier disjointness ----
        // The tiers must not overlap. A status string in two tiers
        // would make classifyStatus non-deterministic.
        var studentSet = Object.create(null);
        STUDENT_STATUSES.forEach(function(s) { studentSet[s] = true; });
        var instructorSet = Object.create(null);
        INSTRUCTOR_STATUSES.forEach(function(s) { instructorSet[s] = true; });
        var supportSet = Object.create(null);
        SUPPORT_STATUSES.forEach(function(s) { supportSet[s] = true; });
        var retiredSet = Object.create(null);
        RETIRED_STATUSES.forEach(function(s) { retiredSet[s] = true; });

        STUDENT_STATUSES.forEach(function(s) {
            if (instructorSet[s]) {
                errors.push('Status "' + s + '" is in both STUDENT_STATUSES and INSTRUCTOR_STATUSES.');
            }
            if (supportSet[s]) {
                errors.push('Status "' + s + '" is in both STUDENT_STATUSES and SUPPORT_STATUSES.');
            }
            if (retiredSet[s]) {
                errors.push('Status "' + s + '" is in both STUDENT_STATUSES and RETIRED_STATUSES.');
            }
        });
        INSTRUCTOR_STATUSES.forEach(function(s) {
            if (supportSet[s]) {
                errors.push('Status "' + s + '" is in both INSTRUCTOR_STATUSES and SUPPORT_STATUSES.');
            }
            if (retiredSet[s]) {
                errors.push('Status "' + s + '" is in both INSTRUCTOR_STATUSES and RETIRED_STATUSES.');
            }
        });
        SUPPORT_STATUSES.forEach(function(s) {
            if (retiredSet[s]) {
                errors.push('Status "' + s + '" is in both SUPPORT_STATUSES and RETIRED_STATUSES.');
            }
        });

        // ---- TERMINAL_STATUSES must reference known statuses ----
        var allKnownStatuses = Object.create(null);
        CAREER_STATUS_OPTIONS.forEach(function(opt) {
            if (opt.value) { allKnownStatuses[opt.value] = true; }
        });
        TERMINAL_STATUSES.forEach(function(s) {
            if (!allKnownStatuses[s]) {
                errors.push(
                    'TERMINAL_STATUSES contains "' + s +
                    '", which is not in CAREER_STATUS_OPTIONS.'
                );
            }
        });

        if (errors.length > 0) {
            console.warn('[CharacterConstants] Validation errors:', errors);
        }
        return errors.length === 0;
    }

    validateConstants();

    // ============================================================
    // FREEZE
    // ============================================================

    deepFreeze(STAT_KEYS);
    deepFreeze(STAT_DEFINITIONS);
    deepFreeze(PHYSICAL_CLASSES);
    deepFreeze(WEAPON_TYPES);
    deepFreeze(CAREER_STATUS_OPTIONS);
    deepFreeze(STUDENT_STATUSES);
    deepFreeze(INSTRUCTOR_STATUSES);
    deepFreeze(SUPPORT_STATUSES);
    deepFreeze(RETIRED_STATUSES);
    deepFreeze(TERMINAL_STATUSES);
    deepFreeze(NAME_FORMATS);
    deepFreeze(ATTRACTION_VALUES);
    deepFreeze(SEXUALITY_VALUES);

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterConstants = Object.freeze({
        // Stats
        STAT_KEYS: STAT_KEYS,
        STAT_MIN: STAT_MIN,
        STAT_MAX: STAT_MAX,
        STAT_DEFAULT: STAT_DEFAULT,
        STAT_RANDOM_MIN: STAT_RANDOM_MIN,
        STAT_RANDOM_MAX: STAT_RANDOM_MAX,
        STAT_DEFINITIONS: STAT_DEFINITIONS,

        // Physical classes
        PHYSICAL_CLASSES: PHYSICAL_CLASSES,

        // Weapons
        WEAPON_TYPES: WEAPON_TYPES,
        DEFAULT_WEAPON_TYPE: DEFAULT_WEAPON_TYPE,
        MAX_WEAPONS: MAX_WEAPONS,
        MAX_WEAPON_NAME_LENGTH: MAX_WEAPON_NAME_LENGTH,
        MAX_WEAPON_NOTES_LENGTH: MAX_WEAPON_NOTES_LENGTH,

        // HP / MP
        HP_MIN: HP_MIN,
        HP_MAX: HP_MAX,
        HP_BASE_MIN: HP_BASE_MIN,
        HP_BASE_MAX: HP_BASE_MAX,
        MP_MIN: MP_MIN,
        MP_MAX: MP_MAX,
        MP_BASE_DIVISOR: MP_BASE_DIVISOR,
        MP_AETHER_MULTIPLIER: MP_AETHER_MULTIPLIER,
        MP_BODY_MULTIPLIER: MP_BODY_MULTIPLIER,
        MP_RANDOM_MAX: MP_RANDOM_MAX,

        // Special moves
        MAX_SPECIAL_MOVES: MAX_SPECIAL_MOVES,
        MAX_MOVE_NAME_LENGTH: MAX_MOVE_NAME_LENGTH,
        MAX_MOVE_DESCRIPTION_LENGTH: MAX_MOVE_DESCRIPTION_LENGTH,

        // Career
        CAREER_STATUS_OPTIONS: CAREER_STATUS_OPTIONS,
        STUDENT_STATUSES: STUDENT_STATUSES,
        INSTRUCTOR_STATUSES: INSTRUCTOR_STATUSES,
        SUPPORT_STATUSES: SUPPORT_STATUSES,
        RETIRED_STATUSES: RETIRED_STATUSES,
        TERMINAL_STATUSES: TERMINAL_STATUSES,

        // Names
        NAME_FORMATS: NAME_FORMATS,
        DEFAULT_NAME_FORMAT: DEFAULT_NAME_FORMAT,
        MAX_PREVIOUS_NAMES: MAX_PREVIOUS_NAMES,
        MAX_CAREER_STATUS: MAX_CAREER_STATUS,

        // Social
        ATTRACTION_VALUES: ATTRACTION_VALUES,
        SEXUALITY_VALUES: SEXUALITY_VALUES,

        // Lookup functions
        getStatKeys: getStatKeys,
        getStatDefinitions: getStatDefinitions,
        getStatDefinition: getStatDefinition,

        getPhysicalClasses: getPhysicalClasses,
        getPhysicalClass: getPhysicalClass,
        isValidPhysicalClass: isValidPhysicalClass,

        getWeaponTypes: getWeaponTypes,
        getWeaponType: getWeaponType,
        getWeaponTypeLabel: getWeaponTypeLabel,
        isValidWeaponType: isValidWeaponType,
        getDefaultWeaponType: getDefaultWeaponType,

        getCareerStatusOptions: getCareerStatusOptions,
        getCareerStatusLabels: getCareerStatusLabels,

        classifyStatus: classifyStatus,
        isStudentStatus: isStudentStatus,
        isInstructorStatus: isInstructorStatus,
        isSupportStatus: isSupportStatus,
        isRetiredStatus: isRetiredStatus,
        isTerminalStatus: isTerminalStatus,

        getAttractionValues: getAttractionValues,
        getSexualityValues: getSexualityValues,
        isValidNameFormat: isValidNameFormat,
        getNameFormatLabels: getNameFormatLabels,

        validateConstants: validateConstants
    });

})();
