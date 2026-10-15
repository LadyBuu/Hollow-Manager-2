/**
 * modules/characters/character-stats.js - Character Stats & Magic System
 * Domain logic for physical stats, magical proficiencies, classes,
 * and HP/MP.
 *
 * Path: js/modules/characters/character-stats.js
 *
 * This module handles:
 *   - Physical stat calculation, validation, modifiers
 *   - Random physical stat generation (STAT_RANDOM_MIN..MAX range)
 *   - Physical class derivation (weighted scoring)
 *   - Physical class application (rewrites stats)
 *   - Magical proficiency calculation, validation, levels
 *   - Random magical proficiency generation (weighted by category)
 *   - Broad magical class derivation (category totals)
 *   - Fine magical class derivation (per-proficiency)
 *   - Fine magical class application (raises a single proficiency)
 *   - Total magical power (0..MAGIC_MAX * 18 sum)
 *   - HP / MP calculation (random + modifiers)
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Special moves. Owned by character-moves.js.
 *   - Persistence. This file is pure calculation and derivation.
 *   - Class definitions. Those live in CharacterConstants
 *     (physical classes) and MagicConstants (broad, fine classes).
 *
 * IMPORTANT:
 *   - DOMAIN LOGIC ONLY - no rendering
 *   - All functions here are PURE. No MutationPipeline use.
 *   - No UI dependencies (no notifications, no confirm, no rendering)
 *   - Uses CharacterConstants for stat and HP/MP bounds (lazy)
 *   - Uses MagicConstants for magic type keys and levels (lazy)
 *
 * LOAD ORDER:
 *   This module loads cleanly regardless of script order. Both
 *   CharacterConstants and MagicConstants are resolved at call
 *   time. A missing module is degraded rather than fatal:
 *     - Missing CharacterConstants: stat and HP/MP bounds fall
 *       back to the same numeric defaults this file has always used.
 *     - Missing MagicConstants: magic type keys fall back to the
 *       keys of the passed-in magic object, and the fine-class
 *       threshold falls back to the local default.
 *
 * LIVE GETTERS:
 *   STAT_KEYS, STAT_MIN, STAT_MAX, STAT_DEFAULT, STAT_RANDOM_MIN,
 *   STAT_RANDOM_MAX, MAGIC_MAX, MAGIC_FINE_CLASS_MIN are exposed as
 *   getters, not captured values. A caller reading them sees the
 *   current value from the constants module, not a stale snapshot.
 *
 * HP BOUNDS:
 *   HP_MAX is the hard cap used by CharacterCRUD.normaliseCharacterData
 *   (999) and by rollHP's clamp. HP_BASE_MIN and HP_BASE_MAX are the
 *   natural roll range before class and CON modifiers. They are
 *   separate concepts.
 *
 * MP BOUNDS:
 *   MP_MAX is 200. rollMP caps at MP_MAX.
 *
 * PHYSICAL CLASS DERIVATION vs APPLICATION:
 *   derivePhysicalClass(stats) answers "which class best fits this
 *   stat block?" via a weighted dot product. It is a similarity
 *   score and it can return a different class than the one a user
 *   picked from the override, if the derived scores happen to
 *   favour a neighbour.
 *
 *   applyPhysicalClass(classId) answers "produce a stat block that
 *   matches this class." Its output is a rewrite, not a hint.
 *
 * DEPENDENCIES (LAZY):
 *   - window.CharacterConstants
 *   - window.MagicConstants
 */

