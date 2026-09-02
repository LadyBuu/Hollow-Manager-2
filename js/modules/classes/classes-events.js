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

        if (!window.DomUtils || typeof window.DomUtils.delegate !== 'function') {
            missing.push('DomUtils.delegate');
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

    function saveAndRefresh() {
        if (typeof window.saveData === 'function') {
            return window.saveData()
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
     * Handle adding a new class.
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
     * Handle editing a class.
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

        saveAndRefresh()
            .then(function() {
                refreshUI(container);
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

        saveAndRefresh()
            .then(function() {
                // Clear selection state in the view
                if (window.ClassesView && typeof window.ClassesView.clearSelection === 'function') {
                    window.ClassesView.clearSelection();
                }
                refreshUI(container);
                showNotification('Class deleted successfully!', 'success');
            });
    }

    /**
     * Handle managing members (open modal).
     */
    function handleManageMembers(container, classId) {
        if (!classId) {
            showNotification('Class ID is required.', 'error');
            return;
        }

        if (window.ClassesView && typeof window.ClassesView.showMemberModal === 'function') {
            window.ClassesView.showMemberModal(classId, container);
        } else {
            showNotification('Member management is not available.', 'error');
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

        saveAndRefresh()
            .then(function() {
                // Re-open the member modal to show updated list
                if (window.ClassesView && typeof window.ClassesView.showMemberModal === 'function') {
                    window.ClassesView.showMemberModal(classId, container);
                }
                refreshUI(container);
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

        saveAndRefresh()
            .then(function() {
                // Re-open the member modal to show updated list
                if (window.ClassesView && typeof window.ClassesView.showMemberModal === 'function') {
                    window.ClassesView.showMemberModal(classId, container);
                }
                refreshUI(container);
                showNotification('Member removed successfully!', 'success');
            });
    }

    /**
     * Handle class list item click (select class).
     */
    function handleClassSelect(container, classId) {
        if (!classId) {
            return;
        }

        // Update view state
        if (window.ClassesView && typeof window.ClassesView.selectClass === 'function') {
            window.ClassesView.selectClass(classId);
        }

        refreshUI(container);
    }

    // ============================================================
    // EVENT BINDING
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

        // ---- CLASS CRUD EVENTS ----

        // Add Class button
        var addBtn = document.getElementById('add-class-btn');
        if (addBtn) {
            // Remove existing listeners by cloning
            var newAddBtn = addBtn.cloneNode(true);
            addBtn.parentNode.replaceChild(newAddBtn, addBtn);
            newAddBtn.addEventListener('click', function() {
                handleAddClass(container);
            });
        }

        // Class form close buttons
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

        // Class form submit
        var form = document.getElementById('class-form-inner');
        if (form) {
            var newForm = form.cloneNode(true);
            form.parentNode.replaceChild(newForm, form);
            newForm.addEventListener('submit', function(e) {
                handleSaveClass(container, e);
            });
        }

        // Class form modal click outside
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

        // ---- EVENT DELEGATION FOR DYNAMIC ELEMENTS ----

        // Class list items (delegated)
        var listContainer = document.getElementById('class-list');
        if (listContainer) {
            // Remove old listener by cloning
            var newListContainer = listContainer.cloneNode(true);
            listContainer.parentNode.replaceChild(newListContainer, listContainer);

            newListContainer.addEventListener('click', function(e) {
                var item = e.target.closest('.class-list-item');
                if (item) {
                    var classId = item.dataset.id;
                    if (classId) {
                        handleClassSelect(container, classId);
                    }
                }
            });
        }

        // Class detail action buttons (delegated)
        var detailContainer = document.getElementById('class-detail');
        if (detailContainer) {
            var newDetailContainer = detailContainer.cloneNode(true);
            detailContainer.parentNode.replaceChild(newDetailContainer, detailContainer);

            newDetailContainer.addEventListener('click', function(e) {
                // Manage Members button
                var manageBtn = e.target.closest('#manage-members-btn');
                if (manageBtn) {
                    var classId = manageBtn.dataset.classId;
                    if (classId) {
                        handleManageMembers(container, classId);
                    }
                    return;
                }

                // Edit button
                var editBtn = e.target.closest('#edit-class-btn');
                if (editBtn) {
                    var classId = editBtn.dataset.classId;
                    if (classId) {
                        handleEditClass(container, classId);
                    }
                    return;
                }

                // Delete button
                var deleteBtn = e.target.closest('#delete-class-btn');
                if (deleteBtn) {
                    var classId = deleteBtn.dataset.classId;
                    if (classId) {
                        handleDeleteClass(container, classId);
                    }
                    return;
                }
            });
        }

        // ---- MEMBER MODAL EVENTS ----

        // Member modal close buttons
        var closeMemberBtn = document.getElementById('close-member-modal');
        if (closeMemberBtn) {
            var newCloseMember = closeMemberBtn.cloneNode(true);
            closeMemberBtn.parentNode.replaceChild(newCloseMember, closeMemberBtn);
            newCloseMember.addEventListener('click', function() {
                var modal = document.getElementById('member-modal');
                if (modal) {
                    modal.classList.add('hidden');
                    modal.style.display = 'none';
                }
            });
        }

        var closeMemberModalBtn = document.getElementById('close-member-modal-btn');
        if (closeMemberModalBtn) {
            var newCloseMemberModal = closeMemberModalBtn.cloneNode(true);
            closeMemberModalBtn.parentNode.replaceChild(newCloseMemberModal, closeMemberModalBtn);
            newCloseMemberModal.addEventListener('click', function() {
                var modal = document.getElementById('member-modal');
                if (modal) {
                    modal.classList.add('hidden');
                    modal.style.display = 'none';
                }
            });
        }

        // Member modal click outside
        var memberModal = document.getElementById('member-modal');
        if (memberModal) {
            var newMemberModal = memberModal.cloneNode(true);
            memberModal.parentNode.replaceChild(newMemberModal, memberModal);
            newMemberModal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                    this.style.display = 'none';
                }
            });
        }

        // ---- MOBILE SELECTOR ----

        var mobileSelect = document.getElementById('mobile-class-select');
        if (mobileSelect) {
            var newMobileSelect = mobileSelect.cloneNode(true);
            mobileSelect.parentNode.replaceChild(newMobileSelect, mobileSelect);
            newMobileSelect.addEventListener('change', function() {
                var classId = this.value;
                if (classId) {
                    // Update view state
                    if (window.ClassesView && typeof window.ClassesView.selectClass === 'function') {
                        window.ClassesView.selectClass(classId);
                    }
                    refreshUI(container);
                }
            });
        }

        // ---- FILTER EVENTS ----

        var applyFilterBtn = document.getElementById('apply-year-filter');
        if (applyFilterBtn) {
            var newApplyFilter = applyFilterBtn.cloneNode(true);
            applyFilterBtn.parentNode.replaceChild(newApplyFilter, applyFilterBtn);
            newApplyFilter.addEventListener('click', function() {
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
            });
        }

        var clearFilterBtn = document.getElementById('clear-year-filter');
        if (clearFilterBtn) {
            var newClearFilter = clearFilterBtn.cloneNode(true);
            clearFilterBtn.parentNode.replaceChild(newClearFilter, clearFilterBtn);
            newClearFilter.addEventListener('click', function() {
                var minInput = document.getElementById('filter-min-year');
                var maxInput = document.getElementById('filter-max-year');

                if (minInput) minInput.value = '';
                if (maxInput) maxInput.value = '';

                if (window.ClassesView && typeof window.ClassesView.setFilter === 'function') {
                    window.ClassesView.setFilter(null, null);
                }
                refreshUI(container);
            });
        }

        // ---- ADD MEMBER BUTTON ----

        var addMemberBtn = document.getElementById('add-member-btn');
        if (addMemberBtn) {
            var newAddMember = addMemberBtn.cloneNode(true);
            addMemberBtn.parentNode.replaceChild(newAddMember, addMemberBtn);
            newAddMember.addEventListener('click', function() {
                var select = document.getElementById('add-member-select');
                var roleSelect = document.getElementById('add-member-role');

                var charId = select ? select.value : null;
                var role = roleSelect ? roleSelect.value : 'trainee';
                var isInstructor = role === 'instructor';

                if (!charId) {
                    showNotification('Please select a character.', 'error');
                    return;
                }

                // Get current class ID from view state
                var classId = window.ClassesView ? window.ClassesView.getSelectedClassId() : null;
                if (!classId) {
                    showNotification('No class selected.', 'error');
                    return;
                }

                handleAddMember(container, classId, charId, isInstructor);
            });
        }

        // ---- REMOVE MEMBER (delegated) ----

        var memberContent = document.getElementById('member-modal-content');
        if (memberContent) {
            var newMemberContent = memberContent.cloneNode(true);
            memberContent.parentNode.replaceChild(newMemberContent, memberContent);

            newMemberContent.addEventListener('click', function(e) {
                var removeBtn = e.target.closest('.remove-member-btn');
                if (removeBtn) {
                    var charId = removeBtn.dataset.id;
                    if (charId) {
                        var classId = window.ClassesView ? window.ClassesView.getSelectedClassId() : null;
                        if (classId) {
                            handleRemoveMember(container, classId, charId);
                        } else {
                            showNotification('No class selected.', 'error');
                        }
                    }
                }
            });
        }

        // ---- RESIZE HANDLER (single, debounced) ----

        // Remove any existing resize listener to prevent accumulation
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
        // Remove resize listener
        if (window._classesResizeHandler) {
            window.removeEventListener('resize', window._classesResizeHandler);
            window._classesResizeHandler = null;
        }

        if (window._classesResizeTimeout) {
            clearTimeout(window._classesResizeTimeout);
            window._classesResizeTimeout = null;
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ClassesEvents = {
        init: initEvents,
        destroy: destroy,
        handleAddClass: handleAddClass,
        handleEditClass: handleEditClass,
        handleSaveClass: handleSaveClass,
        handleDeleteClass: handleDeleteClass,
        handleManageMembers: handleManageMembers,
        handleAddMember: handleAddMember,
        handleRemoveMember: handleRemoveMember,
        handleClassSelect: handleClassSelect
    };

})();
