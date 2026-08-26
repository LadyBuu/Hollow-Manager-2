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
 *   User-controlled text is inserted using safe DOM APIs/textContent
 *   rather than raw HTML, preventing XSS.
 *   Rollback is performed on save failure.
 * 
 * STATE SOURCE OF TRUTH:
 *   - Uses AppState for current edit ID via getState('characters', 'formEditId')
 *   - Uses window.data for domain data
 *   - DOM is rendered from state, not the other way around
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterClassesLoaded) {
        return;
    }
    window.__characterClassesLoaded = true;

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
    // SAFE CLONE - Use database module's clone
    // ============================================================

    function createSafeBackup(data) {
        try {
            if (window.db && typeof window.db.createSafeCopy === 'function') {
                return window.db.createSafeCopy(data);
            }
            if (typeof structuredClone === 'function') {
                return structuredClone(data);
            }
            return null;
        } catch (err) {
            return null;
        }
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

        alert(type === 'error' ? 'Error: ' + message : message);
    }

    // ============================================================
    // NORMALISE CLASS IDS - Defensive
    // ============================================================

    function normaliseClassIds(char) {
        if (!char) return;
        if (!Array.isArray(char.classIds)) {
            char.classIds = [];
        }
    }

    // ============================================================
    // CORE REMOVE FUNCTION - Single source of truth for removal
    // ============================================================

    function removeClassById(charId, classId) {
        var char = window.getCharacterById(charId);
        if (!char) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        normaliseClassIds(char);

        var cls = window.getClass(classId);
        if (!cls) {
            showNotification('Class not found.', 'error');
            return Promise.resolve(false);
        }

        if (!char.classIds.some(function(cid) { return String(cid) === String(classId); })) {
            showNotification('Character is not in this class.', 'error');
            return Promise.resolve(false);
        }

        // Centralised confirmation
        var name = window.getDisplayName(char);
        if (!confirm('Remove ' + name + ' from class "' + cls.name + '"?')) {
            return Promise.resolve(false);
        }

        var data = window.data || {};
        var backup = createSafeBackup(data);

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
                    var savedChar = window.getCharacterById(charId);
                    refreshUI(savedChar);
                    showNotification('Character removed from class successfully!', 'success');
                    return true;
                })
                .catch(function(err) {
                    console.error('Failed to remove character from class:', err);
                    if (backup) {
                        window.data = backup;
                        safeRenderCharacterList();
                        setCurrentEditId(charId);
                        safeShowCharacterForm(charId);
                    }
                    showNotification('Failed to remove character from class. Please try again.', 'error');
                    return false;
                });
        } else {
            refreshUI(char);
            showNotification('Character removed from class successfully!', 'success');
            return Promise.resolve(true);
        }
    }

    // ============================================================
    // ADD TO CLASS
    // ============================================================

    function addToClass() {
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

        var charId = getCurrentEditId();
        if (!charId) {
            showNotification('No character selected.', 'error');
            return Promise.resolve(false);
        }

        var char = window.getCharacterById(charId);
        if (!char) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        normaliseClassIds(char);

        var cls = window.getClass(classId);
        if (!cls) {
            showNotification('Class not found.', 'error');
            return Promise.resolve(false);
        }

        // Check if already in class
        if (char.classIds.some(function(cid) { return String(cid) === String(classId); })) {
            showNotification('Character is already in this class.', 'error');
            return Promise.resolve(false);
        }

        var data = window.data || {};
        var backup = createSafeBackup(data);

        // 1. MUTATE
        char.classIds.push(classId);

        // 2. LOG
        var name = window.getDisplayName(char);
        if (typeof window.logActivity === 'function') {
            window.logActivity('Added ' + name + ' to class: ' + cls.name);
        }

        // 3. SAVE
        if (typeof window.saveData === 'function') {
            return window.saveData()
                .then(function() {
                    var savedChar = window.getCharacterById(charId);
                    refreshUI(savedChar);
                    showNotification('Character added to class successfully!', 'success');
                    return true;
                })
                .catch(function(err) {
                    console.error('Failed to add character to class:', err);
                    if (backup) {
                        window.data = backup;
                        safeRenderCharacterList();
                        setCurrentEditId(charId);
                        safeShowCharacterForm(charId);
                    }
                    showNotification('Failed to add character to class. Please try again.', 'error');
                    return false;
                });
        } else {
            refreshUI(char);
            showNotification('Character added to class successfully!', 'success');
            return Promise.resolve(true);
        }
    }

    // ============================================================
    // REMOVE FROM CLASS - Selector-based
    // ============================================================

    function removeFromClass() {
        var charId = getCurrentEditId();
        if (!charId) {
            showNotification('No character selected.', 'error');
            return Promise.resolve(false);
        }

        var char = window.getCharacterById(charId);
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
        var classes = window.getClasses() || [];
        var assignedClasses = char.classIds.map(function(cid) {
            var cls = classes.find(function(c) { return String(c.id) === String(cid); });
            return cls ? { id: cls.id, name: cls.name } : null;
        }).filter(function(c) { return c; });

        if (assignedClasses.length === 0) {
            showNotification('Character is not in any valid classes.', 'error');
            return Promise.resolve(false);
        }

        // Build selector UI
        var modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex';

        var optionsHtml = assignedClasses.map(function(c) {
            return '<option value="' + c.id + '">' + c.name + '</option>';
        }).join('');

        modal.innerHTML = `
            <div class="modal-content small">
                <div class="modal-header">
                    <h3>Remove from Class</h3>
                    <button class="close-modal" id="remove-class-close">&times;</button>
                </div>
                <div class="modal-body">
                    <p style="color:var(--text-dim);font-size:0.85rem;margin-bottom:12px;">
                        Select a class to remove <strong>${window.getDisplayName(char)}</strong> from:
                    </p>
                    <div class="form-group">
                        <select id="remove-class-select" style="width:100%;padding:8px;">
                            ${optionsHtml}
                        </select>
                    </div>
                    <div class="form-actions">
                        <button type="button" id="remove-class-cancel" class="secondary">Cancel</button>
                        <button type="button" id="remove-class-confirm" class="danger">Remove</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        return new Promise(function(resolve) {
            function cleanup() {
                if (modal.parentNode) modal.remove();
            }

            modal.querySelector('#remove-class-close').onclick = function() {
                cleanup();
                resolve(false);
            };

            modal.querySelector('#remove-class-cancel').onclick = function() {
                cleanup();
                resolve(false);
            };

            modal.addEventListener('click', function(e) {
                if (e.target === modal) {
                    cleanup();
                    resolve(false);
                }
            });

            modal.querySelector('#remove-class-confirm').onclick = function() {
                var select = document.getElementById('remove-class-select');
                var selectedId = select.value;
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
            var charId = getCurrentEditId();
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
        if (!char) return [];
        var classIds = Array.isArray(char.classIds) ? char.classIds : [];
        if (classIds.length === 0) return [];

        var classes = window.getClasses() || [];
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
            if (data.teams) {
                for (var i = 0; i < data.teams.length; i++) {
                    var team = data.teams[i];
                    if (team.type !== 'academic') continue;
                    if (team.status === 'deleted' || team.status === 'inactive' || team.status === 'deprecated') continue;
                    if (String(team.classId) !== String(classId)) continue;

                    if (team.members) {
                        for (var j = 0; j < team.members.length; j++) {
                            var member = team.members[j];
                            if (String(member.characterId) === String(char.id)) {
                                var join = parseInt(member.joinPeriod);
                                var leave = parseInt(member.leavePeriod);
                                if (!isNaN(join) && join <= weekNum && (isNaN(leave) || leave >= weekNum)) {
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
        addToClass: addToClass,
        removeFromClass: removeFromClass,
        removeClassById: removeClassById,
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
        refreshUI: refreshUI,
        getCurrentEditId: getCurrentEditId,
        setCurrentEditId: setCurrentEditId
    };

})();
