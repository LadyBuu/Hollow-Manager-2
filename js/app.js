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
 *   - window.CoreUtils (from core-utils.js)
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

    if (window.__appLoaded) {
        return;
    }
    window.__appLoaded = true;

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
    // RENDER ALL - Delegates to TabManager
    // ============================================================

    function renderAll() {
        if (window.TabManager && typeof window.TabManager.refreshCurrent === 'function') {
            window.TabManager.refreshCurrent();
        } else {
            // Fallback: render dashboard
            var tab = document.getElementById('tab-dashboard');
            if (tab && window.renderDashboard) {
                window.renderDashboard(tab);
            }
        }
    }

    // ============================================================
    // LOG ACTIVITY - WITHOUT HIDDEN PERSISTENCE
    // ============================================================

    function logActivity(message, type) {
        type = type || 'info';
        
        if (!window.data) {
            return;
        }

        if (!Array.isArray(window.data.activities)) {
            window.data.activities = [];
        }
        
        var id;
        if (window.CoreUtils && typeof window.CoreUtils.generateId === 'function') {
            id = window.CoreUtils.generateId('act');
        } else {
            id = Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        }
        
        window.data.activities.unshift({
            id: id,
            message: String(message),
            type: type,
            timestamp: new Date().toISOString()
        });
        
        if (window.data.activities.length > 100) {
            window.data.activities.length = 100;
        }
    }

    // ============================================================
    // DATA READY HANDLER - Simplified
    // ============================================================

    function handleDataReady(e) {
        if (_dataReadyFired) return;
        _dataReadyFired = true;

        var detail = e && e.detail;
        var status = detail ? detail.status : null;

        if (status === 'failed') {
            var error = detail ? detail.error : null;
            handleDataFailure(error);
            return;
        }

        handleDataSuccess(detail ? detail.data : null);
    }

    function handleDataSuccess(data) {
        // Notify TabManager that data is ready
        if (window.TabManager && typeof window.TabManager.onDataReady === 'function') {
            window.TabManager.onDataReady();
        }

        // Render dashboard
        var tab = document.getElementById('tab-dashboard');
        if (tab && window.renderDashboard) {
            try {
                window.renderDashboard(tab);
            } catch (e) {
                // Ignore dashboard render errors during startup
            }
        }
    }

    function handleDataFailure(error) {
        var message = 'Failed to load data. Please refresh the page.';
        
        if (error && error.message) {
            message = 'Data loading failed: ' + error.message;
        }
        
        if (window.NotificationSystem && typeof window.NotificationSystem.notifyError === 'function') {
            window.NotificationSystem.notifyError(message, 0);
        } else if (window.showToast) {
            window.showToast(message, 'error');
        } else {
            var el = document.getElementById('tab-dashboard');
            if (el) {
                el.innerHTML = '<p class="empty-state" style="color:var(--danger);padding:20px;">' + message + '</p>';
            }
        }
        
        console.error('Data loading failed:', error);
        
        if (window.TabManager && typeof window.TabManager.onDataReady === 'function') {
            window.TabManager.onDataReady();
        }
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
    // APP INITIALIZATION
    // ============================================================

    function initApp() {
        initBurgerMenu();
        
        document.addEventListener('dataReady', handleDataReady);
        
        document.addEventListener('tabChanged', function() {
            closeMobileNav();
        });
        
        var resizeTimeout;
        window.addEventListener('resize', function() {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(function() {
                if (window.innerWidth >= UI.MOBILE_BREAKPOINT) {
                    closeMobileNav();
                }
            }, UI.DEBOUNCE_DELAY);
        });

        if (window.data && !_dataReadyFired) {
            _dataReadyFired = true;
            setTimeout(function() {
                handleDataSuccess(window.data);
            }, 10);
        }
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
    // AUTO-INIT
    // ============================================================

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initApp();
    } else {
        document.addEventListener('DOMContentLoaded', initApp);
    }

})();
