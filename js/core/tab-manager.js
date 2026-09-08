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

    if (window.__tabManagerLoaded) {
        return;
    }

    if (!window.DataLoader || typeof window.DataLoader.whenReady !== 'function') {
        throw new Error('[TabManager] DataLoader is required.');
    }

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

    var _navLinks = null;
    var _tabContainers = null;
    var _navContainer = null;

    // ============================================================
    // INITIALIZATION
    // ============================================================

    function init() {
        if (_isInitialized) {
            return;
        }

        refreshDomCache();

        _bindNavEvents();

        window.addEventListener('hashchange', _handleHashChange);

        if (DataLoader.getStatus() === 'ready') {
            _dataReady = true;
            _handleReady();
        } else {
            DataLoader.whenReady(function() {
                _dataReady = true;
                _handleReady();
            });
        }

        _isInitialized = true;
    }

    // ============================================================
    // DOM CACHE
    // ============================================================

    function refreshDomCache() {
        _navContainer = document.getElementById('main-nav');
        if (_navContainer) {
            _navLinks = _navContainer.querySelectorAll('[data-tab]');
        }

        var containers = document.querySelectorAll('.tab-content');
        _tabContainers = [];
        for (var i = 0; i < containers.length; i++) {
            _tabContainers.push(containers[i]);
        }
    }

    // ============================================================
    // NAVIGATION EVENTS
    // ============================================================

    function _bindNavEvents() {
        if (!_navContainer) {
            return;
        }

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

        var clean = hash.substring(1);

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
        if (_pendingTab && _registeredTabs[_pendingTab]) {
            switchTo(_pendingTab, false);
            _pendingTab = null;
        } else {
            var initialTab = _getInitialTab();
            if (initialTab && _registeredTabs[initialTab]) {
                switchTo(initialTab, false);
            } else {
                var firstTab = _getFirstRegisteredTab();
                if (firstTab) {
                    switchTo(firstTab, false);
                }
            }
        }

        document.dispatchEvent(new CustomEvent('tabManagerReady', {
            detail: { currentTab: _currentTab }
        }));
    }

    function _getInitialTab() {
        var hash = window.location.hash;
        var tabFromHash = _parseHash(hash);
        if (tabFromHash && _registeredTabs[tabFromHash]) {
            return tabFromHash;
        }

        if (_registeredTabs['dashboard']) {
            return 'dashboard';
        }

        return _getFirstRegisteredTab();
    }

    function _getFirstRegisteredTab() {
        var keys = Object.keys(_registeredTabs);
        return keys.length > 0 ? keys[0] : null;
    }

    // ============================================================
    // PUBLIC API - Registration
    // ============================================================

    function register(tabName, renderFn) {
        if (!tabName || typeof tabName !== 'string') {
            return false;
        }

        if (typeof renderFn !== 'function') {
            return false;
        }

        _registeredTabs[tabName] = renderFn;

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

    function switchTo(tabName, updateHistory) {
        updateHistory = updateHistory !== false;

        if (!_registeredTabs[tabName]) {
            return false;
        }

        if (!_dataReady) {
            _pendingTab = tabName;
            return true;
        }

        for (var i = 0; i < _tabContainers.length; i++) {
            _tabContainers[i].classList.remove('active');
        }

        var targetContainer = document.getElementById('tab-' + tabName);
        if (!targetContainer) {
            return false;
        }
        targetContainer.classList.add('active');

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

        try {
            var renderFn = _registeredTabs[tabName];
            renderFn(targetContainer);
        } catch (e) {
            return false;
        }

        var previousTab = _currentTab;
        _currentTab = tabName;

        if (updateHistory) {
            var currentHash = window.location.hash;
            var newHash = '#' + tabName;
            if (currentHash !== newHash) {
                window.history.pushState(null, '', newHash);
            }
        }

        document.dispatchEvent(new CustomEvent('tabChanged', {
            detail: {
                tab: tabName,
                previousTab: previousTab
            }
        }));

        for (var k = 0; k < _tabChangeListeners.length; k++) {
            try {
                _tabChangeListeners[k](tabName, previousTab);
            } catch (e) {
                // Ignore listener errors
            }
        }

        return true;
    }

    function forceRefresh(tabName) {
        tabName = tabName || _currentTab;

        if (!tabName) {
            return false;
        }

        if (!_registeredTabs[tabName]) {
            return false;
        }

        var targetContainer = document.getElementById('tab-' + tabName);
        if (!targetContainer) {
            return false;
        }

        try {
            var renderFn = _registeredTabs[tabName];
            renderFn(targetContainer);
        } catch (e) {
            return false;
        }

        return true;
    }

    function refreshCurrent() {
        return forceRefresh(_currentTab);
    }

    // ============================================================
    // PUBLIC API - Queries
    // ============================================================

    function getCurrentTab() {
        return _currentTab;
    }

    function isTabActive(tabName) {
        return _currentTab === tabName;
    }

    function getTabContainer(tabName) {
        return document.getElementById('tab-' + tabName);
    }

    function isTabRegistered(tabName) {
        return !!_registeredTabs[tabName];
    }

    function getRegisteredTabs() {
        return Object.keys(_registeredTabs);
    }

    // ============================================================
    // PUBLIC API - Listeners
    // ============================================================

    function onTabChange(listener) {
        if (typeof listener !== 'function') {
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

    function onDataReady() {
        if (!_dataReady) {
            _dataReady = true;
            _handleReady();
        }
    }

    function destroy() {
        window.removeEventListener('hashchange', _handleHashChange);

        if (_navContainer) {
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

    function tryInit() {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            init();
        } else {
            document.addEventListener('DOMContentLoaded', init);
        }
    }

    tryInit();

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TabManager = {
        register: register,
        switchTo: switchTo,
        forceRefresh: forceRefresh,
        refreshCurrent: refreshCurrent,
        getCurrentTab: getCurrentTab,
        isTabActive: isTabActive,
        getTabContainer: getTabContainer,
        isTabRegistered: isTabRegistered,
        getRegisteredTabs: getRegisteredTabs,
        onTabChange: onTabChange,
        onDataReady: onDataReady,
        destroy: destroy,
        refreshDomCache: refreshDomCache
    };

    window.__tabManagerLoaded = true;

})();
