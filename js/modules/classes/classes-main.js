/**
 * js/modules/classes/classes-main.js - Classes Module
 * Entry point for all class-related features (Classes, Tournaments, Rankings, etc.)
 * Path: js/modules/classes/classes-main.js
 * 
 * This module is responsible for:
 *   - Rendering the Classes tab container
 *   - Tab navigation with state persistence
 *   - Delegating rendering to child modules
 * 
 * TABS:
 *   - Classes: Create/manage class groups, assign characters
 *   - Tournaments: Academic tournaments (moved from top-level)
 *   - Rankings: Rankings filtered by class
 *   - Location Schedule: Location usage view
 *   - Auto-Groups: Auto-generated groups from Discipline + Instructor
 *   - Class View: Schedule summary by discipline/instructor
 * 
 * LIFECYCLE:
 *   TabManager registers 'classes' → renderClasses() → initClassesTabs()
 *   Tab switching → renderTabContent() → child module render function
 * 
 * DEPENDENCIES:
 *   - Curriculum core modules (curriculum-*.js)
 *   - Tournament modules (tournaments-*.js)
 *   - TabManager (js/core/tab-manager.js)
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

        // Core curriculum dependencies
        if (typeof window.ensureCurriculum !== 'function') {
            missing.push('ensureCurriculum');
        }

        if (typeof window.getClasses !== 'function') {
            missing.push('getClasses');
        }

        if (typeof window.getCharactersByClass !== 'function') {
            missing.push('getCharactersByClass');
        }

        if (typeof window.getTeamsByClass !== 'function') {
            missing.push('getTeamsByClass');
        }

        if (typeof window.getClass !== 'function') {
            missing.push('getClass');
        }

        if (typeof window.createClass !== 'function') {
            missing.push('createClass');
        }

        if (typeof window.updateClass !== 'function') {
            missing.push('updateClass');
        }

        if (typeof window.deleteClass !== 'function') {
            missing.push('deleteClass');
        }

        // Tournament dependencies
        if (typeof window.TournamentsCore === 'undefined') {
            missing.push('TournamentsCore');
        }

        if (typeof window.TournamentsQueries === 'undefined') {
            missing.push('TournamentsQueries');
        }

        if (typeof window.TournamentsRender === 'undefined') {
            missing.push('TournamentsRender');
        }

        if (typeof window.TournamentsUI === 'undefined') {
            missing.push('TournamentsUI');
        }

        // Ranking dependencies
        if (typeof window.getRankings !== 'function') {
            missing.push('getRankings');
        }

        if (typeof window.setRankings !== 'function') {
            missing.push('setRankings');
        }

        if (typeof window.autoGenerateRankings !== 'function') {
            missing.push('autoGenerateRankings');
        }

        // Auto-group dependencies
        if (typeof window.getAllAutoGroups !== 'function') {
            missing.push('getAllAutoGroups');
        }

        if (typeof window.rebuildGroupsFromSchedules !== 'function') {
            missing.push('rebuildGroupsFromSchedules');
        }

        // Schedule dependencies
        if (typeof window.getStudentSchedule !== 'function') {
            missing.push('getStudentSchedule');
        }

        if (typeof window.getStudentDisciplineIds !== 'function') {
            missing.push('getStudentDisciplineIds');
        }

        // Location dependencies
        if (typeof window.getLocations !== 'function') {
            missing.push('getLocations');
        }

        if (typeof window.getLocationSchedule !== 'function') {
            missing.push('getLocationSchedule');
        }

        if (typeof window.TabManager === 'undefined') {
            missing.push('TabManager');
        }

        if (missing.length > 0) {
            console.warn('[Classes] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // RENDER CLASSES
    // ============================================================

    function renderClasses(container) {
        if (!container) {
            container = document.getElementById('tab-classes');
        }
        if (!container) {
            console.warn('[Classes] Container not found.');
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading classes data...</p>';
            return;
        }

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Classes dependencies not loaded. Please refresh the page.</p>';
            return;
        }

        try {
            window.ensureCurriculum();
        } catch (e) {
            console.error('[Classes] ensureCurriculum() failed:', e);
            container.innerHTML = '<p class="empty-state">Failed to initialise curriculum schema. Please refresh the page.</p>';
            return;
        }

        container.innerHTML = getClassesHTML();
        initClassesTabs(container, state.currentTab);

        var event = new CustomEvent('classesRendered', {
            detail: { tab: state.currentTab }
        });
        document.dispatchEvent(event);
    }

    // ============================================================
    // CLASSES HTML - Tab navigation styled like Teams
    // ============================================================

    function getClassesHTML() {
        return `
            <div class="tab-container">
                <!-- Tab navigation - styled like teams -->
                <div class="tab-nav" id="classes-tab-nav" style="display:flex;gap:4px;border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:12px;flex-wrap:wrap;">
                    <button class="tab-btn" data-tab="classes" style="background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);padding:6px 12px;cursor:pointer;font-size:0.75rem;transition:0.2s;">Classes</button>
                    <button class="tab-btn" data-tab="tournaments" style="background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);padding:6px 12px;cursor:pointer;font-size:0.75rem;transition:0.2s;">Tournaments</button>
                    <button class="tab-btn" data-tab="rankings" style="background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);padding:6px 12px;cursor:pointer;font-size:0.75rem;transition:0.2s;">Rankings</button>
                    <button class="tab-btn" data-tab="location-schedule" style="background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);padding:6px 12px;cursor:pointer;font-size:0.75rem;transition:0.2s;">Location Schedule</button>
                    <button class="tab-btn" data-tab="auto-groups" style="background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);padding:6px 12px;cursor:pointer;font-size:0.75rem;transition:0.2s;">Auto-Groups</button>
                    <button class="tab-btn" data-tab="class-view" style="background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);padding:6px 12px;cursor:pointer;font-size:0.75rem;transition:0.2s;">Class View</button>
                </div>
                <div class="tab-content" id="classes-tab-content">
                    <div id="tab-classes" class="tab-panel">
                        <div id="classes-content"></div>
                    </div>
                    <div id="tab-tournaments" class="tab-panel">
                        <div id="tournaments-content"></div>
                    </div>
                    <div id="tab-rankings" class="tab-panel">
                        <div id="rankings-content"></div>
                    </div>
                    <div id="tab-location-schedule" class="tab-panel">
                        <div id="location-schedule-content"></div>
                    </div>
                    <div id="tab-auto-groups" class="tab-panel">
                        <div id="groups-content"></div>
                    </div>
                    <div id="tab-class-view" class="tab-panel">
                        <div id="class-view-content"></div>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // TAB INITIALISATION
    // ============================================================

    function initClassesTabs(rootContainer, initialTab) {
        var tabContainer = rootContainer ? 
            rootContainer.querySelector('#classes-tab-nav') : 
            document.getElementById('classes-tab-nav');
            
        if (!tabContainer) {
            console.warn('[Classes] Tab nav not found.');
            return;
        }

        var classesRoot = tabContainer.closest('.tab-container');
        if (!classesRoot) {
            classesRoot = rootContainer;
        }

        var panels = classesRoot ? 
            classesRoot.querySelectorAll('.tab-panel') : 
            document.querySelectorAll('.tab-panel');

        var activeTabName = initialTab || 'classes';
        
        var activeBtn = tabContainer.querySelector('.tab-btn[data-tab="' + activeTabName + '"]');
        
        if (!activeBtn) {
            activeBtn = tabContainer.querySelector('.tab-btn');
            if (!activeBtn) {
                console.warn('[Classes] No tab buttons found.');
                return;
            }
            activeTabName = activeBtn.dataset.tab;
        }

        state.currentTab = activeTabName;

        // Apply active styles
        tabContainer.querySelectorAll('.tab-btn').forEach(function(btn) {
            var isActive = btn.dataset.tab === activeTabName;
            btn.classList.toggle('active', isActive);
            btn.style.color = isActive ? 'var(--accent)' : 'var(--text-dim)';
            btn.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
        });

        showTab(activeTabName, panels, tabContainer, classesRoot);

        tabContainer.addEventListener('click', function(e) {
            var tab = e.target.closest('.tab-btn');
            if (!tab) return;
            
            e.preventDefault();
            
            var tabName = tab.dataset.tab;
            if (!tabName) return;
            
            state.currentTab = tabName;
            
            tabContainer.querySelectorAll('.tab-btn').forEach(function(btn) {
                var isActive = btn.dataset.tab === tabName;
                btn.classList.toggle('active', isActive);
                btn.style.color = isActive ? 'var(--accent)' : 'var(--text-dim)';
                btn.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
            });
            
            showTab(tabName, panels, tabContainer, classesRoot);
        });
    }

    // ============================================================
    // SHOW TAB
    // ============================================================

    function showTab(tabName, panels, tabContainer, classesRoot) {
        panels.forEach(function(panel) {
            panel.style.display = 'none';
            panel.classList.remove('active');
        });

        var activePanel = classesRoot ? 
            classesRoot.querySelector('#tab-' + tabName) : 
            document.getElementById('tab-' + tabName);
            
        if (activePanel) {
            activePanel.style.display = 'block';
            activePanel.classList.add('active');
        } else {
            console.warn('[Classes] Panel not found for tab:', tabName);
        }

        if (tabContainer) {
            tabContainer.querySelectorAll('.tab-btn').forEach(function(btn) {
                var isActive = btn.dataset.tab === tabName;
                btn.classList.toggle('active', isActive);
                btn.style.color = isActive ? 'var(--accent)' : 'var(--text-dim)';
                btn.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
            });
        }

        renderTabContent(tabName, classesRoot);
    }

    // ============================================================
    // RENDER TAB CONTENT - Centralised renderer registry
    // ============================================================

    function renderTabContent(tabName, classesRoot) {
        var content = null;
        var renderer = null;

        function getContentElement(id) {
            if (classesRoot) {
                return classesRoot.querySelector('#' + id);
            }
            return document.getElementById(id);
        }

        // Renderer registry - single source of truth for tab rendering
        var renderers = {
            'classes': {
                contentId: 'classes-content',
                renderer: window.renderClassesView,
                fallback: 'Classes module not loaded.'
            },
            'tournaments': {
                contentId: 'tournaments-content',
                renderer: function(container) {
                    if (window.TournamentsUI && typeof window.TournamentsUI.render === 'function') {
                        window.TournamentsUI.render(container);
                    } else if (typeof window.renderTournaments === 'function') {
                        window.renderTournaments(container);
                    } else {
                        container.innerHTML = '<p class="empty-state">Tournaments module not loaded.</p>';
                    }
                },
                fallback: 'Tournaments module not loaded.'
            },
            'rankings': {
                contentId: 'rankings-content',
                renderer: window.renderRankingView,
                fallback: 'Ranking module not loaded.'
            },
            'location-schedule': {
                contentId: 'location-schedule-content',
                renderer: window.renderLocationSchedule,
                fallback: 'Location Schedule module not loaded.'
            },
            'auto-groups': {
                contentId: 'groups-content',
                renderer: window.renderAutoGroupsView,
                fallback: 'Auto-Groups module not loaded.'
            },
            'class-view': {
                contentId: 'class-view-content',
                renderer: window.renderClassView,
                fallback: 'Class View module not loaded.'
            }
        };

        var config = renderers[tabName];
        if (!config) {
            content = getContentElement('classes-tab-content');
            if (content) {
                content.innerHTML = '<p class="empty-state">Unknown tab: ' + tabName + '</p>';
            }
            return;
        }

        content = getContentElement(config.contentId);
        if (!content) {
            console.warn('[Classes] Content element not found:', config.contentId);
            return;
        }

        renderer = config.renderer;

        if (typeof renderer !== 'function') {
            content.innerHTML = '<p class="empty-state">' + (config.fallbackMessage || config.fallback || 'Module not loaded. Please refresh the page.') + '</p>';
            return;
        }

        try {
            renderer(content);
        } catch (e) {
            console.error('[Classes] Error rendering tab "' + tabName + '":', e);
            content.innerHTML = '<p class="empty-state">Unable to load this section. Please try again.</p>';
        }
    }

    // ============================================================
    // SHARED UTILITY FUNCTIONS
    // ============================================================

    /**
     * Refresh the current classes tab.
     */
    function refreshCurrentTab() {
        if (!state.currentTab) {
            return;
        }

        var container = document.getElementById('tab-classes');
        if (!container) {
            return;
        }

        var classesRoot = container.querySelector('.tab-container');
        if (!classesRoot) {
            classesRoot = container;
        }

        renderTabContent(state.currentTab, classesRoot);
    }

    /**
     * Get the current classes tab name.
     */
    function getCurrentTab() {
        return state.currentTab;
    }

    /**
     * Switch to a specific classes tab.
     */
    function switchTab(tabName) {
        if (!tabName) {
            return;
        }

        var container = document.getElementById('tab-classes');
        if (!container) {
            return;
        }

        var tabContainer = container.querySelector('#classes-tab-nav');
        if (!tabContainer) {
            return;
        }

        var btn = tabContainer.querySelector('.tab-btn[data-tab="' + tabName + '"]');
        if (!btn) {
            console.warn('[Classes] Tab not found:', tabName);
            return;
        }

        btn.click();
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('classes', renderClasses);
    }

    // ============================================================
    // LIFECYCLE EVENTS
    // ============================================================

    document.addEventListener('dataReady', function() {
        if (state.currentTab) {
            setTimeout(function() {
                refreshCurrentTab();
            }, 100);
        }
    });

    document.addEventListener('curriculumDataChanged', function() {
        refreshCurrentTab();
    });

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderClasses = renderClasses;
    window.initClassesTabs = initClassesTabs;
    window.renderTabContent = renderTabContent;
    window.refreshCurrentTab = refreshCurrentTab;
    window.getCurrentTab = getCurrentTab;
    window.switchTab = switchTab;
    window.classesState = state;

})();
