/**
 * modules/characters/character-stats.js - Character Stats & Magic System
 * Domain logic for physical stats, magical proficiencies, classes,
 * and HP/MP.
 *
 * Path: js/modules/characters/character-stats.js
 *
 * This module handles:
 *   - Physical stat calculation, validation, modifiers
 *   - Random physical stat generation (6–18 range)
 *   - Physical class derivation (weighted scoring)
 *   - Physical class application (rewrites stats)
 *   - Magical proficiency calculation, validation, levels
 *   - Random magical proficiency generation (weighted by category)
 *   - Broad magical class derivation (category totals)
 *   - Fine magical class derivation (per-proficiency)
 *   - Fine magical class application (raises a single proficiency)
 *   - Total magical power (0–180 sum)
 *   - HP / MP calculation (random + modifiers)
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Special moves. As of S10.2, special moves are a record store
 *     owned by character-moves.js. That module handles add / update /
 *     remove / read of character.specialMoves. This module no longer
 *     reads, validates, or mutates that field.
 *   - Persistence. Mutations in this module (there are none left —
 *     this file is pure calculation and derivation) would route
 *     through MutationPipeline, but this module does not write.
 *
 * IMPORTANT:
 *   - DOMAIN LOGIC ONLY - no rendering
 *   - All functions here are PURE. No MutationPipeline use remains.
 *   - No UI dependencies (no notifications, no confirm, no rendering)
 *   - Uses CharacterConstants for physical classes
 *   - Uses MagicConstants for magical types, classes, levels
 *   - No dependency on CharacterQueries (moves were the only consumer
 *     that needed character reads)
 *   - No dependency on MutationPipeline (moves were the only mutator)
 *   - No dependency on IdUtils (moves were the only id generator)
 *
 * S10.2 MIGRATION:
 *   The special-moves record store moved to character-moves.js. That
 *   includes the three mutations (addSpecialMove, updateSpecialMove,
 *   removeSpecialMove), the two helpers (getSpecialMoves,
 *   validateSpecialMovesStructure), and the three bounds constants
 *   (MAX_SPECIAL_MOVES, MAX_MOVE_NAME_LENGTH,
 *   MAX_MOVE_DESCRIPTION_LENGTH).
 *
 *   Callers that used to write `CharacterStats.addSpecialMove(...)`
 *   now write `CharacterMoves.addSpecialMove(...)`.
 *
 *   character-stats-view.js reads char.specialMoves directly for
 *   rendering; it does not go through either module.
 *
 * PHYSICAL CLASS DERIVATION vs APPLICATION:
 *   derivePhysicalClass(stats) answers "which class best fits this
 *   stat block?" via a weighted dot product. It is a similarity
 *   score and it can return a different class than the one a user
 *   picked from the override, if the derived scores happen to
 *   favour a neighbour.
 *
 *   applyPhysicalClass(classId) answers "produce a stat block that
 *   matches this class." Its output is a rewrite, not a hint. A
 *   caller that has just applied class X should NOT re-derive to
 *   discover what class it applied; it should display X. This is
 *   why getPhysicalClassLabel exists — it lets the caller render
 *   the applied class without going through the derivation.
 *
 * DEPENDENCIES:
 *   - window.CharacterConstants - MANDATORY
 *   - window.MagicConstants - MANDATORY
 *
 * USAGE:
 *   var CS = window.CharacterStats;
 *   var stats = CS.rollPhysicalStats();
 *   var cls = CS.derivePhysicalClass(stats);
 *   var magic = CS.rollMagicalProficiencies();
 *   var classes = CS.deriveMagicalClasses(magic);
 */

