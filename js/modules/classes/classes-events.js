/**
 * modules/classes/classes-events.js - Classes Events
 * Event binding for the classes module
 * Path: js/modules/classes/classes-events.js
 * 
 * This module is responsible for:
 *   - Binding UI events for the classes module
 *   - Delegating actions to ClassesCore for mutations
 *   - Delegating rendering to ClassesView for UI updates
 * 
 * IMPORTANT:
 *   - This module handles EVENTS only - no rendering logic
 *   - All mutations delegate to ClassesCore
 *   - All rendering delegates to ClassesView
 *   - No direct DOM manipulation except event binding
 *   - No direct data mutation
 * 
 * DEPENDENCIES:
 *   - window.ClassesCore (from classes-core.js)
 *   - window.ClassesView (from classes-view.js)
 *   - window.DomUtils (from dom-utils.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__classesEventsLoaded) {
        return;
    }
    window.__classesEventsLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!window.ClassesCore) {
            missing.push('ClassesCore');
        }

        if (!window.ClassesView || typeof window.ClassesView.renderClassesView !== 'function') {
            missing.push('ClassesView.renderClassesView');
        }

        if (missing.length > 0) {
            console.warn('ClassesEvents: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // NOTIFICATION
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';

        if (window.NotificationSystem && typeof window.NotificationSystem.notify === 'function') {
            window.NotificationSystem.notify(message, type);
            return;
        }

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
    // PERSISTENCE HELPERS
    // ============================================================

    function saveAndRefresh(container) {
        if (typeof window.saveData === 'function') {
            return window.saveData()
                .then(function() {
                    if (window.ClassesView && typeof window.ClassesView.renderClassesView === 'function') {
                        window.ClassesView.renderClassesView(container);
                    }
                })
                .catch(function(err) {
                    console.warn('ClassesEvents: Persistence failed:', err);
                });
        }
        return Promise.resolve();
    }

    function refreshUI(container) {
        if (window.ClassesView && typeof window.ClassesView.renderClassesView === 'function') {
            window.ClassesView.renderClassesView(container);
        }
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    /**
     * Handle adding a new class (open modal).
     */
    function handleAddClass(container) {
        var modal = document.getElementById('class-form-modal');
        var title = document.getElementById('class-form-title');
        var nameInput = document.getElementById('class-name');
        var form = document.getElementById('class-form-inner');

        if (!modal || !title || !nameInput || !form) {
            showNotification('Form elements not found. Please refresh.', 'error');
            return;
        }

        modal.classList.remove('hidden');
        modal.style.display = 'flex';

        title.textContent = 'Add Class';
        nameInput.value = '';
        delete form.dataset.editId;

        nameInput.focus();
    }

    /**
     * Handle editing a class (open modal with existing data).
     */
    function handleEditClass(container, classId) {
        if (!classId) {
            showNotification('Class ID is required.', 'error');
            return;
        }

        var modal = document.getElementById('class-form-modal');
        var title = document.getElementById('class-form-title');
        var nameInput = document.getElementById('class-name');
        var form = document.getElementById('class-form-inner');

        if (!modal || !title || !nameInput || !form) {
            showNotification('Form elements not found. Please refresh.', 'error');
            return;
        }

        var cls = window.ClassesCore.getGraduatingClass(classId);
        if (!cls) {
            showNotification('Class not found.', 'error');
            return;
        }

        modal.classList.remove('hidden');
        modal.style.display = 'flex';

        title.textContent = 'Edit Class';
        nameInput.value = cls.name;
        form.dataset.editId = classId;

        nameInput.focus();
    }

    /**
     * Handle saving a class (create or update).
     */
    function handleSaveClass(container, e) {
        e.preventDefault();

        var form = e.target;
        var editId = form.dataset.editId;
        var nameInput = document.getElementById('class-name');
        if (!nameInput) {
            showNotification('Form not found. Please refresh.', 'error');
            return;
        }

        var name = nameInput.value.trim();

        if (!name) {
            showNotification('Class name is required.', 'error');
            return;
        }

        var result;
        if (editId) {
            result = window.ClassesCore.updateGraduatingClass(editId, name);
        } else {
            result = window.ClassesCore.createGraduatingClass(name);
        }

        if (!result || !result.success) {
            showNotification(result && result.message ? result.message : 'Failed to save class.', 'error');
            return;
        }

        var modal = document.getElementById('class-form-modal');
        if (modal) {
            modal.classList.add('hidden');
            modal.style.display = 'none';
        }

        saveAndRefresh(container)
            .then(function() {
                showNotification(editId ? 'Class updated successfully!' : 'Class created successfully!', 'success');
            });
    }

    /**
     * Handle deleting a class.
     */
    function handleDeleteClass(container, classId) {
        if (!classId) {
            showNotification('Class ID is required.', 'error');
            return;
        }

        var cls = window.ClassesCore.getGraduatingClass(classId);
        if (!cls) {
            showNotification('Class not found.', 'error');
            return;
        }

        var trainees = window.ClassesCore.getCharactersByGraduatingClass(classId);
        var instructors = window.ClassesCore.getInstructorsByGraduatingClass(classId);
        var totalMembers = trainees.length + instructors.length;

        var message = 'Delete "' + cls.name + '" permanently?';
        if (totalMembers > 0) {
            message += '\n\nThis class has ' + totalMembers + ' members (' + trainees.length + ' trainees, ' + instructors.length + ' instructors).';
            message += '\nAll members will be unassigned from this class.';
        }
        message += '\n\nThis action cannot be undone.';

        if (!confirm(message)) {
            return;
        }

        var result = window.ClassesCore.deleteGraduatingClass(classId);
        if (!result || !result.success) {
            showNotification(result && result.message ? result.message : 'Failed to delete class.', 'error');
            return;
        }

        saveAndRefresh(container)
            .then(function() {
                if (window.ClassesView && typeof window.ClassesView.clearSelection === 'function') {
                    window.ClassesView.clearSelection();
                }
                showNotification('Class deleted successfully!', 'success');
            });
    }

    /**
     * Handle managing members (open modal).
     */
    function handleManageMembers(container, classId) {
        console.log('[ClassesEvents] handleManageMembers called for class:', classId);

        if (!classId) {
            showNotification('No class selected.', 'error');
            return;
        }

        var cls = window.ClassesCore.getGraduatingClass(classId);
        if (!cls) {
            showNotification('Class not found.', 'error');
            return;
        }

        if (window.ClassesView && typeof window.ClassesView.showMemberModal === 'function') {
            window.ClassesView.showMemberModal(classId, container);
        } else {
            showNotification('Member management is not available. Please refresh.', 'error');
        }
    }

    /**
     * Handle adding a member to a class.
     */
    function handleAddMember(container, classId, charId, isInstructor) {
        if (!classId || !charId) {
            showNotification('Class ID and Character ID are required.', 'error');
            return;
        }

        var result = window.ClassesCore.assignCharacterToGraduatingClass(charId, classId, isInstructor === true);

        if (!result || !result.success) {
            showNotification(result && result.message ? result.message : 'Failed to add member.', 'error');
            return;
        }

        saveAndRefresh(container)
            .then(function() {
                if (window.ClassesView && typeof window.ClassesView.showMemberModal === 'function') {
                    window.ClassesView.showMemberModal(classId, container);
                }
                showNotification('Member added successfully!', 'success');
            });
    }

    /**
     * Handle removing a member from a class.
     */
    function handleRemoveMember(container, classId, charId) {
        if (!classId || !charId) {
            showNotification('Class ID and Character ID are required.', 'error');
            return;
        }

        if (!confirm('Remove this member from the class?')) {
            return;
        }

        var result = window.ClassesCore.removeCharacterFromGraduatingClass(charId);

        if (!result || !result.success) {
            showNotification(result && result.message ? result.message : 'Failed to remove member.', 'error');
            return;
        }

        saveAndRefresh(container)
            .then(function() {
                if (window.ClassesView && typeof window.ClassesView.showMemberModal === 'function') {
                    window.ClassesView.showMemberModal(classId, container);
                }
                showNotification('Member removed successfully!', 'success');
            });
    }

    /**
     * Handle class list item click (select class).
     */
    function handleClassSelect(container, classId) {
        console.log('[ClassesEvents] handleClassSelect called for class:', classId);

        if (!classId) {
            return;
        }

        if (window.ClassesView && typeof window.ClassesView.selectClass === 'function') {
            window.ClassesView.selectClass(classId);
        }

        refreshUI(container);
    }

    /**
     * Handle mobile selector change.
     */
    function handleMobileSelect(container) {
        var select = document.getElementById('mobile-class-select');
        if (!select) return;

        var classId = select.value;
        if (classId) {
            if (window.ClassesView && typeof window.ClassesView.selectClass === 'function') {
                window.ClassesView.selectClass(classId);
            }
            refreshUI(container);
        }
    }

    /**
     * Handle filter application.
     */
    function handleApplyFilter(container) {
        var minInput = document.getElementById('filter-min-year');
        var maxInput = document.getElementById('filter-max-year');

        var minYear = minInput ? parseInt(minInput.value, 10) : null;
        var maxYear = maxInput ? parseInt(maxInput.value, 10) : null;

        if (window.ClassesView && typeof window.ClassesView.setFilter === 'function') {
            window.ClassesView.setFilter(
                !isNaN(minYear) ? minYear : null,
                !isNaN(maxYear) ? maxYear : null
            );
        }
        refreshUI(container);
    }

    /**
     * Handle filter clear.
     */
    function handleClearFilter(container) {
        var minInput = document.getElementById('filter-min-year');
        var maxInput = document.getElementById('filter-max-year');

        if (minInput) minInput.value = '';
        if (maxInput) maxInput.value = '';

        if (window.ClassesView && typeof window.ClassesView.setFilter === 'function') {
            window.ClassesView.setFilter(null, null);
        }
        refreshUI(container);
    }

    // ============================================================
    // SHOW MEMBER MODAL - Called from handleManageMembers
    // ============================================================

    function showMemberModal(classId, container) {
        console.log('[ClassesEvents] showMemberModal called for class:', classId);

        var modal = document.getElementById('member-modal');
        if (!modal) {
            console.warn('ClassesEvents: member-modal not found');
            return;
        }

        var content = document.getElementById('member-modal-content');
        var title = document.getElementById('member-modal-title');

        if (!content || !title) {
            console.warn('ClassesEvents: member-modal elements not found');
            return;
        }

        var cls = window.ClassesCore.getGraduatingClass(classId);
        if (!cls) {
            showNotification('Class not found.', 'error');
            return;
        }

        title.textContent = 'Manage Members - ' + cls.name;

        // Get data
        var allChars = window.data && window.data.characters ? window.data.characters : [];
        var currentTrainees = window.ClassesCore.getCharactersByGraduatingClass(classId);
        var currentInstructors = window.ClassesCore.getInstructorsByGraduatingClass(classId);

        var traineeIds = {};
        var instructorIds = {};
        currentTrainees.forEach(function(c) { traineeIds[c.id] = true; });
        currentInstructors.forEach(function(c) { instructorIds[c.id] = true; });

        // Build content
        content.innerHTML = buildMemberModalContent(classId, allChars, traineeIds, instructorIds, currentTrainees, currentInstructors);

        // Show modal
        modal.classList.remove('hidden');
        modal.style.display = 'flex';

        // Bind modal events
        bindMemberModalEvents(container, classId, allChars, traineeIds, instructorIds);

        // Populate dropdown
        populateDropdown(classId, allChars, traineeIds, instructorIds);
    }

    // ============================================================
    // MEMBER MODAL CONTENT - RENDER ONLY
    // ============================================================

    function buildMemberModalContent(classId, allChars, traineeIds, instructorIds, currentTrainees, currentInstructors) {
        var html = '';
        html += '<p style="color:var(--text-dim);font-size:0.8rem;margin-bottom:12px;">Add or remove members from this graduating class.</p>';

        // Add member section
        html += '<div style="background:var(--bg);padding:12px;border-radius:6px;margin-bottom:12px;border:1px solid var(--border-soft);">';
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">';
        html += '<span style="font-size:0.75rem;color:var(--text-dim);">Add member:</span>';

        // Birth year filters
        html += '<div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">';
        html += '<span style="font-size:0.65rem;color:var(--text-dim);">Birth Year:</span>';
        html += '<input type="number" id="filter-min-year" placeholder="Min" style="width:60px;padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">';
        html += '<span style="font-size:0.65rem;color:var(--text-dim);">-</span>';
        html += '<input type="number" id="filter-max-year" placeholder="Max" style="width:60px;padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">';
        html += '<button id="apply-year-filter" class="small" style="font-size:0.6rem;padding:2px 8px;">Apply</button>';
        html += '<button id="clear-year-filter" class="small secondary" style="font-size:0.6rem;padding:2px 8px;">Clear</button>';
        html += '</div>';

        // Character dropdown
        html += '<select id="add-member-select" style="flex:1;min-width:150px;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">';
        html += '<option value="">Select a character...</option>';
        html += '</select>';

        // Role selector
        html += '<select id="add-member-role" style="padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;width:120px;">';
        html += '<option value="trainee">Trainee</option>';
        html += '<option value="instructor">Instructor</option>';
        html += '</select>';

        html += '<button id="add-member-btn" class="primary small" style="font-size:0.7rem;padding:4px 12px;">Add</button>';
        html += '</div>';

        html += '<div style="margin-top:6px;font-size:0.65rem;color:var(--text-dim);">';
        html += currentTrainees.length + ' trainees, ' + currentInstructors.length + ' instructors';
        html += '</div>';
        html += '</div>';

        // Current members
        html += '<div style="max-height:300px;overflow-y:auto;">';

        // Trainees
        html += '<h4 style="color:var(--accent);font-size:0.75rem;margin:8px 0 4px 0;">Trainees</h4>';
        if (currentTrainees.length === 0) {
            html += '<p style="color:var(--text-dim);font-size:0.7rem;margin:4px 0;">No trainees.</p>';
        } else {
            html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
            currentTrainees.forEach(function(char) {
                var name = getDisplayName(char);
                html += '<span style="background:var(--panel-alt);padding:2px 10px;border-radius:12px;font-size:0.7rem;display:inline-flex;align-items:center;gap:4px;border:1px solid var(--border-soft);">';
                html += escapeHtml(name);
                html += ' <button class="remove-member-btn" data-id="' + escapeHtml(char.id) + '" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.6rem;padding:0 2px;">✕</button>';
                html += '</span>';
            });
            html += '</div>';
        }

        // Instructors
        html += '<h4 style="color:var(--info);font-size:0.75rem;margin:8px 0 4px 0;">Instructors</h4>';
        if (currentInstructors.length === 0) {
            html += '<p style="color:var(--text-dim);font-size:0.7rem;margin:4px 0;">No instructors.</p>';
        } else {
            html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
            currentInstructors.forEach(function(char) {
                var name = getDisplayName(char);
                html += '<span style="background:var(--panel-alt);padding:2px 10px;border-radius:12px;font-size:0.7rem;display:inline-flex;align-items:center;gap:4px;border:1px solid var(--border-soft);">';
                html += escapeHtml(name);
                html += ' <button class="remove-member-btn" data-id="' + escapeHtml(char.id) + '" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.6rem;padding:0 2px;">✕</button>';
                html += '</span>';
            });
            html += '</div>';
        }

        html += '</div>';

        html += '<div class="form-actions" style="margin-top:12px;">';
        html += '<button type="button" id="close-member-modal-btn" class="secondary" style="font-size:0.75rem;">Close</button>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // BIND MEMBER MODAL EVENTS
    // ============================================================

    function bindMemberModalEvents(container, classId, allChars, traineeIds, instructorIds) {
        // Close buttons
        var closeBtn = document.getElementById('close-member-modal');
        if (closeBtn) {
            var newClose = closeBtn.cloneNode(true);
            closeBtn.parentNode.replaceChild(newClose, closeBtn);
            newClose.addEventListener('click', function() {
                var modal = document.getElementById('member-modal');
                if (modal) {
                    modal.classList.add('hidden');
                    modal.style.display = 'none';
                }
            });
        }

        var closeBtn2 = document.getElementById('close-member-modal-btn');
        if (closeBtn2) {
            var newClose2 = closeBtn2.cloneNode(true);
            closeBtn2.parentNode.replaceChild(newClose2, closeBtn2);
            newClose2.addEventListener('click', function() {
                var modal = document.getElementById('member-modal');
                if (modal) {
                    modal.classList.add('hidden');
                    modal.style.display = 'none';
                }
            });
        }

        // Modal click outside
        var modal = document.getElementById('member-modal');
        if (modal) {
            var newModal = modal.cloneNode(true);
            modal.parentNode.replaceChild(newModal, modal);
            newModal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                    this.style.display = 'none';
                }
            });
        }

        // Add member button
        var addBtn = document.getElementById('add-member-btn');
        if (addBtn) {
            var newAddBtn = addBtn.cloneNode(true);
            addBtn.parentNode.replaceChild(newAddBtn, addBtn);
            newAddBtn.addEventListener('click', function() {
                var select = document.getElementById('add-member-select');
                var roleSelect = document.getElementById('add-member-role');

                var charId = select ? select.value : null;
                var role = roleSelect ? roleSelect.value : 'trainee';
                var isInstructor = role === 'instructor';

                if (!charId) {
                    showNotification('Please select a character.', 'error');
                    return;
                }

                handleAddMember(container, classId, charId, isInstructor);
            });
        }

        // Remove member (delegated)
        var content = document.getElementById('member-modal-content');
        if (content) {
            var newContent = content.cloneNode(true);
            content.parentNode.replaceChild(newContent, content);

            newContent.addEventListener('click', function(e) {
                var removeBtn = e.target.closest('.remove-member-btn');
                if (removeBtn) {
                    var charId = removeBtn.dataset.id;
                    if (charId) {
                        handleRemoveMember(container, classId, charId);
                    }
                }
            });
        }

        // Filter buttons
        var applyFilter = document.getElementById('apply-year-filter');
        if (applyFilter) {
            var newApply = applyFilter.cloneNode(true);
            applyFilter.parentNode.replaceChild(newApply, applyFilter);
            newApply.addEventListener('click', function() {
                handleApplyFilter(container);
            });
        }

        var clearFilter = document.getElementById('clear-year-filter');
        if (clearFilter) {
            var newClear = clearFilter.cloneNode(true);
            clearFilter.parentNode.replaceChild(newClear, clearFilter);
            newClear.addEventListener('click', function() {
                handleClearFilter(container);
            });
        }
    }

    // ============================================================
    // POPULATE DROPDOWN
    // ============================================================

    function populateDropdown(classId, allChars, traineeIds, instructorIds) {
        var select = document.getElementById('add-member-select');
        if (!select) return;

        var filterState = window.ClassesView && typeof window.ClassesView.getFilter === 'function'
            ? window.ClassesView.getFilter()
            : { minYear: null, maxYear: null };

        var availableChars = allChars.filter(function(char) {
            return !traineeIds[char.id] && !instructorIds[char.id];
        });

        // Apply birth year filters
        if (filterState.minYear !== null || filterState.maxYear !== null) {
            availableChars = availableChars.filter(function(char) {
                var birthYear = parseInt(char.birthYear, 10);
                if (isNaN(birthYear)) {
                    return false;
                }
                if (filterState.minYear !== null && birthYear < filterState.minYear) {
                    return false;
                }
                if (filterState.maxYear !== null && birthYear > filterState.maxYear) {
                    return false;
                }
                return true;
            });
        }

        availableChars.sort(function(a, b) {
            return getDisplayName(a).localeCompare(getDisplayName(b));
        });

        select.innerHTML = '<option value="">Select a character...</option>';

        availableChars.forEach(function(char) {
            var name = getDisplayName(char);
            var status = typeof window.getCurrentStatus === 'function' ? window.getCurrentStatus(char) : '';
            var birthYear = char.birthYear ? ' (' + char.birthYear + ')' : '';

            var option = document.createElement('option');
            option.value = char.id;
            option.textContent = name + ' - ' + status + birthYear;
            select.appendChild(option);
        });

        // Update filter status
        var statusEl = document.getElementById('filter-status');
        if (!statusEl) {
            var statusDiv = document.createElement('div');
            statusDiv.id = 'filter-status';
            statusDiv.style.cssText = 'font-size:0.6rem;color:var(--text-dim);margin-top:4px;';
            select.parentNode.appendChild(statusDiv);
            statusEl = statusDiv;
        }

        if (filterState.minYear !== null || filterState.maxYear !== null) {
            var minText = filterState.minYear !== null ? '≥' + filterState.minYear : '';
            var maxText = filterState.maxYear !== null ? '≤' + filterState.maxYear : '';
            statusEl.textContent = 'Filter: ' + (minText + ' ' + maxText).trim() + ' (' + availableChars.length + ' characters)';
            statusEl.style.color = 'var(--accent)';
        } else {
            statusEl.textContent = 'No filter applied (' + availableChars.length + ' characters available)';
            statusEl.style.color = 'var(--text-dim)';
        }
    }

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    function getDisplayName(char) {
        if (typeof window.getDisplayName === 'function') {
            return window.getDisplayName(char);
        }
        if (char && char.firstName) {
            return char.firstName + (char.lastName ? ' ' + char.lastName : '');
        }
        return 'Unknown';
    }

    function escapeHtml(value) {
        if (window.DomUtils && typeof window.DomUtils.escapeHtml === 'function') {
            return window.DomUtils.escapeHtml(value);
        }

        if (value === undefined || value === null) {
            return '';
        }
        var str = String(value);
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // EVENT BINDING - MAIN INIT
    // ============================================================

    function initEvents(container) {
        if (!checkDependencies()) {
            return;
        }

        if (!container) {
            container = document.getElementById('tab-classes');
        }

        if (!container) {
            container = document.getElementById('classes-content');
        }

        if (!container) {
            console.warn('ClassesEvents: Container not found');
            return;
        }

        // ---- ADD CLASS BUTTON ----
        var addBtn = document.getElementById('add-class-btn');
        if (addBtn) {
            var newAddBtn = addBtn.cloneNode(true);
            addBtn.parentNode.replaceChild(newAddBtn, addBtn);
            newAddBtn.addEventListener('click', function() {
                handleAddClass(container);
            });
        }

        // ---- CLASS FORM ----
        var form = document.getElementById('class-form-inner');
        if (form) {
            var newForm = form.cloneNode(true);
            form.parentNode.replaceChild(newForm, form);
            newForm.addEventListener('submit', function(e) {
                handleSaveClass(container, e);
            });
        }

        // ---- CLASS FORM CLOSE BUTTONS ----
        var closeFormBtn = document.getElementById('close-class-form');
        if (closeFormBtn) {
            var newCloseForm = closeFormBtn.cloneNode(true);
            closeFormBtn.parentNode.replaceChild(newCloseForm, closeFormBtn);
            newCloseForm.addEventListener('click', function() {
                var modal = document.getElementById('class-form-modal');
                if (modal) {
                    modal.classList.add('hidden');
                    modal.style.display = 'none';
                }
            });
        }

        var cancelFormBtn = document.getElementById('cancel-class-form');
        if (cancelFormBtn) {
            var newCancelForm = cancelFormBtn.cloneNode(true);
            cancelFormBtn.parentNode.replaceChild(newCancelForm, cancelFormBtn);
            newCancelForm.addEventListener('click', function() {
                var modal = document.getElementById('class-form-modal');
                if (modal) {
                    modal.classList.add('hidden');
                    modal.style.display = 'none';
                }
            });
        }

        // ---- CLASS FORM MODAL CLICK OUTSIDE ----
        var formModal = document.getElementById('class-form-modal');
        if (formModal) {
            var newFormModal = formModal.cloneNode(true);
            formModal.parentNode.replaceChild(newFormModal, formModal);
            newFormModal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                    this.style.display = 'none';
                }
            });
        }

        // ---- CLASS LIST ITEMS (delegated) ----
        var listContainer = document.getElementById('class-list');
        if (listContainer) {
            var newListContainer = listContainer.cloneNode(true);
            listContainer.parentNode.replaceChild(newListContainer, listContainer);

            newListContainer.addEventListener('click', function(e) {
                var item = e.target.closest('.class-list-item');
                if (item) {
                    var classId = item.dataset.id;
                    if (classId) {
                        console.log('[ClassesEvents] Class list item clicked:', classId);
                        handleClassSelect(container, classId);
                    }
                }
            });
        }

        // ---- CLASS DETAIL ACTION BUTTONS (delegated) ----
        var detailContainer = document.getElementById('class-detail');
        if (detailContainer) {
            var newDetailContainer = detailContainer.cloneNode(true);
            detailContainer.parentNode.replaceChild(newDetailContainer, detailContainer);

            newDetailContainer.addEventListener('click', function(e) {
                // Manage Members button
                var manageBtn = e.target.closest('#manage-members-btn');
                if (manageBtn) {
                    e.preventDefault();
                    var classId = manageBtn.dataset.classId;
                    console.log('[ClassesEvents] Manage Members button clicked, classId:', classId);
                    if (classId) {
                        handleManageMembers(container, classId);
                    } else {
                        showNotification('No class selected.', 'error');
                    }
                    return;
                }

                // Edit button
                var editBtn = e.target.closest('#edit-class-btn');
                if (editBtn) {
                    e.preventDefault();
                    var classId = editBtn.dataset.classId;
                    if (classId) {
                        handleEditClass(container, classId);
                    }
                    return;
                }

                // Delete button
                var deleteBtn = e.target.closest('#delete-class-btn');
                if (deleteBtn) {
                    e.preventDefault();
                    var classId = deleteBtn.dataset.classId;
                    if (classId) {
                        handleDeleteClass(container, classId);
                    }
                    return;
                }
            });
        }

        // ---- MOBILE SELECTOR ----
        var mobileSelect = document.getElementById('mobile-class-select');
        if (mobileSelect) {
            var newMobileSelect = mobileSelect.cloneNode(true);
            mobileSelect.parentNode.replaceChild(newMobileSelect, mobileSelect);
            newMobileSelect.addEventListener('change', function() {
                handleMobileSelect(container);
            });
        }

        // ---- RESIZE HANDLER ----
        if (window._classesResizeHandler) {
            window.removeEventListener('resize', window._classesResizeHandler);
        }

        var resizeTimeout = null;
        window._classesResizeHandler = function() {
            if (resizeTimeout) {
                clearTimeout(resizeTimeout);
                resizeTimeout = null;
            }
            resizeTimeout = setTimeout(function() {
                var wasMobile = window._classesIsMobile || false;
                var isMobile = window.innerWidth < 768;
                window._classesIsMobile = isMobile;

                if (wasMobile !== isMobile) {
                    refreshUI(container);
                }
                resizeTimeout = null;
            }, 300);
        };

        window.addEventListener('resize', window._classesResizeHandler);
    }

    // ============================================================
    // CLEANUP
    // ============================================================

    function destroy() {
        if (window._classesResizeHandler) {
            window.removeEventListener('resize', window._classesResizeHandler);
            window._classesResizeHandler = null;
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ClassesEvents = {
        init: initEvents,
        destroy: destroy,
        showMemberModal: showMemberModal,
        handleManageMembers: handleManageMembers,
        handleEditClass: handleEditClass,
        handleSaveClass: handleSaveClass,
        handleDeleteClass: handleDeleteClass,
        handleAddMember: handleAddMember,
        handleRemoveMember: handleRemoveMember,
        handleClassSelect: handleClassSelect
    };

})();
