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
                            window.setCurrentEditId(editId);
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
                        
                        // Restore the deleted character in the form
                        window.setCurrentEditId(id);
                        window.showCharacterForm(id);
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

    function buildCharacterData(classIds, careerStatus, magic, physicalMoves, magicalMoves,
                               isDeceased, deathYear, deathCause, deathAge) {
        var getVal = function(id, fallback) {
            var el = document.getElementById(id);
            return el ? el.value.trim() : fallback;
        };

        var getInt = function(id, fallback) {
            var el = document.getElementById(id);
            if (!el) return fallback;
            var val = parseInt(el.value);
            return isNaN(val) ? fallback : val;
        };

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
            deathYear: deathYear,
            deathCause: deathCause,
            deathAge: deathAge,
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
        var id = window.generateId ? window.generateId('char') : 'char_' + Date.now();
        var newChar = {
            id: id,
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
        window.setCurrentEditId(id);
        window.data = data;
        return id;
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
        validateCharacter: validateCharacter
    };

})();
