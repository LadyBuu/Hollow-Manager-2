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

    init: function() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        var self = this;

        // Find all tab content elements
        document.querySelectorAll('.tab-content').forEach(function(el) {
            var id = el.id;
            if (id && id.startsWith('tab-')) {
                var tabName = id.replace('tab-', '');
                self.tabContentElements[tabName] = el;
            }
        });

        // Find all nav links
        document.querySelectorAll('#main-nav a[data-tab]').forEach(function(link) {
            self.navLinks.push(link);
            link.addEventListener('click', function(e) {
                e.preventDefault();
                var tab = this.dataset.tab;
                if (tab) {
                    self.switchTo(tab);
                }
            });
        });

        // Handle quick links on dashboard
        document.querySelectorAll('.quick-link[data-tab]').forEach(function(link) {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                var tab = this.dataset.tab;
                if (tab) {
                    self.switchTo(tab);
                }
            });
        });

        document.querySelectorAll('.stat-link[data-tab]').forEach(function(link) {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                var tab = this.dataset.tab;
                if (tab) {
                    self.switchTo(tab);
                }
            });
        });

        // Burger menu toggle
        var navToggle = document.getElementById('nav-toggle');
        if (navToggle) {
            navToggle.addEventListener('click', function() {
                var nav = document.getElementById('main-nav');
                var actions = document.getElementById('header-actions');
                if (nav) nav.classList.toggle('open');
                if (actions) actions.classList.toggle('open');
                this.classList.toggle('open');
            });
        }

        // Handle window resize for responsive nav
        window.addEventListener('resize', function() {
            if (window.innerWidth >= 768) {
                var nav = document.getElementById('main-nav');
                var actions = document.getElementById('header-actions');
                var toggle = document.getElementById('nav-toggle');
                if (nav) nav.classList.remove('open');
                if (actions) actions.classList.remove('open');
                if (toggle) toggle.classList.remove('open');
            }
        });

        // Set initial tab from URL hash or default
        var hash = window.location.hash.replace('#', '');
        var initialTab = hash || 'dashboard';
        if (this.tabs[initialTab]) {
            this.switchTo(initialTab);
        } else {
            this.switchTo('dashboard');
        }
    },

    register: function(tabName, renderFn) {
        this.tabs[tabName] = renderFn;
    },

    switchTo: function(tabName) {
        if (!this.tabs[tabName]) {
            return;
        }

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
        if (container) {
            this.tabs[tabName](container);
        }

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
    }
};

// Register dashboard by default (will be overridden by dashboard module)
TabManager.register('dashboard', function(container) {
    if (typeof window.renderDashboard === 'function') {
        window.renderDashboard(container);
    } else {
        container.innerHTML = '<p class="empty-state">Dashboard loading...</p>';
    }
});

// Make globally available
window.TabManager = TabManager;

// Auto-init after DOM ready
document.addEventListener('DOMContentLoaded', function() {
    TabManager.init();
});

// Also init if DOM already loaded
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(function() {
        if (!TabManager.isInitialized) {
            TabManager.init();
        }
    }, 50);
}