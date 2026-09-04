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
 *   TabManager registers 'classes' → renderClasses() → 
 *   ClassesView.render() → ClassesEvents.init()
 * 
 * IMPORTANT:
 *   - This module is the only external entry point for classes
 *   - All class logic lives in the sub-modules
 *   - This module does NOT implement class logic directly
 *   - It delegates to sub-modules for all operations
 *   - renderClasses() is the ONLY function that constructs the full HTML
 *   - TabManager is the single source of truth for lifecycle
 * 
 * STATE SOURCE OF TRUTH:
 *   - classesState is the canonical edit state (PRIVATE)
 *   - window.data is the source of truth for persisted application data
 *   - ClassesQueries provides read-only access to class data
 *   - ClassesCore provides mutation operations
 * 
 * DEPENDENCIES:
 *   - window.ClassesView (from classes-view.js)
 *   - window.ClassesEvents (from classes-events.js)
 *   - window.ClassesQueries (from classes-queries.js)
 *   - window.ClassesCore (from classes-core.js)
 *   - window.TabManager (from tab-manager.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.ActivityLog (from activity-log.js)
 *   - window.DomUtils (from dom-utils.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__classesMainLoaded) {
        return;
    }
    window.__classesMainLoaded = true;

    // ============================================================
    // STATE - Single source of truth for class edit state
    // ============================================================

    var _state = {
        selectedClassId: null,
        distributionWeek: 1,
        maxTeamSize: 4
    };

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ClassesView = window.ClassesView || null;
    var ClassesEvents = window.ClassesEvents || null;
    var ClassesQueries = window.ClassesQueries || window;
    var ClassesCore = window.ClassesCore || window;
    var TabManager = window.TabManager || null;
    var NotificationSystem = window.NotificationSystem || window;
    var ActivityLog = window.ActivityLog || window;
    var DomUtils = window.DomUtils || window;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // ClassesView is MANDATORY
        if (!ClassesView || typeof ClassesView.render !== 'function') {
            missing.push('ClassesView.render');
        }

        // ClassesEvents is MANDATORY
        if (!ClassesEvents || typeof ClassesEvents.init !== 'function') {
            missing.push('ClassesEvents.init');
        }

        // ClassesQueries is MANDATORY
        if (!ClassesQueries || typeof ClassesQueries.getClasses !== 'function') {
            missing.push('ClassesQueries.getClasses');
        }
        if (!ClassesQueries || typeof ClassesQueries.getClass !== 'function') {
            missing.push('ClassesQueries.getClass');
        }

        // ClassesCore is MANDATORY
        if (!ClassesCore || typeof ClassesCore.createClass !== 'function') {
            missing.push('ClassesCore.createClass');
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
            console.warn('ClassesMain: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // STATE MANAGEMENT - Private, exposed via controlled API
    // ============================================================

    /**
     * Get the current class state.
     * @returns {object} Current state
     */
    function getState() {
        return {
            selectedClassId: _state.selectedClassId,
            distributionWeek: _state.distributionWeek || 1,
            maxTeamSize: _state.maxTeamSize || 4
        };
    }

    /**
     * Set the current class state.
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

        if (newState.distributionWeek !== undefined && newState.distributionWeek !== _state.distributionWeek) {
            var week = parseInt(newState.distributionWeek, 10);
            if (!isNaN(week) && week >= 1 && week <= 52) {
                _state.distributionWeek = week;
                changed = true;
            }
        }

        if (newState.maxTeamSize !== undefined && newState.maxTeamSize !== _state.maxTeamSize) {
            var size = parseInt(newState.maxTeamSize, 10);
            if (!isNaN(size) && size >= 1 && size <= 20) {
                _state.maxTeamSize = size;
                changed = true;
            }
        }

        if (changed) {
            // Notify any listeners if needed
            if (typeof window.updateDashboardStats === 'function') {
                window.updateDashboardStats();
            }
        }
    }

    /**
     * Select a class by ID.
     * @param {string} classId - Class ID
     */
    function selectClass(classId) {
        if (classId && !ClassesQueries.getClass(classId)) {
            console.warn('ClassesMain: Class not found:', classId);
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
    // RENDER CLASSES - Main entry point
    // ============================================================

    function renderClasses(container) {
        if (!checkDependencies()) {
            if (container) {
                container.innerHTML = '<p class="empty-state">Class dependencies not loaded. Please refresh the page.</p>';
            }
            return;
        }

        if (!container) {
            container = document.getElementById('tab-classes');
        }

        if (!container) {
            console.warn('ClassesMain: Container not found');
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading class data...</p>';
            return;
        }

        // Ensure curriculum is initialized
        if (typeof window.ensureCurriculum === 'function') {
            try {
                window.ensureCurriculum();
            } catch (e) {
                console.warn('ClassesMain: ensureCurriculum() failed:', e);
            }
        }

        // Render the class container
        container.innerHTML = getClassesHTML();

        // Initialize ClassesView
        if (ClassesView && typeof ClassesView.render === 'function') {
            try {
                ClassesView.render(container);
            } catch (e) {
                console.warn('ClassesMain: ClassesView.render failed:', e);
                container.querySelector('#class-list').innerHTML = 
                    '<p class="empty-state">Error loading class list. Please refresh.</p>';
            }
        }

        // Initialize ClassesEvents
        if (ClassesEvents && typeof ClassesEvents.init === 'function') {
            try {
                ClassesEvents.init(container);
            } catch (e) {
                console.warn('ClassesMain: ClassesEvents.init failed:', e);
            }
        }

        // Select the current class if any
        if (_state.selectedClassId && ClassesQueries.getClass(_state.selectedClassId)) {
            if (ClassesView && typeof ClassesView.selectClass === 'function') {
                ClassesView.selectClass(container, _state.selectedClassId);
            }
        }
    }

    // ============================================================
    // CLASSES HTML
    // ============================================================

    function getClassesHTML() {
        var selectedId = _state.selectedClassId || '';

        return `
            <div class="classes-layout">
                <div class="page-header">
                    <h2>Academic Classes</h2>
                    <button id="add-class-btn" class="primary">+ New Class</button>
                </div>
                <div class="classes-layout-grid" style="display:grid;grid-template-columns:1fr 2fr;gap:16px;">
                    <div id="class-list-container" class="class-list-panel" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;max-height:500px;overflow-y:auto;">
                        <div id="class-list">
                            <p class="empty-state">No classes created yet.</p>
                        </div>
                    </div>
                    <div id="class-detail-container" class="class-detail-panel" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;">
                        <div id="class-detail">
                            <p class="empty-state">Select a class to view details.</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Class Form Modal -->
            <div id="class-form-modal" class="modal hidden">
                <div class="modal-content" style="max-width:450px;">
                    <div class="modal-header">
                        <h3 id="class-form-title">Add Class</h3>
                        <button class="close-modal" id="close-class-form">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="class-form-inner">
                            <div class="form-group">
                                <label>Class Name *</label>
                                <input type="text" id="class-name" placeholder="e.g., Spring 1424, March 1436" required>
                                <span style="font-size:0.6rem;color:var(--text-dim);">Free text - use any naming convention you prefer.</span>
                            </div>
                            <div class="form-actions">
                                <button type="button" id="cancel-class-form" class="secondary">Cancel</button>
                                <button type="submit" id="save-class-btn" class="primary">Save Class</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <!-- Distribute Modal -->
            <div id="distribute-modal" class="modal hidden">
                <div class="modal-content" style="max-width:550px;">
                    <div class="modal-header">
                        <h3>Auto-Distribute Students</h3>
                        <button class="close-modal" id="close-distribute-modal">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div id="distribute-content"></div>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // REFRESH FUNCTIONS
    // ============================================================

    /**
     * Refresh the class list only.
     */
    function refreshClassList() {
        var container = document.getElementById('tab-classes');
        if (!container) return;

        if (ClassesView && typeof ClassesView.renderClassList === 'function') {
            ClassesView.renderClassList(container);
        }
    }

    /**
     * Refresh the class detail only.
     */
    function refreshClassDetail() {
        var container = document.getElementById('tab-classes');
        if (!container) return;

        if (ClassesView && typeof ClassesView.renderClassDetail === 'function') {
            ClassesView.renderClassDetail(container);
        }
    }

    /**
     * Refresh the entire classes UI.
     */
    function refreshUI() {
        var container = document.getElementById('tab-classes');
        if (!container) return;

        if (ClassesView && typeof ClassesView.render === 'function') {
            ClassesView.render(container);
        }
    }

    // ============================================================
    // REGISTER WITH TABMANAGER - Single lifecycle path
    // ============================================================

    function registerWithTabManager() {
        if (TabManager && typeof TabManager.register === 'function') {
            TabManager.register('classes', renderClasses);
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
    // LIFECYCLE EVENTS
    // ============================================================

    document.addEventListener('dataReady', function() {
        var container = document.getElementById('tab-classes');
        if (container && container.style.display !== 'none') {
            renderClasses(container);
        }
    });

    document.addEventListener('tabChanged', function(e) {
        if (!e || !e.detail) {
            return;
        }

        if (e.detail.tab === 'classes') {
            var container = document.getElementById('tab-classes');
            if (container) {
                renderClasses(container);
            }
        }
    });

    // ============================================================
    // EXPOSE - Controlled public API only
    // ============================================================

    // Main render function
    window.renderClasses = renderClasses;

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

    // ============================================================
    // AUTO-INIT
    // ============================================================

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-classes');
            if (container && container.style.display !== 'none') {
                renderClasses(container);
            }
        }, 100);
    }

})();
