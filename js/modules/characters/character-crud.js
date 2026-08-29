/**
 * js/modules/characters/character-crud.js - Character CRUD Operations
 * Path: js/modules/characters/character-crud.js
 * 
 * This module handles all character CRUD operations with:
 * - Clean persistence boundary (mutates window.data, then saves)
 * - Proper rollback on save failure
 * - Consistent state management via getCurrentEditId/setCurrentEditId
 * - Defensive cloning for backups using database module's clone
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
 * DEPENDENCIES:
 *   - window.getCurrentEditId (from index.js)
 *   - window.setCurrentEditId (from index.js)
 *   - window.getCharacterById (from core-utils.js)
 *   - window.getDisplayName (from core-utils.js)
 *   - window.saveData (from database.js)
 *   - window.db.createSafeCopy (from database.js)
 *   - window.CharacterStats (for magic schema, optional but recommended)
 *   - window.logActivity (optional, for activity logging)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterCrudLoaded) {
        return;
    }
    window.__characterCrudLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = 1;
    var MAX_WEEK = 52;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var required = [
            'getCurrentEditId',
            'setCurrentEditId',
            'getCharacterById',
            'getDisplayName',
            'saveData'
        ];

        var missing = [];
        required.forEach(function(name) {
            if (name === 'saveData' && typeof window.saveData !== 'function') {
                missing.push('saveData');
            } else if (typeof window[name] !== 'function') {
                missing.push(name);
            }
        });

        if (missing.length > 0) {
            console.warn('CharacterCRUD: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

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
    // NOTIFICATION - Explicit rendering
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';

        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }

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

        if (type === 'error') {
            alert('Error: ' + message);
        } else {
            alert(message);
        }
    }

    // ============================================================
    // SAFE CLONE - Use database module's clone (synchronous)
    // ============================================================

    function createSafeBackup(data) {
        try {
            if (window.db && typeof window.db.createSafeCopy === 'function') {
                return window.db.createSafeCopy(data);
            }
            if (typeof structuredClone === 'function') {
                return structuredClone(data);
            }
            try {
                return JSON.parse(JSON.stringify(data));
            } catch (e) {
                console.warn('CharacterCRUD: Failed to create backup:', e);
                return null;
            }
        } catch (err) {
            console.warn('CharacterCRUD: Failed to create backup:', err);
            return null;
        }
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
    // HELPER FUNCTIONS
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

    function getMagicTypeKeys() {
        if (window.CharacterStats &&
            typeof window.CharacterStats.getMagicTypeKeys === 'function') {
            var keys = window.CharacterStats.getMagicTypeKeys();
            if (Array.isArray(keys) && keys.length > 0) {
                return keys;
            }
            console.warn('CharacterCRUD: CharacterStats returned invalid magic type keys.');
        }

        // Fallback for when CharacterStats isn't available
        return [
            'earth', 'water', 'fire', 'air', 'metal', 'wood',
            'blood', 'bone', 'mind', 'morphic', 'life', 'death',
            'space', 'time', 'dimension', 'void', 'reality', 'transference'
        ];
    }

    function getMagicMax() {
        if (window.CharacterStats &&
            typeof window.CharacterStats.MAGIC_MAX !== 'undefined' &&
            typeof window.CharacterStats.MAGIC_MAX === 'number') {
            return window.CharacterStats.MAGIC_MAX;
        }
        return 10;
    }

    function getMagic() {
        var magic = {};
        var types = getMagicTypeKeys();
        var magicMax = getMagicMax();

        types.forEach(function(key) {
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
            container.querySelectorAll('.special-move-entry').forEach(function(el) {
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
            return isNaN(val) ? fallback : Math.max(1, Math.min(30, val));
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
                str: getInt('char-str', 10),
                dex: getInt('char-dex', 10),
                con: getInt('char-con', 10),
                int: getInt('char-int', 10),
                wis: getInt('char-wis', 10),
                cha: getInt('char-cha', 10)
            },
            magic: magic,
            specialMoves: {
                physical: physicalMoves,
                magical: magicalMoves
            }
        };
    }

    function validateCharacter(charData) {
        if (!charData.firstName) {
            return { valid: false, message: 'First name is required.' };
        }
        if (!charData.lastName) {
            return { valid: false, message: 'Last name is required.' };
        }
        if (charData.deceased) {
            var hasDeathInfo = charData.deathYear || charData.deathAge || charData.deathWeek;
            if (!hasDeathInfo) {
                return { valid: false, message: 'Please enter Death Year, Death Age, or Death Week for deceased characters.' };
            }
            if (charData.deathWeek && !validateWeek(charData.deathWeek)) {
                return { valid: false, message: 'Death Week must be between 1 and 52.' };
            }
        }
        return { valid: true };
    }

    function updateExistingCharacter(existing, charData, data) {
        var index = data.characters.findIndex(function(c) {
            return c && String(c.id) === String(existing.id);
        });

        if (index === -1) {
            return false;
        }

        var current = data.characters[index];

        data.characters[index] = Object.assign({}, current, charData, {
            id: current.id,
            createdAt: current.createdAt,
            eliminations: Array.isArray(current.eliminations) ? current.eliminations : [],
            eliminatedWeeks: Array.isArray(current.eliminatedWeeks) ? current.eliminatedWeeks : []
        });

        window.data = data;
        return true;
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
        setCurrentEditId(id);
        window.data = data;

        return id;
    }

    // ============================================================
    // SAVE CHARACTER - Returns Promise
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

        var charData = buildCharacterData(
            classIds, careerStatus, magic, physicalMoves, magicalMoves,
            isDeceased, deathYear, deathCause, deathAge, deathWeek
        );

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

        // SNAPSHOT - Required, abort if fails
        var backup = createSafeBackup(data);
        if (!backup) {
            console.error('CharacterCRUD: Could not create rollback backup.');
            showNotification('Unable to safely save character. Please try again.', 'error');
            return Promise.resolve(false);
        }

        // MUTATE
        if (isEditing) {
            var updated = updateExistingCharacter(existingChar, charData, data);
            if (!updated) {
                showNotification('Failed to update character. Please try again.', 'error');
                return Promise.resolve(false);
            }
            newId = editId;
        } else {
            newId = createNewCharacter(charData, data);
            name = charData.firstName + ' ' + charData.lastName;
        }

        // PERSIST
        if (typeof window.saveData === 'function') {
            return window.saveData()
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
                        console.warn('CharacterCRUD: Activity logging failed:', logErr);
                        // Do NOT rollback - persistence already succeeded
                    }

                    // UI COMMIT
                    onSaveSuccess(newId, isEditing);
                    return true;
                })
                .catch(function(err) {
                    console.error('Failed to save character:', err);
                    // ROLLBACK
                    window.data = backup;
                    safeRenderCharacterList();

                    if (isEditing) {
                        setCurrentEditId(editId);
                        safeShowCharacterForm(editId);
                    } else {
                        setCurrentEditId(null);
                        safeShowCharacterForm(null);
                    }

                    showNotification('Failed to save character. Please try again.', 'error');
                    return false;
                });
        } else {
            // This should be unreachable because checkDependencies requires saveData
            onSaveSuccess(newId, isEditing);
            return Promise.resolve(true);
        }
    }

    function onSaveSuccess(id, isEditing) {
        safeUpdateDashboardStats();
        safeShowCharacterForm(id);
        showNotification(isEditing ? 'Character saved successfully!' : 'Character created successfully!', 'success');
    }

    // ============================================================
    // DELETE CHARACTER - Returns Promise
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

        // SNAPSHOT - Required, abort if fails
        var backup = createSafeBackup(data);
        if (!backup) {
            console.error('CharacterCRUD: Could not create rollback backup for deletion.');
            showNotification('Unable to safely delete character. Please try again.', 'error');
            return Promise.resolve(false);
        }

        // MUTATE - Clean team memberships
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

        // PERSIST
        if (typeof window.saveData === 'function') {
            return window.saveData()
                .then(function() {
                    // POST-PERSIST SIDE EFFECTS - failure-safe
                    try {
                        if (typeof window.logActivity === 'function') {
                            window.logActivity('Deleted character: ' + name);
                        }
                    } catch (logErr) {
                        console.warn('CharacterCRUD: Activity logging failed:', logErr);
                        // Do NOT rollback - persistence already succeeded
                    }

                    // UI COMMIT
                    onDeleteSuccess();
                    return true;
                })
                .catch(function(err) {
                    console.error('Failed to delete character:', err);
                    // ROLLBACK
                    window.data = backup;
                    safeRenderCharacterList();
                    setCurrentEditId(id);
                    safeShowCharacterForm(id);
                    showNotification('Failed to delete character. Please try again.', 'error');
                    return false;
                });
        } else {
            // This should be unreachable because checkDependencies requires saveData
            onDeleteSuccess();
            return Promise.resolve(true);
        }
    }

    function onDeleteSuccess() {
        setCurrentEditId(null);
        safeUpdateDashboardStats();
        safeShowCharacterForm(null);
        showNotification('Character deleted successfully!', 'success');
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
        setCurrentEditId: setCurrentEditId
    };

})();
