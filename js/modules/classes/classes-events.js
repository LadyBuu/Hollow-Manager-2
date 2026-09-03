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
 *   - Uses EVENT DELEGATION on stable parent elements
 *   - Events are bound ONCE and survive content refreshes
 *   - No cloneNode() or listener re-binding needed
 *   - All mutations delegate to ClassesCore
 *   - All rendering delegates to ClassesView
 * 
 * DEPENDENCIES:
 *   - window.ClassesCore (from classes-core.js)
 *   - window.ClassesView (from classes-view.js)
 *   - window.CoreUtils (from core-utils.js)
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
    // STATE
    // ============================================================

    var _selectedClassId = null;
    var _container = null;
    var _eventsBound = false;

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

        if (!window.CoreUtils || typeof window.CoreUtils.getDisplayName !== 'function') {
            missing.push('CoreUtils.getDisplayName');
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
    // PERSISTENCE HELPERS
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

    function refreshUI() {
        if (_container && window.ClassesView && typeof window.ClassesView.renderClassesView === 'function') {
            window.ClassesView.renderClassesView(_container, _selectedClassId);
        }
        if (_selectedClassId && window.ClassesView && typeof window.ClassesView.renderClassDetail === 'function') {
            var detailContainer = document.getElementById('class-detail');
            if (detailContainer) {
                window.ClassesView.renderClassDetail(detailContainer, _selectedClassId);
            }
        }
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
            // Try to get from selected state
            classId = _selectedClassId;
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
            _selectedClassId = result.class.id;
        }

        saveData().then(function() {
            refreshUI();
            showNotification(editId ? 'Class updated successfully!' : 'Class created successfully!', 'success');
        });
    }

    function handleDeleteClass(classId) {
        if (!classId) {
            classId = _selectedClassId;
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

        _selectedClassId = null;

        saveData().then(function() {
            refreshUI();
            showNotification('Class deleted successfully!', 'success');
        });
    }

    function handleManageMembers(classId) {
        if (!classId) {
            classId = _selectedClassId;
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

        // Use ClassesView to render modal content
        content.innerHTML = window.ClassesView.renderMemberModalContent(classId);

        modal.classList.remove('hidden');
        modal.style.display = 'flex';

        // Populate search results after render
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
            var name = window.CoreUtils.getDisplayName(char);
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

    function handleClassSelect(classId) {
        if (!classId) {
            return;
        }

        _selectedClassId = classId;
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

    function escapeHtml(value) {
        if (window.DomUtils && typeof window.DomUtils.escapeHtml === 'function') {
            return window.DomUtils.escapeHtml(value);
        }
        if (value === undefined || value === null) return '';
        var str = String(value);
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    // ============================================================
    // BIND EVENTS USING DELEGATION - ONCE, ON STABLE ELEMENTS
    // ============================================================

    function bindEvents() {
        if (_eventsBound) return;
        _eventsBound = true;

        // ---- ADD CLASS BUTTON ----
        var addBtn = document.getElementById('add-class-btn');
        if (addBtn) {
            addBtn.addEventListener('click', handleAddClass);
        }

        // ---- CLASS FORM ----
        var form = document.getElementById('class-form-inner');
        if (form) {
            form.addEventListener('submit', handleSaveClass);
        }

        // ---- CLASS FORM CLOSE BUTTONS ----
        var closeFormBtn = document.getElementById('close-class-form');
        if (closeFormBtn) {
            closeFormBtn.addEventListener('click', function() {
                var modal = document.getElementById('class-form-modal');
                if (modal) {
                    modal.classList.add('hidden');
                    modal.style.display = 'none';
                }
            });
        }

        var cancelFormBtn = document.getElementById('cancel-class-form');
        if (cancelFormBtn) {
            cancelFormBtn.addEventListener('click', function() {
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
            formModal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                    this.style.display = 'none';
                }
            });
        }

        // ---- MEMBER MODAL ----
        var memberModal = document.getElementById('member-modal');
        if (memberModal) {
            memberModal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                    this.style.display = 'none';
                }
            });
        }

        // Close member modal buttons
        var closeMemberBtn = document.getElementById('close-member-modal');
        if (closeMemberBtn) {
            closeMemberBtn.addEventListener('click', function() {
                var modal = document.getElementById('member-modal');
                if (modal) {
                    modal.classList.add('hidden');
                    modal.style.display = 'none';
                }
            });
        }

        var closeMemberBtn2 = document.getElementById('close-member-modal-btn');
        if (closeMemberBtn2) {
            closeMemberBtn2.addEventListener('click', function() {
                var modal = document.getElementById('member-modal');
                if (modal) {
                    modal.classList.add('hidden');
                    modal.style.display = 'none';
                }
            });
        }

        // ---- DELEGATED EVENTS (stays bound even when content refreshes) ----

        // 1. Class list items - delegate from stable container
        var listContainer = document.getElementById('class-list');
        if (listContainer) {
            listContainer.addEventListener('click', function(e) {
                var item = e.target.closest('.class-list-item');
                if (item) {
                    var classId = item.dataset.id;
                    if (classId) {
                        handleClassSelect(classId);
                    }
                }
            });
        }

        // 2. Class detail actions - delegate from stable container
        var detailContainer = document.getElementById('class-detail');
        if (detailContainer) {
            detailContainer.addEventListener('click', function(e) {
                var target = e.target;

                // Manage Members button
                var manageBtn = target.closest('#manage-members-btn');
                if (manageBtn) {
                    e.preventDefault();
                    var classId = manageBtn.dataset.classId || _selectedClassId;
                    if (classId) {
                        handleManageMembers(classId);
                    } else {
                        showNotification('No class selected.', 'error');
                    }
                    return;
                }

                // Edit button
                var editBtn = target.closest('#edit-class-btn');
                if (editBtn) {
                    e.preventDefault();
                    var classId = editBtn.dataset.classId || _selectedClassId;
                    if (classId) {
                        handleEditClass(classId);
                    } else {
                        showNotification('No class selected.', 'error');
                    }
                    return;
                }

                // Delete button
                var deleteBtn = target.closest('#delete-class-btn');
                if (deleteBtn) {
                    e.preventDefault();
                    var classId = deleteBtn.dataset.classId || _selectedClassId;
                    if (classId) {
                        handleDeleteClass(classId);
                    } else {
                        showNotification('No class selected.', 'error');
                    }
                    return;
                }
            });
        }

        // 3. Member modal content - delegate for dynamic buttons
        var memberContent = document.getElementById('member-modal-content');
        if (memberContent) {
            memberContent.addEventListener('click', function(e) {
                var target = e.target;

                // Add member from search results
                var addBtn = target.closest('.add-member-result-btn');
                if (addBtn) {
                    e.preventDefault();
                    var charId = addBtn.dataset.charId;
                    var role = addBtn.dataset.role || 'trainee';
                    var classId = _selectedClassId;
                    if (charId && classId) {
                        handleAddMemberFromSearch(classId, charId, role);
                    } else {
                        showNotification('Missing class or character ID.', 'error');
                    }
                    return;
                }

                // Remove member chip
                var removeBtn = target.closest('.remove-member-btn');
                if (removeBtn) {
                    e.preventDefault();
                    var charId = removeBtn.dataset.charId;
                    var classId = removeBtn.dataset.classId || _selectedClassId;
                    if (charId && classId) {
                        handleRemoveMember(classId, charId);
                    } else {
                        showNotification('Missing class or character ID.', 'error');
                    }
                    return;
                }
            });
        }

        // 4. Search input - delegate from stable container
        var searchInput = document.getElementById('member-search');
        if (searchInput) {
            searchInput.addEventListener('input', function() {
                var classId = _selectedClassId;
                if (classId) {
                    populateSearchResults(classId);
                }
            });
        }

        // 5. Role select - delegate from stable container
        var roleSelect = document.getElementById('member-role-select');
        if (roleSelect) {
            roleSelect.addEventListener('change', function() {
                var classId = _selectedClassId;
                if (classId) {
                    populateSearchResults(classId);
                }
            });
        }

        // 6. Mobile selector - delegate from stable container
        var mobileSelect = document.getElementById('mobile-class-select');
        if (mobileSelect) {
            mobileSelect.addEventListener('change', handleMobileSelect);
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

        // Bind events only ONCE
        bindEvents();

        // Initial render
        refreshUI();
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
        _selectedClassId = null;
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    function selectClass(classId) {
        _selectedClassId = classId;
        refreshUI();
    }

    function getSelectedClassId() {
        return _selectedClassId;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ClassesEvents = {
        init: initEvents,
        destroy: destroy,
        selectClass: selectClass,
        getSelectedClassId: getSelectedClassId,
        refreshUI: refreshUI,
        handleManageMembers: handleManageMembers,
        handleEditClass: handleEditClass,
        handleDeleteClass: handleDeleteClass,
        handleClassSelect: handleClassSelect
    };

})();
