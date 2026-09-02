/**
 * js/modules/classes/classes-main.js - Classes Module Entry Point
 * Path: js/modules/classes/classes-main.js
 * 
 * This module is responsible for:
 *   - Rendering the Classes tab container
 *   - Tab navigation with state persistence
 *   - Delegating rendering to child modules
 * 
 * TABS:
 *   - Classes: Create/manage graduating classes, add members
 *   - Rankings: Class-based rankings (placeholder)
 *   - Groups: Auto-groups scoped to graduating classes (placeholder)
 *   - Tournaments: Class-based tournaments (uses existing TournamentsUI)
 */

(function() {
    'use strict';

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
    // DEPENDENCY VALIDATION
    // ============================================================

    function checkDependencies() {
        var missing = [];

        var required = [
            'getGraduatingClasses',
            'getGraduatingClass',
            'createGraduatingClass',
            'updateGraduatingClass',
            'deleteGraduatingClass',
            'getCharactersByGraduatingClass',
            'getInstructorsByGraduatingClass',
            'assignCharacterToGraduatingClass',
            'removeCharacterFromGraduatingClass',
            'getDisplayName',
            'getCurrentStatus'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof window[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            return false;
        }

        return true;
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    function registerWithTabManager() {
        if (typeof window.TabManager !== 'undefined' && 
            typeof window.TabManager.register === 'function') {
            window.TabManager.register('classes', renderClasses);
            return true;
        }
        return false;
    }

    registerWithTabManager();

    document.addEventListener('tabManagerReady', function() {
        registerWithTabManager();
    });

    // ============================================================
    // RENDER CLASSES
    // ============================================================

    function renderClasses(container) {
        if (!container) {
            container = document.getElementById('tab-classes');
        }
        
        if (!container) {
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
            var missing = getMissingDependencies();
            container.innerHTML = '<p class="empty-state" style="color:var(--danger);">' +
                'Classes dependencies not loaded. Please refresh.<br>' +
                '<small style="color:var(--text-dim);">Missing: ' + missing.join(', ') + '</small>' +
                '</p>';
            return;
        }

        if (typeof window.ensureCurriculum === 'function') {
            window.ensureCurriculum();
        }

        container.innerHTML = getClassesHTML();
        initClassesTabs(container, state.currentTab);
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

    function getMissingDependencies() {
        var missing = [];
        var required = [
            'getGraduatingClasses',
            'getGraduatingClass',
            'createGraduatingClass',
            'updateGraduatingClass',
            'deleteGraduatingClass',
            'getCharactersByGraduatingClass',
            'getInstructorsByGraduatingClass',
            'assignCharacterToGraduatingClass',
            'removeCharacterFromGraduatingClass',
            'getDisplayName',
            'getCurrentStatus'
        ];
        for (var i = 0; i < required.length; i++) {
            if (typeof window[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }
        return missing;
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

    function initClassesTabs(rootContainer, initialTab) {
        var tabContainer = rootContainer.querySelector('#classes-tab-nav');
        if (!tabContainer) {
            return;
        }

        var tabMap = {
            'classes': 'classes-panel',
            'rankings': 'rankings-panel',
            'groups': 'groups-panel',
            'tournaments': 'tournaments-panel'
        };

        var activeTabName = initialTab || 'classes';
        var activePanelId = tabMap[activeTabName] || 'classes-panel';

        showPanel(activePanelId, rootContainer);
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
            showPanel(panelId, rootContainer);
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

    function showPanel(panelId, rootContainer) {
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

        renderPanelContent(panelId, rootContainer);
    }

    // ============================================================
    // RENDER PANEL CONTENT
    // ============================================================

    function renderPanelContent(panelId, rootContainer) {
        var panelMap = {
            'classes-panel': {
                contentId: 'classes-content',
                renderer: window.renderClassesView,
                fallback: 'Classes module not loaded.'
            },
            'rankings-panel': {
                contentId: 'rankings-content',
                renderer: renderRankingsPlaceholder,
                fallback: 'Rankings module not loaded.'
            },
            'groups-panel': {
                contentId: 'groups-content',
                renderer: renderGroupsPlaceholder,
                fallback: 'Groups module not loaded.'
            },
            'tournaments-panel': {
                contentId: 'tournaments-content',
                renderer: renderTournamentsContent,
                fallback: 'Tournaments module not loaded.'
            }
        };

        var config = panelMap[panelId];
        if (!config) {
            return;
        }

        var content = rootContainer.querySelector('#' + config.contentId);
        if (!content) {
            return;
        }

        content.style.display = 'block';

        var renderer = config.renderer;

        if (typeof renderer !== 'function') {
            content.innerHTML = '<p class="empty-state">' + config.fallback + '</p>';
            return;
        }

        try {
            renderer(content);
        } catch (e) {
            content.innerHTML = '<p class="empty-state">Error loading content. Please refresh.</p>';
        }
    }

    // ============================================================
    // RANKINGS PLACEHOLDER
    // ============================================================

    function renderRankingsPlaceholder(container) {
        if (!container) return;
        
        container.innerHTML = `
            <div class="page-header">
                <h2>Class Rankings</h2>
            </div>
            <div class="ranking-controls" style="margin-bottom:12px;">
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <label style="font-size:0.75rem;color:var(--text-dim);">Class:</label>
                    <select id="rankings-class-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                        <option value="all">All Classes</option>
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

        populateClassFilter('rankings-class-filter');
        
        var classFilter = document.getElementById('rankings-class-filter');
        if (classFilter) {
            classFilter.addEventListener('change', function() {
                renderRankingsTable();
            });
        }

        var weekSelect = document.getElementById('rankings-week-select');
        if (weekSelect) {
            weekSelect.addEventListener('change', function() {
                renderRankingsTable();
            });
        }

        var autoBtn = document.getElementById('auto-rank-btn');
        if (autoBtn) {
            autoBtn.addEventListener('click', function() {
                alert('Auto-rank functionality coming soon.');
            });
        }

        renderRankingsTable();
    }

    function renderRankingsTable() {
        var container = document.getElementById('rankings-container');
        if (!container) return;
        container.innerHTML = '<p class="empty-state">Rankings module coming soon. Select a class to view rankings.</p>';
    }

    // ============================================================
    // GROUPS PLACEHOLDER
    // ============================================================

    function renderGroupsPlaceholder(container) {
        if (!container) return;

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

        populateClassFilter('groups-class-filter');
        populateDisciplineFilter();

        var classFilter = document.getElementById('groups-class-filter');
        if (classFilter) {
            classFilter.addEventListener('change', function() {
                renderGroupsList();
            });
        }

        var disciplineFilter = document.getElementById('groups-discipline-filter');
        if (disciplineFilter) {
            disciplineFilter.addEventListener('change', function() {
                renderGroupsList();
            });
        }

        var rebuildBtn = document.getElementById('rebuild-groups-btn');
        if (rebuildBtn) {
            rebuildBtn.addEventListener('click', function() {
                alert('Rebuild groups functionality coming soon.');
            });
        }

        var refreshBtn = document.getElementById('refresh-groups-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function() {
                renderGroupsList();
            });
        }

        renderGroupsList();
    }

    function renderGroupsList() {
        var container = document.getElementById('groups-container');
        if (!container) return;
        container.innerHTML = '<p class="empty-state">Groups module coming soon. Groups will auto-generate based on discipline, instructor, and time slot combinations.</p>';
    }

    // ============================================================
    // TOURNAMENTS - Uses existing TournamentsUI with class filter
    // ============================================================

    function renderTournamentsContent(container) {
        if (!container) return;

        // Check if tournament modules are loaded
        if (typeof window.TournamentsUI !== 'undefined' && 
            typeof window.TournamentsUI.render === 'function') {
            
            // Render the tournaments with class filter wrapper
            renderTournamentsWithClassFilter(container);
            return;
        }
        
        if (typeof window.renderTournaments === 'function') {
            window.renderTournaments(container);
            return;
        }

        // Fallback placeholder
        container.innerHTML = `
            <div class="page-header">
                <h2>Tournaments</h2>
                <button id="create-tournament-btn" class="primary">+ New Tournament</button>
            </div>
            <p class="empty-state">Tournaments module not loaded. Please refresh.</p>
        `;
    }

    function renderTournamentsWithClassFilter(container) {
        // Build the tournament container with class filter
        var classFilter = getClassFilterValue();
        var classFilterOptions = getClassFilterOptions(classFilter);

        var html = `
            <div class="page-header">
                <h2>Tournaments</h2>
                <button id="create-tournament-btn" class="primary">+ New Tournament</button>
            </div>
            <div class="tournaments-controls" style="margin-bottom:12px;">
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <label style="font-size:0.75rem;color:var(--text-dim);">Class:</label>
                    <select id="tournaments-class-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                        ${classFilterOptions}
                    </select>
                    <button id="refresh-tournaments-btn" class="small secondary">Refresh</button>
                </div>
            </div>
            <div id="tournaments-list-container">
                <!-- Tournaments will be rendered here by TournamentsUI -->
            </div>
        `;

        container.innerHTML = html;

        // Now use TournamentsUI to render the actual tournaments
        var listContainer = container.querySelector('#tournaments-list-container');
        if (listContainer && typeof window.TournamentsUI !== 'undefined' && 
            typeof window.TournamentsUI.render === 'function') {
            
            // Store the class filter for the tournament UI to use
            window._tournamentsClassFilter = classFilter;
            
            // Call the existing tournament renderer
            window.TournamentsUI.render(listContainer);
        }

        // Bind events
        bindTournamentEvents(container);
    }

    function getClassFilterOptions(selected) {
        var classes = window.getGraduatingClasses ? window.getGraduatingClasses() : [];
        var html = '<option value="all"' + (selected === 'all' ? ' selected' : '') + '>All Classes</option>';
        
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var isSelected = String(cls.id) === String(selected);
            html += '<option value="' + escapeHtml(cls.id) + '"' + (isSelected ? ' selected' : '') + '>' + 
                escapeHtml(cls.name) + '</option>';
        }
        return html;
    }

    function getClassFilterValue() {
        var select = document.getElementById('tournaments-class-filter');
        return select ? select.value : 'all';
    }

    function bindTournamentEvents(container) {
        // Class filter change - re-render with new filter
        var classFilterEl = container.querySelector('#tournaments-class-filter');
        if (classFilterEl) {
            var newFilter = classFilterEl.cloneNode(true);
            classFilterEl.parentNode.replaceChild(newFilter, classFilterEl);
            newFilter.addEventListener('change', function() {
                renderTournamentsContent(container);
            });
        }

        // Refresh button
        var refreshBtn = container.querySelector('#refresh-tournaments-btn');
        if (refreshBtn) {
            var newRefresh = refreshBtn.cloneNode(true);
            refreshBtn.parentNode.replaceChild(newRefresh, refreshBtn);
            newRefresh.addEventListener('click', function() {
                renderTournamentsContent(container);
            });
        }

        // Create tournament button
        var createBtn = container.querySelector('#create-tournament-btn');
        if (createBtn) {
            var newCreate = createBtn.cloneNode(true);
            createBtn.parentNode.replaceChild(newCreate, createBtn);
            newCreate.addEventListener('click', function() {
                if (typeof window.TournamentsUI !== 'undefined' && 
                    typeof window.TournamentsUI.showTournamentForm === 'function') {
                    window.TournamentsUI.showTournamentForm();
                } else if (typeof window.showTournamentForm === 'function') {
                    window.showTournamentForm();
                } else {
                    alert('Tournament creation coming soon.');
                }
            });
        }
    }

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    function escapeHtml(value) {
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
        var currentWeek = window.data?.currentWeek || 1;
        for (var w = 1; w <= 52; w++) {
            html += '<option value="' + w + '"' + (w === currentWeek ? ' selected' : '') + '>Week ' + w + '</option>';
        }
        return html;
    }

    function populateClassFilter(selectId) {
        var select = document.getElementById(selectId);
        if (!select) return;

        var classes = window.getGraduatingClasses ? window.getGraduatingClasses() : [];
        select.innerHTML = '<option value="all">All Classes</option>';
        
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.name;
            select.appendChild(option);
        }
    }

    function populateDisciplineFilter() {
        var select = document.getElementById('groups-discipline-filter');
        if (!select) return;

        var disciplines = window.getDisciplines ? window.getDisciplines() : [];
        select.innerHTML = '<option value="all">All Disciplines</option>';
        
        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            var option = document.createElement('option');
            option.value = d.id;
            option.textContent = d.name;
            select.appendChild(option);
        }
    }

    // ============================================================
    // LIFECYCLE EVENTS
    // ============================================================

    document.addEventListener('dataReady', function() {
        var container = document.getElementById('tab-classes');
        if (container) {
            renderClasses(container);
        }
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'classes') {
            var container = document.getElementById('tab-classes');
            if (container) {
                renderClasses(container);
            }
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-classes');
            if (container) {
                renderClasses(container);
            }
        }, 100);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.renderClasses = renderClasses;
    window.initClassesTabs = initClassesTabs;
    window.renderTabContent = renderPanelContent;
    window.classesState = state;

})();
