/**
 * modules/social/social-matcher.js - Social Pairing Matcher
 * Pure suggestion engine for "who should pair with whom."
 *
 * Path: js/modules/social/social-matcher.js
 *
 * WHAT THIS MODULE DOES:
 *   Given a target year and (optionally) a seed character, produces a
 *   ranked list of opposite-sex candidate pairs.
 *
 * WHAT THIS MODULE DOES NOT DO:
 *   - It does not open modals, render HTML, or touch the DOM.
 *   - It does not create relationships or characters.
 *   - It does not mutate window.data.
 *   - It has no side effects of any kind.
 *
 * ELIGIBILITY (a character enters the pool when ALL hold):
 *   - gender normalises to 'male' or 'female'
 *   - birthYear is parseable
 *   - alive at the target year (no deathYear, or deathYear >= year)
 *   - age at the target year is between MIN_PARENT_AGE and MAX_PARENT_AGE
 *   - not currently in an ongoing romantic relationship
 *
 * PAIR ELIGIBILITY (a pool pair is suggested when ALL hold):
 *   - one is male, one is female
 *   - |ageA - ageB| at the target year <= MAX_AGE_GAP
 *   - neither is the other's parent, child, or sibling (per parentIds)
 *
 * SCORING:
 *   Lower score is better.
 *     score = ageGap
 *             - (sameClass ? SAME_CLASS_BONUS : 0)
 *             + random jitter (JITTER_MAX * Math.random())
 *
 *   The jitter keeps the list from being strictly deterministic. It
 *   is small enough that same-class pairs reliably outrank non-same-
 *   class pairs at similar age gaps.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CharacterQueries
 *   - window.SocialQueries
 *   - window.AcademyClasses (optional but recommended for the class bonus)
 */

