/**
 * js/modules/academia/academia-main.js - Academia Module
 * Entry point for all academic character management features
 * Path: js/modules/academia/academia-main.js
 * 
 * This module is responsible for:
 *   - Rendering the Academia tab container
 *   - Tab navigation with state persistence
 *   - Delegating rendering to child modules
 * 
 * TABS:
 *   - Schedule: Student or Instructor schedule view
 *   - Grades: Student grades by week
 * 
 * LIFECYCLE:
 *   TabManager registers 'academia' → renderAcademia() → initAcademiaTabs()
 *   Tab switching → renderTabContent() → child module render function
 * 
 * DEPENDENCIES:
 *   - Curriculum core modules (curriculum-*.js)
 *   - TabManager (js/core/tab-manager.js)
 */

(function() {
    'use strict';

    // ============================================================
    // STATE - Shared state root with tab persistence
    // ============================================================

    var state = window.academiaState || {
        currentTab: 'schedule'
    };

    if (!state.currentTab) {
        state.currentTab = 'schedule';
    }

    window.academiaState = state;

    // ============================================================
    // DEPENDENCY VALIDATION
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // Core curriculum dependencies
        if (typeof window.ensureCurriculum !== 'function') {
            missing.push('ensureCurriculum');
        }

        if (typeof window.getStudents !== 'function') {
            missing.push('getStudents');
        }

        if (typeof window.getInstructors !== 'function') {
            missing.push('getInstructors');
        }

        if (typeof window.getCharacterById !== 'function') {
            missing.push('getCharacterById');
        }

        if (typeof window.getDisplayName !== 'function') {
            missing.push('getDisplayName');
        }

        if (typeof window.getStudentSchedule !== 'function') {
            missing.push('getStudentSchedule');
        }

        if (typeof window.getAvailableDisciplines !== 'function') {
            missing.push('getAvailableDisciplines');
        }

        if (typeof window.getDiscipline !== 'function') {
            missing.push('getDiscipline');
        }

        if (typeof window.getClassInstructor !== 'function') {
            missing.push('getClassInstructor');
        }

        if (typeof window.getClassDuration !== 'function') {
            missing.push('getClassDuration');
        }

        if (typeof window.getStudentDisciplineIds !== 'function') {
            missing.push('getStudentDisciplineIds');
        }

        if (typeof window.getGrades !== 'function') {
            missing.push('getGrades');
        }

        if (typeof window.saveGrades !== 'function') {
            missing.push('saveGrades');
        }

        if (typeof window.calculateGradeSummary !== 'function') {
            missing.push('calculateGradeSummary');
        }

        if (typeof window.saveData !== 'function') {
            missing.push('saveData');
        }

        if (typeof window.TabManager === 'undefined') {
            missing.push('TabManager');
        }

        if (missing.length > 0) {
            console.warn('[Academia] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // RENDER ACADEMIA
    // ============================================================

    function renderAcademia(container) {
        if (!container) {
            container = document.getElementById('tab-academia');
        }
        if (!container) {
            console.warn('[Academia] Container not found.');
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading academia data...</p>';
            return;
        }

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Academia dependencies not loaded. Please refresh the page.</p>';
            return;
        }

        try {
            window.ensureCurriculum();
        } catch (e) {
            console.error('[Academia] ensureCurriculum() failed:', e);
            container.innerHTML = '<p class="empty-state">Failed to initialise curriculum schema. Please refresh the page.</p>';
            return;
        }

        container.innerHTML = getAcademiaHTML();
        initAcademiaTabs(container, state.currentTab);

        var event = new CustomEvent('academiaRendered', {
            detail: { tab: state.currentTab }
        });
        document.dispatchEvent(event);
    }

    // ============================================================
    // ACADEMIA HTML - Schedule & Grades tabs
    // ============================================================

    function getAcademiaHTML() {
        return `
            <div class="tab-container">
                <!-- Tab navigation - styled like teams -->
                <div class="tab-nav" id="academia-tab-nav" style="display:flex;gap:4px;border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:12px;flex-wrap:wrap;">
                    <button class="tab-btn" data-tab="schedule" style="background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);padding:6px 12px;cursor:pointer;font-size:0.75rem;transition:0.2s;">Schedule</button>
                    <button class="tab-btn" data-tab="grades" style="background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);padding:6px 12px;cursor:pointer;font-size:0.75rem;transition:0.2s;">Grades</button>
                </div>
                <div class="tab-content" id="academia-tab-content">
                    <div id="tab-schedule" class="tab-panel">
                        <div id="schedule-content"></div>
                    </div>
                    <div id="tab-grades" class="tab-panel">
                        <div id="grades-content"></div>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // TAB INITIALISATION
    // ============================================================

    function initAcademiaTabs(rootContainer, initialTab) {
        var tabContainer = rootContainer ? 
            rootContainer.querySelector('#academia-tab-nav') : 
            document.getElementById('academia-tab-nav');
            
        if (!tabContainer) {
            console.warn('[Academia] Tab nav not found.');
            return;
        }

        var academiaRoot = tabContainer.closest('.tab-container');
        if (!academiaRoot) {
            academiaRoot = rootContainer;
        }

        var panels = academiaRoot ? 
            academiaRoot.querySelectorAll('.tab-panel') : 
            document.querySelectorAll('.tab-panel');

        var activeTabName = initialTab || 'schedule';
        
        var activeBtn = tabContainer.querySelector('.tab-btn[data-tab="' + activeTabName + '"]');
        
        if (!activeBtn) {
            activeBtn = tabContainer.querySelector('.tab-btn');
            if (!activeBtn) {
                console.warn('[Academia] No tab buttons found.');
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

        showTab(activeTabName, panels, tabContainer, academiaRoot);

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
            
            showTab(tabName, panels, tabContainer, academiaRoot);
        });
    }

    // ============================================================
    // SHOW TAB
    // ============================================================

    function showTab(tabName, panels, tabContainer, academiaRoot) {
        panels.forEach(function(panel) {
            panel.style.display = 'none';
            panel.classList.remove('active');
        });

        var activePanel = academiaRoot ? 
            academiaRoot.querySelector('#tab-' + tabName) : 
            document.getElementById('tab-' + tabName);
            
        if (activePanel) {
            activePanel.style.display = 'block';
            activePanel.classList.add('active');
        } else {
            console.warn('[Academia] Panel not found for tab:', tabName);
        }

        if (tabContainer) {
            tabContainer.querySelectorAll('.tab-btn').forEach(function(btn) {
                var isActive = btn.dataset.tab === tabName;
                btn.classList.toggle('active', isActive);
                btn.style.color = isActive ? 'var(--accent)' : 'var(--text-dim)';
                btn.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
            });
        }

        renderTabContent(tabName, academiaRoot);
    }

    // ============================================================
    // RENDER TAB CONTENT - Centralised renderer registry
    // ============================================================

    function renderTabContent(tabName, academiaRoot) {
        var content = null;
        var renderer = null;

        function getContentElement(id) {
            if (academiaRoot) {
                return academiaRoot.querySelector('#' + id);
            }
            return document.getElementById(id);
        }

        // Renderer registry - single source of truth for tab rendering
        var renderers = {
            'schedule': {
                contentId: 'schedule-content',
                renderer: window.renderAcademiaSchedule,
                fallback: 'Schedule module not loaded.'
            },
            'grades': {
                contentId: 'grades-content',
                renderer: window.renderAcademiaGrades,
                fallback: 'Grades module not loaded.'
            }
        };

        var config = renderers[tabName];
        if (!config) {
            content = getContentElement('academia-tab-content');
            if (content) {
                content.innerHTML = '<p class="empty-state">Unknown tab: ' + tabName + '</p>';
            }
            return;
        }

        content = getContentElement(config.contentId);
        if (!content) {
            console.warn('[Academia] Content element not found:', config.contentId);
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
            console.error('[Academia] Error rendering tab "' + tabName + '":', e);
            content.innerHTML = '<p class="empty-state">Unable to load this section. Please try again.</p>';
        }
    }

    // ============================================================
    // SHARED UTILITY FUNCTIONS
    // ============================================================

    /**
     * Refresh the current academia tab.
     */
    function refreshCurrentTab() {
        if (!state.currentTab) {
            return;
        }

        var container = document.getElementById('tab-academia');
        if (!container) {
            return;
        }

        var academiaRoot = container.querySelector('.tab-container');
        if (!academiaRoot) {
            academiaRoot = container;
        }

        renderTabContent(state.currentTab, academiaRoot);
    }

    /**
     * Get the current academia tab name.
     */
    function getCurrentTab() {
        return state.currentTab;
    }

    /**
     * Switch to a specific academia tab.
     */
    function switchTab(tabName) {
        if (!tabName) {
            return;
        }

        var container = document.getElementById('tab-academia');
        if (!container) {
            return;
        }

        var tabContainer = container.querySelector('#academia-tab-nav');
        if (!tabContainer) {
            return;
        }

        var btn = tabContainer.querySelector('.tab-btn[data-tab="' + tabName + '"]');
        if (!btn) {
            console.warn('[Academia] Tab not found:', tabName);
            return;
        }

        btn.click();
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('academia', renderAcademia);
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

    window.renderAcademia = renderAcademia;
    window.initAcademiaTabs = initAcademiaTabs;
    window.renderTabContent = renderTabContent;
    window.refreshCurrentTab = refreshCurrentTab;
    window.getCurrentTab = getCurrentTab;
    window.switchTab = switchTab;
    window.academiaState = state;

})();
