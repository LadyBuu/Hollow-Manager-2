/**
 * js/modules/characters/character-classes.js - Character Classes
 * Handles adding/removing characters from classes
 * Path: js/modules/characters/character-classes.js
 */

(function() {
    'use strict';

    // ============================================================
    // ADD TO CLASS
    // ============================================================

    function addToClass() {
        var select = document.getElementById('academic-class-select');
        if (!select) return;
        
        var classId = select.value;
        if (!classId) {
            alert('Please select a class.');
            return;
        }

        var charId = window.currentEditId ? window.currentEditId() : null;
        if (!charId) {
            alert('No character selected.');
            return;
        }

        var result = window.addCharacterToClass(charId, classId);
        if (result && result.success) {
            var char = window.getCharacterById(charId);
            if (char) {
                window.CharacterForm.populateFormFields(char);
                populateAcademicClassSelector(char);
                updateCurrentClassesDisplay(char);
                window.CharacterList.render();
            }
            alert('Character added to class successfully!');
        } else {
            alert(result ? result.message : 'Failed to add character to class.');
        }
    }

    // ============================================================
    // REMOVE FROM CLASS
    // ============================================================

    function removeFromClass() {
        var charId = window.currentEditId ? window.currentEditId() : null;
        if (!charId) {
            alert('No character selected.');
            return;
        }

        var char = window.getCharacterById(charId);
        if (!char || !char.classIds || char.classIds.length === 0) {
            alert('Character is not in any classes.');
            return;
        }

        var classes = window.getClasses() || [];
        var classNames = char.classIds.map(function(cid) {
            var cls = classes.find(function(c) { return String(c.id) === String(cid); });
            return cls ? cls.name : 'Unknown';
        });

        var classList = classNames.join('\n• ');
        var choice = prompt('Enter the name of the class to remove:\n\nCurrent classes:\n• ' + classList, '');
        if (!choice) return;

        var cls = window.getClassByName(choice.trim());
        if (!cls) {
            alert('Class "' + choice + '" not found.');
            return;
        }

        var result = window.removeCharacterFromClass(charId, cls.id);
        if (result && result.success) {
            var updatedChar = window.getCharacterById(charId);
            if (updatedChar) {
                window.CharacterForm.populateFormFields(updatedChar);
                populateAcademicClassSelector(updatedChar);
                updateCurrentClassesDisplay(updatedChar);
                window.CharacterList.render();
            }
            alert('Character removed from class successfully!');
        } else {
            alert(result ? result.message : 'Failed to remove character from class.');
        }
    }

    // ============================================================
    // POPULATE CLASS SELECTOR
    // ============================================================

    function populateAcademicClassSelector(char) {
        var select = document.getElementById('academic-class-select');
        if (!select) return;

        var classes = window.getClasses() || [];
        var currentValue = select.value;
        select.innerHTML = '<option value="">Select a class...</option>';
        
        var existingClassIds = (char && char.classIds) || [];
        
        classes.forEach(function(cls) {
            var isAssigned = existingClassIds.some(function(cid) { 
                return String(cid) === String(cls.id); 
            });
            if (!isAssigned) {
                var option = document.createElement('option');
                option.value = cls.id;
                option.textContent = cls.name;
                select.appendChild(option);
            }
        });
        
        if (currentValue) select.value = currentValue;
    }

    // ============================================================
    // UPDATE DISPLAY
    // ============================================================

    function updateCurrentClassesDisplay(char) {
        var display = document.getElementById('current-classes-list');
        if (!display) return;

        var classIds = (char && char.classIds) || [];
        if (classIds.length === 0) {
            display.textContent = 'None';
            return;
        }

        var classes = window.getClasses() || [];
        var names = [];
        classIds.forEach(function(cid) {
            var cls = classes.find(function(c) { return String(c.id) === String(cid); });
            if (cls) names.push(cls.name);
        });
        display.textContent = names.length > 0 ? names.join(', ') : 'None';
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterClasses = {
        addToClass: addToClass,
        removeFromClass: removeFromClass,
        populateAcademicClassSelector: populateAcademicClassSelector,
        updateCurrentClassesDisplay: updateCurrentClassesDisplay
    };

})();
