/**
 * modules/characters/character-moves.js - Character Special Moves
 * Record store for a character's physical and magical special moves.
 *
 * Path: js/modules/characters/character-moves.js
 *
 * WHY THIS MODULE EXISTS (S10.2):
 *   Special moves were originally part of character-stats.js, mixed in
 *   with stat calculation, HP/MP rolling, physical/magical class
 *   derivation, and magic proficiency handling. But a special move is
 *   not a stat computation. It is a named record with an id, a name,
 *   and a description, stored on the character. Its lifecycle is
 *   add / update / remove / read, exactly like any other record store.
 *
 *   S10.2 extracted the record store. The stat engine that used to
 *   also own it (character-stats.js) no longer does. Callers that want
 *   to mutate special moves call CharacterMoves. Callers that want to
 *   read them for display call CharacterMoves.getSpecialMoves, or read
 *   char.specialMoves directly (the record shape is not opaque).
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
 *   - Move-specific bounds: MAX_SPECIAL_MOVES, MAX_MOVE_NAME_LENGTH,
 *     MAX_MOVE_DESCRIPTION_LENGTH
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
 * MUTATION CONTRACT:
 *   All three mutations:
 *     - route through MutationPipeline
 *     - accept charId, not a live character object
 *     - return Promise<{ success, data?, message? }>
 *     - pre-flight validate against CharacterQueries
 *     - re-validate inside the pipeline against the appData snapshot
 *     - throw on missing structure (corrupt specialMoves data)
 *
 * VALIDATION LAYERS:
 *   1. Argument validation (charId, type, name)
 *   2. Structure validation against the pre-flight character record
 *   3. Re-validation against the snapshot inside the pipeline
 *   Each layer rejects with a distinct message so callers and the
 *   console can tell them apart.
 *
 * DEPENDENCIES:
 *   - window.CharacterConstants (from character-constants.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.MutationPipeline (from mutation-pipeline.js) - MANDATORY
 *   - window.IdUtils (from id-utils.js) - MANDATORY
 *
 * USAGE:
 *   var CM = window.CharacterMoves;
 *
 *   CM.getSpecialMoves(char);              // { physical: [...], magical: [...] }
 *
 *   CM.addSpecialMove('char_123', 'physical', 'Flurry Strike', 'Three rapid blows')
 *       .then(function(result) { ... });
 *
 *   CM.updateSpecialMove('char_123', 'physical', 'move_abc', 'New Name', 'New desc')
 *       .then(function(result) { ... });
 *
 *   CM.removeSpecialMove('char_123', 'physical', 'move_abc')
 *       .then(function(result) { ... });
 */

