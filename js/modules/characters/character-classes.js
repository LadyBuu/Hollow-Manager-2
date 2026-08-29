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
 *   SNAPSHOT → VALIDATE → MUTATE → LOG → SAVE
 *   User-controlled text is inserted using safe DOM APIs/textContent
 *   rather than raw HTML, preventing XSS.
 *   Rollback is performed on save failure.
 *   Normalisation occurs AFTER backup, not before.
 * 
 * MUTATION CONTRACT:
 *   1. Create backup of current state
 *   2. Validate inputs
 *   3. Normalise data structures
 *   4. Apply mutation
 *   5. Log activity
 *   6. Persist via saveData()
 *   7. On failure, restore backup and refresh UI
 * 
 * STATE SOURCE OF TRUTH:
 *   - Uses getCurrentEditId() for current character selection
 *   - Uses window.data for domain data
 *   - DOM is rendered from state, not the other way around
 *   - DOM is the source of unsaved form input only
 * 
 * DEPENDENCIES:
 *   - window.getCurrentEditId (from index.js)
 *   - window.setCurrentEditId (from index.js)
 *   - window.getCharacterById (from core-utils.js)
 *   - window.getDisplayName (from core-utils.js)
 *   - window.getClasses (from core-utils.js)
 *   - window.getClass (from core-utils.js)
 *   - window.getClassByName (from core-utils.js)
 *   - window.createClass (from core-utils.js)
 *   - window.saveData (from database.js)
 *   - window.logActivity (from core-utils.js)
 *   - window.db.createSafeCopy (from database.js)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterClassesLoaded) {
        return;
    }
    window.__characterClassesLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var VALID_CLASS_TYPES = ['academic'];

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var required = [
            'getCurrentEditId',
            'setCurrentEditId',
            'getCharacterById',
            'getDisplayName',
            'getClasses',
            'getClass',
            'getClassByName',
            'createClass',
            'saveData',
            'logActivity'
        ];

        var missing = [];
        required.forEach(function(name) {
            if (name === 'saveData' && typeof window.saveData !== 'function') {
                missing.push('saveData');
            } else if (name === 'logActivity' && typeof window.logActivity !== 'function') {
                missing.push('logActivity');
            } else if (typeof window[name] !== 'function' && 
                       name !== 'saveData' && 
                       name !== 'logActivity') {
                missing.push(name);
            }
        });

        if (missing.length > 0) {
            console.warn('CharacterClasses: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // SAFE BACKUP - Using database module's clone
    // ============================================================

    function createSafeBackup(data) {
        try {
            if (window.db && typeof window.db.createSafeCopy === 'function') {
                return window.db.createSafeCopy(data);
            }
            if (typeof structuredClone === 'function') {
                return structuredClone(data);
            }
            // Fallback - may fail for complex objects but better than nothing
            try {
                return JSON.parse(JSON.stringify(data));
            } catch (e) {
                console.warn('CharacterClasses: Failed to create backup:', e);
                return null;
            }
        } catch (err) {
            console.warn('CharacterClasses: Failed to create backup:', err);
            return null;
        }
    }

    // ============================================================
    // HTML ESCAPING - Prevents XSS
    // ============================================================

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // NOTIFICATION
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

        // Ultimate fallback - only use alert for errors
        if (type === 'error') {
            alert('Error: ' + message);
        } else {
            alert(message);
        }
    }

    // ============================================================
    // NORMALISE CLASS IDS - Defensive, should be called after backup
    // ============================================================

    function normaliseClassIds(char) {
        if (!char) return;
        if (!Array.isArray(char.classIds)) {
            char.classIds = [];
        }
        // Remove duplicates and null/undefined values
        var seen = {};
        char.classIds = char.classIds.filter(function(id) {
            if (id === undefined || id === null || id === '') return false;
            var key = String(id);
            if (seen[key]) return false;
            seen[key] = true;
            return true;
        });
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

    function safeRefreshUI(char) {
        safeRenderCharacterList();
        populateAcademicClassSelector(char);
        updateCurrentClassesDisplay(char);
        safeUpdateDashboardStats();
        if (char) {
            safeShowCharacterForm(char.id);
        }
    }

    // ============================================================
    // CORE REMOVE FUNCTION - Single source of truth for removal
    // ============================================================

    function removeClassById(charId, classId) {
        if (!checkDependencies()) {
            showNotification('Dependencies not loaded. Please refresh the page.', 'error');
            return Promise.resolve(false);
        }

        var char = typeof window.getCharacterById === 'function' ? window.getCharacterById(charId) : null;
        if (!char) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        // Normalise AFTER we have the character, but BEFORE backup
        // Actually, we need to backup first, THEN normalise if needed
        var data = window.data || {};
        var backup = createSafeBackup(data);

        // Now normalise (this mutates, but we have backup)
        normaliseClassIds(char);

        var cls = typeof window.getClass === 'function' ? window.getClass(classId) : null;
        if (!cls) {
            showNotification('Class not found.', 'error');
            return Promise.resolve(false);
        }

        if (!char.classIds.some(function(cid) { return String(cid) === String(classId); })) {
            showNotification('Character is not in this class.', 'error');
            return Promise.resolve(false);
        }

        // Centralised confirmation
        var name = typeof window.getDisplayName === 'function' ? window.getDisplayName(char) : char.firstName || 'Character';
        if (!confirm('Remove ' + name + ' from class "' + cls.name + '"?')) {
            return Promise.resolve(false);
        }

        // 1. MUTATE
        char.classIds = char.classIds.filter(function(cid) {
            return String(cid) !== String(classId);
        });

        // 2. LOG
        if (typeof window.logActivity === 'function') {
            window.logActivity('Removed ' + name + ' from class: ' + cls.name);
        }

        // 3. SAVE
        if (typeof window.saveData === 'function') {
            return window.saveData()
                .then(function() {
                    var savedChar = typeof window.getCharacterById === 'function' 
                        ? window.getCharacterById(charId) 
                        : null;
                    safeRefreshUI(savedChar);
                    showNotification('Character removed from class successfully!', 'success');
                    return true;
                })
                .catch(function(err) {
                    console.error('Failed to remove character from class:', err);
                    if (backup) {
                        window.data = backup;
                        safeRenderCharacterList();
                        if (typeof window.setCurrentEditId === 'function') {
                            window.setCurrentEditId(charId);
                        }
                        safeShowCharacterForm(charId);
                    }
                    showNotification('Failed to remove character from class. Please try again.', 'error');
                    return false;
                });
        } else {
            safeRefreshUI(char);
            showNotification('Character removed from class successfully!', 'success');
            return Promise.resolve(true);
        }
    }

    // ============================================================
    // ADD TO CLASS
    // ============================================================

    function addToClass() {
        if (!checkDependencies()) {
            showNotification('Dependencies not loaded. Please refresh the page.', 'error');
            return Promise.resolve(false);
        }

        var select = document.getElementById('academic-class-select');
        if (!select) {
            showNotification('Class selector not found. Please refresh the page.', 'error');
            return Promise.resolve(false);
        }

        var classId = select.value;
        if (!classId) {
            showNotification('Please select a class.', 'error');
            return Promise.resolve(false);
        }

        var charId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
        if (!charId) {
            showNotification('No character selected.', 'error');
            return Promise.resolve(false);
        }

        var char = typeof window.getCharacterById === 'function' ? window.getCharacterById(charId) : null;
        if (!char) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        // Backup BEFORE normalisation
        var data = window.data || {};
        var backup = createSafeBackup(data);

        // Now normalise
        normaliseClassIds(char);

        var cls = typeof window.getClass === 'function' ? window.getClass(classId) : null;
        if (!cls) {
            showNotification('Class not found.', 'error');
            return Promise.resolve(false);
        }

        // Check if already in class
        if (char.classIds.some(function(cid) { return String(cid) === String(classId); })) {
            showNotification('Character is already in this class.', 'error');
            return Promise.resolve(false);
        }

        // 1. MUTATE
        char.classIds.push(classId);

        // 2. LOG
        var name = typeof window.getDisplayName === 'function' ? window.getDisplayName(char) : char.firstName || 'Character';
        if (typeof window.logActivity === 'function') {
            window.logActivity('Added ' + name + ' to class: ' + cls.name);
        }

        // 3. SAVE
        if (typeof window.saveData === 'function') {
            return window.saveData()
                .then(function() {
                    var savedChar = typeof window.getCharacterById === 'function' 
                        ? window.getCharacterById(charId) 
                        : null;
                    safeRefreshUI(savedChar);
                    showNotification('Character added to class successfully!', 'success');
                    return true;
                })
                .catch(function(err) {
                    console.error('Failed to add character to class:', err);
                    if (backup) {
                        window.data = backup;
                        safeRenderCharacterList();
                        if (typeof window.setCurrentEditId === 'function') {
                            window.setCurrentEditId(charId);
                        }
                        safeShowCharacterForm(charId);
                    }
                    showNotification('Failed to add character to class. Please try again.', 'error');
                    return false;
                });
        } else {
            safeRefreshUI(char);
            showNotification('Character added to class successfully!', 'success');
            return Promise.resolve(true);
        }
    }

    // ============================================================
    // ADD CLASS BY NAME - Convenience function
    // ============================================================

    function addClassByName(name) {
        if (!checkDependencies()) {
            showNotification('Dependencies not loaded. Please refresh the page.', 'error');
            return;
        }

        var charId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
        if (!charId) {
            showNotification('No character selected.', 'error');
            return;
        }

        var char = typeof window.getCharacterById === 'function' ? window.getCharacterById(charId) : null;
        if (!char) {
            showNotification('Character not found.', 'error');
            return;
        }

        if (!name || typeof name !== 'string' || name.trim() === '') {
            showNotification('Please enter a class name.', 'error');
            return;
        }

        var trimmedName = name.trim();

        // Find or create class
        var cls = typeof window.getClassByName === 'function' ? window.getClassByName(trimmedName) : null;
        if (!cls) {
            var result = typeof window.createClass === 'function' ? window.createClass(trimmedName) : null;
            if (result && result.success) {
                cls = result.class;
            } else {
                showNotification(result ? result.message : 'Failed to create class.', 'error');
                return;
            }
        }

        // Check if already assigned
        var container = document.getElementById('class-tag-container');
        if (container) {
            var existing = container.querySelector('[data-class-id="' + cls.id + '"]');
            if (existing) {
                showNotification('This class is already assigned.', 'error');
                return;
            }
        }

        // Add the class tag
        addClassTag(cls.id, cls.name);
    }

    // ============================================================
    // REMOVE FROM CLASS - Selector-based, XSS-safe
    // ============================================================

    function removeFromClass() {
        if (!checkDependencies()) {
            showNotification('Dependencies not loaded. Please refresh the page.', 'error');
            return Promise.resolve(false);
        }

        var charId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
        if (!charId) {
            showNotification('No character selected.', 'error');
            return Promise.resolve(false);
        }

        var char = typeof window.getCharacterById === 'function' ? window.getCharacterById(charId) : null;
        if (!char) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        normaliseClassIds(char);

        if (char.classIds.length === 0) {
            showNotification('Character is not in any classes.', 'error');
            return Promise.resolve(false);
        }

        // Get currently assigned classes with display names
        var classes = typeof window.getClasses === 'function' ? window.getClasses() : [];
        var assignedClasses = char.classIds.map(function(cid) {
            var cls = classes.find(function(c) { return String(c.id) === String(cid); });
            return cls ? { id: cls.id, name: cls.name } : null;
        }).filter(function(c) { return c; });

        if (assignedClasses.length === 0) {
            showNotification('Character is not in any valid classes.', 'error');
            return Promise.resolve(false);
        }

        // Build selector UI - XSS-safe with DOM APIs
        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex';

        // Create header
        var header = document.createElement('div');
        header.className = 'modal-header';

        var title = document.createElement('h3');
        title.textContent = 'Remove from Class';
        header.appendChild(title);

        var closeBtn = document.createElement('button');
        closeBtn.className = 'close-modal';
        closeBtn.id = 'remove-class-close';
        closeBtn.textContent = '×';
        header.appendChild(closeBtn);

        // Create body
        var body = document.createElement('div');
        body.className = 'modal-body';

        var info = document.createElement('p');
        info.style.cssText = 'color:var(--text-dim);font-size:0.85rem;margin-bottom:12px;';
        var charName = typeof window.getDisplayName === 'function' ? window.getDisplayName(char) : char.firstName || 'Character';
        info.textContent = 'Select a class to remove ' + charName + ' from:';
        body.appendChild(info);

        var formGroup = document.createElement('div');
        formGroup.className = 'form-group';

        var select = document.createElement('select');
        select.id = 'remove-class-select';
        select.style.cssText = 'width:100%;padding:8px;';

        assignedClasses.forEach(function(c) {
            var option = document.createElement('option');
            option.value = c.id;
            option.textContent = c.name;
            select.appendChild(option);
        });

        formGroup.appendChild(select);
        body.appendChild(formGroup);

        var actions = document.createElement('div');
        actions.className = 'form-actions';

        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.id = 'remove-class-cancel';
        cancelBtn.className = 'secondary';
        cancelBtn.textContent = 'Cancel';
        actions.appendChild(cancelBtn);

        var confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.id = 'remove-class-confirm';
        confirmBtn.className = 'danger';
        confirmBtn.textContent = 'Remove';
        actions.appendChild(confirmBtn);

        body.appendChild(actions);

        // Assemble modal
        var content = document.createElement('div');
        content.className = 'modal-content small';
        content.appendChild(header);
        content.appendChild(body);
        modal.appendChild(content);

        document.body.appendChild(modal);

        return new Promise(function(resolve) {
            function cleanup() {
                if (modal.parentNode) modal.remove();
            }

            closeBtn.onclick = function() {
                cleanup();
                resolve(false);
            };

            cancelBtn.onclick = function() {
                cleanup();
                resolve(false);
            };

            modal.addEventListener('click', function(e) {
                if (e.target === modal) {
                    cleanup();
                    resolve(false);
                }
            });

            confirmBtn.onclick = function() {
                var selectEl = document.getElementById('remove-class-select');
                var selectedId = selectEl ? selectEl.value : null;
                cleanup();

                if (selectedId) {
                    removeClassById(charId, selectedId)
                        .then(resolve)
                        .catch(function() { resolve(false); });
                } else {
                    resolve(false);
                }
            };
        });
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

        // Check if tag already exists (idempotent) - safe selector
        var existing = Array.from(container.querySelectorAll('[data-class-id]')).find(function(tag) {
            return String(tag.dataset.classId) === String(classId);
        });
        if (existing) return;

        // Build DOM elements safely - no innerHTML for user data
        var tag = document.createElement('span');
        tag.style.cssText = 'background:var(--accent-soft);padding:2px 8px;border-radius:10px;font-size:0.7rem;border:1px solid var(--accent);display:inline-flex;align-items:center;gap:4px;';
        tag.dataset.classId = classId;

        var nameSpan = document.createElement('span');
        nameSpan.textContent = className;

        var button = document.createElement('button');
        button.className = 'remove-class-tag';
        button.dataset.id = classId;
        button.textContent = '✕';
        button.style.cssText = 'background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.5rem;padding:0 2px;';
        button.setAttribute('aria-label', 'Remove class ' + className);

        tag.appendChild(nameSpan);
        tag.appendChild(button);
        container.appendChild(tag);

        // removeClassById handles confirmation internally
        button.addEventListener('click', function() {
            var charId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
            var classId = this.dataset.id;

            if (!charId) {
                showNotification('No character selected.', 'error');
                return;
            }

            if (!classId) {
                showNotification('Class not found.', 'error');
                return;
            }

            removeClassById(charId, classId);
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

        var classes = typeof window.getClasses === 'function' ? window.getClasses() : [];
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

        var classes = typeof window.getClasses === 'function' ? window.getClasses() : [];

        // Reset select - this is an "add class" selector
        select.innerHTML = '<option value="">Select a class...</option>';

        var existingClassIds = (char && Array.isArray(char.classIds)) ? char.classIds : [];

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

        // Always reset to empty - current value may no longer be valid
        select.value = '';
    }

    function updateCurrentClassesDisplay(char) {
        var display = document.getElementById('current-classes-list');
        if (!display) return;

        var classIds = (char && Array.isArray(char.classIds)) ? char.classIds : [];
        if (classIds.length === 0) {
            display.textContent = 'None';
            return;
        }

        var classes = typeof window.getClasses === 'function' ? window.getClasses() : [];
        var names = [];
        classIds.forEach(function(cid) {
            var cls = classes.find(function(c) { return String(c.id) === String(cid); });
            if (cls) names.push(cls.name);
        });
        display.textContent = names.length > 0 ? names.join(', ') : 'None';
    }

    // ============================================================
    // QUERY FUNCTIONS
    // ============================================================

    function getCharacterClasses(char) {
        if (!char) return [];
        var classIds = Array.isArray(char.classIds) ? char.classIds : [];
        if (classIds.length === 0) return [];

        var classes = typeof window.getClasses === 'function' ? window.getClasses() : [];
        return classes.filter(function(c) {
            return classIds.some(function(cid) { return String(cid) === String(c.id); });
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
            var classIds = Array.isArray(c.classIds) ? c.classIds : [];
            return classIds.some(function(cid) { return String(cid) === String(classId); });
        });
    }

    function getAvailableStudentsForClass(classId, week) {
        if (!classId) return [];
        var weekNum = Number(week);
        if (!Number.isInteger(weekNum) || weekNum < 1) {
            return [];
        }

        var data = window.data || {};
        var classChars = getCharactersByClass(classId);

        var available = classChars.filter(function(char) {
            // Check elimination status using the authoritative elimination module
            if (
                window.CharacterEliminations &&
                typeof window.CharacterEliminations.isCharacterEliminatedByWeek === 'function' &&
                window.CharacterEliminations.isCharacterEliminatedByWeek(char, weekNum)
            ) {
                return false;
            }

            // Check if already in a team
            if (data.teams && Array.isArray(data.teams)) {
                for (var i = 0; i < data.teams.length; i++) {
                    var team = data.teams[i];
                    if (!team || typeof team !== 'object') continue;
                    if (team.type !== 'academic') continue;
                    if (team.status === 'deleted' || team.status === 'inactive' || team.status === 'deprecated') continue;
                    if (String(team.classId) !== String(classId)) continue;

                    if (team.members && Array.isArray(team.members)) {
                        for (var j = 0; j < team.members.length; j++) {
                            var member = team.members[j];
                            if (!member || typeof member !== 'object') continue;
                            if (String(member.characterId) === String(char.id)) {
                                var join = parseInt(member.joinPeriod);
                                var leave = parseInt(member.leavePeriod);
                                // If join is invalid, treat as not active (available)
                                if (isNaN(join)) continue;
                                if (join <= weekNum && (isNaN(leave) || leave >= weekNum)) {
                                    return false;
                                }
                            }
                        }
                    }
                }
            }

            return true;
        });

        return available;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterClasses = {
        // Mutations
        addToClass: addToClass,
        removeFromClass: removeFromClass,
        removeClassById: removeClassById,
        addClassByName: addClassByName,

        // Rendering
        populateAcademicClassSelector: populateAcademicClassSelector,
        updateCurrentClassesDisplay: updateCurrentClassesDisplay,
        addClassTag: addClassTag,
        getClassTags: getClassTags,
        clearClassTags: clearClassTags,
        populateClassTags: populateClassTags,

        // Queries
        getCharacterClasses: getCharacterClasses,
        getCharacterClassNames: getCharacterClassNames,
        getCharactersByClass: getCharactersByClass,
        getAvailableStudentsForClass: getAvailableStudentsForClass,

        // UI Refresh
        refreshUI: safeRefreshUI,

        // State access (delegated to index)
        getCurrentEditId: getCurrentEditId,
        setCurrentEditId: setCurrentEditId
    };

})();
