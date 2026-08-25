/**
 * js/modules/curriculum/curriculum-main.js - Main Curriculum Module
 * Entry point for all curriculum features
 * Path: js/modules/curriculum/curriculum-main.js
 */

(function() {
    'use strict';

    var state = {
        currentGradeWeek: 1,
        currentRankWeek: 1,
        selectedGradeStudentId: null,
        classView: { currentWeek: 1, filterDiscipline: 'all' },
        instructorCalendar: { currentWeek: 1, selectedInstructorId: null, expandedGroups: {} },
        studentSchedule: { currentWeek: 1, selectedStudentId: null },
        classes: { selectedClassId: null, viewMode: 'roster', distributionWeek: 1, maxTeamSize: 4 }
    };

    var currentTab = 'disciplines';

    function renderCurriculum(container) {
        if (!container) {
            container = document.getElementById('tab-curriculum');
        }
        if (!container) return;

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading curriculum data...</p>';
            return;
        }

        if (!window.data.curriculum) {
            window.data.curriculum = {
                disciplines: [],
                schedules: {},
                restDays: {},
                examDays: {},
                grades: {},
                rankings: {},
                currentWeek: 1,
                classInstructors: {},
                classLabels: {},
                classGroupLabels: {},
                classDurations: {},
                instructorClasses: {},
                instructorTemplates: {},
                instructorBlocks: {},
                instructorGroups: {},
                disciplineGroups: {},
                autoGroups: {}
            };
        }
        if (!window.data.classes) {
            window.data.classes = [];
        }

        container.innerHTML = getCurriculumHTML();
        
        setTimeout(function() {
            initCurriculumTabs();
            initCurriculumEvents();
        }, 50);
    }

    function getCurriculumHTML() {
        return `
            <div class="tab-container">
                <div class="tab-nav" id="curriculum-tab-nav">
                    <button class="tab-btn active" data-tab="disciplines">Disciplines</button>
                    <button class="tab-btn" data-tab="groups">Auto-Groups</button>
                    <button class="tab-btn" data-tab="class-view">Class View</button>
                    <button class="tab-btn" data-tab="instructor-calendar">Instructor Calendar</button>
                    <button class="tab-btn" data-tab="schedule">Schedule</button>
                    <button class="tab-btn" data-tab="grades">Grades</button>
                    <button class="tab-btn" data-tab="ranking">Ranking</button>
                    <button class="tab-btn" data-tab="classes">Classes</button>
                </div>
                <div class="tab-content" id="curriculum-tab-content">
                    <div id="tab-disciplines" class="tab-panel active">
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
                </div>
            </div>
        `;
    }

    function initCurriculumTabs() {
        var tabContainer = document.getElementById('curriculum-tab-nav');
        if (!tabContainer) return;

        var panels = document.querySelectorAll('#curriculum-tab-content .tab-panel');

        // Find the active tab button
        var activeBtn = tabContainer.querySelector('.tab-btn.active');
        if (!activeBtn) {
            activeBtn = tabContainer.querySelector('.tab-btn');
        }
        if (!activeBtn) return;

        var activeTabName = activeBtn.dataset.tab;
        currentTab = activeTabName;

        // Hide all panels, then show the active one
        panels.forEach(function(panel) {
            panel.style.display = 'none';
            panel.classList.remove('active');
        });

        var activePanel = document.getElementById('tab-' + activeTabName);
        if (activePanel) {
            activePanel.style.display = 'block';
            activePanel.classList.add('active');
        }

        // Ensure the active tab button is marked correctly
        tabContainer.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn === activeBtn);
        });

        // Render the active tab content
        renderTabContent(activeTabName);

        // Tab switching
        tabContainer.addEventListener('click', function(e) {
            var tab = e.target.closest('.tab-btn');
            if (!tab) return;
            
            e.preventDefault();
            e.stopPropagation();
            
            var tabName = tab.dataset.tab;
            if (!tabName) return;
            
            currentTab = tabName;
            
            tabContainer.querySelectorAll('.tab-btn').forEach(function(t) {
                t.classList.toggle('active', t === tab);
            });
            
            panels.forEach(function(panel) {
                panel.style.display = 'none';
                panel.classList.remove('active');
            });
            
            var activePanel = document.getElementById('tab-' + tabName);
            if (activePanel) {
                activePanel.style.display = 'block';
                activePanel.classList.add('active');
            }
            
            renderTabContent(tabName);
        });
    }

    function renderTabContent(tabName) {
        console.log('[Curriculum] Rendering tab:', tabName);
        
        try {
            var content = null;
            var renderer = null;
            var rendererName = '';

            switch (tabName) {
                case 'disciplines':
                    content = document.getElementById('disciplines-content');
                    renderer = window.renderDisciplinesView;
                    rendererName = 'renderDisciplinesView';
                    break;
                case 'groups':
                    content = document.getElementById('groups-content');
                    renderer = window.renderAutoGroupsView;
                    rendererName = 'renderAutoGroupsView';
                    break;
                case 'class-view':
                    content = document.getElementById('class-view-content');
                    renderer = window.renderClassView;
                    rendererName = 'renderClassView';
                    break;
                case 'instructor-calendar':
                    content = document.getElementById('instructor-calendar-content');
                    renderer = window.renderInstructorCalendar;
                    rendererName = 'renderInstructorCalendar';
                    break;
                case 'schedule':
                    content = document.getElementById('schedule-content');
                    renderer = window.renderStudentScheduleView || window.renderScheduleView;
                    rendererName = 'renderStudentScheduleView/renderScheduleView';
                    break;
                case 'grades':
                    content = document.getElementById('grades-content');
                    renderer = window.renderGradesView;
                    rendererName = 'renderGradesView';
                    break;
                case 'ranking':
                    content = document.getElementById('ranking-content');
                    renderer = window.renderRankingView;
                    rendererName = 'renderRankingView';
                    break;
                case 'classes':
                    content = document.getElementById('classes-content');
                    renderer = window.renderClassesView;
                    rendererName = 'renderClassesView';
                    break;
                default:
                    console.warn('[Curriculum] Unknown tab:', tabName);
                    return;
            }

            if (!content) {
                console.error('[Curriculum] Content element not found for:', tabName);
                return;
            }

            if (typeof renderer !== 'function') {
                console.error('[Curriculum] Renderer "' + rendererName + '" is not a function for tab:', tabName);
                console.log('[Curriculum] Available renderers:', Object.keys(window).filter(function(k) { 
                    return k.toLowerCase().indexOf('render') !== -1 && typeof window[k] === 'function'; 
                }));
                content.innerHTML = '<p class="empty-state">Module not loaded. Please refresh the page.</p>';
                return;
            }

            renderer(content);

            console.log('[Curriculum] Successfully rendered:', tabName);
            console.log('[Curriculum] Content HTML length:', content.innerHTML.length);
            console.log('[Curriculum] Content children:', content.children.length);
            if (content.innerHTML.length > 0) {
                console.log('[Curriculum] Content HTML preview:', content.innerHTML.substring(0, 500));
            }

        } catch (e) {
            console.error('[Curriculum] Error rendering tab "' + tabName + '":', e);
            var content = document.getElementById(tabName + '-content') || 
                          document.getElementById(tabName.replace('-', '') + '-content') ||
                          document.getElementById('disciplines-content');
            if (content) {
                content.innerHTML = '<p class="empty-state">Error loading content: ' + e.message + '</p>';
            }
        }
    }

    function initCurriculumEvents() {
        var initializers = [
            ['disciplines', window.initDisciplineEvents],
            ['groups', window.initAutoGroupsEvents],
            ['class-view', window.initClassViewEvents],
            ['instructor-calendar', window.initInstructorCalendarEvents],
            ['schedule', window.initStudentScheduleEvents],
            ['grades', window.initGradesEvents],
            ['ranking', window.initRankingEvents],
            ['classes', window.initClassEvents]
        ];

        initializers.forEach(function(item) {
            var name = item[0];
            var fn = item[1];

            if (typeof fn === 'function') {
                try {
                    fn();
                    console.log('[Curriculum] Event init success:', name);
                } catch (e) {
                    console.error('[Curriculum] Event init failed:', name, e);
                }
            } else {
                console.warn('[Curriculum] Event initializer missing:', name);
            }
        });
    }

    function populateStudentSelector(id) {
        var select = document.getElementById(id);
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

    function getAllInstructorTemplatesForWeek(week) {
        var results = {};
        var weekNum = parseInt(week) || 1;
        var data = window.data || {};
        if (data.curriculum && data.curriculum.instructorTemplates) {
            for (var templateKey in data.curriculum.instructorTemplates) {
                var parts = templateKey.split('_');
                var instructorId = parts[0];
                var templateWeek = parseInt(parts[1]);
                if (templateWeek === weekNum) {
                    results[instructorId] = data.curriculum.instructorTemplates[templateKey];
                }
            }
        }
        return results;
    }

    function getInstructorTemplatesForWeek(instructorId, week) {
        var templateKey = instructorId + '_' + week;
        var data = window.data || {};
        if (data.curriculum && data.curriculum.instructorTemplates && data.curriculum.instructorTemplates[templateKey]) {
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

    document.addEventListener('dataReady', function() {
        var container = document.getElementById('tab-curriculum');
        if (container && container.style.display !== 'none') {
            renderCurriculum(container);
        }
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'curriculum') {
            var container = document.getElementById('tab-curriculum');
            if (container) {
                renderCurriculum(container);
            }
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-curriculum');
            if (container && container.style.display !== 'none') {
                renderCurriculum(container);
            }
        }, 100);
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderCurriculum = renderCurriculum;
    window.initCurriculumTabs = initCurriculumTabs;
    window.initCurriculumEvents = initCurriculumEvents;
    window.renderTabContent = renderTabContent;
    window.populateStudentSelector = populateStudentSelector;
    window.getInstructorNames = getInstructorNames;
    window.getAllInstructorTemplatesForWeek = getAllInstructorTemplatesForWeek;
    window.getInstructorTemplatesForWeek = getInstructorTemplatesForWeek;
    window.curriculumState = state;

})();