(function() {
    'use strict';

    if (window.__socialMatcherLoaded) {
        return;
    }
    window.__socialMatcherLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MAX_AGE_GAP = 6;
    var MIN_PARENT_AGE = 16;
    var MAX_PARENT_AGE = 60;
    var SAME_CLASS_BONUS = 3;
    var JITTER_MAX = 1.5;

    var MALE_ALIASES = [
        'male', 'm', 'man', 'boy', 'guy', 'gentleman', 'sir'
    ];
    var FEMALE_ALIASES = [
        'female', 'f', 'woman', 'girl', 'gal', 'lady', 'madam'
    ];

    // ============================================================
    // DEPENDENCY ACCESSORS
    // ============================================================

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    function getSocialQueries() {
        return window.SocialQueries || null;
    }

    function getAcademyClasses() {
        return window.AcademyClasses || null;
    }

    // ============================================================
    // GENDER NORMALISATION
    // ============================================================

    /**
     * Normalise a free-text gender string to 'male', 'female', or null.
     *
     * The character record's `gender` field is free-text; users can
     * type anything. This maps a small vocabulary of common spellings
     * to a binary, and returns null for anything else. A null result
     * excludes the character from the pool.
     *
     * @param {string} gender
     * @returns {'male'|'female'|null}
     */
    function normaliseGender(gender) {
        if (!gender || typeof gender !== 'string') {
            return null;
        }
        var lower = gender.trim().toLowerCase();
        if (lower === '') { return null; }

        if (MALE_ALIASES.indexOf(lower) !== -1) { return 'male'; }
        if (FEMALE_ALIASES.indexOf(lower) !== -1) { return 'female'; }
        return null;
    }

    // ============================================================
    // AGE AT YEAR
    // ============================================================

    /**
     * Age of a character at a given year. Returns null when birthYear
     * is missing or unparseable.
     */
    function ageAtYear(char, year) {
        if (!char || !char.birthYear) { return null; }
        var by = parseInt(char.birthYear, 10);
        if (isNaN(by)) { return null; }
        return year - by;
    }

    /**
     * Is the character alive at the given year?
     *
     * Alive means: no parseable deathYear, OR deathYear >= year.
     */
    function isAliveAtYear(char, year) {
        if (!char) { return false; }
        if (char.deathYear === undefined ||
            char.deathYear === null ||
            String(char.deathYear).trim() === '') {
            return true;
        }
        var dy = parseInt(char.deathYear, 10);
        if (isNaN(dy)) { return true; }
        return dy >= year;
    }

    // ============================================================
    // PARENT / SIBLING DETECTION
    // ============================================================

    /**
     * Read a character's parentIds as a set of strings.
     * Returns an empty object when the field is missing.
     */
    function readParentSet(char) {
        var set = Object.create(null);
        if (!char || !Array.isArray(char.parentIds)) {
            return set;
        }
        for (var i = 0; i < char.parentIds.length; i++) {
            var id = char.parentIds[i];
            if (id !== undefined && id !== null && id !== '') {
                set[String(id)] = true;
            }
        }
        return set;
    }

    /**
     * Are these two characters related by parent / child / sibling?
     * Uses parentIds on both records.
     *
     *   Parent: A.parentIds contains B.id, or B.parentIds contains A.id
     *   Sibling: A.parentIds and B.parentIds share at least one id
     *
     * Uncles, aunts, cousins, grandparents, and every other
     * relationship depth are NOT detected here. The user is the
     * authority on those.
     */
    function areCloselyRelated(charA, charB) {
        if (!charA || !charB) { return false; }

        var aId = String(charA.id);
        var bId = String(charB.id);

        var aParents = readParentSet(charA);
        var bParents = readParentSet(charB);

        // A is B's parent?
        if (bParents[aId]) { return true; }
        // B is A's parent?
        if (aParents[bId]) { return true; }

        // Shared parent -> siblings
        var aKeys = Object.keys(aParents);
        for (var i = 0; i < aKeys.length; i++) {
            if (bParents[aKeys[i]]) { return true; }
        }
        return false;
    }

    // ============================================================
    // CLASS MEMBERSHIP
    // ============================================================

    /**
     * Get the set of classIds for a character as a string set.
     * Returns an empty object when the field is missing.
     */
    function readClassSet(char) {
        var set = Object.create(null);
        if (!char || !Array.isArray(char.classIds)) {
            return set;
        }
        for (var i = 0; i < char.classIds.length; i++) {
            var id = char.classIds[i];
            if (id !== undefined && id !== null && id !== '') {
                set[String(id)] = true;
            }
        }
        return set;
    }

    function shareAnyClass(charA, charB) {
        var aClasses = readClassSet(charA);
        var keys = Object.keys(aClasses);
        if (keys.length === 0) { return false; }

        var bClasses = readClassSet(charB);
        for (var i = 0; i < keys.length; i++) {
            if (bClasses[keys[i]]) { return true; }
        }
        return false;
    }

    // ============================================================
    // POOL BUILDING
    // ============================================================

    /**
     * Build the eligible pool for the given year.
     *
     * Returns an array of { char, id, name, gender, age, classIds }
     * entries. Errors on missing dependencies produce an empty array,
     * not a throw: the caller is expected to render a friendly
     * message.
     */
    function buildPool(year) {
        var CharacterQueries = getCharacterQueries();
        var SocialQueries = getSocialQueries();

        if (!CharacterQueries || !SocialQueries) { return []; }
        if (typeof CharacterQueries.getCharacters !== 'function') {
            return [];
        }

        var all = CharacterQueries.getCharacters() || [];
        var pool = [];

        for (var i = 0; i < all.length; i++) {
            var char = all[i];
            if (!char || !char.id) { continue; }

            var gender = normaliseGender(char.gender);
            if (!gender) { continue; }

            var age = ageAtYear(char, year);
            if (age === null) { continue; }
            if (age < MIN_PARENT_AGE || age > MAX_PARENT_AGE) { continue; }

            if (!isAliveAtYear(char, year)) { continue; }

            if (SocialQueries.isCharacterRomanticallyInvolved(char.id)) {
                continue;
            }

            var name = 'Unknown';
            try {
                name = CharacterQueries.getDisplayName(char) || 'Unknown';
            } catch (e) {
                name = 'Unknown';
            }

            pool.push({
                char: char,
                id: String(char.id),
                name: name,
                gender: gender,
                age: age,
                status: (typeof CharacterQueries.getCurrentStatus === 'function')
                    ? CharacterQueries.getCurrentStatus(char)
                    : ''
            });
        }

        return pool;
    }

    // ============================================================
    // PAIR ELIGIBILITY
    // ============================================================

    function isPairEligible(entryA, entryB) {
        if (!entryA || !entryB) { return false; }

        if (entryA.gender === entryB.gender) { return false; }

        var gap = Math.abs(entryA.age - entryB.age);
        if (gap > MAX_AGE_GAP) { return false; }

        if (areCloselyRelated(entryA.char, entryB.char)) { return false; }

        return true;
    }

    // ============================================================
    // SCORING
    // ============================================================

    function scorePair(entryA, entryB) {
        var gap = Math.abs(entryA.age - entryB.age);
        var sameClass = shareAnyClass(entryA.char, entryB.char);

        var score = gap;
        if (sameClass) { score -= SAME_CLASS_BONUS; }
        score += Math.random() * JITTER_MAX;

        return {
            score: score,
            ageGap: gap,
            sameClass: sameClass
        };
    }

    // ============================================================
    // PUBLIC: SUGGESTIONS FOR A CHARACTER
    // ============================================================

    /**
     * Suggest partners for a specific character.
     *
     * @param {string} charId
     * @param {number} year
     * @param {object} [options]
     * @param {number} [options.limit] - Max candidates (default 20)
     * @returns {Array} [{ a, b, score, ageGap, sameClass }, ...]
     *                   a is the seed; b is the candidate.
     */
    function suggestForCharacter(charId, year, options) {
        options = options || {};
        var limit = options.limit || 20;

        if (!charId) { return []; }
        var yearNum = parseInt(year, 10);
        if (isNaN(yearNum) || yearNum < 1) { return []; }

        var pool = buildPool(yearNum);
        var seed = null;
        for (var i = 0; i < pool.length; i++) {
            if (pool[i].id === String(charId)) {
                seed = pool[i];
                break;
            }
        }
        if (!seed) { return []; }

        var results = [];
        for (var j = 0; j < pool.length; j++) {
            var candidate = pool[j];
            if (candidate.id === seed.id) { continue; }
            if (!isPairEligible(seed, candidate)) { continue; }

            var scoring = scorePair(seed, candidate);
            results.push({
                a: seed,
                b: candidate,
                score: scoring.score,
                ageGap: scoring.ageGap,
                sameClass: scoring.sameClass
            });
        }

        results.sort(function(x, y) { return x.score - y.score; });
        return results.slice(0, limit);
    }

    // ============================================================
    // PUBLIC: TOP PAIRS ACROSS THE POOL
    // ============================================================

    /**
     * Top N pairs across the whole eligible pool.
     *
     * @param {number} year
     * @param {object} [options]
     * @param {number} [options.limit] - Max pairs (default 40)
     * @returns {Array} [{ a, b, score, ageGap, sameClass }, ...]
     */
    function suggestTopPairs(year, options) {
        options = options || {};
        var limit = options.limit || 40;

        var yearNum = parseInt(year, 10);
        if (isNaN(yearNum) || yearNum < 1) { return []; }

        var pool = buildPool(yearNum);

        var scored = [];
        for (var i = 0; i < pool.length; i++) {
            for (var j = i + 1; j < pool.length; j++) {
                var a = pool[i];
                var b = pool[j];
                if (!isPairEligible(a, b)) { continue; }

                var scoring = scorePair(a, b);
                scored.push({
                    a: a,
                    b: b,
                    score: scoring.score,
                    ageGap: scoring.ageGap,
                    sameClass: scoring.sameClass
                });
            }
        }

        scored.sort(function(x, y) { return x.score - y.score; });
        return scored.slice(0, limit);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.SocialMatcher = {
        // Constants (read-only)
        MAX_AGE_GAP: MAX_AGE_GAP,
        MIN_PARENT_AGE: MIN_PARENT_AGE,
        MAX_PARENT_AGE: MAX_PARENT_AGE,

        // Normalisation and simple helpers
        normaliseGender: normaliseGender,
        ageAtYear: ageAtYear,
        isAliveAtYear: isAliveAtYear,
        areCloselyRelated: areCloselyRelated,
        shareAnyClass: shareAnyClass,

        // Pool and suggestions
        buildPool: buildPool,
        suggestForCharacter: suggestForCharacter,
        suggestTopPairs: suggestTopPairs
    };

})();
