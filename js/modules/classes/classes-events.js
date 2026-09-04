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
 *   - USES TeamQueries for team data
 *   - USES NotificationSystem for notifications
 *   - USES ActivityLog for activity logging
 *   - USES DomUtils for DOM operations
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
 *   - window.TeamQueries (from team-queries.js)
 *   - window.ActivityLog (from activity-log.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.saveData (from database.js)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__classesEventsLoaded) {
        return;
    }
    window.__classesEventsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ClassesCore = window.ClassesCore || window;
    var ClassesQueries = window.ClassesQueries || window;
    var CharacterQueries = window.CharacterQueries || window;
    var TeamQueries = window.TeamQueries || window;
    var ActivityLog = window.ActivityLog || window;
    var NotificationSystem = window.NotificationSystem || window;
    var DomUtils = window.DomUtils || window;

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;
    var _eventListeners = [];

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // ClassesCore is MANDATORY
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

        // ClassesQueries is MANDATORY
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

        // CharacterQueries is MANDATORY
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }

        // TeamQueries is MANDATORY
        if (!TeamQueries || typeof TeamQueries.getActiveTeamMembers !== 'function') {
            missing.push('TeamQueries.getActiveTeamMembers');
        }

        // ActivityLog is MANDATORY
        if (!ActivityLog || typeof ActivityLog.record !== 'function') {
            missing.push('ActivityLog.record');
        }

        // NotificationSystem is MANDATORY
        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        // DomUtils is MANDATORY
        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (missing.length > 0) {
            console.warn('ClassesEvents: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // NOTIFICATION - Uses NotificationSystem (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        if (NotificationSystem && typeof NotificationSystem.notify === 'function') {
            NotificationSystem.notify(message, type);
        } else if (type === 'error') {
            alert('Error: ' + message);
        } else {
            alert(message);
        }
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
    // ACTIVITY LOGGING - Uses ActivityLog (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function recordActivity(message) {
        try {
            if (ActivityLog && typeof ActivityLog.record === 'function') {
                ActivityLog.record(message);
            }
        } catch (e) {
            // Ignore logging errors
        }
    }

    // ============================================================
    // PERSISTENCE HELPER
    // ============================================================

    function persistMutation(successMessage, errorMessage) {
        if (typeof window.saveData !== 'function') {
            console.warn('Persistence unavailable.');
            showNotification('Changes were applied in memory, but persistent storage is unavailable.', 'error');
            return;
        }

        window.saveData()
            .then(function() {
                if (successMessage) showNotification(successMessage, 'success');
            })
            .catch(function(err) {
                console.error('Persistence error:', err);
                if (errorMessage) showNotification(errorMessage, 'error');
            });
    }

    // ============================================================
    // SAFE EVENT BINDING WITH CLEANUP
    // ============================================================

    function addSafeEventListener(element, eventName, handler, options) {
        if (!element) return;
        element.addEventListener(eventName, handler, options || false);
        _eventListeners.push({
            element: element,
            eventName: eventName,
            handler: handler,
            options: options || false
        });
    }

    function removeAllEventListeners() {
        _eventListeners.forEach(function(item) {
            try {
                item.element.removeEventListener(item.eventName, item.handler, item.options);
            } catch (e) {
                // Ignore errors during cleanup
            }
        });
        _eventListeners = [];
    }

    // ============================================================
    // UI REFRESH HELPERS
    // ============================================================

    function refreshClassList(container) {
        if (window.ClassesView && typeof window.ClassesView.renderClassList === 'function') {
            window.ClassesView.renderClassList(container);
        }
    }

    function refreshClassDetail(container) {
        if (window.ClassesView && typeof window.ClassesView.renderClassDetail === 'function') {
            window.ClassesView.renderClassDetail(container);
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
        if (window.ClassesView && typeof window.ClassesView.showClassForm === 'function') {
            window.ClassesView.showClassForm(container);
        }
    }

    /**
     * Handle editing a class.
     */
    function handleEditClass(container, classId) {
        if (window.ClassesView && typeof window.ClassesView.showClassForm === 'function') {
            window.ClassesView.showClassForm(container, classId);
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
        var nameInput = document.getElementById('class-name');

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

        // Close modal
        var modal = document.getElementById('class-form-modal');
        if (modal) {
            modal.classList.add('hidden');
        }

        // Update state
        if (window.classesState) {
            window.classesState.selectedClassId = result.class ? result.class.id : editId;
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
        if (window.ClassesView && typeof window.ClassesView.showDistributeModal === 'function') {
            window.ClassesView.showDistributeModal(container, classId);
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

        var char = CharacterQueries.getCharacterById(charId);
        var charName = char ? CharacterQueries.getDisplayName(char) : 'Unknown';

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
        if (!checkDependencies()) {
            console.warn('ClassesEvents: Dependencies not met, skipping initialization');
            return;
        }

        if (!container) {
            container = document.getElementById('classes-content');
        }
        if (!container) {
            console.warn('ClassesEvents: Container not found');
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

        _initialized = true;
    }

    // ============================================================
    // DESTROY - Clean up for re-initialization
    // ============================================================

    function destroy() {
        removeAllEventListeners();
        _initialized = false;
    }

    // ============================================================
    // EVENT BINDING - Add Class
    // ============================================================

    function bindAddClass(container) {
        var addBtn = container ? container.querySelector('#add-class-btn') : document.getElementById('add-class-btn');

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
        var listContainer = container ? container.querySelector('#class-list') : document.getElementById('class-list');

        if (!listContainer) {
            // Try the container itself if it's the class list
            if (container && container.id === 'class-list') {
                listContainer = container;
            }
        }

        if (!listContainer) {
            console.warn('ClassesEvents: Class list container not found');
            return;
        }

        addSafeEventListener(listContainer, 'click', function(e) {
            // Find the clicked list item
            var item = e.target.closest ? e.target.closest('.class-list-item') : null;
            if (!item) return;
            if (!listContainer.contains(item)) return;

            var classId = item.dataset.id;
            if (!classId) return;

            // Update state
            if (window.classesState) {
                window.classesState.selectedClassId = classId;
            }

            refreshUI(container);
        });
    }

    // ============================================================
    // EVENT BINDING - Class Detail (Event Delegation)
    // ============================================================

    function bindClassDetail(container) {
        var detailContainer = container ? container.querySelector('#class-detail') : document.getElementById('class-detail');

        if (!detailContainer) {
            // Try the container itself if it's the detail container
            if (container && container.id === 'class-detail') {
                detailContainer = container;
            }
        }

        if (!detailContainer) {
            console.warn('ClassesEvents: Class detail container not found');
            return;
        }

        addSafeEventListener(detailContainer, 'click', function(e) {
            var button = e.target.closest ? e.target.closest('button') : null;
            if (!button) return;
            if (!detailContainer.contains(button)) return;

            var classId = button.dataset.id;

            // If no classId on button, try to find it from the detail container's state
            if (!classId && window.classesState) {
                classId = window.classesState.selectedClassId;
            }

            if (!classId) return;

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
        // Close form modal
        var closeFormBtn = document.getElementById('close-class-form');
        if (closeFormBtn) {
            addSafeEventListener(closeFormBtn, 'click', function() {
                var modal = document.getElementById('class-form-modal');
                if (modal) modal.classList.add('hidden');
            });
        }

        // Cancel form
        var cancelFormBtn = document.getElementById('cancel-class-form');
        if (cancelFormBtn) {
            addSafeEventListener(cancelFormBtn, 'click', function() {
                var modal = document.getElementById('class-form-modal');
                if (modal) modal.classList.add('hidden');
            });
        }

        // Form submit
        var form = document.getElementById('class-form-inner');
        if (form) {
            // Remove existing listener to avoid duplicates
            form.removeEventListener('submit', function(e) { handleSaveClass(e, container); });
            addSafeEventListener(form, 'submit', function(e) {
                handleSaveClass(e, container);
            });
        }

        // Click outside to close
        var formModal = document.getElementById('class-form-modal');
        if (formModal) {
            addSafeEventListener(formModal, 'click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                }
            });
        }
    }

    // ============================================================
    // EVENT BINDING - Distribute Modal
    // ============================================================

    function bindDistributeModal(container) {
        var modal = document.getElementById('distribute-modal');
        if (!modal) return;

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
                if (window.ClassesView && typeof window.ClassesView.executeDistribution === 'function') {
                    window.ClassesView.executeDistribution(container);
                }
            });
        }

        // Week and max size changes - handled by ClassesView
        var weekInput = document.getElementById('distribute-week');
        if (weekInput) {
            addSafeEventListener(weekInput, 'change', function() {
                if (window.ClassesView && typeof window.ClassesView.updateDistributeTeamList === 'function') {
                    window.ClassesView.updateDistributeTeamList(container);
                }
            });
        }

        var maxSizeInput = document.getElementById('distribute-max-size');
        if (maxSizeInput) {
            addSafeEventListener(maxSizeInput, 'change', function() {
                if (window.ClassesView && typeof window.ClassesView.updateDistributeTeamList === 'function') {
                    window.ClassesView.updateDistributeTeamList(container);
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
