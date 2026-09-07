/**
 * js/modules/academy/index.js - Academy Module Entry Point
 * Single entry point for all academic year functionality
 * Path: js/modules/academy/index.js
 * 
 * This module consolidates:
 *   - Academy lifecycle management (mount/destroy)
 *   - Academy UI state coordination
 *   - Academy view rendering orchestration
 *   - Academy event lifecycle
 * 
 * LIFECYCLE:
 *   TabManager registers 'academy' -> mountAcademy() ->
 *   render shell -> render active sub-tab -> bind events
 * 
 * IMPORTANT:
 *   - This module is the only external entry point for academy
 *   - All academy logic lives in the sub-modules
 *   - TabManager is the single source of truth for lifecycle
 *   - No data mutations - all mutations delegate to domain cores
 *   - No direct window.data access - rely on bootstrap
 *   - All HTML escaping uses DomUtils.escapeHtml()
 *   - All notifications use NotificationSystem.notify()
 * 
 * DEPENDENCIES:
 *   - window.TabManager (from tab-manager.js)
 *   - window.AcademyState (from academy-state.js)
 *   - window.AcademyViews (from academy-views.js)
 *   - window.AcademyEvents (from academy-events.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.NotificationSystem (from notification.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academyModuleLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var TabManager = window.TabManager;
    var AcademyState = window.AcademyState;
    var AcademyViews = window.AcademyViews;
    var AcademyEvents = window.AcademyEvents;
    var DomUtils = window.DomUtils;
    var NotificationSystem = window.NotificationSystem;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!TabManager || typeof TabManager.register !== 'function') {
            missing.push('TabManager.register');
        }

        if (!AcademyState || typeof AcademyState.getState !== 'function') {
            missing.push('AcademyState.getState');
        }
        if (!AcademyState || typeof AcademyState.switchSubTab !== 'function') {
            missing.push('AcademyState.switchSubTab');
        }

        if (!AcademyViews || typeof AcademyViews.renderAcademy !== 'function') {
            missing.push('AcademyViews.renderAcademy');
        }
        if (!AcademyViews || typeof AcademyViews.renderActiveSubTab !== 'function') {
            missing.push('AcademyViews.renderActiveSubTab');
        }

        if (!AcademyEvents || typeof AcademyEvents.init !== 'function') {
            missing.push('AcademyEvents.init');
        }
        if (!AcademyEvents || typeof AcademyEvents.destroy !== 'function') {
            missing.push('AcademyEvents.destroy');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (missing.length > 0) {
            throw new Error('AcademyModule: Missing dependencies: ' + missing.join(', '));
        }

        return true;
    }

    // ============================================================
    // STATE - Single source of truth for academy UI state
    // ============================================================

    var _mounted = false;
    var _container = null;

    // ============================================================
    // NOTIFICATION - Delegates to NotificationSystem
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // RENDER FUNCTIONS
    // ============================================================

    /**
     * Render the complete Academy UI into the container.
     */
    function renderAcademy(container) {
        if (!container) {
            return;
        }

        var state = AcademyState.getState();
        var html = AcademyViews.renderAcademy(state);
        container.innerHTML = html;

        // Events are bound after rendering
        AcademyEvents.init(container);
    }

    /**
     * Render only the active sub-tab content.
     * Used for refresh operations.
     */
    function renderActiveSubTab(container) {
        if (!container) {
            return;
        }

        var state = AcademyState.getState();
        var contentContainer = container.querySelector('#academy-subtab-content');

        if (!contentContainer) {
            return;
        }

        var html = AcademyViews.renderActiveSubTab(state);
        contentContainer.innerHTML = html;
    }

    /**
     * Refresh the active sub-tab and re-bind events.
     */
    function refreshActiveSubTab(container) {
        if (!container) {
            return;
        }

        // Re-render the active sub-tab
        renderActiveSubTab(container);

        // Re-bind events for the active tab only
        // AcademyEvents handles the full init, but we only need to bind the active tab
        // For now, we re-init everything (safe because destroy cleans up first)
        AcademyEvents.destroy();
        AcademyEvents.init(container);
    }

    // ============================================================
    // MOUNT FUNCTION - Single source of truth for rendering
    // ============================================================

    function mountAcademy(container) {
        if (!container) {
            container = document.getElementById('tab-academy');
        }

        if (!container) {
            throw new Error('AcademyModule: Container not found');
        }

        // Destroy any existing instance
        if (_mounted) {
            destroyAcademy();
        }

        // Store reference
        _container = container;
        _mounted = true;

        // Render the complete academy
        renderAcademy(container);

        // Set up event listeners for state changes
        setupStateChangeListeners();
    }

    // ============================================================
    // STATE CHANGE LISTENERS
    // ============================================================

    function setupStateChangeListeners() {
        // Listen for sub-tab changes from AcademyEvents
        document.addEventListener('academy:subtabchange', function(e) {
            var subTab = e.detail && e.detail.subTab;
            if (subTab) {
                // State is already updated by AcademyEvents
                // Just re-render the active sub-tab
                refreshActiveSubTab(_container);
            }
        });

        // Listen for refresh requests from AcademyEvents
        document.addEventListener('academy:refresh', function() {
            refreshActiveSubTab(_container);
            showNotification('Refreshed', 'info');
        });
    }

    // ============================================================
    // DESTROY - Clean up
    // ============================================================

    function destroyAcademy() {
        if (AcademyEvents && typeof AcademyEvents.destroy === 'function') {
            AcademyEvents.destroy();
        }

        // Clear container
        if (_container) {
            _container.innerHTML = '';
        }

        _mounted = false;
        _container = null;

        // Remove event listeners
        document.removeEventListener('academy:subtabchange', null);
        document.removeEventListener('academy:refresh', null);
    }

    // ============================================================
    // REGISTER WITH TABMANAGER - Single lifecycle path
    // ============================================================

    function registerWithTabManager() {
        if (TabManager && typeof TabManager.register === 'function') {
            TabManager.register('academy', mountAcademy);
            return true;
        }
        return false;
    }

    // Register immediately if TabManager is available
    if (!registerWithTabManager()) {
        document.addEventListener('tabManagerReady', function() {
            registerWithTabManager();
        });
    }

    // ============================================================
    // EXPOSE - Controlled public API only
    // ============================================================

    window.Academy = {
        // Lifecycle
        mount: mountAcademy,
        destroy: destroyAcademy,

        // Refresh
        refresh: function() {
            if (_container) {
                refreshActiveSubTab(_container);
            }
        },

        // State access (read-only)
        getState: function() {
            return AcademyState.getState();
        },

        // State mutators (delegated)
        selectClass: function(classId) {
            return AcademyState.selectClass(classId);
        },
        selectWeek: function(week) {
            return AcademyState.selectWeek(week);
        },
        selectStudent: function(studentId) {
            return AcademyState.selectStudent(studentId);
        },
        selectInstructor: function(instructorId) {
            return AcademyState.selectInstructor(instructorId);
        },
        switchSubTab: function(subTab) {
            return AcademyState.switchSubTab(subTab);
        },
        clearSelections: function() {
            return AcademyState.clearSelections();
        },

        // Status
        isMounted: function() {
            return _mounted;
        }
    };

    // ============================================================
    // LEGACY COMPATIBILITY (DEPRECATED - Will be removed)
    // ============================================================

    // These aliases are provided for backward compatibility
    // during the migration from old Academy structure.
    // They will be removed in a future version.

    window.mountAcademy = mountAcademy;
    window.renderAcademy = renderAcademy;
    window.destroyAcademy = destroyAcademy;

    // Legacy state aliases
    window.academyState = {
        getState: AcademyState.getState,
        setState: AcademyState.setState,
        selectClass: AcademyState.selectClass,
        getSelectedClassId: AcademyState.getSelectedClassId,
        selectWeek: AcademyState.selectWeek,
        getSelectedWeek: AcademyState.getSelectedWeek,
        selectStudent: AcademyState.selectStudent,
        getSelectedStudentId: AcademyState.getSelectedStudentId,
        selectInstructor: AcademyState.selectInstructor,
        getSelectedInstructorId: AcademyState.getSelectedInstructorId,
        switchSubTab: AcademyState.switchSubTab,
        getActiveSubTab: AcademyState.getActiveSubTab,
        clearSelections: AcademyState.clearSelections
    };

    // Legacy refresh aliases
    window.refreshAcademy = function() {
        if (_container) {
            refreshActiveSubTab(_container);
        }
    };
    window.refreshSubTab = function(subTab) {
        if (subTab) {
            AcademyState.switchSubTab(subTab);
        }
        if (_container) {
            refreshActiveSubTab(_container);
        }
    };
    window.refreshClassList = function() {
        // Class list is part of ClassTab render - full refresh needed
        if (_container) {
            refreshActiveSubTab(_container);
        }
    };
    window.refreshStudentList = function() {
        // Student list is part of StudentTab render - full refresh needed
        if (_container) {
            refreshActiveSubTab(_container);
        }
    };
    window.refreshStudentDetail = function() {
        // Student detail is part of StudentTab render - full refresh needed
        if (_container) {
            refreshActiveSubTab(_container);
        }
    };
    window.refreshFacultyDetail = function() {
        // Faculty detail is part of FacultyTab render - full refresh needed
        if (_container) {
            refreshActiveSubTab(_container);
        }
    };

    // Legacy selection aliases
    window.getSelectedClass = AcademyState.getSelectedClassId;
    window.selectClass = AcademyState.selectClass;
    window.getSelectedWeek = AcademyState.getSelectedWeek;
    window.selectWeek = AcademyState.selectWeek;
    window.refreshAcademyView = function() {
        if (_container) {
            refreshActiveSubTab(_container);
        }
    };

})();