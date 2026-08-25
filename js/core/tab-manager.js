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
    switchTimeout: null,
    isRendering: false,
    _pendingInit: false,
    _initializedTabs: false,
    _refreshTimeout: null,
    _initAttempts: 0,
    _maxInitAttempts: 10,

    init: function() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        console.log('TabManager initializing...');

        var self = this;

        // Find all tab content elements
        document.querySelectorAll('.tab-content').forEach(function(el) {
            var id = el.id;
            if (id && id.startsWith('tab-')) {
                var tabName = id.replace('tab-', '');
                self.tabContentElements[tabName] = el;
                console.log('Found tab container:', tabName);
            }
        });

        // Find all nav links and attach events - NO CLONING
        document.querySelectorAll('#main-nav a[data-tab]').forEach(function(link) {
            self.navLinks.push(link);

            link.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                var tab = this.dataset.tab;
                console.log('Nav click:', tab);
                if (tab) {
                    self.switchTo(tab);
                }
            });
        });

        // Quick links on dashboard - NO CLONING
        document.querySelectorAll('.quick-link[data-tab]').forEach(function(link) {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                var tab = this.dataset.tab;
                console.log('Quick link click:', tab);
                if (tab) {
                    self.switchTo(tab);
                }
            });
        });

        document.querySelectorAll('.stat-link[data-tab]').forEach(function(link) {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                var tab = this.dataset.tab;
                console.log('Stat link click:', tab);
                if (tab) {
                    self.switchTo(tab);
                }
            });
        });

        // Set initial tab from URL hash or default
        var hash = window.location.hash.replace('#', '');
        var initialTab = hash || 'dashboard';
        console.log('Initial tab:', initialTab);

        // Wait a moment for all modules to register
        setTimeout(function() {
            if (self.tabs[initialTab]) {
                self.switchTo(initialTab);
            } else {
                self.switchTo('dashboard');
            }
            self._initializedTabs = true;
        }, 100);
    },

    initWhenReady: function() {
        console.log('TabManager.initWhenReady called');
        
        if (this.isInitialized) return;

        // Check if we have at least the dashboard registered
        if (this.tabs.dashboard) {
            console.log('Dashboard registered, initializing...');
            this.init();
        } else {
            console.log('Dashboard not registered yet, waiting...');
            var self = this;
            if (!this._pendingInit) {
                this._pendingInit = true;
                setTimeout(function() {
                    self._pendingInit = false;
                    self.initWhenReady();
                }, 100);
            }
        }
    },

    register: function(tabName, renderFn) {
        this.tabs[tabName] = renderFn;
        console.log('Registered tab:', tabName);
        
        // If this tab is already active and we're initialized, render it
        if (this.isInitialized && this.currentTab === tabName) {
            var container = this.tabContentElements[tabName];
            if (container) {
                setTimeout(function() {
                    try {
                        renderFn(container);
                    } catch (e) {
                        console.error('Error rendering tab ' + tabName + ':', e);
                        container.innerHTML = '<p class="empty-state">Error loading tab content.</p>';
                    }
                }, 50);
            }
        }
    },

    switchTo: function(tabName) {
        console.log('Switching to tab:', tabName);

        if (!this.tabs[tabName]) {
            console.warn('Tab not registered:', tabName);
            if (tabName === 'dashboard') {
                this.initWhenReady();
            }
            return;
        }

        // Clear any pending switch
        if (this.switchTimeout) {
            clearTimeout(this.switchTimeout);
            this.switchTimeout = null;
        }

        var self = this;
        this.switchTimeout = setTimeout(function() {
            self._doSwitch(tabName);
            self.switchTimeout = null;
        }, 50);
    },

    _doSwitch: function(tabName) {
        console.log('Doing switch to:', tabName);

        var self = this;

        // Prevent recursive rendering
        if (this.isRendering) {
            setTimeout(function() {
                self._doSwitch(tabName);
            }, 100);
            return;
        }

        this.isRendering = true;
        this.currentTab = tabName;

        // Update nav links - now using actual DOM elements
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

        // Update URL hash
        if (window.history && window.history.pushState) {
            window.history.pushState(null, '', '#' + tabName);
        }

        // Render the tab content
        var container = this.tabContentElements[tabName];
        if (container && this.tabs[tabName]) {
            try {
                this.tabs[tabName](container);
            } catch (e) {
                console.error('Error rendering tab ' + tabName + ':', e);
                container.innerHTML = '<p class="empty-state">Error loading tab content.</p>';
            }
        } else {
            console.warn('Container or render function missing for tab:', tabName);
        }
        
        this.isRendering = false;

        // Dispatch event
        var event = new CustomEvent('tabChanged', { detail: { tab: tabName } });
        document.dispatchEvent(event);
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

    forceRefresh: function(tabName) {
        tabName = tabName || this.currentTab;
        if (this.tabs[tabName]) {
            var container = this.tabContentElements[tabName];
            if (container) {
                try {
                    this.tabs[tabName](container);
                    return true;
                } catch (e) {
                    console.error('Error refreshing tab ' + tabName + ':', e);
                    return false;
                }
            }
        }
        return false;
    },

    refreshCurrent: function() {
        var self = this;
        clearTimeout(this._refreshTimeout);
        this._refreshTimeout = setTimeout(function() {
            self.forceRefresh(self.currentTab);
        }, 100);
    }
};

