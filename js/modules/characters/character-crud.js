/**
 * js/modules/characters/character-crud.js - Character CRUD Operations
 * Path: js/modules/characters/character-crud.js
 * 
 * This module handles all character CRUD operations with:
 * - Clean persistence boundary (mutates window.data, caller saves)
 * - Proper rollback on save failure
 * - Consistent state management via AppState as single source of truth
 * - Defensive cloning for backups using database module's clone
 * - Explicit notification rendering
 * 
 * PERSISTENCE CONTRACT:
 * - All mutations are applied to window.data in memory
 * - Caller is responsible for saveData() persistence
 * - Rollback restores window.data on failure
 * - UI state is managed via AppState, not DOM attributes
 * 
 * STATE SOURCE OF TRUTH:
 * - AppState.characters.formEditId is the canonical edit state
 * - DOM is rendered from state, not the other way around
 * - showCharacterForm() should read from AppState
 * - CRUD module reads from AppState, not dataset.editId
 */

(function() {
    'use strict';

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
        if (typeof window.getState === 'function') {
            return window.getState('characters', 'formEditId');
        }
        return null;
    }

    function setCurrentEditId(id) {
        if (typeof window.setState === 'function') {
            window.setState('characters', 'formEditId', id);
        }
    }

    // ============================================================
    // NOTIFICATION - Explicit rendering
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';

        // Use explicit notification API if available
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }

        // Fallback: update SessionState and trigger render
        if (typeof window.setSession === 'function') {
            window.setSession('toast', {
                message: message,
                type: type,
                timestamp: Date.now()
            });

            // Trigger toast render if available
            if (typeof window.renderToast === 'function') {
                window.renderToast();
            }
            return;
        }

        // Ultimate fallback
        alert(type === 'error' ? 'Error: ' + message : message);
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
            // No safe cloning available - return null (rollback disabled)
            return null;
        } catch (err) {
            // If cloning fails, return null (no rollback available)
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

    function ensureDataArray(data, key) {
        if (!data) return false;
        if (!Array.isArray(data[key])) {
            data[key] = [];
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

    function getMagic() {
        var magic = {};
        var magicTypes = [
            'earth', 'water', 'fire', 'air', 'metal', 'wood',
            'blood', 'bone', 'mind', 'morphic', 'life', 'death',
            'space', 'time', 'dimension', 'void', 'reality', 'transference'
        ];
        magicTypes.forEach(function(key) {
            var input = document.getElementById('magic-' + key);
            magic[key] = input ? (parseInt(input.value, 10) || 0) : 0;
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
                    var name = nameEl.value !== undefined ? nameEl.value.trim() : nameEl.textContent.trim();
                    var desc = descEl ? (descEl.value !== undefined ? descEl.value.trim() : descEl.textContent.trim()) : '';
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

    function buildCharacterData(
        classIds, careerStatus, magic, physicalMoves, magicalMoves,
        isDeceased, deathYear, deathCause, deathAge
    ) {
        var getVal = function(id, fallback) {
            var el = document.getElementById(id);
            return el ? el.value.trim() : fallback;
        };

        var getInt = function(id, fallback) {
            var el = document.getElementById(id);
            if (!el) return fallback;
            var val = parseInt(el.value, 10);
            return isNaN(val) ? fallback : val;
        };

        // Clear death fields if not deceased
        var finalDeathYear = isDeceased ? deathYear : '';
        var finalDeathCause = isDeceased ? deathCause : '';
        var finalDeathAge = isDeceased ? deathAge : '';

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
        if (charData.deceased && !charData.deathYear && !charData.deathAge) {
            return { valid: false, message: 'Please enter either Death Year or Death Age for deceased characters.' };
        }
        return { valid: true };
    }

    function updateExistingCharacter(existing, charData, data) {
        var updatedCharacter = Object.assign({}, existing, charData, {
            id: existing.id,
            createdAt: existing.createdAt
        });

        var index = data.characters.findIndex(function(c) {
            return String(c.id) === String(existing.id);
        });
        if (index !== -1) {
            data.characters[index] = updatedCharacter;
        }
        window.data = data;
    }

    function createNewCharacter(charData, data) {
        var id = generateCharacterId();

        // Generated fields win (prevent charData from overwriting them)
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
    // SAVE CHARACTER
    // ============================================================

    function save() {
        var data = window.data || {};

        // Validate data structure
        if (!validateDataArray(data, 'characters')) {
            if (!ensureDataArray(data, 'characters')) {
                showNotification('Data structure is corrupted. Please reload.', 'error');
                return;
            }
        }

        var editId = getCurrentEditId();

        var deceasedEl = document.getElementById('char-deceased');
        if (!deceasedEl) {
            showNotification('Form error: Missing required fields. Please refresh the page.', 'error');
            return;
        }

        var isDeceased = deceasedEl.checked;
        var deathYear = document.getElementById('char-death-year') ? document.getElementById('char-death-year').value.trim() : '';
        var deathCause = document.getElementById('char-death-cause') ? document.getElementById('char-death-cause').value.trim() : '';
        var deathAge = document.getElementById('char-death-age') ? document.getElementById('char-death-age').value.trim() : '';

        var classIds = getClassIds();
        var careerStatus = getCareerStatus();
        var magic = getMagic();
        var physicalMoves = getFormSpecialMoves('physical');
        var magicalMoves = getFormSpecialMoves('magical');

        var charData = buildCharacterData(
            classIds, careerStatus, magic, physicalMoves, magicalMoves,
            isDeceased, deathYear, deathCause, deathAge
        );

        var validation = validateCharacter(charData);
        if (!validation.valid) {
            showNotification(validation.message, 'error');
            return;
        }

        var isEditing = editId !== null && editId !== undefined && editId !== '';
        var existingChar = null;
        var name = charData.firstName + ' ' + charData.lastName;
        var newId = null;

        if (isEditing) {
            existingChar = data.characters.find(function(c) {
                return String(c.id) === String(editId);
            });
            if (!existingChar) {
                showNotification('Character not found.', 'error');
                return;
            }
            name = window.getDisplayName ? window.getDisplayName(existingChar) : existingChar.firstName + ' ' + existingChar.lastName;
        }

        // Save a backup for rollback if needed
        var backup = createSafeBackup(data);

        // 1. MUTATE
        if (isEditing) {
            updateExistingCharacter(existingChar, charData, data);
            newId = editId;
        } else {
            newId = createNewCharacter(charData, data);
            name = charData.firstName + ' ' + charData.lastName;
        }

        // 2. LOG (logActivity should NOT call saveData)
        if (typeof window.logActivity === 'function') {
            window.logActivity(
                isEditing ? 'Updated character: ' + name : 'Created character: ' + name
            );
        }

        // 3. PERSIST
        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    onSaveSuccess(newId, isEditing);
                })
                .catch(function(err) {
                    // Rollback memory if backup exists
                    if (backup) {
                        window.data = backup;
                        safeRenderCharacterList();

                        if (isEditing) {
                            // For editing, show the original character
                            setCurrentEditId(editId);
                            safeShowCharacterForm(editId);
                        } else {
                            // For new character, reset to empty form
                            setCurrentEditId(null);
                            safeShowCharacterForm(null);
                        }
                    }

                    showNotification('Failed to save character. Please try again.', 'error');
                });
        } else {
            onSaveSuccess(newId, isEditing);
        }
    }

    function onSaveSuccess(id, isEditing) {
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }

        safeShowCharacterForm(id);
        showNotification(isEditing ? 'Character saved successfully!' : 'Character created successfully!', 'success');
    }

    // ============================================================
    // DELETE CHARACTER
    // ============================================================

    function deleteCharacter(id) {
        if (!id) {
            showNotification('No character selected.', 'error');
            return;
        }

        var data = window.data || {};

        if (!validateDataArray(data, 'characters') || !validateDataArray(data, 'teams')) {
            showNotification('Data structure is corrupted. Please reload.', 'error');
            return;
        }

        var char = data.characters.find(function(c) { return String(c.id) === String(id); });
        if (!char) {
            showNotification('Character not found.', 'error');
            return;
        }

        var name = window.getDisplayName ? window.getDisplayName(char) : char.firstName + ' ' + char.lastName;

        // Single confirmation - this is the only one
        if (!confirm('Delete "' + name + '" permanently? This will also remove them from all teams.')) {
            return;
        }

        // Save a backup for rollback if needed
        var backup = createSafeBackup(data);

        // MUTATE
        // Clean team memberships
        if (Array.isArray(data.teams)) {
            data.teams.forEach(function(team) {
                if (Array.isArray(team.members)) {
                    team.members = team.members.filter(function(m) {
                        return String(m.characterId) !== String(id);
                    });
                }
            });
        }

        // Remove character
        data.characters = data.characters.filter(function(c) {
            return String(c.id) !== String(id);
        });

        // LOG
        if (typeof window.logActivity === 'function') {
            window.logActivity('Deleted character: ' + name);
        }

        // PERSIST
        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    onDeleteSuccess();
                })
                .catch(function(err) {
                    // Rollback memory if backup exists
                    if (backup) {
                        window.data = backup;
                        safeRenderCharacterList();

                        // Restore the deleted character in the form
                        setCurrentEditId(id);
                        safeShowCharacterForm(id);
                    }

                    showNotification('Failed to delete character. Please try again.', 'error');
                });
        } else {
            onDeleteSuccess();
        }
    }

    function onDeleteSuccess() {
        setCurrentEditId(null);
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
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
