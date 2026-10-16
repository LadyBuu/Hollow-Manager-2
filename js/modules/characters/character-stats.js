/**
 * modules/characters/character-stats.js - Character Stats & Magic System
 * Domain logic for physical stats, magical proficiencies, classes,
 * and HP/MP.
 *
 * Path: js/modules/characters/character-stats.js
 *
 * This module handles:
 *   - Physical stat calculation, validation, modifiers
 *   - Random physical stat generation
 *   - Physical class derivation (weighted scoring)
 *   - Physical class application (rewrites stats)
 *   - Magical proficiency calculation, validation, levels
 *   - Random magical proficiency generation (weighted by category)
 *   - Broad magical class derivation (category totals)
 *   - Fine magical class derivation (per-proficiency)
 *   - Fine magical class application (raises a single proficiency)
 *   - Total magical power
 *   - HP / MP calculation (random + modifiers)
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Special moves. Owned by character-moves.js.
 *   - Persistence. This file is pure calculation and derivation.
 *   - Class definitions. Those live in CharacterConstants
 *     (physical classes) and MagicConstants (broad, fine classes,
 *     category multipliers, thresholds).
 *
 * LOAD ORDER:
 *   This module loads cleanly regardless of script order. Both
 *   CharacterConstants and MagicConstants are resolved at call
 *   time. A missing module is degraded rather than fatal:
 *     - Missing CharacterConstants: stat and HP/MP bounds fall
 *       back to local numeric defaults.
 *     - Missing MagicConstants: magic type keys fall back to the
 *       keys of the passed-in magic object, the fine-class
 *       threshold falls back to 3, and the category multipliers
 *       fall back to the same values the constants define.
 *
 * STRING COERCION:
 *   getCharacterStats and getCharacterMagic accept strings that
 *   parse to numbers. A JSON import or a hand-edited record with
 *   `"14"` for a stat or `"5"` for a proficiency is coerced the
 *   same way the form's collect path coerces it via parseInt.
 *   Before this change, non-number values fell back to the
 *   default (10 for stats, 0 for magic).
 *
 * CATEGORY MULTIPLIERS:
 *   MagicConstants defines MAGIC_CATEGORY_MULTIPLIERS (elemental
 *   1.0, body 1.2, aether 1.5). deriveMagicalClasses multiplies
 *   each category total by its multiplier before deciding which
 *   category wins. Without this, aether — the rarest and
 *   strongest category — almost never wins a tiebreak, and most
 *   rolled characters come out as Elementalist.
 *
 *   The `categoryTotals` field in the result is the RAW sum, not
 *   the multiplied sum. A caller rendering a breakdown sees the
 *   actual totals; the multiplier only affects the winner.
 *
 * BALANCED_MAGE_THRESHOLD:
 *   MagicConstants.BALANCED_MAGE_THRESHOLD is the number of
 *   tied top proficiencies above which the fine class is reported
 *   as "Balanced Mage" rather than as a specific class. This
 *   module reads it rather than hardcoding 3.
 *
 * LIVE GETTERS:
 *   STAT_KEYS, STAT_MIN, STAT_MAX, STAT_DEFAULT, STAT_RANDOM_MIN,
 *   STAT_RANDOM_MAX, MAGIC_MAX, and MAGIC_FINE_CLASS_MIN are
 *   exposed as getters. A caller reading them sees the current
 *   value from the constants module.
 *
 * HP BOUNDS:
 *   rollHP caps at CharacterConstants.HP_MAX (999). The
 *   HP_BASE_MIN and HP_BASE_MAX constants are the natural roll
 *   range before class and CON modifiers.
 *
 * MP BOUNDS:
 *   rollMP caps at CharacterConstants.MP_MAX (200).
 *
 * PHYSICAL CLASS DERIVATION vs APPLICATION:
 *   derivePhysicalClass(stats) is a similarity score: which class
 *   best fits this stat block? applyPhysicalClass(classId)
 *   rewrites a stat block to match a class. The override UI
 *   displays the picked class directly rather than re-deriving,
 *   so the derivation's occasional neighbour preference does not
 *   affect the display.
 *
 *   The collapse warning from character-constants.js (fighter ->
 *   brawler, tactician -> scholar) is a weight-table issue, not a
 *   derivation issue. The derivation is correct given the current
 *   weights.
 *
 * ABILITY MODIFIER:
 *   getAbilityModifier clamps the input stat first. Other modules
 *   compute the modifier unclamped. For a stat inside the legal
 *   range, the two agree. Outside it, this module's version is
 *   the one that stays bounded.
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
        if (CC && typeof CC.STAT_MIN === 'number') {
            return CC.STAT_MIN;
        }
        return 1;
    }

    function getStatMax() {
        var CC = getCC();
        if (CC && typeof CC.STAT_MAX === 'number') {
            return CC.STAT_MAX;
        }
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

    function getBalancedMageThreshold() {
        var MC = getMC();
        if (MC && typeof MC.BALANCED_MAGE_THRESHOLD === 'number') {
            return MC.BALANCED_MAGE_THRESHOLD;
        }
        return 3;
    }

    function getCategoryMultiplier(categoryId) {
        var MC = getMC();
        if (MC && typeof MC.getCategoryMultiplier === 'function') {
            return MC.getCategoryMultiplier(categoryId);
        }
        // Fallback: mirrors MagicConstants.
        if (categoryId === 'body') { return 1.2; }
        if (categoryId === 'aether') { return 1.5; }
        return 1.0;
    }

    function getMagicTypeKeys() {
        var MC = getMC();
        if (MC && typeof MC.getTypeKeys === 'function') {
            return MC.getTypeKeys();
        }
        return null;
    }

    function getCategoryOrder() {
        var MC = getMC();
        if (MC && typeof MC.getCategoryOrder === 'function') {
            return MC.getCategoryOrder();
        }
        return ['elemental', 'body', 'aether'];
    }

    function getHPMax() {
        var CC = getCC();
        if (CC && typeof CC.HP_MAX === 'number') {
            return CC.HP_MAX;
        }
        return 999;
    }

    function getMPMax() {
        var CC = getCC();
        if (CC && typeof CC.MP_MAX === 'number') {
            return CC.MP_MAX;
        }
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
        for (var i = 0; i < weights.length; i++) {
            total += weights[i];
        }
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

    /**
     * Coerce a value to a finite number, or return NaN.
     * Accepts strings that parse cleanly.
     */
    function coerceNumber(value) {
        if (typeof value === 'number') {
            return isFinite(value) ? value : NaN;
        }
        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '') { return NaN; }
            var num = Number(trimmed);
            return isFinite(num) ? num : NaN;
        }
        return NaN;
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
        var num = coerceNumber(value);
        if (isNaN(num)) { return getStatDefault(); }
        return Math.max(
            getStatMin(),
            Math.min(getStatMax(), Math.round(num))
        );
    }

    /**
     * Read the character's physical stats with coercion and
     * clamping. String values (from JSON imports or hand edits)
     * are parsed the same way numeric values are.
     */
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
            var num = coerceNumber(val);
            if (!isNaN(num)) {
                result[key] = clampStat(num);
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
     * Each key gets randomInt(1,6) * 3, clamped to
     * [STAT_RANDOM_MIN, STAT_RANDOM_MAX]. The raw 3d6 distribution
     * is a bell centred at 10.5, truncated by the clamp. With the
     * default bounds (6..18), the truncation raises 3, 4 and 5 to
     * 6 and leaves 6..18 unchanged.
     *
     * @returns {object} Stats object keyed by STAT_KEYS
     */
    function rollPhysicalStats() {
        var keys = getStatKeys();
        var randMin = getStatRandomMin();
        var randMax = getStatRandomMax();
        var stats = {};

        for (var i = 0; i < keys.length; i++) {
            var roll = randomInt(1, 6) + randomInt(1, 6) +
                randomInt(1, 6);

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
            return (a.class.label || '').localeCompare(
                b.class.label || ''
            );
        });

        if (ranked.length === 0) { return null; }

        return {
            class: ranked[0].class,
            score: ranked[0].score,
            ranked: ranked
        };
    }

    function getPhysicalClassLabel(classId) {
        var CC = getCC();
        if (!CC ||
            typeof CC.getPhysicalClass !== 'function') {
            return '\u2014';
        }
        var cls = CC.getPhysicalClass(classId);
        return cls && cls.label ? cls.label : '\u2014';
    }

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
        var num = coerceNumber(value);
        if (isNaN(num)) { return 0; }
        return Math.max(0, Math.min(max, Math.round(num)));
    }

    /**
     * Read the character's magic with coercion and clamping.
     * String values are parsed the same way numeric values are.
     */
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
            var num = coerceNumber(val);
            if (!isNaN(num)) {
                result[key] = clampMagic(num);
            } else {
                result[key] = 0;
            }
        }
        return result;
    }

    // ============================================================
    // MAGICAL PROFICIENCIES - Random roll
    // ============================================================

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
     * Derive broad + fine magical classes from a proficiency
     * profile.
     *
     * CATEGORY MULTIPLIER: each category's raw total is multiplied
     * by its MagicConstants.MAGIC_CATEGORY_MULTIPLIERS entry
     * (elemental 1.0, body 1.2, aether 1.5) before deciding which
     * category wins. This makes aether more likely to win a
     * near-tie, which matches the intended design.
     *
     * `categoryTotals` in the result is the RAW sum, not the
     * multiplied sum, so a caller rendering a breakdown sees the
     * actual totals.
     *
     * BALANCED_MAGE_THRESHOLD: a category tie of 3 or more
     * categories (all three tied) reports "Balanced Mage" as the
     * broad class. A proficiency tie of BALANCED_MAGE_THRESHOLD
     * or more within the winning category reports "Balanced Mage"
     * as the fine class.
     *
     * @returns {object} projection summary
     */
    function deriveMagicalClasses(magic) {
        var result = {
            broad: null,
            fine: null,
            categoryTotals: { elemental: 0, body: 0, aether: 0 },
            categoryTotalsWeighted: { elemental: 0, body: 0, aether: 0 },
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
            normalised[keys[ni]] = clampMagic(
                magic ? magic[keys[ni]] : 0
            );
        }

        var totals = getCategoryTotals(normalised);
        result.categoryTotals = totals;

        // Apply category multipliers for the winner decision.
        var weighted = {
            elemental: totals.elemental *
                getCategoryMultiplier('elemental'),
            body: totals.body * getCategoryMultiplier('body'),
            aether: totals.aether * getCategoryMultiplier('aether')
        };
        result.categoryTotalsWeighted = weighted;

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

        // ---- Find top category or categories, using the WEIGHTED
        // totals. ----
        var categories = getCategoryOrder();
        var topWeighted = -1;
        for (var ci = 0; ci < categories.length; ci++) {
            if (weighted[categories[ci]] > topWeighted) {
                topWeighted = weighted[categories[ci]];
            }
        }

        var categoriesAtTop = [];
        for (var cj = 0; cj < categories.length; cj++) {
            // Float comparison: use a tiny epsilon to account for
            // multiplier arithmetic.
            if (Math.abs(weighted[categories[cj]] - topWeighted) <
                1e-9 && topWeighted > 0) {
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

        var broadClass = (typeof MC.getBroadClassForCategory ===
            'function')
            ? MC.getBroadClassForCategory(winningCategory)
            : null;
        result.broad = broadClass;

        // ---- Find top proficiency within the winning category ----
        var typesInCategory =
            (typeof MC.getCategoryTypes === 'function')
            ? MC.getCategoryTypes(winningCategory)
            : [];
        var topValueInCategory = 0;
        for (var ti = 0; ti < typesInCategory.length; ti++) {
            if (normalised[typesInCategory[ti]] >
                topValueInCategory) {
                topValueInCategory =
                    normalised[typesInCategory[ti]];
            }
        }

        result.topValue = topValueInCategory;

        var fineMin = getMagicFineClassMin();

        if (topValueInCategory < fineMin) {
            return result;
        }

        var typesAtTop = [];
        for (var tj = 0; tj < typesInCategory.length; tj++) {
            if (normalised[typesInCategory[tj]] ===
                topValueInCategory) {
                typesAtTop.push(typesInCategory[tj]);
            }
        }

        var balancedThreshold = getBalancedMageThreshold();

        if (typesAtTop.length >= balancedThreshold) {
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
            var label = (fineA ? fineA.label : typesAtTop[0]) +
                ' / ' +
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
        var base = divisor > 0
            ? Math.round(totalPower / divisor)
            : 0;

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

    window.CharacterStats = Object.freeze({
        // Constants exposed as LIVE GETTERS.
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
        getDefaultMagicProficiencies:
            getDefaultMagicProficiencies,
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
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var failures = [];

        try {
            var exports = window.CharacterStats;

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
                    failures.push(
                        'missing export: ' + required[i]
                    );
                }
            }

            // Stat coercion: a string "14" reads as 14.
            var statsFromString = exports.getCharacterStats({
                stats: { str: '14', dex: 12 }
            });
            if (statsFromString.str !== 14) {
                failures.push(
                    'getCharacterStats should coerce "14" to 14'
                );
            }
            if (statsFromString.dex !== 12) {
                failures.push(
                    'getCharacterStats should read numeric 12 as 12'
                );
            }

            // Magic coercion: a string "5" reads as 5.
            if (typeof exports.getCharacterMagic === 'function') {
                var magicFromString = exports.getCharacterMagic({
                    magic: { fire: '5' }
                });
                if (magicFromString.fire !== 5) {
                    failures.push(
                        'getCharacterMagic should coerce "5" to 5'
                    );
                }
            }

            // Range checks
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
                failures.push(
                    'getModifierDisplay(10) should be +0'
                );
            }
            if (exports.getModifierDisplay(20) !== '+5') {
                failures.push(
                    'getModifierDisplay(20) should be +5'
                );
            }
            if (exports.getModifierDisplay(1) !== '-5') {
                failures.push(
                    'getModifierDisplay(1) should be -5'
                );
            }
        } catch (e) {
            failures.push('smoke test threw: ' + e.message);
        }

        if (failures.length > 0) {
            if (typeof console !== 'undefined' && console.error) {
                console.error(
                    '[CharacterStats] Verification failed: ' +
                    failures.join('; ')
                );
            }
        }
    })();

})();
