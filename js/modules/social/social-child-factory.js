/**
 * modules/social/social-child-factory.js - Social Child Factory
 * Pure child-record generation from two parents.
 *
 * Path: js/modules/social/social-child-factory.js
 *
 * WHAT THIS MODULE DOES:
 *   Given two parent character records and a small options object,
 *   returns a new character DTO suitable for CharacterCRUD.createChild.
 *   The DTO has:
 *     - a name (defaulting to father's surname)
 *     - a sex (random or user-supplied)
 *     - physical traits inherited from both parents with jitter
 *     - stats as the average of both parents + jitter, clamped
 *     - magic proficiencies as the average + jitter, clamped
 *     - personality fields picked from either parent or the pool
 *     - parentIds set to the two parent IDs
 *
 * WHAT THIS MODULE DOES NOT DO:
 *   - It does not create the character. CharacterCRUD.createChild
 *     does that.
 *   - It does not touch window.data, the DOM, or persistence.
 *   - It does not enter MutationPipeline.
 *
 * DETERMINISM:
 *   The factory uses Math.random for every choice. Two calls with
 *   the same parents produce different children. There is no seed.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CharacterQueries
 *   - window.CharacterConstants
 *
 * DEPENDENCIES (OPTIONAL):
 *   - window.CharacterGenerator (for novel personality values)
 *   - window.MagicConstants
 *   - window.CharacterStats (for HP/MP rolls)
 */

