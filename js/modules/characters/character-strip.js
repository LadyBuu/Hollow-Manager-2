/**
 * modules/characters/character-strip.js - Character Strip Helpers
 * Reduce a character record to its meaningful fields.
 *
 * Path: js/modules/characters/character-strip.js
 *
 * WHAT THIS OWNS:
 *   - isFillerCandidate(char)         heuristic; true when the
 *                                     character has no authored
 *                                     content of any kind.
 *   - hasAuthoredContent(char)        the inverse predicate.
 *   - stripEmptyFields(char)          returns a NEW object containing
 *                                     only the non-empty, non-default
 *                                     keys.
 *   - stripEliminatedForExport(arr)   returns a NEW array in which
 *                                     every eliminated character has
 *                                     been reduced via stripEmptyFields.
 *
 * WHAT THIS DOES NOT DO:
 *   - Does not mutate window.data.
 *   - Does not touch persistence.
 *   - Does not decide WHEN to strip. That is CharacterCRUD's job
 *     (save path) and ExportEnvelope.create's job (export path).
 *   - Does not check team membership.
 *
 * STRIP AND NORMALISE — INTERACTION:
 *   normaliseDataStructure in database.js runs on every save and
 *   re-adds a standard set of fields to every character:
 *   personality, specialMoves, attraction, sexuality, hp, mp,
 *   combatNotes, weapons, classIds.
 *
 *   For SCALAR fields (hp, mp, attraction, sexuality, combatNotes),
 *   stripping a zero/empty value and having normalise re-add the
 *   same zero/empty value is a no-op on the round trip. The record
 *   loses nothing.
 *
 *   For CONTAINER fields (personality, specialMoves, weapons,
 *   classIds), normalise re-adds a fresh container even if the
 *   stripped record had none. That changes the object identity but
 *   not the semantic content: `personality: {}` and absent
 *   personality are indistinguishable to every consumer.
 *
 *   The strip therefore keeps empty CONTAINERS in place (as {} or
 *   []), so the round trip is stable and the stripped record is
 *   exactly what the next save will write. Scalar zeros are
 *   stripped; if normalise re-adds them, they come back as zeros,
 *   which is what the caller asked for.
 *
 *   This is a compromise between two policies that were previously
 *   in conflict: strip's "reduce to meaningful fields" and
 *   normalise's "every character has every field". Both are
 *   satisfied by keeping containers and dropping scalar defaults.
 *
 * HAS AUTHORED CONTENT:
 *   The predicate is deliberately conservative: it is better to
 *   leave a character flagged as filler than to unflag one on a
 *   false positive. Any authored field, stat above the default,
 *   any magic above zero, any HP or MP above zero, any weapon, any
 *   special move, any personality string or array, or any of the
 *   bio strings, counts as authored.
 *
 *   character-crud.js's local fallback (used when this module is
 *   absent) is narrower — it does not inspect personality arrays.
 *   Both use this module when it is loaded, so the drift only
 *   matters in a degraded environment. In the normal load order,
 *   this implementation is authoritative.
 *
 * DEPENDENCIES:
 *   - window.ObjectUtils (preferred; local fallback otherwise)
 */

