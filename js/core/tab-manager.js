/**
 * js/core/tab-manager.js - Tab Navigation System
 * Handles tab switching and module registration
 * Path: js/core/tab-manager.js
 * 
 * This module is responsible for:
 *   - Managing tab switching and navigation
 *   - Registering tab render functions
 *   - Coordinating with data loading lifecycle
 *   - URL hash management
 *   - Preventing race conditions during initialization
 * 
 * IMPORTANT:
 *   - Tabs are rendered ONLY after data is ready
 *   - The 'dataReady' event triggers initial tab rendering
 *   - Tab switching is deferred until data is available
 *   - All tab render functions are idempotent
 * 
 * DEPENDENCIES:
 *   - window.UI_CONSTANTS (from constants.js)
 *   - window.data (from database.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__tabManagerLoaded) {
        return;
    }
    window.__tabManagerLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var UI = window.UI_CONSTANTS || {
        DEBOUNCE_DELAY: 300,
        MOBILE_BREAKPOINT: 768
    };

    // ============================================================
    // STATE
    // ============================================================

    var state = {
        currentTab: 'dashboard',
        tabs: {},
        tabContentElements: {},
        navLinks: [],
        isInitialized: false,
        isRendering: false,
        isDataReady: false,
        hasSwitched: false,
        pendingTab: null,
        pendingUpdateHistory: false,
        switchTimeout: null,
        initializationComplete: false
    };

    // ============================================================
    // INITIALIZATION
    // ============================================================

    function init() {
        if (state.isInitialized) return;
        state.isInitialized = true;

        try {
            // Find all tab content elements
            document.querySelectorAll('.tab-content').forEach(function(el) {
                var id = el.id;
                if (id && id.startsWith('tab-')) {
                    var tabName = id.replace('tab-', '');
                    state.tabContentElements[tabName] = el;
                }
            });

            // Find all nav links and attach events
            document.querySelectorAll('#main-nav a[data-tab]').forEach(function(link) {
                state.navLinks.push(link);

                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    var tab = this.dataset.tab;
                    if (tab) {
                        switchTo(tab, true);
                    }
                });
            });

            // Quick links on dashboard
            document.querySelectorAll('.quick-link[data-tab]').forEach(function(link) {
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    var tab = this.dataset.tab;
                    if (tab) {
                        switchTo(tab, true);
                    }
                });
            });

            // Stat links on dashboard
            document.querySelectorAll('.stat-link[data-tab]').forEach(function(link) {
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    var tab = this.dataset.tab;
                    if (tab) {
                        switchTo(tab, true);
                    }
                });
            });

            // Listen for data ready
            document.addEventListener('dataReady', onDataReady);
            document.addEventListener('dataLoaded', onDataReady);

            // If data is already available, mark as ready
            if (window.data) {
                state.isDataReady = true;
            }

            // Set initial tab from URL hash or default
            var hash = window.location.hash.slice(1);
            var initialTab = state.tabs[hash] ? hash : 'dashboard';

            // Use replaceState for initial tab to avoid extra history entry
            if (window.history && window.history.replaceState) {
                window.history.replaceState(null, '', '#' + initialTab);
            }

            state.initializationComplete = true;

            // If data is already ready, switch to initial tab
            if (state.isDataReady) {
                setTimeout(function() {
                    switchTo(initialTab, false);
                }, 10);
            }

        } catch (error) {
            console.error('Failed to initialise TabManager:', error);
        }
    }

    // ============================================================
    // DATA READY HANDLER
    // ============================================================

    function onDataReady(e) {
        if (state.isDataReady) return;
        state.isDataReady = true;

        // Get the initial tab from URL hash
        var hash = window.location.hash.slice(1);
        var initialTab = state.tabs[hash] ? hash : 'dashboard';

        // If we haven't switched to a tab yet, switch now
        if (!state.hasSwitched) {
            state.hasSwitched = true;
            switchTo(initialTab, false);
        } else {
            // Refresh current tab with data
            refreshCurrent();
        }
    }

    // ============================================================
    // TAB REGISTRATION
    // ============================================================

    function register(tabName, renderFn) {
        if (!tabName || typeof renderFn !== 'function') {
            console.warn('Invalid tab registration:', tabName);
            return false;
        }

        state.tabs[tabName] = renderFn;

        // If this tab is already active and initialized, render it
        if (state.isInitialized && state.currentTab === tabName && state.isDataReady) {
            var container = state.tabContentElements[tabName];
            if (container) {
                setTimeout(function() {
                    renderTab(tabName);
                }, 50);
            }
        }

        return true;
    }

    // ============================================================
    // TAB SWITCHING
    // ============================================================

    function switchTo(tabName, updateHistory) {
        // Validate tab exists
        if (!state.tabs[tabName]) {
            console.warn('TabManager: Unknown tab "' + tabName + '"');
            return;
        }

        // If data is not ready, queue the tab switch
        if (!state.isDataReady) {
            state.pendingTab = tabName;
            state.pendingUpdateHistory = updateHistory !== false;
            console.log('TabManager: Data not ready, queuing tab "' + tabName + '"');
            return;
        }

        // If already on this tab, just refresh
        if (tabName === state.currentTab && state.isInitialized) {
            refreshCurrent();
            return;
        }

        // Clear any pending switch
        if (state.switchTimeout) {
            clearTimeout(state.switchTimeout);
            state.switchTimeout = null;
        }

        // If currently rendering, defer with history flag preserved
        if (state.isRendering) {
            state.pendingTab = tabName;
            state.pendingUpdateHistory = updateHistory !== false;
            return;
        }

        // Schedule the switch
        state.switchTimeout = setTimeout(function() {
            doSwitch(tabName, updateHistory !== false);
            state.switchTimeout = null;
        }, 50);
    }

    function doSwitch(tabName, updateHistory) {
        // If data is not ready, queue the tab switch
        if (!state.isDataReady) {
            state.pendingTab = tabName;
            state.pendingUpdateHistory = updateHistory !== false;
            return;
        }

        // If still rendering, defer with history flag preserved
        if (state.isRendering) {
            state.pendingTab = tabName;
            state.pendingUpdateHistory = updateHistory !== false;
            return;
        }

        state.isRendering = true;
        state.currentTab = tabName;
        state.hasSwitched = true;

        // Update nav links
        state.navLinks.forEach(function(link) {
            link.classList.toggle('active', link.dataset.tab === tabName);
        });

        // Update tab content visibility
        for (var key in state.tabContentElements) {
            var el = state.tabContentElements[key];
            if (!el) continue;
            if (key === tabName) {
                el.style.display = 'block';
                el.classList.add('active');
            } else {
                el.style.display = 'none';
                el.classList.remove('active');
            }
        }

        // Close mobile nav
        closeMobileNav();

        // Update URL hash only if requested
        if (updateHistory !== false && window.history && window.history.pushState) {
            window.history.pushState(null, '', '#' + tabName);
        }

        // Render the tab content
        renderTab(tabName);

        state.isRendering = false;

        // Clear and handle pending tab with preserved history flag
        var pending = state.pendingTab;
        var pendingUpdateHistory = state.pendingUpdateHistory;

        state.pendingTab = null;
        state.pendingUpdateHistory = false;

        if (pending && pending !== tabName) {
            switchTo(pending, pendingUpdateHistory);
        }

        // Dispatch event
        var event = new CustomEvent('tabChanged', { detail: { tab: tabName } });
        document.dispatchEvent(event);
    }

    // ============================================================
    // TAB RENDERING
    // ============================================================

    function renderTab(tabName) {
        var container = state.tabContentElements[tabName];
        var renderFn = state.tabs[tabName];

        if (!container) {
            console.warn('TabManager: Container not found for tab "' + tabName + '"');
            return;
        }

        if (!renderFn) {
            container.innerHTML = '<p class="empty-state">Tab content unavailable.</p>';
            return;
        }

        try {
            renderFn(container);
        } catch (e) {
            console.error('Error rendering tab ' + tabName + ':', e);
            container.innerHTML = '<p class="empty-state">Error loading tab content.</p>';
        }
    }

    // ============================================================
    // REFRESH
    // ============================================================

    function refreshCurrent() {
        if (state.isRendering) {
            state.pendingTab = state.currentTab;
            state.pendingUpdateHistory = false;
            return;
        }

        if (!state.isDataReady) {
            console.log('TabManager: Data not ready, cannot refresh');
            return;
        }

        renderTab(state.currentTab);
    }

    function forceRefresh(tabName) {
        tabName = tabName || state.currentTab;

        if (state.isRendering) {
            state.pendingTab = tabName;
            state.pendingUpdateHistory = false;
            return;
        }

        if (!state.isDataReady) {
            state.pendingTab = tabName;
            state.pendingUpdateHistory = false;
            return;
        }

        renderTab(tabName);
    }

    // ============================================================
    // NAVIGATION HELPERS
    // ============================================================

    function closeMobileNav() {
        var nav = document.getElementById('main-nav');
        var toggle = document.getElementById('nav-toggle');
        var actions = document.getElementById('header-actions');

        if (nav) nav.classList.remove('open');
        if (toggle) {
            toggle.classList.remove('open');
            toggle.textContent = '☰';
        }
        if (actions) actions.classList.remove('open');
    }

    // ============================================================
    // QUERY HELPERS
    // ============================================================

    function getCurrentTab() {
        return state.currentTab;
    }

    function isTabActive(tabName) {
        return state.currentTab === tabName;
    }

    function getTabContainer(tabName) {
        return state.tabContentElements[tabName] || null;
    }

    function isDataReady() {
        return state.isDataReady;
    }

    function getPendingTab() {
        return state.pendingTab;
    }

    // ============================================================
    // DESTROY / CLEANUP
    // ============================================================

    function destroy() {
        if (state.switchTimeout) {
            clearTimeout(state.switchTimeout);
            state.switchTimeout = null;
        }

        document.removeEventListener('dataReady', onDataReady);
        document.removeEventListener('dataLoaded', onDataReady);

        state.isInitialized = false;
        state.isRendering = false;
        state.initializationComplete = false;
    }

    // ============================================================
    // AUTO-INIT
    // ============================================================

    function initTabManager() {
        if (state.isInitialized) return;
        init();
    }

    // One clear startup path: wait for DOM, then init
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(initTabManager, 50);
    } else {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(initTabManager, 50);
        });
    }

    // Refresh current tab after data loads (if already initialized)
    document.addEventListener('dataReady', function() {
        if (state.isInitialized) {
            // If data was not ready before, mark it now
            if (!state.isDataReady) {
                state.isDataReady = true;
            }
            refreshCurrent();
        }
    });

    // Handle hash changes - don't update history again
    window.addEventListener('hashchange', function() {
        if (!state.isInitialized) return;
        var hash = window.location.hash.slice(1);
        if (hash && state.tabs[hash]) {
            switchTo(hash, false);
        }
    });

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TabManager = {
        // Lifecycle
        init: init,
        destroy: destroy,

        // Registration
        register: register,

        // Navigation
        switchTo: switchTo,
        getCurrentTab: getCurrentTab,
        isTabActive: isTabActive,
        getTabContainer: getTabContainer,

        // Refresh
        refreshCurrent: refreshCurrent,
        forceRefresh: forceRefresh,

        // Data state
        isDataReady: isDataReady,
        getPendingTab: getPendingTab,

        // Internal state (read-only)
        _state: state
    };

})();
