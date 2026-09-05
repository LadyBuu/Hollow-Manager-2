/**
 * js/core/tab-manager.js - Tab Navigation System
 * Single source of truth for tab lifecycle and navigation
 * 
 * IMPORTANT:
 *   - TabManager is the SINGLE source of truth for tab lifecycle
 *   - Modules register with TabManager, TabManager calls them
 *   - No module should listen for dataReady/tabChanged to render itself
 *   - Data readiness is handled by TabManager before calling render functions
 *   - currentTab is INTERNAL state - use getCurrentTab() to read
 *   - tabChanged is INFORMATIONAL only - not a render trigger
 *   - Rendering is SYNCHRONOUS - render functions must not be async
 *   - Uses EVENT DELEGATION for navigation clicks (no node cloning)
 * 
 * DEPENDENCIES:
 *   - window.data (for data readiness)
 *   - DataLoader (for readiness callbacks)
 * 
 * USAGE:
 *   // Register a tab
 *   TabManager.register('dashboard', function(container) {
 *       container.innerHTML = '<h1>Dashboard</h1>';
 *   });
 * 
 *   // Switch to a tab
 *   TabManager.switchTo('academy', true);
 * 
 *   // Get current tab
 *   var current = TabManager.getCurrentTab();
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__tabManagerLoaded) {
        return;
    }
    window.__tabManagerLoaded = true;

    var DEFAULT_TAB = 'dashboard';

    // ============================================================
    // STATE (INTERNAL)
    // ============================================================

    var _currentTab = DEFAULT_TAB;
    var _tabs = {};
    var _tabContentElements = {};
    var _isInitialized = false;
    var _isRendering = false;
    var _initializationStarted = false;
    var _isDataReady = false;
    var _pendingInitialTab = null;
    var _pendingTab = null;
    var _pendingUpdateHistory = false;

    // Cleanup functions for event listeners
    var _cleanups = [];

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var DataLoader = window.DataLoader;

    // ============================================================
    // INITIALIZATION
    // ============================================================

    function init() {
        if (_isInitialized) return;
        if (_initializationStarted) return;
        _initializationStarted = true;

        try {
            _findTabContentElements();
            _bindNavLinks();
            _bindQuickLinks();
            
            _isInitialized = true;

            // Get initial tab from URL
            var initialTab = _getInitialTab();
            _updateUrlHash(initialTab, false);
            _pendingInitialTab = initialTab;

            // Check if data is already ready
            if (DataLoader && DataLoader.isReady && window.data) {
                _isDataReady = true;
                _processInitialTab();
            } else if (DataLoader && typeof DataLoader.whenReady === 'function') {
                // Wait for data to be ready
                DataLoader.whenReady(function(data) {
                    if (data) {
                        _onDataReady();
                    } else {
                        // Data loading failed - fallback to default
                        if (_currentTab !== DEFAULT_TAB) {
                            _switchTo(DEFAULT_TAB, false);
                        }
                    }
                });
            } else {
                // No DataLoader - try direct check
                if (window.data) {
                    _isDataReady = true;
                    _processInitialTab();
                }
            }

            _dispatchReady();

        } catch (error) {
            console.error('[TabManager] Initialization failed:', error);
        }
    }

    /**
     * Clean up all event listeners.
     * Useful for testing or hot-reloading.
     */
    function destroy() {
        _cleanups.forEach(function(cleanup) {
            try {
                cleanup();
            } catch (e) {
                // Ignore cleanup errors
            }
        });
        _cleanups = [];
        _isInitialized = false;
        _initializationStarted = false;
    }

    // ============================================================
    // DATA READINESS
    // ============================================================

    function _onDataReady() {
        _isDataReady = true;
        _processInitialTab();
    }

    function _processInitialTab() {
        if (!_isDataReady || !_pendingInitialTab) return;

        var tab = _pendingInitialTab;
        _pendingInitialTab = null;

        if (_tabs[tab]) {
            _switchTo(tab, false);
        } else if (tab !== DEFAULT_TAB) {
            _switchTo(DEFAULT_TAB, false);
        }
    }

    // ============================================================
    // TAB REGISTRATION
    // ============================================================

    /**
     * Register a tab with a render function.
     * 
     * @param {string} tabName - Tab identifier
     * @param {Function} renderFn - Function(container) that renders the tab
     * @returns {boolean} True if registration was successful
     */
    function register(tabName, renderFn) {
        if (!tabName || typeof tabName !== 'string') {
            return false;
        }

        if (typeof renderFn !== 'function') {
            return false;
        }

        var key = tabName.trim();
        _tabs[key] = renderFn;

        // If this tab is currently active, render it immediately
        if (_isInitialized && _currentTab === key) {
            var container = _tabContentElements[key];
            if (container) {
                _renderTab(key);
            }
        }

        return true;
    }

    /**
     * Check if a tab is registered.
     * 
     * @param {string} tabName - Tab identifier
     * @returns {boolean} True if tab exists
     */
    function hasTab(tabName) {
        if (!tabName) return false;
        return !!_tabs[tabName.trim()];
    }

    /**
     * Get all registered tab names.
     * 
     * @returns {Array} Array of tab names
     */
    function getTabs() {
        return Object.keys(_tabs);
    }

    // ============================================================
    // NAVIGATION
    // ============================================================

    /**
     * Switch to a tab.
     * 
     * @param {string} tabName - Tab identifier
     * @param {boolean} updateHistory - Whether to update URL hash
     */
    function switchTo(tabName, updateHistory) {
        if (!tabName) return;

        var key = tabName.trim();

        if (!_tabs[key]) {
            if (key !== DEFAULT_TAB) {
                switchTo(DEFAULT_TAB, false);
            }
            return;
        }

        if (key === _currentTab && _isInitialized) {
            _renderTab(key);
            return;
        }

        if (_isRendering) {
            _pendingTab = key;
            _pendingUpdateHistory = updateHistory !== false;
            return;
        }

        _switchTo(key, updateHistory !== false);
    }

    function _switchTo(tabName, updateHistory) {
        if (_isRendering) {
            _pendingTab = tabName;
            _pendingUpdateHistory = updateHistory !== false;
            return;
        }

        if (!_tabs[tabName]) {
            return;
        }

        _isRendering = true;
        var previousTab = _currentTab;
        _currentTab = tabName;

        _updateNavLinks(tabName);
        _updateTabVisibility(tabName);
        _closeMobileMenu();

        if (updateHistory !== false) {
            _updateUrlHash(tabName, true);
        }

        _renderTab(tabName);

        _isRendering = false;

        // Process pending tab switch
        var pending = _pendingTab;
        var pendingUpdateHistory = _pendingUpdateHistory;
        _pendingTab = null;
        _pendingUpdateHistory = false;

        if (pending && pending !== tabName) {
            _switchTo(pending, pendingUpdateHistory);
        }

        _dispatchTabChanged(tabName, previousTab);
    }

    /**
     * Force refresh the current tab.
     */
    function forceRefresh(tabName) {
        tabName = tabName || _currentTab;

        if (!tabName) return;

        var key = tabName.trim();

        if (_isRendering) {
            _pendingTab = key;
            _pendingUpdateHistory = false;
            return;
        }

        if (!_tabs[key]) {
            return;
        }

        _renderTab(key);
    }

    /**
     * Refresh the current tab.
     */
    function refreshCurrent() {
        forceRefresh(_currentTab);
    }

    // ============================================================
    // QUERIES
    // ============================================================

    /**
     * Get the current tab name.
     * 
     * @returns {string} Current tab identifier
     */
    function getCurrentTab() {
        return _currentTab;
    }

    /**
     * Check if a tab is currently active.
     * 
     * @param {string} tabName - Tab identifier
     * @returns {boolean} True if active
     */
    function isTabActive(tabName) {
        if (!tabName) return false;
        return _currentTab === tabName.trim();
    }

    /**
     * Get the container element for a tab.
     * 
     * @param {string} tabName - Tab identifier
     * @returns {HTMLElement|null} Container element or null
     */
    function getTabContainer(tabName) {
        if (!tabName) return null;
        return _tabContentElements[tabName.trim()] || null;
    }

    // ============================================================
    // DOM SETUP - Using Event Delegation
    // ============================================================

    function _findTabContentElements() {
        document.querySelectorAll('.tab-content').forEach(function(el) {
            var id = el.id;
            if (id && id.startsWith('tab-')) {
                var tabName = id.replace('tab-', '');
                _tabContentElements[tabName] = el;
            }
        });
    }

    function _bindNavLinks() {
        var nav = document.getElementById('main-nav');
        if (!nav) return;

        // Use event delegation on the nav container
        function handler(e) {
            var link = e.target.closest('a[data-tab]');
            if (!link) return;

            e.preventDefault();
            var tab = link.dataset.tab;
            if (tab) {
                TabManager.switchTo(tab, true);
            }
        }

        nav.addEventListener('click', handler);

        // Store cleanup
        _cleanups.push(function() {
            nav.removeEventListener('click', handler);
        });

        // Store nav links for active state updates
        nav.querySelectorAll('a[data-tab]').forEach(function(link) {
            _navLinks.push(link);
        });
    }

    function _bindQuickLinks() {
        var selectors = [
            '.quick-link[data-tab]',
            '.stat-link[data-tab]',
            '.dashboard-card[data-tab]'
        ];

        selectors.forEach(function(selector) {
            // Use event delegation on document for quick links
            // They may be dynamically added/removed
            function handler(e) {
                var link = e.target.closest(selector);
                if (!link) return;

                e.preventDefault();
                var tab = link.dataset.tab;
                if (tab) {
                    TabManager.switchTo(tab, true);
                }
            }

            document.addEventListener('click', handler);

            _cleanups.push(function() {
                document.removeEventListener('click', handler);
            });
        });
    }

    // ============================================================
    // URL MANAGEMENT
    // ============================================================

    function _getInitialTab() {
        var hash = window.location.hash.slice(1);
        
        if (!hash) {
            return DEFAULT_TAB;
        }

        if (_tabs[hash]) {
            return hash;
        }

        return DEFAULT_TAB;
    }

    function _updateUrlHash(tabName, pushHistory) {
        if (!window.history) return;

        var hash = '#' + tabName;

        if (pushHistory !== false) {
            window.history.pushState(null, '', hash);
        } else if (window.history.replaceState) {
            window.history.replaceState(null, '', hash);
        }
    }

    // ============================================================
    // RENDERING
    // ============================================================

    function _renderTab(tabName) {
        var container = _tabContentElements[tabName];
        var renderFn = _tabs[tabName];

        if (!container) {
            return;
        }

        container.style.display = 'block';

        if (!renderFn) {
            if (!container.innerHTML || container.innerHTML.trim() === '') {
                container.innerHTML = '<p class="empty-state">Module coming soon...</p>';
            }
            return;
        }

        try {
            renderFn(container);
        } catch (e) {
            console.error('[TabManager] Error rendering tab "' + tabName + '":', e);
            container.innerHTML = '<p class="empty-state">Error loading tab content. Please try again.</p>';
        }
    }

    // ============================================================
    // UI UPDATES
    // ============================================================

    function _updateNavLinks(tabName) {
        _navLinks.forEach(function(link) {
            link.classList.toggle('active', link.dataset.tab === tabName);
        });
    }

    function _updateTabVisibility(tabName) {
        for (var key in _tabContentElements) {
            var el = _tabContentElements[key];
            if (!el) continue;
            if (key === tabName) {
                el.style.display = 'block';
                el.classList.add('active');
            } else {
                el.style.display = 'none';
                el.classList.remove('active');
            }
        }
    }

    function _closeMobileMenu() {
        var nav = document.getElementById('main-nav');
        var actions = document.getElementById('header-actions');
        var toggle = document.getElementById('nav-toggle');

        if (nav) nav.classList.remove('open');
        if (actions) actions.classList.remove('open');
        if (toggle) {
            toggle.classList.remove('open');
            toggle.textContent = '☰';
        }
    }

    // ============================================================
    // EVENTS
    // ============================================================

    function _dispatchReady() {
        try {
            var event = new CustomEvent('tabManagerReady', {
                detail: {
                    isInitialized: _isInitialized,
                    currentTab: _currentTab,
                    tabs: Object.keys(_tabs)
                },
                bubbles: true,
                cancelable: false
            });
            document.dispatchEvent(event);
        } catch (e) {
            // Ignore event dispatch errors
        }
    }

    function _dispatchTabChanged(tabName, previousTab) {
        // INFORMATIONAL ONLY - not a render trigger
        try {
            var event = new CustomEvent('tabChanged', {
                detail: {
                    tab: tabName,
                    previousTab: previousTab,
                    timestamp: Date.now()
                },
                bubbles: true,
                cancelable: false
            });
            document.dispatchEvent(event);
        } catch (e) {
            // Ignore event dispatch errors
        }
    }

    // ============================================================
    // GLOBAL EVENT HANDLERS
    // ============================================================

    window.addEventListener('hashchange', function() {
        if (!_isInitialized) return;

        var hash = window.location.hash.slice(1);
        if (hash && _tabs[hash]) {
            switchTo(hash, false);
        }
    });

    window.addEventListener('popstate', function() {
        if (!_isInitialized) return;

        var hash = window.location.hash.slice(1);
        if (hash && _tabs[hash]) {
            switchTo(hash, false);
        }
    });

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TabManager = {
        // State (read-only)
        get currentTab() { return _currentTab; },
        get isInitialized() { return _isInitialized; },
        get isRendering() { return _isRendering; },

        // API
        init: init,
        destroy: destroy,
        onDataReady: _onDataReady,
        register: register,
        hasTab: hasTab,
        getTabs: getTabs,
        switchTo: switchTo,
        forceRefresh: forceRefresh,
        refreshCurrent: refreshCurrent,
        getCurrentTab: getCurrentTab,
        isTabActive: isTabActive,
        getTabContainer: getTabContainer
    };

    // ============================================================
    // AUTO-INIT
    // ============================================================

    function initTabManager() {
        if (TabManager.isInitialized || TabManager._initializationStarted) return;
        TabManager.init();
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initTabManager();
    } else {
        document.addEventListener('DOMContentLoaded', initTabManager);
    }

})();