(function() {
    'use strict';

    if (window.__characterStripLoaded) {
        return;
    }
    window.__characterStripLoaded = true;

    // ============================================================
    // DEPENDENCY ACCESS
    // ============================================================

    function getObjectUtils() {
        return window.ObjectUtils || null;
    }

    function isPlainObject(value) {
        var OU = getObjectUtils();
        if (OU && typeof OU.isPlainObject === 'function') {
            return OU.isPlainObject(value);
        }
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var STAT_DEFAULT = 10;

    var DEFAULT_DISPLAY_PARTS = {
        first: true,
        middle: true,
        last: true,
        nickname: false,
        alias: false
    };

    var DEFAULT_NAME_FORMAT = 'firstlast';

    // Fields that survive the strip unconditionally. These define
    // the character's identity: without them, the record is not a
    // record. Note that `gender` is NOT here; it is a bio field and
    // is stripped when empty, matching every other bio field.
    var ALWAYS_KEEP = {
        id: true,
        firstName: true,
        lastName: true,
        birthYear: true,
        deceased: true,
        isFiller: true,
        createdAt: true,
        updatedAt: true
    };

    // Arrays that are kept only if non-empty. An empty array is
    // equivalent to absent for these, and normalise re-adds them as
    // empty, so stripping is stable.
    var KEEP_NONEMPTY_ARRAY = {
        careerStatus: true,
        eliminations: true,
        eliminatedWeeks: true,
        previousNames: true
    };

    // Containers that are kept even when empty, so the round trip
    // through normaliseDataStructure is a no-op. See the STRIP AND
    // NORMALISE block above.
    var KEEP_EMPTY_CONTAINER = {
        personality: true,
        specialMoves: true,
        weapons: true,
        classIds: true
    };

    // Scalar and string fields that are dropped when empty. These
    // are re-added by normalise as the same empty value, so the
    // round trip is stable.
    var DROP_EMPTY_STRING = {
        middleName: true,
        nickname: true,
        alias: true,
        attraction: true,
        sexuality: true,
        gender: true,
        eyes: true,
        hair: true,
        skin: true,
        height: true,
        weight: true,
        build: true,
        appearanceNotes: true,
        specialty: true,
        notes: true,
        combatNotes: true,
        deathYear: true,
        deathAge: true,
        deathCause: true,
        deathWeek: true,
        graduatingClassId: true
    };

    // ============================================================
    // HELPERS
    // ============================================================

    function isEmptyString(value) {
        return typeof value === 'string' && value.trim() === '';
    }

    function isDefaultStatObject(obj) {
        if (!isPlainObject(obj)) { return false; }
        var keys = Object.keys(obj);
        if (keys.length === 0) { return true; }
        for (var i = 0; i < keys.length; i++) {
            if (obj[keys[i]] !== STAT_DEFAULT) {
                return false;
            }
        }
        return true;
    }

    function isZeroNumberObject(obj) {
        if (!isPlainObject(obj)) { return false; }
        var keys = Object.keys(obj);
        if (keys.length === 0) { return true; }
        for (var i = 0; i < keys.length; i++) {
            if (obj[keys[i]] !== 0) {
                return false;
            }
        }
        return true;
    }

    function isEmptyStringObject(obj) {
        if (!isPlainObject(obj)) { return false; }
        var keys = Object.keys(obj);
        if (keys.length === 0) { return true; }
        for (var i = 0; i < keys.length; i++) {
            var v = obj[keys[i]];
            if (typeof v === 'string' && v.trim() !== '') {
                return false;
            }
            if (typeof v === 'number' && v !== 0) {
                return false;
            }
            if (Array.isArray(v) && v.length > 0) {
                return false;
            }
            if (isPlainObject(v) && Object.keys(v).length > 0) {
                return false;
            }
        }
        return true;
    }

    function isEmptyArray(value) {
        return Array.isArray(value) && value.length === 0;
    }

    function isDefaultDisplayParts(obj) {
        if (!isPlainObject(obj)) { return false; }
        var keys = Object.keys(DEFAULT_DISPLAY_PARTS);
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            if (obj[k] !== DEFAULT_DISPLAY_PARTS[k]) { return false; }
        }
        if (Object.keys(obj).length !== keys.length) { return false; }
        return true;
    }

    function hasEliminationRecord(char) {
        if (!char || typeof char !== 'object') { return false; }
        if (Array.isArray(char.eliminations) &&
            char.eliminations.length > 0) {
            return true;
        }
        if (Array.isArray(char.eliminatedWeeks) &&
            char.eliminatedWeeks.length > 0) {
            return true;
        }
        return false;
    }

    // ============================================================
    // AUTHORED CONTENT
    // ============================================================

    function hasAuthoredContent(char) {
        if (!char || typeof char !== 'object') { return false; }

        if (isPlainObject(char.stats)) {
            var statKeys = Object.keys(char.stats);
            for (var i = 0; i < statKeys.length; i++) {
                if (char.stats[statKeys[i]] !== STAT_DEFAULT) {
                    return true;
                }
            }
        }

        if (isPlainObject(char.magic)) {
            var magicKeys = Object.keys(char.magic);
            for (var j = 0; j < magicKeys.length; j++) {
                var mv = char.magic[magicKeys[j]];
                if (typeof mv === 'number' && mv > 0) {
                    return true;
                }
            }
        }

        if (typeof char.hp === 'number' && char.hp > 0) { return true; }
        if (typeof char.mp === 'number' && char.mp > 0) { return true; }

        if (Array.isArray(char.weapons) && char.weapons.length > 0) {
            return true;
        }

        if (isPlainObject(char.specialMoves)) {
            var phys = char.specialMoves.physical;
            var magi = char.specialMoves.magical;
            if (Array.isArray(phys) && phys.length > 0) { return true; }
            if (Array.isArray(magi) && magi.length > 0) { return true; }
        }

        if (isPlainObject(char.personality)) {
            var pKeys = Object.keys(char.personality);
            for (var p = 0; p < pKeys.length; p++) {
                var pv = char.personality[pKeys[p]];
                if (typeof pv === 'string' && pv.trim() !== '') {
                    return true;
                }
                if (typeof pv === 'number' && pv !== 0) {
                    return true;
                }
                if (Array.isArray(pv) && pv.length > 0) {
                    return true;
                }
                if (isPlainObject(pv) && Object.keys(pv).length > 0) {
                    return true;
                }
            }
        }

        var bioFields = [
            'appearanceNotes', 'notes', 'combatNotes',
            'specialty', 'eyes', 'hair', 'skin',
            'height', 'weight', 'build',
            'attraction', 'sexuality', 'gender',
            'middleName', 'nickname', 'alias',
            'deathCause'
        ];
        for (var b = 0; b < bioFields.length; b++) {
            var bv = char[bioFields[b]];
            if (typeof bv === 'string' && bv.trim() !== '') {
                return true;
            }
        }

        return false;
    }

    function isFillerCandidate(char) {
        if (!char || typeof char !== 'object') { return false; }
        return !hasAuthoredContent(char);
    }

    // ============================================================
    // STRIP
    // ============================================================

    function stripEmptyFields(char) {
        if (!char || typeof char !== 'object') {
            return char;
        }

        var out = {};
        var keys = Object.keys(char);

        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var value = char[key];

            if (ALWAYS_KEEP[key]) {
                out[key] = value;
                continue;
            }

            if (KEEP_NONEMPTY_ARRAY[key]) {
                if (Array.isArray(value) && value.length > 0) {
                    out[key] = value;
                }
                continue;
            }

            if (KEEP_EMPTY_CONTAINER[key]) {
                if (key === 'specialMoves') {
                    // Preserve shape. A present-but-empty container
                    // is kept as-is; an absent one is not added.
                    // normaliseDataStructure re-adds the canonical
                    // shape on save, so the record stays stable.
                    if (isPlainObject(value)) {
                        var hasPhys = Array.isArray(value.physical) &&
                            value.physical.length > 0;
                        var hasMagi = Array.isArray(value.magical) &&
                            value.magical.length > 0;
                        if (hasPhys || hasMagi) {
                            out[key] = value;
                        } else {
                            // Present but empty: keep the canonical
                            // shape so normalise does not have to
                            // reconstruct it.
                            out[key] = {
                                physical: [],
                                magical: []
                            };
                        }
                    }
                } else if (key === 'personality') {
                    if (isPlainObject(value)) {
                        // Keep even an empty personality object.
                        out[key] = value;
                    }
                } else if (key === 'weapons') {
                    if (Array.isArray(value)) {
                        // Keep even an empty weapons array.
                        out[key] = value;
                    }
                } else if (key === 'classIds') {
                    if (Array.isArray(value)) {
                        // Keep even an empty classIds array.
                        out[key] = value;
                    }
                }
                continue;
            }

            if (DROP_EMPTY_STRING[key]) {
                if (typeof value === 'string' && value.trim() !== '') {
                    out[key] = value;
                } else if (typeof value === 'number') {
                    if (value !== 0) { out[key] = value; }
                }
                continue;
            }

            switch (key) {
                case 'stats':
                    if (isPlainObject(value) &&
                        !isDefaultStatObject(value)) {
                        out[key] = value;
                    }
                    continue;

                case 'magic':
                    if (isPlainObject(value) &&
                        !isZeroNumberObject(value)) {
                        out[key] = value;
                    }
                    continue;

                case 'hp':
                case 'mp':
                    // Scalar zeros are dropped. normalise re-adds
                    // them as zeros on save, which is stable.
                    if (typeof value === 'number' && value !== 0) {
                        out[key] = value;
                    }
                    continue;

                case 'displayParts':
                    if (isPlainObject(value) &&
                        !isDefaultDisplayParts(value)) {
                        out[key] = value;
                    }
                    continue;

                case 'nameFormat':
                    if (typeof value === 'string' &&
                        value !== '' &&
                        value !== DEFAULT_NAME_FORMAT) {
                        out[key] = value;
                    }
                    continue;

                case 'graduatingClassInstructor':
                    if (value === true) {
                        out[key] = value;
                    }
                    continue;

                default:
                    if (isEmptyString(value)) { continue; }
                    if (isEmptyArray(value)) { continue; }
                    if (value === null || value === undefined) {
                        continue;
                    }
                    out[key] = value;
            }
        }

        return out;
    }

    // ============================================================
    // EXPORT-TIME STRIP
    // ============================================================

    function stripEliminatedForExport(charArray) {
        if (!Array.isArray(charArray)) { return charArray; }

        var result = new Array(charArray.length);
        for (var i = 0; i < charArray.length; i++) {
            var c = charArray[i];
            if (!c || typeof c !== 'object') {
                result[i] = c;
                continue;
            }
            if (!hasEliminationRecord(c)) {
                result[i] = c;
                continue;
            }
            var reduced = stripEmptyFields(c);
            reduced.isFiller = true;
            result[i] = reduced;
        }
        return result;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterStrip = Object.freeze({
        isFillerCandidate: isFillerCandidate,
        hasAuthoredContent: hasAuthoredContent,
        stripEmptyFields: stripEmptyFields,
        stripEliminatedForExport: stripEliminatedForExport
    });

})();
