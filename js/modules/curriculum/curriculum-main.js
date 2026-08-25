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

    var _initialized = false;
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
            renderAllSections();
            initCurriculumEvents();
            _initialized = true;
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
                <div class="tab-content">
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

    function renderAllSections() {
        var activeTabName = currentTab || 'disciplines';
        refreshTabContent(activeTabName);
    }

    function initCurriculumTabs() {
        var tabContainer = document.getElementById('curriculum-tab-nav');
        if (!tabContainer) return;

        var panels = {
            disciplines: document.getElementById('tab-disciplines'),
            groups: document.getElementById('tab-groups'),
            'class-view': document.getElementById('tab-class-view'),
            'instructor-calendar': document.getElementById('tab-instructor-calendar'),
            schedule: document.getElementById('tab-schedule'),
            grades: document.getElementById('tab-grades'),
            ranking: document.getElementById('tab-ranking'),
            classes: document.getElementById('tab-classes')
        };

        // Get the active tab - default to 'disciplines'
        var activeTabName = 'disciplines';
        var activeBtn = tabContainer.querySelector('.tab-btn.active');
        if (activeBtn && activeBtn.dataset.tab) {
            activeTabName = activeBtn.dataset.tab;
        }

        // Hide all panels first
        for (var key in panels) {
            if (panels[key]) {
                panels[key].style.display = 'none';
                panels[key].classList.remove('active');
            }
        }

        // Show the active panel
        if (panels[activeTabName]) {
            panels[activeTabName].style.display = 'block';
            panels[activeTabName].classList.add('active');
        } else if (panels.disciplines) {
            panels.disciplines.style.display = 'block';
            panels.disciplines.classList.add('active');
            activeTabName = 'disciplines';
        }

        // Make sure the correct tab button is active
        tabContainer.querySelectorAll('.tab-btn').forEach(function(t) {
            t.classList.remove('active');
            if (t.dataset.tab === activeTabName) {
                t.classList.add('active');
            }
        });

        // Set currentTab
        currentTab = activeTabName;

        // Render the active tab content
        refreshTabContent(activeTabName);

        // Tab switching - use event delegation
        tabContainer.addEventListener('click', function(e) {
            var tab = e.target.closest('.tab-btn');
            if (!tab) return;
            
            e.preventDefault();
            e.stopPropagation();
            
            var tabName = tab.dataset.tab;
            if (!tabName) return;
            
            currentTab = tabName;
            
            // Update tab buttons
            tabContainer.querySelectorAll('.tab-btn').forEach(function(t) {
                t.classList.remove('active');
            });
            tab.classList.add('active');
            
            // Update panels
            for (var key in panels) {
                if (panels[key]) {
                    panels[key].style.display = 'none';
                    panels[key].classList.remove('active');
                }
            }
            
            if (panels[tabName]) {
                panels[tabName].style.display = 'block';
                panels[tabName].classList.add('active');
            }
            
            // Refresh tab content
            refreshTabContent(tabName);
        });
    }

    function refreshTabContent(tabName) {
        setTimeout(function() {
            try {
                if (tabName === 'disciplines') {
                    var content = document.getElementById('disciplines-content');
                    if (content && typeof window.renderDisciplinesView === 'function') {
                        window.renderDisciplinesView(content);
                    }
                } else if (tabName === 'groups') {
                    var content = document.getElementById('groups-content');
                    if (content && typeof window.renderAutoGroupsView === 'function') {
                        window.renderAutoGroupsView(content);
                    }
                } else if (tabName === 'class-view') {
                    var content = document.getElementById('class-view-content');
                    if (content && typeof window.renderClassView === 'function') {
                        window.renderClassView(content);
                    }
                } else if (tabName === 'instructor-calendar') {
                    var content = document.getElementById('instructor-calendar-content');
                    if (content && typeof window.renderInstructorCalendar === 'function') {
                        window.renderInstructorCalendar(content);
                    }
                } else if (tabName === 'schedule') {
                    var content = document.getElementById('schedule-content');
                    if (content) {
                        if (typeof window.renderStudentScheduleView === 'function') {
                            window.renderStudentScheduleView(content);
                        } else if (typeof window.renderScheduleView === 'function') {
                            window.renderScheduleView(content);
                        }
                    }
                } else if (tabName === 'grades') {
                    var content = document.getElementById('grades-content');
                    if (content && typeof window.renderGradesView === 'function') {
                        window.renderGradesView(content);
                    }
                } else if (tabName === 'ranking') {
                    var content = document.getElementById('ranking-content');
                    if (content && typeof window.renderRankingView === 'function') {
                        window.renderRankingView(content);
                    }
                } else if (tabName === 'classes') {
                    var content = document.getElementById('classes-content');
                    if (content && typeof window.renderClassesView === 'function') {
                        window.renderClassesView(content);
                    }
                }
            } catch (e) {
                // Silently handle errors
            }
        }, 50);
    }

    function initCurriculumEvents() {
        if (typeof window.initDisciplineEvents === 'function') {
            window.initDisciplineEvents();
        }
        if (typeof window.initAutoGroupsEvents === 'function') {
            window.initAutoGroupsEvents();
        }
        if (typeof window.initClassViewEvents === 'function') {
            window.initClassViewEvents();
        }
        if (typeof window.initInstructorCalendarEvents === 'function') {
            window.initInstructorCalendarEvents();
        }
        if (typeof window.initStudentScheduleEvents === 'function') {
            window.initStudentScheduleEvents();
        }
        if (typeof window.initGradesEvents === 'function') {
            window.initGradesEvents();
        }
        if (typeof window.initRankingEvents === 'function') {
            window.initRankingEvents();
        }
        if (typeof window.initClassEvents === 'function') {
            window.initClassEvents();
        }
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
    window.renderAllSections = renderAllSections;
    window.initCurriculumTabs = initCurriculumTabs;
    window.initCurriculumEvents = initCurriculumEvents;
    window.refreshTabContent = refreshTabContent;
    window.populateStudentSelector = populateStudentSelector;
    window.getInstructorNames = getInstructorNames;
    window.getAllInstructorTemplatesForWeek = getAllInstructorTemplatesForWeek;
    window.getInstructorTemplatesForWeek = getInstructorTemplatesForWeek;
    window.curriculumState = state;

})();
