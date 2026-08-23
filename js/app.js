/**
 * js/app.js - Application Bootstrapper
 * Minimal entry point that initializes the application
 * Path: js/app.js
 */

(function() {
    'use strict';

    var isInitialized = false;

    function initApp() {
        if (isInitialized) return;
        isInitialized = true;

        // Navigation is handled by TabManager
        // Data loading is handled by DataLoader
        // All modules register themselves with TabManager

        // Initialize import/export after data is ready
        document.addEventListener('dataLoaded', function() {
            if (typeof window.initImportExport === 'function') {
                window.initImportExport();
            }

            // Update dashboard stats if on dashboard tab
            if (typeof window.updateDashboardStats === 'function') {
                window.updateDashboardStats();
            }

            // Trigger initial tab rendering if not already done
            if (typeof window.TabManager !== 'undefined') {
                var currentTab = window.TabManager.getCurrentTab();
                if (currentTab && window.TabManager.tabs[currentTab]) {
                    var container = window.TabManager.tabContentElements[currentTab];
                    if (container && container.style.display !== 'none') {
                        window.TabManager.tabs[currentTab](container);
                    }
                }
            }
        });

        // Handle quick links on dashboard
        document.addEventListener('click', function(e) {
            var target = e.target;
            if (target.classList && target.classList.contains('quick-link') && target.dataset.tab) {
                e.preventDefault();
                var tab = target.dataset.tab;
                if (typeof window.TabManager !== 'undefined') {
                    window.TabManager.switchTo(tab);
                }
            }
            if (target.classList && target.classList.contains('stat-link') && target.dataset.tab) {
                e.preventDefault();
                var tab = target.dataset.tab;
                if (typeof window.TabManager !== 'undefined') {
                    window.TabManager.switchTo(tab);
                }
            }
        });

        // Handle modal close buttons
        document.addEventListener('click', function(e) {
            if (e.target.classList && e.target.classList.contains('close-modal')) {
                var modal = e.target.closest('.modal');
                if (modal) {
                    modal.classList.add('hidden');
                }
            }
        });

        // Handle modal overlay clicks
        document.addEventListener('click', function(e) {
            if (e.target.classList && e.target.classList.contains('modal')) {
                e.target.classList.add('hidden');
            }
        });

        // Handle Escape key for modals
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                var modals = document.querySelectorAll('.modal:not(.hidden)');
                modals.forEach(function(modal) {
                    modal.classList.add('hidden');
                });
            }
        });

        // ============================================================
        // BURGER MENU - Fixed
        // ============================================================
        var navToggle = document.getElementById('nav-toggle');
        if (navToggle) {
            navToggle.addEventListener('click', function(e) {
                e.stopPropagation();
                var nav = document.getElementById('main-nav');
                var actions = document.getElementById('header-actions');
                if (nav) nav.classList.toggle('open');
                if (actions) actions.classList.toggle('open');
                this.classList.toggle('open');
            });
        }

        // Close burger menu when clicking outside
        document.addEventListener('click', function(e) {
            var nav = document.getElementById('main-nav');
            var actions = document.getElementById('header-actions');
            var toggle = document.getElementById('nav-toggle');
            if (nav && nav.classList.contains('open')) {
                if (!nav.contains(e.target) && !actions.contains(e.target) && !toggle.contains(e.target)) {
                    nav.classList.remove('open');
                    actions.classList.remove('open');
                    if (toggle) toggle.classList.remove('open');
                }
            }
        });

        // Close mobile nav on window resize
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

        // Check for hash on load and switch to appropriate tab
        var hash = window.location.hash.replace('#', '');
        if (hash && typeof window.TabManager !== 'undefined') {
            setTimeout(function() {
                if (window.TabManager.tabs[hash]) {
                    window.TabManager.switchTo(hash);
                }
            }, 300);
        }

        // ============================================================
        // IMPORT/EXPORT - Ensure buttons work after page load
        // ============================================================
        // These will be re-initialized by export.js when data loads,
        // but we also need to handle the case where export.js loads first
        setTimeout(function() {
            if (typeof window.initImportExport === 'function') {
                window.initImportExport();
            }
        }, 100);

        console.log('Hollow Blades Manager initialized');
    }

    // Initialize when DOM is ready
    document.addEventListener('DOMContentLoaded', initApp);

    // Also initialize if DOM already loaded
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(initApp, 10);
    }

    // Re-initialize if data loads after app
    document.addEventListener('dataLoaded', function() {
        if (!isInitialized) {
            initApp();
        }
    });

    // Expose app version
    window.APP_VERSION = '1.0.0';
    window.APP_NAME = 'Hollow Blades Manager';

})();
