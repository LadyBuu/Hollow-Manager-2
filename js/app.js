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
 *   - Data readiness coordination with character system
 * 
 * IMPORTANT: logActivity() does NOT persist the entire dataset.
 * It only updates in-memory state. The caller is responsible for saving.
 * This prevents recursive save chains and race conditions.
 * 
 * DEPENDENCIES:
 *   - window.UI_CONSTANTS (from constants.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.TabManager (from tab-manager.js)
 *   - window.data (from database.js)
 * 
 * INTEGRATION WITH CHARACTER SYSTEM:
 *   - Listens for 'dataReady' event to coordinate character module loading
 *   - Provides global error handling for data failures
 *   - Notification system integration for user feedback
 */

(function() {
    'use strict';

    // ============================================================
    // INITIALIZATION GUARD
    // ============================================================

    var appInitialized = false;
    var _dataReadyFired = false;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var UI = window.UI_CONSTANTS || {
        DEBOUNCE_DELAY: 300,
        MOBILE_BREAKPOINT: 768,
        ANIMATION_DURATION: 300
    };

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
            var isOpen = nav.classList.toggle('open');
            this.classList.toggle('open', isOpen);
            this.textContent = isOpen ? '✕' : '☰';
            if (actions) {
                actions.classList.toggle('open', isOpen);
            }
        });
        
        // Click outside to close
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
    }

    // ============================================================
    // RENDER ALL FUNCTION - CLEAN BOUNDARY
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
    }

    // ============================================================
    // DATA READY HANDLER - Coordinates character system loading
    // ============================================================

    function handleDataReady(e) {
        var detail = e && e.detail;
        var status = detail ? detail.status : null;
        
        // Prevent duplicate handling
        if (_dataReadyFired) return;
        _dataReadyFired = true;

        if (status === 'failed') {
            var error = detail ? detail.error : null;
            handleDataFailure(error);
            return;
        }

        // Data loaded successfully
        handleDataSuccess(detail ? detail.data : null);
    }

    function handleDataSuccess(data) {
        // Data is already in window.data from database.js
        // Just notify the user and refresh the current tab
        
        var tab = document.getElementById('tab-dashboard');
        if (tab && window.renderDashboard) {
            window.renderDashboard(tab);
        }
        
        // Refresh current tab if TabManager is ready
        if (window.TabManager && typeof window.TabManager.refreshCurrent === 'function') {
            setTimeout(function() {
                window.TabManager.refreshCurrent();
            }, 50);
        }
    }

    function handleDataFailure(error) {
        var message = 'Failed to load data. Please refresh the page.';
        
        if (error && error.message) {
            message = 'Data loading failed: ' + error.message;
        }
        
        // Show notification if available
        if (window.NotificationSystem && typeof window.NotificationSystem.notifyError === 'function') {
            window.NotificationSystem.notifyError(message, 0); // Persistent
        } else if (window.showToast) {
            window.showToast(message, 'error');
        } else {
            // Fallback
            var el = document.getElementById('tab-dashboard');
            if (el) {
                el.innerHTML = '<p class="empty-state" style="color:var(--danger);">' + message + '</p>';
            }
        }
    }

    // ============================================================
    // APP INITIALIZATION
    // ============================================================

    function initApp() {
        // Guard against duplicate initialization
        if (appInitialized) return;
        appInitialized = true;

        // Initialize burger menu (static HTML)
        initBurgerMenu();
        
        // Set up data ready listener
        document.addEventListener('dataReady', handleDataReady);
        
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
                if (window.innerWidth >= UI.MOBILE_BREAKPOINT) {
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
            }, UI.DEBOUNCE_DELAY);
        });

        // If data is already loaded (database.js loaded before app.js),
        // handle it immediately
        if (window.data) {
            // Don't fire dataReady again, but do handle the initial state
            if (!_dataReadyFired) {
                _dataReadyFired = true;
                setTimeout(function() {
                    handleDataSuccess(window.data);
                }, 10);
            }
        }
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderAll = renderAll;
    window.logActivity = logActivity;
    window.initBurgerMenu = initBurgerMenu;
    window.initApp = initApp;

    // ============================================================
    // AUTO-INIT - No arbitrary delay
    // ============================================================

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initApp();
    } else {
        document.addEventListener('DOMContentLoaded', initApp);
    }

})();
