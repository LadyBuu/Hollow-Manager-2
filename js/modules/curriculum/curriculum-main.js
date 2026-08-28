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
    // RENDER CURRICULUM
    // ============================================================

    function renderCurriculum(container) {
        if (!container) {
            container = document.getElementById('tab-curriculum');
        }
        if (!container) return;

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading curriculum data...</p>';
            return;
        }

        // Ensure curriculum schema exists (delegated to central module)
        if (typeof window.ensureCurriculum !== 'function') {
            console.error('[Curriculum] ensureCurriculum() is not available.');
            container.innerHTML = '<p class="empty-state">Curriculum schema module not loaded. Please refresh the page.</p>';
            return;
        }

        window.ensureCurriculum();

        // Build the UI - no hard-coded active classes; state determines active tab
        container.innerHTML = getCurriculumHTML();
        
        // Initialise tabs with preserved state
        initCurriculumTabs(container, state.currentTab);
    }

    // ============================================================
    // CURRICULUM HTML
    // ============================================================

    function getCurriculumHTML() {
        return `
            <div class="tab-container">
                <div class="tab-nav" id="curriculum-tab-nav">
                    <button class="tab-btn" data-tab="disciplines">Disciplines</button>
                    <button class="tab-btn" data-tab="groups">Auto-Groups</button>
                    <button class="tab-btn" data-tab="class-view">Class View</button>
                    <button class="tab-btn" data-tab="instructor-calendar">Instructor Calendar</button>
                    <button class="tab-btn" data-tab="schedule">Schedule</button>
                    <button class="tab-btn" data-tab="grades">Grades</button>
                    <button class="tab-btn" data-tab="ranking">Ranking</button>
                    <button class="tab-btn" data-tab="classes">Classes</button>
                    <button class="tab-btn" data-tab="locations">Locations</button>
                    <button class="tab-btn" data-tab="location-schedule">Location Schedule</button>
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
                    <div id="tab-instructor-calendar" class="tab-panel">
                        <div id="instructor-calendar-content"></div>
                    </div>
                    <div id="tab-schedule" class="tab-panel">
                        <div id="schedule-content"></div>
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
                    <div id="tab-location-schedule" class="tab-panel">
                        <div id="location-schedule-content"></div>
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
            
        if (!tabContainer) return;

        // Find the curriculum root for scoped queries
        var curriculumRoot = tabContainer.closest('.tab-container');
        if (!curriculumRoot) return;

        var panels = curriculumRoot.querySelectorAll('.tab-panel');

        // Determine active tab from state
        var activeTabName = initialTab || 'disciplines';
        
        // Find the button for the active tab
        var activeBtn = tabContainer.querySelector('.tab-btn[data-tab="' + activeTabName + '"]');
        
        // Fallback to first button if the tab doesn't exist
        if (!activeBtn) {
            activeBtn = tabContainer.querySelector('.tab-btn');
            if (!activeBtn) return;
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
    // RENDER TAB CONTENT
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

        switch (tabName) {
            case 'disciplines':
                content = getContentElement('disciplines-content');
                renderer = window.renderDisciplinesView;
                break;
            case 'groups':
                content = getContentElement('groups-content');
                renderer = window.renderAutoGroupsView;
                break;
            case 'class-view':
                content = getContentElement('class-view-content');
                renderer = window.renderClassView;
                break;
            case 'instructor-calendar':
                content = getContentElement('instructor-calendar-content');
                renderer = window.renderInstructorCalendar;
                break;
            case 'schedule':
                content = getContentElement('schedule-content');
                // renderStudentScheduleView is the canonical schedule renderer
                renderer = window.renderStudentScheduleView;
                // Fallback for legacy naming
                if (typeof renderer !== 'function') {
                    renderer = window.renderScheduleView;
                }
                break;
            case 'grades':
                content = getContentElement('grades-content');
                renderer = window.renderGradesView;
                break;
            case 'ranking':
                content = getContentElement('ranking-content');
                renderer = window.renderRankingView;
                break;
            case 'classes':
                content = getContentElement('classes-content');
                renderer = window.renderClassesView;
                break;
            case 'locations':
                content = getContentElement('locations-content');
                renderer = window.renderLocationsView;
                break;
            case 'location-schedule':
                content = getContentElement('location-schedule-content');
                renderer = window.renderLocationSchedule;
                break;
            case 'calendar':
                content = getContentElement('calendar-content');
                renderer = window.renderCalendar;
                break;
            default:
                return;
        }

        if (!content) {
            return;
        }

        if (typeof renderer !== 'function') {
            content.innerHTML = '<p class="empty-state">Module not loaded. Please refresh the page.</p>';
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
    // These are genuinely shared across multiple curriculum modules.
    // ============================================================

    /**
     * Populate a student selector dropdown with all students.
     * Used by schedule and grades modules.
     * 
     * Note: This is a global document utility. If you need scoped
     * lookup, pass a root container as an optional second argument.
     */
    function populateStudentSelector(id, rootContainer) {
        var select = rootContainer ? 
            rootContainer.querySelector('#' + id) : 
            document.getElementById(id);
            
        if (!select) return;

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
     * Used by disciplines, grades, and class-view modules.
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
     * Get all instructor templates for a given week.
     * Used by instructor-calendar module.
     * 
     * NOTE: This is the SINGLE authoritative implementation.
     * The instructor-calendar module should use this via window.
     */
    function getAllInstructorTemplatesForWeek(week) {
        var results = {};
        var weekNum = parseInt(week) || 1;
        var data = window.data || {};
        
        if (data.curriculum && data.curriculum.instructorTemplates) {
            var suffix = '_' + weekNum;
            for (var templateKey in data.curriculum.instructorTemplates) {
                if (templateKey.endsWith(suffix)) {
                    var instructorId = templateKey.slice(0, templateKey.length - suffix.length);
                    results[instructorId] = data.curriculum.instructorTemplates[templateKey];
                }
            }
        }
        return results;
    }

    /**
     * Get instructor templates for a specific instructor and week.
     * Used by instructor-calendar module.
     * 
     * NOTE: This is the SINGLE authoritative implementation.
     * The instructor-calendar module should use this via window.
     */
    function getInstructorTemplatesForWeek(instructorId, week) {
        var templateKey = instructorId + '_' + week;
        var data = window.data || {};
        if (data.curriculum && data.curriculum.instructorTemplates && 
            data.curriculum.instructorTemplates[templateKey]) {
            return data.curriculum.instructorTemplates[templateKey];
        }
        return {};
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('curriculum', renderCurriculum);
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderCurriculum = renderCurriculum;
    window.initCurriculumTabs = initCurriculumTabs;
    window.renderTabContent = renderTabContent;
    window.populateStudentSelector = populateStudentSelector;
    window.getInstructorNames = getInstructorNames;
    window.getAllInstructorTemplatesForWeek = getAllInstructorTemplatesForWeek;
    window.getInstructorTemplatesForWeek = getInstructorTemplatesForWeek;
    window.curriculumState = state;

})();
