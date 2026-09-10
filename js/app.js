/**
 * js/app.js - Application Shell
 * Path: js/app.js
 * 
 * Responsibilities (deliberately minimal):
 *   - Burger menu initialization and mobile nav behaviour
 *   - Close the mobile nav when the current tab changes
 *   - Close the mobile nav when the viewport returns to desktop width
 *   - Display user-facing error when bootstrap reports a data-loading failure
 * 
 * IMPORTANT:
 *   - This file is the APPLICATION SHELL, not a bootstrap orchestrator
 *   - It does NOT coordinate data readiness (that is bootstrap.js)
 *   - It does NOT register tabs (that is TabManager and each domain's index.js)
 *   - It does NOT render domain content (that is each domain's index.js)
 *   - It does NOT log activities (that is ActivityLog)
 *   - It does NOT touch window.data
 *   - It does NOT contain domain knowledge of any kind
 * 
 * LOAD ORDER:
 *   Must load after core infrastructure and after bootstrap.js.
 *   The shell reacts to events; it does not produce them.
 * 
 * DEPENDENCIES:
 *   - window.UI_CONSTANTS (from constants.js) - for breakpoint values
 *   - window.NotificationSystem (from notification.js) - for user-facing errors
 * 
 * EVENTS CONSUMED:
 *   - bootstrapFailed  -> show error notification
 *   - tabChanged       -> close mobile nav
 *   - window resize    -> close mobile nav when entering desktop layout
 * 
 * EVENTS PRODUCED:
 *   None.
 */

(function() {
    'use strict';

    if (window.__appLoaded) {
        return;
    }
    window.__appLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var UI = window.UI_CONSTANTS || {
        DEBOUNCE_DELAY: 300,
        MOBILE_BREAKPOINT: 768
    };

    var NotificationSystem = window.NotificationSystem;

    // ============================================================
    // MOBILE NAV
    // ============================================================

    /**
     * Close the mobile navigation.
     * Safe to call when the nav is not open.
     */
    function closeMobileNav() {
        var nav = document.getElementById('main-nav');
        var toggle = document.getElementById('nav-toggle');
        var actions = document.getElementById('header-actions');

        if (nav) {
            nav.classList.remove('open');
        }
        if (toggle) {
            toggle.classList.remove('open');
            toggle.textContent = '☰';
        }
        if (actions) {
            actions.classList.remove('open');
        }
    }

    /**
     * Initialize the burger menu toggle.
     * Idempotent: safe to call multiple times.
     */
    function initBurgerMenu() {
        var toggle = document.getElementById('nav-toggle');
        var nav = document.getElementById('main-nav');
        var actions = document.getElementById('header-actions');

        if (!toggle || !nav) {
            return;
        }

        if (toggle._burgerInitialized) {
            return;
        }
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
            if (!nav.classList.contains('open')) {
                return;
            }

            var isInsideNav = nav.contains(e.target);
            var isToggle = toggle.contains(e.target);
            var isInsideActions = actions && actions.contains(e.target);

            if (!isInsideNav && !isToggle && !isInsideActions) {
                closeMobileNav();
            }
        });

        nav.querySelectorAll('a').forEach(function(link) {
            link.addEventListener('click', function() {
                closeMobileNav();
            });
        });
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    /**
     * Handle bootstrap failure.
     * Shows a user-facing error. Does not retry or attempt recovery.
     * 
     * @param {CustomEvent} e - bootstrapFailed event
     */
    function handleBootstrapFailed(e) {
        var detail = e && e.detail ? e.detail : {};
        var message = detail.message || 'Failed to load application data. Please refresh the page.';

        if (NotificationSystem && typeof NotificationSystem.notifyError === 'function') {
            NotificationSystem.notifyError(message, 0);
        }
    }

    /**
     * Handle tab change.
     * Closes the mobile nav so the new tab content is visible.
     */
    function handleTabChanged() {
        closeMobileNav();
    }

    /**
     * Handle viewport resize.
     * If the viewport returns to desktop width, ensure the mobile nav is closed.
     */
    function handleResize() {
        if (window.innerWidth >= UI.MOBILE_BREAKPOINT) {
            closeMobileNav();
        }
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================

    function initApp() {
        initBurgerMenu();

        document.addEventListener('bootstrapFailed', handleBootstrapFailed);
        document.addEventListener('tabChanged', handleTabChanged);

        var resizeTimeout;
        window.addEventListener('resize', function() {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(handleResize, UI.DEBOUNCE_DELAY);
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    // The shell exposes only its own small surface.
    // These are useful for testing and for the burger menu itself.
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
