/**
 * js/core/tab-manager.js - Tab Navigation System
 * Fixed: Removed duplicate initialization and lifecycle redundancy
 */

(function() {
    'use strict';

    if (window.__tabManagerLoaded) {
        return;
    }
    window.__tabManagerLoaded = true;

    var DEFAULT_TAB = 'dashboard';
    var SWITCH_DELAY = 50;
    var MAX_WAIT_TIME = 5000;

    var TabManager = {
        currentTab: DEFAULT_TAB,
        tabs: {},
        tabContentElements: {},
        navLinks: [],
        isInitialized: false,
        isRendering: false,
        _initializationStarted: false,
        _isDataReady: false,
        _pendingInitialTab: null,
        pendingTab: null,
        pendingUpdateHistory: false,
        switchTimeout: null,
        _registeredModules: {},
        _pendingRegistrations: {},
        _failedModules: {},
        _waitingForModules: {},

        init: function() {
            if (this.isInitialized) return;
            if (this._initializationStarted) return;
            this._initializationStarted = true;

            try {
                // Only find elements and bind links ONCE
                this._findTabContentElements();
                this._bindNavLinks();
                this._bindQuickLinks();
                
                this.isInitialized = true;

                var initialTab = this._getInitialTab();
                this._updateUrlHash(initialTab, false);
                this._pendingInitialTab = initialTab;

                if (this._isDataReady || window.data) {
                    this._isDataReady = true;
                    this._processInitialTab();
                }

                if (!this.tabs[initialTab]) {
                    console.log('[TabManager] Waiting for tab "' + initialTab + '" to load...');
                    this._waitingForModules[initialTab] = {
                        tab: initialTab,
                        startTime: Date.now()
                    };
                    
                    var self = this;
                    setTimeout(function() {
                        if (!self.tabs[initialTab] && self.currentTab === initialTab) {
                            console.warn('[TabManager] Tab "' + initialTab + '" failed to load, falling back to default.');
                            self.switchTo(DEFAULT_TAB, false);
                        }
                    }, MAX_WAIT_TIME);
                    
                    return;
                }

                var self = this;
                setTimeout(function() {
                    self.switchTo(initialTab, false);
                }, SWITCH_DELAY);

            } catch (error) {
                console.error('[TabManager] Initialization failed:', error);
            }
        },

        onDataReady: function() {
            this._isDataReady = true;
            this._processInitialTab();
        },

        _processInitialTab: function() {
            if (!this._isDataReady || !this._pendingInitialTab) return;

            var tab = this._pendingInitialTab;
            this._pendingInitialTab = null;

            if (this.tabs[tab]) {
                this.switchTo(tab, false);
            } else if (this._registeredModules[tab]) {
                console.log('[TabManager] Tab "' + tab + '" registered but not loaded, waiting...');
                this._pendingRegistrations[tab] = true;
            } else {
                if (tab !== DEFAULT_TAB) {
                    console.warn('[TabManager] Unknown tab "' + tab + '", falling back to default.');
                    this.switchTo(DEFAULT_TAB, false);
                }
            }
        },

        register: function(tabName, renderFn) {
            if (!tabName || typeof tabName !== 'string') {
                console.warn('[TabManager] Invalid tab name:', tabName);
                return false;
            }

            if (typeof renderFn !== 'function') {
                console.warn('[TabManager] Invalid render function for tab:', tabName);
                return false;
            }

            var key = tabName.trim();

            this.tabs[key] = renderFn;
            this._registeredModules[key] = true;
            delete this._failedModules[key];
            delete this._waitingForModules[key];

            console.log('[TabManager] Registered tab: "' + key + '"');

            if (this.isInitialized) {
                if (this.currentTab === key) {
                    var container = this.tabContentElements[key];
                    if (container) {
                        var self = this;
                        setTimeout(function() {
                            self._renderTab(key);
                        }, SWITCH_DELAY);
                    }
                }
                
                if (this._pendingRegistrations[key]) {
                    delete this._pendingRegistrations[key];
                    if (this.currentTab === key || this._pendingInitialTab === key) {
                        var container = this.tabContentElements[key];
                        if (container) {
                            var self = this;
                            setTimeout(function() {
                                self._renderTab(key);
                            }, SWITCH_DELAY);
                        }
                        if (this._pendingInitialTab === key) {
                            this._pendingInitialTab = null;
                        }
                    }
                }
            }

            return true;
        },

        hasTab: function(tabName) {
            if (!tabName) return false;
            return !!this.tabs[tabName.trim()];
        },

        getTabs: function() {
            return Object.keys(this.tabs);
        },

        isModuleRegistered: function(tabName) {
            if (!tabName) return false;
            return !!this._registeredModules[tabName.trim()];
        },

        switchTo: function(tabName, updateHistory) {
            if (!tabName) return;

            var key = tabName.trim();

            if (!this.tabs[key]) {
                if (this._registeredModules[key]) {
                    console.log('[TabManager] Tab "' + key + '" is registered but not yet loaded. Waiting...');
                    this._pendingRegistrations[key] = true;
                    return;
                }
                
                if (key !== DEFAULT_TAB) {
                    console.warn('[TabManager] Unknown tab "' + key + '", falling back to default.');
                    this.switchTo(DEFAULT_TAB, false);
                    return;
                }
                
                console.warn('[TabManager] Unknown tab "' + key + '"');
                return;
            }

            if (key === this.currentTab && this.isInitialized) {
                this._renderTab(key);
                return;
            }

            if (this.switchTimeout) {
                clearTimeout(this.switchTimeout);
                this.switchTimeout = null;
            }

            if (this.isRendering) {
                this.pendingTab = key;
                this.pendingUpdateHistory = updateHistory !== false;
                return;
            }

            var self = this;
            this.switchTimeout = setTimeout(function() {
                self._doSwitch(key, updateHistory !== false);
                self.switchTimeout = null;
            }, SWITCH_DELAY);
        },

        forceRefresh: function(tabName) {
            tabName = tabName || this.currentTab;

            if (!tabName) return;

            var key = tabName.trim();

            if (this.isRendering) {
                this.pendingTab = key;
                this.pendingUpdateHistory = false;
                return;
            }

            if (!this.tabs[key]) {
                console.warn('[TabManager] Cannot refresh unknown tab "' + key + '"');
                return;
            }

            this._renderTab(key);
        },

        refreshCurrent: function() {
            this.forceRefresh(this.currentTab);
        },

        getCurrentTab: function() {
            return this.currentTab;
        },

        isTabActive: function(tabName) {
            if (!tabName) return false;
            return this.currentTab === tabName.trim();
        },

        getTabContainer: function(tabName) {
            if (!tabName) return null;
            return this.tabContentElements[tabName.trim()] || null;
        },

        _findTabContentElements: function() {
            document.querySelectorAll('.tab-content').forEach(function(el) {
                var id = el.id;
                if (id && id.startsWith('tab-')) {
                    var tabName = id.replace('tab-', '');
                    this.tabContentElements[tabName] = el;
                }
            }, this);
        },

        _bindNavLinks: function() {
            var self = this;
            document.querySelectorAll('#main-nav a[data-tab]').forEach(function(link) {
                // Remove any existing listeners by cloning
                var newLink = link.cloneNode(true);
                link.parentNode.replaceChild(newLink, link);
                
                self.navLinks.push(newLink);

                newLink.addEventListener('click', function(e) {
                    e.preventDefault();
                    var tab = this.dataset.tab;
                    if (tab) {
                        TabManager.switchTo(tab, true);
                    }
                });
            });
        },

        _bindQuickLinks: function() {
            var selectors = [
                '.quick-link[data-tab]',
                '.stat-link[data-tab]',
                '.dashboard-card[data-tab]'
            ];

            var self = this;
            selectors.forEach(function(selector) {
                document.querySelectorAll(selector).forEach(function(link) {
                    var newLink = link.cloneNode(true);
                    link.parentNode.replaceChild(newLink, link);
                    
                    newLink.addEventListener('click', function(e) {
                        e.preventDefault();
                        var tab = this.dataset.tab;
                        if (tab) {
                            TabManager.switchTo(tab, true);
                        }
                    });
                });
            });
        },

        _getInitialTab: function() {
            var hash = window.location.hash.slice(1);
            
            if (!hash) {
                return DEFAULT_TAB;
            }

            if (this.tabs[hash] || this._registeredModules[hash]) {
                return hash;
            }

            console.warn('[TabManager] Unknown initial tab "' + hash + '", using default.');
            return DEFAULT_TAB;
        },

        _updateUrlHash: function(tabName, pushHistory) {
            if (!window.history) return;

            var hash = '#' + tabName;

            if (pushHistory !== false) {
                window.history.pushState(null, '', hash);
            } else if (window.history.replaceState) {
                window.history.replaceState(null, '', hash);
            }
        },

        _doSwitch: function(tabName, updateHistory) {
            if (this.isRendering) {
                this.pendingTab = tabName;
                this.pendingUpdateHistory = updateHistory !== false;
                return;
            }

            if (!this.tabs[tabName]) {
                console.warn('[TabManager] Cannot switch to unknown tab "' + tabName + '"');
                return;
            }

            this.isRendering = true;
            var previousTab = this.currentTab;
            this.currentTab = tabName;

            this._updateNavLinks(tabName);
            this._updateTabVisibility(tabName);
            this._closeMobileMenu();

            if (updateHistory !== false) {
                this._updateUrlHash(tabName, true);
            }

            this._renderTab(tabName);

            this.isRendering = false;

            var pending = this.pendingTab;
            var pendingUpdateHistory = this.pendingUpdateHistory;
            this.pendingTab = null;
            this.pendingUpdateHistory = false;

            if (pending && pending !== tabName) {
                this.switchTo(pending, pendingUpdateHistory);
            }

            this._dispatchTabChanged(tabName, previousTab);
        },

        _renderTab: function(tabName) {
            var container = this.tabContentElements[tabName];
            var renderFn = this.tabs[tabName];

            if (!container) {
                console.warn('[TabManager] Container not found for tab:', tabName);
                return;
            }

            if (!renderFn) {
                if (this._registeredModules[tabName]) {
                    container.innerHTML = '<p class="empty-state">Loading module... Please wait.</p>';
                    return;
                }
                
                if (this._failedModules[tabName]) {
                    container.innerHTML = '<p class="empty-state">Failed to load module. Please refresh the page.</p>';
                    return;
                }

                if (!container.innerHTML || container.innerHTML.trim() === '' || container.innerHTML.trim() === '<p class="empty-state">Module coming soon...</p>') {
                    container.innerHTML = '<p class="empty-state">Module coming soon...</p>';
                }
                return;
            }

            try {
                console.log('[TabManager] Rendering tab: "' + tabName + '"');
                renderFn(container);
                console.log('[TabManager] Tab "' + tabName + '" rendered successfully');
            } catch (e) {
                console.error('[TabManager] Error rendering tab "' + tabName + '":', e);
                this._failedModules[tabName] = true;
                container.innerHTML = '<p class="empty-state">Error loading tab content. Please try again.</p>';
            }
        },

        _updateNavLinks: function(tabName) {
            this.navLinks.forEach(function(link) {
                link.classList.toggle('active', link.dataset.tab === tabName);
            });
        },

        _updateTabVisibility: function(tabName) {
            for (var key in this.tabContentElements) {
                var el = this.tabContentElements[key];
                if (!el) continue;
                if (key === tabName) {
                    el.style.display = 'block';
                    el.classList.add('active');
                } else {
                    el.style.display = 'none';
                    el.classList.remove('active');
                }
            }
        },

        _closeMobileMenu: function() {
            var nav = document.getElementById('main-nav');
            var actions = document.getElementById('header-actions');
            var toggle = document.getElementById('nav-toggle');

            if (nav) nav.classList.remove('open');
            if (actions) actions.classList.remove('open');
            if (toggle) {
                toggle.classList.remove('open');
                toggle.textContent = '☰';
            }
        },

        _dispatchTabChanged: function(tabName, previousTab) {
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
        }
    };

    // ============================================================
    // GLOBAL EVENT HANDLERS
    // ============================================================

    window.addEventListener('hashchange', function() {
        if (!TabManager.isInitialized) return;

        var hash = window.location.hash.slice(1);
        if (hash && TabManager.tabs[hash]) {
            TabManager.switchTo(hash, false);
        } else if (hash) {
            console.warn('[TabManager] Unknown tab in URL: "' + hash + '"');
            var container = TabManager.tabContentElements[hash];
            if (container) {
                container.innerHTML = '<p class="empty-state">Module coming soon...</p>';
            }
        }
    });

    window.addEventListener('popstate', function() {
        if (!TabManager.isInitialized) return;

        var hash = window.location.hash.slice(1);
        if (hash && TabManager.tabs[hash]) {
            TabManager.switchTo(hash, false);
        }
    });

    document.addEventListener('dataReady', function(e) {
        if (TabManager.isInitialized) {
            TabManager.onDataReady();
            TabManager.refreshCurrent();
        } else {
            TabManager._isDataReady = true;
        }
    });

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TabManager = TabManager;

    // ============================================================
    // AUTO-INIT - Simplified (no duplicate work)
    // ============================================================

    function initTabManager() {
        if (TabManager.isInitialized || TabManager._initializationStarted) return;

        if (window.data) {
            TabManager._isDataReady = true;
        }

        TabManager.init();
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initTabManager();
    } else {
        document.addEventListener('DOMContentLoaded', initTabManager);
    }

})();
