/**
 * js/core/tab-manager.js - Tab Navigation System
 * Handles tab switching and module registration
 * Path: js/core/tab-manager.js
 * 
 * This module is responsible for:
 *   - Managing tab navigation across the application
 *   - Registering tab renderers from modules
 *   - Handling tab switching with state persistence
 *   - Managing module loading states
 *   - Providing fallback for missing modules
 * 
 * IMPORTANT:
 *   - Tabs are registered by modules via register()
 *   - The manager handles pending registrations for lazy-loaded modules
 *   - URL hash is used for state persistence
 *   - Mobile menu is closed on tab switch
 *   - All tab content containers must have id="tab-{name}"
 *   - Navigation links must have data-tab="{name}" attribute
 * 
 * DEPENDENCIES:
 *   - None (self-contained)
 * 
 * USAGE:
 *   // Register a tab
 *   TabManager.register('mytab', function(container) {
 *       container.innerHTML = '<p>My Tab Content</p>';
 *   });
 * 
 *   // Switch to a tab
 *   TabManager.switchTo('mytab');
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
    window.__tabManagerLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var DEFAULT_TAB = 'dashboard';
    var SWITCH_DELAY = 50;
    var MAX_WAIT_TIME = 5000; // 5 seconds max wait for modules

    // ============================================================
    // TAB MANAGER
    // ============================================================

    var TabManager = {
        // Current active tab
        currentTab: DEFAULT_TAB,
        
        // Registered tab renderers: { tabName: renderFunction }
        tabs: {},
        
        // Tab content elements: { tabName: HTMLElement }
        tabContentElements: {},
        
        // Navigation links
        navLinks: [],
        
        // State flags
        isInitialized: false,
        isRendering: false,
        _initializationStarted: false,
        
        // Pending operations
        pendingTab: null,
        pendingUpdateHistory: false,
        switchTimeout: null,
        
        // Module registration tracking
        _registeredModules: {},
        _pendingRegistrations: {},
        _failedModules: {},
        _waitingForModules: {},

        // ============================================================
        // INITIALIZATION
        // ============================================================

        init: function() {
            if (this.isInitialized) {
                return;
            }

            if (this._initializationStarted) {
                return;
            }
            this._initializationStarted = true;

            try {
                this._findTabContentElements();
                this._bindNavLinks();
                this._bindQuickLinks();
                
                this.isInitialized = true;

                // Get initial tab from URL hash or default
                var initialTab = this._getInitialTab();
                
                // Update URL without history entry
                this._updateUrlHash(initialTab, false);

                // If the tab is not yet registered, wait for it
                if (!this.tabs[initialTab]) {
                    console.log('[TabManager] Waiting for tab "' + initialTab + '" to load...');
                    this._waitingForModules[initialTab] = {
                        tab: initialTab,
                        startTime: Date.now()
                    };
                    
                    // Set a timeout to fall back to default
                    var self = this;
                    setTimeout(function() {
                        if (!self.tabs[initialTab] && self.currentTab === initialTab) {
                            console.warn('[TabManager] Tab "' + initialTab + '" failed to load, falling back to default.');
                            self.switchTo(DEFAULT_TAB, false);
                        }
                    }, MAX_WAIT_TIME);
                    
                    return;
                }

                // Switch to initial tab
                var self = this;
                setTimeout(function() {
                    self.switchTo(initialTab, false);
                }, SWITCH_DELAY);

            } catch (error) {
                console.error('[TabManager] Initialization failed:', error);
            }
        },

        // ============================================================
        // REGISTRATION
        // ============================================================

        /**
         * Register a tab renderer
         * @param {string} tabName - Unique tab identifier
         * @param {function} renderFn - Render function (container) => void
         * @returns {boolean} True if registration succeeded
         */
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

            // Store the renderer
            this.tabs[key] = renderFn;
            this._registeredModules[key] = true;
            delete this._failedModules[key];
            delete this._waitingForModules[key];

            console.log('[TabManager] Registered tab: "' + key + '"');

            // If this tab is currently active or pending, render it
            if (this.isInitialized) {
                // Check if this is the current tab
                if (this.currentTab === key) {
                    var container = this.tabContentElements[key];
                    if (container) {
                        var self = this;
                        setTimeout(function() {
                            self._renderTab(key);
                        }, SWITCH_DELAY);
                    }
                }
                
                // Check if this was a pending registration
                if (this._pendingRegistrations[key]) {
                    delete this._pendingRegistrations[key];
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
            }

            return true;
        },

        /**
         * Check if a tab has been registered
         */
        hasTab: function(tabName) {
            if (!tabName) {
                return false;
            }
            return !!this.tabs[tabName.trim()];
        },

        /**
         * Get all registered tab names
         */
        getTabs: function() {
            return Object.keys(this.tabs);
        },

        /**
         * Check if a module has been registered (even if renderer isn't loaded)
         */
        isModuleRegistered: function(tabName) {
            if (!tabName) {
                return false;
            }
            return !!this._registeredModules[tabName.trim()];
        },

        // ============================================================
        // TAB SWITCHING
        // ============================================================

        /**
         * Switch to a tab
         * @param {string} tabName - Tab identifier
         * @param {boolean} updateHistory - Whether to update URL hash (default: true)
         */
        switchTo: function(tabName, updateHistory) {
            if (!tabName) {
                return;
            }

            var key = tabName.trim();

            // Check if tab exists
            if (!this.tabs[key]) {
                // Check if module is registered but renderer not loaded
                if (this._registeredModules[key]) {
                    console.log('[TabManager] Tab "' + key + '" is registered but not yet loaded. Waiting...');
                    this._pendingRegistrations[key] = true;
                    return;
                }
                
                // Unknown tab - fall back to default
                if (key !== DEFAULT_TAB) {
                    console.warn('[TabManager] Unknown tab "' + key + '", falling back to default.');
                    this.switchTo(DEFAULT_TAB, false);
                    return;
                }
                
                console.warn('[TabManager] Unknown tab "' + key + '"');
                return;
            }

            // If already on this tab, do nothing
            if (key === this.currentTab && this.isInitialized) {
                return;
            }

            // Clear any pending switch
            if (this.switchTimeout) {
                clearTimeout(this.switchTimeout);
                this.switchTimeout = null;
            }

            // If currently rendering, defer
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

        /**
         * Force a refresh of the current tab's content
         * @param {string} tabName - Tab to refresh (defaults to current)
         */
        forceRefresh: function(tabName) {
            tabName = tabName || this.currentTab;

            if (!tabName) {
                return;
            }

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

        /**
         * Refresh the current tab
         */
        refreshCurrent: function() {
            this.forceRefresh(this.currentTab);
        },

        // ============================================================
        // QUERY METHODS
        // ============================================================

        /**
         * Get the current tab name
         */
        getCurrentTab: function() {
            return this.currentTab;
        },

        /**
         * Check if a tab is active
         */
        isTabActive: function(tabName) {
            if (!tabName) {
                return false;
            }
            return this.currentTab === tabName.trim();
        },

        /**
         * Get the container element for a tab
         */
        getTabContainer: function(tabName) {
            if (!tabName) {
                return null;
            }
            return this.tabContentElements[tabName.trim()] || null;
        },

        // ============================================================
        // PRIVATE METHODS
        // ============================================================

        /**
         * Find all tab content elements
         */
        _findTabContentElements: function() {
            document.querySelectorAll('.tab-content').forEach(function(el) {
                var id = el.id;
                if (id && id.startsWith('tab-')) {
                    var tabName = id.replace('tab-', '');
                    this.tabContentElements[tabName] = el;
                }
            }, this);
        },

        /**
         * Bind navigation links
         */
        _bindNavLinks: function() {
            var self = this;
            document.querySelectorAll('#main-nav a[data-tab]').forEach(function(link) {
                self.navLinks.push(link);

                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    var tab = this.dataset.tab;
                    if (tab) {
                        TabManager.switchTo(tab, true);
                    }
                });
            });
        },

        /**
         * Bind quick links (dashboard shortcuts)
         */
        _bindQuickLinks: function() {
            var selectors = [
                '.quick-link[data-tab]',
                '.stat-link[data-tab]',
                '.dashboard-card[data-tab]'
            ];

            var self = this;
            selectors.forEach(function(selector) {
                document.querySelectorAll(selector).forEach(function(link) {
                    link.addEventListener('click', function(e) {
                        e.preventDefault();
                        var tab = this.dataset.tab;
                        if (tab) {
                            TabManager.switchTo(tab, true);
                        }
                    });
                });
            });
        },

        /**
         * Get initial tab from URL hash
         * If the tab is not registered, default to 'dashboard'
         */
        _getInitialTab: function() {
            var hash = window.location.hash.slice(1);
            
            // If hash is empty, use default
            if (!hash) {
                return DEFAULT_TAB;
            }

            // If tab is registered, use it
            if (this.tabs[hash]) {
                return hash;
            }

            // If tab is pending registration, use it but mark as waiting
            if (this._registeredModules[hash]) {
                return hash;
            }

            // Unknown tab - use default
            console.warn('[TabManager] Unknown initial tab "' + hash + '", using default.');
            return DEFAULT_TAB;
        },

        /**
         * Update URL hash
         */
        _updateUrlHash: function(tabName, pushHistory) {
            if (!window.history) {
                return;
            }

            var hash = '#' + tabName;

            if (pushHistory !== false) {
                window.history.pushState(null, '', hash);
            } else if (window.history.replaceState) {
                window.history.replaceState(null, '', hash);
            }
        },

        /**
         * Perform tab switch
         */
        _doSwitch: function(tabName, updateHistory) {
            // If still rendering, defer
            if (this.isRendering) {
                this.pendingTab = tabName;
                this.pendingUpdateHistory = updateHistory !== false;
                return;
            }

            // Double-check tab exists
            if (!this.tabs[tabName]) {
                console.warn('[TabManager] Cannot switch to unknown tab "' + tabName + '"');
                return;
            }

            this.isRendering = true;
            var previousTab = this.currentTab;
            this.currentTab = tabName;

            // Update navigation links
            this._updateNavLinks(tabName);

            // Update tab content visibility
            this._updateTabVisibility(tabName);

            // Close mobile menu
            this._closeMobileMenu();

            // Update URL hash
            if (updateHistory !== false) {
                this._updateUrlHash(tabName, true);
            }

            // Render the tab content
            this._renderTab(tabName);

            this.isRendering = false;

            // Handle pending tab switch
            var pending = this.pendingTab;
            var pendingUpdateHistory = this.pendingUpdateHistory;
            this.pendingTab = null;
            this.pendingUpdateHistory = false;

            if (pending && pending !== tabName) {
                this.switchTo(pending, pendingUpdateHistory);
            }

            // Dispatch events
            this._dispatchTabChanged(tabName, previousTab);
        },

        /**
         * Render tab content
         */
        _renderTab: function(tabName) {
            var container = this.tabContentElements[tabName];
            var renderFn = this.tabs[tabName];

            if (!container) {
                console.warn('[TabManager] Container not found for tab:', tabName);
                return;
            }

            if (!renderFn) {
                // Check if module is registered but renderer not loaded
                if (this._registeredModules[tabName]) {
                    container.innerHTML = '<p class="empty-state">Loading module... Please wait.</p>';
                    return;
                }
                
                // Check if module failed to load
                if (this._failedModules[tabName]) {
                    container.innerHTML = '<p class="empty-state">Failed to load module. Please refresh the page.</p>';
                    return;
                }

                // Keep existing placeholder content if it's not empty
                if (!container.innerHTML || container.innerHTML.trim() === '') {
                    container.innerHTML = '<p class="empty-state">Tab content not available.</p>';
                }
                return;
            }

            try {
                renderFn(container);
            } catch (e) {
                console.error('[TabManager] Error rendering tab "' + tabName + '":', e);
                this._failedModules[tabName] = true;
                container.innerHTML = '<p class="empty-state">Error loading tab content. Please try again.</p>';
            }
        },

        /**
         * Update navigation link active states
         */
        _updateNavLinks: function(tabName) {
            this.navLinks.forEach(function(link) {
                link.classList.toggle('active', link.dataset.tab === tabName);
            });
        },

        /**
         * Update tab content visibility
         */
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

        /**
         * Close mobile menu
         */
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

        /**
         * Dispatch tab changed event
         */
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

    // Handle hash changes - update tab without adding history
    window.addEventListener('hashchange', function() {
        if (!TabManager.isInitialized) {
            return;
        }

        var hash = window.location.hash.slice(1);
        if (hash && TabManager.tabs[hash]) {
            TabManager.switchTo(hash, false);
        } else if (hash) {
            // Unknown tab in URL - show placeholder
            console.warn('[TabManager] Unknown tab in URL: "' + hash + '"');
            // Don't switch, just update the container to show placeholder
            var container = TabManager.tabContentElements[hash];
            if (container) {
                container.innerHTML = '<p class="empty-state">Module coming soon...</p>';
            }
        }
    });

    // Handle browser back/forward
    window.addEventListener('popstate', function() {
        if (!TabManager.isInitialized) {
            return;
        }

        var hash = window.location.hash.slice(1);
        if (hash && TabManager.tabs[hash]) {
            TabManager.switchTo(hash, false);
        }
    });

    // Handle data ready - refresh current tab
    document.addEventListener('dataReady', function() {
        if (TabManager.isInitialized) {
            TabManager.refreshCurrent();
        }
    });

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TabManager = TabManager;

    // ============================================================
    // AUTO-INIT - Wait for modules to register
    // ============================================================

    /**
     * Initialize TabManager after all modules have had a chance to register.
     * Uses a short delay to allow script execution order to complete.
     */
    function initTabManager() {
        if (TabManager.isInitialized || TabManager._initializationStarted) {
            return;
        }

        // Wait a short time for modules to register their tabs
        setTimeout(function() {
            TabManager.init();
        }, 100);
    }

    // Start initialization after DOM is ready
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initTabManager();
    } else {
        document.addEventListener('DOMContentLoaded', initTabManager);
    }

})();