(function() {
    'use strict';

    if (window.__characterStatsLoaded) {
        return;
    }
    window.__characterStatsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var CharacterConstants = window.CharacterConstants;
    var MagicConstants = window.MagicConstants;

    // ============================================================
    // CONSTANTS - Lazy access with fallback guards
    // ============================================================

    function getCC() { return CharacterConstants; }
    function getMC() { return MagicConstants; }

    var STAT_KEYS = (CharacterConstants && CharacterConstants.STAT_KEYS) || ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    var STAT_MIN = (CharacterConstants && CharacterConstants.STAT_MIN) || 1;
    var STAT_MAX = (CharacterConstants && CharacterConstants.STAT_MAX) || 30;
    var STAT_DEFAULT = (CharacterConstants && CharacterConstants.STAT_DEFAULT) || 10;
    var STAT_RANDOM_MIN = (CharacterConstants && CharacterConstants.STAT_RANDOM_MIN) || 6;
    var STAT_RANDOM_MAX = (CharacterConstants && CharacterConstants.STAT_RANDOM_MAX) || 18;

    var MAGIC_MAX = (MagicConstants && MagicConstants.MAGIC_MAX) || 10;
    var MAGIC_FINE_CLASS_MIN = (MagicConstants && MagicConstants.MAGIC_FINE_CLASS_MIN) || 3;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!CharacterConstants) { missing.push('CharacterConstants'); }
        if (!MagicConstants) { missing.push('MagicConstants'); }

        if (missing.length > 0) {
            console.warn('[CharacterStats] Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // UTILITY - Random helpers
    // ============================================================

    function randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function pickWeighted(items, weights) {
        // items: array, weights: same length, sums to any positive
        var total = 0;
        for (var i = 0; i < weights.length; i++) { total += weights[i]; }
        if (total <= 0) { return items[0]; }

        var roll = Math.random() * total;
        var acc = 0;
        for (var j = 0; j < items.length; j++) {
            acc += weights[j];
            if (roll < acc) { return items[j]; }
        }
        return items[items.length - 1];
    }

    function shuffle(arr) {
        var result = arr.slice();
        for (var i = result.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = result[i];
            result[i] = result[j];
            result[j] = tmp;
        }
        return result;
    }

    function clampNumber(value, min, max) {
        var num = Number(value);
        if (!isFinite(num)) { return min; }
        return Math.max(min, Math.min(max, num));
    }

    // ============================================================
    // PHYSICAL STATS
    // ============================================================

    function getDefaultStats() {
        var stats = {};
        STAT_KEYS.forEach(function(key) {
            stats[key] = STAT_DEFAULT;
        });
        return stats;
    }

    function clampStat(value) {
        var num = Number(value);
        if (isNaN(num) || !isFinite(num)) { return STAT_DEFAULT; }
        return Math.max(STAT_MIN, Math.min(STAT_MAX, Math.round(num)));
    }

    function getCharacterStats(char) {
        if (!char) { return getDefaultStats(); }
        if (!char.stats || typeof char.stats !== 'object') {
            return getDefaultStats();
        }
        var stats = char.stats;
        var result = {};
        STAT_KEYS.forEach(function(key) {
            var val = stats[key];
            if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
                result[key] = clampStat(val);
            } else {
                result[key] = STAT_DEFAULT;
            }
        });
        return result;
    }

    function getAbilityModifier(score) {
        var value = clampStat(score);
        return Math.floor((value - 10) / 2);
    }

    function getModifierDisplay(score) {
        var mod = getAbilityModifier(score);
        return (mod >= 0 ? '+' : '') + mod;
    }

    // ============================================================
    // PHYSICAL STATS - Random roll
    // ============================================================

    /**
     * Roll 6 physical stats, each independently in STAT_RANDOM_MIN..STAT_RANDOM_MAX.
     * Uses a slight bias toward the middle of the range (3d6-shaped).
     * 
     * @returns {object} Stats object with str/dex/con/int/wis/cha
     */
    function rollPhysicalStats() {
        var stats = {};
        STAT_KEYS.forEach(function(key) {
            // 3d6 roll: 3-18, mean 10.5, bell-curve
            var roll = randomInt(1, 6) + randomInt(1, 6) + randomInt(1, 6);

            // Clamp to the allowed random range
            if (roll < STAT_RANDOM_MIN) { roll = STAT_RANDOM_MIN; }
            if (roll > STAT_RANDOM_MAX) { roll = STAT_RANDOM_MAX; }

            stats[key] = roll;
        });
        return stats;
    }

    // ============================================================
    // PHYSICAL CLASS - Derivation
    // ============================================================

    /**
     * Derive the best-matching physical class from a stat profile.
     * 
     * @param {object} stats - Stats object
     * @returns {object|null} { class: <classDef>, score: number, ranked: [...] }
     */
    function derivePhysicalClass(stats) {
        if (!CharacterConstants || !Array.isArray(CharacterConstants.PHYSICAL_CLASSES)) {
            return null;
        }
        if (!stats || typeof stats !== 'object') {
            return null;
        }

        var normalised = {};
        STAT_KEYS.forEach(function(key) {
            normalised[key] = clampStat(stats[key]);
        });

        var ranked = [];

        CharacterConstants.PHYSICAL_CLASSES.forEach(function(cls) {
            var score = 0;
            STAT_KEYS.forEach(function(key) {
                var weight = cls.weights[key] || 0;
                score += normalised[key] * weight;
            });
            ranked.push({ class: cls, score: score });
        });

        ranked.sort(function(a, b) {
            if (b.score !== a.score) { return b.score - a.score; }
            // Stable tiebreak: alphabetical by label
            return (a.class.label || '').localeCompare(b.class.label || '');
        });

        if (ranked.length === 0) { return null; }

        return {
            class: ranked[0].class,
            score: ranked[0].score,
            ranked: ranked
        };
    }

    /**
     * Get the display label for a physical class id.
     *
     * Returns the class's canonical label, or the em-dash sentinel
     * for an unknown id. This is the display path for the OVERRIDE
     * flow: a caller that has just applied class X renders X's
     * label directly, without asking derivePhysicalClass to
     * rediscover it.
     *
     * derivePhysicalClass is the LIV-EDIT path: when the user types
     * a stat directly, the derivation re-scores and the display
     * updates. That is what the derivation is for.
     *
     * @param {string} classId
     * @returns {string}
     */
    function getPhysicalClassLabel(classId) {
        if (!CharacterConstants ||
            typeof CharacterConstants.getPhysicalClass !== 'function') {
            return '\u2014';
        }
        var cls = CharacterConstants.getPhysicalClass(classId);
        return cls && cls.label ? cls.label : '\u2014';
    }

    /**
     * Apply a physical class to a character's stats — returns new stats.
     * Does NOT mutate. Formula: stat = 6 + weight * 40 + jitter(-2..+2)
     * 
     * @param {string} classId - Physical class id
     * @param {object} options - { jitter: boolean } default true
     * @returns {object|null} New stats object, or null if class invalid
     */
    function applyPhysicalClass(classId, options) {
        options = options || {};
        var useJitter = options.jitter !== false;

        var cls = CharacterConstants && CharacterConstants.getPhysicalClass
            ? CharacterConstants.getPhysicalClass(classId)
            : null;

        if (!cls) { return null; }

        var stats = {};
        STAT_KEYS.forEach(function(key) {
            var w = cls.weights[key] || 0;
            var base = Math.round(6 + w * 40);
            if (useJitter) {
                base += randomInt(-2, 2);
            }
            stats[key] = clampStat(base);
        });

        return stats;
    }

    // ============================================================
    // MAGICAL PROFICIENCIES
    // ============================================================

    function getDefaultMagicProficiencies() {
        var proficiencies = {};
        if (!MagicConstants) { return proficiencies; }
        var keys = MagicConstants.getTypeKeys();
        keys.forEach(function(key) {
            proficiencies[key] = 0;
        });
        return proficiencies;
    }

    function clampMagic(value) {
        var num = Number(value);
        if (isNaN(num) || !isFinite(num)) { return 0; }
        return Math.max(0, Math.min(MAGIC_MAX, Math.round(num)));
    }

    function getCharacterMagic(char) {
        var result = getDefaultMagicProficiencies();
        if (!char || !char.magic || typeof char.magic !== 'object') {
            return result;
        }
        var magic = char.magic;
        var keys = MagicConstants ? MagicConstants.getTypeKeys() : Object.keys(magic);
        keys.forEach(function(key) {
            var val = magic[key];
            if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
                result[key] = clampMagic(val);
            } else {
                result[key] = 0;
            }
        });
        return result;
    }

    // ============================================================
    // MAGICAL PROFICIENCIES - Random roll
    // ============================================================

    /**
     * Roll magical proficiencies with category-weighted distribution.
     * 
     * Elemental: all 6 roll, values cluster 3–5 (range 1–8)
     * Body:      3–4 of 6 roll, values cluster 2–4 (range 1–7)
     * Aether:    10% chance none; else 1–2 of 6 roll (range 1–6)
     * 
     * @returns {object} Magic proficiencies object
     */
    function rollMagicalProficiencies() {
        var magic = getDefaultMagicProficiencies();

        if (!MagicConstants) { return magic; }

        var elementalTypes = MagicConstants.getCategoryTypes('elemental');
        var bodyTypes      = MagicConstants.getCategoryTypes('body');
        var aetherTypes    = MagicConstants.getCategoryTypes('aether');

        // ---- Elemental: all roll, peak around 4 ----
        elementalTypes.forEach(function(type) {
            var values  = [1, 2, 3, 4, 5, 6, 7, 8];
            var weights = [5, 10, 15, 20, 20, 15, 10, 5];
            magic[type] = pickWeighted(values, weights);
        });

        // ---- Body: 3–4 of 6 roll, peak around 3 ----
        var bodyShuffled = shuffle(bodyTypes);
        var bodyCount = randomInt(3, 4);
        for (var i = 0; i < bodyCount; i++) {
            var values  = [1, 2, 3, 4, 5, 6, 7];
            var weights = [10, 20, 25, 20, 12, 8, 5];
            magic[bodyShuffled[i]] = pickWeighted(values, weights);
        }

        // ---- Aether: 10% none, else 1–2 of 6, peak around 2 ----
        var skipAether = Math.random() < 0.10;
        if (!skipAether) {
            var aetherShuffled = shuffle(aetherTypes);
            var aetherCount = randomInt(1, 2);
            for (var j = 0; j < aetherCount; j++) {
                var values  = [1, 2, 3, 4, 5, 6];
                var weights = [20, 30, 25, 15, 7, 3];
                magic[aetherShuffled[j]] = pickWeighted(values, weights);
            }
        }

        return magic;
    }

    // ============================================================
    // MAGICAL CLASSES - Derivation
    // ============================================================

    /**
     * Sum magic proficiencies per category.
     * @param {object} magic
     * @returns {object} { elemental, body, aether }
     */
    function getCategoryTotals(magic) {
        var totals = { elemental: 0, body: 0, aether: 0 };
        if (!magic || !MagicConstants) { return totals; }

        var keys = MagicConstants.getTypeKeys();
        keys.forEach(function(type) {
            var category = MagicConstants.getTypeCategory(type);
            var value = Number(magic[type]) || 0;
            if (category && totals[category] !== undefined) {
                totals[category] += value;
            }
        });
        return totals;
    }

    /**
     * Get the sum of all 18 proficiencies (0–180).
     */
    function calculateTotalMagicalPower(magic) {
        if (!magic || !MagicConstants) { return 0; }
        var total = 0;
        MagicConstants.getTypeKeys().forEach(function(type) {
            total += Number(magic[type]) || 0;
        });
        return total;
    }

    /**
     * Derive broad + fine magical classes from a proficiency profile.
     * 
     * Rules:
     *   - All zeros → no classes
     *   - Category tie (2-way) → broad "Dual Mage", no fine class
     *   - Category tie (3-way) → broad "Balanced Mage", no fine class
     *   - Single winning category → broad class from that category
     *   - Top proficiency in category < MAGIC_FINE_CLASS_MIN → no fine class
     *   - Two-way proficiency tie → fine "Pyromancer / Hydromancer"
     *   - Three-way proficiency tie → fine "Balanced Mage"
     *   - Single proficiency → fine class from that type
     * 
     * @param {object} magic
     * @returns {object} {
     *   broad: { id, label, category } | { id: 'dual_mage', label: 'Dual Mage' } | { id: 'balanced_mage', label: 'Balanced Mage' } | null,
     *   fine:  { id, label, type } | { id: 'balanced_mage', label: 'Balanced Mage' } | { id: 'dual_fine', label: 'X / Y' } | null,
     *   categoryTotals: { elemental, body, aether },
     *   topCategory: string | null,
     *   topType: string | null,
     *   topValue: number,
     *   tie: 'dual' | 'triple' | null,
     *   tieCategory: 'dual' | 'triple' | null
     * }
     */
    function deriveMagicalClasses(magic) {
        var result = {
            broad: null,
            fine: null,
            categoryTotals: { elemental: 0, body: 0, aether: 0 },
            topCategory: null,
            topType: null,
            topValue: 0,
            tie: null,
            tieCategory: null
        };

        if (!MagicConstants) { return result; }

        var normalised = {};
        MagicConstants.getTypeKeys().forEach(function(type) {
            normalised[type] = clampMagic(magic ? magic[type] : 0);
        });

        var totals = getCategoryTotals(normalised);
        result.categoryTotals = totals;

        var grandTotal = totals.elemental + totals.body + totals.aether;
        if (grandTotal === 0) {
            return result;  // no magic at all
        }

        // ---- Find top category or categories ----
        var categories = MagicConstants.getCategoryOrder();  // ['elemental','body','aether']
        var topTotal = -1;
        categories.forEach(function(cat) {
            if (totals[cat] > topTotal) { topTotal = totals[cat]; }
        });

        var categoriesAtTop = categories.filter(function(cat) {
            return totals[cat] === topTotal && topTotal > 0;
        });

        if (categoriesAtTop.length === 3) {
            result.broad = { id: 'balanced_mage', label: 'Balanced Mage', category: null };
            result.tieCategory = 'triple';
            return result;
        }

        if (categoriesAtTop.length === 2) {
            result.broad = { id: 'dual_mage', label: 'Dual Mage', category: null };
            result.tieCategory = 'dual';
            return result;
        }

        // Single winning category
        var winningCategory = categoriesAtTop[0];
        result.topCategory = winningCategory;

        var broadClass = MagicConstants.getBroadClassForCategory(winningCategory);
        result.broad = broadClass;

        // ---- Find top proficiency within the winning category ----
        var typesInCategory = MagicConstants.getCategoryTypes(winningCategory);
        var topValue = 0;
        typesInCategory.forEach(function(type) {
            if (normalised[type] > topValue) {
                topValue = normalised[type];
            }
        });

        result.topValue = topValue;

        if (topValue < MAGIC_FINE_CLASS_MIN) {
            // Below threshold → no fine class
            return result;
        }

        var typesAtTop = typesInCategory.filter(function(type) {
            return normalised[type] === topValue;
        });

        if (typesAtTop.length >= 3) {
            result.fine = { id: 'balanced_mage', label: 'Balanced Mage', type: null };
            result.tie = 'triple';
            return result;
        }

        if (typesAtTop.length === 2) {
            var fineA = MagicConstants.getFineClassForType(typesAtTop[0]);
            var fineB = MagicConstants.getFineClassForType(typesAtTop[1]);
            var label = (fineA ? fineA.label : typesAtTop[0]) + ' / ' +
                        (fineB ? fineB.label : typesAtTop[1]);
            result.fine = { id: 'dual_fine', label: label, type: null };
            result.tie = 'dual';
            return result;
        }

        // Single winner
        var winningType = typesAtTop[0];
        result.topType = winningType;
        result.fine = MagicConstants.getFineClassForType(winningType);

        return result;
    }

    /**
     * Apply a fine magical class — raises the corresponding proficiency
     * to at least 8 (Expert level) if currently lower. Returns new magic.
     * Does NOT touch other proficiencies.
     * 
     * @param {string} fineClassId - Fine class id (e.g. 'pyromancer')
     * @param {object} currentMagic - Current magic object
     * @returns {object|null} New magic object, or null if class invalid
     */
    function applyFineMagicalClass(fineClassId, currentMagic) {
        if (!MagicConstants) { return null; }

        var fine = MagicConstants.getFineClass(fineClassId);
        if (!fine) { return null; }

        var newMagic = getDefaultMagicProficiencies();
        // Copy current values
        MagicConstants.getTypeKeys().forEach(function(type) {
            newMagic[type] = clampMagic(currentMagic ? currentMagic[type] : 0);
        });

        // Raise the target proficiency to at least 8
        var target = fine.type;
        if (target) {
            newMagic[target] = Math.max(newMagic[target], 8);
        }

        return newMagic;
    }

    // ============================================================
    // MAGIC RANK (used by older display code)
    // ============================================================

    /**
     * Get a qualitative rank label from a total magical power (0–180).
     * This replaces the old 0–100 weighted score ranking.
     */
    function getMagicRank(totalPower) {
        var num = Number(totalPower) || 0;
        if (num >= 140) { return 'Archmage'; }
        if (num >= 100) { return 'Master'; }
        if (num >= 70)  { return 'Adept'; }
        if (num >= 40)  { return 'Apprentice'; }
        if (num >= 15)  { return 'Novice'; }
        if (num > 0)    { return 'Dabbler'; }
        return 'Untrained';
    }

    // ============================================================
    // HP / MP
    // ============================================================

    /**
     * Roll HP based on stats and class. Returns a number.
     * Base 20–40 + class hpBonus + 2×CON modifier, min 1.
     * 
     * @param {object} stats
     * @returns {number}
     */
    function rollHP(stats) {
        var normalised = {};
        STAT_KEYS.forEach(function(key) {
            normalised[key] = clampStat(stats ? stats[key] : STAT_DEFAULT);
        });

        var base = randomInt(20, 40);

        var classMatch = derivePhysicalClass(normalised);
        var classBonus = classMatch && classMatch.class && classMatch.class.hpBonus
            ? classMatch.class.hpBonus
            : 0;

        var conMod = getAbilityModifier(normalised.con);

        var hp = base + classBonus + (conMod * 2);
        if (hp < 1) { hp = 1; }
        return hp;
    }

    /**
     * Roll MP based on magical proficiencies.
     * Base = totalMagic / 5
     * + bodyTotal × 0.5
     * + aetherTotal × 2
     * + random(0..10)
     * Capped at 200.
     * 
     * @param {object} magic
     * @returns {number}
     */
    function rollMP(magic) {
        var normalised = {};
        if (MagicConstants) {
            MagicConstants.getTypeKeys().forEach(function(type) {
                normalised[type] = clampMagic(magic ? magic[type] : 0);
            });
        }

        var totals = getCategoryTotals(normalised);
        var totalPower = calculateTotalMagicalPower(normalised);

        var base = Math.round(totalPower / 5);
        var bodyBonus = Math.round(totals.body * 0.5);
        var aetherBonus = totals.aether * 2;
        var random = randomInt(0, 10);

        var mp = base + bodyBonus + aetherBonus + random;
        if (mp < 0) { mp = 0; }
        if (mp > 200) { mp = 200; }
        return mp;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterStats = {
        // Constants exposed for convenience
        STAT_KEYS: STAT_KEYS,
        STAT_MIN: STAT_MIN,
        STAT_MAX: STAT_MAX,
        STAT_DEFAULT: STAT_DEFAULT,
        STAT_RANDOM_MIN: STAT_RANDOM_MIN,
        STAT_RANDOM_MAX: STAT_RANDOM_MAX,
        MAGIC_MAX: MAGIC_MAX,
        MAGIC_FINE_CLASS_MIN: MAGIC_FINE_CLASS_MIN,

        // Physical stats
        getDefaultStats: getDefaultStats,
        getCharacterStats: getCharacterStats,
        getAbilityModifier: getAbilityModifier,
        getModifierDisplay: getModifierDisplay,
        clampStat: clampStat,
        rollPhysicalStats: rollPhysicalStats,

        // Physical class
        derivePhysicalClass: derivePhysicalClass,
        applyPhysicalClass: applyPhysicalClass,
        getPhysicalClassLabel: getPhysicalClassLabel,

        // Magical proficiencies
        getDefaultMagicProficiencies: getDefaultMagicProficiencies,
        getCharacterMagic: getCharacterMagic,
        clampMagic: clampMagic,
        rollMagicalProficiencies: rollMagicalProficiencies,

        // Magical classes
        getCategoryTotals: getCategoryTotals,
        calculateTotalMagicalPower: calculateTotalMagicalPower,
        deriveMagicalClasses: deriveMagicalClasses,
        applyFineMagicalClass: applyFineMagicalClass,
        getMagicRank: getMagicRank,

        // HP / MP
        rollHP: rollHP,
        rollMP: rollMP
    };

})();
