/**
 * js/modules/year/tabs/year-tabs.js - Year Tab Controller
 * Manages the year tabs: Characters, Classes, Groups, Ranking
 * Path: js/modules/year/tabs/year-tabs.js
 */

(function() {
    'use strict';

    if (window.__yearTabsLoaded) {
        return;
    }
    window.__yearTabsLoaded = true;

    var DomUtils = window.DomUtils;
    var CharacterList = window.CharacterList;
    var YearDetail = window.YearDetail;
    var YearEvents = window.YearEvents;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (missing.length > 0) {
            console.warn('YearTabs: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // STATE
    // ============================================================

    var _activeTab = 'characters';

    // ============================================================
    // INIT
    // ============================================================

    function init(container) {
        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Year tab dependencies not loaded.</p>';
            return;
        }

        container.innerHTML = getTabsHTML();

        // Render initial tab
        renderTab(_activeTab, container);

        bindTabEvents(container);
    }

    // ============================================================
    // HTML
    // ============================================================

    function getTabsHTML() {
        return [
            '<div class="year-tabs">',
                '<div class="year-tab-nav">',
                    '<button class="tab-btn active" data-tab="characters">Characters</button>',
                    '<button class="tab-btn" data-tab="classes">Classes</button>',
                    '<button class="tab-btn" data-tab="groups">Groups</button>',
                    '<button class="tab-btn" data-tab="ranking">Ranking</button>',
                '</div>',
                '<div id="year-tab-characters" class="tab-panel active">',
                    '<div class="year-layout-inner">',
                        '<div class="year-sidebar-inner">',
                            '<div id="characters-container"></div>',
                        '</div>',
                        '<div class="year-detail-inner">',
                            '<div id="year-detail-container">',
                                '<p class="empty-state">Select a character to view academic details.</p>',
                            '</div>',
                        '</div>',
                    '</div>',
                '</div>',
                '<div id="year-tab-classes" class="tab-panel">',
                    '<div id="classes-content"></div>',
                '</div>',
                '<div id="year-tab-groups" class="tab-panel">',
                    '<div id="groups-content"></div>',
                '</div>',
                '<div id="year-tab-ranking" class="tab-panel">',
                    '<div id="ranking-content"></div>',
                '</div>',
            '</div>'
        ].join('');
    }

    // ============================================================
    // RENDER TAB
    // ============================================================

    function renderTab(tab, container) {
        if (tab === 'characters') {
            renderCharactersTab(container);
        } else if (tab === 'classes') {
            renderClassesTab(container);
        } else if (tab === 'groups') {
            renderGroupsTab(container);
        } else if (tab === 'ranking') {
            renderRankingTab(container);
        }
    }

    function renderCharactersTab(container) {
        var listContainer = container.querySelector('#characters-container');
        if (listContainer && CharacterList && typeof CharacterList.render === 'function') {
            CharacterList.render();
        }

        if (YearEvents && typeof YearEvents.init === 'function') {
            YearEvents.init(container);
        }

        var selectedId = window.getSelectedYearCharacter ? window.getSelectedYearCharacter() : null;
        if (selectedId && YearDetail && typeof YearDetail.show === 'function') {
            YearDetail.show(selectedId);
        }
    }

    function renderClassesTab(container) {
        var content = container.querySelector('#classes-content');
        if (content && typeof window.renderClassesView === 'function') {
            window.renderClassesView(content);
        } else {
            content.innerHTML = '<p class="empty-state">Classes view not loaded.</p>';
        }
    }

    function renderGroupsTab(container) {
        var content = container.querySelector('#groups-content');
        if (content && typeof window.renderAutoGroupsView === 'function') {
            window.renderAutoGroupsView(content);
        } else {
            content.innerHTML = '<p class="empty-state">Groups view not loaded.</p>';
        }
    }

    function renderRankingTab(container) {
        var content = container.querySelector('#ranking-content');
        if (content && typeof window.renderRankingView === 'function') {
            window.renderRankingView(content);
        } else {
            content.innerHTML = '<p class="empty-state">Ranking view not loaded.</p>';
        }
    }

    // ============================================================
    // BIND EVENTS
    // ============================================================

    function bindTabEvents(container) {
        var nav = container.querySelector('.year-tab-nav');
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
                var panelTab = panel.id.replace('year-tab-', '');
                panel.classList.toggle('active', panelTab === tab);
                panel.style.display = panelTab === tab ? 'block' : 'none';
            }

            _activeTab = tab;
            renderTab(tab, container);
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.YearTabs = {
        init: init,
        switchTab: function(tab, container) {
            _activeTab = tab;
            renderTab(tab, container);
        },
        getActiveTab: function() {
            return _activeTab;
        }
    };

})();