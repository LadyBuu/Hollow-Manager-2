/**
 * js/modules/characters/character-crud.js - Character CRUD Operations
 * Path: js/modules/characters/character-crud.js
 * 
 * This module handles all character CRUD operations with:
 * - Clean persistence boundary (mutates window.data, then saves)
 * - Proper rollback on save failure
 * - Consistent state management via getCurrentEditId/setCurrentEditId
 * - Defensive cloning for backups using MutationUtils
 * - Explicit notification rendering
 * - Returns Promises for composition
 * 
 * PERSISTENCE CONTRACT:
 * - All mutations are applied to window.data in memory
 * - This module owns persistence via saveData()
 * - Rollback restores window.data on failure
 * - UI state is managed via getCurrentEditId/setCurrentEditId
 * - All mutation functions return Promises for async composition
 * - No mutation occurs without a successful backup
 * 
 * MUTATION FLOW:
 *   VALIDATE INPUT → BUILD/NORMALISE → SNAPSHOT (required) → MUTATE → PERSIST
 *                                      ↓
 *                                  failure
 *                                      ↓
 *                                  ROLLBACK
 * 
 *   Then on success:
 *     LOG (failure-safe) → UI COMMIT
 * 
 * STATE SOURCE OF TRUTH:
 *   - getCurrentEditId/setCurrentEditId is the canonical edit state.
 *   - window.data is the source of truth for persisted application data.
 *   - DOM is the temporary source of form input values during save.
 *   - Persisted character data remains in window.data.
 * 
 * IMPORTANT:
 *   - No DOM extraction here - form extraction is in character-form.js
 *   - No UI rendering here - rendering is in character-form.js
 *   - This module only handles CRUD operations and persistence
 *   - USES CharacterQueries for character data and display names
 *   - USES MutationUtils for backup and persistence
 *   - USES NotificationSystem for notifications
 *   - USES ActivityLog for activity logging
 *   - USES CharacterConstants for domain constants
 * 
 * DEPENDENCIES (ALL REQUIRED):
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.MutationUtils (from mutation-utils.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.ActivityLog (from activity-log.js)
 *   - window.CharacterConstants (from character-constants.js) - MANDATORY
 *   - window.getCurrentEditId (from index.js)
 *   - window.setCurrentEditId (from index.js)
 *   - window.saveData (from database.js)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterCrudLoaded) {
        return;
    }
    window.__characterCrudLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var MutationUtils = window.MutationUtils;
    var NotificationSystem = window.NotificationSystem;
    var ActivityLog = window.ActivityLog;
    var CharacterConstants = window.CharacterConstants;

    // ============================================================
    // CONSTANTS - From CharacterConstants (MANDATORY)
    // ============================================================

    var STAT_KEYS = CharacterConstants.STAT_KEYS;
    var STAT_MIN = CharacterConstants.STAT_MIN;
    var STAT_MAX = CharacterConstants.STAT_MAX;
    var STAT_DEFAULT = CharacterConstants.STAT_DEFAULT;
    var MAGIC_MAX = CharacterConstants.MAGIC_MAX;
    var MAGIC_TYPE_KEYS = CharacterConstants.MAGIC_TYPE_KEYS;
    var MAX_SPECIAL_MOVES = CharacterConstants.MAX_SPECIAL_MOVES;
    var MAX_MOVE_NAME_LENGTH = CharacterConstants.MAX_MOVE_NAME_LENGTH;
    var MAX_MOVE_DESCRIPTION_LENGTH = CharacterConstants.MAX_MOVE_DESCRIPTION_LENGTH;

    // Calendar constants
    var MIN_WEEK = window.CALENDAR_CONSTANTS ? window.CALENDAR_CONSTANTS.MIN_WEEK : 1;
    var MAX_WEEK = window.CALENDAR_CONSTANTS ? window.CALENDAR_CONSTANTS.MAX_WEEK : 52;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // CharacterQueries is MANDATORY
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        // MutationUtils is MANDATORY
        if (!MutationUtils || typeof MutationUtils.createSafeBackup !== 'function') {
            missing.push('MutationUtils.createSafeBackup');
        }
        if (!MutationUtils || typeof MutationUtils.saveWithPromise !== 'function') {
            missing.push('MutationUtils.saveWithPromise');
        }

        // NotificationSystem is MANDATORY
        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        // ActivityLog is MANDATORY
        if (!ActivityLog || typeof ActivityLog.record !== 'function') {
            missing.push('ActivityLog.record');
        }

        // CharacterConstants is MANDATORY
        if (!CharacterConstants) {
            missing.push('CharacterConstants');
        }

        // getCurrentEditId is MANDATORY
        if (typeof window.getCurrentEditId !== 'function') {
            missing.push('getCurrentEditId');
        }

        // setCurrentEditId is MANDATORY
        if (typeof window.setCurrentEditId !== 'function') {
            missing.push('setCurrentEditId');
        }

        // saveData is MANDATORY
        if (typeof window.saveData !== 'function') {
            missing.push('saveData');
        }

        if (missing.length > 0) {
            console.warn('CharacterCRUD: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // NOTIFICATION - Uses NotificationSystem (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // SAFE BACKUP - Delegates to MutationUtils
    // ============================================================

    function createSafeBackup(data) {
        return MutationUtils.createSafeBackup(data);
    }

    // ============================================================
    // STATE ACCESS - Single source of truth
    // ============================================================

    function getCurrentEditId() {
        return window.getCurrentEditId();
    }

    function setCurrentEditId(id) {
        window.setCurrentEditId(id);
    }

    // ============================================================
    // SAFE RENDER HELPERS
    // ============================================================

    function safeRenderCharacterList() {
        if (window.CharacterList && typeof window.CharacterList.render === 'function') {
            try { window.CharacterList.render(); } catch (e) { /* Ignore */ }
        }
    }

    function safeShowCharacterForm(id) {
        if (typeof window.showCharacterForm === 'function') {
            try { window.showCharacterForm(id); } catch (e) { /* Ignore */ }
        }
    }

    function safeUpdateDashboardStats() {
        if (typeof window.updateDashboardStats === 'function') {
            try { window.updateDashboardStats(); } catch (e) { /* Ignore */ }
        }
    }

    // ============================================================
    // ROLLBACK - Centralised recovery choreography
    // ============================================================

    function rollback(backup, editId, wasEditing) {
        // Restore data
        window.data = backup;

        // Restore UI state
        safeRenderCharacterList();

        if (wasEditing) {
            setCurrentEditId(editId);
            safeShowCharacterForm(editId);
        } else {
            setCurrentEditId(null);
            safeShowCharacterForm(null);
        }

        // Notify user
        showNotification('Operation failed. Changes have been rolled back.', 'error');
    }

    // ============================================================
    // ID GENERATION
    // ============================================================

    function generateCharacterId() {
        if (window.IdUtils && typeof window.IdUtils.generateId === 'function') {
            return window.IdUtils.generateId('char');
        }
        if (typeof window.generateId === 'function') {
            return window.generateId('char');
        }
        return 'char_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }

    // ============================================================
    // DATA STRUCTURE VALIDATION
    // ============================================================

    function validateDataArray(data, key) {
        if (!data) return false;
        if (!Array.isArray(data[key])) {
            return false;
        }
        return true;
    }

    // ============================================================
    // CHARACTER VALIDATION - Pure domain validation
    // ============================================================

    /**
     * Validate character data.
     * This is a PURE function - no side effects, no state mutation.
     * 
     * @param {object} charData - Character data to validate
     * @returns {object} { valid: boolean, message?: string }
     */
    function validateCharacter(charData) {
        // Basic required fields
        if (!charData.firstName) {
            return { valid: false, message: 'First name is required.' };
        }
        if (!charData.lastName) {
            return { valid: false, message: 'Last name is required.' };
        }

        // Death validation
        if (charData.deceased) {
            var hasDeathInfo = charData.deathYear || charData.deathAge || charData.deathWeek;
            if (!hasDeathInfo) {
                return { valid: false, message: 'Please enter Death Year, Death Age, or Death Week for deceased characters.' };
            }
            if (charData.deathWeek && !validateWeek(charData.deathWeek)) {
                return { valid: false, message: 'Death Week must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.' };
            }
        }

        // Special moves validation - enforce constants
        var physicalMoves = charData.specialMoves && charData.specialMoves.physical ? charData.specialMoves.physical : [];
        var magicalMoves = charData.specialMoves && charData.specialMoves.magical ? charData.specialMoves.magical : [];

        if (physicalMoves.length > MAX_SPECIAL_MOVES) {
            return { valid: false, message: 'Too many physical special moves. Maximum is ' + MAX_SPECIAL_MOVES + '.' };
        }
        if (magicalMoves.length > MAX_SPECIAL_MOVES) {
            return { valid: false, message: 'Too many magical special moves. Maximum is ' + MAX_SPECIAL_MOVES + '.' };
        }

        var allMoves = physicalMoves.concat(magicalMoves);
        for (var i = 0; i < allMoves.length; i++) {
            var move = allMoves[i];
            if (move.name && move.name.length > MAX_MOVE_NAME_LENGTH) {
                return { valid: false, message: 'Move name exceeds maximum length of ' + MAX_MOVE_NAME_LENGTH + ' characters.' };
            }
            if (move.description && move.description.length > MAX_MOVE_DESCRIPTION_LENGTH) {
                return { valid: false, message: 'Move description exceeds maximum length of ' + MAX_MOVE_DESCRIPTION_LENGTH + ' characters.' };
            }
        }

        // Stats validation
        var stats = charData.stats || {};
        for (var statKey in stats) {
            if (Object.prototype.hasOwnProperty.call(stats, statKey)) {
                var val = stats[statKey];
                if (typeof val !== 'number' || isNaN(val) || val < STAT_MIN || val > STAT_MAX) {
                    return { valid: false, message: 'Stat "' + statKey + '" must be between ' + STAT_MIN + ' and ' + STAT_MAX + '.' };
                }
            }
        }

        // Magic validation
        var magic = charData.magic || {};
        for (var magicKey in magic) {
            if (Object.prototype.hasOwnProperty.call(magic, magicKey)) {
                var val = magic[magicKey];
                if (typeof val !== 'number' || isNaN(val) || val < 0 || val > MAGIC_MAX) {
                    return { valid: false, message: 'Magic proficiency must be between 0 and ' + MAGIC_MAX + '.' };
                }
            }
        }

        return { valid: true };
    }

    // ============================================================
    // WEEK VALIDATION
    // ============================================================

    function validateWeek(week) {
        var num = Number(week);
        return Number.isInteger(num) && num >= MIN_WEEK && num <= MAX_WEEK;
    }

    // ============================================================
    // MUTATION HELPERS
    // ============================================================

    function updateExistingCharacter(existing, charData, data) {
        var index = data.characters.findIndex(function(c) {
            return c && String(c.id) === String(existing.id);
        });

        if (index === -1) {
            return { success: false, error: 'Character not found in data store.' };
        }

        var current = data.characters[index];

        // Preserve system-managed fields
        var preserved = {
            id: current.id,
            createdAt: current.createdAt,
            eliminations: Array.isArray(current.eliminations) ? current.eliminations : [],
            eliminatedWeeks: Array.isArray(current.eliminatedWeeks) ? current.eliminatedWeeks : []
        };

        // Merge - charData overrides everything except preserved fields
        data.characters[index] = Object.assign({}, current, charData, preserved);

        return { success: true };
    }

    function createNewCharacter(charData, data) {
        var id = generateCharacterId();

        var newChar = Object.assign({}, charData, {
            id: id,
            eliminations: [],
            eliminatedWeeks: [],
            createdAt: new Date().toISOString()
        });

        data.characters.push(newChar);

        return { success: true, id: id };
    }

    // ============================================================
    // UI COMMIT HELPERS
    // ============================================================

    function commitSaveUI(id, isEditing) {
        // Commit UI state AFTER persistence succeeds
        setCurrentEditId(id);
        safeUpdateDashboardStats();
        safeShowCharacterForm(id);
        showNotification(isEditing ? 'Character saved successfully!' : 'Character created successfully!', 'success');
    }

    function commitDeleteUI() {
        setCurrentEditId(null);
        safeUpdateDashboardStats();
        safeShowCharacterForm(null);
        showNotification('Character deleted successfully!', 'success');
    }

    // ============================================================
    // SAVE CHARACTER - Transactional mutation flow
    // ============================================================

    /**
     * Save a character (create or update).
     * Expects the form data to already be extracted and validated.
     * 
     * @param {object} formData - Form data object
     * @returns {Promise<boolean>} True on success
     */
    function save(formData) {
        if (!checkDependencies()) {
            showNotification('Dependencies not loaded. Please refresh the page.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 1: VALIDATE ----
        if (!formData || typeof formData !== 'object') {
            showNotification('Form data is required.', 'error');
            return Promise.resolve(false);
        }

        // Use the pure validation function - NO MUTATION
        var validation = validateCharacter(formData);
        if (!validation.valid) {
            showNotification(validation.message, 'error');
            return Promise.resolve(false);
        }

        var editId = getCurrentEditId();
        var isEditing = editId !== null && editId !== undefined && editId !== '';
        var existingChar = null;
        var name = formData.firstName + ' ' + formData.lastName;
        var newId = null;

        if (isEditing) {
            existingChar = CharacterQueries.getCharacterById(editId);
            if (!existingChar) {
                showNotification('Character not found.', 'error');
                return Promise.resolve(false);
            }
            name = CharacterQueries.getDisplayName(existingChar);
        }

        var data = window.data || {};

        // Validate data structure - fail closed
        if (!validateDataArray(data, 'characters')) {
            showNotification('Character data is corrupted. Please reload.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 2: SNAPSHOT - Required, abort if fails ----
        var backup = createSafeBackup(data);
        if (!backup) {
            showNotification('Unable to safely save character. Please try again.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 3: MUTATE ----
        var mutationResult;
        if (isEditing) {
            mutationResult = updateExistingCharacter(existingChar, formData, data);
            if (!mutationResult.success) {
                showNotification(mutationResult.error || 'Failed to update character.', 'error');
                return Promise.resolve(false);
            }
            newId = editId;
        } else {
            mutationResult = createNewCharacter(formData, data);
            if (!mutationResult.success) {
                showNotification(mutationResult.error || 'Failed to create character.', 'error');
                return Promise.resolve(false);
            }
            newId = mutationResult.id;
            name = formData.firstName + ' ' + formData.lastName;
        }

        // Commit the mutation to window.data
        window.data = data;

        // ---- PHASE 4: PERSIST ----
        var savePromise = MutationUtils.saveWithPromise();

        return savePromise
            .then(function() {
                // ---- PHASE 5: POST-PERSIST SIDE EFFECTS (failure-safe) ----
                try {
                    if (ActivityLog && typeof ActivityLog.record === 'function') {
                        ActivityLog.record(
                            isEditing
                                ? 'Updated character: ' + name
                                : 'Created character: ' + name
                        );
                    }
                } catch (logErr) {
                    // Ignore logging errors
                }

                // ---- PHASE 6: UI COMMIT ----
                commitSaveUI(newId, isEditing);
                return true;
            })
            .catch(function(err) {
                // ---- PHASE 7: ROLLBACK ----
                rollback(backup, editId, isEditing);
                return false;
            });
    }

    // ============================================================
    // DELETE CHARACTER - Transactional mutation flow
    // ============================================================

    function deleteCharacter(id) {
        if (!checkDependencies()) {
            showNotification('Dependencies not loaded. Please refresh the page.', 'error');
            return Promise.resolve(false);
        }

        if (!id) {
            showNotification('No character selected.', 'error');
            return Promise.resolve(false);
        }

        var data = window.data || {};

        // Validate data structure - fail closed
        if (!validateDataArray(data, 'characters') || !validateDataArray(data, 'teams')) {
            showNotification('Data structure is corrupted. Please reload.', 'error');
            return Promise.resolve(false);
        }

        var char = data.characters.find(function(c) { return c && String(c.id) === String(id); });
        if (!char) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        // Capture previous edit state BEFORE mutation
        var previousEditId = getCurrentEditId();
        var wasEditing = previousEditId !== null && String(previousEditId) === String(id);

        var name = CharacterQueries.getDisplayName(char);

        if (!confirm('Delete "' + name + '" permanently? This will also remove them from all teams.')) {
            return Promise.resolve(false);
        }

        // ---- PHASE 1: SNAPSHOT - Required, abort if fails ----
        var backup = createSafeBackup(data);
        if (!backup) {
            showNotification('Unable to safely delete character. Please try again.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 2: MUTATE - Clean team memberships ----
        if (Array.isArray(data.teams)) {
            data.teams.forEach(function(team) {
                if (Array.isArray(team.members)) {
                    team.members = team.members.filter(function(m) {
                        return !m || String(m.characterId) !== String(id);
                    });
                }
            });
        }

        // Remove character
        data.characters = data.characters.filter(function(c) {
            return c && String(c.id) !== String(id);
        });

        // Commit mutation
        window.data = data;

        // ---- PHASE 3: PERSIST ----
        var savePromise = MutationUtils.saveWithPromise();

        return savePromise
            .then(function() {
                // ---- PHASE 4: POST-PERSIST SIDE EFFECTS (failure-safe) ----
                try {
                    if (ActivityLog && typeof ActivityLog.record === 'function') {
                        ActivityLog.record('Deleted character: ' + name);
                    }
                } catch (logErr) {
                    // Ignore logging errors
                }

                // ---- PHASE 5: UI COMMIT ----
                // Use captured previousEditId, not the deleted character ID
                commitDeleteUI();
                return true;
            })
            .catch(function(err) {
                // ---- PHASE 6: ROLLBACK ----
                // Use captured previousEditId to restore correct UI state
                rollback(backup, previousEditId, wasEditing);
                return false;
            });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterCRUD = {
        // Core operations
        save: save,
        delete: deleteCharacter,

        // Validation (pure, for external use)
        validateCharacter: validateCharacter,

        // Helpers (exposed for testing/emergency recovery)
        createSafeBackup: createSafeBackup,
        generateCharacterId: generateCharacterId,
        rollback: rollback,

        // State access (delegated)
        getCurrentEditId: getCurrentEditId,
        setCurrentEditId: setCurrentEditId
    };

})();
