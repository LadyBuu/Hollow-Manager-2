/**
 * js/core/tab-manager.js - Tab Manager
 * Single source of truth for tab navigation and lifecycle
 * Path: js/core/tab-manager.js
 * 
 * This module handles:
 *   - Tab registration with render functions
 *   - Tab switching (programmatic and user-initiated)
 *   - Tab lifecycle (mount/unmount)
 *   - Active tab tracking
 *   - URL hash persistence for deep linking
 * 
 * IMPORTANT:
 *   - TabManager is the SINGLE SOURCE OF TRUTH for navigation state
 *   - Features register themselves with a render function
 *   - TabManager owns the lifecycle (mount/destroy)
 *   - NO rendering logic in this module
 *   - NO direct DOM manipulation of feature content
 *   - Features are responsible for their own rendering
 *   - Data readiness is handled by DataLoader
 * 
 * LIFECYCLE:
 *   - Features register on load: TabManager.register('tabName', renderFn)
 *   - User clicks tab: TabManager.switchTo('tabName')
 *   - TabManager hides all tabs, shows target, calls renderFn
 *   - TabManager updates URL hash
 *   - Features can call TabManager.forceRefresh() if needed
 * 
 * DEPENDENCIES:
 *   - window.DataLoader (from loader.js) - MANDATORY
 * 
 * USAGE:
 *   // Register a feature
 *   TabManager.register('characters', function(container) {
 *       container.innerHTML = '<h1>Characters</h1>';
 *   });
 * 
 *   // Switch to a tab
 *   TabManager.switchTo('characters');
 * 
 *   // Get current tab
 *   var current = TabManager.getCurrentTab();
 */

