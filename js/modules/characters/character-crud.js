```javascript
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
 * DEPENDENCIES (ALL REQUIRED):
 *   - window.getCurrentEditId (from index.js)
 *   - window.setCurrentEditId (from index.js)
 *   - window.getCharacterById (from core-utils.js)
 *   - window.getDisplayName (from core-utils.js)
 *   - window.saveData (from database.js)
 *   - window.CharacterConstants (from character-constants.js) - MANDATORY
 *   - window.MutationUtils (from mutation-utils.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.logActivity (optional, for activity logging)
 *   - window.NotificationSystem (from notification.js)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterCrudLoaded) {
        return;
    }
    window.__characterCrudLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK - ALL dependencies must be present
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // Hard dependencies - MUST be present
        var required = [
            'getCurrentEditId',
            'setCurrentEditId',
            'getCharacterById',
            'getDisplayName',
            'saveData'
        ];

        required.forEach(function(name) {
            if (typeof window[name] !== 'function') {
                missing.push(name);
            }
        });

        // CharacterConstants is MANDATORY - no fallbacks
        if (!window.CharacterConstants) {
            missing.push('CharacterConstants');
        }

        // MutationUtils is MANDATORY
        if (!window.MutationUtils || typeof window.MutationUtils.createSafeBackup !== 'function') {
            missing.push('MutationUtils.createSafeBackup');
        }
        if (window.MutationUtils && typeof window.MutationUtils.saveWithPromise !== 'function') {
            missing.push('MutationUtils.saveWithPromise');
        }

        // DomUtils is MANDATORY
        if (!window.DomUtils || typeof window.DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (missing.length > 0) {
            console.error('CharacterCRUD: Missing mandatory dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // CANONICAL CONSTANTS - From CharacterConstants ONLY
    // ============================================================

    var CC = window.CharacterConstants;

    // Magic constants
    var MAGIC_TYPE_KEYS = CC.MAGIC_TYPE_KEYS;
    var MAGIC_MAX = CC.MAGIC_MAX;
    var BALANCED_MAGE_THRESHOLD = CC.BALANCED_MAGE_THRESHOLD;

    // Stat constants
    var STAT_KEYS = CC.STAT_KEYS;
    var STAT_MIN = CC.STAT_MIN;
    var STAT_MAX = CC.STAT_MAX;
    var STAT_DEFAULT = CC.STAT_DEFAULT;

    // Special moves constants
    var MAX_SPECIAL_MOVES = CC.MAX_SPECIAL_MOVES;
    var MAX_MOVE_NAME_LENGTH = CC.MAX_MOVE_NAME_LENGTH;
    var MAX_MOVE_DESCRIPTION_LENGTH = CC.MAX_MOVE_DESCRIPTION_LENGTH;

    // Calendar constants
    var MIN_WEEK = window.CALENDAR_CONSTANTS ? window.CALENDAR_CONSTANTS.MIN_WEEK : 1;
    var MAX_WEEK = window.CALENDAR_CONSTANTS ? window.CALENDAR_CONSTANTS.MAX_WEEK : 52;

    // ============================================================
    // SAFE RENDER HELPERS
    // ============================================================

    function safeRenderCharacterList() {
        if (window.CharacterList && typeof window.CharacterList.render === 'function') {
            window.CharacterList.render();
        }
    }

    function safeShowCharacterForm(id) {
        if (typeof window.showCharacterForm === 'function') {
            window.showCharacterForm(id);
        }
    }

    function safeUpdateDashboardStats() {
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
    }

    // ============================================================
    // STATE ACCESS - Single source of truth
    // ============================================================

    function getCurrentEditId() {
        if (typeof window.getCurrentEditId === 'function') {
            return window.getCurrentEditId();
        }
        return null;
    }

    function setCurrentEditId(id) {
        if (typeof window.setCurrentEditId === 'function') {
            window.setCurrentEditId(id);
        }
    }

    // ============================================================
    // NOTIFICATION - Use DomUtils with fallback chain
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';

        // Prefer DomUtils
        if (window.DomUtils) {
            switch (type) {
                case 'success':
                    if (typeof window.DomUtils.showSuccess === 'function') {
                        window.DomUtils.showSuccess(message);
                        return;
                    }
                    break;
                case 'error':
                    if (typeof window.DomUtils.showError === 'function') {
                        window.DomUtils.showError(message);
                        return;
                    }
                    break;
                case 'warning':
                    if (typeof window.DomUtils.showWarning === 'function') {
                        window.DomUtils.showWarning(message);
                        return;
                    }
                    break;
                default:
                    if (typeof window.DomUtils.showInfo === 'function') {
                        window.DomUtils.showInfo(message);
                        return;
                    }
            }
        }

        // Fallback to NotificationSystem
        if (window.NotificationSystem && typeof window.NotificationSystem.notify === 'function') {
            window.NotificationSystem.notify(message, type);
            return;
        }

        // Fallback to showToast
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }

        // Fallback to session toast
        if (typeof window.setSession === 'function') {
            window.setSession('toast', {
                message: message,
                type: type,
                timestamp: Date.now()
            });
            if (typeof window.renderToast === 'function') {
                window.renderToast();
            }
            return;
        }

        // Last resort
        if (type === 'error') {
            alert('Error: ' + message);
        } else {
            alert(message);
        }
    }

    // ============================================================
    // SAFE CLONE - Delegate to MutationUtils
    // ============================================================

    function createSafeBackup(data) {
        if (window.MutationUtils && typeof window.MutationUtils.createSafeBackup === 'function') {
            return window.MutationUtils.createSafeBackup(data);
        }

        // Emergency fallback (should never be needed)
        try {
            if (typeof structuredClone === 'function') {
                return structuredClone(data);
            }
            return JSON.parse(JSON.stringify(data));
        } catch (err) {
            console.error('CharacterCRUD: Failed to create backup:', err);
            return null;
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
    // FORM EXTRACTION HELPERS
    // ============================================================

    function getClassIds() {
        var ids = [];
        var container = document.getElementById('class-tag-container');
        if (container) {
            container.querySelectorAll('[data-class-id]').forEach(function(tag) {
                ids.push(tag.dataset.classId);
            });
        }
        return ids;
    }

    function getCareerStatus() {
        var statuses = [];
        var container = document.getElementById('career-status-container');
        if (container) {
            container.querySelectorAll('.career-status-entry').forEach(function(entry) {
                var select = entry.querySelector('.career-status-select');
                var startInput = entry.querySelector('.career-start-year');
                var endInput = entry.querySelector('.career-end-year');
                if (select && select.value) {
                    statuses.push({
                        status: select.value,
                        startYear: startInput ? startInput.value || '' : '',
                        endYear: endInput ? endInput.value || '' : ''
                    });
                }
            });
        }
        return statuses;
    }

    function getMagic() {
        var magic = {};
        var magicMax = MAGIC_MAX;

        MAGIC_TYPE_KEYS.forEach(function(key) {
            var input = document.getElementById('magic-' + key);
            var val = input ? parseInt(input.value, 10) : 0;
            magic[key] = isNaN(val) ? 0 : Math.max(0, Math.min(magicMax, val));
        });
        return magic;
    }

    function getFormSpecialMoves(type) {
        var moves = [];
        var containerId = type === 'physical' ? 'physical-moves-list' : 'magical-moves-list';
        var container = document.getElementById(containerId);

        if (container) {
            var entries = container.querySelectorAll('.special-move-entry');
            entries.forEach(function(el) {
                var nameEl = el.querySelector('.move-name');
                var descEl = el.querySelector('.move-desc');
                if (nameEl) {
                    var name = nameEl.textContent ? nameEl.textContent.trim() : '';
                    var desc = descEl ? descEl.textContent.trim() : '';
                    if (name) {
                        moves.push({
                            name: name,
                            description: desc
                        });
                    }
                }
            });
        }

        return moves;
    }

    function validateWeek(week) {
        var num = Number(week);
        return Number.isInteger(num) && num >= MIN_WEEK && num <= MAX_WEEK;
    }

    // ============================================================
    // BUILD CHARACTER DATA - Using canonical constants
    // ============================================================

    function buildCharacterData(
        classIds, careerStatus, magic, physicalMoves, magicalMoves,
        isDeceased, deathYear, deathCause, deathAge, deathWeek
    ) {
        var getVal = function(id, fallback) {
            var el = document.getElementById(id);
            return el ? el.value.trim() : fallback;
        };

        var getInt = function(id, fallback) {
            var el = document.getElementById(id);
            if (!el) return fallback;
            var val = parseInt(el.value, 10);
            if (isNaN(val)) return fallback;
            // Use canonical STAT_MIN and STAT_MAX
            return Math.max(STAT_MIN, Math.min(STAT_MAX, val));
        };

        var finalDeathYear = isDeceased ? deathYear : '';
        var finalDeathCause = isDeceased ? deathCause : '';
        var finalDeathAge = isDeceased ? deathAge : '';
        var finalDeathWeek = isDeceased ? deathWeek : '';

        return {
            firstName: getVal('char-firstname', ''),
            middleName: getVal('char-middlename', ''),
            lastName: getVal('char-lastname', ''),
            nickname: getVal('char-nickname', ''),
            alias: getVal('char-alias', ''),
            previousNames: getVal('char-previous-names', '').split(',').map(function(n) {
                return n.trim();
            }).filter(function(n) { return n; }),
            nameFormat: getVal('char-name-format', 'firstlast'),
            birthYear: getVal('char-birthyear', ''),
            gender: getVal('char-gender', ''),
            attraction: getVal('char-attraction', ''),
            sexuality: getVal('char-sexuality', ''),
            eyes: getVal('char-eyes', ''),
            hair: getVal('char-hair', ''),
            skin: getVal('char-skin', ''),
            height: getVal('char-height', ''),
            weight: getVal('char-weight', ''),
            build: getVal('char-build', ''),
            appearanceNotes: getVal('char-appearance-notes', ''),
            notes: getVal('char-notes', ''),
            deceased: isDeceased,
            deathYear: finalDeathYear,
            deathCause: finalDeathCause,
            deathAge: finalDeathAge,
            deathWeek: finalDeathWeek,
            careerStatus: careerStatus,
            specialty: getVal('char-specialty', ''),
            classIds: classIds,
            personality: {
                traits: getVal('char-traits', ''),
                ideals: getVal('char-ideals', ''),
                bonds: getVal('char-bonds', ''),
                flaws: getVal('char-flaws', ''),
                alignment: getVal('char-alignment', ''),
                likes: getVal('char-likes', ''),
                dislikes: getVal('char-dislikes', ''),
                habits: getVal('char-habits', ''),
                fears: getVal('char-fears', ''),
                goals: getVal('char-goals', '')
            },
            stats: {
                str: getInt('char-str', STAT_DEFAULT),
                dex: getInt('char-dex', STAT_DEFAULT),
                con: getInt('char-con', STAT_DEFAULT),
                int: getInt('char-int', STAT_DEFAULT),
                wis: getInt('char-wis', STAT_DEFAULT),
                cha: getInt('char-cha', STAT_DEFAULT)
            },
            magic: magic,
            specialMoves: {
                physical: physicalMoves,
                magical: magicalMoves
            }
        };
    }

    // ============================================================
    // CHARACTER VALIDATION - Using canonical constants
    // ============================================================

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

    function save() {
        if (!checkDependencies()) {
            showNotification('Dependencies not loaded. Please refresh the page.', 'error');
            return Promise.resolve(false);
        }

        var data = window.data || {};

        // Validate data structure - fail closed
        if (!validateDataArray(data, 'characters')) {
            showNotification('Character data is corrupted. Please reload.', 'error');
            return Promise.resolve(false);
        }

        var editId = getCurrentEditId();

        // --- EXTRACT FORM DATA ---
        var deceasedEl = document.getElementById('char-deceased');
        if (!deceasedEl) {
            showNotification('Form error: Missing required fields. Please refresh the page.', 'error');
            return Promise.resolve(false);
        }

        var isDeceased = deceasedEl.checked;
        var deathYear = document.getElementById('char-death-year') ? document.getElementById('char-death-year').value.trim() : '';
        var deathCause = document.getElementById('char-death-cause') ? document.getElementById('char-death-cause').value.trim() : '';
        var deathAge = document.getElementById('char-death-age') ? document.getElementById('char-death-age').value.trim() : '';
        var deathWeek = document.getElementById('char-death-week') ? document.getElementById('char-death-week').value.trim() : '';

        var classIds = getClassIds();
        var careerStatus = getCareerStatus();
        var magic = getMagic();
        var physicalMoves = getFormSpecialMoves('physical');
        var magicalMoves = getFormSpecialMoves('magical');

        // --- BUILD ---
        var charData = buildCharacterData(
            classIds, careerStatus, magic, physicalMoves, magicalMoves,
            isDeceased, deathYear, deathCause, deathAge, deathWeek
        );

        // --- VALIDATE ---
        var validation = validateCharacter(charData);
        if (!validation.valid) {
            showNotification(validation.message, 'error');
            return Promise.resolve(false);
        }

        var isEditing = editId !== null && editId !== undefined && editId !== '';
        var existingChar = null;
        var name = charData.firstName + ' ' + charData.lastName;
        var newId = null;

        if (isEditing) {
            existingChar = typeof window.getCharacterById === 'function'
                ? window.getCharacterById(editId)
                : null;
            if (!existingChar) {
                showNotification('Character not found.', 'error');
                return Promise.resolve(false);
            }
            name = typeof window.getDisplayName === 'function'
                ? window.getDisplayName(existingChar)
                : existingChar.firstName + ' ' + existingChar.lastName;
        }

        // --- SNAPSHOT - Required, abort if fails ---
        var backup = createSafeBackup(data);
        if (!backup) {
            showNotification('Unable to safely save character. Please try again.', 'error');
            return Promise.resolve(false);
        }

        // --- MUTATE ---
        var mutationResult;
        if (isEditing) {
            mutationResult = updateExistingCharacter(existingChar, charData, data);
            if (!mutationResult.success) {
                showNotification(mutationResult.error || 'Failed to update character.', 'error');
                return Promise.resolve(false);
            }
            newId = editId;
        } else {
            mutationResult = createNewCharacter(charData, data);
            if (!mutationResult.success) {
                showNotification(mutationResult.error || 'Failed to create character.', 'error');
                return Promise.resolve(false);
            }
            newId = mutationResult.id;
            name = charData.firstName + ' ' + charData.lastName;
        }

        // Commit the mutation to window.data
        window.data = data;

        // --- PERSIST - Use saveWithPromise from MutationUtils ---
        var savePromise = window.MutationUtils.saveWithPromise();

        return savePromise
            .then(function() {
                // POST-PERSIST SIDE EFFECTS - failure-safe
                try {
                    if (typeof window.logActivity === 'function') {
                        window.logActivity(
                            isEditing
                                ? 'Updated character: ' + name
                                : 'Created character: ' + name
                        );
                    }
                } catch (logErr) {
                    // Ignore logging errors
                }

                // --- UI COMMIT ---
                commitSaveUI(newId, isEditing);
                return true;
            })
            .catch(function(err) {
                // --- ROLLBACK ---
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

        var name = typeof window.getDisplayName === 'function'
            ? window.getDisplayName(char)
            : char.firstName + ' ' + char.lastName;

        if (!confirm('Delete "' + name + '" permanently? This will also remove them from all teams.')) {
            return Promise.resolve(false);
        }

        // --- SNAPSHOT - Required, abort if fails ---
        var backup = createSafeBackup(data);
        if (!backup) {
            showNotification('Unable to safely delete character. Please try again.', 'error');
            return Promise.resolve(false);
        }

        // --- MUTATE - Clean team memberships ---
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

        // --- PERSIST ---
        var savePromise = window.MutationUtils.saveWithPromise();

        return savePromise
            .then(function() {
                // POST-PERSIST SIDE EFFECTS - failure-safe
                try {
                    if (typeof window.logActivity === 'function') {
                        window.logActivity('Deleted character: ' + name);
                    }
                } catch (logErr) {
                    // Ignore logging errors
                }

                // --- UI COMMIT ---
                commitDeleteUI();
                return true;
            })
            .catch(function(err) {
                // --- ROLLBACK ---
                rollback(backup, id, true);
                return false;
            });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterCRUD = {
        save: save,
        delete: deleteCharacter,
        getClassIds: getClassIds,
        getCareerStatus: getCareerStatus,
        getMagic: getMagic,
        getFormSpecialMoves: getFormSpecialMoves,
        buildCharacterData: buildCharacterData,
        validateCharacter: validateCharacter,
        createSafeBackup: createSafeBackup,
        generateCharacterId: generateCharacterId,
        getCurrentEditId: getCurrentEditId,
        setCurrentEditId: setCurrentEditId,
        // Exposed for testing/emergency recovery
        rollback: rollback
    };

})();
```
