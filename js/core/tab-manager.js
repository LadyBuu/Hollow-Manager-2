/**
 * js/core/tab-manager.js - Tab Navigation System
 * Handles tab switching and module registration
 * Path: js/core/tab-manager.js
 */

var TabManager = {
    currentTab: 'dashboard',
    tabs: {},
    tabContentElements: {},
    navLinks: [],
    isInitialized: false,
    isRendering: false,
    pendingTab: null,
    pendingUpdateHistory: false,
    switchTimeout: null,

    init: function() {
        if (this.isInitialized) return;

        try {
            var self = this;

            // Find all tab content elements
            document.querySelectorAll('.tab-content').forEach(function(el) {
                var id = el.id;
                if (id && id.startsWith('tab-')) {
                    var tabName = id.replace('tab-', '');
                    self.tabContentElements[tabName] = el;
                }
            });

            // Find all nav links and attach events
            document.querySelectorAll('#main-nav a[data-tab]').forEach(function(link) {
                self.navLinks.push(link);

                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    var tab = this.dataset.tab;
                    if (tab) {
                        self.switchTo(tab, true);
                    }
                });
            });

            // Quick links on dashboard
            document.querySelectorAll('.quick-link[data-tab]').forEach(function(link) {
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    var tab = this.dataset.tab;
                    if (tab) {
                        self.switchTo(tab, true);
                    }
                });
            });

            document.querySelectorAll('.stat-link[data-tab]').forEach(function(link) {
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    var tab = this.dataset.tab;
                    if (tab) {
                        self.switchTo(tab, true);
                    }
                });
            });

            // Set initial tab from URL hash or default
            var hash = window.location.hash.slice(1);
            var initialTab = self.tabs[hash] ? hash : 'dashboard';

            // Use replaceState for initial tab to avoid extra history entry
            if (window.history && window.history.replaceState) {
                window.history.replaceState(null, '', '#' + initialTab);
            }

            this.isInitialized = true;

            // Switch to initial tab after a short delay for modules to register
            setTimeout(function() {
                self.switchTo(initialTab, false);
            }, 50);

        } catch (error) {
            console.error('Failed to initialise TabManager:', error);
        }
    },

    register: function(tabName, renderFn) {
        if (!tabName || typeof renderFn !== 'function') {
            console.warn('Invalid tab registration:', tabName);
            return false;
        }

        this.tabs[tabName] = renderFn;

        // If this tab is already active and initialized, render it
        if (this.isInitialized && this.currentTab === tabName) {
            var container = this.tabContentElements[tabName];
            if (container) {
                setTimeout(function() {
                    this._renderTab(tabName);
                }.bind(this), 50);
            }
        }

        return true;
    },

    /**
     * Switch to a tab
     * @param {string} tabName - Tab identifier
     * @param {boolean} updateHistory - Whether to push a new history entry (default: true)
     */
    switchTo: function(tabName, updateHistory) {
        if (!this.tabs[tabName]) {
            return;
        }

        // If already on this tab, do nothing (use forceRefresh for explicit refresh)
        if (tabName === this.currentTab && this.isInitialized) {
            return;
        }

        // Clear any pending switch
        if (this.switchTimeout) {
            clearTimeout(this.switchTimeout);
            this.switchTimeout = null;
        }

        // If currently rendering, defer with history flag preserved
        if (this.isRendering) {
            this.pendingTab = tabName;
            this.pendingUpdateHistory = updateHistory !== false;
            return;
        }

        var self = this;
        this.switchTimeout = setTimeout(function() {
            self._doSwitch(tabName, updateHistory !== false);
            self.switchTimeout = null;
        }, 50);
    },

    _doSwitch: function(tabName, updateHistory) {
        // If still rendering, defer with history flag preserved
        if (this.isRendering) {
            this.pendingTab = tabName;
            this.pendingUpdateHistory = updateHistory !== false;
            return;
        }

        this.isRendering = true;
        this.currentTab = tabName;

        // Update nav links
        this.navLinks.forEach(function(link) {
            link.classList.toggle('active', link.dataset.tab === tabName);
        });

        // Update tab content visibility
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

        // Close mobile nav
        var nav = document.getElementById('main-nav');
        var actions = document.getElementById('header-actions');
        var toggle = document.getElementById('nav-toggle');
        if (nav) nav.classList.remove('open');
        if (actions) actions.classList.remove('open');
        if (toggle) toggle.classList.remove('open');

        // Update URL hash only if requested
        if (updateHistory !== false && window.history && window.history.pushState) {
            window.history.pushState(null, '', '#' + tabName);
        }

        // Render the tab content
        this._renderTab(tabName);

        this.isRendering = false;

        // Clear and handle pending tab with preserved history flag
        var pending = this.pendingTab;
        var pendingUpdateHistory = this.pendingUpdateHistory;

        this.pendingTab = null;
        this.pendingUpdateHistory = false;

        if (pending && pending !== tabName) {
            this.switchTo(pending, pendingUpdateHistory);
        }

        // Dispatch event
        var event = new CustomEvent('tabChanged', { detail: { tab: tabName } });
        document.dispatchEvent(event);
    },

    _renderTab: function(tabName) {
        var container = this.tabContentElements[tabName];
        var renderFn = this.tabs[tabName];

        if (!container || !renderFn) {
            if (container) {
                container.innerHTML = '<p class="empty-state">Tab content unavailable.</p>';
            }
            return;
        }

        try {
            renderFn(container);
        } catch (e) {
            console.error('Error rendering tab ' + tabName + ':', e);
            container.innerHTML = '<p class="empty-state">Error loading tab content.</p>';
        }
    },

    getCurrentTab: function() {
        return this.currentTab;
    },

    isTabActive: function(tabName) {
        return this.currentTab === tabName;
    },

    getTabContainer: function(tabName) {
        return this.tabContentElements[tabName] || null;
    },

    /**
     * Force a refresh of the current tab's content
     * @param {string} tabName - Tab to refresh (defaults to current)
     */
    forceRefresh: function(tabName) {
        tabName = tabName || this.currentTab;

        if (this.isRendering) {
            this.pendingTab = tabName;
            this.pendingUpdateHistory = false;
            return;
        }

        this._renderTab(tabName);
    },

    refreshCurrent: function() {
        this.forceRefresh(this.currentTab);
    }
};

