/**
 * js/modules/school/tabs/school-tabs.js - School Tab Controller
 * Manages the school tabs: Disciplines, Locations
 * Path: js/modules/school/tabs/school-tabs.js
 */

(function() {
    'use strict';

    if (window.__schoolTabsLoaded) {
        return;
    }
    window.__schoolTabsLoaded = true;

    var DomUtils = window.DomUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (typeof window.renderDisciplinesView !== 'function') {
            missing.push('renderDisciplinesView');
        }

        if (typeof window.renderLocationsView !== 'function') {
            missing.push('renderLocationsView');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (missing.length > 0) {
            console.warn('SchoolTabs: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // INIT
    // ============================================================

    function init(container) {
        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">School tab dependencies not loaded.</p>';
            return;
        }

        container.innerHTML = getTabsHTML();

        // Render initial tab
        renderTab('disciplines', container);

        bindTabEvents(container);
    }

    // ============================================================
    // HTML
    // ============================================================

    function getTabsHTML() {
        return [
            '<div class="school-tabs">',
                '<div class="school-tab-nav">',
                    '<button class="tab-btn active" data-tab="disciplines">Disciplines</button>',
                    '<button class="tab-btn" data-tab="locations">Locations</button>',
                '</div>',
                '<div id="school-tab-disciplines" class="tab-panel active">',
                    '<div id="disciplines-content"></div>',
                '</div>',
                '<div id="school-tab-locations" class="tab-panel">',
                    '<div id="locations-content"></div>',
                '</div>',
            '</div>'
        ].join('');
    }

    // ============================================================
    // RENDER TAB
    // ============================================================

    function renderTab(tab, container) {
        if (tab === 'disciplines') {
            var content = container.querySelector('#disciplines-content');
            if (content && typeof window.renderDisciplinesView === 'function') {
                window.renderDisciplinesView(content);
            }
        } else if (tab === 'locations') {
            var content = container.querySelector('#locations-content');
            if (content && typeof window.renderLocationsView === 'function') {
                window.renderLocationsView(content);
            }
        }
    }

    // ============================================================
    // BIND EVENTS
    // ============================================================

    function bindTabEvents(container) {
        var nav = container.querySelector('.school-tab-nav');
        if (!nav) {
            return;
        }

        nav.addEventListener('click', function(e) {
            var btn = e.target.closest('.tab-btn');
            if (!btn) {
                return;
            }

            var tab = btn.dataset.tab;
            if (!tab) {
                return;
            }

            // Update buttons
            var btns = nav.querySelectorAll('.tab-btn');
            for (var i = 0; i < btns.length; i++) {
                btns[i].classList.remove('active');
            }
            btn.classList.add('active');

            // Show panel
            var panels = container.querySelectorAll('.tab-panel');
            for (var i = 0; i < panels.length; i++) {
                var panel = panels[i];
                var panelTab = panel.id.replace('school-tab-', '');
                panel.classList.toggle('active', panelTab === tab);
                panel.style.display = panelTab === tab ? 'block' : 'none';
            }

            renderTab(tab, container);
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.SchoolTabs = {
        init: init
    };

})();ta
