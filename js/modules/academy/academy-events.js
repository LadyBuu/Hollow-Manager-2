/**
 * modules/academy/academy-events.js - Academy Events
 * Authoritative rendering, refresh, and event coordinator for the
 * Academy tab.
 * 
 * This module is responsible for:
 *   - Owning the Academy tab container
 *   - Rendering the shell (sub-tab nav, week selector, content area)
 *   - Rendering the active sub-tab content by delegating to the
 *     ClassTab / StudentTab / FacultyTab modules
 *   - Binding sub-tab navigation and week selector
 *   - Delegating tab-content binding to the active tab module
 *   - Exposing refreshUI() as the SINGLE refresh entry point for the
 *     whole Academy tab
 * 
 * IMPORTANT:
 *   - AcademyEvents OWNS the container. No other module should call
 *     ClassTab.render / StudentTab.render / FacultyTab.render directly
 *     for the top-level tab content. Go through AcademyEvents.refreshUI.
 *   - refreshUI() is idempotent and safe to call from anywhere once
 *     init(container) has been called.
 *   - If refreshUI is called before init, it logs a warning and
 *     returns. This is defensive — mountAcademy calls init synchronously
 *     before anything else can refresh.
 * 
 * LIFECYCLE:
 *   mountAcademy(container)
 *     → AcademyEvents.init(container)
 *       → renderAcademyContainer(container)   // shell
 *       → refreshUI()                          // active sub-tab
 *       → bindAcademyEvents(container)         // shell-level events
 * 
 *   ClassTab (or any tab module) mutates state and calls:
 *     → AcademyEvents.refreshUI()
 *       → re-renders the active sub-tab content
 *       → re-binds tab-content events
 * 
 * PROMISE CONTRACT (v15+):
 *   - AcademyClasses.create / update / delete return Promises.
 *   - AcademyClasses.addStudent / removeStudent return Promises.
 *   - Other domain mutations are synchronous.
 * 
 * DEPENDENCIES:
 *   - window.AcademyUI (from academy-ui.js) - MANDATORY
 *   - window.AcademyAggregator (from academy-aggregator.js) - MANDATORY
 *   - window.NotificationSystem (from notification.js) - MANDATORY
 *   - window.ClassTab, window.StudentTab, window.FacultyTab - LAZY
 *     (only required when their sub-tab is active)
 * 
 * USAGE:
 *   // Called by academy/index.js on mount.
 *   AcademyEvents.init(container);
 * 
 *   // Called by tab modules after mutations.
 *   AcademyEvents.refreshUI();
 * 
 *   // Called by academy/index.js on unmount.
 *   AcademyEvents.destroy();
 */