// ============================================================
// REGISTER ALL TABS
// ============================================================

// Dashboard
TabManager.register('dashboard', function(container) {
    console.log('Rendering dashboard...');
    if (typeof window.renderDashboard === 'function') {
        window.renderDashboard(container);
    } else {
        container.innerHTML = '<p class="empty-state">Dashboard loading...</p>';
    }
});

// Characters
TabManager.register('characters', function(container) {
    console.log('Rendering characters...');
    if (typeof window.renderCharacters === 'function') {
        window.renderCharacters(container);
    } else {
        container.innerHTML = '<p class="empty-state">Characters module loading...</p>';
    }
});

// Teams
TabManager.register('teams', function(container) {
    console.log('Rendering teams...');
    if (typeof window.renderTeamManager === 'function') {
        window.renderTeamManager(container);
    } else {
        container.innerHTML = '<p class="empty-state">Teams module loading...</p>';
    }
});

// Tournaments
TabManager.register('tournaments', function(container) {
    console.log('Rendering tournaments...');
    if (typeof window.renderTournaments === 'function') {
        window.renderTournaments(container);
    } else {
        container.innerHTML = '<p class="empty-state">Tournaments module loading...</p>';
    }
});

// Curriculum
TabManager.register('curriculum', function(container) {
    console.log('Rendering curriculum...');
    if (typeof window.renderCurriculum === 'function') {
        window.renderCurriculum(container);
    } else {
        container.innerHTML = '<p class="empty-state">Curriculum module loading...</p>';
    }
});

// Missions
TabManager.register('missions', function(container) {
    console.log('Rendering missions...');
    if (typeof window.renderMissionsView === 'function') {
        window.renderMissionsView(container);
    } else {
        container.innerHTML = '<p class="empty-state">Missions module loading...</p>';
    }
});

// Social
TabManager.register('social', function(container) {
    console.log('Rendering social...');
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

function tryInitTabManager() {
    if (typeof TabManager === 'undefined') {
        console.warn('TabManager not defined, waiting...');
        setTimeout(tryInitTabManager, 200);
        return;
    }
    
    TabManager._initAttempts = (TabManager._initAttempts || 0) + 1;
    if (TabManager._initAttempts > (TabManager._maxInitAttempts || 10)) {
        console.warn('TabManager init attempts exceeded max, forcing init');
        if (!TabManager.isInitialized) {
            TabManager.init();
        }
        return;
    }
    
    if (!TabManager.isInitialized) {
        TabManager.initWhenReady();
        setTimeout(tryInitTabManager, 200);
    }
}

setTimeout(tryInitTabManager, 100);

document.addEventListener('dataReady', function() {
    setTimeout(function() {
        if (typeof TabManager !== 'undefined' && !TabManager.isInitialized) {
            TabManager.initWhenReady();
        }
    }, 100);
});

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(function() {
        if (typeof TabManager !== 'undefined' && !TabManager.isInitialized) {
            TabManager.initWhenReady();
        }
    }, 100);
} else {
    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(function() {
            if (typeof TabManager !== 'undefined' && !TabManager.isInitialized) {
                TabManager.initWhenReady();
            }
        }, 100);
    });
}

window.addEventListener('hashchange', function() {
    if (typeof TabManager === 'undefined') return;
    var hash = window.location.hash.replace('#', '');
    if (hash && TabManager.tabs[hash] && TabManager.isInitialized) {
        TabManager.switchTo(hash);
    }
});

console.log('tab-manager.js loaded');
