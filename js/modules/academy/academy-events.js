/**
 * js/modules/academy/academy-events.js - Academy Events
 * UI event binding for the academy module
 * Path: js/modules/academy/academy-events.js
 * 
 * This module is responsible for:
 *   - Binding all UI events for the academy module
 *   - Delegating to the appropriate sub-tab event handlers
 *   - Managing global academy events (week selection, class selection)
 *   - Safe event binding with proper cleanup
 * 
 * IMPORTANT:
 *   - This module binds events AFTER the DOM is rendered
 *   - Uses event delegation where possible for dynamic elements
 *   - All mutations delegate to domain cores
 *   - Safe event binding with proper cleanup
 *   - No inline event handlers in HTML
 *   - Can be re-initialized after DOM replacement
 *   - All HTML escaping uses DomUtils.escapeHtml()
 *   - All notifications use NotificationSystem.notify()
 * 
 * LIFECYCLE:
 *   - init(container) - Binds events to the current DOM
 *   - destroy() - Removes all event listeners and resets state
 *   - Re-initialization is supported for dynamic DOM replacement
 * 
 * DEPENDENCIES:
 *   - window.AcademyState (from academy-state.js)
 *   - window.ClassTab (from tabs/class-tab.js)
 *   - window.StudentTab (from tabs/student-tab.js)
 *   - window.FacultyTab (from tabs/faculty-tab.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.saveData (from database.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__academyEventsLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var AcademyState = window.AcademyState;
    var ClassTab = window.ClassTab;
    var StudentTab = window.StudentTab;
    var FacultyTab = window.FacultyTab;
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademyState || typeof AcademyState.getState !== 'function') {
            missing.push('AcademyState.getState');
        }
        if (!AcademyState || typeof AcademyState.switchSubTab !== 'function') {
            missing.push('AcademyState.switchSubTab');
        }

        if (!ClassTab || typeof ClassTab.bindEvents !== 'function') {
            missing.push('ClassTab.bindEvents');
        }

        if (!StudentTab || typeof StudentTab.bindEvents !== 'function') {
            missing.push('StudentTab.bindEvents');
        }

        if (!FacultyTab || typeof FacultyTab.bindEvents !== 'function') {
            missing.push('FacultyTab.bindEvents');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (missing.length > 0) {
            throw new Error('AcademyEvents: Missing dependencies: ' + missing.join(', '));
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // NOTIFICATION - Delegates to NotificationSystem
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    // ============================================================
    // STATE - Event listener tracking
    // ============================================================

    var _eventListeners = [];
    var _initialized = false;
    var _subTabCleanups = [];

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

        // Clean up sub-tab event listeners
        for (var j = 0; j < _subTabCleanups.length; j++) {
            try {
                if (typeof _subTabCleanups[j] === 'function') {
                    _subTabCleanups[j]();
                }
            } catch (e) {
                // Ignore errors during cleanup
            }
        }
        _subTabCleanups = [];
    }

    // ============================================================
    // MAIN INITIALIZATION - Supports re-initialization
    // ============================================================

    function init(container) {
        if (!container) {
            container = document.getElementById('tab-academy');
        }
        if (!container) {
            throw new Error('AcademyEvents: Container not found');
        }

        // Remove existing listeners before binding new ones
        removeAllEventListeners();

        // Bind global academy events
        bindSubTabSwitching(container);
        bindRefreshButton(container);

        // Bind sub-tab specific events
        bindSubTabEvents(container);

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
    // SUB-TAB SWITCHING
    // ============================================================

    function bindSubTabSwitching(container) {
        var nav = container.querySelector('.academy-tab-nav');
        if (!nav) {
            return;
        }

        addSafeEventListener(nav, 'click', function(e) {
            var btn = e.target.closest('.tab-btn');
            if (!btn) {
                return;
            }

            var subTab = btn.dataset.tab;
            if (!subTab) {
                return;
            }

            // Update state - rendering layer will reflect this
            AcademyState.switchSubTab(subTab);

            // Dispatch event for controller to handle
            var event = new CustomEvent('academy:subtabchange', {
                detail: { subTab: subTab }
            });
            document.dispatchEvent(event);
        });
    }

    // ============================================================
    // REFRESH BUTTON
    // ============================================================

    function bindRefreshButton(container) {
        var refreshBtn = container.querySelector('#academy-refresh-btn');
        if (!refreshBtn) {
            return;
        }

        addSafeEventListener(refreshBtn, 'click', function() {
            // Dispatch event for controller to handle
            var event = new CustomEvent('academy:refresh', {
                detail: {}
            });
            document.dispatchEvent(event);
        });
    }

    // ============================================================
    // SUB-TAB EVENT BINDING - Delegates to sub-tab modules
    // ============================================================

    function bindSubTabEvents(container) {
        // Class tab events
        var classPanel = container.querySelector('.academy-tab-panel[data-tab="class"]');
        if (classPanel) {
            try {
                var cleanup = ClassTab.bindEvents(classPanel);
                if (typeof cleanup === 'function') {
                    _subTabCleanups.push(cleanup);
                }
            } catch (e) {
                throw new Error('AcademyEvents: ClassTab.bindEvents failed: ' + e.message);
            }
        }

        // Student tab events
        var studentPanel = container.querySelector('.academy-tab-panel[data-tab="student"]');
        if (studentPanel) {
            try {
                var cleanup2 = StudentTab.bindEvents(studentPanel);
                if (typeof cleanup2 === 'function') {
                    _subTabCleanups.push(cleanup2);
                }
            } catch (e) {
                throw new Error('AcademyEvents: StudentTab.bindEvents failed: ' + e.message);
            }
        }

        // Faculty tab events
        var facultyPanel = container.querySelector('.academy-tab-panel[data-tab="faculty"]');
        if (facultyPanel) {
            try {
                var cleanup3 = FacultyTab.bindEvents(facultyPanel);
                if (typeof cleanup3 === 'function') {
                    _subTabCleanups.push(cleanup3);
                }
            } catch (e) {
                throw new Error('AcademyEvents: FacultyTab.bindEvents failed: ' + e.message);
            }
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyEvents = {
        // Main lifecycle
        init: init,
        destroy: destroy,

        // Utilities
        addSafeEventListener: addSafeEventListener,
        removeAllEventListeners: removeAllEventListeners,

        // Internal (exposed for testing/debugging)
        _getListeners: function() {
            return _eventListeners.slice();
        },
        _getSubTabCleanups: function() {
            return _subTabCleanups.slice();
        }
    };

})();