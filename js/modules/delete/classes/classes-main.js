/**
 * js/modules/classes/classes-main.js - Classes Main Entry Point
 * Single entry point for all class functionality
 * Path: js/modules/classes/classes-main.js
 * 
 * This module is responsible for:
 *   - Registering with TabManager
 *   - Rendering the class container
 *   - Initializing all class sub-modules
 *   - Managing class lifecycle
 * 
 * LIFECYCLE:
 *   TabManager registers 'classes' → mountClasses() → 
 *   ClassesView.render() → ClassesEvents.init()
 * 
 * IMPORTANT:
 *   - This module is the only external entry point for classes
 *   - All class logic lives in the sub-modules
 *   - This module does NOT implement class logic directly
 *   - It delegates to sub-modules for all operations
 *   - TabManager is the single source of truth for lifecycle
 * 
 * STATE SOURCE OF TRUTH:
 *   - classesState is the canonical UI state (PRIVATE)
 *   - window.data is the source of truth for persisted application data
 *   - ClassesQueries provides read-only access to class data
 *   - ClassesCore provides mutation operations
 * 
 * DEPENDENCIES:
 *   - window.ClassesView (from classes-view.js)
 *   - window.ClassesEvents (from classes-events.js)
 *   - window.ClassesQueries (from classes-queries.js)
 *   - window.TabManager (from tab-manager.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__classesMainLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var ClassesView = window.ClassesView;
    var ClassesEvents = window.ClassesEvents;
    var ClassesQueries = window.ClassesQueries;
    var TabManager = window.TabManager;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!ClassesView || typeof ClassesView.render !== 'function') {
            missing.push('ClassesView.render');
        }

        if (!ClassesEvents || typeof ClassesEvents.init !== 'function') {
            missing.push('ClassesEvents.init');
        }

        if (!ClassesQueries || typeof ClassesQueries.getClasses !== 'function') {
            missing.push('ClassesQueries.getClasses');
        }
        if (!ClassesQueries || typeof ClassesQueries.getClass !== 'function') {
            missing.push('ClassesQueries.getClass');
        }

        if (!TabManager || typeof TabManager.register !== 'function') {
            missing.push('TabManager.register');
        }

        if (missing.length > 0) {
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__classesMainLoaded = true;

    // ============================================================
    // STATE - Transient UI state for the classes interface
    // ============================================================

    var _state = {
        selectedClassId: null,
        distributionWeek: 1,
        maxTeamSize: 4
    };

    // ============================================================
    // STATE MANAGEMENT - Private, exposed via controlled API
    // ============================================================

    /**
     * Get the current class UI state.
     * @returns {object} Current state
     */
    function getState() {
        return {
            selectedClassId: _state.selectedClassId,
            distributionWeek: _state.distributionWeek,
            maxTeamSize: _state.maxTeamSize
        };
    }

    /**
     * Set the current class UI state.
     * @param {object} newState - New state values
     */
    function setState(newState) {
        if (!newState || typeof newState !== 'object') {
            return;
        }

        var changed = false;

        if (newState.selectedClassId !== undefined && newState.selectedClassId !== _state.selectedClassId) {
            _state.selectedClassId = newState.selectedClassId;
            changed = true;
        }

        if (newState.distributionWeek !== undefined) {
            var week = parseInt(newState.distributionWeek, 10);
            if (!isNaN(week) && week >= 1 && week <= 52) {
                if (week !== _state.distributionWeek) {
                    _state.distributionWeek = week;
                    changed = true;
                }
            }
        }

        if (newState.maxTeamSize !== undefined) {
            var size = parseInt(newState.maxTeamSize, 10);
            if (!isNaN(size) && size >= 1 && size <= 20) {
                if (size !== _state.maxTeamSize) {
                    _state.maxTeamSize = size;
                    changed = true;
                }
            }
        }
    }

    /**
     * Select a class by ID.
     * @param {string} classId - Class ID
     */
    function selectClass(classId) {
        if (classId && !ClassesQueries.getClass(classId)) {
            return;
        }

        _state.selectedClassId = classId || null;
    }

    /**
     * Get the currently selected class ID.
     * @returns {string|null} Selected class ID
     */
    function getSelectedClassId() {
        return _state.selectedClassId;
    }

    /**
     * Clear the selected class.
     */
    function clearSelection() {
        _state.selectedClassId = null;
    }

    // ============================================================
    // RENDER CLASSES - Mount entry point
    // ============================================================

    function mountClasses(container) {
        if (!container) {
            container = document.getElementById('tab-classes');
        }

        if (!container) {
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading class data...</p>';
            return;
        }

        // Render the class container
        container.innerHTML = getClassesHTML();

        // Initialize ClassesView
        if (ClassesView && typeof ClassesView.render === 'function') {
            try {
                ClassesView.render(container);
            } catch (e) {
                var listContainer = container.querySelector('#class-list');
                if (listContainer) {
                    listContainer.innerHTML = '<p class="empty-state">Error loading class list. Please refresh.</p>';
                }
                return;
            }
        }

        // Initialize ClassesEvents
        if (ClassesEvents && typeof ClassesEvents.init === 'function') {
            try {
                ClassesEvents.init(container);
            } catch (e) {
                // Events are non-critical for display
            }
        }

        // Select the current class if any
        if (_state.selectedClassId && ClassesQueries.getClass(_state.selectedClassId)) {
            if (ClassesView && typeof ClassesView.selectClass === 'function') {
                ClassesView.selectClass(container, _state.selectedClassId);
            }
        }
    }

    /**
     * Refresh the classes UI (update existing content).
     */
    function refreshClasses(container) {
        if (!container) {
            container = document.getElementById('tab-classes');
        }

        if (!container) {
            return;
        }

        if (ClassesView && typeof ClassesView.render === 'function') {
            ClassesView.render(container);
        }
    }

    /**
     * Destroy the classes UI (clean up event listeners).
     */
    function destroyClasses() {
        if (ClassesEvents && typeof ClassesEvents.destroy === 'function') {
            ClassesEvents.destroy();
        }
    }

    // ============================================================
    // CLASSES HTML
    // ============================================================

    function getClassesHTML() {
        var selectedId = _state.selectedClassId || '';

        return [
            '<div class="classes-layout">',
                '<div class="page-header">',
                    '<h2>Academic Classes</h2>',
                    '<button id="add-class-btn" class="primary">+ New Class</button>',
                '</div>',
                '<div class="classes-layout-grid">',
                    '<div id="class-list-container" class="class-list-panel">',
                        '<div id="class-list">',
                            '<p class="empty-state">No classes created yet.</p>',
                        '</div>',
                    '</div>',
                    '<div id="class-detail-container" class="class-detail-panel">',
                        '<div id="class-detail">',
                            '<p class="empty-state">Select a class to view details.</p>',
                        '</div>',
                    '</div>',
                '</div>',
            '</div>',

            '<!-- Class Form Modal -->',
            '<div id="class-form-modal" class="modal hidden">',
                '<div class="modal-content">',
                    '<div class="modal-header">',
                        '<h3 id="class-form-title">Add Class</h3>',
                        '<button class="close-modal" id="close-class-form">&times;</button>',
                    '</div>',
                    '<div class="modal-body">',
                        '<form id="class-form-inner">',
                            '<div class="form-group">',
                                '<label>Class Name *</label>',
                                '<input type="text" id="class-name" placeholder="e.g., Spring 1424, March 1436" required>',
                                '<span class="field-hint">Free text - use any naming convention you prefer.</span>',
                            '</div>',
                            '<div class="form-actions">',
                                '<button type="button" id="cancel-class-form" class="secondary">Cancel</button>',
                                '<button type="submit" id="save-class-btn" class="primary">Save Class</button>',
                            '</div>',
                        '</form>',
                    '</div>',
                '</div>',
            '</div>',

            '<!-- Distribute Modal -->',
            '<div id="distribute-modal" class="modal hidden">',
                '<div class="modal-content">',
                    '<div class="modal-header">',
                        '<h3>Auto-Distribute Students</h3>',
                        '<button class="close-modal" id="close-distribute-modal">&times;</button>',
                    '</div>',
                    '<div class="modal-body">',
                        '<div id="distribute-content"></div>',
                    '</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    // ============================================================
    // REFRESH FUNCTIONS
    // ============================================================

    /**
     * Refresh the class list only.
     */
    function refreshClassList() {
        var container = document.getElementById('tab-classes');
        if (!container) {
            return;
        }

        if (ClassesView && typeof ClassesView.renderClassList === 'function') {
            ClassesView.renderClassList(container);
        }
    }

    /**
     * Refresh the class detail only.
     */
    function refreshClassDetail() {
        var container = document.getElementById('tab-classes');
        if (!container) {
            return;
        }

        if (ClassesView && typeof ClassesView.renderClassDetail === 'function') {
            ClassesView.renderClassDetail(container);
        }
    }

    /**
     * Refresh the entire classes UI.
     */
    function refreshUI() {
        var container = document.getElementById('tab-classes');
        if (!container) {
            return;
        }

        refreshClasses(container);
    }

    // ============================================================
    // REGISTER WITH TABMANAGER - Single lifecycle path
    // ============================================================

    function registerWithTabManager() {
        if (TabManager && typeof TabManager.register === 'function') {
            TabManager.register('classes', mountClasses);
            return true;
        }
        return false;
    }

    // Register immediately if TabManager is available
    if (!registerWithTabManager()) {
        // TabManager not ready - wait for it via event
        document.addEventListener('tabManagerReady', function() {
            registerWithTabManager();
        });
    }

    // ============================================================
    // EXPOSE - Controlled public API only
    // ============================================================

    // Main mount function
    window.renderClasses = mountClasses;

    // State management
    window.classesState = {
        getState: getState,
        setState: setState,
        selectClass: selectClass,
        getSelectedClassId: getSelectedClassId,
        clearSelection: clearSelection,
        refreshList: refreshClassList,
        refreshDetail: refreshClassDetail,
        refreshUI: refreshUI
    };

    // For backward compatibility
    window.getClassesState = getState;
    window.setClassesState = setState;
    window.selectClass = selectClass;
    window.getSelectedClassId = getSelectedClassId;
    window.clearClassSelection = clearSelection;
    window.refreshClasses = refreshUI;

    // Lifecycle
    window.destroyClasses = destroyClasses;

})();