(function() {
    'use strict';

    if (window.__academyEventsLoaded) {
        return;
    }
    window.__academyEventsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY
    // ============================================================

    var AcademyUI = window.AcademyUI;
    var AcademyAggregator = window.AcademyAggregator;
    var NotificationSystem = window.NotificationSystem;

    // ============================================================
    // DEPENDENCY CHECK - LOAD-TIME ONLY
    // ============================================================
    // ClassTab / StudentTab / FacultyTab are resolved lazily at
    // render time. They are not required at load time.

    function checkDependencies() {
        var missing = [];

        if (!AcademyUI || typeof AcademyUI.getActiveTab !== 'function') {
            missing.push('AcademyUI.getActiveTab');
        }
        if (!AcademyUI || typeof AcademyUI.setActiveTab !== 'function') {
            missing.push('AcademyUI.setActiveTab');
        }

        if (!AcademyAggregator || typeof AcademyAggregator.getClassListViewModel !== 'function') {
            missing.push('AcademyAggregator.getClassListViewModel');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (missing.length > 0) {
            console.warn('[AcademyEvents] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;
    var _container = null;
    var _eventListeners = [];

    // ============================================================
    // EVENT BINDING HELPERS
    // ============================================================

    function addEventListener(element, eventName, handler, options) {
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
        _eventListeners.forEach(function(item) {
            try {
                item.element.removeEventListener(item.eventName, item.handler, item.options);
            } catch (e) {
                // Ignore cleanup errors
            }
        });
        _eventListeners = [];
    }

    // ============================================================
    // NOTIFICATION
    // ============================================================

    function notify(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        if (window.DomUtils && typeof window.DomUtils.escapeHtml === 'function') {
            return window.DomUtils.escapeHtml(value);
        }
        if (value === undefined || value === null) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttribute(value) {
        if (window.DomUtils && typeof window.DomUtils.escapeAttribute === 'function') {
            return window.DomUtils.escapeAttribute(value);
        }
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // TAB RENDERERS
    // ============================================================
    // 
    // Each renderer checks whether the corresponding tab module is
    // loaded and, if so, delegates rendering to it. Falls back to a
    // minimal placeholder if the module isn't available.
    // 
    // The tab modules are resolved from window.* at call time, not
    // captured at load time, so late-loaded tab modules still work.

    function renderClassTab(state) {
        if (window.ClassTab && typeof window.ClassTab.render === 'function') {
            return window.ClassTab.render(state);
        }

        // Fallback: minimal class list
        var viewModel = AcademyAggregator.getClassListViewModel({ status: 'active' });
        var html = '<div class="academy-class-tab-fallback">';
        html += '<p class="empty-state">Class module not yet loaded.</p>';
        if (viewModel.classes.length > 0) {
            html += '<ul>';
            for (var i = 0; i < viewModel.classes.length; i++) {
                html += '<li>' + escapeHtml(viewModel.classes[i].name) + '</li>';
            }
            html += '</ul>';
        }
        html += '</div>';
        return html;
    }

    function renderStudentTab(state) {
        if (window.StudentTab && typeof window.StudentTab.render === 'function') {
            return window.StudentTab.render(state);
        }
        return '<p class="empty-state">Student module not yet loaded.</p>';
    }

    function renderFacultyTab(state) {
        if (window.FacultyTab && typeof window.FacultyTab.render === 'function') {
            return window.FacultyTab.render(state);
        }
        return '<p class="empty-state">Faculty module not yet loaded.</p>';
    }

    // ============================================================
    // REFRESH UI - SINGLE REFRESH ENTRY POINT
    // ============================================================

    /**
     * Re-render the active sub-tab content.
     * 
     * Safe to call from anywhere once init(container) has run.
     * Idempotent. Does nothing if the container is missing.
     */
    function refreshUI() {
        if (!_container) {
            console.warn('[AcademyEvents] refreshUI called before init. No container.');
            return;
        }

        var activeTab = AcademyUI.getActiveTab();
        var selectedClassId = AcademyUI.getSelectedClassId();
        var selectedStudentId = AcademyUI.getSelectedStudentId();
        var selectedInstructorId = AcademyUI.getSelectedInstructorId();
        var displayWeek = AcademyUI.getDisplayWeek();

        var tabContent = _container.querySelector('#academy-subtab-content');
        if (!tabContent) {
            console.warn('[AcademyEvents] #academy-subtab-content not found in container.');
            return;
        }

        var html = '';
        var state = {
            selectedClassId: selectedClassId,
            selectedStudentId: selectedStudentId,
            selectedInstructorId: selectedInstructorId,
            displayWeek: displayWeek
        };

        switch (activeTab) {
            case 'class':
                html = renderClassTab(state);
                break;
            case 'student':
                html = renderStudentTab(state);
                break;
            case 'faculty':
                html = renderFacultyTab(state);
                break;
            default:
                html = '<p class="empty-state">Unknown tab: ' + escapeHtml(activeTab) + '</p>';
        }

        tabContent.innerHTML = html;

        bindTabContentEvents(tabContent);
    }

    // ============================================================
    // SHELL RENDERING
    // ============================================================

    function renderAcademyContainer(container) {
        if (!container) {
            return;
        }

        var activeTab = AcademyUI.getActiveTab();
        var displayWeek = AcademyUI.getDisplayWeek();

        var subTabs = [];
        if (window.AcademyConstants && window.AcademyConstants.ACADEMY_SUBTABS) {
            subTabs = window.AcademyConstants.ACADEMY_SUBTABS;
        } else {
            subTabs = [
                { id: 'class', label: 'Classes' },
                { id: 'student', label: 'Students' },
                { id: 'faculty', label: 'Faculty' }
            ];
        }

        var html = '';

        // Sub-tab navigation
        html += '<div class="academy-subtab-nav">';
        for (var i = 0; i < subTabs.length; i++) {
            var tab = subTabs[i];
            var isActive = tab.id === activeTab;
            html += '<button class="academy-subtab-btn' + (isActive ? ' active' : '') + '" data-tab="' + escapeAttribute(tab.id) + '">';
            html += escapeHtml(tab.label);
            html += '</button>';
        }
        html += '</div>';

        // Week selector
        var minWeek = (window.CalendarConstants && window.CalendarConstants.MIN_WEEK) || 1;
        var maxWeek = (window.CalendarConstants && window.CalendarConstants.MAX_WEEK) || 52;
        html += '<div class="academy-week-selector">';
        html += '<label>Week:</label>';
        html += '<input type="number" class="academy-week-input" value="' + displayWeek + '" min="' + minWeek + '" max="' + maxWeek + '">';
        html += '<button class="academy-week-apply small secondary">Apply</button>';
        html += '</div>';

        // Content
        html += '<div id="academy-subtab-content" class="academy-subtab-content"></div>';

        container.innerHTML = html;

        // Initial render of the active sub-tab
        refreshUI();
    }

    // ============================================================
    // SHELL EVENT BINDING
    // ============================================================

    function bindAcademyEvents(container) {
        if (!container) {
            return;
        }

        // ---- Sub-tab switching ----
        var tabBtns = container.querySelectorAll('.academy-subtab-btn');
        for (var i = 0; i < tabBtns.length; i++) {
            var btn = tabBtns[i];
            addEventListener(btn, 'click', function() {
                var tab = this.dataset.tab;
                if (tab) {
                    handleTabSwitch(tab);
                }
            });
        }

        // ---- Week selector ----
        var weekApply = container.querySelector('.academy-week-apply');
        var weekInput = container.querySelector('.academy-week-input');
        if (weekApply && weekInput) {
            addEventListener(weekApply, 'click', function() {
                var minWeek = (window.CalendarConstants && window.CalendarConstants.MIN_WEEK) || 1;
                var maxWeek = (window.CalendarConstants && window.CalendarConstants.MAX_WEEK) || 52;
                var week = parseInt(weekInput.value, 10);
                if (!isNaN(week) && week >= minWeek && week <= maxWeek) {
                    AcademyUI.setDisplayWeek(week);
                    refreshUI();
                } else {
                    notify('Please enter a valid week (' + minWeek + '-' + maxWeek + ').', 'error');
                }
            });
            addEventListener(weekInput, 'keydown', function(e) {
                if (e.key === 'Enter') {
                    weekApply.click();
                }
            });
        }
    }

    // ============================================================
    // TAB CONTENT EVENT BINDING
    // ============================================================

    function bindTabContentEvents(tabContent) {
        if (!tabContent) {
            return;
        }

        var activeTab = AcademyUI.getActiveTab();

        switch (activeTab) {
            case 'class':
                if (window.ClassTab && typeof window.ClassTab.bindEvents === 'function') {
                    window.ClassTab.bindEvents(tabContent);
                }
                break;

            case 'student':
                if (window.StudentTab && typeof window.StudentTab.bindEvents === 'function') {
                    window.StudentTab.bindEvents(tabContent);
                }
                break;

            case 'faculty':
                if (window.FacultyTab && typeof window.FacultyTab.bindEvents === 'function') {
                    window.FacultyTab.bindEvents(tabContent);
                }
                break;
        }
    }

    // ============================================================
    // HANDLERS
    // ============================================================

    function handleTabSwitch(tab) {
        if (AcademyUI.setActiveTab(tab)) {
            // Update the active class on the nav buttons
            if (_container) {
                var btns = _container.querySelectorAll('.academy-subtab-btn');
                for (var i = 0; i < btns.length; i++) {
                    btns[i].classList.toggle('active', btns[i].dataset.tab === tab);
                }
            }
            refreshUI();
        }
    }

    // ============================================================
    // INIT / DESTROY
    // ============================================================

    /**
     * Initialize AcademyEvents.
     * 
     * Called by academy/index.js on mount. Renders the shell, renders
     * the initial sub-tab, and binds shell-level events.
     * 
     * Safe to call multiple times. Re-initialisation destroys the
     * previous state first.
     * 
     * @param {HTMLElement} container - The Academy tab container
     */
    function init(container) {
        if (!checkDependencies()) {
            console.warn('[AcademyEvents] Dependencies not met, skipping initialization');
            return;
        }

        if (!container) {
            container = document.getElementById('tab-academy');
        }
        if (!container) {
            console.warn('[AcademyEvents] Container not found');
            return;
        }

        // Clean up previous state if re-initialising
        if (_initialized) {
            removeAllEventListeners();
        }

        _container = container;

        // Initialize UI state (loads persisted state from sessionStorage)
        AcademyUI.init();

        // Render the shell and the initial active sub-tab
        renderAcademyContainer(container);

        // Bind shell-level events (sub-tabs, week selector)
        bindAcademyEvents(container);

        _initialized = true;
    }

    function destroy() {
        removeAllEventListeners();
        _initialized = false;
        _container = null;
    }

    // ============================================================
    // PUBLIC QUERIES
    // ============================================================

    function isInitialized() {
        return _initialized && _container !== null;
    }

    function getContainer() {
        return _container;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyEvents = {
        // Lifecycle
        init: init,
        destroy: destroy,

        // Refresh — THE single refresh entry point for Academy.
        refreshUI: refreshUI,

        // Render — exposed for internal/manual use; prefer refreshUI
        renderAcademyContainer: renderAcademyContainer,

        // State queries
        isInitialized: isInitialized,
        getContainer: getContainer
    };

})();