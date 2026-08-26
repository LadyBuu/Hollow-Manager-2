/**
 * js/modules/characters/character-crud.js - Character CRUD Operations
 * Handles create, read, update, delete for characters
 * Path: js/modules/characters/character-crud.js
 * 
 * IMPORTANT: All mutations follow the correct pattern:
 *   MUTATE → LOG → SAVE
 *   This ensures activities are persisted with the data change.
 * 
 * Contract: logActivity() updates memory only.
 *           Caller (CRUD) is responsible for saveData().
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
        var isDeceased = document.getElementById('char-deceased').checked;
        var deathYear = document.getElementById('char-death-year').value.trim();
        var deathCause = document.getElementById('char-death-cause').value.trim();
        var deathAge = document.getElementById('char-death-age').value.trim();

        var classIds = getClassIds();
        var careerStatus = getCareerStatus();
        var magic = getMagic();
        var physicalMoves = getSpecialMoves('physical');
        var magicalMoves = getSpecialMoves('magical');

        var charData = buildCharacterData(
            classIds, careerStatus, magic, physicalMoves, magicalMoves,
            isDeceased, deathYear, deathCause, deathAge
        );

        if (!validateCharacter(charData)) {
            return;
        }

        var existingChar = null;
        var name = charData.firstName + ' ' + charData.lastName;
        var isNew = false;

        if (editId) {
            existingChar = data.characters.find(function(c) { 
                return String(c.id) === String(editId); 
            });
            if (!existingChar) {
                alert('Character not found.');
                return;
            }
            name = window.getDisplayName(existingChar);
        }

        // 1. MUTATE
        if (editId) {
            updateExistingCharacter(existingChar, charData, data);
        } else {
            createNewCharacter(charData, data);
            isNew = true;
            name = charData.firstName + ' ' + charData.lastName;
        }

        // 2. LOG
        if (typeof window.logActivity === 'function') {
            window.logActivity(
                editId ? 'Updated character: ' + name : 'Created character: ' + name
            );
        }

        // 3. SAVE
        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    onSaveSuccess(editId, isNew);
                })
                .catch(function(err) {
                    console.error('Failed to save character:', err);
                    alert('Failed to save character. Please try again.');
                });
        } else {
            onSaveSuccess(editId, isNew);
        }
    }

    function onSaveSuccess(editId, isNew) {
        window.CharacterList.render();
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
        var id = window.currentEditId ? window.currentEditId() : null;
        window.showCharacterForm(id);
        alert(isNew ? 'Character created successfully!' : 'Character saved successfully!');
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

        if (!confirm('Delete "' + name + '" permanently? This will also remove them from all teams.')) {
            return;
        }

        // 1. MUTATE - remove from teams first
        data.teams.forEach(function(team) {
            if (team.members) {
                team.members = team.members.filter(function(m) { 
                    return String(m.characterId) !== String(id); 
                });
            }
        });

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
                    alert('Failed to delete character. Please try again.');
                });
        } else {
            onDeleteSuccess();
        }
    }

    function onDeleteSuccess() {
        window.setCurrentEditId(null);
        window.CharacterList.render();
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
        window.showCharacterForm(null);
        alert('Character deleted successfully!');
    }

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    function getClassIds() {
        var ids = [];
        document.querySelectorAll('#class-tag-container [data-class-id]').forEach(function(tag) {
            ids.push(tag.dataset.classId);
        });
        return ids;
    }

    function getCareerStatus() {
        var statuses = [];
        document.querySelectorAll('.career-status-entry').forEach(function(entry) {
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
        return statuses;
    }

    function getMagic() {
        var magic = {};
        var magicTypes = ['earth', 'water', 'fire', 'air', 'metal', 'wood',
            'blood', 'bone', 'mind', 'morphic', 'life', 'death',
            'space', 'time', 'dimension', 'void', 'reality', 'transference'
        ];
        magicTypes.forEach(function(key) {
            var input = document.getElementById('magic-' + key);
            if (input) {
                magic[key] = parseInt(input.value) || 0;
            }
        });
        return magic;
    }

    function getSpecialMoves(type) {
        var moves = [];
        var containerId = type === 'physical' ? 'physical-moves-list' : 'magical-moves-list';
        var container = document.getElementById(containerId);
        if (container) {
            container.querySelectorAll('.special-move-entry').forEach(function(el) {
                var nameEl = el.querySelector('.move-name');
                var descEl = el.querySelector('.move-desc');
                if (nameEl) {
                    moves.push({
                        name: nameEl.textContent,
                        description: descEl ? descEl.textContent : ''
                    });
                }
            });
        }
        return moves;
    }

    function buildCharacterData(classIds, careerStatus, magic, physicalMoves, magicalMoves,
                               isDeceased, deathYear, deathCause, deathAge) {
        return {
            firstName: document.getElementById('char-firstname').value.trim(),
            middleName: document.getElementById('char-middlename').value.trim(),
            lastName: document.getElementById('char-lastname').value.trim(),
            nickname: document.getElementById('char-nickname').value.trim(),
            alias: document.getElementById('char-alias').value.trim(),
            previousNames: document.getElementById('char-previous-names').value.split(',').map(function(n) { 
                return n.trim(); 
            }).filter(function(n) { return n; }),
            nameFormat: document.getElementById('char-name-format').value || 'firstlast',
            birthYear: document.getElementById('char-birthyear').value || '',
            gender: document.getElementById('char-gender').value.trim(),
            eyes: document.getElementById('char-eyes').value.trim(),
            hair: document.getElementById('char-hair').value.trim(),
            skin: document.getElementById('char-skin').value.trim(),
            height: document.getElementById('char-height').value.trim(),
            weight: document.getElementById('char-weight').value.trim(),
            build: document.getElementById('char-build').value.trim(),
            appearanceNotes: document.getElementById('char-appearance-notes').value.trim(),
            notes: document.getElementById('char-notes').value.trim(),
            deceased: isDeceased,
            deathYear: deathYear,
            deathCause: deathCause,
            deathAge: deathAge,
            careerStatus: careerStatus,
            specialty: document.getElementById('char-specialty').value.trim(),
            classIds: classIds,
            personality: {
                traits: document.getElementById('char-traits').value.trim(),
                ideals: document.getElementById('char-ideals').value.trim(),
                flaws: document.getElementById('char-flaws').value.trim(),
                alignment: document.getElementById('char-alignment').value.trim(),
                likes: document.getElementById('char-likes').value.trim(),
                dislikes: document.getElementById('char-dislikes').value.trim(),
                habits: document.getElementById('char-habits').value.trim(),
                fears: document.getElementById('char-fears').value.trim(),
                goals: document.getElementById('char-goals').value.trim()
            },
            stats: {
                str: parseInt(document.getElementById('char-str').value) || 10,
                dex: parseInt(document.getElementById('char-dex').value) || 10,
                con: parseInt(document.getElementById('char-con').value) || 10,
                int: parseInt(document.getElementById('char-int').value) || 10,
                wis: parseInt(document.getElementById('char-wis').value) || 10,
                cha: parseInt(document.getElementById('char-cha').value) || 10
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
            alert('First name is required.');
            return false;
        }
        if (!charData.lastName) {
            alert('Last name is required.');
            return false;
        }
        if (charData.deceased && !charData.deathYear && !charData.deathAge) {
            alert('Please enter either Death Year or Death Age for deceased characters.');
            return false;
        }
        return true;
    }

    function updateExistingCharacter(existing, charData, data) {
        // Preserve eliminations and other fields not in the form
        if (!charData.eliminations && existing.eliminations) {
            charData.eliminations = existing.eliminations.slice();
        }
        if (!charData.eliminatedWeeks && existing.eliminatedWeeks) {
            charData.eliminatedWeeks = existing.eliminatedWeeks.slice();
        }
        charData.id = existing.id;
        charData.createdAt = existing.createdAt;
        
        var index = data.characters.findIndex(function(c) { 
            return String(c.id) === String(existing.id); 
        });
        if (index !== -1) {
            data.characters[index] = Object.assign({}, existing, charData);
        }
        window.data = data;
    }

    function createNewCharacter(charData, data) {
        var newChar = {
            id: window.generateId ? window.generateId('char') : 'char_' + Date.now(),
            firstName: charData.firstName,
            middleName: charData.middleName,
            lastName: charData.lastName,
            nickname: charData.nickname,
            alias: charData.alias,
            previousNames: charData.previousNames,
            nameFormat: charData.nameFormat,
            birthYear: charData.birthYear,
            gender: charData.gender,
            eyes: charData.eyes,
            hair: charData.hair,
            skin: charData.skin,
            height: charData.height,
            weight: charData.weight,
            build: charData.build,
            appearanceNotes: charData.appearanceNotes,
            notes: charData.notes,
            deceased: charData.deceased,
            deathYear: charData.deathYear,
            deathCause: charData.deathCause,
            deathAge: charData.deathAge,
            careerStatus: charData.careerStatus,
            specialty: charData.specialty,
            classIds: charData.classIds,
            personality: charData.personality,
            stats: charData.stats,
            magic: charData.magic,
            specialMoves: charData.specialMoves,
            eliminations: [],
            eliminatedWeeks: [],
            createdAt: new Date().toISOString()
        };
        data.characters.push(newChar);
        window.setCurrentEditId(newChar.id);
        window.data = data;
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
        getSpecialMoves: getSpecialMoves,
        buildCharacterData: buildCharacterData,
        validateCharacter: validateCharacter
    };

})();
