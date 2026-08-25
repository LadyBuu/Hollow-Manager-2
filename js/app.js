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
        
        // Close menu when tab changes - handled by TabManager
        console.log('Burger menu initialized');
    }

    // ============================================================
    // RENDER ALL FUNCTION
    // ============================================================

    function renderAll() {
        var currentTab = 'dashboard';
        if (typeof window.TabManager !== 'undefined' && window.TabManager.getCurrentTab) {
            currentTab = window.TabManager.getCurrentTab();
        }
        
        if (typeof window.TabManager !== 'undefined' && window.TabManager.forceRefresh) {
            window.TabManager.forceRefresh(currentTab);
        }
        
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
    }

    // ============================================================
    // LOG ACTIVITY - FIXED
    // ============================================================

    function logActivity(message, type) {
        type = type || 'info';
        // Directly save to window.data without recursive calls
        if (window.data) {
            if (!window.data.activities) {
                window.data.activities = [];
            }
            window.data.activities.unshift({
                id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                message: message,
                type: type,
                timestamp: new Date().toISOString()
            });
            
            if (window.data.activities.length > 100) {
                window.data.activities = window.data.activities.slice(0, 100);
            }
            
            if (typeof window.saveData === 'function') {
                window.saveData().catch(function(err) { /* ignore */ });
            }
        }
        console.log('[' + type + ']', message);
    }

    // ============================================================
    // APP INITIALIZATION
    // ============================================================

    function initApp() {
        setTimeout(initBurgerMenu, 100);
        
        document.addEventListener('dataReady', function(e) {
            if (typeof window.updateDashboardStats === 'function') {
                window.updateDashboardStats();
            }
            setTimeout(initBurgerMenu, 200);
        });
        
        document.addEventListener('tabChanged', function(e) {
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
        
        var resizeTimeout;
        window.addEventListener('resize', function() {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(function() {
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

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(initApp, 50);
    } else {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(initApp, 50);
        });
    }

    document.addEventListener('dataReady', function() {
        if (typeof window.initBurgerMenu === 'function') {
            setTimeout(window.initBurgerMenu, 100);
        }
    });


})();
