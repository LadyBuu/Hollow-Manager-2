/**
 * js/modules/characters/character-classes.js - Character Classes
 * Handles adding/removing characters from classes
 * Path: js/modules/characters/character-classes.js
 * 
 * This module is responsible for:
 *   - Adding characters to classes (with VALIDATE → SNAPSHOT → MUTATE → SAVE → LOG → UI COMMIT)
 *   - Removing characters from classes (with VALIDATE → SNAPSHOT → MUTATE → SAVE → LOG → UI COMMIT)
 *   - Rendering class tags in the form
 *   - Populating class selectors
 *   - Querying character-class relationships
 * 
 * IMPORTANT: All mutations follow the correct pattern:
 *   VALIDATE → SNAPSHOT → MUTATE → SAVE → LOG (failure-safe) → UI COMMIT
 *   User-controlled text is inserted using safe DOM APIs/textContent
 *   rather than raw HTML, preventing XSS.
 *   Rollback is performed on save failure.
 *   Normalisation occurs AFTER snapshot, not before validation.
 *   USES CharacterQueries for character data and display names
 *   USES ClassesQueries for class data
 *   USES ClassesCore for class creation (NON-PERSISTING when used in transactions)
 *   USES MutationUtils for backup and persistence
 *   USES NotificationSystem for notifications
 *   USES ActivityLog for activity logging
 *   USES DomUtils for safe DOM operations
 * 
 * MUTATION CONTRACT:
 *   1. Validate inputs (no mutation)
 *   2. Create backup of current state (abort if fails)
 *   3. Normalise data structures (ONLY AFTER snapshot)
 *   4. Apply mutation
 *   5. Persist via saveWithPromise() (wrapped for safety)
 *   6. Log activity (failure-safe, no rollback)
 *   7. On persistence failure, restore backup and refresh UI
 * 
 * STATE SOURCE OF TRUTH:
 *   - Uses getCurrentEditId() for current character selection
 *   - Uses window.data for domain data
 *   - DOM is rendered from state, not the other way around
 *   - DOM is the source of unsaved form input only
 * 
 * DEPENDENCIES (ALL REQUIRED):
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.ClassesQueries (from classes-queries.js)
 *   - window.ClassesCore (from classes-core.js)
 *   - window.MutationUtils (from mutation-utils.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.ActivityLog (from activity-log.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.getCurrentEditId (from index.js)
 *   - window.setCurrentEditId (from index.js)
 *   - window.saveData (from database.js)
 *   - window.CALENDAR_CONSTANTS (from constants.js)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterClassesLoaded) {
        return;
    }
    window.__characterClassesLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var ClassesQueries = window.ClassesQueries;
    var ClassesCore = window.ClassesCore;
    var MutationUtils = window.MutationUtils;
    var NotificationSystem = window.NotificationSystem;
    var ActivityLog = window.ActivityLog;
    var DomUtils = window.DomUtils;
    var CalendarConstants = window.CALENDAR_CONSTANTS;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants ? CalendarConstants.MIN_WEEK : 1;
    var MAX_WEEK = CalendarConstants ? CalendarConstants.MAX_WEEK : 52;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // Required functions
        var required = [
            'getCurrentEditId',
            'setCurrentEditId',
            'saveData'
        ];

        required.forEach(function(name) {
            if (name === 'saveData' && typeof window.saveData !== 'function') {
                missing.push('saveData');
            } else if (typeof window[name] !== 'function') {
                missing.push(name);
            }
        });

        // CharacterQueries is MANDATORY
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        // ClassesQueries is MANDATORY
        if (!ClassesQueries || typeof ClassesQueries.getClass !== 'function') {
            missing.push('ClassesQueries.getClass');
        }
        if (!ClassesQueries || typeof ClassesQueries.getClasses !== 'function') {
            missing.push('ClassesQueries.getClasses');
        }
        if (!ClassesQueries || typeof ClassesQueries.getClassByName !== 'function') {
            missing.push('ClassesQueries.getClassByName');
        }

        // ClassesCore is MANDATORY (for class creation)
        if (!ClassesCore || typeof ClassesCore.createClass !== 'function') {
            missing.push('ClassesCore.createClass');
        }

        // MutationUtils is MANDATORY
        if (!MutationUtils || typeof MutationUtils.createSafeBackup !== 'function') {
            missing.push('MutationUtils.createSafeBackup');
        }
        if (!MutationUtils || typeof MutationUtils.saveWithPromise !== 'function') {
            missing.push('MutationUtils.saveWithPromise');
        }

        // NotificationSystem is MANDATORY
        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        // DomUtils is MANDATORY
        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        // ActivityLog is MANDATORY
        if (!ActivityLog || typeof ActivityLog.record !== 'function') {
            missing.push('ActivityLog.record');
        }

        if (missing.length > 0) {
            console.warn('CharacterClasses: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // NOTIFICATION - Uses NotificationSystem (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function escapeHtml(value) {
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
        }
        // Emergency fallback (should never be reached)
        if (value === undefined || value === null) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/`/g, '&#x60;');
    }

    // ============================================================
    // SAFE BACKUP - Delegates to MutationUtils
    // ============================================================

    function createSafeBackup(data) {
        return MutationUtils.createSafeBackup(data);
    }

    // ============================================================
    // STATE ACCESS - Single source of truth
    // ============================================================

    function getCurrentEditId() {
        return window.getCurrentEditId();
    }

    function setCurrentEditId(id) {
        window.setCurrentEditId(id);
    }

    // ============================================================
    // SAFE RENDER HELPERS
    // ============================================================

    function safeRenderCharacterList() {
        if (window.CharacterList && typeof window.CharacterList.render === 'function') {
            try { window.CharacterList.render(); } catch (e) { /* Ignore */ }
        }
    }

    function safeShowCharacterForm(id) {
        if (typeof window.showCharacterForm === 'function') {
            try { window.showCharacterForm(id); } catch (e) { /* Ignore */ }
        }
    }

    function safeUpdateDashboardStats() {
        if (typeof window.updateDashboardStats === 'function') {
            try { window.updateDashboardStats(); } catch (e) { /* Ignore */ }
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
    // NORMALISE CLASS IDS - Called AFTER snapshot
    // ============================================================

    function normaliseClassIds(char) {
        if (!char) return;
        if (!Array.isArray(char.classIds)) {
            char.classIds = [];
            return;
        }

        var seen = new Set();
        char.classIds = char.classIds.filter(function(id) {
            if (id === undefined || id === null || id === '') return false;
            var key = String(id);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    // ============================================================
    // GET NORMALISED CLASS IDS - Pure function for validation
    // ============================================================

    function getNormalisedClassIds(char) {
        if (!char) return [];
        if (!Array.isArray(char.classIds)) return [];

        var seen = new Set();
        return char.classIds.filter(function(id) {
            if (id === undefined || id === null || id === '') return false;
            var key = String(id);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    // ============================================================
    // CORE REMOVE FUNCTION - Single source of truth for removal
    // ============================================================

    function removeClassById(charId, classId) {
        if (!checkDependencies()) {
            showNotification('Dependencies not loaded. Please refresh the page.', 'error');
            return Promise.resolve(false);
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        var cls = ClassesQueries.getClass(classId);
        if (!cls) {
            showNotification('Class not found.', 'error');
            return Promise.resolve(false);
        }

        // Use pure function for validation - no mutation
        var classIds = getNormalisedClassIds(char);

        if (!classIds.some(function(cid) { return String(cid) === String(classId); })) {
            showNotification('Character is not in this class.', 'error');
            return Promise.resolve(false);
        }

        var name = CharacterQueries.getDisplayName(char);
        if (!confirm('Remove ' + name + ' from class "' + cls.name + '"?')) {
            return Promise.resolve(false);
        }

        // ---- PHASE 1: SNAPSHOT - Required, abort if fails ----
        var data = window.data || {};
        var backup = createSafeBackup(data);
        if (!backup) {
            showNotification('Unable to safely remove class. Please try again.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 2: NORMALISE and MUTATE (ONLY AFTER snapshot) ----
        var currentChar = data.characters.find(function(c) {
            return c && String(c.id) === String(charId);
        });

        if (!currentChar) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        normaliseClassIds(currentChar);
        currentChar.classIds = currentChar.classIds.filter(function(cid) {
            return String(cid) !== String(classId);
        });

        // ---- PHASE 3: PERSIST ----
        var savePromise = MutationUtils.saveWithPromise();

        return savePromise
            .then(function() {
                // ---- PHASE 4: LOG - failure-safe, persistence already succeeded ----
                try {
                    if (ActivityLog && typeof ActivityLog.record === 'function') {
                        ActivityLog.record('Removed ' + name + ' from class: ' + cls.name);
                    }
                } catch (logErr) {
                    // Ignore logging errors
                }

                // ---- PHASE 5: UI COMMIT ----
                var savedChar = CharacterQueries.getCharacterById(charId);
                safeRefreshUI(savedChar);
                showNotification('Character removed from class successfully!', 'success');
                return true;
            })
            .catch(function(err) {
                // ---- PHASE 6: ROLLBACK ----
                if (backup) {
                    window.data = backup;
                    var restoredChar = CharacterQueries.getCharacterById(charId);
                    safeRefreshUI(restoredChar);
                }
                showNotification('Failed to remove character from class. Please try again.', 'error');
                return false;
            });
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

        var charId = getCurrentEditId();
        if (!charId) {
            showNotification('No character selected.', 'error');
            return Promise.resolve(false);
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        var cls = ClassesQueries.getClass(classId);
        if (!cls) {
            showNotification('Class not found.', 'error');
            return Promise.resolve(false);
        }

        // Use pure function for validation - no mutation
        var classIds = getNormalisedClassIds(char);

        if (classIds.some(function(cid) { return String(cid) === String(classId); })) {
            showNotification('Character is already in this class.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 1: SNAPSHOT - Required, abort if fails ----
        var data = window.data || {};
        var backup = createSafeBackup(data);
        if (!backup) {
            showNotification('Unable to safely add class. Please try again.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 2: NORMALISE and MUTATE (ONLY AFTER snapshot) ----
        var currentChar = data.characters.find(function(c) {
            return c && String(c.id) === String(charId);
        });

        if (!currentChar) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        normaliseClassIds(currentChar);
        currentChar.classIds.push(classId);

        // ---- PHASE 3: PERSIST ----
        var savePromise = MutationUtils.saveWithPromise();

        return savePromise
            .then(function() {
                // ---- PHASE 4: LOG - failure-safe, persistence already succeeded ----
                var charName = CharacterQueries.getDisplayName(currentChar);
                try {
                    if (ActivityLog && typeof ActivityLog.record === 'function') {
                        ActivityLog.record('Added ' + charName + ' to class: ' + cls.name);
                    }
                } catch (logErr) {
                    // Ignore logging errors
                }

                // ---- PHASE 5: UI COMMIT ----
                var savedChar = CharacterQueries.getCharacterById(charId);
                safeRefreshUI(savedChar);
                showNotification('Character added to class successfully!', 'success');
                return true;
            })
            .catch(function(err) {
                // ---- PHASE 6: ROLLBACK ----
                if (backup) {
                    window.data = backup;
                    var restoredChar = CharacterQueries.getCharacterById(charId);
                    safeRefreshUI(restoredChar);
                }
                showNotification('Failed to add character to class. Please try again.', 'error');
                return false;
            });
    }

    // ============================================================
    // ADD CLASS BY NAME - Fixed: Validates BEFORE creating class
    // ============================================================

    function addClassByName(name) {
        if (!checkDependencies()) {
            showNotification('Dependencies not loaded. Please refresh the page.', 'error');
            return Promise.resolve(false);
        }

        var charId = getCurrentEditId();
        if (!charId) {
            showNotification('No character selected.', 'error');
            return Promise.resolve(false);
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        if (!name || typeof name !== 'string' || name.trim() === '') {
            showNotification('Please enter a class name.', 'error');
            return Promise.resolve(false);
        }

        var trimmedName = name.trim();

        // ---- PHASE 1: VALIDATE CHARACTER STATE (READ-ONLY, NO MUTATION) ----
        // Check if character is already in this class (using existing data)
        var existingClass = ClassesQueries.getClassByName(trimmedName);
        if (existingClass) {
            // Character is already in this class
            var currentClassIds = getNormalisedClassIds(char);
            if (currentClassIds.some(function(cid) { return String(cid) === String(existingClass.id); })) {
                showNotification('Character is already in this class.', 'error');
                return Promise.resolve(false);
            }
        }

        // ---- PHASE 2: SNAPSHOT (BEFORE CREATING CLASS) ----
        var data = window.data || {};
        var backup = createSafeBackup(data);
        if (!backup) {
            showNotification('Unable to safely add class. Please try again.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 3: FIND OR CREATE CLASS (NOW INSIDE THE TRANSACTION) ----
        var cls = existingClass;
        var classCreated = false;

        if (!cls) {
            // Use ClassesCore.createClass() - but we will NOT persist yet
            // This creates the class in the candidate state
            var result = ClassesCore.createClass(trimmedName);

            if (result && result.success) {
                cls = result.class || result.data;
                classCreated = true;

                // The class was added to data.classes, but we haven't persisted yet
                // We'll handle persistence in the main save
            } else {
                // Rollback: restore backup since we created a class but failed
                if (backup) {
                    window.data = backup;
                }
                showNotification(result ? result.message : 'Failed to create class.', 'error');
                return Promise.resolve(false);
            }
        }

        // ---- PHASE 4: RE-VALIDATE CHARACTER (CLASS NOW EXISTS) ----
        // Re-fetch character from the (potentially restored) data
        var currentChar = CharacterQueries.getCharacterById(charId);
        if (!currentChar) {
            // Rollback: class was created but character is gone
            if (classCreated && backup) {
                window.data = backup;
            }
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        var currentClassIds = getNormalisedClassIds(currentChar);
        if (currentClassIds.some(function(cid) { return String(cid) === String(cls.id); })) {
            // Class was created but character is already in it (shouldn't happen, but be safe)
            if (classCreated && backup) {
                // If we created the class and the character is somehow already in it,
                // we should rollback the class creation
                window.data = backup;
            }
            showNotification('Character is already in this class.', 'error');
            return Promise.resolve(false);
        }

        // ---- PHASE 5: MUTATE ----
        normaliseClassIds(currentChar);
        currentChar.classIds.push(cls.id);

        // ---- PHASE 6: PERSIST ----
        var savePromise = MutationUtils.saveWithPromise();

        return savePromise
            .then(function() {
                // ---- PHASE 7: LOG - failure-safe, persistence already succeeded ----
                var charName = CharacterQueries.getDisplayName(currentChar);
                try {
                    if (ActivityLog && typeof ActivityLog.record === 'function') {
                        ActivityLog.record('Added ' + charName + ' to class: ' + cls.name);
                    }
                } catch (logErr) {
                    // Ignore logging errors
                }

                // ---- PHASE 8: UI COMMIT ----
                addClassTag(cls.id, cls.name);
                var savedChar = CharacterQueries.getCharacterById(charId);
                safeRefreshUI(savedChar);
                showNotification('Character added to class successfully!', 'success');
                return true;
            })
            .catch(function(err) {
                // ---- PHASE 9: ROLLBACK - restore backup ----
                if (backup) {
                    window.data = backup;
                    var restoredChar = CharacterQueries.getCharacterById(charId);
                    safeRefreshUI(restoredChar);
                }
                showNotification('Failed to add character to class. Please try again.', 'error');
                return false;
            });
    }

    // ============================================================
    // REMOVE FROM CLASS - Selector-based, XSS-safe
    // ============================================================

    function removeFromClass() {
        if (!checkDependencies()) {
            showNotification('Dependencies not loaded. Please refresh the page.', 'error');
            return Promise.resolve(false);
        }

        var charId = getCurrentEditId();
        if (!charId) {
            showNotification('No character selected.', 'error');
            return Promise.resolve(false);
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            showNotification('Character not found.', 'error');
            return Promise.resolve(false);
        }

        // Use pure function for validation - no mutation
        var classIds = getNormalisedClassIds(char);

        if (classIds.length === 0) {
            showNotification('Character is not in any classes.', 'error');
            return Promise.resolve(false);
        }

        // Get currently assigned classes with display names
        var classes = ClassesQueries.getClasses();
        var assignedClasses = classIds.map(function(cid) {
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

        var body = document.createElement('div');
        body.className = 'modal-body';

        var info = document.createElement('p');
        info.style.cssText = 'color:var(--text-dim);font-size:0.85rem;margin-bottom:12px;';
        var charName = CharacterQueries.getDisplayName(char);
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
    // ADD CLASS TAG - IDEMPOTENT, XSS-SAFE, NO EVENT BINDING
    // ============================================================

    function addClassTag(classId, className) {
        var container = document.getElementById('class-tag-container');
        if (!container) return;

        var emptyMsg = container.querySelector('span[style*="text-dim"]');
        if (emptyMsg) emptyMsg.remove();

        var existing = Array.from(container.querySelectorAll('[data-class-id]')).find(function(tag) {
            return String(tag.dataset.classId) === String(classId);
        });
        if (existing) return;

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
        if (!container) return;

        container.textContent = '';
        var empty = document.createElement('span');
        empty.style.cssText = 'color:var(--text-dim);font-size:0.7rem;padding:4px;';
        empty.textContent = 'No classes assigned';
        container.appendChild(empty);
    }

    function populateClassTags(classIds) {
        clearClassTags();
        if (!classIds || classIds.length === 0) return;

        var classes = ClassesQueries.getClasses();
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

        var classes = ClassesQueries.getClasses();

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

        var classes = ClassesQueries.getClasses();
        var names = [];
        classIds.forEach(function(cid) {
            var cls = classes.find(function(c) { return String(c.id) === String(cid); });
            if (cls) names.push(cls.name);
        });
        display.textContent = names.length > 0 ? names.join(', ') : 'None';
    }

    // ============================================================
    // QUERY FUNCTIONS - Delegates to ClassesQueries
    // ============================================================

    function getCharacterClasses(char) {
        return ClassesQueries.getCharacterClasses(char);
    }

    function getCharacterClassNames(char) {
        return ClassesQueries.getCharacterClassNames(char);
    }

    function getCharactersByClass(classId) {
        return ClassesQueries.getCharactersByClass(classId);
    }

    function getAvailableStudentsForClass(classId, week) {
        return ClassesQueries.getAvailableStudentsForClass(classId, week);
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

        // Queries (delegated to ClassesQueries)
        getCharacterClasses: getCharacterClasses,
        getCharacterClassNames: getCharacterClassNames,
        getCharactersByClass: getCharactersByClass,
        getAvailableStudentsForClass: getAvailableStudentsForClass,

        // UI Refresh
        refreshUI: safeRefreshUI,

        // State access (delegated to index)
        getCurrentEditId: function() {
            return getCurrentEditId();
        },
        setCurrentEditId: function(id) {
            return setCurrentEditId(id);
        }
    };

})();
