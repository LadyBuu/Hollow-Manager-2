/**
 * modules/characters/character-moves.js - Character Special Moves
 * Record store for a character's physical and magical special moves.
 *
 * Path: js/modules/characters/character-moves.js
 *
 * WHY THIS MODULE EXISTS (S10.2):
 *   Special moves were originally part of character-stats.js. But a
 *   special move is not a stat computation. It is a named record
 *   with an id, a name, and a description, stored on the character.
 *   Its lifecycle is add / update / remove / read.
 *
 *   S10.2 extracted the record store. The stat engine that used to
 *   also own it (character-stats.js) no longer does.
 *
 * WHAT THIS MODULE OWNS:
 *   - The specialMoves record shape on a character:
 *       character.specialMoves = {
 *         physical: [ { id, name, description }, ... ],
 *         magical:  [ { id, name, description }, ... ]
 *       }
 *   - Structure validation (validateSpecialMovesStructure)
 *   - Read access (getSpecialMoves)
 *   - Mutations (addSpecialMove, updateSpecialMove, removeSpecialMove)
 *   - Move-specific bounds, read from CharacterConstants lazily.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Stat calculation, HP/MP rolling, physical/magical class
 *     derivation, magic proficiency handling. Those remain in
 *     character-stats.js.
 *   - Rendering. character-stats-view.js renders the moves list and
 *     reads char.specialMoves directly. It does not call this module.
 *   - The character record itself. CharacterQueries owns the reads;
 *     the mutations here route through MutationPipeline to write.
 *
 * LOAD ORDER:
 *   This module loads cleanly regardless of script order. All
 *   dependencies, including CharacterConstants, are resolved at
 *   call time. The verification block does not throw.
 *
 * STRUCTURE POLICY:
 *   - A MISSING specialMoves object (undefined, or the field is not
 *     present at all) is treated as EMPTY. The mutation creates
 *     { physical: [], magical: [] } on the snapshot before
 *     applying. This matches what normaliseDataStructure does on
 *     the next save, so a record that was saved before this module
 *     ever saw it can still receive its first move.
 *
 *   - A WRONG-TYPE specialMoves value (string, number, array, null)
 *     is REJECTED. Silent repair of a wrong type would mask the
 *     caller that produced it.
 *
 *   - A correct-shape specialMoves with a wrong-type member array
 *     (physical is not an array, magical is not an array) is
 *     REJECTED for the same reason.
 *
 * MUTATION CONTRACT:
 *   All three mutations:
 *     - route through MutationPipeline (via the lazy getter,
 *       aliased to a local var)
 *     - accept charId, not a live character object
 *     - return Promise<{ success, data?, message? }>
 *     - pre-flight validate against CharacterQueries
 *     - re-validate inside the pipeline against the appData snapshot
 *     - throw on a wrong-type structure (not on a missing one)
 *
 * TRUNCATION:
 *   Names and descriptions longer than the constants allow are
 *   truncated. The mutation result carries `nameTruncated` and
 *   `descriptionTruncated` flags, and the success message appends
 *   a note when either is set. A caller that wants to warn the user
 *   can inspect the flags.
 *
 * DESCRIPTION HANDLING:
 *   A non-string description is coerced to ''. This is the rule in
 *   both addSpecialMove and updateSpecialMove, so a caller passing
 *   null, a number, or an object gets an empty description
 *   consistently, rather than the old behaviour where `0` became
 *   the string `'0'` and an object became `'[object Object]'`.
 *
 * LEGACY ID-LESS MOVES:
 *   A move without an id can appear in data imported before the
 *   id field was added. getSpecialMoves returns it with id: ''.
 *   updateSpecialMove and removeSpecialMove reject an empty moveId
 *   with a specific message so the caller knows why.
 *
 * TWO WRITERS:
 *   The form's Save writes the whole specialMoves block from the
 *   DOM (character-form.js collectMovesFromDOM). If the DOM is
 *   stale (a name edit that did not re-render the moves section),
 *   a subsequent Save can clobber a move added through this
 *   module. character-events.js re-renders the moves section after
 *   each add or remove, so the practical window is narrow. The
 *   clean fix is for CharacterCRUD.save to merge specialMoves by
 *   id; that change belongs in character-crud.js.
 *
 * DEPENDENCIES (LAZY):
 *   - window.CharacterConstants
 *   - window.CharacterQueries
 *   - window.MutationPipeline
 *   - window.IdUtils
 */