(function() {
    'use strict';

    if (window.__characterStatsLoaded) {
        return;
    }
    window.__characterStatsLoaded = true;

    // ============================================================
    // DEPENDENCY ACCESS - LAZY
    // ============================================================

    function getCC() { return window.CharacterConstants || null; }
    function getMC() { return window.MagicConstants || null; }

    function getStatKeys() {
        var CC = getCC();
        if (CC && Array.isArray(CC.STAT_KEYS)) {
            return CC.STAT_KEYS;
        }
        return ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    }

    function getStatMin() {
        var CC = getCC();
        if (CC && typeof CC.STAT_MIN === 'number') { return CC.STAT_MIN; }
        return 1;
    }

    function getStatMax() {
        var CC = getCC();
        if (CC && typeof CC.STAT_MAX === 'number') { return CC.STAT_MAX; }
        return 30;
    }

    function getStatDefault() {
        var CC = getCC();
        if (CC && typeof CC.STAT_DEFAULT === 'number') {
            return CC.STAT_DEFAULT;
        }
        return 10;
    }

    function getStatRandomMin() {
        var CC = getCC();
        if (CC && typeof CC.STAT_RANDOM_MIN === 'number') {
            return CC.STAT_RANDOM_MIN;
        }
        return 6;
    }

    function getStatRandomMax() {
        var CC = getCC();
        if (CC && typeof CC.STAT_RANDOM_MAX === 'number') {
            return CC.STAT_RANDOM_MAX;
        }
        return 18;
    }

    function getMagicMax() {
        var MC = getMC();
        if (MC && typeof MC.MAGIC_MAX === 'number') {
            return MC.MAGIC_MAX;
        }
        return 10;
    }

    function getMagicFineClassMin() {
        var MC = getMC();
        if (MC && typeof MC.MAGIC_FINE_CLASS_MIN === 'number') {
            return MC.MAGIC_FINE_CLASS_MIN;
        }
        return 3;
    }

    function getMagicTypeKeys() {
        var MC = getMC();
        if (MC && typeof MC.getTypeKeys === 'function') {
            return MC.getTypeKeys();
        }
        return null;
    }

    function getHPMax() {
        var CC = getCC();
        if (CC && typeof CC.HP_MAX === 'number') { return CC.HP_MAX; }
        return 999;
    }

    function getMPMax() {
        var CC = getCC();
        if (CC && typeof CC.MP_MAX === 'number') { return CC.MP_MAX; }
        return 200;
    }

    function getMPBaseDivisor() {
        var CC = getCC();
        if (CC && typeof CC.MP_BASE_DIVISOR === 'number') {
            return CC.MP_BASE_DIVISOR;
        }
        return 5;
    }

    function getMPAetherMultiplier() {
        var CC = getCC();
        if (CC && typeof CC.MP_AETHER_MULTIPLIER === 'number') {
            return CC.MP_AETHER_MULTIPLIER;
        }
        return 2;
    }

    function getMPBodyMultiplier() {
        var CC = getCC();
        if (CC && typeof CC.MP_BODY_MULTIPLIER === 'number') {
            return CC.MP_BODY_MULTIPLIER;
        }
        return 0.5;
    }

    function getMPRandomMax() {
        var CC = getCC();
        if (CC && typeof CC.MP_RANDOM_MAX === 'number') {
            return CC.MP_RANDOM_MAX;
        }
        return 10;
    }

    function getHPBaseMin() {
        var CC = getCC();
        if (CC && typeof CC.HP_BASE_MIN === 'number') {
            return CC.HP_BASE_MIN;
        }
        return 20;
    }

    function getHPBaseMax() {
        var CC = getCC();
        if (CC && typeof CC.HP_BASE_MAX === 'number') {
            return CC.HP_BASE_MAX;
        }
        return 40;
    }

    // ============================================================
    // UTILITY - Random helpers
    // ============================================================

    function randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function pickWeighted(items, weights) {
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
        var keys = getStatKeys();
        var def = getStatDefault();
        for (var i = 0; i < keys.length; i++) {
            stats[keys[i]] = def;
        }
        return stats;
    }

    function clampStat(value) {
        var num = Number(value);
        if (isNaN(num) || !isFinite(num)) { return getStatDefault(); }
        return Math.max(
            getStatMin(),
            Math.min(getStatMax(), Math.round(num))
        );
    }

    function getCharacterStats(char) {
        var keys = getStatKeys();
        var def = getStatDefault();

        if (!char) {
            var empty = {};
            for (var e = 0; e < keys.length; e++) {
                empty[keys[e]] = def;
            }
            return empty;
        }
        if (!char.stats || typeof char.stats !== 'object') {
            var empty2 = {};
            for (var e2 = 0; e2 < keys.length; e2++) {
                empty2[keys[e2]] = def;
            }
            return empty2;
        }

        var stats = char.stats;
        var result = {};
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var val = stats[key];
            if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
                result[key] = clampStat(val);
            } else {
                result[key] = def;
            }
        }
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
     * Roll physical stats via a 3d6-shaped roll for each key.
     *
     * Each key gets `randomInt(1,6) + randomInt(1,6) + randomInt(1,6)`
     * clamped to [STAT_RANDOM_MIN, STAT_RANDOM_MAX]. The raw 3d6
     * distribution is a bell centred at 10.5, truncated by the
     * clamp. With the default bounds (6..18), the truncation is
     * symmetric and the mean is unchanged.
     *
     * @returns {object} Stats object keyed by STAT_KEYS
     */
    function rollPhysicalStats() {
        var keys = getStatKeys();
        var randMin = getStatRandomMin();
        var randMax = getStatRandomMax();
        var stats = {};

        for (var i = 0; i < keys.length; i++) {
            var roll = randomInt(1, 6) + randomInt(1, 6) + randomInt(1, 6);

            if (roll < randMin) { roll = randMin; }
            if (roll > randMax) { roll = randMax; }

            stats[keys[i]] = roll;
        }
        return stats;
    }

    // ============================================================
    // PHYSICAL CLASS - Derivation
    // ============================================================

    function derivePhysicalClass(stats) {
        var CC = getCC();
        if (!CC || !Array.isArray(CC.PHYSICAL_CLASSES)) {
            return null;
        }
        if (!stats || typeof stats !== 'object') {
            return null;
        }

        var keys = getStatKeys();
        var normalised = {};
        for (var n = 0; n < keys.length; n++) {
            normalised[keys[n]] = clampStat(stats[keys[n]]);
        }

        var ranked = [];

        for (var c = 0; c < CC.PHYSICAL_CLASSES.length; c++) {
            var cls = CC.PHYSICAL_CLASSES[c];
            var score = 0;
            for (var k = 0; k < keys.length; k++) {
                var weight = cls.weights[keys[k]] || 0;
                score += normalised[keys[k]] * weight;
            }
            ranked.push({ class: cls, score: score });
        }

        ranked.sort(function(a, b) {
            if (b.score !== a.score) { return b.score - a.score; }
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
     * @param {string} classId
     * @returns {string}
     */
    function getPhysicalClassLabel(classId) {
        var CC = getCC();
        if (!CC ||
            typeof CC.getPhysicalClass !== 'function') {
            return '\u2014';
        }
        var cls = CC.getPhysicalClass(classId);
        return cls && cls.label ? cls.label : '\u2014';
    }

    /**
     * Apply a physical class to a character's stats — returns new
     * stats. Does NOT mutate. Formula: stat = 6 + weight * 40 + jitter(-2..+2)
     *
     * @param {string} classId
     * @param {object} options - { jitter: boolean } default true
     * @returns {object|null} New stats object, or null if class invalid
     */
    function applyPhysicalClass(classId, options) {
        options = options || {};
        var useJitter = options.jitter !== false;

        var CC = getCC();
        if (!CC || typeof CC.getPhysicalClass !== 'function') {
            return null;
        }
        var cls = CC.getPhysicalClass(classId);
        if (!cls) { return null; }

        var keys = getStatKeys();
        var stats = {};
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var w = cls.weights[key] || 0;
            var base = Math.round(6 + w * 40);
            if (useJitter) {
                base += randomInt(-2, 2);
            }
            stats[key] = clampStat(base);
        }

        return stats;
    }

    // ============================================================
    // MAGICAL PROFICIENCIES
    // ============================================================

    function getDefaultMagicProficiencies() {
        var proficiencies = {};
        var keys = getMagicTypeKeys();
        if (!keys) { return proficiencies; }
        for (var i = 0; i < keys.length; i++) {
            proficiencies[keys[i]] = 0;
        }
        return proficiencies;
    }

    function clampMagic(value) {
        var max = getMagicMax();
        var num = Number(value);
        if (isNaN(num) || !isFinite(num)) { return 0; }
        return Math.max(0, Math.min(max, Math.round(num)));
    }

    function getCharacterMagic(char) {
        var result = getDefaultMagicProficiencies();
        if (!char || !char.magic || typeof char.magic !== 'object') {
            return result;
        }

        var keys = getMagicTypeKeys();
        if (!keys) {
            keys = Object.keys(char.magic);
        }

        var magic = char.magic;
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var val = magic[key];
            if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
                result[key] = clampMagic(val);
            } else {
                result[key] = 0;
            }
        }
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
     * Returns {} when MagicConstants is not loaded; the caller can
     * detect this by the absence of keys.
     *
     * @returns {object} Magic proficiencies object
     */
    function rollMagicalProficiencies() {
        var magic = getDefaultMagicProficiencies();

        var MC = getMC();
        if (!MC || typeof MC.getCategoryTypes !== 'function') {
            return magic;
        }

        var elementalTypes = MC.getCategoryTypes('elemental');
        var bodyTypes      = MC.getCategoryTypes('body');
        var aetherTypes    = MC.getCategoryTypes('aether');

        // ---- Elemental: all roll, peak around 4 ----
        for (var ei = 0; ei < elementalTypes.length; ei++) {
            var ev = [1, 2, 3, 4, 5, 6, 7, 8];
            var ew = [5, 10, 15, 20, 20, 15, 10, 5];
            magic[elementalTypes[ei]] = pickWeighted(ev, ew);
        }

        // ---- Body: 3–4 of 6 roll, peak around 3 ----
        var bodyShuffled = shuffle(bodyTypes);
        var bodyCount = randomInt(3, 4);
        for (var bi = 0; bi < bodyCount; bi++) {
            var bv = [1, 2, 3, 4, 5, 6, 7];
            var bw = [10, 20, 25, 20, 12, 8, 5];
            magic[bodyShuffled[bi]] = pickWeighted(bv, bw);
        }

        // ---- Aether: 10% none, else 1–2 of 6, peak around 2 ----
        var skipAether = Math.random() < 0.10;
        if (!skipAether) {
            var aetherShuffled = shuffle(aetherTypes);
            var aetherCount = randomInt(1, 2);
            for (var ai = 0; ai < aetherCount; ai++) {
                var av = [1, 2, 3, 4, 5, 6];
                var aw = [20, 30, 25, 15, 7, 3];
                magic[aetherShuffled[ai]] = pickWeighted(av, aw);
            }
        }

        return magic;
    }

    // ============================================================
    // MAGICAL CLASSES - Derivation
    // ============================================================

    function getCategoryTotals(magic) {
        var totals = { elemental: 0, body: 0, aether: 0 };
        var MC = getMC();
        if (!magic || !MC || typeof MC.getTypeKeys !== 'function') {
            return totals;
        }

        var keys = MC.getTypeKeys();
        for (var i = 0; i < keys.length; i++) {
            var type = keys[i];
            var category = MC.getTypeCategory(type);
            var value = Number(magic[type]) || 0;
            if (category && totals[category] !== undefined) {
                totals[category] += value;
            }
        }
        return totals;
    }

    function calculateTotalMagicalPower(magic) {
        var MC = getMC();
        if (!magic || !MC || typeof MC.getTypeKeys !== 'function') {
            return 0;
        }
        var total = 0;
        var keys = MC.getTypeKeys();
        for (var i = 0; i < keys.length; i++) {
            total += Number(magic[keys[i]]) || 0;
        }
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
     *   - Top proficiency in category < MAGIC_FINE_CLASS_MIN →
     *     no fine class
     *   - Two-way proficiency tie → fine "X / Y"
     *   - Three-way proficiency tie → fine "Balanced Mage"
     *   - Single proficiency → fine class from that type
     *
     * The result carries `topValue` (the highest proficiency value
     * in the winning category, or in ANY category when the top
     * category is tied). It is 0 only when the entire magic block
     * is zero.
     *
     * @param {object} magic
     * @returns {object} projection summary
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

        var MC = getMC();
        if (!MC || typeof MC.getTypeKeys !== 'function') {
            return result;
        }

        var keys = MC.getTypeKeys();
        var normalised = {};
        for (var ni = 0; ni < keys.length; ni++) {
            normalised[keys[ni]] = clampMagic(magic ? magic[keys[ni]] : 0);
        }

        var totals = getCategoryTotals(normalised);
        result.categoryTotals = totals;

        var grandTotal = totals.elemental + totals.body + totals.aether;
        if (grandTotal === 0) {
            return result;
        }

        // Highest proficiency value anywhere, used as a default for
        // topValue when the categories tie.
        var globalTopValue = 0;
        for (var gti = 0; gti < keys.length; gti++) {
            if (normalised[keys[gti]] > globalTopValue) {
                globalTopValue = normalised[keys[gti]];
            }
        }
        result.topValue = globalTopValue;

        // ---- Find top category or categories ----
        var categories = (typeof MC.getCategoryOrder === 'function')
            ? MC.getCategoryOrder()
            : ['elemental', 'body', 'aether'];
        var topTotal = -1;
        for (var ci = 0; ci < categories.length; ci++) {
            if (totals[categories[ci]] > topTotal) {
                topTotal = totals[categories[ci]];
            }
        }

        var categoriesAtTop = [];
        for (var cj = 0; cj < categories.length; cj++) {
            if (totals[categories[cj]] === topTotal && topTotal > 0) {
                categoriesAtTop.push(categories[cj]);
            }
        }

        if (categoriesAtTop.length === 3) {
            result.broad = {
                id: 'balanced_mage',
                label: 'Balanced Mage',
                category: null
            };
            result.tieCategory = 'triple';
            return result;
        }

        if (categoriesAtTop.length === 2) {
            result.broad = {
                id: 'dual_mage',
                label: 'Dual Mage',
                category: null
            };
            result.tieCategory = 'dual';
            return result;
        }

        // Single winning category
        var winningCategory = categoriesAtTop[0];
        result.topCategory = winningCategory;

        var broadClass = (typeof MC.getBroadClassForCategory === 'function')
            ? MC.getBroadClassForCategory(winningCategory)
            : null;
        result.broad = broadClass;

        // ---- Find top proficiency within the winning category ----
        var typesInCategory = (typeof MC.getCategoryTypes === 'function')
            ? MC.getCategoryTypes(winningCategory)
            : [];
        var topValueInCategory = 0;
        for (var ti = 0; ti < typesInCategory.length; ti++) {
            if (normalised[typesInCategory[ti]] > topValueInCategory) {
                topValueInCategory = normalised[typesInCategory[ti]];
            }
        }

        result.topValue = topValueInCategory;

        var fineMin = getMagicFineClassMin();

        if (topValueInCategory < fineMin) {
            return result;
        }

        var typesAtTop = [];
        for (var tj = 0; tj < typesInCategory.length; tj++) {
            if (normalised[typesInCategory[tj]] === topValueInCategory) {
                typesAtTop.push(typesInCategory[tj]);
            }
        }

        if (typesAtTop.length >= 3) {
            result.fine = {
                id: 'balanced_mage',
                label: 'Balanced Mage',
                type: null
            };
            result.tie = 'triple';
            return result;
        }

        if (typesAtTop.length === 2) {
            var fineA = (typeof MC.getFineClassForType === 'function')
                ? MC.getFineClassForType(typesAtTop[0]) : null;
            var fineB = (typeof MC.getFineClassForType === 'function')
                ? MC.getFineClassForType(typesAtTop[1]) : null;
            var label = (fineA ? fineA.label : typesAtTop[0]) + ' / ' +
                        (fineB ? fineB.label : typesAtTop[1]);
            result.fine = {
                id: 'dual_fine',
                label: label,
                type: null
            };
            result.tie = 'dual';
            return result;
        }

        // Single winner
        var winningType = typesAtTop[0];
        result.topType = winningType;
        result.fine = (typeof MC.getFineClassForType === 'function')
            ? MC.getFineClassForType(winningType)
            : null;

        return result;
    }

    /**
     * Apply a fine magical class — raises the corresponding
     * proficiency to at least 8 (Expert level) if currently lower.
     * Returns new magic. Does NOT touch other proficiencies.
     *
     * @param {string} fineClassId
     * @param {object} currentMagic
     * @returns {object|null} New magic object, or null if class invalid
     */
    function applyFineMagicalClass(fineClassId, currentMagic) {
        var MC = getMC();
        if (!MC || typeof MC.getFineClass !== 'function') {
            return null;
        }

        var fine = MC.getFineClass(fineClassId);
        if (!fine) { return null; }

        var newMagic = getDefaultMagicProficiencies();
        var keys = getMagicTypeKeys();
        if (!keys) { return newMagic; }

        for (var i = 0; i < keys.length; i++) {
            newMagic[keys[i]] = clampMagic(
                currentMagic ? currentMagic[keys[i]] : 0
            );
        }

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
     * Get a qualitative rank label from a total magical power.
     * Replaces the old 0–100 weighted score ranking.
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
     * Roll HP based on stats and class.
     * Base HP_BASE_MIN..HP_BASE_MAX + class hpBonus +
     * 2×CON modifier, capped at HP_MAX.
     *
     * @param {object} stats
     * @returns {number}
     */
    function rollHP(stats) {
        var keys = getStatKeys();
        var def = getStatDefault();

        var normalised = {};
        for (var i = 0; i < keys.length; i++) {
            normalised[keys[i]] = clampStat(
                stats ? stats[keys[i]] : def
            );
        }

        var base = randomInt(getHPBaseMin(), getHPBaseMax());

        var classMatch = derivePhysicalClass(normalised);
        var classBonus = classMatch && classMatch.class &&
            classMatch.class.hpBonus
            ? classMatch.class.hpBonus
            : 0;

        var conMod = getAbilityModifier(normalised.con);

        var hp = base + classBonus + (conMod * 2);
        if (hp < 1) { hp = 1; }
        if (hp > getHPMax()) { hp = getHPMax(); }
        return hp;
    }

    /**
     * Roll MP based on magical proficiencies.
     * Base = totalMagic / MP_BASE_DIVISOR
     * + bodyTotal × MP_BODY_MULTIPLIER
     * + aetherTotal × MP_AETHER_MULTIPLIER
     * + random(0..MP_RANDOM_MAX)
     * Capped at MP_MAX.
     *
     * @param {object} magic
     * @returns {number}
     */
    function rollMP(magic) {
        var keys = getMagicTypeKeys();
        var normalised = {};

        if (keys) {
            for (var i = 0; i < keys.length; i++) {
                normalised[keys[i]] = clampMagic(
                    magic ? magic[keys[i]] : 0
                );
            }
        }

        var totals = getCategoryTotals(normalised);
        var totalPower = calculateTotalMagicalPower(normalised);

        var divisor = getMPBaseDivisor();
        var base = divisor > 0 ? Math.round(totalPower / divisor) : 0;

        var bodyBonus = Math.round(
            totals.body * getMPBodyMultiplier()
        );
        var aetherBonus = totals.aether * getMPAetherMultiplier();
        var random = randomInt(0, getMPRandomMax());

        var mp = base + bodyBonus + aetherBonus + random;
        if (mp < 0) { mp = 0; }
        if (mp > getMPMax()) { mp = getMPMax(); }
        return mp;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterStats = {
        // Constants exposed as LIVE GETTERS. Callers see the
        // current values from CharacterConstants / MagicConstants.
        get STAT_KEYS()          { return getStatKeys(); },
        get STAT_MIN()           { return getStatMin(); },
        get STAT_MAX()           { return getStatMax(); },
        get STAT_DEFAULT()       { return getStatDefault(); },
        get STAT_RANDOM_MIN()    { return getStatRandomMin(); },
        get STAT_RANDOM_MAX()    { return getStatRandomMax(); },
        get MAGIC_MAX()          { return getMagicMax(); },
        get MAGIC_FINE_CLASS_MIN() { return getMagicFineClassMin(); },

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

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.CharacterStats;
        var failures = [];

        var required = [
            'getDefaultStats',
            'getCharacterStats',
            'getAbilityModifier',
            'getModifierDisplay',
            'clampStat',
            'rollPhysicalStats',
            'derivePhysicalClass',
            'applyPhysicalClass',
            'getPhysicalClassLabel',
            'getDefaultMagicProficiencies',
            'getCharacterMagic',
            'clampMagic',
            'rollMagicalProficiencies',
            'getCategoryTotals',
            'calculateTotalMagicalPower',
            'deriveMagicalClasses',
            'applyFineMagicalClass',
            'getMagicRank',
            'rollHP',
            'rollMP'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                failures.push('missing export: ' + required[i]);
            }
        }

        try {
            var stats = exports.rollPhysicalStats();
            var keys = exports.STAT_KEYS;
            for (var k = 0; k < keys.length; k++) {
                var v = stats[keys[k]];
                if (typeof v !== 'number' ||
                    v < exports.STAT_MIN ||
                    v > exports.STAT_MAX) {
                    failures.push(
                        'rollPhysicalStats produced out-of-range ' +
                        keys[k] + ' = ' + v
                    );
                }
            }

            if (exports.getModifierDisplay(10) !== '+0') {
                failures.push('getModifierDisplay(10) should be +0');
            }
            if (exports.getModifierDisplay(20) !== '+5') {
                failures.push('getModifierDisplay(20) should be +5');
            }
            if (exports.getModifierDisplay(1) !== '-5') {
                failures.push('getModifierDisplay(1) should be -5');
            }
        } catch (e) {
            failures.push('smoke test threw: ' + e.message);
        }

        if (failures.length > 0) {
            throw new Error(
                '[CharacterStats] Verification failed: ' +
                failures.join('; ')
            );
        }
    })();

})();
