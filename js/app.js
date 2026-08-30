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
 *   - Data readiness coordination with TabManager
 *   - Centralized error handling for data loading
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
 *   - Listens for 'dataReady' event to coordinate tab rendering
 *   - Provides global error handling for data failures
 *   - Notification system integration for user feedback
 *   - Proper initialization ordering with TabManager
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
        
        // Toggle menu on button click
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

        // Close menu when a nav link is clicked
        nav.querySelectorAll('a').forEach(function(link) {
            link.addEventListener('click', function() {
                nav.classList.remove('open');
                toggle.classList.remove('open');
                toggle.textContent = '☰';
                if (actions) {
                    actions.classList.remove('open');
                }
            });
        });
    }

    // ============================================================
    // RENDER ALL FUNCTION - CLEAN BOUNDARY
    // ============================================================

    function renderAll() {
        var currentTab = 'dashboard';
        
        if (window.TabManager && typeof window.TabManager.getCurrentTab === 'function') {
            currentTab = window.TabManager.getCurrentTab();
        }
        
        if (window.TabManager && typeof window.TabManager.forceRefresh === 'function') {
            window.TabManager.forceRefresh(currentTab);
        } else if (window.renderDashboard) {
            // Fallback: just render dashboard
            var tab = document.getElementById('tab-dashboard');
            if (tab) {
                window.renderDashboard(tab);
            }
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
    // DATA READY HANDLER - Coordinates tab system loading
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
        // Notify TabManager that data is ready
        if (window.TabManager) {
            // If TabManager has onDataReady method, call it
            if (typeof window.TabManager.onDataReady === 'function') {
                window.TabManager.onDataReady();
            } 
            // Otherwise, set data ready state directly and process pending tab
            else if (window.TabManager._state) {
                window.TabManager._state.isDataReady = true;
                
                // Process any pending tab
                if (window.TabManager._state.pendingTab) {
                    var tab = window.TabManager._state.pendingTab;
                    var history = window.TabManager._state.pendingUpdateHistory;
                    window.TabManager._state.pendingTab = null;
                    window.TabManager._state.pendingUpdateHistory = false;
                    
                    if (typeof window.TabManager.switchTo === 'function') {
                        window.TabManager.switchTo(tab, history);
                    }
                } else {
                    // Refresh current tab if initialized
                    if (window.TabManager.isInitialized && typeof window.TabManager.refreshCurrent === 'function') {
                        window.TabManager.refreshCurrent();
                    }
                }
            }
        }

        // Render dashboard
        var tab = document.getElementById('tab-dashboard');
        if (tab && window.renderDashboard) {
            window.renderDashboard(tab);
        }

        // Log success
        if (data) {
            var msg = 'Data loaded successfully. ';
            msg += (data.characters ? data.characters.length : 0) + ' characters, ';
            msg += (data.teams ? data.teams.length : 0) + ' teams, ';
            msg += (data.tournaments ? data.tournaments.length : 0) + ' tournaments.';
            console.info(msg);
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
            // Fallback: show in dashboard
            var el = document.getElementById('tab-dashboard');
            if (el) {
                el.innerHTML = '<p class="empty-state" style="color:var(--danger);padding:20px;">' + message + '</p>';
            }
        }
        
        console.error('Data loading failed:', error);
        
        // Notify TabManager of failure so it can show error state
        if (window.TabManager && typeof window.TabManager.onDataReady === 'function') {
            window.TabManager.onDataReady();
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
            closeMobileNav();
        });
        
        // Resize handler - closes mobile menu on desktop
        var resizeTimeout;
        window.addEventListener('resize', function() {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(function() {
                if (window.innerWidth >= UI.MOBILE_BREAKPOINT) {
                    closeMobileNav();
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

        // Log initialization (no console.log in production, but this is helpful)
        console.info('App initialized');
    }

    // ============================================================
    // NAVIGATION HELPERS
    // ============================================================

    function closeMobileNav() {
        var nav = document.getElementById('main-nav');
        var toggle = document.getElementById('nav-toggle');
        var actions = document.getElementById('header-actions');
        
        if (nav) nav.classList.remove('open');
        if (toggle) {
            toggle.classList.remove('open');
            toggle.textContent = '☰';
        }
        if (actions) actions.classList.remove('open');
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderAll = renderAll;
    window.logActivity = logActivity;
    window.initBurgerMenu = initBurgerMenu;
    window.initApp = initApp;
    window.closeMobileNav = closeMobileNav;

    // ============================================================
    // AUTO-INIT - No arbitrary delay
    // ============================================================

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initApp();
    } else {
        document.addEventListener('DOMContentLoaded', initApp);
    }

})();
