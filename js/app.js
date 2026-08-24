/**
 * js/app.js - Application Bootstrapper
 * Initializes all modules and handles burger menu
 * Path: js/app.js
 */

(function() {
    'use strict';

    // ============================================================
    // BURGER MENU CONTROLS
    // ============================================================

    function initBurgerMenu() {
        console.log('Initializing burger menu...');
        
        var toggle = document.getElementById('nav-toggle');
        var nav = document.getElementById('main-nav');
        var actions = document.getElementById('header-actions');
        
        if (!toggle || !nav) {
            console.warn('Burger menu elements not found');
            return;
        }
        
        // Remove any existing listeners by cloning
        var newToggle = toggle.cloneNode(true);
        toggle.parentNode.replaceChild(newToggle, toggle);
        toggle = newToggle;
        
        toggle.addEventListener('click', function(e) {
            e.stopPropagation();
            
            // Toggle nav
            nav.classList.toggle('open');
            
            // Toggle burger icon
            this.classList.toggle('open');
            this.textContent = this.classList.contains('open') ? '✕' : '☰';
            
            // Optionally toggle actions
            if (actions) {
                actions.classList.toggle('open');
            }
            
            console.log('Burger menu toggled:', nav.classList.contains('open') ? 'open' : 'closed');
        });
        
        // Close menu when clicking outside
        document.addEventListener('click', function(e) {
            if (nav.classList.contains('open')) {
                if (!nav.contains(e.target) && !toggle.contains(e.target)) {
                    nav.classList.remove('open');
                    toggle.classList.remove('open');
                    toggle.textContent = '☰';
                    if (actions) {
                        actions.classList.remove('open');
                    }
                }
            }
        });
        
        // Close menu when a nav link is clicked
        nav.querySelectorAll('a').forEach(function(link) {
            var newLink = link.cloneNode(true);
            link.parentNode.replaceChild(newLink, link);
            newLink.addEventListener('click', function() {
                nav.classList.remove('open');
                toggle.classList.remove('open');
                toggle.textContent = '☰';
                if (actions) {
                    actions.classList.remove('open');
                }
            });
        });
        
        console.log('Burger menu initialized');
    }

    // ============================================================
    // RENDER ALL FUNCTION
    // ============================================================

    function renderAll() {
        console.log('renderAll called - refreshing all tabs');
        
        // Get current tab from TabManager
        var currentTab = 'dashboard';
        if (typeof window.TabManager !== 'undefined' && window.TabManager.getCurrentTab) {
            currentTab = window.TabManager.getCurrentTab();
        }
        
        // Refresh current tab
        if (typeof window.TabManager !== 'undefined' && window.TabManager.forceRefresh) {
            window.TabManager.forceRefresh(currentTab);
        }
        
        // Update dashboard stats
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
    }

    // ============================================================
    // LOG ACTIVITY WRAPPER
    // ============================================================

    function logActivity(message, type) {
        type = type || 'info';
        if (typeof window.logActivity === 'function') {
            window.logActivity(message, type);
        } else {
            console.log('[' + type + ']', message);
        }
    }

    // ============================================================
    // APP INITIALIZATION
    // ============================================================

    function initApp() {
        console.log('App initializing...');
        
        // Initialize burger menu
        setTimeout(initBurgerMenu, 100);
        
        // Listen for data ready
        document.addEventListener('dataReady', function(e) {
            console.log('App: dataReady event received');
            
            // Update dashboard stats
            if (typeof window.updateDashboardStats === 'function') {
                window.updateDashboardStats();
            }
            
            // Re-initialize burger menu (in case DOM changed)
            setTimeout(initBurgerMenu, 200);
        });
        
        // Listen for tab changes
        document.addEventListener('tabChanged', function(e) {
            console.log('App: tabChanged event received:', e.detail ? e.detail.tab : 'unknown');
            
            // Close burger menu on tab change
            var nav = document.getElementById('main-nav');
            var toggle = document.getElementById('nav-toggle');
            var actions = document.getElementById('header-actions');
            
            if (nav) nav.classList.remove('open');
            if (toggle) {
                toggle.classList.remove('open');
                toggle.textContent = '☰';
            }
            if (actions) actions.classList.remove('open');
        });
        
        // Handle window resize for responsive adjustments
        var resizeTimeout;
        window.addEventListener('resize', function() {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(function() {
                // Close burger menu on desktop
                if (window.innerWidth >= 768) {
                    var nav = document.getElementById('main-nav');
                    var toggle = document.getElementById('nav-toggle');
                    if (nav) nav.classList.remove('open');
                    if (toggle) {
                        toggle.classList.remove('open');
                        toggle.textContent = '☰';
                    }
                }
            }, 250);
        });
        
        console.log('App initialized');
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderAll = renderAll;
    window.logActivity = logActivity;
    window.initBurgerMenu = initBurgerMenu;
    window.initApp = initApp;

    // ============================================================
    // AUTO-INIT
    // ============================================================

    // Initialize when DOM is ready
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(initApp, 50);
    } else {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(initApp, 50);
        });
    }

    // Also initialize after data loads (in case DOM was already ready)
    document.addEventListener('dataReady', function() {
        // Ensure burger menu is initialized
        if (typeof window.initBurgerMenu === 'function') {
            setTimeout(window.initBurgerMenu, 100);
        }
    });

    console.log('app.js loaded');

})();
