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
        studentSchedule: { currentWeek: 1, selectedStudentId: null }
    };

    function renderCurriculum(container) {
        container.innerHTML = getCurriculumHTML();
        initCurriculumTabs();
        renderAllSections();
        initCurriculumEvents();
    }

    function getCurriculumHTML() {
        return `
            <div class="tab-container">
                <div class="tab-nav">
                    <button class="tab-btn active" data-tab="disciplines">Disciplines</button>
                    <button class="tab-btn" data-tab="groups">\u25A3 Auto-Groups</button>
                    <button class="tab-btn" data-tab="class-view">\u25A4 Class View</button>
                    <button class="tab-btn" data-tab="instructor-calendar">\u25F7 Instructor Calendar</button>
                    <button class="tab-btn" data-tab="schedule">\u25F7 Schedule</button>
                    <button class="tab-btn" data-tab="grades">Grades</button>
                    <button class="tab-btn" data-tab="ranking">Ranking</button>
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
                </div>
            </div>
        `;
    }

    function renderAllSections() {
        var disciplinesContent = document.getElementById('disciplines-content');
        if (disciplinesContent) {
            if (typeof window.renderDisciplinesView === 'function') {
                window.renderDisciplinesView(disciplinesContent);
            } else {
                disciplinesContent.innerHTML = '<p class="empty-state">Disciplines module not loaded.</p>';
            }
        }

        var groupsContent = document.getElementById('groups-content');
        if (groupsContent) {
            if (typeof window.renderAutoGroupsView === 'function') {
                window.renderAutoGroupsView(groupsContent);
            } else {
                groupsContent.innerHTML = '<p class="empty-state">Auto-Groups module not loaded.</p>';
            }
        }

        var classViewContent = document.getElementById('class-view-content');
        if (classViewContent) {
            if (typeof window.renderClassView === 'function') {
                window.renderClassView(classViewContent);
            } else {
                classViewContent.innerHTML = '<p class="empty-state">Class View module not loaded.</p>';
            }
        }

        var instructorCalendarContent = document.getElementById('instructor-calendar-content');
        if (instructorCalendarContent) {
            if (typeof window.renderInstructorCalendar === 'function') {
                window.renderInstructorCalendar(instructorCalendarContent);
            } else {
                instructorCalendarContent.innerHTML = '<p class="empty-state">Instructor Calendar module not loaded.</p>';
            }
        }

        var scheduleContent = document.getElementById('schedule-content');
        if (scheduleContent) {
            if (typeof window.renderStudentScheduleView === 'function') {
                window.renderStudentScheduleView(scheduleContent);
            } else if (typeof window.renderScheduleView === 'function') {
                window.renderScheduleView(scheduleContent);
            } else {
                scheduleContent.innerHTML = '<p class="empty-state">Schedule module not loaded.</p>';
            }
        }

        var gradesContent = document.getElementById('grades-content');
        if (gradesContent) {
            if (typeof window.renderGradesView === 'function') {
                window.renderGradesView(gradesContent);
            } else {
                gradesContent.innerHTML = '<p class="empty-state">Grades module not loaded.</p>';
            }
        }

        var rankingContent = document.getElementById('ranking-content');
        if (rankingContent) {
            if (typeof window.renderRankingView === 'function') {
                window.renderRankingView(rankingContent);
            } else {
                rankingContent.innerHTML = '<p class="empty-state">Ranking module not loaded.</p>';
            }
        }
    }

    function initCurriculumTabs() {
        var tabs = document.querySelectorAll('.tab-btn');
        var panels = {
            disciplines: document.getElementById('tab-disciplines'),
            groups: document.getElementById('tab-groups'),
            'class-view': document.getElementById('tab-class-view'),
            'instructor-calendar': document.getElementById('tab-instructor-calendar'),
            schedule: document.getElementById('tab-schedule'),
            grades: document.getElementById('tab-grades'),
            ranking: document.getElementById('tab-ranking')
        };

        for (var key in panels) {
            if (panels[key]) {
                panels[key].style.display = 'none';
                panels[key].classList.remove('active');
            }
        }

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

        tabs.forEach(function(tab) {
            tab.addEventListener('click', function(e) {
                e.preventDefault();

                tabs.forEach(function(t) { t.classList.remove('active'); });
                this.classList.add('active');

                var tabName = this.dataset.tab;

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

                refreshTabContent(tabName);
            });
        });
    }

    function refreshTabContent(tabName) {
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
            } else {
                content.innerHTML = '<p class="empty-state">Instructor Calendar module not loaded.</p>';
            }
        } else if (tabName === 'schedule') {
            var content = document.getElementById('schedule-content');
            if (content && typeof window.renderStudentScheduleView === 'function') {
                window.renderStudentScheduleView(content);
            } else if (content && typeof window.renderScheduleView === 'function') {
                window.renderScheduleView(content);
            } else {
                content.innerHTML = '<p class="empty-state">Schedule module not loaded.</p>';
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
        }
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

    // Register with TabManager
    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('curriculum', renderCurriculum);
    }

    document.addEventListener('dataLoaded', function() {
        var container = document.getElementById('tab-curriculum');
        if (container && container.style.display !== 'none') {
            renderCurriculum(container);
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