(function() {
    'use strict';

    if (window.__socialChildFactoryLoaded) {
        return;
    }
    window.__socialChildFactoryLoaded = true;

    // ============================================================
    // DEPENDENCY ACCESSORS
    // ============================================================

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    function getCharacterConstants() {
        return window.CharacterConstants || null;
    }

    function getCharacterGenerator() {
        return window.CharacterGenerator || null;
    }

    function getMagicConstants() {
        return window.MagicConstants || null;
    }

    function getCharacterStats() {
        return window.CharacterStats || null;
    }

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function pickRandom(arr) {
        if (!Array.isArray(arr) || arr.length === 0) { return null; }
        return arr[Math.floor(Math.random() * arr.length)];
    }

    function randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function parseIntegerOrNull(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var n = parseInt(String(value).trim(), 10);
        return isNaN(n) ? null : n;
    }

    function safeString(value) {
        if (value === undefined || value === null) { return ''; }
        return String(value);
    }

    // ============================================================
    // HEIGHT / WEIGHT PARSING
    // ============================================================
    //
    // Parents store height and weight as free-text strings. Common
    // forms we try to parse:
    //   "175cm"  "175 cm"  "175"
    //   "72kg"   "72 kg"   "72"
    //
    // Anything else returns null; the field is then picked from one
    // parent's raw string, or left blank.

    function parseHeightCm(str) {
        var s = safeString(str).trim().toLowerCase();
        if (s === '') { return null; }
        var m = s.match(/^(\d+)\s*(cm)?$/);
        if (!m) { return null; }
        var n = parseInt(m[1], 10);
        return isNaN(n) ? null : n;
    }

    function parseWeightKg(str) {
        var s = safeString(str).trim().toLowerCase();
        if (s === '') { return null; }
        var m = s.match(/^(\d+)\s*(kg)?$/);
        if (!m) { return null; }
        var n = parseInt(m[1], 10);
        return isNaN(n) ? null : n;
    }

    // ============================================================
    // PARENT INSPECTION
    // ============================================================

    /**
     * Read a numeric stat from a parent, with STAT_DEFAULT fallback.
     */
    function parentStat(parent, key) {
        var CC = getCharacterConstants();
        var fallback = CC ? CC.STAT_DEFAULT : 10;
        if (!parent || !parent.stats) { return fallback; }
        var v = parent.stats[key];
        if (typeof v === 'number' && isFinite(v)) { return v; }
        var n = parseInt(v, 10);
        return isNaN(n) ? fallback : n;
    }

    function parentMagic(parent, key) {
        if (!parent || !parent.magic) { return 0; }
        var v = parent.magic[key];
        if (typeof v === 'number' && isFinite(v)) { return v; }
        var n = parseInt(v, 10);
        return isNaN(n) ? 0 : n;
    }

    function parentPersonality(parent, key) {
        if (!parent || !parent.personality) { return ''; }
        var v = parent.personality[key];
        if (typeof v === 'string') { return v; }
        return safeString(v);
    }

    /**
     * Which parent is "the father" for surname purposes?
     *
     * Reads normalised gender. Returns 'a' when parent A is the
     * father, 'b' when parent B is the father, and null when neither
     * is unambiguously male.
     */
    function fatherIsA(parentA, parentB) {
        var a = safeString(parentA && parentA.gender).trim().toLowerCase();
        var b = safeString(parentB && parentB.gender).trim().toLowerCase();

        var aIsMale = (a === 'male' || a === 'm' || a === 'man' || a === 'boy');
        var bIsMale = (b === 'male' || b === 'm' || b === 'man' || b === 'boy');

        if (aIsMale && !bIsMale) { return true; }
        if (bIsMale && !aIsMale) { return false; }
        // Ambiguous — default to A.
        return true;
    }

    // ============================================================
    // PHYSICAL INHERITANCE
    // ============================================================

    function inheritPhysical(parentA, parentB, fieldName) {
        var va = parentA ? parentA[fieldName] : '';
        var vb = parentB ? parentB[fieldName] : '';

        var a = safeString(va).trim();
        var b = safeString(vb).trim();

        var aPresent = a !== '';
        var bPresent = b !== '';

        if (!aPresent && !bPresent) { return ''; }
        if (aPresent && !bPresent) { return a; }
        if (!aPresent && bPresent) { return b; }

        // Both present: 45% A, 45% B, 10% blank.
        var roll = Math.random();
        if (roll < 0.45) { return a; }
        if (roll < 0.90) { return b; }
        return '';
    }

    /**
     * Height: parse both parents, average, jitter ±6 cm, clamp to a
     * plausible range. If neither parent parses, fall through to the
     * generic pick.
     */
    function inheritHeight(parentA, parentB) {
        var ha = parseHeightCm(parentA && parentA.height);
        var hb = parseHeightCm(parentB && parentB.height);

        if (ha === null && hb === null) {
            return inheritPhysical(parentA, parentB, 'height');
        }

        var value;
        if (ha !== null && hb !== null) {
            value = Math.round((ha + hb) / 2) + randomInt(-6, 6);
        } else {
            value = (ha !== null ? ha : hb) + randomInt(-6, 6);
        }

        // Plausible range. Keeps absurd combinations out without a
        // hard "is this realistic" test.
        value = clamp(value, 120, 220);
        return value + 'cm';
    }

    function inheritWeight(parentA, parentB) {
        var wa = parseWeightKg(parentA && parentA.weight);
        var wb = parseWeightKg(parentB && parentB.weight);

        if (wa === null && wb === null) {
            return inheritPhysical(parentA, parentB, 'weight');
        }

        var value;
        if (wa !== null && wb !== null) {
            value = Math.round((wa + wb) / 2) + randomInt(-5, 5);
        } else {
            value = (wa !== null ? wa : wb) + randomInt(-5, 5);
        }

        value = clamp(value, 25, 200);
        return value + 'kg';
    }

    // ============================================================
    // NAME
    // ============================================================

    function pickFirstName(parentA, parentB) {
        // Try the generator's first-name pool first.
        var Generator = getCharacterGenerator();
        if (Generator &&
            typeof Generator.generateCharacter === 'function') {
            try {
                var rolled = Generator.generateCharacter({
                    includeStats: false,
                    includeMagic: false,
                    includePersonality: false,
                    includePhysical: false
                });
                if (rolled && rolled.firstName) {
                    return rolled.firstName;
                }
            } catch (e) {
                // fall through
            }
        }
        // Fallback pool.
        var names = [
            'Aria', 'Bastian', 'Celine', 'Dorian', 'Elara', 'Finn',
            'Gwen', 'Hugo', 'Iris', 'Jasper', 'Kira', 'Liam',
            'Mira', 'Nico', 'Orion', 'Piper', 'Quinn', 'Raven',
            'Sage', 'Theo', 'Uma', 'Valor', 'Willow', 'Xen',
            'Yara', 'Zane'
        ];
        return pickRandom(names) || 'Unnamed';
    }

    function pickSurname(parentA, parentB) {
        var aIsFather = fatherIsA(parentA, parentB);
        var father = aIsFather ? parentA : parentB;
        var mother = aIsFather ? parentB : parentA;

        var fatherSurname = father ? safeString(father.lastName).trim() : '';
        var motherSurname = mother ? safeString(mother.lastName).trim() : '';

        if (fatherSurname !== '') { return fatherSurname; }
        if (motherSurname !== '') { return motherSurname; }
        return 'Blackwood';
    }

    // ============================================================
    // STATS
    // ============================================================

    function inheritStats(parentA, parentB) {
        var CC = getCharacterConstants();
        if (!CC || !Array.isArray(CC.STAT_KEYS)) {
            return {};
        }

        var statMin = typeof CC.STAT_MIN === 'number' ? CC.STAT_MIN : 1;
        var statMax = typeof CC.STAT_MAX === 'number' ? CC.STAT_MAX : 30;

        var stats = {};
        for (var i = 0; i < CC.STAT_KEYS.length; i++) {
            var key = CC.STAT_KEYS[i];
            var a = parentStat(parentA, key);
            var b = parentStat(parentB, key);
            var avg = Math.round((a + b) / 2);
            var jitter = randomInt(-2, 2);
            stats[key] = clamp(avg + jitter, statMin, statMax);
        }
        return stats;
    }

    // ============================================================
    // MAGIC
    // ============================================================

    function inheritMagic(parentA, parentB) {
        var MC = getMagicConstants();
        if (!MC || typeof MC.getTypeKeys !== 'function') {
            return {};
        }

        var keys = MC.getTypeKeys() || [];
        var max = typeof MC.MAGIC_MAX === 'number' ? MC.MAGIC_MAX : 10;

        var magic = {};
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var a = parentMagic(parentA, key);
            var b = parentMagic(parentB, key);
            var avg = Math.round((a + b) / 2);
            var jitter = randomInt(-1, 1);
            magic[key] = clamp(avg + jitter, 0, max);
        }
        return magic;
    }

    // ============================================================
    // PERSONALITY
    // ============================================================

    /**
     * A field of the personality is picked from:
     *   - parent A's value (35%)
     *   - parent B's value (35%)
     *   - a novel value from the pool (30%)
     * When a parent's value is empty, the branch falls through to
     * the novel pick.
     */
    function inheritPersonalityField(parentA, parentB, field) {
        var va = parentPersonality(parentA, field);
        var vb = parentPersonality(parentB, field);

        var roll = Math.random();
        if (roll < 0.35 && va !== '') { return va; }
        if (roll < 0.70 && vb !== '') { return vb; }

        var Generator = getCharacterGenerator();
        if (Generator &&
            typeof Generator.generatePersonalityField === 'function') {
            try {
                var novel = Generator.generatePersonalityField(field);
                if (typeof novel === 'string' && novel !== '') {
                    return novel;
                }
            } catch (e) {
                // fall through
            }
        }

        // If we got here, return whichever parent value exists.
        if (va !== '') { return va; }
        if (vb !== '') { return vb; }
        return '';
    }

    var PERSONALITY_FIELDS = [
        'traits', 'ideals', 'bonds', 'flaws', 'alignment',
        'likes', 'dislikes', 'habits', 'fears', 'goals',
        'authority', 'conflictStyle', 'socialStyle', 'quirks'
    ];

    function inheritPersonality(parentA, parentB) {
        var out = {};
        for (var i = 0; i < PERSONALITY_FIELDS.length; i++) {
            var f = PERSONALITY_FIELDS[i];
            out[f] = inheritPersonalityField(parentA, parentB, f);
        }
        return out;
    }

    // ============================================================
    // HP / MP
    // ============================================================

    function rollHpMp(stats, magic) {
        var CS = getCharacterStats();
        var hp = 0;
        var mp = 0;

        if (CS && typeof CS.rollHP === 'function') {
            try { hp = CS.rollHP(stats); } catch (e) { hp = 0; }
        }
        if (CS && typeof CS.rollMP === 'function') {
            try { mp = CS.rollMP(magic); } catch (e) { mp = 0; }
        }

        if (typeof hp !== 'number' || !isFinite(hp) || hp < 0) { hp = 0; }
        if (typeof mp !== 'number' || !isFinite(mp) || mp < 0) { mp = 0; }

        return { hp: Math.round(hp), mp: Math.round(mp) };
    }

    // ============================================================
    // PUBLIC: BUILD CHILD DTO
    // ============================================================

    /**
     * Build a child character DTO from two parents.
     *
     * @param {object} parentA
     * @param {object} parentB
     * @param {object} options
     * @param {number|string} options.birthYear - Required
     * @param {string} [options.firstName] - Optional; when empty, a
     *   random first name is generated.
     * @param {string} [options.lastName] - Optional; when empty,
     *   defaults to the father's surname.
     * @param {string} [options.gender] - 'Male' or 'Female'; when
     *   empty, random 50/50.
     * @returns {object} A DTO ready for CharacterCRUD.createChild.
     */
    function buildChildDto(parentA, parentB, options) {
        options = options || {};

        if (!parentA || !parentB) {
            throw new Error('[SocialChildFactory] two parents are required.');
        }

        var birthYear = parseIntegerOrNull(options.birthYear);
        if (birthYear === null || birthYear < 1) {
            throw new Error('[SocialChildFactory] a valid birthYear is required.');
        }

        // Name
        var firstName = safeString(options.firstName).trim();
        if (firstName === '') {
            firstName = pickFirstName(parentA, parentB);
        }
        var lastName = safeString(options.lastName).trim();
        if (lastName === '') {
            lastName = pickSurname(parentA, parentB);
        }

        // Sex
        var gender = safeString(options.gender).trim();
        if (gender !== 'Male' && gender !== 'Female') {
            gender = Math.random() < 0.5 ? 'Male' : 'Female';
        }

        // Inheritances
        var stats = inheritStats(parentA, parentB);
        var magic = inheritMagic(parentA, parentB);
        var personality = inheritPersonality(parentA, parentB);

        var hpmp = rollHpMp(stats, magic);

        var physical = {
            gender: gender,
            eyes: inheritPhysical(parentA, parentB, 'eyes'),
            hair: inheritPhysical(parentA, parentB, 'hair'),
            skin: inheritPhysical(parentA, parentB, 'skin'),
            height: inheritHeight(parentA, parentB),
            weight: inheritWeight(parentA, parentB),
            build: inheritPhysical(parentA, parentB, 'build')
        };

        return {
            firstName: firstName,
            middleName: '',
            lastName: lastName,
            nickname: '',
            alias: '',
            previousNames: [],
            displayParts: {
                first: true,
                middle: true,
                last: true,
                nickname: false,
                alias: false
            },

            birthYear: String(birthYear),
            gender: physical.gender,
            attraction: '',
            sexuality: '',

            eyes: physical.eyes,
            hair: physical.hair,
            skin: physical.skin,
            height: physical.height,
            weight: physical.weight,
            build: physical.build,
            appearanceNotes: '',

            specialty: '',
            careerStatus: [],

            stats: stats,
            magic: magic,
            hp: hpmp.hp,
            mp: hpmp.mp,

            weapons: [],
            combatNotes: '',

            notes: '',

            personality: personality,

            deceased: false,
            deathYear: '',
            deathCause: '',
            deathAge: '',
            deathWeek: ''
        };
    }

    // ============================================================
    // PUBLIC: DISPLAY BLURB
    // ============================================================

    /**
     * A short human-readable description of the inheritance, for
     * the child modal preview.
     *
     * @returns {object} { fullName, sex, statsSummary, personalitySummary }
     */
    function previewChild(parentA, parentB, options) {
        var dto;
        try {
            dto = buildChildDto(parentA, parentB, options || {});
        } catch (e) {
            return null;
        }

        var CC = getCharacterConstants();
        var statKeys = (CC && Array.isArray(CC.STAT_KEYS))
            ? CC.STAT_KEYS
            : ['str', 'dex', 'con', 'int', 'wis', 'cha'];

        var statParts = [];
        for (var i = 0; i < statKeys.length; i++) {
            var k = statKeys[i];
            statParts.push(k.toUpperCase() + ' ' + dto.stats[k]);
        }

        var personalityParts = [];
        if (dto.personality.traits) {
            personalityParts.push('Traits: ' + dto.personality.traits);
        }
        if (dto.personality.alignment) {
            personalityParts.push('Alignment: ' + dto.personality.alignment);
        }

        return {
            fullName: dto.firstName + ' ' + dto.lastName,
            sex: dto.gender,
            birthYear: dto.birthYear,
            physical: [
                dto.eyes ? 'Eyes: ' + dto.eyes : '',
                dto.hair ? 'Hair: ' + dto.hair : '',
                dto.skin ? 'Skin: ' + dto.skin : '',
                dto.height ? 'Height: ' + dto.height : '',
                dto.weight ? 'Weight: ' + dto.weight : '',
                dto.build ? 'Build: ' + dto.build : ''
            ].filter(function(s) { return s !== ''; }).join(' \u00b7 '),
            statsSummary: statParts.join(' \u00b7 '),
            personalitySummary: personalityParts.join(' \u00b7 '),
            hp: dto.hp,
            mp: dto.mp
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.SocialChildFactory = {
        buildChildDto: buildChildDto,
        previewChild: previewChild,

        // Exposed for tests and future reuse
        normaliseGender: function(gender) {
            var s = safeString(gender).trim().toLowerCase();
            if (s === 'male' || s === 'm' || s === 'man' || s === 'boy') {
                return 'Male';
            }
            if (s === 'female' || s === 'f' || s === 'woman' || s === 'girl') {
                return 'Female';
            }
            return null;
        }
    };

})();
