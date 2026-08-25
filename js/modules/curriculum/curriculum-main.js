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

        renderDirect(container);
        initCurriculumEvents(container);
    }

    function renderDirect(container) {
        var html = '';

        // Header
        html += '<div class="page-header">';
        html += '<h2>Curriculum</h2>';
        html += '<span class="text-dim">Week: <span id="curriculum-current-week" style="cursor:pointer;">' + (window.data.curriculum.currentWeek || 1) + '</span></span>';
        html += '</div>';

        // Tab buttons
        html += '<div class="tab-nav" style="display:flex;gap:4px;border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:12px;flex-wrap:wrap;">';
        var tabs = ['disciplines', 'groups', 'class-view', 'instructor-calendar', 'schedule', 'grades', 'ranking', 'classes'];
        var labels = {
            'disciplines': 'Disciplines',
            'groups': 'Auto-Groups',
            'class-view': 'Class View',
            'instructor-calendar': 'Instructor Calendar',
            'schedule': 'Student Schedule',
            'grades': 'Grades',
            'ranking': 'Ranking',
            'classes': 'Classes'
        };
        tabs.forEach(function(tab) {
            var isActive = (currentTab === tab);
            html += '<button class="tab-btn ' + (isActive ? 'active' : '') + '" data-tab="' + tab + '" style="background:transparent;border:none;border-bottom:2px solid ' + (isActive ? 'var(--accent)' : 'transparent') + ';color:' + (isActive ? 'var(--accent)' : 'var(--text-dim)') + ';padding:6px 12px;cursor:pointer;font-size:0.75rem;">' + labels[tab] + '</button>';
        });
        html += '</div>';

        // Content container
        html += '<div id="curriculum-content-container"></div>';

        container.innerHTML = html;

        // Render the current tab
        renderTabContent(currentTab, container);
    }

    function renderTabContent(tab, container) {
        var contentContainer = container.querySelector('#curriculum-content-container');
        if (!contentContainer) return;

        currentTab = tab;

        // Update tab buttons
        var tabButtons = container.querySelectorAll('.tab-btn');
        tabButtons.forEach(function(btn) {
            var isActive = (btn.dataset.tab === tab);
            btn.classList.toggle('active', isActive);
            btn.style.color = isActive ? 'var(--accent)' : 'var(--text-dim)';
            btn.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
        });

        // Render based on tab
        switch(tab) {
            case 'disciplines':
                renderDisciplines(contentContainer);
                break;
            case 'groups':
                renderGroups(contentContainer);
                break;
            case 'class-view':
                renderClassView(contentContainer);
                break;
            case 'instructor-calendar':
                renderInstructorCalendar(contentContainer);
                break;
            case 'schedule':
                renderStudentSchedule(contentContainer);
                break;
            case 'grades':
                renderGrades(contentContainer);
                break;
            case 'ranking':
                renderRanking(contentContainer);
                break;
            case 'classes':
                renderClasses(contentContainer);
                break;
            default:
                contentContainer.innerHTML = '<p class="empty-state">Select a tab</p>';
        }
    }

    // ============================================================
    // DISCIPLINES RENDER
    // ============================================================

    function renderDisciplines(container) {
        var disciplines = window.data.curriculum.disciplines || [];

        var html = '';
        html += '<div class="page-header" style="margin-bottom:8px;">';
        html += '<h3 style="color:var(--accent);font-size:0.9rem;">Disciplines</h3>';
        html += '<button id="add-discipline-btn" class="primary small">+ Add Discipline</button>';
        html += '</div>';

        if (disciplines.length === 0) {
            html += '<p class="empty-state">No disciplines created yet.</p>';
            container.innerHTML = html;
            return;
        }

        html += '<div class="list-header" style="display:grid;grid-template-columns:1fr 0.8fr 1fr 0.8fr 0.6fr 0.6fr;gap:8px;padding:8px 12px;background:var(--panel-alt);border-radius:6px 6px 0 0;border:1px solid var(--border);border-bottom:none;font-weight:600;font-size:0.7rem;color:var(--text-dim);">';
        html += '<span>Discipline</span>';
        html += '<span>Type</span>';
        html += '<span>Instructors</span>';
        html += '<span>Weeks</span>';
        html += '<span>Hours</span>';
        html += '<span>Actions</span>';
        html += '</div>';

        disciplines.forEach(function(d) {
            var typeLabel = d.type === 'mandatory' ? '■ Mandatory' : '□ Optional';
            var typeColor = d.type === 'mandatory' ? 'var(--accent)' : 'var(--warning)';
            var instructorNames = [];
            if (d.instructorIds) {
                d.instructorIds.forEach(function(id) {
                    var inst = window.getCharacterById(id);
                    if (inst) instructorNames.push(window.getDisplayName(inst));
                });
            }
            var weekDisplay = (d.startWeek ? 'Wk ' + d.startWeek : '?') + (d.endWeek ? ' - Wk ' + d.endWeek : '');
            var hoursDisplay = d.weeklyHours || '-';

            html += '<div class="list-item" style="display:grid;grid-template-columns:1fr 0.8fr 1fr 0.8fr 0.6fr 0.6fr;gap:8px;padding:8px 12px;background:var(--panel);border:1px solid var(--border);border-top:none;">';
            html += '<span><strong>' + d.name + '</strong></span>';
            html += '<span style="color:' + typeColor + ';font-size:0.75rem;">' + typeLabel + '</span>';
            html += '<span style="font-size:0.75rem;">' + (instructorNames.join(', ') || 'Not assigned') + '</span>';
            html += '<span style="font-size:0.75rem;">' + weekDisplay + '</span>';
            html += '<span style="font-size:0.75rem;">' + hoursDisplay + 'h</span>';
            html += '<span class="actions" style="display:flex;gap:4px;flex-wrap:wrap;">';
            html += '<button class="small edit-discipline" data-id="' + d.id + '" style="padding:2px 8px;font-size:0.65rem;">Edit</button>';
            html += '<button class="small danger delete-discipline" data-id="' + d.id + '" style="padding:2px 8px;font-size:0.65rem;">Delete</button>';
            html += '</span>';
            html += '</div>';
        });

        container.innerHTML = html;

        container.querySelectorAll('.edit-discipline').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var id = this.dataset.id;
                var discipline = window.getDiscipline(id);
                if (!discipline) return;
                
                var newName = prompt('Edit discipline name:', discipline.name);
                if (newName && newName.trim()) {
                    var data = window.data || {};
                    if (data.curriculum && data.curriculum.disciplines) {
                        var found = data.curriculum.disciplines.find(function(d) { return String(d.id) === String(id); });
                        if (found) {
                            found.name = newName.trim();
                            if (typeof window.saveData === 'function') {
                                window.saveData().catch(function(err) { /* ignore */ });
                            }
                            renderDisciplines(container);
                        }
                    }
                }
            });
        });

        container.querySelectorAll('.delete-discipline').forEach(function(btn) {
            btn.addEventListener('click', function() {
                if (confirm('Delete this discipline permanently?')) {
                    var id = this.dataset.id;
                    var data = window.data || {};
                    if (data.curriculum) {
                        data.curriculum.disciplines = data.curriculum.disciplines.filter(function(d) { return String(d.id) !== String(id); });
                        if (typeof window.saveData === 'function') {
                            window.saveData().catch(function(err) { /* ignore */ });
                        }
                        renderDisciplines(container);
                    }
                }
            });
        });

        var addBtn = container.querySelector('#add-discipline-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() {
                var name = prompt('Enter discipline name:');
                if (!name) return;
                var type = prompt('Enter type (mandatory/optional):', 'mandatory');
                if (!type) return;
                var instructorId = prompt('Enter instructor character ID (optional):', '');
                var startWeek = prompt('Enter start week (optional):', '');
                var endWeek = prompt('Enter end week (optional):', '');
                var weeklyHours = prompt('Enter weekly hours (optional):', '');
                
                var data = window.data || {};
                if (!data.curriculum) data.curriculum = { disciplines: [] };
                
                var instructorIds = [];
                if (instructorId && instructorId.trim()) {
                    instructorIds.push(instructorId.trim());
                }
                
                data.curriculum.disciplines.push({
                    id: window.generateId('disc'),
                    name: name.trim(),
                    type: type.trim() || 'mandatory',
                    instructorIds: instructorIds,
                    startWeek: startWeek || '',
                    endWeek: endWeek || '',
                    weeklyHours: weeklyHours || '',
                    maxStudents: '',
                    weight: 1,
                    gradingSystem: [],
                    createdAt: new Date().toISOString()
                });
                if (typeof window.saveData === 'function') {
                    window.saveData().catch(function(err) { /* ignore */ });
                }
                renderDisciplines(container);
            });
        }
    }

    // ============================================================
    // GROUPS RENDER
    // ============================================================

    function renderGroups(container) {
        var html = '';
        html += '<div class="page-header" style="margin-bottom:8px;">';
        html += '<h3 style="color:var(--accent);font-size:0.9rem;">Auto-Groups</h3>';
        html += '<span style="font-size:0.7rem;color:var(--text-dim);">Groups auto-created from Discipline + Instructor</span>';
        html += '</div>';

        var groups = window.data.curriculum.autoGroups || {};
        var groupKeys = Object.keys(groups);

        if (groupKeys.length === 0) {
            html += '<p class="empty-state">No groups created yet. Groups are auto-created when students are assigned to classes.</p>';
            container.innerHTML = html;
            return;
        }

        html += '<div style="display:flex;flex-direction:column;gap:8px;">';
        groupKeys.forEach(function(key) {
            var group = groups[key];
            var discipline = window.getDiscipline(group.disciplineId);
            var instructor = window.getCharacterById(group.instructorId);
            var disciplineName = discipline ? discipline.name : 'Unknown';
            var instructorName = instructor ? window.getDisplayName(instructor) : 'Unknown';
            var studentCount = group.students ? group.students.length : 0;
            var slotCount = group.slots ? group.slots.length : 0;

            html += '<div style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px;">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">';
            html += '<div><strong style="color:var(--accent);">' + disciplineName + '</strong>';
            html += ' <span style="color:var(--text-dim);font-size:0.75rem;">(' + instructorName + ')</span>';
            html += ' <span style="color:var(--text-dim);font-size:0.7rem;">' + studentCount + ' students, ' + slotCount + ' slots</span>';
            html += '</div>';
            html += '</div>';
            html += '</div>';
        });
        html += '</div>';

        container.innerHTML = html;
    }

    // ============================================================
    // CLASS VIEW RENDER
    // ============================================================

    function renderClassView(container) {
        var week = window.data.curriculum.currentWeek || 1;
        var students = window.getStudents();
        var disciplines = window.getAvailableDisciplines(week);

        var html = '';
        html += '<div class="page-header" style="margin-bottom:8px;">';
        html += '<h3 style="color:var(--accent);font-size:0.9rem;">Class View - Week ' + week + '</h3>';
        html += '<div style="display:flex;gap:8px;">';
        html += '<button id="prev-class-week" class="small secondary">← Prev</button>';
        html += '<button id="next-class-week" class="small secondary">Next →</button>';
        html += '<button id="goto-class-week" class="small primary">Go</button>';
        html += '</div>';
        html += '</div>';

        if (students.length === 0) {
            html += '<p class="empty-state">No students found.</p>';
            container.innerHTML = html;
            return;
        }

        if (disciplines.length === 0) {
            html += '<p class="empty-state">No disciplines available for week ' + week + '.</p>';
            container.innerHTML = html;
            return;
        }

        var dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        var hasClasses = false;

        disciplines.forEach(function(discipline) {
            var classData = {};

            students.forEach(function(student) {
                var schedule = window.getStudentSchedule(student.id, week);
                for (var day in schedule) {
                    for (var hour in schedule[day]) {
                        if (String(schedule[day][hour]) === String(discipline.id)) {
                            var key = day + '_' + hour;
                            if (!classData[key]) {
                                classData[key] = {
                                    day: parseInt(day),
                                    hour: parseInt(hour),
                                    students: []
                                };
                            }
                            classData[key].students.push(student);
                        }
                    }
                }
            });

            var keys = Object.keys(classData);
            if (keys.length === 0) return;
            hasClasses = true;

            var typeLabel = discipline.type === 'mandatory' ? '■ Mandatory' : '□ Optional';
            var typeColor = discipline.type === 'mandatory' ? 'var(--accent)' : 'var(--warning)';

            html += '<div style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px;margin-bottom:12px;">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;">';
            html += '<h4 style="color:var(--accent);margin:0;">' + discipline.name + '</h4>';
            html += '<span style="font-size:0.7rem;padding:2px 12px;border-radius:12px;background:' + typeColor + '33;color:' + typeColor + ';border:1px solid ' + typeColor + ';">' + typeLabel + '</span>';
            html += '</div>';

            keys.sort(function(a, b) {
                var aParts = a.split('_');
                var bParts = b.split('_');
                if (parseInt(aParts[0]) !== parseInt(bParts[0])) return parseInt(aParts[0]) - parseInt(bParts[0]);
                return parseInt(aParts[1]) - parseInt(bParts[1]);
            });

            keys.forEach(function(key) {
                var data = classData[key];
                var hourDisplay = data.hour > 12 ? data.hour - 12 : data.hour;
                var ampm = data.hour >= 12 ? 'PM' : 'AM';
                if (data.hour === 0) { hourDisplay = 12; ampm = 'AM'; }
                if (data.hour === 12) { ampm = 'PM'; }

                html += '<div style="background:var(--bg);border-radius:4px;padding:6px 10px;margin-bottom:4px;border-left:3px solid var(--accent);">';
                html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">';
                html += '<span style="font-weight:500;font-size:0.8rem;">' + dayNames[data.day] + ' at ' + hourDisplay + ':00 ' + ampm + '</span>';
                html += '<span style="font-size:0.7rem;color:var(--text-dim);">' + data.students.length + ' student' + (data.students.length > 1 ? 's' : '') + '</span>';
                html += '</div>';
                html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">';
                data.students.forEach(function(student) {
                    html += '<span style="background:var(--panel-alt);padding:2px 10px;border-radius:12px;font-size:0.7rem;">' + window.getDisplayName(student) + '</span>';
                });
                html += '</div>';
                html += '</div>';
            });

            html += '</div>';
        });

        if (!hasClasses) {
            html += '<p class="empty-state">No classes scheduled for week ' + week + '.</p>';
        }

        container.innerHTML = html;

        var prevBtn = container.querySelector('#prev-class-week');
        if (prevBtn) {
            prevBtn.addEventListener('click', function() {
                if (window.data.curriculum.currentWeek > 1) {
                    window.data.curriculum.currentWeek--;
                    renderClassView(container);
                }
            });
        }
        var nextBtn = container.querySelector('#next-class-week');
        if (nextBtn) {
            nextBtn.addEventListener('click', function() {
                if (window.data.curriculum.currentWeek < 52) {
                    window.data.curriculum.currentWeek++;
                    renderClassView(container);
                }
            });
        }
        var gotoBtn = container.querySelector('#goto-class-week');
        if (gotoBtn) {
            gotoBtn.addEventListener('click', function() {
                var week = prompt('Enter week number (1-52):', window.data.curriculum.currentWeek || 1);
                if (week) {
                    var w = parseInt(week);
                    if (!isNaN(w) && w >= 1 && w <= 52) {
                        window.data.curriculum.currentWeek = w;
                        renderClassView(container);
                    } else {
                        alert('Please enter a valid week (1-52).');
                    }
                }
            });
        }
    }

    // ============================================================
    // INSTRUCTOR CALENDAR RENDER - FULLY WORKING
    // ============================================================

    function renderInstructorCalendar(container) {
        var instructors = window.getInstructors();
        var week = window.data.curriculum.currentWeek || 1;

        var html = '';
        html += '<div class="page-header" style="margin-bottom:8px;">';
        html += '<h3 style="color:var(--accent);font-size:0.9rem;">Instructor Calendar - Week ' + week + '</h3>';
        html += '<div style="display:flex;gap:8px;">';
        html += '<button id="prev-instructor-week" class="small secondary">← Prev</button>';
        html += '<button id="next-instructor-week" class="small secondary">Next →</button>';
        html += '<button id="goto-instructor-week" class="small primary">Go</button>';
        html += '</div>';
        html += '</div>';

        if (instructors.length === 0) {
            html += '<p class="empty-state">No instructors found.</p>';
            container.innerHTML = html;
            return;
        }

        var dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        var students = window.getStudents();

        html += '<div style="display:flex;flex-direction:column;gap:12px;">';

        instructors.forEach(function(instructor) {
            var name = window.getDisplayName(instructor);
            var status = window.getCurrentStatus(instructor);
            var scheduleMap = {};

            students.forEach(function(student) {
                var schedule = window.getStudentSchedule(student.id, week);
                for (var day in schedule) {
                    for (var hour in schedule[day]) {
                        var disciplineId = schedule[day][hour];
                        if (disciplineId) {
                            var discipline = window.getDiscipline(disciplineId);
                            if (discipline && discipline.instructorIds) {
                                var isTeaching = discipline.instructorIds.some(function(id) {
                                    return String(id) === String(instructor.id);
                                });
                                if (isTeaching) {
                                    var key = day + '_' + hour;
                                    if (!scheduleMap[key]) {
                                        scheduleMap[key] = {
                                            day: parseInt(day),
                                            hour: parseInt(hour),
                                            discipline: discipline,
                                            students: []
                                        };
                                    }
                                    scheduleMap[key].students.push({
                                        id: student.id,
                                        name: window.getDisplayName(student)
                                    });
                                }
                            }
                        }
                    }
                }
            });

            var keys = Object.keys(scheduleMap);
            keys.sort(function(a, b) {
                var aParts = a.split('_');
                var bParts = b.split('_');
                if (parseInt(aParts[0]) !== parseInt(bParts[0])) return parseInt(aParts[0]) - parseInt(bParts[0]);
                return parseInt(aParts[1]) - parseInt(bParts[1]);
            });

            html += '<div style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px;">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;">';
            html += '<div><strong style="color:var(--accent);">' + name + '</strong> <span style="color:var(--text-dim);font-size:0.7rem;">(' + status + ')</span>';
            html += ' <span style="color:var(--text-dim);font-size:0.7rem;">' + keys.length + ' classes</span>';
            html += '</div>';
            html += '</div>';

            if (keys.length === 0) {
                html += '<div style="color:var(--text-dim);font-size:0.75rem;padding:4px 0;">No classes scheduled for this week.</div>';
            } else {
                keys.forEach(function(key) {
                    var data = scheduleMap[key];
                    var hourDisplay = data.hour > 12 ? data.hour - 12 : data.hour;
                    var ampm = data.hour >= 12 ? 'PM' : 'AM';
                    if (data.hour === 0) { hourDisplay = 12; ampm = 'AM'; }
                    if (data.hour === 12) { ampm = 'PM'; }

                    html += '<div style="background:var(--bg);border-radius:4px;padding:6px 10px;margin-bottom:4px;border-left:3px solid var(--accent);">';
                    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">';
                    html += '<span style="font-weight:500;font-size:0.75rem;">' + dayNames[data.day] + ' at ' + hourDisplay + ':00 ' + ampm + '</span>';
                    html += '<span style="font-size:0.7rem;color:var(--text-dim);">' + data.discipline.name + ' (' + data.students.length + ' students)</span>';
                    html += '</div>';
                    html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">';
                    data.students.forEach(function(student) {
                        html += '<span style="background:var(--panel-alt);padding:2px 10px;border-radius:12px;font-size:0.65rem;">' + student.name + '</span>';
                    });
                    html += '</div>';
                    html += '</div>';
                });
            }

            html += '</div>';
        });

        html += '</div>';
        container.innerHTML = html;

        var prevBtn = container.querySelector('#prev-instructor-week');
        if (prevBtn) {
            prevBtn.addEventListener('click', function() {
                if (window.data.curriculum.currentWeek > 1) {
                    window.data.curriculum.currentWeek--;
                    renderInstructorCalendar(container);
                }
            });
        }
        var nextBtn = container.querySelector('#next-instructor-week');
        if (nextBtn) {
            nextBtn.addEventListener('click', function() {
                if (window.data.curriculum.currentWeek < 52) {
                    window.data.curriculum.currentWeek++;
                    renderInstructorCalendar(container);
                }
            });
        }
        var gotoBtn = container.querySelector('#goto-instructor-week');
        if (gotoBtn) {
            gotoBtn.addEventListener('click', function() {
                var week = prompt('Enter week number (1-52):', window.data.curriculum.currentWeek || 1);
                if (week) {
                    var w = parseInt(week);
                    if (!isNaN(w) && w >= 1 && w <= 52) {
                        window.data.curriculum.currentWeek = w;
                        renderInstructorCalendar(container);
                    } else {
                        alert('Please enter a valid week (1-52).');
                    }
                }
            });
        }
    }

    // ============================================================
    // STUDENT SCHEDULE RENDER - FULLY WORKING
    // ============================================================

    function renderStudentSchedule(container) {
        var students = window.getStudents();
        var week = window.data.curriculum.currentWeek || 1;

        var html = '';
        html += '<div class="page-header" style="margin-bottom:8px;">';
        html += '<h3 style="color:var(--accent);font-size:0.9rem;">Student Schedule - Week ' + week + '</h3>';
        html += '<div style="display:flex;gap:8px;">';
        html += '<button id="prev-schedule-week" class="small secondary">← Prev</button>';
        html += '<button id="next-schedule-week" class="small secondary">Next →</button>';
        html += '<button id="goto-schedule-week" class="small primary">Go</button>';
        html += '</div>';
        html += '</div>';

        if (students.length === 0) {
            html += '<p class="empty-state">No students found.</p>';
            container.innerHTML = html;
            return;
        }

        // Student selector
        html += '<div style="margin-bottom:12px;">';
        html += '<label style="font-size:0.75rem;color:var(--text-dim);">Select Student:</label>';
        html += '<select id="schedule-student-select" style="width:100%;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;margin-top:4px;">';
        html += '<option value="">Select a student...</option>';
        students.forEach(function(student) {
            var selected = (state.studentSchedule.selectedStudentId === student.id) ? 'selected' : '';
            html += '<option value="' + student.id + '" ' + selected + '>' + window.getDisplayName(student) + '</option>';
        });
        html += '</select>';
        html += '</div>';

        // Schedule display
        html += '<div id="schedule-display"><p class="empty-state">Select a student to view their schedule.</p></div>';

        container.innerHTML = html;

        var select = container.querySelector('#schedule-student-select');
        if (select) {
            select.addEventListener('change', function() {
                state.studentSchedule.selectedStudentId = this.value;
                renderScheduleDisplay(container);
            });
        }

        var prevBtn = container.querySelector('#prev-schedule-week');
        if (prevBtn) {
            prevBtn.addEventListener('click', function() {
                if (window.data.curriculum.currentWeek > 1) {
                    window.data.curriculum.currentWeek--;
                    renderScheduleDisplay(container);
                }
            });
        }
        var nextBtn = container.querySelector('#next-schedule-week');
        if (nextBtn) {
            nextBtn.addEventListener('click', function() {
                if (window.data.curriculum.currentWeek < 52) {
                    window.data.curriculum.currentWeek++;
                    renderScheduleDisplay(container);
                }
            });
        }
        var gotoBtn = container.querySelector('#goto-schedule-week');
        if (gotoBtn) {
            gotoBtn.addEventListener('click', function() {
                var week = prompt('Enter week number (1-52):', window.data.curriculum.currentWeek || 1);
                if (week) {
                    var w = parseInt(week);
                    if (!isNaN(w) && w >= 1 && w <= 52) {
                        window.data.curriculum.currentWeek = w;
                        renderScheduleDisplay(container);
                    } else {
                        alert('Please enter a valid week (1-52).');
                    }
                }
            });
        }

        // Initial render if a student was previously selected
        if (state.studentSchedule.selectedStudentId) {
            select.value = state.studentSchedule.selectedStudentId;
            renderScheduleDisplay(container);
        }
    }

    function renderScheduleDisplay(container) {
        var display = container.querySelector('#schedule-display');
        var select = container.querySelector('#schedule-student-select');
        if (!display || !select) return;

        var studentId = select.value;
        var week = window.data.curriculum.currentWeek || 1;

        if (!studentId) {
            display.innerHTML = '<p class="empty-state">Select a student to view their schedule.</p>';
            return;
        }

        var student = window.getCharacterById(studentId);
        if (!student) {
            display.innerHTML = '<p class="empty-state">Student not found.</p>';
            return;
        }

        var schedule = window.getStudentSchedule(studentId, week);
        var dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

        var hasClasses = false;
        var html = '<div style="margin-top:8px;"><div style="font-weight:600;color:var(--accent);">' + window.getDisplayName(student) + '</div>';
        html += '<div style="font-size:0.7rem;color:var(--text-dim);margin-bottom:8px;">Week ' + week + '</div>';
        html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">';

        for (var d = 1; d <= 7; d++) {
            html += '<div style="background:var(--bg);border:1px solid var(--border-soft);border-radius:4px;padding:4px;min-height:100px;">';
            html += '<div style="font-size:0.5rem;color:var(--text-dim);text-align:center;border-bottom:1px solid var(--border-soft);padding-bottom:2px;font-weight:600;">' + dayNames[d] + '</div>';
            var hasDayClass = false;
            if (schedule[d]) {
                var hours = Object.keys(schedule[d]).sort(function(a, b) { return parseInt(a) - parseInt(b); });
                hours.forEach(function(h) {
                    if (schedule[d][h]) {
                        hasDayClass = true;
                        hasClasses = true;
                        var disc = window.getDiscipline(schedule[d][h]);
                        var hourDisplay = parseInt(h) > 12 ? parseInt(h) - 12 : parseInt(h);
                        var ampm = parseInt(h) >= 12 ? 'PM' : 'AM';
                        if (parseInt(h) === 0) { hourDisplay = 12; ampm = 'AM'; }
                        if (parseInt(h) === 12) { ampm = 'PM'; }
                        var instructorId = window.getClassInstructor(studentId, week, d, parseInt(h));
                        var instructorName = '';
                        if (instructorId) {
                            var inst = window.getCharacterById(instructorId);
                            if (inst) instructorName = window.getDisplayName(inst);
                        }
                        html += '<div style="font-size:0.55rem;padding:2px 4px;background:var(--accent-soft);border-radius:3px;margin-top:2px;border-left:2px solid var(--accent);">';
                        html += (disc ? disc.name : 'Unknown') + ' (' + hourDisplay + ':00 ' + ampm + ')';
                        if (instructorName) html += ' <span style="color:var(--text-dim);font-size:0.45rem;">[' + instructorName + ']</span>';
                        html += '</div>';
                    }
                });
            }
            if (!hasDayClass) {
                html += '<div style="font-size:0.5rem;color:var(--text-dim);text-align:center;padding-top:8px;">—</div>';
            }
            html += '</div>';
        }

        html += '</div></div>';

        if (!hasClasses) {
            html = '<p class="empty-state">No classes scheduled for this student in week ' + week + '.</p>';
        }

        display.innerHTML = html;
    }

    // ============================================================
    // GRADES RENDER - FULLY WORKING
    // ============================================================

    function renderGrades(container) {
        var students = window.getStudents();
        var week = window.data.curriculum.currentWeek || 1;

        var html = '';
        html += '<div class="page-header" style="margin-bottom:8px;">';
        html += '<h3 style="color:var(--accent);font-size:0.9rem;">Grades - Week ' + week + '</h3>';
        html += '<div style="display:flex;gap:8px;">';
        html += '<button id="prev-grade-week" class="small secondary">← Prev</button>';
        html += '<button id="next-grade-week" class="small secondary">Next →</button>';
        html += '<button id="goto-grade-week" class="small primary">Go</button>';
        html += '</div>';
        html += '</div>';

        if (students.length === 0) {
            html += '<p class="empty-state">No students found.</p>';
            container.innerHTML = html;
            return;
        }

        html += '<div style="margin-bottom:12px;">';
        html += '<label style="font-size:0.75rem;color:var(--text-dim);">Select Student:</label>';
        html += '<select id="grades-student-select" style="width:100%;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;margin-top:4px;">';
        html += '<option value="">Select a student...</option>';
        students.forEach(function(student) {
            var selected = (state.selectedGradeStudentId === student.id) ? 'selected' : '';
            html += '<option value="' + student.id + '" ' + selected + '>' + window.getDisplayName(student) + '</option>';
        });
        html += '</select>';
        html += '</div>';

        html += '<div id="grades-display"><p class="empty-state">Select a student to view grades.</p></div>';

        container.innerHTML = html;

        var select = container.querySelector('#grades-student-select');
        if (select) {
            select.addEventListener('change', function() {
                state.selectedGradeStudentId = this.value;
                renderGradesDisplay(container);
            });
        }

        var prevBtn = container.querySelector('#prev-grade-week');
        if (prevBtn) {
            prevBtn.addEventListener('click', function() {
                if (window.data.curriculum.currentWeek > 1) {
                    window.data.curriculum.currentWeek--;
                    renderGradesDisplay(container);
                }
            });
        }
        var nextBtn = container.querySelector('#next-grade-week');
        if (nextBtn) {
            nextBtn.addEventListener('click', function() {
                if (window.data.curriculum.currentWeek < 52) {
                    window.data.curriculum.currentWeek++;
                    renderGradesDisplay(container);
                }
            });
        }
        var gotoBtn = container.querySelector('#goto-grade-week');
        if (gotoBtn) {
            gotoBtn.addEventListener('click', function() {
                var week = prompt('Enter week number (1-52):', window.data.curriculum.currentWeek || 1);
                if (week) {
                    var w = parseInt(week);
                    if (!isNaN(w) && w >= 1 && w <= 52) {
                        window.data.curriculum.currentWeek = w;
                        renderGradesDisplay(container);
                    } else {
                        alert('Please enter a valid week (1-52).');
                    }
                }
            });
        }

        if (state.selectedGradeStudentId) {
            select.value = state.selectedGradeStudentId;
            renderGradesDisplay(container);
        }
    }

    function renderGradesDisplay(container) {
        var display = container.querySelector('#grades-display');
        var select = container.querySelector('#grades-student-select');
        if (!display || !select) return;

        var studentId = select.value;
        var week = window.data.curriculum.currentWeek || 1;

        if (!studentId) {
            display.innerHTML = '<p class="empty-state">Select a student to view grades.</p>';
            return;
        }

        var student = window.getCharacterById(studentId);
        if (!student) {
            display.innerHTML = '<p class="empty-state">Student not found.</p>';
            return;
        }

        var grades = window.data.curriculum.grades || {};
        var studentGrades = grades[studentId] || {};
        var weekGrades = studentGrades[week] || {};

        var disciplines = window.getAvailableDisciplines(week);
        var hasGrades = false;

        var html = '<div style="margin-top:8px;"><div style="font-weight:600;color:var(--accent);">' + window.getDisplayName(student) + '</div>';
        html += '<div style="font-size:0.7rem;color:var(--text-dim);margin-bottom:8px;">Week ' + week + '</div>';

        if (disciplines.length === 0) {
            html += '<p class="empty-state">No disciplines available for week ' + week + '.</p>';
            display.innerHTML = html;
            return;
        }

        html += '<div style="overflow-x:auto;">';
        html += '<table style="width:100%;border-collapse:collapse;font-size:0.75rem;">';
        html += '<thead><tr style="background:var(--panel-alt);border-bottom:2px solid var(--border);">';
        html += '<th style="padding:6px 8px;text-align:left;">Discipline</th>';
        html += '<th style="padding:6px 8px;text-align:left;">Type</th>';
        html += '<th style="padding:6px 8px;text-align:left;">Score</th>';
        html += '<th style="padding:6px 8px;text-align:left;">Grade</th>';
        html += '</tr></thead><tbody>';

        var totalWeighted = 0;
        var totalWeight = 0;

        disciplines.forEach(function(d) {
            var score = weekGrades[d.id];
            var letter = '';
            var hasScore = (score !== undefined && score !== null && score !== '');
            
            if (hasScore) {
                hasGrades = true;
                if (d.gradingSystem && d.gradingSystem.length > 0) {
                    var sorted = d.gradingSystem.slice().sort(function(a, b) { return b.min - a.min; });
                    for (var i = 0; i < sorted.length; i++) {
                        if (score >= sorted[i].min && score <= sorted[i].max) {
                            letter = sorted[i].letter;
                            break;
                        }
                    }
                }
                if (d.weight) {
                    totalWeighted += score * d.weight;
                    totalWeight += d.weight;
                }
            }

            var typeLabel = d.type === 'mandatory' ? '■' : '□';
            var typeColor = d.type === 'mandatory' ? 'var(--accent)' : 'var(--warning)';

            html += '<tr style="border-bottom:1px solid var(--border-soft);' + (hasScore ? '' : 'opacity:0.5;') + '">';
            html += '<td style="padding:6px 8px;">' + d.name + '</td>';
            html += '<td style="padding:6px 8px;color:' + typeColor + ';font-size:0.65rem;">' + typeLabel + '</td>';
            html += '<td style="padding:6px 8px;font-weight:600;color:' + (hasScore ? 'var(--accent)' : 'var(--text-dim)') + ';">' + (hasScore ? score + '%' : '—') + '</td>';
            html += '<td style="padding:6px 8px;">' + (letter || '—') + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table></div>';

        // Show average
        var average = totalWeight > 0 ? (totalWeighted / totalWeight) : 0;
        if (hasGrades) {
            html += '<div style="margin-top:12px;padding:8px 12px;background:var(--bg);border-radius:4px;border:1px solid var(--border-soft);">';
            html += '<span style="color:var(--text-dim);font-size:0.75rem;">Weighted Average: </span>';
            html += '<span style="font-weight:700;font-size:1rem;color:' + (average >= 70 ? 'var(--accent)' : 'var(--danger)') + ';">' + average.toFixed(1) + '%</span>';
            html += '</div>';
        }

        html += '</div>';

        if (!hasGrades) {
            html = '<p class="empty-state">No grades recorded for this student in week ' + week + '.</p>';
        }

        display.innerHTML = html;
    }

    // ============================================================
    // RANKING RENDER
    // ============================================================

    function renderRanking(container) {
        var students = window.getStudents();
        var week = window.data.curriculum.currentWeek || 1;

        var html = '';
        html += '<div class="page-header" style="margin-bottom:8px;">';
        html += '<h3 style="color:var(--accent);font-size:0.9rem;">Ranking - Week ' + week + '</h3>';
        html += '<div style="display:flex;gap:8px;">';
        html += '<button id="prev-rank-week" class="small secondary">← Prev</button>';
        html += '<button id="next-rank-week" class="small secondary">Next →</button>';
        html += '<button id="goto-rank-week" class="small primary">Go</button>';
        html += '</div>';
        html += '</div>';

        if (students.length === 0) {
            html += '<p class="empty-state">No students found.</p>';
            container.innerHTML = html;
            return;
        }

        var grades = window.data.curriculum.grades || {};
        var disciplines = window.getAvailableDisciplines(week);
        var rankData = [];

        students.forEach(function(student) {
            var studentGrades = grades[student.id] || {};
            var weekGrades = studentGrades[week] || {};
            var totalWeighted = 0;
            var totalWeight = 0;

            disciplines.forEach(function(d) {
                var score = weekGrades[d.id];
                if (score !== undefined && score !== null && score !== '' && d.weight) {
                    totalWeighted += score * d.weight;
                    totalWeight += d.weight;
                }
            });

            var average = totalWeight > 0 ? totalWeighted / totalWeight : 0;
            rankData.push({
                studentId: student.id,
                name: window.getDisplayName(student),
                average: average,
                hasGrades: totalWeight > 0
            });
        });

        rankData.sort(function(a, b) { 
            if (a.hasGrades && !b.hasGrades) return -1;
            if (!a.hasGrades && b.hasGrades) return 1;
            return b.average - a.average; 
        });
        rankData.forEach(function(r, index) {
            r.rank = index + 1;
        });

        html += '<div style="overflow-x:auto;">';
        html += '<table style="width:100%;border-collapse:collapse;font-size:0.75rem;">';
        html += '<thead><tr style="background:var(--panel-alt);border-bottom:2px solid var(--border);">';
        html += '<th style="padding:6px 8px;text-align:left;">Rank</th>';
        html += '<th style="padding:6px 8px;text-align:left;">Student</th>';
        html += '<th style="padding:6px 8px;text-align:left;">Average</th>';
        html += '</tr></thead><tbody>';

        var hasAnyGrades = rankData.some(function(r) { return r.hasGrades; });

        rankData.forEach(function(r) {
            var avgDisplay = r.hasGrades ? r.average.toFixed(1) + '%' : '—';
            var isTop = r.rank === 1 && r.hasGrades;
            var color = isTop ? 'var(--accent)' : (r.hasGrades ? 'var(--text)' : 'var(--text-dim)');
            var bg = isTop ? 'background:var(--accent-soft);' : '';
            
            html += '<tr style="border-bottom:1px solid var(--border-soft);' + bg + '">';
            html += '<td style="padding:6px 8px;font-weight:700;color:' + color + ';">#' + r.rank + '</td>';
            html += '<td style="padding:6px 8px;">' + r.name + '</td>';
            html += '<td style="padding:6px 8px;font-weight:600;color:' + color + ';">' + avgDisplay + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table></div>';

        if (!hasAnyGrades) {
            html = '<p class="empty-state">No grades recorded for week ' + week + '. Rankings require grades.</p>';
        }

        container.innerHTML = html;

        var prevBtn = container.querySelector('#prev-rank-week');
        if (prevBtn) {
            prevBtn.addEventListener('click', function() {
                if (window.data.curriculum.currentWeek > 1) {
                    window.data.curriculum.currentWeek--;
                    renderRanking(container);
                }
            });
        }
        var nextBtn = container.querySelector('#next-rank-week');
        if (nextBtn) {
            nextBtn.addEventListener('click', function() {
                if (window.data.curriculum.currentWeek < 52) {
                    window.data.curriculum.currentWeek++;
                    renderRanking(container);
                }
            });
        }
        var gotoBtn = container.querySelector('#goto-rank-week');
        if (gotoBtn) {
            gotoBtn.addEventListener('click', function() {
                var week = prompt('Enter week number (1-52):', window.data.curriculum.currentWeek || 1);
                if (week) {
                    var w = parseInt(week);
                    if (!isNaN(w) && w >= 1 && w <= 52) {
                        window.data.curriculum.currentWeek = w;
                        renderRanking(container);
                    } else {
                        alert('Please enter a valid week (1-52).');
                    }
                }
            });
        }
    }

    // ============================================================
    // CLASSES RENDER - FIXED
    // ============================================================

    function renderClasses(container) {
        var classes = window.getClasses() || [];

        var html = '';
        html += '<div class="page-header" style="margin-bottom:8px;">';
        html += '<h3 style="color:var(--accent);font-size:0.9rem;">Academic Classes</h3>';
        html += '<button id="add-class-btn" class="primary small">+ New Class</button>';
        html += '</div>';

        if (classes.length === 0) {
            html += '<p class="empty-state">No classes created yet. Create your first class!</p>';
            container.innerHTML = html;
            return;
        }

        html += '<div style="display:flex;flex-direction:column;gap:8px;">';
        classes.forEach(function(cls) {
            var studentCount = window.getCharactersByClass(cls.id).length;
            var teamCount = window.getTeamsByClass(cls.id).length;

            html += '<div style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:10px 14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">';
            html += '<div><strong style="color:var(--accent);">' + cls.name + '</strong>';
            html += ' <span style="color:var(--text-dim);font-size:0.7rem;">' + studentCount + ' students, ' + teamCount + ' teams</span>';
            html += '</div>';
            html += '<div style="display:flex;gap:4px;">';
            html += '<button class="small view-class" data-id="' + cls.id + '" style="padding:2px 8px;font-size:0.65rem;">View</button>';
            html += '<button class="small danger delete-class" data-id="' + cls.id + '" style="padding:2px 8px;font-size:0.65rem;">Delete</button>';
            html += '</div>';
            html += '</div>';
        });
        html += '</div>';

        container.innerHTML = html;

        container.querySelectorAll('.view-class').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var id = this.dataset.id;
                var cls = window.getClass(id);
                if (!cls) return;
                var students = window.getCharactersByClass(id);
                var teams = window.getTeamsByClass(id);

                var msg = 'Class: ' + cls.name + '\n\n';
                msg += 'Students (' + students.length + '):\n';
                if (students.length > 0) {
                    students.forEach(function(s) {
                        msg += '  • ' + window.getDisplayName(s) + '\n';
                    });
                } else {
                    msg += '  None\n';
                }
                msg += '\nAcademic Teams (' + teams.length + '):\n';
                if (teams.length > 0) {
                    teams.forEach(function(t) {
                        msg += '  • ' + t.name + '\n';
                    });
                } else {
                    msg += '  None\n';
                }
                alert(msg);
            });
        });

        container.querySelectorAll('.delete-class').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var id = this.dataset.id;
                if (confirm('Delete this class permanently?')) {
                    var result = window.deleteClass(id);
                    if (result.success) {
                        renderClasses(container);
                        if (typeof window.updateDashboardStats === 'function') {
                            window.updateDashboardStats();
                        }
                    } else {
                        alert(result.message);
                    }
                }
            });
        });

        var addBtn = container.querySelector('#add-class-btn');
        if (addBtn) {
            // Remove existing listener by cloning
            var newAddBtn = addBtn.cloneNode(true);
            addBtn.parentNode.replaceChild(newAddBtn, addBtn);
            newAddBtn.addEventListener('click', function() {
                var name = prompt('Enter class name (e.g., Spring 1435, March 1436):');
                if (!name) return;
                var result = window.createClass(name);
                if (result && result.success) {
                    renderClasses(container);
                    if (typeof window.updateDashboardStats === 'function') {
                        window.updateDashboardStats();
                    }
                } else {
                    alert(result ? result.message : 'Failed to create class.');
                }
            });
        }
    }

    // ============================================================
    // INIT EVENTS
    // ============================================================

    function initCurriculumEvents(container) {
        var tabNav = container.querySelector('.tab-nav');
        if (tabNav) {
            tabNav.addEventListener('click', function(e) {
                var btn = e.target.closest('.tab-btn');
                if (!btn) return;
                var tab = btn.dataset.tab;
                renderTabContent(tab, container);
            });
        }

        var weekDisplay = container.querySelector('#curriculum-current-week');
        if (weekDisplay) {
            weekDisplay.addEventListener('click', function() {
                var current = parseInt(this.textContent) || 1;
                var newWeek = prompt('Enter week number (1-52):', current);
                if (newWeek) {
                    var w = parseInt(newWeek);
                    if (!isNaN(w) && w >= 1 && w <= 52) {
                        if (window.data.curriculum) {
                            window.data.curriculum.currentWeek = w;
                            this.textContent = w;
                            renderTabContent(currentTab, container);
                        }
                    } else {
                        alert('Please enter a valid week (1-52).');
                    }
                }
            });
        }
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

    window.renderCurriculum = renderCurriculum;
    window.curriculumState = state;

})();
