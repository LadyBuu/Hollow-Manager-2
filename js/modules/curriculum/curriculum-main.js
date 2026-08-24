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

    function renderCurriculum(container) {
        console.log('renderCurriculum called with container:', container);
        
        if (!container) {
            container = document.getElementById('tab-curriculum');
        }
        if (!container) {
            console.error('Curriculum container not found');
            return;
        }

        // Check if data exists
        if (!window.data) {
            console.warn('No data available for curriculum, waiting for dataReady event');
            container.innerHTML = '<p class="empty-state">Loading curriculum data...</p>';
            return;
        }

        // Ensure curriculum structure exists
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
        // Ensure classes array exists
        if (!window.data.classes) {
            window.data.classes = [];
        }

        container.innerHTML = getCurriculumHTML();
        
        // Use setTimeout to ensure DOM is rendered before initializing tabs
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
                <div class="tab-nav">
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
        console.log('renderAllSections called');
        
        // Check if all sub-modules are loaded
        var modulesLoaded = {
            disciplines: typeof window.renderDisciplinesView === 'function',
            groups: typeof window.renderAutoGroupsView === 'function',
            classView: typeof window.renderClassView === 'function',
            instructorCalendar: typeof window.renderInstructorCalendar === 'function',
            schedule: typeof window.renderStudentScheduleView === 'function' || typeof window.renderScheduleView === 'function',
            grades: typeof window.renderGradesView === 'function',
            ranking: typeof window.renderRankingView === 'function',
            classes: typeof window.renderClassesView === 'function'
        };
        
        console.log('Sub-modules loaded status:', modulesLoaded);

        // Disciplines
        var disciplinesContent = document.getElementById('disciplines-content');
        if (disciplinesContent) {
            if (modulesLoaded.disciplines) {
                window.renderDisciplinesView(disciplinesContent);
            } else {
                disciplinesContent.innerHTML = '<p class="empty-state">Disciplines module loading... Please refresh the page.</p>';
                setTimeout(function() {
                    if (typeof window.renderDisciplinesView === 'function') {
                        window.renderDisciplinesView(disciplinesContent);
                    }
                }, 500);
            }
        }

        // Auto-Groups
        var groupsContent = document.getElementById('groups-content');
        if (groupsContent) {
            if (modulesLoaded.groups) {
                window.renderAutoGroupsView(groupsContent);
            } else {
                groupsContent.innerHTML = '<p class="empty-state">Auto-Groups module loading... Please refresh the page.</p>';
                setTimeout(function() {
                    if (typeof window.renderAutoGroupsView === 'function') {
                        window.renderAutoGroupsView(groupsContent);
                    }
                }, 500);
            }
        }

        // Class View
        var classViewContent = document.getElementById('class-view-content');
        if (classViewContent) {
            if (modulesLoaded.classView) {
                window.renderClassView(classViewContent);
            } else {
                classViewContent.innerHTML = '<p class="empty-state">Class View module loading... Please refresh the page.</p>';
                setTimeout(function() {
                    if (typeof window.renderClassView === 'function') {
                        window.renderClassView(classViewContent);
                    }
                }, 500);
            }
        }

        // Instructor Calendar
        var instructorCalendarContent = document.getElementById('instructor-calendar-content');
        if (instructorCalendarContent) {
            if (modulesLoaded.instructorCalendar) {
                window.renderInstructorCalendar(instructorCalendarContent);
            } else {
                instructorCalendarContent.innerHTML = '<p class="empty-state">Instructor Calendar module loading... Please refresh the page.</p>';
                setTimeout(function() {
                    if (typeof window.renderInstructorCalendar === 'function') {
                        window.renderInstructorCalendar(instructorCalendarContent);
                    }
                }, 500);
            }
        }

        // Schedule
        var scheduleContent = document.getElementById('schedule-content');
        if (scheduleContent) {
            if (modulesLoaded.schedule) {
                if (typeof window.renderStudentScheduleView === 'function') {
                    window.renderStudentScheduleView(scheduleContent);
                } else if (typeof window.renderScheduleView === 'function') {
                    window.renderScheduleView(scheduleContent);
                }
            } else {
                scheduleContent.innerHTML = '<p class="empty-state">Schedule module loading... Please refresh the page.</p>';
                setTimeout(function() {
                    if (typeof window.renderStudentScheduleView === 'function') {
                        window.renderStudentScheduleView(scheduleContent);
                    } else if (typeof window.renderScheduleView === 'function') {
                        window.renderScheduleView(scheduleContent);
                    }
                }, 500);
            }
        }

        // Grades
        var gradesContent = document.getElementById('grades-content');
        if (gradesContent) {
            if (modulesLoaded.grades) {
                window.renderGradesView(gradesContent);
            } else {
                gradesContent.innerHTML = '<p class="empty-state">Grades module loading... Please refresh the page.</p>';
                setTimeout(function() {
                    if (typeof window.renderGradesView === 'function') {
                        window.renderGradesView(gradesContent);
                    }
                }, 500);
            }
        }

        // Ranking
        var rankingContent = document.getElementById('ranking-content');
        if (rankingContent) {
            if (modulesLoaded.ranking) {
                window.renderRankingView(rankingContent);
            } else {
                rankingContent.innerHTML = '<p class="empty-state">Ranking module loading... Please refresh the page.</p>';
                setTimeout(function() {
                    if (typeof window.renderRankingView === 'function') {
                        window.renderRankingView(rankingContent);
                    }
                }, 500);
            }
        }

        // Classes
        var classesContent = document.getElementById('classes-content');
        if (classesContent) {
            if (modulesLoaded.classes) {
                window.renderClassesView(classesContent);
            } else {
                classesContent.innerHTML = '<p class="empty-state">Classes module loading... Please refresh the page.</p>';
                setTimeout(function() {
                    if (typeof window.renderClassesView === 'function') {
                        window.renderClassesView(classesContent);
                    }
                }, 500);
            }
        }
    }

    function initCurriculumTabs() {
        console.log('initCurriculumTabs called');
        
        var tabs = document.querySelectorAll('.tab-btn');
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

        // Hide all panels first
        for (var key in panels) {
            if (panels[key]) {
                panels[key].style.display = 'none';
                panels[key].classList.remove('active');
            }
        }

        // Show active tab's panel
        var activeTab = document.querySelector('.tab-btn.active');
        if (activeTab) {
            var activeTabName = activeTab.dataset.tab;
            if (panels[activeTabName]) {
                panels[activeTabName].style.display = 'block';
                panels[activeTabName].classList.add('active');
            }
        } else if (panels.disciplines) {
            panels.disciplines.style.display = 'block';
            panels.disciplines.classList.add('active');
        }

        // Add click handlers using event delegation to avoid clone issues
        var tabContainer = document.querySelector('.tab-nav');
        if (tabContainer) {
            // Remove existing listeners by cloning the container
            var newContainer = tabContainer.cloneNode(true);
            tabContainer.parentNode.replaceChild(newContainer, tabContainer);
            
            newContainer.addEventListener('click', function(e) {
                var tab = e.target.closest('.tab-btn');
                if (!tab) return;
                
                e.preventDefault();
                e.stopPropagation();
                
                var tabName = tab.dataset.tab;
                console.log('Curriculum tab clicked:', tabName);
                
                // Update tab buttons
                document.querySelectorAll('.tab-btn').forEach(function(t) {
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
    }

    function refreshTabContent(tabName) {
        console.log('refreshTabContent called for:', tabName);
        
        // Use setTimeout to ensure panel is visible
        setTimeout(function() {
            try {
                if (tabName === 'disciplines') {
                    var content = document.getElementById('disciplines-content');
                    if (content) {
                        if (typeof window.renderDisciplinesView === 'function') {
                            window.renderDisciplinesView(content);
                        } else {
                            content.innerHTML = '<p class="empty-state">Disciplines module not loaded. Please refresh the page.</p>';
                        }
                    }
                } else if (tabName === 'groups') {
                    var content = document.getElementById('groups-content');
                    if (content) {
                        if (typeof window.renderAutoGroupsView === 'function') {
                            window.renderAutoGroupsView(content);
                        } else {
                            content.innerHTML = '<p class="empty-state">Auto-Groups module not loaded. Please refresh the page.</p>';
                        }
                    }
                } else if (tabName === 'class-view') {
                    var content = document.getElementById('class-view-content');
                    if (content) {
                        if (typeof window.renderClassView === 'function') {
                            window.renderClassView(content);
                        } else {
                            content.innerHTML = '<p class="empty-state">Class View module not loaded. Please refresh the page.</p>';
                        }
                    }
                } else if (tabName === 'instructor-calendar') {
                    var content = document.getElementById('instructor-calendar-content');
                    if (content) {
                        if (typeof window.renderInstructorCalendar === 'function') {
                            window.renderInstructorCalendar(content);
                        } else {
                            content.innerHTML = '<p class="empty-state">Instructor Calendar module not loaded. Please refresh the page.</p>';
                        }
                    }
                } else if (tabName === 'schedule') {
                    var content = document.getElementById('schedule-content');
                    if (content) {
                        if (typeof window.renderStudentScheduleView === 'function') {
                            window.renderStudentScheduleView(content);
                        } else if (typeof window.renderScheduleView === 'function') {
                            window.renderScheduleView(content);
                        } else {
                            content.innerHTML = '<p class="empty-state">Schedule module not loaded. Please refresh the page.</p>';
                        }
                    }
                } else if (tabName === 'grades') {
                    var content = document.getElementById('grades-content');
                    if (content) {
                        if (typeof window.renderGradesView === 'function') {
                            window.renderGradesView(content);
                        } else {
                            content.innerHTML = '<p class="empty-state">Grades module not loaded. Please refresh the page.</p>';
                        }
                    }
                } else if (tabName === 'ranking') {
                    var content = document.getElementById('ranking-content');
                    if (content) {
                        if (typeof window.renderRankingView === 'function') {
                            window.renderRankingView(content);
                        } else {
                            content.innerHTML = '<p class="empty-state">Ranking module not loaded. Please refresh the page.</p>';
                        }
                    }
                } else if (tabName === 'classes') {
                    var content = document.getElementById('classes-content');
                    if (content) {
                        if (typeof window.renderClassesView === 'function') {
                            window.renderClassesView(content);
                        } else {
                            content.innerHTML = '<p class="empty-state">Classes module not loaded. Please refresh the page.</p>';
                        }
                    }
                }
            } catch (e) {
                console.error('Error refreshing tab content:', e);
            }
        }, 50);
    }

    function initCurriculumEvents() {
        console.log('initCurriculumEvents called');
        
        // Each sub-module has its own init function
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

    console.log('curriculum-main.js loaded');

})();
