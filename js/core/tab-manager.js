/**
 * js/core/tab-manager.js - Tab Manager
 * Single source of truth for tab navigation and lifecycle
 * Path: js/core/tab-manager.js
 *
 * Handles:
 *   - Tab registration with render functions
 *   - Optional per-tab unmount hooks
 *   - Tab switching (programmatic and user-initiated)
 *   - Active tab tracking
 *   - URL hash persistence
 *
 * IMPORTANT:
 *   - TabManager is the SINGLE SOURCE OF TRUTH for navigation state.
 *   - Features register with a render function.
 *   - Render runs BEFORE the DOM is committed, so a throwing render
 *     does not leave a half-switched UI.
 *   - onDataReady(data) requires `data`. A null argument (loader
 *     failure) is ignored.
 *   - Nav clicks honour ctrl/meta/middle-click for "open in new tab".
 *
 * DEPENDENCIES:
 *   - window.DataLoader (from loader.js) - MANDATORY
 *
 * USAGE:
 *   TabManager.register('characters', renderFn, unmountFn?);
 *   TabManager.switchTo('characters');
 *   TabManager.getCurrentTab();
 */

(function() {
    'use strict';

    if (window.__tabManagerLoaded) return;

    if (!window.DataLoader ||
        typeof window.DataLoader.whenReady !== 'function') {
        throw new Error('[TabManager] DataLoader is required.');
    }

    var DataLoader = window.DataLoader;

    // ============================================================
    // PRIVATE STATE
    // ============================================================

    var _registeredTabs = {};       // name -> { render, unmount }
    var _currentTab = null;
    var _isInitialized = false;
    var _dataReady = false;
    var _pendingTab = null;
    var _tabChangeListeners = [];
    var _navClickHandler = null;

    // ============================================================
    // DOM QUERIES - always live
    // ============================================================

    function queryNavLinks() {
        var nav = document.getElementById('main-nav');
        if (!nav) { return []; }
        var nodes = nav.querySelectorAll('[data-tab]');
        return Array.prototype.slice.call(nodes);
    }

    function queryTabContainers() {
        var nodes = document.querySelectorAll('.tab-content');
        return Array.prototype.slice.call(nodes);
    }

    function getContainerFor(tabName) {
        return document.getElementById('tab-' + tabName);
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================

    function init() {
        if (_isInitialized) { return; }

        _bindNavEvents();
        window.addEventListener('hashchange', _handleHashChange);

        if (DataLoader.getStatus() === 'ready') {
            onDataReady(window.data);
        } else {
            DataLoader.whenReady(
                function(data) { onDataReady(data); },
                function() { /* failure: do nothing here */ }
            );
        }

        _isInitialized = true;
    }

    // ============================================================
    // NAVIGATION EVENTS
    // ============================================================

    function _bindNavEvents() {
        var nav = document.getElementById('main-nav');
        if (!nav) { return; }

        // Replace any prior handler to avoid double-binding on re-init.
        if (_navClickHandler) {
            nav.removeEventListener('click', _navClickHandler);
        }

        _navClickHandler = function(e) {
            // Respect modifier clicks.
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) {
                return;
            }

            var link = e.target.closest('[data-tab]');
            if (!link) { return; }

            e.preventDefault();
            var tabName = link.getAttribute('data-tab');
            if (tabName && _registeredTabs[tabName]) {
                switchTo(tabName, true);
            }
        };

        nav.addEventListener('click', _navClickHandler);
    }

    // ============================================================
    // HASH HANDLING
    // ============================================================

    function _handleHashChange() {
        var tabName = _parseHash(window.location.hash);
        if (tabName && _registeredTabs[tabName]) {
            switchTo(tabName, false);
        } else if (!tabName && _currentTab) {
            // Empty hash: fall back to current tab without pushing.
            _commitHash(_currentTab, true);
        }
    }

    function _parseHash(hash) {
        if (!hash || hash.length < 2) { return null; }
        var clean = hash.substring(1);
        var queryIndex = clean.indexOf('?');
        if (queryIndex !== -1) {
            clean = clean.substring(0, queryIndex);
        }
        return clean || null;
    }

    function _commitHash(tabName, replace) {
        var newHash = '#' + tabName;
        if (window.location.hash === newHash) { return; }

        try {
            if (replace) {
                window.history.replaceState(null, '', newHash);
            } else {
                window.history.pushState(null, '', newHash);
            }
        } catch (e) {
            window.location.hash = newHash;
        }
    }

    // ============================================================
    // DATA READY HANDLER
    // ============================================================

    function _handleReady() {
        if (_pendingTab && _registeredTabs[_pendingTab]) {
            switchTo(_pendingTab, true);  // replace for the very first commit
            _pendingTab = null;
        } else {
            var initialTab = _getInitialTab();
            if (initialTab && _registeredTabs[initialTab]) {
                switchTo(initialTab, true);
            }
        }

        try {
            document.dispatchEvent(new CustomEvent('tabManagerReady', {
                detail: { currentTab: _currentTab }
            }));
        } catch (e) {
            // Ignore
        }
    }

    function _getInitialTab() {
        var tabFromHash = _parseHash(window.location.hash);
        if (tabFromHash && _registeredTabs[tabFromHash]) {
            return tabFromHash;
        }
        if (_registeredTabs['dashboard']) { return 'dashboard'; }
        var keys = Object.keys(_registeredTabs);
        return keys.length > 0 ? keys[0] : null;
    }

    // ============================================================
    // PUBLIC API - Registration
    // ============================================================

    function register(tabName, renderFn, unmountFn) {
        if (!tabName || typeof tabName !== 'string') { return false; }
        if (typeof renderFn !== 'function') { return false; }

        _registeredTabs[tabName] = {
            render: renderFn,
            unmount: typeof unmountFn === 'function' ? unmountFn : null
        };

        // If a deep link to this tab is waiting and data is ready,
        // honour it.
        if (_dataReady) {
            if (_pendingTab === tabName) {
                _pendingTab = null;
                switchTo(tabName, true);
            } else if (!_currentTab) {
                var initialTab = _getInitialTab();
                if (initialTab === tabName) {
                    switchTo(tabName, true);
                }
            }
        } else if (!_pendingTab) {
            var hashTab = _parseHash(window.location.hash);
            if (hashTab === tabName) {
                _pendingTab = tabName;
            }
        }

        return true;
    }

    // ============================================================
    // PUBLIC API - Navigation
    // ============================================================

    function switchTo(tabName, replaceHash) {
        replaceHash = replaceHash === true;

        if (!_registeredTabs[tabName]) { return false; }

        if (!_dataReady) {
            _pendingTab = tabName;
            return true;
        }

        // 1. Look up the container BEFORE touching the DOM.
        var targetContainer = getContainerFor(tabName);
        if (!targetContainer) {
            console.error('[TabManager] No container for tab "' + tabName + '"');
            return false;
        }

        // 2. Run any active unmount hook.
        if (_currentTab && _currentTab !== tabName) {
            var prevEntry = _registeredTabs[_currentTab];
            if (prevEntry && prevEntry.unmount) {
                try {
                    prevEntry.unmount();
                } catch (e) {
                    console.error('[TabManager] unmount failed:', e);
                }
            }
        }

        // 3. Render into the target while it is not yet active, so a
        //    throwing render is visible only in the console, not on
        //    screen.
        var previousTab = _currentTab;
        var previousContainer = previousTab ? getContainerFor(previousTab) : null;

        try {
            _registeredTabs[tabName].render(targetContainer);
        } catch (e) {
            console.error('[TabManager] render failed for tab "' + tabName + '":', e);
            // Restore previous tab highlight/visibility if any.
            if (previousContainer) {
                // Nothing changed yet for the previous tab; leave it.
            }
            return false;
        }

        // 4. Commit DOM: hide everything else, show target.
        var containers = queryTabContainers();
        for (var i = 0; i < containers.length; i++) {
            containers[i].classList.remove('active');
        }
        targetContainer.classList.add('active');

        // 5. Update nav links.
        var links = queryNavLinks();
        for (var j = 0; j < links.length; j++) {
            var link = links[j];
            var linkTab = link.getAttribute('data-tab');
            if (linkTab === tabName) {
                link.classList.add('active');
                link.setAttribute('aria-selected', 'true');
            } else {
                link.classList.remove('active');
                link.setAttribute('aria-selected', 'false');
            }
        }

        // 6. Update current tab BEFORE listeners observe it.
        _currentTab = tabName;

        // 7. Update URL.
        _commitHash(tabName, replaceHash || previousTab === null);

        // 8. Notify.
        try {
            document.dispatchEvent(new CustomEvent('tabChanged', {
                detail: { tab: tabName, previousTab: previousTab }
            }));
        } catch (e) {
            // Ignore
        }

        var listeners = _tabChangeListeners.slice();
        for (var k = 0; k < listeners.length; k++) {
            try {
                listeners[k](tabName, previousTab);
            } catch (e) {
                console.error('[TabManager] tab change listener error:', e);
            }
        }

        return true;
    }

    function forceRefresh(tabName) {
        tabName = tabName || _currentTab;
        if (!tabName) { return false; }
        if (!_registeredTabs[tabName]) { return false; }

        var container = getContainerFor(tabName);
        if (!container) { return false; }

        try {
            _registeredTabs[tabName].render(container);
        } catch (e) {
            console.error('[TabManager] forceRefresh render failed:', e);
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

    function getCurrentTab() { return _currentTab; }
    function isTabActive(tabName) { return _currentTab === tabName; }
    function getTabContainer(tabName) { return getContainerFor(tabName); }
    function isTabRegistered(tabName) { return !!_registeredTabs[tabName]; }
    function getRegisteredTabs() { return Object.keys(_registeredTabs); }

    // ============================================================
    // PUBLIC API - Listeners
    // ============================================================

    function onTabChange(listener) {
        if (typeof listener !== 'function') {
            return function() {};
        }
        _tabChangeListeners.push(listener);
        return function() {
            var idx = _tabChangeListeners.indexOf(listener);
            if (idx !== -1) { _tabChangeListeners.splice(idx, 1); }
        };
    }

    // ============================================================
    // PUBLIC API - Lifecycle
    // ============================================================

    /**
     * Called by Bootstrap on success. Requires data; ignores a null
     * argument so a loader failure does not cause a render against
     * missing state.
     */
    function onDataReady(data) {
        if (!data) { return; }
        if (_dataReady) { return; }

        _dataReady = true;
        _handleReady();
    }

    function destroy() {
        window.removeEventListener('hashchange', _handleHashChange);

        var nav = document.getElementById('main-nav');
        if (nav && _navClickHandler) {
            nav.removeEventListener('click', _navClickHandler);
        }
        _navClickHandler = null;

        _tabChangeListeners = [];
        _registeredTabs = {};
        _currentTab = null;
        _pendingTab = null;
        _dataReady = false;
        _isInitialized = false;
    }

    // ============================================================
    // INITIALISE
    // ============================================================

    if (document.readyState === 'complete' ||
        document.readyState === 'interactive') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TabManager = Object.freeze({
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
        destroy: destroy
    });

    window.__tabManagerLoaded = true;

})();
