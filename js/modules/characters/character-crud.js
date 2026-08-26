/**
 * js/modules/characters/character-crud.js - Character CRUD Operations
 * Path: js/modules/characters/character-crud.js
 */

(function() {
    'use strict';

    // ============================================================
    // SAVE CHARACTER
    // ============================================================

    function save() {
        var form = document.getElementById('char-form');
        var editId = form ? form.dataset.editId : null;
        var data = window.data || {};
        
        var deceasedEl = document.getElementById('char-deceased');
        if (!deceasedEl) {
            alert('Form error: Missing required fields. Please refresh the page.');
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

        if (!validateCharacter(charData)) {
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
                alert('Character not found.');
                return;
            }
            name = window.getDisplayName(existingChar);
        }

        // Save a backup for rollback if needed
        var backup = window.ExportUtils ? window.ExportUtils.cloneData(data) : null;

        // 1. MUTATE
        if (isEditing) {
            updateExistingCharacter(existingChar, charData, data);
            newId = editId;
        } else {
            newId = createNewCharacter(charData, data);
            name = charData.firstName + ' ' + charData.lastName;
        }

        // 2. LOG
        if (typeof window.logActivity === 'function') {
            window.logActivity(
                isEditing ? 'Updated character: ' + name : 'Created character: ' + name
            );
        }

        // 3. SAVE
        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    onSaveSuccess(newId, isEditing);
                })
                .catch(function(err) {
                    console.error('Failed to save character:', err);
                    
                    // Rollback memory if backup exists
                    if (backup) {
                        window.data = backup;
                        window.CharacterList.render();
                        
                        if (isEditing) {
                            // For editing, show the original character
                            window.showCharacterForm(editId);
                        } else {
                            // For new character, reset to empty form
                            window.setCurrentEditId(null);
                            window.showCharacterForm(null);
                        }
                    }
                    
                    alert('Failed to save character. Please try again.');
                });
        } else {
            onSaveSuccess(newId, isEditing);
        }
    }

    function onSaveSuccess(id, isEditing) {
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }

        window.showCharacterForm(id);
        alert(isEditing ? 'Character saved successfully!' : 'Character created successfully!');
    }

    // ============================================================
    // DELETE CHARACTER
    // ============================================================

    function deleteCharacter(id) {
        if (!id) {
            alert('No character selected.');
            return;
        }

        var data = window.data || {};
        var char = data.characters.find(function(c) { return String(c.id) === String(id); });
        if (!char) {
            alert('Character not found.');
            return;
        }

        var name = window.getDisplayName(char);

        // Single confirmation - this is the only one
        if (!confirm('Delete "' + name + '" permanently? This will also remove them from all teams.')) {
            return;
        }

        // Save a backup for rollback if needed
        var backup = window.ExportUtils ? window.ExportUtils.cloneData(data) : null;

        // 1. MUTATE - remove from teams
        if (Array.isArray(data.teams)) {
            data.teams.forEach(function(team) {
                if (Array.isArray(team.members)) {
                    team.members = team.members.filter(function(m) {
                        return String(m.characterId) !== String(id);
                    });
                }
            });
        }

        // TODO: Clean other references (social relationships, missions, tournaments, etc.)
        // For now, we only clean team references.

        // 1. MUTATE - remove character
        data.characters = data.characters.filter(function(c) { 
            return String(c.id) !== String(id); 
        });

        // 2. LOG
        if (typeof window.logActivity === 'function') {
            window.logActivity('Deleted character: ' + name);
        }

        // 3. SAVE
        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    onDeleteSuccess();
                })
                .catch(function(err) {
                    console.error('Failed to delete character:', err);
                    // Rollback memory if backup exists
                    if (backup) {
                        window.data = backup;
                        window.CharacterList.render();
                        if (window.currentEditId) {
                            window.showCharacterForm(window.currentEditId());
                        }
                    }
                    alert('Failed to delete character. Please try again.');
                });
        } else {
            onDeleteSuccess();
        }
    }

    function onDeleteSuccess() {
        window.setCurrentEditId(null);
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
        window.showCharacterForm(null);
        alert('Character deleted successfully!');
    }

    // ============================================================
    // HELPER FUNCTIONS (unchanged)
    // ============================================================

    // ... (getClassIds, getCareerStatus, getMagic, getFormSpecialMoves, 
    //      buildCharacterData, validateCharacter, updateExistingCharacter, 
    //      createNewCharacter remain the same)

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
        validateCharacter: validateCharacter
    };

})();
