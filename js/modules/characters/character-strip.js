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
 * EXPORT PATH:
 *   stripEliminatedForExport is called by ExportEnvelope.create on
 *   a deep-cloned character array. A character is "eliminated" for
 *   export purposes when either char.eliminations or
 *   char.eliminatedWeeks is a non-empty array. That is a shape
 *   check on the record itself, not a query.
 *
 * DEPENDENCIES:
 *   None.
 */

(function() {
    'use strict';

    if (window.__characterStripLoaded) {
        return;
    }
    window.__characterStripLoaded = true;

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

    var ALWAYS_KEEP = {
        id: true,
        firstName: true,
        lastName: true,
        gender: true,
        birthYear: true,
        deceased: true,
        isFiller: true,
        createdAt: true,
        updatedAt: true
    };

    var KEEP_NONEMPTY_ARRAY = {
        careerStatus: true,
        classIds: true,
        parentIds: true,
        eliminations: true,
        eliminatedWeeks: true,
        previousNames: true
    };

    var DROP_EMPTY_STRING = {
        middleName: true,
        nickname: true,
        alias: true,
        attraction: true,
        sexuality: true,
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

    function isPlainObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

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
            }
        }

        var bioFields = [
            'appearanceNotes', 'notes', 'combatNotes',
            'specialty', 'eyes', 'hair', 'skin',
            'height', 'weight', 'build',
            'attraction', 'sexuality',
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
                    if (typeof value === 'number' && value !== 0) {
                        out[key] = value;
                    }
                    continue;

                case 'weapons':
                    if (Array.isArray(value) && value.length > 0) {
                        out[key] = value;
                    }
                    continue;

                case 'specialMoves':
                    if (isPlainObject(value)) {
                        var hasPhys = Array.isArray(value.physical) &&
                            value.physical.length > 0;
                        var hasMagi = Array.isArray(value.magical) &&
                            value.magical.length > 0;
                        if (hasPhys || hasMagi) {
                            out[key] = value;
                        }
                    }
                    continue;

                case 'personality':
                    if (isPlainObject(value) &&
                        !isEmptyStringObject(value)) {
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