(function() {
    'use strict';

    if (window.__characterMovesLoaded) {
        return;
    }
    window.__characterMovesLoaded = true;

    // ============================================================
    // DEPENDENCY ACCESS - LAZY
    // ============================================================

    function getCharacterConstants() { return window.CharacterConstants || null; }
    function getCharacterQueries() { return window.CharacterQueries || null; }
    function getMutationPipeline() { return window.MutationPipeline || null; }
    function getIdUtils() { return window.IdUtils || null; }

    // ---- Bounds accessors ----
    // CharacterConstants is read on every call, not captured at
    // load. A caller that changes the constants module mid-session
    // (rare, but the load-order fix makes it possible) sees the new
    // values.

    function getMaxSpecialMoves() {
        var CC = getCharacterConstants();
        if (CC && typeof CC.MAX_SPECIAL_MOVES === 'number') {
            return CC.MAX_SPECIAL_MOVES;
        }
        return 20;
    }

    function getMaxMoveNameLength() {
        var CC = getCharacterConstants();
        if (CC && typeof CC.MAX_MOVE_NAME_LENGTH === 'number') {
            return CC.MAX_MOVE_NAME_LENGTH;
        }
        return 100;
    }

    function getMaxMoveDescriptionLength() {
        var CC = getCharacterConstants();
        if (CC && typeof CC.MAX_MOVE_DESCRIPTION_LENGTH === 'number') {
            return CC.MAX_MOVE_DESCRIPTION_LENGTH;
        }
        return 500;
    }

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        var CQ = getCharacterQueries();
        if (!CQ || typeof CQ.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CQ || typeof CQ.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        var MP = getMutationPipeline();
        if (!MP || typeof MP.performMutation !== 'function') {
            missing.push('MutationPipeline.performMutation');
        }

        var IU = getIdUtils();
        if (!IU || typeof IU.generateId !== 'function') {
            missing.push('IdUtils.generateId');
        }

        if (missing.length > 0) {
            console.warn(
                '[CharacterMoves] Missing dependencies:',
                missing.join(', ')
            );
            return false;
        }
        return true;
    }

    // ============================================================
    // STRUCTURE HELPERS
    // ============================================================

    /**
     * Validate the shape of char.specialMoves.
     *
     * A MISSING object (undefined, or the field is absent) is valid
     * and empty. A WRONG-TYPE object (string, number, array, null)
     * is rejected. A correct-shape object with a non-array member
     * is rejected.
     *
     * @param {object} char
     * @returns {object} {
     *   valid: boolean,
     *   empty: boolean,       // true when a fresh container will
     *                         // need to be created
     *   errors: string[]
     * }
     */
    function validateSpecialMovesStructure(char) {
        var errors = [];

        if (!char) {
            errors.push('Character is required.');
            return { valid: false, empty: false, errors: errors };
        }

        var sm = char.specialMoves;

        if (sm === undefined || sm === null) {
            // Missing is valid and empty.
            return { valid: true, empty: true, errors: [] };
        }

        if (typeof sm !== 'object' || Array.isArray(sm)) {
            errors.push(
                'Special moves data is the wrong type ' +
                '(expected an object, got ' +
                (Array.isArray(sm) ? 'array' : typeof sm) + ').'
            );
            return { valid: false, empty: false, errors: errors };
        }

        if (!Array.isArray(sm.physical)) {
            errors.push('Physical moves must be an array.');
        }
        if (!Array.isArray(sm.magical)) {
            errors.push('Magical moves must be an array.');
        }

        return {
            valid: errors.length === 0,
            empty: false,
            errors: errors
        };
    }

    /**
     * Ensure the snapshot character has a usable specialMoves
     * container. Only called inside mutate, when pre-flight has
     * already confirmed the shape is either correct or missing.
     */
    function ensureSpecialMovesContainer(char) {
        if (!char.specialMoves ||
            typeof char.specialMoves !== 'object' ||
            Array.isArray(char.specialMoves)) {
            char.specialMoves = { physical: [], magical: [] };
            return;
        }
        if (!Array.isArray(char.specialMoves.physical)) {
            char.specialMoves.physical = [];
        }
        if (!Array.isArray(char.specialMoves.magical)) {
            char.specialMoves.magical = [];
        }
    }

    // ============================================================
    // STRING COERCION
    // ============================================================

    /**
     * Coerce a description to a string. Non-strings (including
     * numbers, booleans, null, undefined, objects) become ''.
     */
    function coerceDescription(value) {
        if (typeof value === 'string') { return value; }
        return '';
    }

    /**
     * Coerce a name to a string. Non-strings become ''.
     */
    function coerceName(value) {
        if (typeof value === 'string') { return value; }
        return '';
    }

    // ============================================================
    // READ ACCESS
    // ============================================================

    /**
     * Get a normalised copy of the character's special moves.
     *
     * Always returns { physical: [], magical: [] } with string
     * fields coerced to strings. Missing fields become ''. This is
     * a pure read; the character object is not modified.
     *
     * Legacy id-less moves are returned with id: ''.
     *
     * @param {object} char
     * @returns {object} { physical: [move], magical: [move] }
     */
    function getSpecialMoves(char) {
        if (!char) {
            return { physical: [], magical: [] };
        }
        if (!char.specialMoves || typeof char.specialMoves !== 'object') {
            return { physical: [], magical: [] };
        }

        function copyList(list) {
            if (!Array.isArray(list)) { return []; }
            return list.map(function(move) {
                return {
                    id: move && move.id ? move.id : '',
                    name: move && typeof move.name === 'string'
                        ? move.name : '',
                    description: move && typeof move.description === 'string'
                        ? move.description : ''
                };
            });
        }

        return {
            physical: copyList(char.specialMoves.physical),
            magical: copyList(char.specialMoves.magical)
        };
    }

    // ============================================================
    // MUTATIONS
    // ============================================================

    /**
     * Add a special move to a character.
     */
    function addSpecialMove(charId, type, name, description) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded.'
            });
        }
        if (!charId) {
            return Promise.resolve({
                success: false,
                message: 'Character ID is required.'
            });
        }
        if (type !== 'physical' && type !== 'magical') {
            return Promise.resolve({
                success: false,
                message: 'Invalid move type.'
            });
        }

        var rawName = coerceName(name).trim();
        if (rawName === '') {
            return Promise.resolve({
                success: false,
                message: 'Move name is required.'
            });
        }

        var CharacterQueries = getCharacterQueries();
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var structure = validateSpecialMovesStructure(char);
        if (!structure.valid) {
            return Promise.resolve({
                success: false,
                message: 'Special moves data is corrupted: ' +
                    structure.errors.join(', ')
            });
        }

        var maxMoves = getMaxSpecialMoves();
        var moves = structure.empty
            ? []
            : (char.specialMoves[type] || []);
        if (moves.length >= maxMoves) {
            return Promise.resolve({
                success: false,
                message: 'Maximum of ' + maxMoves + ' ' + type +
                    ' moves reached.'
            });
        }

        var maxNameLen = getMaxMoveNameLength();
        var maxDescLen = getMaxMoveDescriptionLength();

        var nameTruncated = rawName.length > maxNameLen;
        var nameFinal = nameTruncated
            ? rawName.slice(0, maxNameLen)
            : rawName;

        var descRaw = coerceDescription(description).trim();
        var descriptionTruncated = descRaw.length > maxDescLen;
        var descFinal = descriptionTruncated
            ? descRaw.slice(0, maxDescLen)
            : descRaw;

        var displayName = CharacterQueries.getDisplayName(char);

        // ---- Alias MutationPipeline locally ----
        var MP = getMutationPipeline();

        return MP.performMutation({
            validate: function() {
                var current = CharacterQueries.getCharacterById(charId);
                if (!current) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }
                var v = validateSpecialMovesStructure(current);
                if (!v.valid) {
                    return {
                        valid: false,
                        message: 'Special moves data is corrupted ' +
                            'in pre-flight: ' +
                            v.errors.join(', ')
                    };
                }
                var currentMoves = v.empty
                    ? []
                    : (current.specialMoves[type] || []);
                if (currentMoves.length >= maxMoves) {
                    return {
                        valid: false,
                        message: 'Maximum moves reached.'
                    };
                }
                return { valid: true };
            },

            mutate: function(data) {
                if (!Array.isArray(data.characters)) {
                    throw new Error('Character store is malformed.');
                }

                var currentChar = null;
                for (var i = 0; i < data.characters.length; i++) {
                    var c = data.characters[i];
                    if (c && String(c.id) === String(charId)) {
                        currentChar = c;
                        break;
                    }
                }
                if (!currentChar) {
                    throw new Error(
                        'Character not found in data store.'
                    );
                }

                var snapshotValidation =
                    validateSpecialMovesStructure(currentChar);
                if (!snapshotValidation.valid) {
                    throw new Error(
                        'Special moves data is corrupted in the ' +
                        'snapshot: ' +
                        snapshotValidation.errors.join(', ')
                    );
                }

                ensureSpecialMovesContainer(currentChar);

                var IU = getIdUtils();

                var move = {
                    id: IU.generateId('move'),
                    name: nameFinal,
                    description: descFinal
                };

                currentChar.specialMoves[type].push(move);

                return {
                    move: move,
                    type: type,
                    characterId: charId,
                    nameTruncated: nameTruncated,
                    descriptionTruncated: descriptionTruncated
                };
            },

            logMessage: function() {
                return 'Added ' + type + ' move "' + nameFinal +
                    '" to ' + displayName;
            },

            successMessage: function(result) {
                var base = type.charAt(0).toUpperCase() +
                    type.slice(1) + ' move added!';
                if (result && (result.nameTruncated ||
                    result.descriptionTruncated)) {
                    base += ' (truncated to fit length limits)';
                }
                return base;
            },

            failureMessage: 'Failed to add move.'
        });
    }

    /**
     * Update an existing special move's name and description.
     */
    function updateSpecialMove(charId, type, moveId, name, description) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded.'
            });
        }
        if (!charId) {
            return Promise.resolve({
                success: false,
                message: 'Character ID is required.'
            });
        }
        if (!moveId) {
            return Promise.resolve({
                success: false,
                message: 'Move ID is required.'
            });
        }
        if (type !== 'physical' && type !== 'magical') {
            return Promise.resolve({
                success: false,
                message: 'Invalid move type.'
            });
        }

        var CharacterQueries = getCharacterQueries();
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var rawName = coerceName(name).trim();
        if (rawName === '') {
            return Promise.resolve({
                success: false,
                message: 'Move name is required.'
            });
        }

        var maxNameLen = getMaxMoveNameLength();
        var maxDescLen = getMaxMoveDescriptionLength();

        var nameTruncated = rawName.length > maxNameLen;
        var nameFinal = nameTruncated
            ? rawName.slice(0, maxNameLen)
            : rawName;

        var descRaw = coerceDescription(description).trim();
        var descriptionTruncated = descRaw.length > maxDescLen;
        var descFinal = descriptionTruncated
            ? descRaw.slice(0, maxDescLen)
            : descRaw;

        var displayName = CharacterQueries.getDisplayName(char);

        var MP = getMutationPipeline();

        return MP.performMutation({
            validate: function() {
                var current = CharacterQueries.getCharacterById(charId);
                if (!current) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }
                var v = validateSpecialMovesStructure(current);
                if (!v.valid) {
                    return {
                        valid: false,
                        message: 'Special moves data is corrupted ' +
                            'in pre-flight: ' +
                            v.errors.join(', ')
                    };
                }
                if (v.empty) {
                    return {
                        valid: false,
                        message: 'Move not found.'
                    };
                }
                var moves = current.specialMoves[type] || [];
                var found = moves.some(function(m) {
                    return m && String(m.id) === String(moveId);
                });
                if (!found) {
                    return {
                        valid: false,
                        message: 'Move not found.'
                    };
                }
                return { valid: true };
            },

            mutate: function(data) {
                if (!Array.isArray(data.characters)) {
                    throw new Error('Character store is malformed.');
                }

                var currentChar = null;
                for (var i = 0; i < data.characters.length; i++) {
                    var c = data.characters[i];
                    if (c && String(c.id) === String(charId)) {
                        currentChar = c;
                        break;
                    }
                }
                if (!currentChar) {
                    throw new Error(
                        'Character not found in data store.'
                    );
                }

                var snapshotValidation =
                    validateSpecialMovesStructure(currentChar);
                if (!snapshotValidation.valid) {
                    throw new Error(
                        'Special moves data is corrupted in the ' +
                        'snapshot: ' +
                        snapshotValidation.errors.join(', ')
                    );
                }

                ensureSpecialMovesContainer(currentChar);

                var moves = currentChar.specialMoves[type];
                var found = false;
                for (var j = 0; j < moves.length; j++) {
                    if (moves[j] &&
                        String(moves[j].id) === String(moveId)) {
                        moves[j].name = nameFinal;
                        moves[j].description = descFinal;
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    throw new Error('Move not found.');
                }

                return {
                    moveId: moveId,
                    type: type,
                    characterId: charId,
                    nameTruncated: nameTruncated,
                    descriptionTruncated: descriptionTruncated
                };
            },

            logMessage: function() {
                return 'Updated ' + type + ' move on ' + displayName;
            },

            successMessage: function(result) {
                var base = type.charAt(0).toUpperCase() +
                    type.slice(1) + ' move updated!';
                if (result && (result.nameTruncated ||
                    result.descriptionTruncated)) {
                    base += ' (truncated to fit length limits)';
                }
                return base;
            },

            failureMessage: 'Failed to update move.'
        });
    }

    /**
     * Remove a special move from a character.
     */
    function removeSpecialMove(charId, type, moveId) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded.'
            });
        }
        if (!charId) {
            return Promise.resolve({
                success: false,
                message: 'Character ID is required.'
            });
        }
        if (moveId === undefined || moveId === null ||
            String(moveId).trim() === '') {
            return Promise.resolve({
                success: false,
                message: 'Move has no id; cannot be removed. This ' +
                    'move predates the id field.'
            });
        }
        if (type !== 'physical' && type !== 'magical') {
            return Promise.resolve({
                success: false,
                message: 'Invalid move type.'
            });
        }

        var CharacterQueries = getCharacterQueries();
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var displayName = CharacterQueries.getDisplayName(char);

        var MP = getMutationPipeline();

        return MP.performMutation({
            validate: function() {
                var current = CharacterQueries.getCharacterById(charId);
                if (!current) {
                    return {
                        valid: false,
                        message: 'Character no longer exists.'
                    };
                }
                var v = validateSpecialMovesStructure(current);
                if (!v.valid) {
                    return {
                        valid: false,
                        message: 'Special moves data is corrupted ' +
                            'in pre-flight: ' +
                            v.errors.join(', ')
                    };
                }
                if (v.empty) {
                    return {
                        valid: false,
                        message: 'Move not found.'
                    };
                }
                var moves = current.specialMoves[type] || [];
                var found = moves.some(function(m) {
                    return m && String(m.id) === String(moveId);
                });
                if (!found) {
                    return {
                        valid: false,
                        message: 'Move not found.'
                    };
                }
                return { valid: true };
            },

            mutate: function(data) {
                if (!Array.isArray(data.characters)) {
                    throw new Error('Character store is malformed.');
                }

                var currentChar = null;
                for (var i = 0; i < data.characters.length; i++) {
                    var c = data.characters[i];
                    if (c && String(c.id) === String(charId)) {
                        currentChar = c;
                        break;
                    }
                }
                if (!currentChar) {
                    throw new Error(
                        'Character not found in data store.'
                    );
                }

                var snapshotValidation =
                    validateSpecialMovesStructure(currentChar);
                if (!snapshotValidation.valid) {
                    throw new Error(
                        'Special moves data is corrupted in the ' +
                        'snapshot: ' +
                        snapshotValidation.errors.join(', ')
                    );
                }

                ensureSpecialMovesContainer(currentChar);

                var found = false;
                var removed = null;

                currentChar.specialMoves[type] =
                    currentChar.specialMoves[type].filter(
                        function(m) {
                            if (m &&
                                String(m.id) === String(moveId)) {
                                found = true;
                                removed = m;
                                return false;
                            }
                            return true;
                        }
                    );

                if (!found) {
                    throw new Error('Move not found.');
                }

                return {
                    moveId: moveId,
                    type: type,
                    characterId: charId,
                    moveName: removed ? removed.name : ''
                };
            },

            logMessage: function(result) {
                return 'Removed ' + type + ' move "' +
                    (result.moveName || '') + '" from ' + displayName;
            },

            successMessage: function() {
                return type.charAt(0).toUpperCase() +
                    type.slice(1) + ' move removed.';
            },

            failureMessage: 'Failed to remove move.'
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterMoves = Object.freeze({
        // Reads
        getSpecialMoves: getSpecialMoves,

        // Mutations
        addSpecialMove: addSpecialMove,
        updateSpecialMove: updateSpecialMove,
        removeSpecialMove: removeSpecialMove,

        // Structure validation (exposed for tests and callers that
        // want to check shape without going through a mutation)
        validateSpecialMovesStructure: validateSpecialMovesStructure,

        // Bounds accessors (lazily resolved from CharacterConstants)
        getMaxSpecialMoves: getMaxSpecialMoves,
        getMaxMoveNameLength: getMaxMoveNameLength,
        getMaxMoveDescriptionLength: getMaxMoveDescriptionLength
    });

    // ============================================================
    // VERIFICATION
    // ============================================================
    //
    // A failed smoke test logs an error but does not throw. The
    // module's public functions are already exported above; a
    // partially broken export is no worse than a full abort, and
    // aborting here would prevent a reload of the script from
    // retrying.

    (function verify() {
        var failures = [];

        try {
            var exports = window.CharacterMoves;

            var required = [
                'getSpecialMoves',
                'addSpecialMove',
                'updateSpecialMove',
                'removeSpecialMove',
                'validateSpecialMovesStructure'
            ];

            for (var i = 0; i < required.length; i++) {
                if (typeof exports[required[i]] !== 'function') {
                    failures.push('missing export: ' + required[i]);
                }
            }

            var empty = exports.getSpecialMoves(null);
            if (!empty ||
                !Array.isArray(empty.physical) ||
                !Array.isArray(empty.magical)) {
                failures.push(
                    'getSpecialMoves(null) did not return empty shape'
                );
            }

            // Missing is valid and empty.
            var missing = exports.validateSpecialMovesStructure({});
            if (!missing || missing.valid !== true ||
                missing.empty !== true) {
                failures.push(
                    'validateSpecialMovesStructure({}) should be ' +
                    'valid and empty'
                );
            }

            // Correct shape is valid and not empty.
            var correct = exports.validateSpecialMovesStructure({
                specialMoves: { physical: [], magical: [] }
            });
            if (!correct || correct.valid !== true ||
                correct.empty !== false) {
                failures.push(
                    'validateSpecialMovesStructure(correct) should ' +
                    'be valid and not empty'
                );
            }

            // Wrong type is invalid.
            var wrongType = exports.validateSpecialMovesStructure({
                specialMoves: 'not an object'
            });
            if (!wrongType || wrongType.valid !== false) {
                failures.push(
                    'validateSpecialMovesStructure(wrong type) ' +
                    'should be invalid'
                );
            }

            var wrongArray = exports.validateSpecialMovesStructure({
                specialMoves: []
            });
            if (!wrongArray || wrongArray.valid !== false) {
                failures.push(
                    'validateSpecialMovesStructure(array) should be ' +
                    'invalid'
                );
            }

            var wrongMember = exports.validateSpecialMovesStructure({
                specialMoves: { physical: 'not an array', magical: [] }
            });
            if (!wrongMember || wrongMember.valid !== false) {
                failures.push(
                    'validateSpecialMovesStructure(wrong member ' +
                    'type) should be invalid'
                );
            }
        } catch (e) {
            failures.push('smoke test threw: ' + e.message);
        }

        if (failures.length > 0) {
            if (typeof console !== 'undefined' && console.error) {
                console.error(
                    '[CharacterMoves] Verification failed: ' +
                    failures.join('; ')
                );
            }
        }
    })();

})();
