/**
 * js/modules/curriculum/curriculum-main.js - Main Curriculum Module
 * Entry point for all curriculum features (Disciplines & Locations only)
 * Path: js/modules/curriculum/curriculum-main.js
 * 
 * This module is responsible for:
 *   - Rendering the Curriculum tab container
 *   - Tab navigation with state persistence
 *   - Delegating rendering to child modules
 * 
 * TABS:
 *   - Disciplines: Create/manage subjects
 *   - Locations: Create/manage rooms
 * 
 * LIFECYCLE:
 *   TabManager registers 'curriculum' → renderCurriculum() → initCurriculumTabs()
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

    var state = window.curriculumState || {
        currentTab: 'disciplines'
    };

    if (!state.currentTab) {
        state.currentTab = 'disciplines';
    }

    window.curriculumState = state;

    // ============================================================
    // DEPENDENCY VALIDATION
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (typeof window.ensureCurriculum !== 'function') {
            missing.push('ensureCurriculum');
        }

        if (typeof window.getDisciplines !== 'function') {
            missing.push('getDisciplines');
        }

        if (typeof window.getLocations !== 'function') {
            missing.push('getLocations');
        }

        if (typeof window.createDiscipline !== 'function') {
            missing.push('createDiscipline');
        }

        if (typeof window.updateDiscipline !== 'function') {
            missing.push('updateDiscipline');
        }

        if (typeof window.deleteDiscipline !== 'function') {
            missing.push('deleteDiscipline');
        }

        if (typeof window.createLocation !== 'function') {
            missing.push('createLocation');
        }

        if (typeof window.updateLocation !== 'function') {
            missing.push('updateLocation');
        }

        if (typeof window.deleteLocation !== 'function') {
            missing.push('deleteLocation');
        }

        if (typeof window.TabManager === 'undefined') {
            missing.push('TabManager');
        }

        if (missing.length > 0) {
            console.warn('[Curriculum] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // RENDER CURRICULUM
    // ============================================================

    function renderCurriculum(container) {
        if (!container) {
            container = document.getElementById('tab-curriculum');
        }
        if (!container) {
            console.warn('[Curriculum] Container not found.');
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading curriculum data...</p>';
            return;
        }

        if (!checkDependencies()) {
            container.innerHTML = '<p class="empty-state">Curriculum dependencies not loaded. Please refresh the page.</p>';
            return;
        }

        try {
            window.ensureCurriculum();
        } catch (e) {
            console.error('[Curriculum] ensureCurriculum() failed:', e);
            container.innerHTML = '<p class="empty-state">Failed to initialise curriculum schema. Please refresh the page.</p>';
            return;
        }

        // Build the full HTML structure
        container.innerHTML = getCurriculumHTML();
        
        // Initialize tabs and render content
        initCurriculumTabs(container, state.currentTab);

        // Dispatch event for any listeners
        var event = new CustomEvent('curriculumRendered', {
            detail: { tab: state.currentTab }
        });
        document.dispatchEvent(event);
    }

    // ============================================================
    // CURRICULUM HTML - Disciplines & Locations only
    // ============================================================

    function getCurriculumHTML() {
        return `
            <div class="tab-container">
                <!-- Tab navigation - styled like teams -->
                <div class="tab-nav" id="curriculum-tab-nav" style="display:flex;gap:4px;border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:12px;flex-wrap:wrap;">
                    <button class="tab-btn" data-tab="disciplines" style="background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);padding:6px 12px;cursor:pointer;font-size:0.75rem;transition:0.2s;">Disciplines</button>
                    <button class="tab-btn" data-tab="locations" style="background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);padding:6px 12px;cursor:pointer;font-size:0.75rem;transition:0.2s;">Locations</button>
                </div>
                <div class="tab-content" id="curriculum-tab-content">
                    <div id="tab-disciplines" class="tab-panel">
                        <div id="disciplines-content"></div>
                    </div>
                    <div id="tab-locations" class="tab-panel">
                        <div id="locations-content"></div>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // TAB INITIALISATION
    // ============================================================

    function initCurriculumTabs(rootContainer, initialTab) {
        var tabContainer = rootContainer ? 
            rootContainer.querySelector('#curriculum-tab-nav') : 
            document.getElementById('curriculum-tab-nav');
            
        if (!tabContainer) {
            console.warn('[Curriculum] Tab nav not found.');
            return false;
        }

        var curriculumRoot = tabContainer.closest('.tab-container');
        if (!curriculumRoot) {
            curriculumRoot = rootContainer;
        }

        var panels = curriculumRoot ? 
            curriculumRoot.querySelectorAll('.tab-panel') : 
            document.querySelectorAll('.tab-panel');

        var activeTabName = initialTab || 'disciplines';
        
        var activeBtn = tabContainer.querySelector('.tab-btn[data-tab="' + activeTabName + '"]');
        
        if (!activeBtn) {
            activeBtn = tabContainer.querySelector('.tab-btn');
            if (!activeBtn) {
                console.warn('[Curriculum] No tab buttons found.');
                return false;
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

        // Show the active tab
        showTab(activeTabName, panels, tabContainer, curriculumRoot);

        // Tab switching
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
            
            showTab(tabName, panels, tabContainer, curriculumRoot);
        });

        return true;
    }

    // ============================================================
    // SHOW TAB
    // ============================================================

    function showTab(tabName, panels, tabContainer, curriculumRoot) {
        // Hide all panels
        panels.forEach(function(panel) {
            panel.style.display = 'none';
            panel.classList.remove('active');
        });

        // Show the active panel
        var activePanel = curriculumRoot ? 
            curriculumRoot.querySelector('#tab-' + tabName) : 
            document.getElementById('tab-' + tabName);

        if (activePanel) {
            activePanel.style.display = 'block';
            activePanel.classList.add('active');
            console.log('[Curriculum] Showing panel for:', tabName);
        } else {
            console.warn('[Curriculum] Panel not found for tab:', tabName);
            return;
        }

        // Update tab button styles
        if (tabContainer) {
            tabContainer.querySelectorAll('.tab-btn').forEach(function(btn) {
                var isActive = btn.dataset.tab === tabName;
                btn.classList.toggle('active', isActive);
                btn.style.color = isActive ? 'var(--accent)' : 'var(--text-dim)';
                btn.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
            });
        }

        // RENDER THE TAB CONTENT
        renderTabContent(tabName, curriculumRoot);
    }

    // ============================================================
    // RENDER TAB CONTENT - This actually calls the render functions
    // ============================================================

    function renderTabContent(tabName, curriculumRoot) {
        var content = null;
        var renderer = null;

        function getContentElement(id) {
            // Try scoped query first
            if (curriculumRoot) {
                var el = curriculumRoot.querySelector('#' + id);
                if (el) return el;
            }
            // Fallback to global
            return document.getElementById(id);
        }

        // Renderer registry - single source of truth for tab rendering
        var renderers = {
            'disciplines': {
                contentId: 'disciplines-content',
                renderer: window.renderDisciplinesView,
                fallback: 'Disciplines module not loaded.'
            },
            'locations': {
                contentId: 'locations-content',
                renderer: window.renderLocationsView,
                fallback: 'Locations module not loaded.'
            }
        };

        var config = renderers[tabName];
        if (!config) {
            content = getContentElement('curriculum-tab-content');
            if (content) {
                content.innerHTML = '<p class="empty-state">Unknown tab: ' + tabName + '</p>';
            }
            return;
        }

        content = getContentElement(config.contentId);
        if (!content) {
            console.warn('[Curriculum] Content element not found:', config.contentId);
            return;
        }

        renderer = config.renderer;

        if (typeof renderer !== 'function') {
            console.warn('[Curriculum] Renderer not a function for tab:', tabName);
            content.innerHTML = '<p class="empty-state">' + (config.fallbackMessage || config.fallback || 'Module not loaded. Please refresh the page.') + '</p>';
            return;
        }

        try {
            console.log('[Curriculum] Calling renderer for:', tabName);
            renderer(content);
            console.log('[Curriculum] Renderer completed for:', tabName);
        } catch (e) {
            console.error('[Curriculum] Error rendering tab "' + tabName + '":', e);
            content.innerHTML = '<p class="empty-state">Unable to load this section. Please try again.</p>';
        }
    }

    // ============================================================
    // SHARED UTILITY FUNCTIONS
    // ============================================================

    /**
     * Refresh the current curriculum tab.
     */
    function refreshCurrentTab() {
        if (!state.currentTab) {
            return;
        }

        var container = document.getElementById('tab-curriculum');
        if (!container) {
            return;
        }

        var curriculumRoot = container.querySelector('.tab-container');
        if (!curriculumRoot) {
            curriculumRoot = container;
        }

        renderTabContent(state.currentTab, curriculumRoot);
    }

    /**
     * Get the current curriculum tab name.
     */
    function getCurrentTab() {
        return state.currentTab;
    }

    /**
     * Switch to a specific curriculum tab.
     */
    function switchTab(tabName) {
        if (!tabName) {
            return;
        }

        var container = document.getElementById('tab-curriculum');
        if (!container) {
            return;
        }

        var tabContainer = container.querySelector('#curriculum-tab-nav');
        if (!tabContainer) {
            return;
        }

        var btn = tabContainer.querySelector('.tab-btn[data-tab="' + tabName + '"]');
        if (!btn) {
            console.warn('[Curriculum] Tab not found:', tabName);
            return;
        }

        btn.click();
    }

    /**
     * Get instructor names for a discipline.
     */
    function getInstructorNames(discipline) {
        var names = [];
        if (discipline && discipline.instructorIds) {
            discipline.instructorIds.forEach(function(id) {
                var instructor = window.getCharacterById(id);
                if (instructor) {
                    names.push(window.getDisplayName(instructor));
                }
            });
        }
        return names;
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('curriculum', function(container) {
            renderCurriculum(container);
        });
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

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'curriculum') {
            var container = document.getElementById('tab-curriculum');
            if (container) {
                renderCurriculum(container);
            }
        }
    });

    // Auto-initialize if data is already loaded
    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-curriculum');
            if (container && container.style.display !== 'none') {
                renderCurriculum(container);
            }
        }, 200);
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderCurriculum = renderCurriculum;
    window.initCurriculumTabs = initCurriculumTabs;
    window.renderTabContent = renderTabContent;
    window.refreshCurrentTab = refreshCurrentTab;
    window.getCurrentTab = getCurrentTab;
    window.switchTab = switchTab;
    window.getInstructorNames = getInstructorNames;
    window.curriculumState = state;

})();
