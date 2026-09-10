/**
 * js/modules/dashboard/dashboard-ui.js - Dashboard UI Controller
 * Event wiring and UI coordination for the dashboard
 * 
 * Path: js/modules/dashboard/dashboard-ui.js
 * 
 * This module provides:
 *   - render(container) - Render the dashboard and bind events
 *   - destroy() - Clean up event listeners
 * 
 * IMPORTANT:
 *   - UI-ONLY - no domain mutations
 *   - Fetches view models from DashboardAggregator
 *   - Delegates year updates to ApplicationSettingsCore
 *   - Notifications come from MutationPipeline via ApplicationSettingsCore;
 *     the UI does NOT show its own success/failure for year updates
 *   - All HTML is produced by DashboardRender
 *   - All event listeners are tracked for cleanup
 * 
 * LIFECYCLE:
 *   - render(container) may be called multiple times
 *   - Each render cleans up prior listeners before binding new ones
 *   - destroy() removes all listeners and clears the container reference
 * 
 * DEPENDENCIES:
 *   - window.DashboardRender
 *   - window.DashboardAggregator
 *   - window.ApplicationSettingsCore
 *   - window.TabManager
 * 
 * USAGE:
 *   DashboardUI.render(container);
 *   // Later, when the tab is torn down:
 *   DashboardUI.destroy();
 */

(function() {
    'use strict';

    if (window.__dashboardUILoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - FAIL LOUDLY
    // ============================================================

    var missing = [];

    if (!window.DashboardRender || typeof window.DashboardRender.renderDashboard !== 'function') {
        missing.push('DashboardRender.renderDashboard');
    }
    if (!window.DashboardAggregator || typeof window.DashboardAggregator.getDashboardViewModel !== 'function') {
        missing.push('DashboardAggregator.getDashboardViewModel');
    }
    if (!window.ApplicationSettingsCore || typeof window.ApplicationSettingsCore.setCurrentYear !== 'function') {
        missing.push('ApplicationSettingsCore.setCurrentYear');
    }
    if (!window.TabManager || typeof window.TabManager.switchTo !== 'function') {
        missing.push('TabManager.switchTo');
    }

    if (missing.length > 0) {
        throw new Error('[DashboardUI] Missing dependencies: ' + missing.join(', '));
    }

    window.__dashboardUILoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var Render = window.DashboardRender;
    var Aggregator = window.DashboardAggregator;
    var AppSettings = window.ApplicationSettingsCore;
    var TabManager = window.TabManager;

    // ============================================================
    // STATE
    // ============================================================

    var _container = null;
    var _mounted = false;
    var _eventListeners = [];

    // ============================================================
    // EVENT LISTENER TRACKING
    // ============================================================

    /**
     * Register an event listener for cleanup.
     * 
     * @param {HTMLElement} element - Target element
     * @param {string} eventName - Event name
     * @param {function} handler - Event handler
     */
    function addTrackedListener(element, eventName, handler) {
        if (!element) {
            return;
        }
        element.addEventListener(eventName, handler, false);
        _eventListeners.push({
            element: element,
            eventName: eventName,
            handler: handler
        });
    }

    /**
     * Remove all tracked event listeners.
     */
    function removeAllTrackedListeners() {
        for (var i = 0; i < _eventListeners.length; i++) {
            var item = _eventListeners[i];
            try {
                item.element.removeEventListener(item.eventName, item.handler, false);
            } catch (e) {
                // Ignore cleanup errors
            }
        }
        _eventListeners = [];
    }

    // ============================================================
    // YEAR UPDATE
    // ============================================================

    /**
     * Handle year update.
     * 
     * Reads the year input, validates it, and delegates to
     * ApplicationSettingsCore.setCurrentYear(). On success, re-renders
     * the dashboard to reflect the new value.
     * 
     * On failure, ApplicationSettingsCore returns a structured result
     * with a message. MutationPipeline handles user notification.
     * The UI does not display its own notification for year updates.
     */
    function handleYearUpdate() {
        if (!_container) {
            return;
        }

        var yearInput = _container.querySelector('#dashboard-year-input');
        if (!yearInput) {
            return;
        }

        var year = parseInt(yearInput.value, 10);
        if (isNaN(year)) {
            return;
        }

        AppSettings.setCurrentYear(year)
            .then(function(result) {
                if (result && result.success) {
                    // Re-render with the new year
                    render(_container);
                }
                // Notification and rollback handled by MutationPipeline
            })
            .catch(function(err) {
                // Unexpected error (should be rare - MutationPipeline handles
                // most failure cases). Log it for debugging.
                console.error('[DashboardUI] Failed to update year:', err);
            });
    }

    // ============================================================
    // RENDER
    // ============================================================

    /**
     * Render the dashboard into the given container.
     * 
     * @param {HTMLElement} container - Container element
     */
    function render(container) {
        if (!container) {
            container = document.getElementById('tab-dashboard');
        }
        if (!container) {
            console.warn('[DashboardUI] Container not found.');
            return;
        }

        // Clean up prior listeners before re-rendering
        if (_mounted) {
            removeAllTrackedListeners();
        }

        _container = container;
        _mounted = true;

        // Fetch the view model from the aggregator
        var viewModel = Aggregator.getDashboardViewModel();

        // Render into the container
        container.innerHTML = Render.renderDashboard(viewModel);

        // Bind events
        bindEvents(container);
    }

    // ============================================================
    // EVENT BINDING
    // ============================================================

    /**
     * Bind all dashboard events to the container.
     * 
     * @param {HTMLElement} container - Container element
     */
    function bindEvents(container) {
        // ---- Year update button ----
        var updateBtn = container.querySelector('#dashboard-update-year-btn');
        if (updateBtn) {
            addTrackedListener(updateBtn, 'click', function(e) {
                e.preventDefault();
                handleYearUpdate();
            });
        }

        // ---- Year input Enter key ----
        var yearInput = container.querySelector('#dashboard-year-input');
        if (yearInput) {
            addTrackedListener(yearInput, 'keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleYearUpdate();
                }
            });
        }

        // ---- Quick links (event delegation) ----
        addTrackedListener(container, 'click', function(e) {
            var link = e.target.closest('.quick-link');
            if (!link) {
                return;
            }
            e.preventDefault();
            var tab = link.getAttribute('data-tab');
            if (tab) {
                TabManager.switchTo(tab, true);
            }
        });
    }

    // ============================================================
    // DESTROY
    // ============================================================

    /**
     * Tear down the dashboard.
     * Removes all event listeners and clears state.
     * Does NOT clear the container's HTML - the caller may want to
     * preserve the DOM for inspection or gradual teardown.
     */
    function destroy() {
        removeAllTrackedListeners();
        _container = null;
        _mounted = false;
    }

    // ============================================================
    // QUERIES
    // ============================================================

    /**
     * Get the current container element.
     * 
     * @returns {HTMLElement|null} Container or null
     */
    function getContainer() {
        return _container;
    }

    /**
     * Check if the dashboard is currently mounted.
     * 
     * @returns {boolean} True if mounted
     */
    function isMounted() {
        return _mounted;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.DashboardUI = {
        render: render,
        destroy: destroy,
        getContainer: getContainer,
        isMounted: isMounted
    };

})();
