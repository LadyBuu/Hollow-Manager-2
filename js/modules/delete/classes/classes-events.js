/**
 * js/modules/classes/classes-events.js - Classes Events
 * Path: js/modules/classes/classes-events.js
 * 
 * This module is responsible for UI event binding for the classes module.
 * All mutations delegate to the appropriate module (ClassesCore, etc.)
 * 
 * IMPORTANT:
 *   - This module binds events AFTER the DOM is rendered
 *   - Uses event delegation where possible for dynamic elements
 *   - All mutations delegate to ClassesCore
 *   - Safe event binding with proper cleanup
 *   - No inline event handlers in HTML
 *   - Can be re-initialized after DOM replacement
 *   - Mutation modules own their own persistence lifecycle
 *   - No direct mutation of window.data
 *   - USES ClassesCore for all class mutations
 *   - USES ClassesQueries for all class queries
 *   - USES CharacterQueries for character data
 *   - USES NotificationSystem for notifications
 *   - USES ActivityLog for activity logging
 *   - USES ClassesView for UI rendering
 * 
 * LIFECYCLE:
 *   - init(container) - Binds events to the current DOM
 *   - destroy() - Removes all event listeners and resets state
 *   - Re-initialization is supported for dynamic DOM replacement
 * 
 * DEPENDENCIES:
 *   - window.ClassesCore (from classes-core.js)
 *   - window.ClassesQueries (from classes-queries.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.ActivityLog (from activity-log.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.ClassesView (from classes-view.js)
 *   - window.saveData (from database.js)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__classesEventsLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var ClassesCore = window.ClassesCore;
    var ClassesQueries = window.ClassesQueries;
    var CharacterQueries = window.CharacterQueries;
    var ActivityLog = window.ActivityLog;
    var NotificationSystem = window.NotificationSystem;
    var ClassesView = window.ClassesView;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!ClassesCore || typeof ClassesCore.createClass !== 'function') {
            missing.push('ClassesCore.createClass');
        }
        if (!ClassesCore || typeof ClassesCore.updateClass !== 'function') {
            missing.push('ClassesCore.updateClass');
        }
        if (!ClassesCore || typeof ClassesCore.deleteClass !== 'function') {
            missing.push('ClassesCore.deleteClass');
        }
        if (!ClassesCore || typeof ClassesCore.addCharacterToClass !== 'function') {
            missing.push('ClassesCore.addCharacterToClass');
        }
        if (!ClassesCore || typeof ClassesCore.removeCharacterFromClass !== 'function') {
            missing.push('ClassesCore.removeCharacterFromClass');
        }

        if (!ClassesQueries || typeof ClassesQueries.getClasses !== 'function') {
            missing.push('ClassesQueries.getClasses');
        }
        if (!ClassesQueries || typeof ClassesQueries.getClass !== 'function') {
            missing.push('ClassesQueries.getClass');
        }
        if (!ClassesQueries || typeof ClassesQueries.getCharactersByClass !== 'function') {
            missing.push('ClassesQueries.getCharactersByClass');
        }
        if (!ClassesQueries || typeof ClassesQueries.getTeamsByClass !== 'function') {
            missing.push('ClassesQueries.getTeamsByClass');
        }

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }

        if (!ActivityLog || typeof ActivityLog.record !== 'function') {
            missing.push('ActivityLog.record');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!ClassesView || typeof ClassesView.renderClassList !== 'function') {
            missing.push('ClassesView.renderClassList');
        }
        if (!ClassesView || typeof ClassesView.renderClassDetail !== 'function') {
            missing.push('ClassesView.renderClassDetail');
        }
        if (!ClassesView || typeof ClassesView.showClassForm !== 'function') {
            missing.push('ClassesView.showClassForm');
        }
        if (!ClassesView || typeof ClassesView.showDistributeModal !== 'function') {
            missing.push('ClassesView.showDistributeModal');
        }

        if (missing.length > 0) {
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__classesEventsLoaded = true;

    // ============================================================
    // STATE
    // ============================================================

    var _eventListeners = [];

    // ============================================================
    // NOTIFICATION - Uses NotificationSystem (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // ACTIVITY LOGGING - Uses ActivityLog (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function recordActivity(message) {
        try {
            ActivityLog.record(message);
        } catch (e) {
            // Activity logging failure should not abort the operation
        }
    }

    // ============================================================
    // PERSISTENCE HELPER
    // ============================================================

    function persistMutation(successMessage, errorMessage) {
        if (typeof window.saveData !== 'function') {
            showNotification('Changes were applied in memory, but persistent storage is unavailable.', 'error');
            return;
        }

        window.saveData()
            .then(function() {
                if (successMessage) {
                    showNotification(successMessage, 'success');
                }
            })
            .catch(function() {
                if (errorMessage) {
                    showNotification(errorMessage, 'error');
                }
            });
    }

    // ============================================================
    // SAFE EVENT BINDING WITH CLEANUP
    // ============================================================

    function addSafeEventListener(element, eventName, handler, options) {
        if (!element) {
            return;
        }
        element.addEventListener(eventName, handler, options || false);
        _eventListeners.push({
            element: element,
            eventName: eventName,
            handler: handler,
            options: options || false
        });
    }

    function removeAllEventListeners() {
        for (var i = 0; i < _eventListeners.length; i++) {
            var item = _eventListeners[i];
            try {
                item.element.removeEventListener(item.eventName, item.handler, item.options);
            } catch (e) {
                // Ignore errors during cleanup
            }
        }
        _eventListeners = [];
    }

    // ============================================================
    // UI REFRESH HELPERS
    // ============================================================

    function refreshClassList(container) {
        if (ClassesView && typeof ClassesView.renderClassList === 'function') {
            ClassesView.renderClassList(container);
        }
    }

    function refreshClassDetail(container) {
        if (ClassesView && typeof ClassesView.renderClassDetail === 'function') {
            ClassesView.renderClassDetail(container);
        }
    }

    function refreshUI(container) {
        refreshClassList(container);
        refreshClassDetail(container);
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    /**
     * Handle adding a new class.
     */
    function handleAddClass(container) {
        if (ClassesView && typeof ClassesView.showClassForm === 'function') {
            ClassesView.showClassForm(container);
        }
    }

    /**
     * Handle editing a class.
     */
    function handleEditClass(container, classId) {
        if (ClassesView && typeof ClassesView.showClassForm === 'function') {
            ClassesView.showClassForm(container, classId);
        }
    }

    /**
     * Handle deleting a class.
     */
    function handleDeleteClass(container, classId) {
        var cls = ClassesQueries.getClass(classId);
        if (!cls) {
            showNotification('Class not found.', 'error');
            return;
        }

        var students = ClassesQueries.getCharactersByClass(classId);
        var teams = ClassesQueries.getTeamsByClass(classId);

        var message = 'Delete "' + cls.name + '" permanently?';

        if (students.length > 0 || teams.length > 0) {
            message += '\n\nThis class has ' + students.length + ' student(s) and ' + teams.length + ' team(s) assigned.';
            message += '\nAll references will be removed from students and teams.';
            message += '\n\nThis action cannot be undone.';
        }

        if (!confirm(message)) {
            return;
        }

        var result = ClassesCore.deleteClass(classId);

        if (result && result.success) {
            recordActivity('Deleted class: ' + cls.name);

            refreshUI(container);

            if (typeof window.updateDashboardStats === 'function') {
                window.updateDashboardStats();
            }

            persistMutation(
                'Class deleted successfully!',
                'Class deleted in memory, but persistence failed.'
            );
        } else {
            showNotification(result && result.message ? result.message : 'Failed to delete class.', 'error');
        }
    }

    /**
     * Handle saving a class (create or update).
     */
    function handleSaveClass(e, container) {
        e.preventDefault();

        var form = e.target;
        var editId = form.dataset.editId;

        // Find the name input inside the form
        var nameInput = form.querySelector('#class-name');
        if (!nameInput) {
            showNotification('Form elements not found. Please refresh.', 'error');
            return;
        }

        var name = nameInput.value.trim();

        if (!name) {
            showNotification('Class name is required.', 'error');
            return;
        }

        var result;

        if (editId) {
            result = ClassesCore.updateClass(editId, { name: name });
            if (!result || !result.success) {
                showNotification(result && result.message ? result.message : 'Failed to update class.', 'error');
                return;
            }
        } else {
            result = ClassesCore.createClass(name);
            if (!result || !result.success) {
                showNotification(result && result.message ? result.message : 'Failed to create class.', 'error');
                return;
            }
        }

        // Find the modal containing the form
        var modal = form.closest('.modal');
        if (modal) {
            modal.classList.add('hidden');
        }

        // Update state using the proper API
        if (window.classesState && typeof window.classesState.selectClass === 'function') {
            var classId = result.class ? result.class.id : editId;
            if (classId) {
                window.classesState.selectClass(classId);
            }
        }

        refreshUI(container);

        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }

        var successMsg = editId ? 'Class updated successfully.' : 'Class created successfully.';
        var errorMsg = 'Class changed in memory, but persistence failed.';
        persistMutation(successMsg, errorMsg);
    }

    /**
     * Handle auto-distribute students.
     */
    function handleDistribute(container, classId) {
        if (ClassesView && typeof ClassesView.showDistributeModal === 'function') {
            ClassesView.showDistributeModal(container, classId);
        }
    }

    /**
     * Handle adding a character to a class.
     */
    function handleAddCharacterToClass(container, classId, charId) {
        if (!classId || !charId) {
            showNotification('Class ID and Character ID are required.', 'error');
            return;
        }

        var result = ClassesCore.addCharacterToClass(charId, classId);

        if (!result || !result.success) {
            showNotification(result && result.message ? result.message : 'Failed to add character to class.', 'error');
            return;
        }

        recordActivity('Added character to class: ' + result.className);

        refreshUI(container);

        if (typeof window.renderCharacterList === 'function') {
            window.renderCharacterList();
        }

        persistMutation(
            'Character added to class successfully.',
            'Character added in memory, but persistence failed.'
        );
    }

    /**
     * Handle removing a character from a class.
     */
    function handleRemoveCharacterFromClass(container, classId, charId) {
        if (!classId || !charId) {
            showNotification('Class ID and Character ID are required.', 'error');
            return;
        }

        var character = CharacterQueries.getCharacterById(charId);
        var charName = character ? CharacterQueries.getDisplayName(character) : 'Unknown';

        if (!confirm('Remove "' + charName + '" from this class?')) {
            return;
        }

        var result = ClassesCore.removeCharacterFromClass(charId, classId);

        if (!result || !result.success) {
            showNotification(result && result.message ? result.message : 'Failed to remove character from class.', 'error');
            return;
        }

        recordActivity('Removed character from class: ' + result.className);

        refreshUI(container);

        if (typeof window.renderCharacterList === 'function') {
            window.renderCharacterList();
        }

        persistMutation(
            'Character removed from class successfully.',
            'Character removed in memory, but persistence failed.'
        );
    }

    // ============================================================
    // MAIN INITIALIZATION - Supports re-initialization
    // ============================================================

    function init(container) {
        if (!container) {
            container = document.getElementById('classes-content');
        }
        if (!container) {
            return;
        }

        // Remove existing listeners before binding new ones
        removeAllEventListeners();

        // Bind all events
        bindAddClass(container);
        bindClassList(container);
        bindClassDetail(container);
        bindFormModals(container);
        bindDistributeModal(container);
    }

    // ============================================================
    // DESTROY - Clean up for re-initialization
    // ============================================================

    function destroy() {
        removeAllEventListeners();
    }

    // ============================================================
    // EVENT BINDING - Add Class
    // ============================================================

    function bindAddClass(container) {
        var addBtn = container.querySelector('#add-class-btn');
        if (!addBtn) {
            addBtn = document.getElementById('add-class-btn');
        }

        if (addBtn) {
            addSafeEventListener(addBtn, 'click', function() {
                handleAddClass(container);
            });
        }
    }

    // ============================================================
    // EVENT BINDING - Class List (Event Delegation)
    // ============================================================

    function bindClassList(container) {
        var listContainer = container.querySelector('#class-list');
        if (!listContainer) {
            listContainer = container.querySelector('#class-list-container');
        }
        if (!listContainer) {
            return;
        }

        addSafeEventListener(listContainer, 'click', function(e) {
            var item = e.target.closest ? e.target.closest('.class-list-item') : null;
            if (!item) {
                return;
            }
            if (!listContainer.contains(item)) {
                return;
            }

            var classId = item.dataset.id;
            if (!classId) {
                return;
            }

            // Update state using the proper API
            if (window.classesState && typeof window.classesState.selectClass === 'function') {
                window.classesState.selectClass(classId);
            }

            refreshUI(container);
        });
    }

    // ============================================================
    // EVENT BINDING - Class Detail (Event Delegation)
    // ============================================================

    function bindClassDetail(container) {
        var detailContainer = container.querySelector('#class-detail');
        if (!detailContainer) {
            detailContainer = container.querySelector('#class-detail-container');
        }
        if (!detailContainer) {
            return;
        }

        addSafeEventListener(detailContainer, 'click', function(e) {
            var button = e.target.closest ? e.target.closest('button') : null;
            if (!button) {
                return;
            }
            if (!detailContainer.contains(button)) {
                return;
            }

            var classId = button.dataset.id;

            // If no classId on button, try to find it from the state
            if (!classId && window.classesState && typeof window.classesState.getSelectedClassId === 'function') {
                classId = window.classesState.getSelectedClassId();
            }

            if (!classId) {
                return;
            }

            // Edit class
            if (button.classList.contains('edit-class-btn')) {
                e.stopPropagation();
                handleEditClass(container, classId);
                return;
            }

            // Delete class
            if (button.classList.contains('delete-class-btn')) {
                e.stopPropagation();
                handleDeleteClass(container, classId);
                return;
            }

            // Distribute
            if (button.classList.contains('distribute-class-btn')) {
                e.stopPropagation();
                handleDistribute(container, classId);
                return;
            }

            // Add student to class
            if (button.classList.contains('add-student-btn')) {
                e.stopPropagation();
                // TODO: Replace with proper character picker UI
                var charId = button.dataset.characterId || prompt('Enter character ID:');
                if (charId) {
                    handleAddCharacterToClass(container, classId, charId);
                }
                return;
            }

            // Remove student from class
            if (button.classList.contains('remove-student-btn')) {
                e.stopPropagation();
                var charId = button.dataset.characterId;
                if (charId) {
                    handleRemoveCharacterFromClass(container, classId, charId);
                }
                return;
            }
        });
    }

    // ============================================================
    // EVENT BINDING - Form Modals
    // ============================================================

    function bindFormModals(container) {
        // Find the form modal
        var formModal = document.getElementById('class-form-modal');
        if (!formModal) {
            return;
        }

        // Close form modal
        var closeFormBtn = document.getElementById('close-class-form');
        if (closeFormBtn) {
            addSafeEventListener(closeFormBtn, 'click', function() {
                formModal.classList.add('hidden');
            });
        }

        // Cancel form
        var cancelFormBtn = document.getElementById('cancel-class-form');
        if (cancelFormBtn) {
            addSafeEventListener(cancelFormBtn, 'click', function() {
                formModal.classList.add('hidden');
            });
        }

        // Form submit
        var form = document.getElementById('class-form-inner');
        if (form) {
            addSafeEventListener(form, 'submit', function(e) {
                handleSaveClass(e, container);
            });
        }

        // Click outside to close
        addSafeEventListener(formModal, 'click', function(e) {
            if (e.target === this) {
                this.classList.add('hidden');
            }
        });
    }

    // ============================================================
    // EVENT BINDING - Distribute Modal
    // ============================================================

    function bindDistributeModal(container) {
        var modal = document.getElementById('distribute-modal');
        if (!modal) {
            return;
        }

        // Close buttons
        var closeBtn = document.getElementById('close-distribute-modal');
        if (closeBtn) {
            addSafeEventListener(closeBtn, 'click', function() {
                modal.classList.add('hidden');
            });
        }

        var cancelBtn = document.getElementById('cancel-distribute');
        if (cancelBtn) {
            addSafeEventListener(cancelBtn, 'click', function() {
                modal.classList.add('hidden');
            });
        }

        // Click outside to close
        addSafeEventListener(modal, 'click', function(e) {
            if (e.target === this) {
                this.classList.add('hidden');
            }
        });

        // Confirm distribute - handled by ClassesView
        var confirmBtn = document.getElementById('confirm-distribute');
        if (confirmBtn) {
            addSafeEventListener(confirmBtn, 'click', function() {
                if (ClassesView && typeof ClassesView.executeDistribution === 'function') {
                    ClassesView.executeDistribution(container);
                }
            });
        }

        // Week and max size changes - handled by ClassesView
        var weekInput = document.getElementById('distribute-week');
        if (weekInput) {
            addSafeEventListener(weekInput, 'change', function() {
                if (ClassesView && typeof ClassesView.updateDistributeTeamList === 'function') {
                    ClassesView.updateDistributeTeamList(container);
                }
            });
        }

        var maxSizeInput = document.getElementById('distribute-max-size');
        if (maxSizeInput) {
            addSafeEventListener(maxSizeInput, 'change', function() {
                if (ClassesView && typeof ClassesView.updateDistributeTeamList === 'function') {
                    ClassesView.updateDistributeTeamList(container);
                }
            });
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ClassesEvents = {
        init: init,
        destroy: destroy,
        removeAllEventListeners: removeAllEventListeners
    };

})();
