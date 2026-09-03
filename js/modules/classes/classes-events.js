/**
 * modules/classes/classes-events.js - Classes Events
 * Fixed: Single source of truth for selection state
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__classesEventsLoaded) {
        return;
    }

    // ============================================================
    // STATE
    // ============================================================

    var _container = null;
    var _eventsBound = false;

    // NOTE: _selectedClassId is REMOVED.
    // ClassesView.state.selectedClassId is the SINGLE source of truth.
    // Events calls ClassesView.selectClass() to update it.

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

        if (!window.ClassesView || typeof window.ClassesView.selectClass !== 'function') {
            missing.push('ClassesView.selectClass');
        }

        if (!window.ClassesView || typeof window.ClassesView.getSelectedClassId !== 'function') {
            missing.push('ClassesView.getSelectedClassId');
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

        if (type === 'error') {
            alert('Error: ' + message);
        } else {
            alert(message);
        }
    }

    // ============================================================
    // PERSISTENCE
    // ============================================================

    function saveData() {
        if (typeof window.saveData === 'function') {
            return window.saveData().catch(function(err) {
                console.warn('ClassesEvents: Persistence failed:', err);
                showNotification('Save failed. Please try again.', 'error');
            });
        }
        return Promise.resolve();
    }

    // ============================================================
    // REFRESH UI - SIMPLIFIED
    // ============================================================

    function refreshUI() {
        console.log('[ClassesEvents] refreshUI called');

        if (!_container) {
            console.warn('[ClassesEvents] No container set');
            return;
        }

        if (!window.ClassesView || typeof window.ClassesView.renderClassesView !== 'function') {
            console.warn('[ClassesEvents] ClassesView not available');
            return;
        }

        // ClassesView.renderClassesView() will read its own state.selectedClassId
        // and render the detail accordingly. Events doesn't need to pass the ID.
        window.ClassesView.renderClassesView(_container);
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    function handleAddClass() {
        var modal = document.getElementById('class-form-modal');
        var title = document.getElementById('class-form-title');
        var nameInput = document.getElementById('class-name');
        var yearInput = document.getElementById('class-year');
        var form = document.getElementById('class-form-inner');

        if (!modal || !title || !nameInput || !form) {
            showNotification('Form elements not found. Please refresh.', 'error');
            return;
        }

        modal.classList.remove('hidden');
        modal.style.display = 'flex';
        title.textContent = 'Add Class';
        nameInput.value = '';
        if (yearInput) yearInput.value = '';
        delete form.dataset.editId;
        nameInput.focus();
    }

    function handleEditClass(classId) {
        if (!classId) {
            // Get from View's single source of truth
            classId = window.ClassesView.getSelectedClassId();
        }

        if (!classId) {
            showNotification('No class selected.', 'error');
            return;
        }

        var modal = document.getElementById('class-form-modal');
        var title = document.getElementById('class-form-title');
        var nameInput = document.getElementById('class-name');
        var yearInput = document.getElementById('class-year');
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
        if (yearInput) yearInput.value = cls.graduationYear || '';
        form.dataset.editId = classId;
        nameInput.focus();
    }

    function handleSaveClass(e) {
        e.preventDefault();

        var form = e.target;
        var editId = form.dataset.editId;
        var nameInput = document.getElementById('class-name');
        var yearInput = document.getElementById('class-year');

        if (!nameInput) {
            showNotification('Form not found. Please refresh.', 'error');
            return;
        }

        var name = nameInput.value.trim();
        if (!name) {
            showNotification('Class name is required.', 'error');
            return;
        }

        var year = yearInput ? parseInt(yearInput.value, 10) : null;
        if (yearInput && yearInput.value && isNaN(year)) {
            showNotification('Invalid graduation year.', 'error');
            return;
        }

        var result;
        if (editId) {
            result = window.ClassesCore.updateGraduatingClass(editId, name, year);
        } else {
            result = window.ClassesCore.createGraduatingClass(name, year);
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

        if (result.class) {
            // Update View's single source of truth
            window.ClassesView.selectClass(result.class.id);
        }

        saveData().then(function() {
            refreshUI();
            showNotification(editId ? 'Class updated successfully!' : 'Class created successfully!', 'success');
        });
    }

    function handleDeleteClass(classId) {
        if (!classId) {
            classId = window.ClassesView.getSelectedClassId();
        }

        if (!classId) {
            showNotification('No class selected.', 'error');
            return;
        }

        var cls = window.ClassesCore.getGraduatingClass(classId);
        if (!cls) {
            showNotification('Class not found.', 'error');
            return;
        }

        var totalMembers = window.ClassesCore.getTotalCount(classId);

        var message = 'Delete "' + cls.name + '" permanently?';
        if (totalMembers > 0) {
            message += '\n\nThis class has ' + totalMembers + ' members.';
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

        // Clear selection
        window.ClassesView.clearSelection();

        saveData().then(function() {
            refreshUI();
            showNotification('Class deleted successfully!', 'success');
        });
    }

    function handleManageMembers(classId) {
        if (!classId) {
            classId = window.ClassesView.getSelectedClassId();
        }

        if (!classId) {
            showNotification('No class selected.', 'error');
            return;
        }

        var cls = window.ClassesCore.getGraduatingClass(classId);
        if (!cls) {
            showNotification('Class not found.', 'error');
            return;
        }

        showMemberModal(classId);
    }

    function showMemberModal(classId) {
        var modal = document.getElementById('member-modal');
        if (!modal) {
            showNotification('Member modal not found. Please refresh.', 'error');
            return;
        }

        var content = document.getElementById('member-modal-content');
        var title = document.getElementById('member-modal-title');

        if (!content || !title) {
            showNotification('Modal elements not found. Please refresh.', 'error');
            return;
        }

        var cls = window.ClassesCore.getGraduatingClass(classId);
        if (!cls) {
            showNotification('Class not found.', 'error');
            return;
        }

        title.textContent = 'Manage Members - ' + cls.name;

        content.innerHTML = window.ClassesView.renderMemberModalContent(classId);

        modal.classList.remove('hidden');
        modal.style.display = 'flex';

        populateSearchResults(classId);
    }

    function populateSearchResults(classId) {
        var searchInput = document.getElementById('member-search');
        var resultsContainer = document.getElementById('member-search-results');

        if (!searchInput || !resultsContainer) return;

        var query = searchInput.value.trim() || '';
        var available = window.ClassesCore.getAvailableCharactersForClass(classId, {
            name: query,
            minBirthYear: null,
            maxBirthYear: null
        });

        if (available.length === 0) {
            resultsContainer.innerHTML = '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No characters available.</p>';
            return;
        }

        var html = '';
        var roleSelect = document.getElementById('member-role-select');
        var defaultRole = roleSelect ? roleSelect.value : 'trainee';

        available.slice(0, 20).forEach(function(char) {
            var name = getDisplayName(char);
            var status = typeof window.getCurrentStatus === 'function' ? window.getCurrentStatus(char) : '';
            var birthYear = char.birthYear ? ' (' + char.birthYear + ')' : '';

            html += '<div class="search-result-item" style="display:flex;justify-content:space-between;align-items:center;padding:3px 6px;border-bottom:1px solid var(--border-soft);">';
            html += '<span style="font-size:0.7rem;">' + escapeHtml(name) + ' - ' + escapeHtml(status) + birthYear + '</span>';
            html += '<button class="add-member-result-btn small primary" data-char-id="' + escapeHtml(char.id) + '" data-role="' + escapeHtml(defaultRole) + '" style="font-size:0.6rem;padding:1px 8px;">Add</button>';
            html += '</div>';
        });

        if (available.length > 20) {
            html += '<p style="font-size:0.6rem;color:var(--text-dim);padding:2px;">Showing 20 of ' + available.length + ' results</p>';
        }

        resultsContainer.innerHTML = html;
    }

    function handleAddMemberFromSearch(classId, charId, role) {
        if (!classId || !charId) {
            showNotification('Class ID and Character ID are required.', 'error');
            return;
        }

        var result = window.ClassesCore.addMember(classId, charId, role);

        if (!result || !result.success) {
            showNotification(result && result.message ? result.message : 'Failed to add member.', 'error');
            return;
        }

        saveData().then(function() {
            var content = document.getElementById('member-modal-content');
            if (content) {
                content.innerHTML = window.ClassesView.renderMemberModalContent(classId);
            }
            populateSearchResults(classId);
            refreshUI();
            showNotification('Member added successfully!', 'success');
        });
    }

    function handleRemoveMember(classId, charId) {
        if (!classId || !charId) {
            showNotification('Class ID and Character ID are required.', 'error');
            return;
        }

        if (!confirm('Remove this member from the class?')) {
            return;
        }

        var result = window.ClassesCore.removeMember(classId, charId);

        if (!result || !result.success) {
            showNotification(result && result.message ? result.message : 'Failed to remove member.', 'error');
            return;
        }

        saveData().then(function() {
            var content = document.getElementById('member-modal-content');
            if (content) {
                content.innerHTML = window.ClassesView.renderMemberModalContent(classId);
            }
            populateSearchResults(classId);
            refreshUI();
            showNotification('Member removed successfully!', 'success');
        });
    }

    // ============================================================
    // HANDLE CLASS SELECT - SINGLE SOURCE OF TRUTH
    // ============================================================

    function handleClassSelect(classId) {
        console.log('[ClassesEvents] handleClassSelect called with:', classId);

        if (!classId) {
            return;
        }

        // Update View's single source of truth
        if (window.ClassesView && typeof window.ClassesView.selectClass === 'function') {
            window.ClassesView.selectClass(classId);
        }

        // Refresh UI - renderClassesView() will read the updated state
        refreshUI();
    }

    function handleMobileSelect() {
        var select = document.getElementById('mobile-class-select');
        if (!select) return;

        var classId = select.value;
        if (classId) {
            handleClassSelect(classId);
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
        if (value === undefined || value === null) return '';
        var str = String(value);
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    // ============================================================
    // DIAGNOSTIC
    // ============================================================

    function logClassListItems() {
        var items = document.querySelectorAll('.class-list-item');
        console.log('[ClassesEvents] Found ' + items.length + ' .class-list-item elements');
        items.forEach(function(item, index) {
            console.log('[ClassesEvents] Item ' + index + ':', {
                id: item.dataset.id,
                text: item.textContent.trim().substring(0, 30),
                className: item.className
            });
        });
        return items;
    }

    function checkDetailContainer() {
        var container = document.getElementById('class-detail');
        console.log('[ClassesEvents] #class-detail exists:', !!container);
        if (container) {
            console.log('[ClassesEvents] #class-detail innerHTML length:', container.innerHTML.length);
            console.log('[ClassesEvents] #class-detail innerHTML preview:', container.innerHTML.substring(0, 200));
        }
        return container;
    }

    // ============================================================
    // BIND EVENTS - Container-level delegation
    // ============================================================

    function bindEvents() {
        if (_eventsBound) return;
        if (!_container) return;

        _eventsBound = true;

        console.log('[ClassesEvents] Binding events on container:', _container.id || 'classes-content');

        // ---- CLICK DELEGATION ----
        _container.addEventListener('click', function(e) {
            var target = e.target;

            // 1. Add Class button
            var addBtn = target.closest('#add-class-btn');
            if (addBtn) {
                e.preventDefault();
                console.log('[ClassesEvents] Add class clicked');
                handleAddClass();
                return;
            }

            // 2. Class list item
            var listItem = target.closest('.class-list-item');
            if (listItem) {
                e.preventDefault();
                var classId = listItem.dataset.id;
                console.log('[ClassesEvents] Class list item clicked, classId:', classId);
                if (classId) {
                    handleClassSelect(classId);
                }
                return;
            }

            // 3. Manage Members button
            var manageBtn = target.closest('#manage-members-btn');
            if (manageBtn) {
                e.preventDefault();
                var classId = manageBtn.dataset.classId || window.ClassesView.getSelectedClassId();
                console.log('[ClassesEvents] Manage Members clicked, classId:', classId);
                if (classId) {
                    handleManageMembers(classId);
                }
                return;
            }

            // 4. Edit Class button
            var editBtn = target.closest('#edit-class-btn');
            if (editBtn) {
                e.preventDefault();
                var classId = editBtn.dataset.classId || window.ClassesView.getSelectedClassId();
                console.log('[ClassesEvents] Edit class clicked, classId:', classId);
                if (classId) {
                    handleEditClass(classId);
                }
                return;
            }

            // 5. Delete Class button
            var deleteBtn = target.closest('#delete-class-btn');
            if (deleteBtn) {
                e.preventDefault();
                var classId = deleteBtn.dataset.classId || window.ClassesView.getSelectedClassId();
                console.log('[ClassesEvents] Delete class clicked, classId:', classId);
                if (classId) {
                    handleDeleteClass(classId);
                }
                return;
            }

            // 6. Add member from search results
            var addMemberBtn = target.closest('.add-member-result-btn');
            if (addMemberBtn) {
                e.preventDefault();
                var charId = addMemberBtn.dataset.charId;
                var role = addMemberBtn.dataset.role || 'trainee';
                var classId = window.ClassesView.getSelectedClassId();
                console.log('[ClassesEvents] Add member from search, charId:', charId, 'classId:', classId);
                if (charId && classId) {
                    handleAddMemberFromSearch(classId, charId, role);
                }
                return;
            }

            // 7. Remove member chip
            var removeBtn = target.closest('.remove-member-btn');
            if (removeBtn) {
                e.preventDefault();
                var charId = removeBtn.dataset.charId;
                var classId = removeBtn.dataset.classId || window.ClassesView.getSelectedClassId();
                console.log('[ClassesEvents] Remove member, charId:', charId, 'classId:', classId);
                if (charId && classId) {
                    handleRemoveMember(classId, charId);
                }
                return;
            }

            // 8. Class form modal close
            var closeFormBtn = target.closest('#close-class-form');
            if (closeFormBtn) {
                var modal = document.getElementById('class-form-modal');
                if (modal) {
                    modal.classList.add('hidden');
                    modal.style.display = 'none';
                }
                return;
            }

            // 9. Class form cancel
            var cancelFormBtn = target.closest('#cancel-class-form');
            if (cancelFormBtn) {
                var modal = document.getElementById('class-form-modal');
                if (modal) {
                    modal.classList.add('hidden');
                    modal.style.display = 'none';
                }
                return;
            }

            // 10. Member modal close
            var closeMemberBtn = target.closest('#close-member-modal');
            if (closeMemberBtn) {
                var modal = document.getElementById('member-modal');
                if (modal) {
                    modal.classList.add('hidden');
                    modal.style.display = 'none';
                }
                return;
            }

            var closeMemberBtn2 = target.closest('#close-member-modal-btn');
            if (closeMemberBtn2) {
                var modal = document.getElementById('member-modal');
                if (modal) {
                    modal.classList.add('hidden');
                    modal.style.display = 'none';
                }
                return;
            }
        });

        // ---- INPUT DELEGATION ----
        _container.addEventListener('input', function(e) {
            var target = e.target;

            var searchInput = target.closest('#member-search');
            if (searchInput) {
                var classId = window.ClassesView.getSelectedClassId();
                if (classId) {
                    populateSearchResults(classId);
                }
                return;
            }
        });

        // ---- CHANGE DELEGATION ----
        _container.addEventListener('change', function(e) {
            var target = e.target;

            var roleSelect = target.closest('#member-role-select');
            if (roleSelect) {
                var classId = window.ClassesView.getSelectedClassId();
                if (classId) {
                    populateSearchResults(classId);
                }
                return;
            }

            var mobileSelect = target.closest('#mobile-class-select');
            if (mobileSelect) {
                handleMobileSelect();
                return;
            }
        });

        // ---- FORM SUBMIT ----
        _container.addEventListener('submit', function(e) {
            var form = e.target.closest('#class-form-inner');
            if (form) {
                handleSaveClass(e);
            }
        });

        // ---- MODAL CLICK OUTSIDE ----
        var formModal = document.getElementById('class-form-modal');
        if (formModal) {
            formModal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                    this.style.display = 'none';
                }
            });
        }

        var memberModal = document.getElementById('member-modal');
        if (memberModal) {
            memberModal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                    this.style.display = 'none';
                }
            });
        }

        // ---- RESIZE HANDLER ----
        var resizeTimeout = null;
        var resizeHandler = function() {
            if (resizeTimeout) {
                clearTimeout(resizeTimeout);
                resizeTimeout = null;
            }
            resizeTimeout = setTimeout(function() {
                var isMobile = window.innerWidth < 768;
                window._classesIsMobile = isMobile;
                refreshUI();
                resizeTimeout = null;
            }, 300);
        };

        window._classesResizeHandler = resizeHandler;
        window.addEventListener('resize', resizeHandler);

        // ---- DIAGNOSTIC ----
        setTimeout(function() {
            logClassListItems();
            checkDetailContainer();
            var selected = window.ClassesView.getSelectedClassId();
            console.log('[ClassesEvents] Current selected class:', selected);
        }, 200);

        console.log('[ClassesEvents] Events bound successfully');
    }

    // ============================================================
    // MAIN INIT
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

        _container = container;

        // Bind events once
        bindEvents();

        // Initial render
        refreshUI();

        console.log('[ClassesEvents] Initialized');
    }

    // ============================================================
    // CLEANUP
    // ============================================================

    function destroy() {
        if (window._classesResizeHandler) {
            window.removeEventListener('resize', window._classesResizeHandler);
            window._classesResizeHandler = null;
        }
        _eventsBound = false;
        _container = null;
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    // Note: selectClass and getSelectedClassId are now delegated to ClassesView
    // Events doesn't need its own selection state.

    function refreshUI() {
        if (_container && window.ClassesView && typeof window.ClassesView.renderClassesView === 'function') {
            window.ClassesView.renderClassesView(_container);
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ClassesEvents = {
        init: initEvents,
        destroy: destroy,
        refreshUI: refreshUI
    };

    window.__classesEventsLoaded = true;

})();
