/**
 * modules/classes/classes-main.js - Classes Module Entry Point
 * Single entry point for all graduating class functionality
 * Path: js/modules/classes/classes-main.js
 * 
 * This module is responsible for:
 *   - Registering with TabManager
 *   - Rendering the Classes tab container
 *   - Tab navigation with state persistence
 *   - Delegating rendering to ClassesView
 *   - Delegating events to ClassesEvents
 * 
 * TABS:
 *   - Classes: Create/manage graduating classes, add members
 *   - Rankings: Class-based rankings (placeholder)
 *   - Groups: Auto-groups scoped to graduating classes (placeholder)
 *   - Tournaments: Class-based tournaments (uses existing TournamentsUI)
 * 
 * LIFECYCLE:
 *   TabManager registers 'classes' → mountClasses() → 
 *   ClassesView.renderClassesView() → ClassesEvents.init()
 * 
 * IMPORTANT:
 *   - This module is the only external entry point for classes
 *   - All class logic lives in the sub-modules
 *   - This module does NOT implement class logic directly
 *   - TabManager is the single source of truth for lifecycle
 *   - mountClasses() is the ONLY function that constructs the full HTML
 *   - Uses ClassesCore for all data queries (not legacy globals)
 * 
 * DEPENDENCIES:
 *   - window.ClassesView (from classes-view.js)
 *   - window.ClassesEvents (from classes-events.js)
 *   - window.ClassesCore (from classes-core.js)
 *   - window.TabManager (from tab-manager.js)
 *   - window.CoreUtils (from core-utils.js)
 *   - window.DomUtils (from dom-utils.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__classesMainLoaded) {
        return;
    }
    window.__classesMainLoaded = true;

    // ============================================================
    // STATE - Shared state root with tab persistence
    // ============================================================

    var state = window.classesState || {
        currentTab: 'classes'
    };

    if (!state.currentTab) {
        state.currentTab = 'classes';
    }

    window.classesState = state;

    // ============================================================
    // DEPENDENCY CHECK - Uses ClassesCore directly
    // ============================================================

    var REQUIRED_DEPENDENCIES = [
        // ClassesCore methods (no longer checking legacy globals)
        'ClassesCore.getGraduatingClasses',
        'ClassesCore.getGraduatingClass',
        'ClassesCore.createGraduatingClass',
        'ClassesCore.updateGraduatingClass',
        'ClassesCore.deleteGraduatingClass',
        'ClassesCore.getCharactersByGraduatingClass',
        'ClassesCore.getInstructorsByGraduatingClass',
        'ClassesCore.assignCharacterToGraduatingClass',
        'ClassesCore.removeCharacterFromGraduatingClass'
    ];

    function checkDependencies() {
        var missing = [];

        // Check ClassesCore exists
        if (!window.ClassesCore || typeof window.ClassesCore !== 'object') {
            missing.push('ClassesCore (module missing)');
            console.warn('ClassesMain: ClassesCore module not found');
            return false;
        }

        // Check each required method on ClassesCore
        REQUIRED_DEPENDENCIES.forEach(function(fullName) {
            var parts = fullName.split('.');
            var obj = window;
            for (var i = 0; i < parts.length; i++) {
                obj = obj[parts[i]];
                if (obj === undefined || obj === null) {
                    missing.push(fullName);
                    break;
                }
            }
        });

        // Check module dependencies
        if (!window.ClassesView || typeof window.ClassesView.renderClassesView !== 'function') {
            missing.push('ClassesView.renderClassesView');
        }

        if (!window.ClassesEvents || typeof window.ClassesEvents.init !== 'function') {
            missing.push('ClassesEvents.init');
        }

        if (!window.CoreUtils || typeof window.CoreUtils.deepClone !== 'function') {
            missing.push('CoreUtils.deepClone');
        }

        if (missing.length > 0) {
            console.warn('ClassesMain: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    function registerWithTabManager() {
        if (window.TabManager && typeof window.TabManager.register === 'function') {
            window.TabManager.register('classes', mountClasses);
            return true;
        }
        return false;
    }

    // Register immediately if TabManager is available
    if (!registerWithTabManager()) {
        document.addEventListener('tabManagerReady', function() {
            registerWithTabManager();
        });
    }

    // ============================================================
    // MOUNT FUNCTION
    // ============================================================

    function mountClasses(container) {
        if (!container) {
            container = document.getElementById('tab-classes');
        }

        if (!container) {
            console.warn('ClassesMain: Container not found');
            return;
        }

        container.style.display = 'block';
        container.style.visibility = 'visible';
        container.style.minHeight = '400px';

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading classes data...</p>';
            return;
        }

        ensureDataStructures();

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state" style="color:var(--danger);">' +
                'Classes dependencies not loaded. Please refresh.</p>';
            return;
        }

        if (typeof window.ensureCurriculum === 'function') {
            window.ensureCurriculum();
        }

        container.innerHTML = getClassesHTML();
        initClassesTabs(container, state.currentTab);
        renderActivePanel(container, state.currentTab);

        if (window.ClassesEvents && typeof window.ClassesEvents.init === 'function') {
            window.ClassesEvents.init(container);
        }
    }

    function ensureDataStructures() {
        var data = window.data || {};
        if (!data.graduatingClasses) {
            data.graduatingClasses = [];
        }
        if (!data.tournaments) {
            data.tournaments = [];
        }
    }

    // ============================================================
    // CLASSES HTML
    // ============================================================

    function getClassesHTML() {
        return `
            <div class="classes-module-container">
                <div class="classes-tab-nav" id="classes-tab-nav" style="display:flex;gap:4px;border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:12px;flex-wrap:wrap;">
                    <button class="classes-tab-btn active" data-panel="classes-panel" style="background:transparent;border:none;border-bottom:2px solid var(--accent);color:var(--accent);padding:6px 12px;cursor:pointer;font-size:0.75rem;transition:0.2s;">Classes</button>
                    <button class="classes-tab-btn" data-panel="rankings-panel" style="background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);padding:6px 12px;cursor:pointer;font-size:0.75rem;transition:0.2s;">Rankings</button>
                    <button class="classes-tab-btn" data-panel="groups-panel" style="background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);padding:6px 12px;cursor:pointer;font-size:0.75rem;transition:0.2s;">Groups</button>
                    <button class="classes-tab-btn" data-panel="tournaments-panel" style="background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);padding:6px 12px;cursor:pointer;font-size:0.75rem;transition:0.2s;">Tournaments</button>
                </div>
                
                <div class="classes-panels" id="classes-panels">
                    <div id="classes-panel" class="classes-panel active" style="display:block;">
                        <div id="classes-content"></div>
                    </div>
                    <div id="rankings-panel" class="classes-panel" style="display:none;">
                        <div id="rankings-content"></div>
                    </div>
                    <div id="groups-panel" class="classes-panel" style="display:none;">
                        <div id="groups-content"></div>
                    </div>
                    <div id="tournaments-panel" class="classes-panel" style="display:none;">
                        <div id="tournaments-content"></div>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // TAB INITIALISATION
    // ============================================================

    var tabMap = {
        'classes': 'classes-panel',
        'rankings': 'rankings-panel',
        'groups': 'groups-panel',
        'tournaments': 'tournaments-panel'
    };

    function initClassesTabs(rootContainer, initialTab) {
        var tabContainer = rootContainer.querySelector('#classes-tab-nav');
        if (!tabContainer) {
            return;
        }

        var activeTabName = initialTab || 'classes';
        var activePanelId = tabMap[activeTabName] || 'classes-panel';

        updateTabButtons(tabContainer, activePanelId);

        tabContainer.addEventListener('click', function(e) {
            var tab = e.target.closest('.classes-tab-btn');
            if (!tab) return;

            e.preventDefault();
            var panelId = tab.dataset.panel;
            if (!panelId) return;

            var tabName = activeTabName;
            for (var key in tabMap) {
                if (tabMap[key] === panelId) {
                    tabName = key;
                    break;
                }
            }

            state.currentTab = tabName;

            updateTabButtons(tabContainer, panelId);
            showPanel(rootContainer, panelId);
            renderActivePanel(rootContainer, tabName);
        });
    }

    function updateTabButtons(tabContainer, activePanelId) {
        var buttons = tabContainer.querySelectorAll('.classes-tab-btn');
        buttons.forEach(function(btn) {
            var isActive = btn.dataset.panel === activePanelId;
            btn.classList.toggle('active', isActive);
            btn.style.color = isActive ? 'var(--accent)' : 'var(--text-dim)';
            btn.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
        });
    }

    function showPanel(rootContainer, panelId) {
        var panels = rootContainer.querySelectorAll('.classes-panel');
        panels.forEach(function(panel) {
            panel.style.display = 'none';
            panel.classList.remove('active');
        });

        var activePanel = rootContainer.querySelector('#' + panelId);
        if (activePanel) {
            activePanel.style.display = 'block';
            activePanel.classList.add('active');
        }
    }

    // ============================================================
    // RENDER PANEL CONTENT
    // ============================================================

    function renderActivePanel(rootContainer, tabName) {
        var panelMap = {
            'classes': {
                panelId: 'classes-panel',
                contentId: 'classes-content',
                renderer: renderClassesContent
            },
            'rankings': {
                panelId: 'rankings-panel',
                contentId: 'rankings-content',
                renderer: renderRankingsPlaceholder
            },
            'groups': {
                panelId: 'groups-panel',
                contentId: 'groups-content',
                renderer: renderGroupsPlaceholder
            },
            'tournaments': {
                panelId: 'tournaments-panel',
                contentId: 'tournaments-content',
                renderer: renderTournamentsContent
            }
        };

        var config = panelMap[tabName];
        if (!config) {
            return;
        }

        var content = rootContainer.querySelector('#' + config.contentId);
        if (!content) {
            return;
        }

        content.style.display = 'block';

        try {
            config.renderer(content, rootContainer);
        } catch (e) {
            console.error('ClassesMain: Error rendering panel:', e);
            content.innerHTML = '<p class="empty-state">Error loading content. Please refresh.</p>';
        }
    }

    // ============================================================
    // PANEL RENDERERS - Using ClassesCore directly
    // ============================================================

    function renderClassesContent(container) {
        if (window.ClassesView && typeof window.ClassesView.renderClassesView === 'function') {
            window.ClassesView.renderClassesView(container);
        } else {
            container.innerHTML = '<p class="empty-state">Classes module not loaded.</p>';
        }
    }

    function renderRankingsPlaceholder(container) {
        if (!container) return;

        // Use ClassesCore for data
        var classes = window.ClassesCore ? window.ClassesCore.getGraduatingClasses() : [];

        container.innerHTML = `
            <div class="page-header">
                <h2>Class Rankings</h2>
            </div>
            <div class="ranking-controls" style="margin-bottom:12px;">
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <label style="font-size:0.75rem;color:var(--text-dim);">Class:</label>
                    <select id="rankings-class-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                        <option value="all">All Classes</option>
                        ${classes.map(function(cls) {
                            return '<option value="' + cls.id + '">' + escapeHtml(cls.name) + '</option>';
                        }).join('')}
                    </select>
                    <label style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Week:</label>
                    <select id="rankings-week-select" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                        ${getWeekOptions()}
                    </select>
                    <button id="auto-rank-btn" class="primary small">Generate Rankings</button>
                </div>
            </div>
            <div id="rankings-container">
                <p class="empty-state">Select a class to view rankings.</p>
            </div>
        `;
    }

    function renderGroupsPlaceholder(container) {
        if (!container) return;

        var classes = window.ClassesCore ? window.ClassesCore.getGraduatingClasses() : [];

        container.innerHTML = `
            <div class="page-header">
                <h2>Auto-Groups</h2>
                <div style="display:flex;gap:4px;">
                    <button id="rebuild-groups-btn" class="primary small">Rebuild Groups</button>
                    <button id="refresh-groups-btn" class="secondary small">Refresh</button>
                </div>
            </div>
            <div class="groups-controls" style="margin-bottom:12px;">
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <label style="font-size:0.75rem;color:var(--text-dim);">Class:</label>
                    <select id="groups-class-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                        <option value="all">All Classes</option>
                        ${classes.map(function(cls) {
                            return '<option value="' + cls.id + '">' + escapeHtml(cls.name) + '</option>';
                        }).join('')}
                    </select>
                    <label style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Discipline:</label>
                    <select id="groups-discipline-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                        <option value="all">All Disciplines</option>
                    </select>
                </div>
            </div>
            <div id="groups-container">
                <p class="empty-state">No auto-groups found. Groups are auto-created when students share the same discipline, instructor, and time slot.</p>
            </div>
        `;
    }

    function renderTournamentsContent(container) {
        if (!container) return;

        var classes = window.ClassesCore ? window.ClassesCore.getGraduatingClasses() : [];

        if (window.TournamentsUI && typeof window.TournamentsUI.render === 'function') {
            var classFilter = getClassFilterFromState();

            var html = `
                <div class="page-header">
                    <h2>Tournaments</h2>
                </div>
                <div class="tournaments-controls" style="margin-bottom:12px;">
                    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                        <label style="font-size:0.75rem;color:var(--text-dim);">Class:</label>
                        <select id="tournaments-class-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                            <option value="all">All Classes</option>
                            ${classes.map(function(cls) {
                                var isSelected = String(cls.id) === String(classFilter);
                                return '<option value="' + escapeHtml(cls.id) + '"' + (isSelected ? ' selected' : '') + '>' + escapeHtml(cls.name) + '</option>';
                            }).join('')}
                        </select>
                        <button id="refresh-tournaments-btn" class="small secondary">Refresh</button>
                    </div>
                </div>
                <div id="tournaments-list-container"></div>
            `;

            container.innerHTML = html;

            var listContainer = container.querySelector('#tournaments-list-container');
            if (listContainer) {
                window.TournamentsUI.render(listContainer);
            }

            bindTournamentEvents(container);
            return;
        }

        if (typeof window.renderTournaments === 'function') {
            window.renderTournaments(container);
            return;
        }

        container.innerHTML = `
            <div class="page-header">
                <h2>Tournaments</h2>
                <button id="create-tournament-btn" class="primary">+ New Tournament</button>
            </div>
            <p class="empty-state">Tournaments module not loaded. Please refresh.</p>
        `;
    }

    // ============================================================
    // TOURNAMENT HELPERS
    // ============================================================

    function getClassFilterFromState() {
        var select = document.getElementById('tournaments-class-filter');
        return select ? select.value : 'all';
    }

    function bindTournamentEvents(container) {
        var classFilterEl = container.querySelector('#tournaments-class-filter');
        if (classFilterEl) {
            var newFilter = classFilterEl.cloneNode(true);
            classFilterEl.parentNode.replaceChild(newFilter, classFilterEl);
            newFilter.addEventListener('change', function() {
                renderTournamentsContent(container);
            });
        }

        var refreshBtn = container.querySelector('#refresh-tournaments-btn');
        if (refreshBtn) {
            var newRefresh = refreshBtn.cloneNode(true);
            refreshBtn.parentNode.replaceChild(newRefresh, refreshBtn);
            newRefresh.addEventListener('click', function() {
                renderTournamentsContent(container);
            });
        }
    }

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    function escapeHtml(value) {
        if (window.DomUtils && typeof window.DomUtils.escapeHtml === 'function') {
            return window.DomUtils.escapeHtml(value);
        }

        if (value === undefined || value === null) {
            return '';
        }
        var str = String(value);
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getWeekOptions() {
        var html = '';
        var currentWeek = window.data && window.data.currentWeek ? window.data.currentWeek : 1;
        for (var w = 1; w <= 52; w++) {
            html += '<option value="' + w + '"' + (w === currentWeek ? ' selected' : '') + '>Week ' + w + '</option>';
        }
        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.mountClasses = mountClasses;
    window.renderClasses = mountClasses; // Legacy alias
    window.classesState = state;
    window.initClassesTabs = initClassesTabs;
    window.renderTabContent = renderActivePanel;

})();
