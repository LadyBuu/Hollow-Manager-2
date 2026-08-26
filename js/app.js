/**
 * js/app.js - Application Bootstrapper
 * Initializes all modules and handles burger menu
 * Path: js/app.js
 * 
 * This file is responsible for:
 *   - DOM ready bootstrapping
 *   - Burger menu initialization
 *   - Tab switching coordination
 *   - Global render coordination
 *   - Activity logging (without hidden persistence)
 * 
 * IMPORTANT: logActivity() does NOT persist the entire dataset.
 * It only updates in-memory state. The caller is responsible for saving.
 * This prevents recursive save chains and race conditions.
 */

(function() {
    'use strict';

    // ============================================================
    // INITIALIZATION GUARD
    // ============================================================

    var appInitialized = false;

    // ============================================================
    // BURGER MENU CONTROLS
    // ============================================================

    function initBurgerMenu() {
        var toggle = document.getElementById('nav-toggle');
        var nav = document.getElementById('main-nav');
        var actions = document.getElementById('header-actions');
        
        if (!toggle || !nav) {
            return;
        }
        
        if (toggle._burgerInitialized) return;
        toggle._burgerInitialized = true;
        
        toggle.addEventListener('click', function(e) {
            e.stopPropagation();
            nav.classList.toggle('open');
            this.classList.toggle('open');
            this.textContent = this.classList.contains('open') ? '✕' : '☰';
            if (actions) {
                actions.classList.toggle('open');
            }
        });
        
        document.addEventListener('click', function(e) {
            if (nav.classList.contains('open')) {
                var isInsideNav = nav.contains(e.target);
                var isToggle = toggle.contains(e.target);
                var isInsideActions = actions && actions.contains(e.target);
                
                if (!isInsideNav && !isToggle && !isInsideActions) {
                    nav.classList.remove('open');
                    toggle.classList.remove('open');
                    toggle.textContent = '☰';
                    if (actions) {
                        actions.classList.remove('open');
                    }
                }
            }
        });
        
        console.log('Burger menu initialized');
    }

    // ============================================================
    // RENDER ALL FUNCTION
    // ============================================================

    function renderAll() {
        var currentTab = 'dashboard';
        
        if (
            window.TabManager &&
            typeof window.TabManager.getCurrentTab === 'function'
        ) {
            currentTab = window.TabManager.getCurrentTab();
        }
        
        if (
            window.TabManager &&
            typeof window.TabManager.forceRefresh === 'function'
        ) {
            window.TabManager.forceRefresh(currentTab);
        }
        
        // Note: TabManager.forceRefresh may already update dashboard stats
        // This is a safety net in case it doesn't
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
    }

    // ============================================================
    // LOG ACTIVITY - WITHOUT HIDDEN PERSISTENCE
    // ============================================================

    function logActivity(message, type) {
        type = type || 'info';
        
        // Update in-memory state only - caller is responsible for persistence
        if (window.data) {
            if (!Array.isArray(window.data.activities)) {
                window.data.activities = [];
            }
            
            window.data.activities.unshift({
                id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                message: message,
                type: type,
                timestamp: new Date().toISOString()
            });
            
            // Keep only the last 100 activities
            if (window.data.activities.length > 100) {
                window.data.activities.length = 100;
            }
        }
        
        console.log('[' + type + ']', message);
    }

    // ============================================================
    // APP INITIALIZATION
    // ============================================================

    function initApp() {
        // Guard against duplicate initialization
        if (appInitialized) return;
        appInitialized = true;

        // Initialize burger menu immediately (static HTML)
        initBurgerMenu();
        
        // Data ready handler - updates stats when data loads
        document.addEventListener('dataReady', function() {
            if (typeof window.updateDashboardStats === 'function') {
                window.updateDashboardStats();
            }
        });
        
        // Close menu when tab changes
        document.addEventListener('tabChanged', function() {
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
        
        // Resize handler - closes mobile menu on desktop
        var resizeTimeout;
        window.addEventListener('resize', function() {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(function() {
                if (window.innerWidth >= 768) {
                    var nav = document.getElementById('main-nav');
                    var toggle = document.getElementById('nav-toggle');
                    var actions = document.getElementById('header-actions');
                    
                    if (nav) nav.classList.remove('open');
                    if (toggle) {
                        toggle.classList.remove('open');
                        toggle.textContent = '☰';
                    }
                    if (actions) {
                        actions.classList.remove('open');
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

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(initApp, 50);
    } else {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(initApp, 50);
        });
    }

})();
