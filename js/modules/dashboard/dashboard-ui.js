/**
 * js/modules/dashboard/dashboard-ui.js - Dashboard UI Controller
 *
 * Path: js/modules/dashboard/dashboard-ui.js
 *
 * UI-ONLY. Fetches view models from DashboardAggregator,
 * delegates year updates to ApplicationSettingsCore, delegates
 * calendar imports to CalendarImport.
 *
 * E1 addition: handles the dashboard's calendar-import button.
 * Reads the selected file, hands its text to
 * CalendarImport.importFromText, and on success:
 *   - shows a toast,
 *   - re-renders the dashboard so the button label flips,
 *   - re-renders the missions tab if it is mounted, so the
 *     mission form's month picker picks up the new months.
 *
 * DEPENDENCIES:
 *   - window.DashboardRender
 *   - window.DashboardAggregator
 *   - window.ApplicationSettingsCore
 *   - window.TabManager
 *
 * DEPENDENCIES (lazy, at click time):
 *   - window.CalendarImport  (calendar import; button hidden if absent)
 *   - window.NotificationSystem (toast; silent if absent)
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
    // SMALL HELPERS
    // ============================================================

    function notify(message, type) {
        var N = window.NotificationSystem;
        if (N && typeof N.notify === 'function') {
            N.notify(message, type || 'info');
        } else {
            console.log('[DashboardUI] ' + (type || 'info') + ': ' + message);
        }
    }

    function getCalendarImport() {
        return window.CalendarImport || null;
    }

    // ============================================================
    // EVENT LISTENER TRACKING
    // ============================================================

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
    // YEAR UPDATE (unchanged)
    // ============================================================

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
                    render(_container);
                }
            })
            .catch(function(err) {
                console.error('[DashboardUI] Failed to update year:', err);
            });
    }

    // ============================================================
    // CALENDAR IMPORT
    // ============================================================

    /**
     * Open the file picker. The actual import happens on the
     * file input's change event (handleCalendarFileChosen).
     */
    function handleImportCalendarClick(e) {
        if (e) { e.preventDefault(); }
        if (!_container) { return; }

        var input = _container.querySelector('#dashboard-calendar-input');
        if (!input) {
            notify('Calendar import is not available.', 'error');
            return;
        }
        input.value = '';
        input.click();
    }

    /**
     * Read the chosen file, hand its text to CalendarImport, and
     * react to the result.
     */
    function handleCalendarFileChosen(e) {
        var input = e && e.target;
        if (!input || !input.files || input.files.length === 0) {
            return;
        }

        var file = input.files[0];

        var Importer = getCalendarImport();
        if (!Importer || typeof Importer.importFromText !== 'function') {
            notify(
                'Calendar import module is not loaded. Check the ' +
                'script order in index.html.',
                'error'
            );
            return;
        }

        var reader = new FileReader();
        reader.onerror = function() {
            notify('Failed to read the file.', 'error');
        };
        reader.onload = function() {
            var text = String(reader.result || '');
            var result;
            try {
                result = Importer.importFromText(text);
            } catch (err) {
                notify(
                    'Calendar import failed: ' +
                    (err && err.message ? err.message : String(err)),
                    'error'
                );
                return;
            }

            if (!result || !result.ok) {
                notify(
                    'Calendar import failed: ' +
                    ((result && result.error) || 'Unknown error.'),
                    'error'
                );
                return;
            }

            // Success: the active project now carries a calendar.
            notify(
                'Calendar imported: ' + result.calendar.name + '.',
                'success'
            );

            // Re-render the dashboard so the header button
            // label flips from "Import calendar…" to
            // "Replace calendar…".
            if (_container) {
                render(_container);
            }

            // If the missions tab is mounted, re-render it too
            // so any open form picks up the new month list. The
            // missions UI rebuilds the form panel from the
            // active project's calendar on the next open, and
            // the aggregator reads CalendarConfig live, so a
            // plain re-render is enough.
            try {
                if (window.Missions && typeof window.Missions.refresh === 'function') {
                    window.Missions.refresh();
                }
            } catch (err2) {
                // Do not fail the import over this.
            }
        };
        reader.readAsText(file);
    }

    // ============================================================
    // RENDER
    // ============================================================

    function render(container) {
        if (!container) {
            container = document.getElementById('tab-dashboard');
        }
        if (!container) {
            console.warn('[DashboardUI] Container not found.');
            return;
        }

        if (_mounted) {
            removeAllTrackedListeners();
        }

        _container = container;
        _mounted = true;

        var viewModel = Aggregator.getDashboardViewModel();
        container.innerHTML = Render.renderDashboard(viewModel);

        bindEvents(container);
    }

    // ============================================================
    // EVENT BINDING
    // ============================================================

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

        // ---- Calendar import ----
        var importBtn = container.querySelector('#dashboard-import-calendar-btn');
        if (importBtn) {
            addTrackedListener(importBtn, 'click', handleImportCalendarClick);
        }
        var fileInput = container.querySelector('#dashboard-calendar-input');
        if (fileInput) {
            addTrackedListener(fileInput, 'change', handleCalendarFileChosen);
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

    function destroy() {
        removeAllTrackedListeners();
        _container = null;
        _mounted = false;
    }

    // ============================================================
    // QUERIES
    // ============================================================

    function getContainer() {
        return _container;
    }

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