// ============================================================
// REGISTER ALL TABS
// ============================================================

TabManager.register('dashboard', function(container) {
    if (typeof window.renderDashboard === 'function') {
        window.renderDashboard(container);
    } else {
        container.innerHTML = '<p class="empty-state">Dashboard loading...</p>';
    }
});

TabManager.register('characters', function(container) {
    if (typeof window.renderCharacters === 'function') {
        window.renderCharacters(container);
    } else {
        container.innerHTML = '<p class="empty-state">Characters module loading...</p>';
    }
});

TabManager.register('teams', function(container) {
    if (typeof window.renderTeamManager === 'function') {
        window.renderTeamManager(container);
    } else {
        container.innerHTML = '<p class="empty-state">Teams module loading...</p>';
    }
});

TabManager.register('tournaments', function(container) {
    if (typeof window.renderTournaments === 'function') {
        window.renderTournaments(container);
    } else {
        container.innerHTML = '<p class="empty-state">Tournaments module loading...</p>';
    }
});

TabManager.register('curriculum', function(container) {
    if (typeof window.renderCurriculum === 'function') {
        window.renderCurriculum(container);
    } else {
        container.innerHTML = '<p class="empty-state">Curriculum module loading...</p>';
    }
});

TabManager.register('missions', function(container) {
    if (typeof window.renderMissionsView === 'function') {
        window.renderMissionsView(container);
    } else {
        container.innerHTML = '<p class="empty-state">Missions module loading...</p>';
    }
});

TabManager.register('social', function(container) {
    if (typeof window.renderSocialView === 'function') {
        window.renderSocialView(container);
    } else {
        container.innerHTML = '<p class="empty-state">Social module loading...</p>';
    }
});

// ============================================================
// AUTO-INIT
// ============================================================

window.TabManager = TabManager;

function initTabManager() {
    if (TabManager.isInitialized) return;
    TabManager.init();
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
    if (TabManager.isInitialized) {
        TabManager.refreshCurrent();
    }
});

// Handle hash changes - don't update history again
window.addEventListener('hashchange', function() {
    if (!TabManager.isInitialized) return;
    var hash = window.location.hash.slice(1);
    if (hash && TabManager.tabs[hash]) {
        TabManager.switchTo(hash, false);
    }
});
