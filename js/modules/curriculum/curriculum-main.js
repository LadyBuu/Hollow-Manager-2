/**
 * js/modules/curriculum/curriculum-main.js - Main Curriculum Module
 * Entry point for all curriculum features
 * Path: js/modules/curriculum/curriculum-main.js
 * 
 * This module is responsible for:
 *   - Rendering the curriculum tab container
 *   - Tab navigation with state persistence
 *   - Delegating rendering to child modules
 *   - Providing shared utility functions for child modules
 * 
 * IMPORTANT: 
 *   - This module owns ONLY curriculum-level tab navigation state.
 *   - Child modules own their own UI state.
 *   - This module does NOT initialise child module events.
 *   - Each child module is responsible for its own event lifecycle.
 *   - Schema initialisation is delegated to ensureCurriculum().
 * 
 * LIFECYCLE:
 *   TabManager registers 'curriculum' → renderCurriculum() → initCurriculumTabs()
 *   Tab switching → renderTabContent() → child module render function
 * 
 * DEPENDENCIES:
 *   - Curriculum core modules (curriculum-*.js)
 *   - TabManager (js/core/tab-manager.js)
 *   - DataLoader (js/core/loader.js)
 */

(function() {
    'use strict';

    // ============================================================
    // STATE - Shared state root with tab persistence
    // This module owns ONLY curriculum-level tab navigation state.
    // Child modules own their own UI state.
    // ============================================================

    // Preserve existing child state if it exists
    var state = window.curriculumState || {
        currentTab: 'disciplines'
    };

    // Ensure currentTab exists
    if (!state.currentTab) {
        state.currentTab = 'disciplines';
    }

    window.curriculumState = state;

    // ============================================================
    // DEPENDENCY VALIDATION
    // ============================================================

    function checkCoreDependencies() {
        var missing = [];

        if (typeof window.ensureCurriculum !== 'function') {
            missing.push('ensureCurriculum');
        }

        if (typeof window.getDisciplines !== 'function') {
            missing.push('getDisciplines');
        }

        if (typeof window.getClasses !== 'function') {
            missing.push('getClasses');
        }

        if (typeof window.getStudents !== 'function') {
            missing.push('getStudents');
        }

        if (typeof window.getInstructors !== 'function') {
            missing.push('getInstructors');
        }

        if (typeof window.getLocations !== 'function') {
            missing.push('getLocations');
        }

        if (typeof window.getStudentSchedule !== 'function') {
            missing.push('getStudentSchedule');
        }

        if (typeof window.saveData !== 'function') {
            missing.push('saveData');
        }

        if (typeof window.TabManager === 'undefined') {
            missing.push('TabManager');
        }

        if (missing.length > 0) {
            console.warn('[Curriculum] Missing core dependencies:', missing.join(', '));
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

        // Validate dependencies
        if (!checkCoreDependencies()) {
            container.innerHTML = '<p class="empty-state">Curriculum dependencies not loaded. Please refresh the page.</p>';
            return;
        }

        // Ensure curriculum schema exists (delegated to central module)
        try {
            window.ensureCurriculum();
        } catch (e) {
            console.error('[Curriculum] ensureCurriculum() failed:', e);
            container.innerHTML = '<p class="empty-state">Failed to initialise curriculum schema. Please refresh the page.</p>';
            return;
        }

        // Build the UI - no hard-coded active classes; state determines active tab
        container.innerHTML = getCurriculumHTML();
        
        // Initialise tabs with preserved state
        initCurriculumTabs(container, state.currentTab);

        // Dispatch event for any listeners
        var event = new CustomEvent('curriculumRendered', {
            detail: { tab: state.currentTab }
        });
        document.dispatchEvent(event);
    }

    // ============================================================
    // CURRICULUM HTML - Only tabs that exist
    // ============================================================

    function getCurriculumHTML() {
        return `
            <div class="tab-container">
                <div class="tab-nav" id="curriculum-tab-nav">
                    <button class="tab-btn" data-tab="disciplines">Disciplines</button>
                    <button class="tab-btn" data-tab="groups">Auto-Groups</button>
                    <button class="tab-btn" data-tab="class-view">Class View</button>
                    <button class="tab-btn" data-tab="grades">Grades</button>
                    <button class="tab-btn" data-tab="ranking">Ranking</button>
                    <button class="tab-btn" data-tab="classes">Classes</button>
                    <button class="tab-btn" data-tab="locations">Locations</button>
                    <button class="tab-btn" data-tab="calendar">Calendar</button>
                </div>
                <div class="tab-content" id="curriculum-tab-content">
                    <div id="tab-disciplines" class="tab-panel">
                        <div id="disciplines-content"></div>
                    </div>
                    <div id="tab-groups" class="tab-panel">
                        <div id="groups-content"></div>
                    </div>
                    <div id="tab-class-view" class="tab-panel">
                        <div id="class-view-content"></div>
                    </div>
                    <div id="tab-grades" class="tab-panel">
                        <div id="grades-content"></div>
                    </div>
                    <div id="tab-ranking" class="tab-panel">
                        <div id="ranking-content"></div>
                    </div>
                    <div id="tab-classes" class="tab-panel">
                        <div id="classes-content"></div>
                    </div>
                    <div id="tab-locations" class="tab-panel">
                        <div id="locations-content"></div>
                    </div>
                    <div id="tab-calendar" class="tab-panel">
                        <div id="calendar-content"></div>
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
            return;
        }

        // Find the curriculum root for scoped queries
        var curriculumRoot = tabContainer.closest('.tab-container');
        if (!curriculumRoot) {
            curriculumRoot = rootContainer;
        }

        var panels = curriculumRoot ? 
            curriculumRoot.querySelectorAll('.tab-panel') : 
            document.querySelectorAll('.tab-panel');

        // Determine active tab from state
        var activeTabName = initialTab || 'disciplines';
        
        // Find the button for the active tab
        var activeBtn = tabContainer.querySelector('.tab-btn[data-tab="' + activeTabName + '"]');
        
        // Fallback to first button if the tab doesn't exist
        if (!activeBtn) {
            activeBtn = tabContainer.querySelector('.tab-btn');
            if (!activeBtn) {
                console.warn('[Curriculum] No tab buttons found.');
                return;
            }
            activeTabName = activeBtn.dataset.tab;
        }

        // Update state
        state.currentTab = activeTabName;

        // Update button active states
        tabContainer.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === activeTabName);
        });

        // Show the active panel
        showTab(activeTabName, panels, tabContainer, curriculumRoot);

        // Tab switching - single listener (old listener dies with old DOM)
        tabContainer.addEventListener('click', function(e) {
            var tab = e.target.closest('.tab-btn');
            if (!tab) return;
            
            // Prevent navigation if it's a link
            e.preventDefault();
            
            var tabName = tab.dataset.tab;
            if (!tabName) return;
            
            // Update state
            state.currentTab = tabName;
            
            // Update active state on buttons
            tabContainer.querySelectorAll('.tab-btn').forEach(function(t) {
                t.classList.toggle('active', t.dataset.tab === tabName);
            });
            
            showTab(tabName, panels, tabContainer, curriculumRoot);
        });
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

        // Show the active panel - scoped to curriculum root
        var activePanel = curriculumRoot ? 
            curriculumRoot.querySelector('#tab-' + tabName) : 
            document.getElementById('tab-' + tabName);
            
        if (activePanel) {
            activePanel.style.display = 'block';
            activePanel.classList.add('active');
        } else {
            console.warn('[Curriculum] Panel not found for tab:', tabName);
        }

        // Ensure the active tab button is marked correctly
        if (tabContainer) {
            tabContainer.querySelectorAll('.tab-btn').forEach(function(btn) {
                btn.classList.toggle('active', btn.dataset.tab === tabName);
            });
        }

        // Render the tab content
        renderTabContent(tabName, curriculumRoot);
    }

    // ============================================================
    // RENDER TAB CONTENT - Centralised renderer registry
    // ============================================================

    function renderTabContent(tabName, curriculumRoot) {
        var content = null;
        var renderer = null;

        // Helper to get content element scoped to curriculum root
        function getContentElement(id) {
            if (curriculumRoot) {
                return curriculumRoot.querySelector('#' + id);
            }
            return document.getElementById(id);
        }

        // Renderer registry - single source of truth for tab rendering
        var renderers = {
            'disciplines': {
                contentId: 'disciplines-content',
                renderer: window.renderDisciplinesView,
                fallback: 'Disciplines module not loaded.'
            },
            'groups': {
                contentId: 'groups-content',
                renderer: window.renderAutoGroupsView,
                fallback: 'Auto-Groups module not loaded.'
            },
            'class-view': {
                contentId: 'class-view-content',
                renderer: window.renderClassView,
                fallback: 'Class View module not loaded.'
            },
            'grades': {
                contentId: 'grades-content',
                renderer: window.renderGradesView,
                fallback: 'Grades module not loaded.'
            },
            'ranking': {
                contentId: 'ranking-content',
                renderer: window.renderRankingView,
                fallback: 'Ranking module not loaded.'
            },
            'classes': {
                contentId: 'classes-content',
                renderer: window.renderClassesView,
                fallback: 'Classes module not loaded.'
            },
            'locations': {
                contentId: 'locations-content',
                renderer: window.renderLocationsView,
                fallback: 'Locations module not loaded.'
            },
            'calendar': {
                contentId: 'calendar-content',
                renderer: window.renderCalendar,
                fallback: 'Calendar module not loaded.'
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
            content.innerHTML = '<p class="empty-state">' + (config.fallbackMessage || config.fallback || 'Module not loaded. Please refresh the page.') + '</p>';
            return;
        }

        try {
            renderer(content);
        } catch (e) {
            console.error('[Curriculum] Error rendering tab "' + tabName + '":', e);
            content.innerHTML = '<p class="empty-state">Unable to load this section. Please try again.</p>';
        }
    }

    // ============================================================
    // SHARED UTILITY FUNCTIONS
    // ============================================================

    /**
     * Populate a student selector dropdown with all students.
     */
    function populateStudentSelector(id, rootContainer) {
        var select = rootContainer ? 
            rootContainer.querySelector('#' + id) : 
            document.getElementById(id);
            
        if (!select) {
            console.warn('[Curriculum] Student selector not found:', id);
            return;
        }

        var students = window.getStudents();
        select.innerHTML = '<option value="">Select a student...</option>';
        
        students.forEach(function(student) {
            var name = window.getDisplayName(student);
            var option = document.createElement('option');
            option.value = student.id;
            option.textContent = name;
            select.appendChild(option);
        });
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

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('curriculum', renderCurriculum);
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

    window.renderCurriculum = renderCurriculum;
    window.initCurriculumTabs = initCurriculumTabs;
    window.renderTabContent = renderTabContent;
    window.populateStudentSelector = populateStudentSelector;
    window.getInstructorNames = getInstructorNames;
    window.refreshCurrentTab = refreshCurrentTab;
    window.getCurrentTab = getCurrentTab;
    window.switchTab = switchTab;
    window.curriculumState = state;

})();
