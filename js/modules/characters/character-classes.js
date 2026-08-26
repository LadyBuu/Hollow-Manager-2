/**
 * js/modules/characters/character-classes.js - Character Classes
 * Handles adding/removing characters from classes
 * Path: js/modules/characters/character-classes.js
 * 
 * This module is responsible for:
 *   - Adding characters to classes (with MUTATE → LOG → SAVE)
 *   - Removing characters from classes (with MUTATE → LOG → SAVE)
 *   - Rendering class tags in the form
 *   - Populating class selectors
 *   - Querying character-class relationships
 * 
 * IMPORTANT: All mutations follow the correct pattern:
 *   MUTATE → LOG → SAVE
 *   All user-controlled data is escaped to prevent XSS.
 *   Rollback is performed on save failure.
 *   Class tags use DOM API (textContent) instead of innerHTML for safety.
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterClassesLoaded) {
        return;
    }
    window.__characterClassesLoaded = true;

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

    function safeGetCurrentEditId() {
        if (typeof window.currentEditId === 'function') {
            return window.currentEditId();
        }
        return null;
    }

    // ============================================================
    // ADD TO CLASS
    // ============================================================

    function addToClass() {
        var select = document.getElementById('academic-class-select');
        if (!select) {
            alert('Class selector not found. Please refresh the page.');
            return;
        }
        
        var classId = select.value;
        if (!classId) {
            alert('Please select a class.');
            return;
        }

        var charId = safeGetCurrentEditId();
        if (!charId) {
            alert('No character selected.');
            return;
        }

        var char = window.getCharacterById(charId);
        if (!char) {
            alert('Character not found.');
            return;
        }

        var cls = window.getClass(classId);
        if (!cls) {
            alert('Class not found.');
            return;
        }

        // Check if already in class
        if (char.classIds && char.classIds.some(function(cid) { return String(cid) === String(classId); })) {
            alert('Character is already in this class.');
            return;
        }

        var data = window.data || {};
        
        // Save backup for rollback
        var backup = window.ExportUtils ? window.ExportUtils.cloneData(data) : null;

        // 1. MUTATE
        if (!char.classIds) char.classIds = [];
        char.classIds.push(classId);

        // 2. LOG
        var name = window.getDisplayName(char);
        if (typeof window.logActivity === 'function') {
            window.logActivity('Added ' + name + ' to class: ' + cls.name);
        }

        // 3. SAVE
        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    refreshUI(char);
                    alert('Character added to class successfully!');
                })
                .catch(function(err) {
                    console.error('Failed to add character to class:', err);
                    if (backup) {
                        window.data = backup;
                        safeRenderCharacterList();
                        safeShowCharacterForm(charId);
                    }
                    alert('Failed to add character to class. Please try again.');
                });
        } else {
            refreshUI(char);
            alert('Character added to class successfully!');
        }
    }

    // ============================================================
    // REMOVE FROM CLASS
    // ============================================================

    function removeFromClass() {
        var charId = safeGetCurrentEditId();
        if (!charId) {
            alert('No character selected.');
            return;
        }

        var char = window.getCharacterById(charId);
        if (!char) {
            alert('Character not found.');
            return;
        }

        if (!char.classIds || char.classIds.length === 0) {
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

        // Check if character is actually in this class
        var isInClass = char.classIds.some(function(cid) { return String(cid) === String(cls.id); });
        if (!isInClass) {
            alert('Character is not in class "' + cls.name + '".');
            return;
        }

        if (!confirm('Remove ' + window.getDisplayName(char) + ' from class "' + cls.name + '"?')) {
            return;
        }

        var data = window.data || {};
        
        // Save backup for rollback
        var backup = window.ExportUtils ? window.ExportUtils.cloneData(data) : null;

        // 1. MUTATE
        char.classIds = char.classIds.filter(function(cid) { return String(cid) !== String(cls.id); });

        // 2. LOG
        var name = window.getDisplayName(char);
        if (typeof window.logActivity === 'function') {
            window.logActivity('Removed ' + name + ' from class: ' + cls.name);
        }

        // 3. SAVE
        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    refreshUI(char);
                    alert('Character removed from class successfully!');
                })
                .catch(function(err) {
                    console.error('Failed to remove character from class:', err);
                    if (backup) {
                        window.data = backup;
                        safeRenderCharacterList();
                        safeShowCharacterForm(charId);
                    }
                    alert('Failed to remove character from class. Please try again.');
                });
        } else {
            refreshUI(char);
            alert('Character removed from class successfully!');
        }
    }

    // ============================================================
    // ADD CLASS TAG - IDEMPOTENT, XSS-SAFE
    // ============================================================

    function addClassTag(classId, className) {
        var container = document.getElementById('class-tag-container');
        if (!container) return;
        
        // Remove empty message if present
        var emptyMsg = container.querySelector('span[style*="text-dim"]');
        if (emptyMsg) emptyMsg.remove();
        
        // Check if tag already exists (idempotent)
        var existing = container.querySelector('[data-class-id="' + classId + '"]');
        if (existing) return;
        
        // Build DOM elements safely - no innerHTML for user data
        var tag = document.createElement('span');
        tag.style.cssText = 'background:var(--accent-soft);padding:2px 8px;border-radius:10px;font-size:0.7rem;border:1px solid var(--accent);display:inline-flex;align-items:center;gap:4px;';
        tag.dataset.classId = classId;
        
        var nameSpan = document.createElement('span');
        nameSpan.textContent = className;  // Safe: textContent escapes
        
        var button = document.createElement('button');
        button.className = 'remove-class-tag';
        button.dataset.id = classId;
        button.textContent = '✕';
        button.style.cssText = 'background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.5rem;padding:0 2px;';
        button.setAttribute('aria-label', 'Remove class ' + className);
        
        tag.appendChild(nameSpan);
        tag.appendChild(button);
        container.appendChild(tag);
        
        // Use closest() for safer removal
        button.addEventListener('click', function() {
            var tag = this.closest('[data-class-id]');
            if (tag) {
                tag.remove();
                var container = document.getElementById('class-tag-container');
                if (container && container.children.length === 0) {
                    container.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem;padding:4px;">No classes assigned</span>';
                }
            }
        });
    }

    // ============================================================
    // CLASS TAG HELPERS
    // ============================================================

    function getClassTags() {
        var ids = [];
        var container = document.getElementById('class-tag-container');
        if (container) {
            container.querySelectorAll('[data-class-id]').forEach(function(tag) {
                ids.push(tag.dataset.classId);
            });
        }
        return ids;
    }

    function clearClassTags() {
        var container = document.getElementById('class-tag-container');
        if (container) {
            container.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem;padding:4px;">No classes assigned</span>';
        }
    }

    function populateClassTags(classIds) {
        clearClassTags();
        if (!classIds || classIds.length === 0) return;
        
        var classes = window.getClasses() || [];
        classIds.forEach(function(cid) {
            var cls = classes.find(function(c) { return String(c.id) === String(cid); });
            if (cls) {
                addClassTag(cls.id, cls.name);
            }
        });
    }

    // ============================================================
    // UI HELPERS
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

    function refreshUI(char) {
        safeRenderCharacterList();
        populateAcademicClassSelector(char);
        updateCurrentClassesDisplay(char);
        safeUpdateDashboardStats();
        if (char) {
            safeShowCharacterForm(char.id);
        }
    }

    // ============================================================
    // QUERY FUNCTIONS
    // ============================================================

    function getCharacterClasses(char) {
        if (!char || !char.classIds) return [];
        var classes = window.getClasses() || [];
        return classes.filter(function(c) {
            return char.classIds.some(function(cid) { return String(cid) === String(c.id); });
        });
    }

    function getCharacterClassNames(char) {
        var classes = getCharacterClasses(char);
        return classes.map(function(c) { return c.name; });
    }

    function getCharactersByClass(classId) {
        if (!classId) return [];
        var data = window.data || {};
        if (!data.characters) return [];
        return data.characters.filter(function(c) {
            return c.classIds && c.classIds.some(function(cid) { return String(cid) === String(classId); });
        });
    }

    function getAvailableStudentsForClass(classId, week) {
        if (!classId) return [];
        var weekNum = parseInt(week) || 1;
        var data = window.data || {};
        
        var classChars = getCharactersByClass(classId);
        
        var available = classChars.filter(function(char) {
            if (char.deceased) return false;
            
            var inTeam = false;
            if (data.teams) {
                for (var i = 0; i < data.teams.length; i++) {
                    var team = data.teams[i];
                    if (team.type !== 'academic') continue;
                    if (team.status === 'deleted') continue;
                    if (String(team.classId) !== String(classId)) continue;
                    
                    if (team.members) {
                        for (var j = 0; j < team.members.length; j++) {
                            var member = team.members[j];
                            if (String(member.characterId) === String(char.id)) {
                                var join = parseInt(member.joinPeriod);
                                var leave = parseInt(member.leavePeriod);
                                if (!isNaN(join) && join <= weekNum && (isNaN(leave) || leave >= weekNum)) {
                                    inTeam = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (inTeam) break;
                }
            }
            
            return !inTeam;
        });
        
        return available;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterClasses = {
        addToClass: addToClass,
        removeFromClass: removeFromClass,
        populateAcademicClassSelector: populateAcademicClassSelector,
        updateCurrentClassesDisplay: updateCurrentClassesDisplay,
        addClassTag: addClassTag,
        getClassTags: getClassTags,
        clearClassTags: clearClassTags,
        populateClassTags: populateClassTags,
        getCharacterClasses: getCharacterClasses,
        getCharacterClassNames: getCharacterClassNames,
        getCharactersByClass: getCharactersByClass,
        getAvailableStudentsForClass: getAvailableStudentsForClass,
        refreshUI: refreshUI
    };

})();
