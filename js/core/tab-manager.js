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

        // Find all nav links and attach events
        document.querySelectorAll('#main-nav a[data-tab]').forEach(function(link) {
            self.navLinks.push(link);
            var newLink = link.cloneNode(true);
            link.parentNode.replaceChild(newLink, link);
            newLink.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                var tab = this.dataset.tab;
                console.log('Nav click:', tab);
                if (tab) {
                    self.switchTo(tab);
                }
            });
        });

        // Quick links on dashboard
        document.querySelectorAll('.quick-link[data-tab]').forEach(function(link) {
            var newLink = link.cloneNode(true);
            link.parentNode.replaceChild(newLink, link);
            newLink.addEventListener('click', function(e) {
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
            var newLink = link.cloneNode(true);
            link.parentNode.replaceChild(newLink, link);
            newLink.addEventListener('click', function(e) {
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
        }, 100);
    },

    initWhenReady: function() {
        if (this.isInitialized) return;

        // Check if we have at least the dashboard registered
        if (this.tabs.dashboard) {
            this.init();
        } else {
            // Wait a bit and try again
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
    },

    switchTo: function(tabName) {
        console.log('Switching to tab:', tabName);

        if (!this.tabs[tabName]) {
            console.warn('Tab not registered:', tabName);
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

        if (this.isRendering) {
            setTimeout(function() {
                self._doSwitch(tabName);
            }, 100);
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
                this.tabs[tabName](container);
            }
        }
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
// AUTO-INIT - Wait for modules to register
// ============================================================

window.TabManager = TabManager;

// Auto-init after a short delay to let modules register
setTimeout(function() {
    if (!TabManager.isInitialized) {
        TabManager.initWhenReady();
    }
}, 300);

// Also try again after data loads
document.addEventListener('dataLoaded', function() {
    setTimeout(function() {
        if (!TabManager.isInitialized) {
            TabManager.initWhenReady();
        }
    }, 200);
});

// If DOM is already loaded, init
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(function() {
        if (!TabManager.isInitialized) {
            TabManager.initWhenReady();
        }
    }, 100);
} else {
    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(function() {
            if (!TabManager.isInitialized) {
                TabManager.initWhenReady();
            }
        }, 100);
    });
}

console.log('tab-manager.js loaded');
