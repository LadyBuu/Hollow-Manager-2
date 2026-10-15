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
 *                                     every eliminated character
 *                                     without authored content has
 *                                     been reduced via
 *                                     stripEmptyFields and flagged
 *                                     as filler.
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
 *   stripped record had none. The strip therefore keeps empty
 *   CONTAINERS in place, so the round trip is stable. Scalar zeros
 *   are stripped; if normalise re-adds them, they come back as
 *   zeros.
 *
 * NESTED STRIP:
 *   Containers are stripped one level deeper. personality loses
 *   empty fields, careerStatus entries lose empty titles, weapons
 *   entries lose empty notes, specialMoves entries lose empty
 *   descriptions. The container itself is preserved.
 *
 * EXPLICIT ZEROS:
 *   A zero-value deathAge or deathWeek is a value, not a missing
 *   value. Both numeric 0 and string "0" are kept.
 *
 * MALFORMED VALUES:
 *   A value that is present but has the wrong shape (for example a
 *   careerStatus that is not an array) is preserved with a
 *   console.warn naming the field. It is not silently dropped. This
 *   matches the "no silent repair" policy in character-moves.js.
 *
 * UPDATED AT:
 *   The strip refreshes updatedAt only when it actually removed
 *   something. A no-op strip leaves the timestamp unchanged, so the
 *   strip is idempotent on an already-stripped record.
 *
 * EXPORT-TIME STRIP:
 *   stripEliminatedForExport flags an eliminated character as
 *   filler only when the character has no authored content. A
 *   character with a full bio, personality or moves stays
 *   unflagged even if eliminated, so it does not disappear behind
 *   the default Hide Filler filter on re-import.
 *
 * DISPLAY PARTS:
 *   displayParts is preserved when middleName is non-empty. The
 *   legacy firstlast display name omits the middle name; the
 *   default displayParts includes it. Stripping displayParts from
 *   a character with a middle name would change the displayed name
 *   after export and re-import.
 *
 * DEPENDENCIES (LAZY):
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

    // Fields that survive the strip unconditionally.
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

    // Arrays that are kept only if non-empty.
    var KEEP_NONEMPTY_ARRAY = {
        careerStatus: true,
        eliminations: true,
        eliminatedWeeks: true,
        previousNames: true
    };

    // Containers that are kept even when empty, so the round trip
    // through normaliseDataStructure is a no-op. Each entry names
    // the empty shape to preserve.
    var KEEP_EMPTY_CONTAINER = {
        personality:      { kind: 'object', empty: function() { return {}; } },
        specialMoves:     { kind: 'specialMoves', empty: function() {
                                return { physical: [], magical: [] };
                            } },
        weapons:          { kind: 'array', empty: function() { return []; } },
        classIds:         { kind: 'array', empty: function() { return []; } }
    };

    // Scalar and string fields that are dropped when empty.
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

    function warnMalformed(fieldName, charId) {
        if (typeof console === 'undefined' || !console.warn) { return; }
        console.warn(
            '[CharacterStrip] Preserved malformed field "' +
            fieldName + '"' +
            (charId ? ' on character ' + charId : '') +
            '. The strip does not repair shape errors.'
        );
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
    // NESTED STRIP HELPERS
    // ============================================================

    function stripPersonality(personality) {
        if (!isPlainObject(personality)) { return personality; }
        var out = {};
        var keys = Object.keys(personality);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var v = personality[key];
            if (typeof v === 'string' && v.trim() === '') { continue; }
            if (typeof v === 'number' && v === 0) { continue; }
            if (Array.isArray(v) && v.length === 0) { continue; }
            if (isPlainObject(v) && Object.keys(v).length === 0) {
                continue;
            }
            if (v === null || v === undefined) { continue; }
            out[key] = v;
        }
        return out;
    }

    function stripCareerEntry(entry) {
        if (!isPlainObject(entry)) { return entry; }
        var out = {};
        var keys = Object.keys(entry);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var v = entry[key];
            if (key === 'title' &&
                typeof v === 'string' && v.trim() === '') {
                continue;
            }
            if (v === null || v === undefined) { continue; }
            out[key] = v;
        }
        return out;
    }

    function stripWeaponEntry(weapon) {
        if (!isPlainObject(weapon)) { return weapon; }
        var out = {};
        var keys = Object.keys(weapon);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var v = weapon[key];
            if (key === 'notes' &&
                typeof v === 'string' && v.trim() === '') {
                continue;
            }
            if (v === null || v === undefined) { continue; }
            out[key] = v;
        }
        return out;
    }

    function stripMoveEntry(move) {
        if (!isPlainObject(move)) { return move; }
        var out = {};
        var keys = Object.keys(move);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var v = move[key];
            if (key === 'description' &&
                typeof v === 'string' && v.trim() === '') {
                continue;
            }
            if (v === null || v === undefined) { continue; }
            out[key] = v;
        }
        return out;
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
                    if (key === 'careerStatus') {
                        out[key] = value.map(stripCareerEntry);
                    } else {
                        out[key] = value;
                    }
                } else if (value !== undefined && !Array.isArray(value)) {
                    // Malformed: preserved with a warning.
                    warnMalformed(key, char.id);
                    out[key] = value;
                }
                continue;
            }

            if (KEEP_EMPTY_CONTAINER[key]) {
                var spec = KEEP_EMPTY_CONTAINER[key];

                if (spec.kind === 'object') {
                    if (isPlainObject(value)) {
                        out[key] = stripPersonality(value);
                    }
                    continue;
                }

                if (spec.kind === 'array') {
                    if (Array.isArray(value)) {
                        if (key === 'weapons') {
                            out[key] = value.map(stripWeaponEntry);
                        } else {
                            // Keep the array as-is. classIds and
                            // similar id arrays are not nested.
                            out[key] = value;
                        }
                    }
                    continue;
                }

                if (spec.kind === 'specialMoves') {
                    if (isPlainObject(value)) {
                        var hasPhys = Array.isArray(value.physical) &&
                            value.physical.length > 0;
                        var hasMagi = Array.isArray(value.magical) &&
                            value.magical.length > 0;

                        if (hasPhys || hasMagi) {
                            out[key] = {
                                physical: Array.isArray(value.physical)
                                    ? value.physical.map(stripMoveEntry)
                                    : [],
                                magical: Array.isArray(value.magical)
                                    ? value.magical.map(stripMoveEntry)
                                    : []
                            };
                        } else {
                            // Present but empty: preserve the
                            // canonical shape so normalise does not
                            // have to reconstruct it.
                            out[key] = { physical: [], magical: [] };
                        }
                    }
                    continue;
                }
                continue;
            }

            if (DROP_EMPTY_STRING[key]) {
                if (typeof value === 'string' && value.trim() !== '') {
                    out[key] = value;
                } else if (typeof value === 'number') {
                    // Explicit zeros (deathAge: 0, deathWeek: 0) are
                    // values, not absent values. Keep them.
                    out[key] = value;
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

                case 'displayParts':
                    if (isPlainObject(value) &&
                        !isDefaultDisplayParts(value)) {
                        out[key] = value;
                    } else if (isPlainObject(value) &&
                               isDefaultDisplayParts(value)) {
                        // Preserve displayParts when the record
                        // has a middle name, so a legacy firstlast
                        // display does not lose it on round trip.
                        var middle = char.middleName;
                        if (typeof middle === 'string' &&
                            middle.trim() !== '') {
                            out[key] = value;
                        }
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

        // ---- Refresh updatedAt only when something was removed. ----
        var originalCount = Object.keys(char).length;
        var strippedCount = Object.keys(out).length;

        if (strippedCount < originalCount &&
            ALWAYS_KEEP.updatedAt &&
            char.updatedAt !== undefined) {
            out.updatedAt = new Date().toISOString();
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

            // Only flag as filler when the character has no
            // authored content. An eliminated character with a
            // full bio must not disappear behind the default
            // Hide Filler filter on re-import.
            var hasContent = hasAuthoredContent(c);

            var reduced = stripEmptyFields(c);
            if (!hasContent) {
                reduced.isFiller = true;
            }
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
