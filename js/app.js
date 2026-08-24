/**
 * js/app.js - Application Bootstrapper
 * Fixed: Burger menu, import/export buttons, performance
 * Path: js/app.js
 */

(function() {
    'use strict';

    var isInitialized = false;

    function initApp() {
        if (isInitialized) return;
        isInitialized = true;

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

        // ============================================================
        // IMPORT/EXPORT BUTTONS - Always visible, properly initialized
        // ============================================================
        function setupImportExport() {
            // Export JSON
            var exportJsonBtns = document.querySelectorAll('#export-json-btn');
            exportJsonBtns.forEach(function(btn) {
                btn.removeEventListener('click', exportJSON);
                btn.addEventListener('click', function(e) {
                    e.preventDefault();
                    if (typeof window.exportJSON === 'function') {
                        window.exportJSON();
                    }
                });
            });

            // Import JSON
            var importJsonBtns = document.querySelectorAll('#import-json-btn');
            importJsonBtns.forEach(function(btn) {
                btn.removeEventListener('click', function() {});
                btn.addEventListener('click', function(e) {
                    e.preventDefault();
                    var input = document.getElementById('json-file-input');
                    if (input) input.click();
                });
            });

            var jsonInputs = document.querySelectorAll('#json-file-input');
            jsonInputs.forEach(function(input) {
                input.removeEventListener('change', function() {});
                input.addEventListener('change', function(e) {
                    if (this.files.length > 0) {
                        if (typeof window.importJSON === 'function') {
                            window.importJSON(this.files[0]);
                        }
                        this.value = '';
                    }
                });
            });

            // Export CSV
            var exportCsvBtns = document.querySelectorAll('#export-csv-btn');
            exportCsvBtns.forEach(function(btn) {
                btn.removeEventListener('click', exportCSV);
                btn.addEventListener('click', function(e) {
                    e.preventDefault();
                    if (typeof window.exportCSV === 'function') {
                        window.exportCSV();
                    }
                });
            });

            // Import CSV
            var importCsvBtns = document.querySelectorAll('#import-csv-btn');
            importCsvBtns.forEach(function(btn) {
                btn.removeEventListener('click', function() {});
                btn.addEventListener('click', function(e) {
                    e.preventDefault();
                    var input = document.getElementById('csv-file-input');
                    if (input) input.click();
                });
            });

            var csvInputs = document.querySelectorAll('#csv-file-input');
            csvInputs.forEach(function(input) {
                input.removeEventListener('change', function() {});
                input.addEventListener('change', function(e) {
                    if (this.files.length > 0) {
                        if (typeof window.importCSV === 'function') {
                            window.importCSV(this.files[0]);
                        }
                        this.value = '';
                    }
                });
            });

            // Template CSV
            var templateBtns = document.querySelectorAll('#template-csv-btn');
            templateBtns.forEach(function(btn) {
                btn.removeEventListener('click', exportTemplateCSV);
                btn.addEventListener('click', function(e) {
                    e.preventDefault();
                    if (typeof window.exportTemplateCSV === 'function') {
                        window.exportTemplateCSV();
                    }
                });
            });
        }

        // Run setup after DOM is ready
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            setupImportExport();
        } else {
            document.addEventListener('DOMContentLoaded', setupImportExport);
        }

        // Also run when data loads
        document.addEventListener('dataLoaded', function() {
            setTimeout(setupImportExport, 100);
        });

        // ============================================================
        // QUICK LINKS
        // ============================================================
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

        // ============================================================
        // MODALS
        // ============================================================
        document.addEventListener('click', function(e) {
            if (e.target.classList && e.target.classList.contains('close-modal')) {
                var modal = e.target.closest('.modal');
                if (modal) {
                    modal.classList.add('hidden');
                }
            }
        });

        document.addEventListener('click', function(e) {
            if (e.target.classList && e.target.classList.contains('modal')) {
                e.target.classList.add('hidden');
            }
        });

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                var modals = document.querySelectorAll('.modal:not(.hidden)');
                modals.forEach(function(modal) {
                    modal.classList.add('hidden');
                });
            }
        });

        // ============================================================
        // HASH ROUTING
        // ============================================================
        var hash = window.location.hash.replace('#', '');
        if (hash && typeof window.TabManager !== 'undefined') {
            setTimeout(function() {
                if (window.TabManager.tabs[hash]) {
                    window.TabManager.switchTo(hash);
                }
            }, 300);
        }

        console.log('Hollow Blades Manager initialized');
    }

    // Initialize when DOM is ready
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(initApp, 10);
    } else {
        document.addEventListener('DOMContentLoaded', initApp);
    }

    document.addEventListener('dataLoaded', function() {
        if (!isInitialized) {
            initApp();
        }
    });

    window.APP_VERSION = '1.0.0';
    window.APP_NAME = 'Hollow Blades Manager';

})();
