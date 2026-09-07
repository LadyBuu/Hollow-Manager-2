/**
 * js/modules/dashboard/dashboard-ui.js - Dashboard UI Controller
 * Event wiring and UI coordination for the dashboard
 * Path: js/modules/dashboard/dashboard-ui.js
 * 
 * This module is responsible for:
 *   - Rendering the dashboard
 *   - Binding dashboard events
 *   - Coordinating year updates
 *   - Quick link navigation
 * 
 * IMPORTANT:
 *   - UI-ONLY - no domain mutations
 *   - All mutations delegate to domain cores
 *   - All notifications use NotificationSystem.notify()
 *   - All HTML escaping uses DomUtils.escapeHtml()
 *   - Year updates go through application settings/calendar domain
 * 
 * DEPENDENCIES:
 *   - window.DashboardRender (from dashboard-render.js)
 *   - window.DashboardQueries (from dashboard-queries.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.TabManager (from tab-manager.js)
 *   - window.saveData (from database.js) - TEMPORARY, will be removed
 * 
 * USAGE:
 *   var ui = window.DashboardUI;
 *   ui.render(container);
 */

(function() {
    'use strict';

    if (window.__dashboardUILoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    var missing = [];

    if (!window.DashboardRender || typeof window.DashboardRender.renderDashboard !== 'function') {
        missing.push('DashboardRender.renderDashboard');
    }

    if (!window.DashboardQueries || typeof window.DashboardQueries.getCurrentYear !== 'function') {
        missing.push('DashboardQueries.getCurrentYear');
    }

    if (!window.NotificationSystem || typeof window.NotificationSystem.notify !== 'function') {
        missing.push('NotificationSystem.notify');
    }

    if (!window.TabManager || typeof window.TabManager.switchTo !== 'function') {
        missing.push('TabManager.switchTo');
    }

    // saveData is temporary - will be replaced by MutationUtils
    if (typeof window.saveData !== 'function') {
        missing.push('saveData');
    }

    if (missing.length > 0) {
        throw new Error('[DashboardUI] Missing dependencies: ' + missing.join(', '));
    }

    window.__dashboardUILoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var Render = window.DashboardRender;
    var Queries = window.DashboardQueries;
    var NotificationSystem = window.NotificationSystem;
    var TabManager = window.TabManager;

    // ============================================================
    // STATE
    // ============================================================

    var _eventListeners = [];
    var _container = null;
    var _mounted = false;

    // ============================================================
    // EVENT BINDING
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
    // NOTIFICATION
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // YEAR UPDATE
    // ============================================================

    /**
     * Update the current year.
     * TEMPORARY: This will be replaced by a command through MutationUtils.
     */
    function updateYear(year) {
        // Validate
        if (!Number.isInteger(year) || year < 1900 || year > 2100) {
            showNotification('Please enter a valid year (1900-2100).', 'error');
            return false;
        }

        // TEMPORARY: Direct persistence
        // This will be replaced by: CalendarCore.setCurrentYear(year)
        if (window.data) {
            window.data.currentYear = year;
        }

        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    showNotification('Year updated to ' + year + '.', 'success');
                    render();
                })
                .catch(function() {
                    showNotification('Failed to save year update.', 'error');
                });
        } else {
            render();
        }

        return true;
    }

    // ============================================================
    // RENDER
    // ============================================================

    function render(container) {
        if (!container) {
            container = document.getElementById('tab-dashboard');
        }

        if (!container) {
            throw new Error('[DashboardUI] Container not found.');
        }

        // Clean up previous instance
        if (_mounted) {
            removeAllEventListeners();
        }

        _container = container;
        _mounted = true;

        // Render the dashboard
        var html = Render.renderDashboard();
        container.innerHTML = html;

        // Bind events
        bindEvents(container);
    }

    // ============================================================
    // BIND EVENTS
    // ============================================================

    function bindEvents(container) {
        // Year update
        var updateBtn = container.querySelector('#dashboard-update-year-btn');
        var yearInput = container.querySelector('#dashboard-year-input');

        if (updateBtn && yearInput) {
            addSafeEventListener(updateBtn, 'click', function() {
                var year = Number(yearInput.value);
                updateYear(year);
            });

            addSafeEventListener(yearInput, 'keydown', function(e) {
                if (e.key === 'Enter') {
                    var year = Number(this.value);
                    updateYear(year);
                }
            });
        }

        // Quick links - use event delegation
        addSafeEventListener(container, 'click', function(e) {
            var link = e.target.closest('.quick-link');
            if (link) {
                e.preventDefault();
                var tab = link.dataset.tab;
                if (tab && TabManager && typeof TabManager.switchTo === 'function') {
                    TabManager.switchTo(tab, true);
                }
            }
        });
    }

    // ============================================================
    // DESTROY
    // ============================================================

    function destroy() {
        removeAllEventListeners();
        _container = null;
        _mounted = false;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DashboardUI = {
        render: render,
        destroy: destroy,
        updateYear: updateYear,
        getContainer: function() {
            return _container;
        },
        isMounted: function() {
            return _mounted;
        }
    };

})();