(function() {
    'use strict';

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__tabManagerLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - MANDATORY (no fallbacks)
    // ============================================================

    if (!window.DataLoader || typeof window.DataLoader.whenReady !== 'function') {
        throw new Error('[TabManager] DataLoader is required.');
    }

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var DataLoader = window.DataLoader;

    // ============================================================
    // PRIVATE STATE
    // ============================================================

    var _registeredTabs = {};
    var _currentTab = null;
    var _isInitialized = false;
    var _dataReady = false;
    var _pendingTab = null;
    var _tabChangeListeners = [];

    // ============================================================
    // DOM REFS - Cached on init
    // ============================================================

    var _navLinks = null;           // All tab nav links
    var _tabContainers = null;      // All tab content containers
    var _navContainer = null;       // Navigation container

    // ============================================================
    // INITIALIZATION
    // ============================================================

    function init() {
        if (_isInitialized) {
            return;
        }

        // Cache DOM references
        _navContainer = document.getElementById('main-nav');
        if (_navContainer) {
            _navLinks = _navContainer.querySelectorAll('[data-tab]');
        }

        var containers = document.querySelectorAll('.tab-content');
        _tabContainers = [];
        for (var i = 0; i < containers.length; i++) {
            _tabContainers.push(containers[i]);
        }

        // Set up navigation events
        _bindNavEvents();

        // Set up hash change listener for deep linking
        window.addEventListener('hashchange', _handleHashChange);

        // Check if data is already ready
        if (DataLoader.getStatus() === 'ready') {
            _dataReady = true;
            _handleReady();
        } else {
            // Wait for data to be ready
            DataLoader.whenReady(function() {
                _dataReady = true;
                _handleReady();
            });
        }

        _isInitialized = true;
    }

    // ============================================================
    // NAVIGATION EVENTS
    // ============================================================

    function _bindNavEvents() {
        if (!_navContainer) {
            return;
        }

        // Use event delegation on the nav container
        _navContainer.addEventListener('click', function(e) {
            var link = e.target.closest('[data-tab]');
            if (!link) {
                return;
            }

            e.preventDefault();
            var tabName = link.getAttribute('data-tab');

            if (tabName && _registeredTabs[tabName]) {
                switchTo(tabName, true);
            }
        });
    }

    // ============================================================
    // HASH CHANGE HANDLER
    // ============================================================

    function _handleHashChange() {
        var hash = window.location.hash;
        var tabName = _parseHash(hash);

        if (tabName && _registeredTabs[tabName]) {
            switchTo(tabName, false);
        }
    }

    function _parseHash(hash) {
        if (!hash || hash.length < 2) {
            return null;
        }

        // Remove leading '#'
        var clean = hash.substring(1);

        // Check for query params
        var queryIndex = clean.indexOf('?');
        if (queryIndex !== -1) {
            clean = clean.substring(0, queryIndex);
        }

        return clean || null;
    }

    // ============================================================
    // DATA READY HANDLER
    // ============================================================

    function _handleReady() {
        // Process any pending tab
        if (_pendingTab && _registeredTabs[_pendingTab]) {
            switchTo(_pendingTab, false);
            _pendingTab = null;
        } else {
            // Try to restore from hash or use default
            var initialTab = _getInitialTab();
            if (initialTab && _registeredTabs[initialTab]) {
                switchTo(initialTab, false);
            } else {
                // Find first registered tab
                var firstTab = _getFirstRegisteredTab();
                if (firstTab) {
                    switchTo(firstTab, false);
                }
            }
        }

        // Dispatch event that TabManager is ready
        document.dispatchEvent(new CustomEvent('tabManagerReady', {
            detail: { currentTab: _currentTab }
        }));
    }

    function _getInitialTab() {
        // First priority: URL hash
        var hash = window.location.hash;
        var tabFromHash = _parseHash(hash);
        if (tabFromHash && _registeredTabs[tabFromHash]) {
            return tabFromHash;
        }

        // Second priority: 'dashboard' if registered
        if (_registeredTabs['dashboard']) {
            return 'dashboard';
        }

        // Third priority: first registered tab
        return _getFirstRegisteredTab();
    }

    function _getFirstRegisteredTab() {
        var keys = Object.keys(_registeredTabs);
        return keys.length > 0 ? keys[0] : null;
    }

    // ============================================================
    // PUBLIC API - Registration
    // ============================================================

    /**
     * Register a tab with a render function.
     * Features should call this during initialisation.
     * 
     * @param {string} tabName - Unique tab identifier
     * @param {function} renderFn - Function(container, data) => void
     * @returns {boolean} True if registration was successful
     */
    function register(tabName, renderFn) {
        if (!tabName || typeof tabName !== 'string') {
            console.warn('[TabManager] register: Invalid tab name');
            return false;
        }

        if (typeof renderFn !== 'function') {
            console.warn('[TabManager] register: Invalid render function for tab:', tabName);
            return false;
        }

        if (_registeredTabs[tabName]) {
            // Allow re-registration (e.g., hot reload)
            console.warn('[TabManager] register: Tab already registered, replacing:', tabName);
        }

        _registeredTabs[tabName] = renderFn;

        // If data is already ready and this is the first tab, switch to it
        if (_dataReady && !_currentTab && !_pendingTab) {
            var initialTab = _getInitialTab();
            if (initialTab === tabName) {
                switchTo(tabName, false);
            }
        }

        return true;
    }

    // ============================================================
    // PUBLIC API - Navigation
    // ============================================================

    /**
     * Switch to a tab.
     * 
     * @param {string} tabName - Tab identifier
     * @param {boolean} updateHistory - Whether to update URL hash (default: true)
     * @returns {boolean} True if switch was successful
     */
    function switchTo(tabName, updateHistory) {
        updateHistory = updateHistory !== false;

        // Validate tab is registered
        if (!_registeredTabs[tabName]) {
            console.warn('[TabManager] switchTo: Tab not registered:', tabName);
            return false;
        }

        // Wait for data if not ready
        if (!_dataReady) {
            _pendingTab = tabName;
            return true;
        }

        // Hide all tabs
        for (var i = 0; i < _tabContainers.length; i++) {
            _tabContainers[i].classList.remove('active');
        }

        // Show target tab container
        var targetContainer = document.getElementById('tab-' + tabName);
        if (targetContainer) {
            targetContainer.classList.add('active');
        } else {
            console.warn('[TabManager] switchTo: Container not found for tab:', tabName);
            return false;
        }

        // Update nav link active state
        if (_navLinks) {
            for (var j = 0; j < _navLinks.length; j++) {
                var link = _navLinks[j];
                var linkTab = link.getAttribute('data-tab');
                if (linkTab === tabName) {
                    link.classList.add('active');
                } else {
                    link.classList.remove('active');
                }
            }
        }

        // Call render function
        try {
            var renderFn = _registeredTabs[tabName];
            renderFn(targetContainer);
        } catch (e) {
            console.error('[TabManager] switchTo: Render error for tab:', tabName, e);
            return false;
        }

        // Update current tab
        var previousTab = _currentTab;
        _currentTab = tabName;

        // Update URL hash
        if (updateHistory) {
            var currentHash = window.location.hash;
            var newHash = '#' + tabName;
            if (currentHash !== newHash) {
                window.history.pushState(null, '', newHash);
            }
        }

        // Dispatch events
        var event = new CustomEvent('tabChanged', {
            detail: {
                tab: tabName,
                previousTab: previousTab
            }
        });
        document.dispatchEvent(event);

        // Notify listeners
        for (var k = 0; k < _tabChangeListeners.length; k++) {
            try {
                _tabChangeListeners[k](tabName, previousTab);
            } catch (e) {
                // Ignore listener errors
            }
        }

        return true;
    }

    /**
     * Force refresh the current tab.
     * Useful when data changes and the tab needs to re-render.
     * 
     * @param {string} tabName - Optional tab name (defaults to current)
     * @returns {boolean} True if refresh was successful
     */
    function forceRefresh(tabName) {
        tabName = tabName || _currentTab;

        if (!tabName) {
            console.warn('[TabManager] forceRefresh: No tab specified and no current tab');
            return false;
        }

        if (!_registeredTabs[tabName]) {
            console.warn('[TabManager] forceRefresh: Tab not registered:', tabName);
            return false;
        }

        // Re-render the current tab
        var targetContainer = document.getElementById('tab-' + tabName);
        if (!targetContainer) {
            console.warn('[TabManager] forceRefresh: Container not found:', tabName);
            return false;
        }

        try {
            var renderFn = _registeredTabs[tabName];
            renderFn(targetContainer);
        } catch (e) {
            console.error('[TabManager] forceRefresh: Render error for tab:', tabName, e);
            return false;
        }

        return true;
    }

    /**
     * Refresh the current tab.
     * Convenience wrapper for forceRefresh().
     */
    function refreshCurrent() {
        return forceRefresh(_currentTab);
    }

    // ============================================================
    // PUBLIC API - Queries
    // ============================================================

    /**
     * Get the current tab name.
     * 
     * @returns {string|null} Current tab name or null if none
     */
    function getCurrentTab() {
        return _currentTab;
    }

    /**
     * Check if a tab is active.
     * 
     * @param {string} tabName - Tab identifier
     * @returns {boolean} True if the tab is active
     */
    function isTabActive(tabName) {
        return _currentTab === tabName;
    }

    /**
     * Get the tab container for a tab.
     * 
     * @param {string} tabName - Tab identifier
     * @returns {HTMLElement|null} Container element or null
     */
    function getTabContainer(tabName) {
        return document.getElementById('tab-' + tabName);
    }

    /**
     * Check if a tab is registered.
     * 
     * @param {string} tabName - Tab identifier
     * @returns {boolean} True if the tab is registered
     */
    function isTabRegistered(tabName) {
        return !!_registeredTabs[tabName];
    }

    /**
     * Get all registered tab names.
     * 
     * @returns {Array} Array of registered tab names
     */
    function getRegisteredTabs() {
        return Object.keys(_registeredTabs);
    }

    // ============================================================
    // PUBLIC API - Listeners
    // ============================================================

    /**
     * Add a listener for tab changes.
     * 
     * @param {function} listener - Function(tabName, previousTab) => void
     * @returns {function} Unsubscribe function
     */
    function onTabChange(listener) {
        if (typeof listener !== 'function') {
            console.warn('[TabManager] onTabChange: Invalid listener');
            return function() {};
        }

        _tabChangeListeners.push(listener);

        return function() {
            var index = _tabChangeListeners.indexOf(listener);
            if (index !== -1) {
                _tabChangeListeners.splice(index, 1);
            }
        };
    }

    // ============================================================
    // PUBLIC API - Lifecycle
    // ============================================================

    /**
     * Called by bootstrap when data is ready.
     * This is the primary lifecycle entry point.
     */
    function onDataReady() {
        if (!_dataReady) {
            _dataReady = true;
            _handleReady();
        }
    }

    /**
     * Clean up event listeners.
     * Called during application destroy.
     */
    function destroy() {
        window.removeEventListener('hashchange', _handleHashChange);

        if (_navContainer) {
            // Remove click listener (using a copy of the listener)
            // Since we used an anonymous function, we need to clean up differently
            // We'll just remove all listeners by cloning
            var newNav = _navContainer.cloneNode(true);
            _navContainer.parentNode.replaceChild(newNav, _navContainer);
            _navContainer = newNav;
            _navLinks = _navContainer.querySelectorAll('[data-tab]');
        }

        _tabChangeListeners = [];
        _isInitialized = false;
    }

    // ============================================================
    // INITIALISE
    // ============================================================

    // Auto-initialise when DOM is ready
    function tryInit() {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            init();
        } else {
            document.addEventListener('DOMContentLoaded', init);
        }
    }

    tryInit();

    // ============================================================
    // EXPOSE - Controlled public API
    // ============================================================

    window.TabManager = {
        // Registration
        register: register,

        // Navigation
        switchTo: switchTo,
        forceRefresh: forceRefresh,
        refreshCurrent: refreshCurrent,

        // Queries
        getCurrentTab: getCurrentTab,
        isTabActive: isTabActive,
        getTabContainer: getTabContainer,
        isTabRegistered: isTabRegistered,
        getRegisteredTabs: getRegisteredTabs,

        // Listeners
        onTabChange: onTabChange,

        // Lifecycle
        onDataReady: onDataReady,
        destroy: destroy
    };

    window.__tabManagerLoaded = true;

})();