(function() {
    'use strict';

    if (window.__characterMovesLoaded) {
        return;
    }
    window.__characterMovesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var CharacterConstants = window.CharacterConstants;
    var CharacterQueries = window.CharacterQueries;
    var MutationPipeline = window.MutationPipeline;
    var IdUtils = window.IdUtils;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MAX_SPECIAL_MOVES = (CharacterConstants && CharacterConstants.MAX_SPECIAL_MOVES) || 20;
    var MAX_MOVE_NAME_LENGTH = (CharacterConstants && CharacterConstants.MAX_MOVE_NAME_LENGTH) || 100;
    var MAX_MOVE_DESCRIPTION_LENGTH = (CharacterConstants && CharacterConstants.MAX_MOVE_DESCRIPTION_LENGTH) || 500;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!CharacterConstants) {
            missing.push('CharacterConstants');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (!MutationPipeline || typeof MutationPipeline.performMutation !== 'function') {
            missing.push('MutationPipeline.performMutation');
        }

        if (!IdUtils || typeof IdUtils.generateId !== 'function') {
            missing.push('IdUtils.generateId');
        }

        if (missing.length > 0) {
            console.warn('[CharacterMoves] Missing dependencies:', missing.join(', '));
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
     * A character is expected to have:
     *   char.specialMoves = { physical: [], magical: [] }
     *
     * Any deviation is reported as an error. The mutation layer
     * rejects rather than repairing, because repairing silently would
     * mask the caller that created the malformed shape.
     *
     * @param {object} char
     * @returns {object} { valid: boolean, errors: string[] }
     */
    function validateSpecialMovesStructure(char) {
        var errors = [];

        if (!char) {
            errors.push('Character is required.');
            return { valid: false, errors: errors };
        }

        if (!char.specialMoves || typeof char.specialMoves !== 'object' || Array.isArray(char.specialMoves)) {
            errors.push('Special moves data is missing or malformed.');
            return { valid: false, errors: errors };
        }

        if (!Array.isArray(char.specialMoves.physical)) {
            errors.push('Physical moves must be an array.');
        }
        if (!Array.isArray(char.specialMoves.magical)) {
            errors.push('Magical moves must be an array.');
        }

        return { valid: errors.length === 0, errors: errors };
    }

    // ============================================================
    // READ ACCESS
    // ============================================================

    /**
     * Get a normalised copy of the character's special moves.
     *
     * Always returns { physical: [], magical: [] } with string fields
     * coerced to strings. Missing fields become ''. This is a pure
     * read; the character object is not modified.
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

        var physical = Array.isArray(char.specialMoves.physical)
            ? char.specialMoves.physical.map(function(move) {
                return {
                    id: move && move.id ? move.id : '',
                    name: move && typeof move.name === 'string' ? move.name : '',
                    description: move && typeof move.description === 'string' ? move.description : ''
                };
            })
            : [];

        var magical = Array.isArray(char.specialMoves.magical)
            ? char.specialMoves.magical.map(function(move) {
                return {
                    id: move && move.id ? move.id : '',
                    name: move && typeof move.name === 'string' ? move.name : '',
                    description: move && typeof move.description === 'string' ? move.description : ''
                };
            })
            : [];

        return { physical: physical, magical: magical };
    }

    // ============================================================
    // MUTATIONS
    // ============================================================

    /**
     * Add a special move to a character.
     *
     * @param {string} charId
     * @param {string} type - 'physical' | 'magical'
     * @param {string} name
     * @param {string} [description]
     * @returns {Promise<{success, data?, message?}>}
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
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return Promise.resolve({
                success: false,
                message: 'Move name is required.'
            });
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var structureValidation = validateSpecialMovesStructure(char);
        if (!structureValidation.valid) {
            return Promise.resolve({
                success: false,
                message: 'Special moves data is corrupted: ' + structureValidation.errors.join(', ')
            });
        }

        var moves = char.specialMoves[type] || [];
        if (moves.length >= MAX_SPECIAL_MOVES) {
            return Promise.resolve({
                success: false,
                message: 'Maximum of ' + MAX_SPECIAL_MOVES + ' ' + type + ' moves reached.'
            });
        }

        var nameTruncated = name.trim().slice(0, MAX_MOVE_NAME_LENGTH);
        var descTruncated = typeof description === 'string'
            ? description.trim().slice(0, MAX_MOVE_DESCRIPTION_LENGTH)
            : '';

        var displayName = CharacterQueries.getDisplayName(char);

        return MutationPipeline.performMutation({
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
                        message: 'Special moves data is corrupted.'
                    };
                }
                var currentMoves = current.specialMoves[type] || [];
                if (currentMoves.length >= MAX_SPECIAL_MOVES) {
                    return {
                        valid: false,
                        message: 'Maximum moves reached.'
                    };
                }
                return { valid: true };
            },
            mutate: function(data) {
                var currentChar = data.characters.find(function(c) {
                    return c && String(c.id) === String(charId);
                });
                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }

                if (!currentChar.specialMoves || typeof currentChar.specialMoves !== 'object') {
                    currentChar.specialMoves = { physical: [], magical: [] };
                }
                if (!Array.isArray(currentChar.specialMoves[type])) {
                    currentChar.specialMoves[type] = [];
                }

                var move = {
                    id: IdUtils.generateId('move'),
                    name: nameTruncated,
                    description: descTruncated
                };

                currentChar.specialMoves[type].push(move);
                return { move: move, type: type, characterId: charId };
            },
            logMessage: function() {
                return 'Added ' + type + ' move "' + nameTruncated + '" to ' + displayName;
            },
            successMessage: function() {
                return type.charAt(0).toUpperCase() + type.slice(1) + ' move added!';
            },
            failureMessage: 'Failed to add move.'
        });
    }

    /**
     * Update an existing special move's name and description.
     *
     * The move's id is not touched. Only name and description are
     * replaced. Type and moveId together address the record.
     *
     * @param {string} charId
     * @param {string} type - 'physical' | 'magical'
     * @param {string} moveId
     * @param {string} name
     * @param {string} [description]
     * @returns {Promise<{success, data?, message?}>}
     */
    function updateSpecialMove(charId, type, moveId, name, description) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded.'
            });
        }
        if (!charId || !moveId) {
            return Promise.resolve({
                success: false,
                message: 'Character ID and move ID are required.'
            });
        }
        if (type !== 'physical' && type !== 'magical') {
            return Promise.resolve({
                success: false,
                message: 'Invalid move type.'
            });
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var newName = name !== undefined && name !== null ? String(name).trim() : '';
        if (!newName) {
            return Promise.resolve({
                success: false,
                message: 'Move name is required.'
            });
        }
        var newDesc = description !== undefined ? String(description).trim() : '';

        var displayName = CharacterQueries.getDisplayName(char);

        return MutationPipeline.performMutation({
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
                        message: 'Special moves data is corrupted.'
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
                var currentChar = data.characters.find(function(c) {
                    return c && String(c.id) === String(charId);
                });
                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }
                var moves = currentChar.specialMoves[type] || [];
                var found = false;
                for (var i = 0; i < moves.length; i++) {
                    if (moves[i] && String(moves[i].id) === String(moveId)) {
                        moves[i].name = newName.slice(0, MAX_MOVE_NAME_LENGTH);
                        moves[i].description = newDesc.slice(0, MAX_MOVE_DESCRIPTION_LENGTH);
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    throw new Error('Move not found.');
                }
                return { moveId: moveId, type: type, characterId: charId };
            },
            logMessage: function() {
                return 'Updated ' + type + ' move on ' + displayName;
            },
            successMessage: function() {
                return type.charAt(0).toUpperCase() + type.slice(1) + ' move updated!';
            },
            failureMessage: 'Failed to update move.'
        });
    }

    /**
     * Remove a special move from a character.
     *
     * @param {string} charId
     * @param {string} type - 'physical' | 'magical'
     * @param {string} moveId
     * @returns {Promise<{success, data?, message?}>}
     */
    function removeSpecialMove(charId, type, moveId) {
        if (!checkDependencies()) {
            return Promise.resolve({
                success: false,
                message: 'Dependencies not loaded.'
            });
        }
        if (!charId || !moveId) {
            return Promise.resolve({
                success: false,
                message: 'Character ID and move ID are required.'
            });
        }
        if (type !== 'physical' && type !== 'magical') {
            return Promise.resolve({
                success: false,
                message: 'Invalid move type.'
            });
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve({
                success: false,
                message: 'Character not found.'
            });
        }

        var displayName = CharacterQueries.getDisplayName(char);

        return MutationPipeline.performMutation({
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
                        message: 'Special moves data is corrupted.'
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
                var currentChar = data.characters.find(function(c) {
                    return c && String(c.id) === String(charId);
                });
                if (!currentChar) {
                    throw new Error('Character not found in data store.');
                }
                var found = false;
                var removed = null;
                currentChar.specialMoves[type] = (currentChar.specialMoves[type] || []).filter(function(m) {
                    if (m && String(m.id) === String(moveId)) {
                        found = true;
                        removed = m;
                        return false;
                    }
                    return true;
                });
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
                return 'Removed ' + type + ' move "' + (result.moveName || '') + '" from ' + displayName;
            },
            successMessage: function() {
                return type.charAt(0).toUpperCase() + type.slice(1) + ' move removed.';
            },
            failureMessage: 'Failed to remove move.'
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterMoves = {
        // Reads
        getSpecialMoves: getSpecialMoves,

        // Mutations
        addSpecialMove: addSpecialMove,
        updateSpecialMove: updateSpecialMove,
        removeSpecialMove: removeSpecialMove,

        // Structure validation (exposed for tests and callers that
        // want to check shape without going through a mutation)
        validateSpecialMovesStructure: validateSpecialMovesStructure,

        // Constants (read-only)
        MAX_SPECIAL_MOVES: MAX_SPECIAL_MOVES,
        MAX_MOVE_NAME_LENGTH: MAX_MOVE_NAME_LENGTH,
        MAX_MOVE_DESCRIPTION_LENGTH: MAX_MOVE_DESCRIPTION_LENGTH
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.CharacterMoves;
        var missing = [];

        var required = [
            'getSpecialMoves',
            'addSpecialMove',
            'updateSpecialMove',
            'removeSpecialMove',
            'validateSpecialMovesStructure'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[CharacterMoves] Verification - some exports may be missing:',
                missing.join(', ')
            );
        }
    })();

})();
