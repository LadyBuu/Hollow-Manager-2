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
            console.warn('AcademyEvents: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__academyEventsLoaded = true;

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
            console.warn('AcademyEvents: Container not found');
            return;
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

            // Update buttons
            var btns = nav.querySelectorAll('.tab-btn');
            for (var i = 0; i < btns.length; i++) {
                btns[i].classList.remove('active');
            }
            btn.classList.add('active');

            // Update state
            AcademyState.switchSubTab(subTab);

            // Update panel visibility
            var panels = container.querySelectorAll('.academy-tab-panel');
            for (var j = 0; j < panels.length; j++) {
                var panel = panels[j];
                var isActive = panel.dataset.tab === subTab;
                panel.style.display = isActive ? 'block' : 'none';
                panel.classList.toggle('active', isActive);
            }

            // Refresh content
            refreshSubTab(subTab);
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
            refreshAcademy();
            showNotification('Refreshed', 'info');
        });
    }

    // ============================================================
    // SUB-TAB EVENT BINDING - Delegates to sub-tab modules
    // ============================================================

    function bindSubTabEvents(container) {
        // Class tab events
        var classPanel = container.querySelector('.academy-tab-panel[data-tab="class"]');
        if (classPanel && ClassTab && typeof ClassTab.bindEvents === 'function') {
            try {
                var cleanup = ClassTab.bindEvents(classPanel);
                if (typeof cleanup === 'function') {
                    _subTabCleanups.push(cleanup);
                }
            } catch (e) {
                console.warn('AcademyEvents: ClassTab.bindEvents failed:', e);
            }
        }

        // Student tab events
        var studentPanel = container.querySelector('.academy-tab-panel[data-tab="student"]');
        if (studentPanel && StudentTab && typeof StudentTab.bindEvents === 'function') {
            try {
                var cleanup2 = StudentTab.bindEvents(studentPanel);
                if (typeof cleanup2 === 'function') {
                    _subTabCleanups.push(cleanup2);
                }
            } catch (e) {
                console.warn('AcademyEvents: StudentTab.bindEvents failed:', e);
            }
        }

        // Faculty tab events
        var facultyPanel = container.querySelector('.academy-tab-panel[data-tab="faculty"]');
        if (facultyPanel && FacultyTab && typeof FacultyTab.bindEvents === 'function') {
            try {
                var cleanup3 = FacultyTab.bindEvents(facultyPanel);
                if (typeof cleanup3 === 'function') {
                    _subTabCleanups.push(cleanup3);
                }
            } catch (e) {
                console.warn('AcademyEvents: FacultyTab.bindEvents failed:', e);
            }
        }
    }

    // ============================================================
    // SUB-TAB EVENT BINDING - Individual exports for direct binding
    // ============================================================

    function bindClassTabEvents(container) {
        if (ClassTab && typeof ClassTab.bindEvents === 'function') {
            return ClassTab.bindEvents(container);
        }
        return function() {};
    }

    function bindStudentTabEvents(container) {
        if (StudentTab && typeof StudentTab.bindEvents === 'function') {
            return StudentTab.bindEvents(container);
        }
        return function() {};
    }

    function bindFacultyTabEvents(container) {
        if (FacultyTab && typeof FacultyTab.bindEvents === 'function') {
            return FacultyTab.bindEvents(container);
        }
        return function() {};
    }

    // ============================================================
    // REFRESH HELPERS
    // ============================================================

    function refreshAcademy() {
        var container = document.getElementById('tab-academy');
        if (!container) {
            return;
        }

        var state = AcademyState.getState();
        var activeSubTab = state.activeSubTab;

        // Refresh the content
        var contentContainer = container.querySelector('#academy-subtab-content');
        if (!contentContainer) {
            return;
        }

        // Use the view renderer directly
        if (window.AcademyViews) {
            var html = '';
            switch (activeSubTab) {
                case 'class':
                    html = window.AcademyViews.renderClassTab(state);
                    break;
                case 'student':
                    html = window.AcademyViews.renderStudentTab(state);
                    break;
                case 'faculty':
                    html = window.AcademyViews.renderFacultyTab(state);
                    break;
                default:
                    html = '<p class="empty-state">Unknown sub-tab.</p>';
            }
            contentContainer.innerHTML = html;

            // Re-bind events for the active tab
            var panel = container.querySelector('.academy-tab-panel.active');
            if (panel) {
                switch (activeSubTab) {
                    case 'class':
                        ClassTab.bindEvents(panel);
                        break;
                    case 'student':
                        StudentTab.bindEvents(panel);
                        break;
                    case 'faculty':
                        FacultyTab.bindEvents(panel);
                        break;
                }
            }
        }
    }

    function refreshSubTab(subTab) {
        var container = document.getElementById('tab-academy');
        if (!container) {
            return;
        }

        var state = AcademyState.getState();
        var activeSubTab = subTab || state.activeSubTab;

        var contentContainer = container.querySelector('#academy-subtab-content');
        if (!contentContainer) {
            return;
        }

        if (window.AcademyViews) {
            var html = '';
            switch (activeSubTab) {
                case 'class':
                    html = window.AcademyViews.renderClassTab(state);
                    break;
                case 'student':
                    html = window.AcademyViews.renderStudentTab(state);
                    break;
                case 'faculty':
                    html = window.AcademyViews.renderFacultyTab(state);
                    break;
                default:
                    html = '<p class="empty-state">Unknown sub-tab.</p>';
            }
            contentContainer.innerHTML = html;

            // Re-bind events for the active tab
            var panel = container.querySelector('.academy-tab-panel.active');
            if (panel) {
                switch (activeSubTab) {
                    case 'class':
                        ClassTab.bindEvents(panel);
                        break;
                    case 'student':
                        StudentTab.bindEvents(panel);
                        break;
                    case 'faculty':
                        FacultyTab.bindEvents(panel);
                        break;
                }
            }

            // If student tab, refresh character list
            if (activeSubTab === 'student' && window.CharacterList) {
                window.CharacterList.render();
            }
        }
    }

    // ============================================================
    // ACADEMY CONTAINER HTML (shared with index.js)
    // ============================================================

    function getAcademyContainerHTML(activeSubTab) {
        activeSubTab = activeSubTab || 'class';

        var html = '';

        // Header
        html += '<div class="academy-header">';
        html += '<h2>Academic Year</h2>';
        html += '<div class="academy-header-actions">';
        html += '<button id="academy-refresh-btn" class="small secondary">↻ Refresh</button>';
        html += '</div>';
        html += '</div>';

        // Tabs
        html += getAcademyTabsHTML(activeSubTab);

        // Content container
        html += '<div id="academy-subtab-content">';
        html += '<!-- Sub-tab content will be rendered here -->';
        html += '</div>';

        return html;
    }

    function getAcademyTabsHTML(activeSubTab) {
        activeSubTab = activeSubTab || 'class';

        var tabs = [
            { id: 'class', label: 'Classes' },
            { id: 'student', label: 'Students' },
            { id: 'faculty', label: 'Faculty' }
        ];

        var html = '';
        html += '<div class="academy-tab-nav">';
        for (var i = 0; i < tabs.length; i++) {
            var tab = tabs[i];
            var isActive = tab.id === activeSubTab;
            html += '<button class="tab-btn' + (isActive ? ' active' : '') + '" data-tab="' + escapeHtml(tab.id) + '">' + escapeHtml(tab.label) + '</button>';
        }
        html += '</div>';

        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyEvents = {
        // Main lifecycle
        init: init,
        destroy: destroy,

        // Refresh
        refreshAcademy: refreshAcademy,
        refreshSubTab: refreshSubTab,

        // Sub-tab event binding
        bindClassTabEvents: bindClassTabEvents,
        bindStudentTabEvents: bindStudentTabEvents,
        bindFacultyTabEvents: bindFacultyTabEvents,

        // HTML generators
        getAcademyContainerHTML: getAcademyContainerHTML,
        getAcademyTabsHTML: getAcademyTabsHTML,

        // Utilities
        addSafeEventListener: addSafeEventListener,
        removeAllEventListeners: removeAllEventListeners
    };

})();