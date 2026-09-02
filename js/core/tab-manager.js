/**
 * js/core/tab-manager.js - Tab Navigation System
 * Single source of truth for tab lifecycle and navigation
 * 
 * IMPORTANT:
 *   - TabManager is the SINGLE source of truth for tab lifecycle
 *   - Modules register with TabManager, TabManager calls them
 *   - No module should listen for dataReady/tabChanged to render itself
 *   - Data readiness is handled by TabManager before calling render functions
 */

(function() {
    'use strict';

    // Guard against duplicate loading
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

        init: function() {
            if (this.isInitialized) return;
            if (this._initializationStarted) return;
            this._initializationStarted = true;

            try {
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
                    var self = this;
                    setTimeout(function() {
                        if (!self.tabs[initialTab] && self.currentTab === initialTab) {
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
            
            this._dispatchReady();
        },

        _dispatchReady: function() {
            try {
                var event = new CustomEvent('tabManagerReady', {
                    detail: { 
                        isInitialized: this.isInitialized,
                        currentTab: this.currentTab,
                        tabs: Object.keys(this.tabs)
                    },
                    bubbles: true,
                    cancelable: false
                });
                document.dispatchEvent(event);
            } catch (e) {
                // Ignore event dispatch errors
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
            } else {
                if (tab !== DEFAULT_TAB) {
                    this.switchTo(DEFAULT_TAB, false);
                }
            }
        },

        register: function(tabName, renderFn) {
            if (!tabName || typeof tabName !== 'string') {
                return false;
            }

            if (typeof renderFn !== 'function') {
                return false;
            }

            var key = tabName.trim();
            this.tabs[key] = renderFn;

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

        switchTo: function(tabName, updateHistory) {
            if (!tabName) return;

            var key = tabName.trim();

            if (!this.tabs[key]) {
                if (key !== DEFAULT_TAB) {
                    this.switchTo(DEFAULT_TAB, false);
                    return;
                }
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

            if (this.tabs[hash]) {
                return hash;
            }

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
        }
    });

    window.addEventListener('popstate', function() {
        if (!TabManager.isInitialized) return;

        var hash = window.location.hash.slice(1);
        if (hash && TabManager.tabs[hash]) {
            TabManager.switchTo(hash, false);
        }
    });

    // NOTE: dataReady listener REMOVED - TabManager is the single source of truth
    // Modules should not auto-render on dataReady - TabManager handles this

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TabManager = TabManager;

    // ============================================================
    // AUTO-INIT
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
