/**
 * calendar/calendar-ui.js - Unified Calendar UI Controller
 * Event wiring, modal management, user interactions for all calendar views
 * Path: js/calendar/calendar-ui.js
 * 
 * This module handles:
 *   - Calendar view switching (student/instructor/location)
 *   - Week navigation (prev/next/goto)
 *   - Slot interaction (click, right-click)
 *   - Modal management (add/remove classes, templates, blocks)
 *   - Persistence coordination
 *   - State management for calendar UI
 * 
 * IMPORTANT:
 *   - All mutations go through CalendarCore
 *   - All persistence goes through saveData()
 *   - UI state is managed in this module (not persisted)
 *   - Event listeners are attached via delegation
 * 
 * LIFECYCLE:
 *   - init() creates the UI container and attaches events
 *   - render() updates the current view
 *   - destroy() cleans up event listeners
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__calendarUILoaded) {
        return;
    }
    window.__calendarUILoaded = true;

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    if (!window.CalendarGrid) {
        console.error('CalendarUI: CalendarGrid required.');
        return;
    }

    if (!window.CalendarViews) {
        console.error('CalendarUI: CalendarViews required.');
        return;
    }

    if (!window.CalendarCore) {
        console.error('CalendarUI: CalendarCore required.');
        return;
    }

    if (typeof window.saveData !== 'function') {
        console.error('CalendarUI: saveData() required.');
        return;
    }

    // ============================================================
    // STATE
    // ============================================================

    var state = {
        mode: 'student', // 'student' | 'instructor' | 'location'
        week: 1,
        selectedId: null, // studentId | instructorId | locationId
        expandedGroups: {}
    };

    var _initialized = false;
    var _container = null;

    // ============================================================
    // NOTIFICATION
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';

        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }

        if (typeof window.notify === 'function') {
            window.notify(message, type);
            return;
        }

        console.log('[' + type + ']', message);
    }

    function showConfirmation(message) {
        if (typeof window.showConfirm === 'function') {
            return window.showConfirm(message);
        }
        if (typeof window.confirmModal === 'function') {
            return window.confirmModal(message);
        }
        return confirm(message);
    }

    // ============================================================
    // PERSISTENCE
    // ============================================================

    function persistChange(operation, successMessage, errorMessage, callback) {
        try {
            var result = operation();

            if (!result || !result.success) {
                showNotification(result && result.message ? result.message : 'Operation failed.', 'error');
                return false;
            }

            if (typeof window.saveData === 'function') {
                window.saveData()
                    .then(function() {
                        if (callback) callback();
                        if (successMessage) showNotification(successMessage, 'success');
                    })
                    .catch(function(err) {
                        console.error('Failed to persist calendar change:', err);
                        if (errorMessage) showNotification(errorMessage, 'error');
                    });
            } else {
                if (callback) callback();
                if (successMessage) showNotification(successMessage, 'success');
            }

            return true;
        } catch (err) {
            console.error('Calendar operation error:', err);
            showNotification('Operation failed: ' + err.message, 'error');
            return false;
        }
    }

    // ============================================================
    // INIT
    // ============================================================

    function init(container, options) {
        options = options || {};

        if (_initialized) {
            render();
            return;
        }

        if (!container) {
            container = document.getElementById('calendar-content');
        }

        if (!container) {
            console.error('CalendarUI: No container provided.');
            return;
        }

        _container = container;
        _initialized = true;

        // Set initial state from options
        if (options.mode) state.mode = options.mode;
        if (options.week) state.week = parseInt(options.week) || 1;
        if (options.selectedId) state.selectedId = options.selectedId;

        // Build UI
        container.innerHTML = getCalendarHTML();

        // Attach events
        attachEvents(container);

        // Render initial view
        render();

        return container;
    }

    // ============================================================
    // DESTROY
    // ============================================================

    function destroy() {
        if (_container) {
            _container.innerHTML = '';
        }
        _initialized = false;
        _container = null;
    }

    // ============================================================
    // HTML
    // ============================================================

    function getCalendarHTML() {
        return `
            <div class="page-header">
                <h2 id="calendar-title">Calendar</h2>
                <div class="header-actions">
                    <button id="calendar-mode-student" class="small secondary">Student</button>
                    <button id="calendar-mode-instructor" class="small secondary">Instructor</button>
                    <button id="calendar-mode-location" class="small secondary">Location</button>
                    <button id="calendar-add-btn" class="primary small">+ Add</button>
                </div>
            </div>
            <div class="calendar-controls">
                <div class="selector-group">
                    <label id="calendar-selector-label">Select:</label>
                    <select id="calendar-selector">
                        <option value="">Select...</option>
                    </select>
                </div>
                <div class="week-nav">
                    <button id="calendar-prev-week" class="small">← Prev</button>
                    <span id="calendar-week-display" style="font-weight:600;min-width:80px;text-align:center;">Week 1</span>
                    <button id="calendar-next-week" class="small">Next →</button>
                    <button id="calendar-goto-week" class="small primary">Go to</button>
                </div>
            </div>
            <div id="calendar-view-container">
                <p class="empty-state">Select an item to view its calendar</p>
            </div>
        `;
    }

    // ============================================================
    // RENDER
    // ============================================================

    function render() {
        if (!_container) return;

        var viewContainer = _container.querySelector('#calendar-view-container');
        if (!viewContainer) return;

        // Update title
        var title = _container.querySelector('#calendar-title');
        if (title) {
            var modeLabels = {
                'student': 'Student Schedule',
                'instructor': 'Instructor Calendar',
                'location': 'Location Schedule'
            };
            title.textContent = modeLabels[state.mode] || 'Calendar';
        }

        // Update week display
        var weekDisplay = _container.querySelector('#calendar-week-display');
        if (weekDisplay) {
            weekDisplay.textContent = 'Week ' + state.week;
        }

        // Update mode buttons
        var modeBtns = {
            student: _container.querySelector('#calendar-mode-student'),
            instructor: _container.querySelector('#calendar-mode-instructor'),
            location: _container.querySelector('#calendar-mode-location')
        };

        for (var key in modeBtns) {
            if (modeBtns[key]) {
                modeBtns[key].classList.toggle('active', key === state.mode);
            }
        }

        // Populate selector
        populateSelector();

        // Render view
        if (!state.selectedId) {
            viewContainer.innerHTML = '<p class="empty-state">Select an item to view its calendar</p>';
            return;
        }

        viewContainer.innerHTML = '';

        try {
            switch (state.mode) {
                case 'student':
                    window.CalendarViews.renderStudentView(viewContainer, state.selectedId, state.week);
                    break;
                case 'instructor':
                    window.CalendarViews.renderInstructorView(viewContainer, state.selectedId, state.week);
                    break;
                case 'location':
                    window.CalendarViews.renderLocationView(viewContainer, state.selectedId, state.week);
                    break;
                default:
                    viewContainer.innerHTML = '<p class="empty-state">Unknown view mode</p>';
            }
        } catch (err) {
            console.error('Error rendering calendar view:', err);
            viewContainer.innerHTML = '<p class="empty-state">Error loading calendar view</p>';
        }

        // Update selector to match state
        var selector = _container.querySelector('#calendar-selector');
        if (selector && state.selectedId) {
            selector.value = state.selectedId;
        }
    }

    // ============================================================
    // SELECTOR POPULATION
    // ============================================================

    function populateSelector() {
        var selector = _container ? _container.querySelector('#calendar-selector') : null;
        if (!selector) return;

        var currentValue = selector.value;
        var options = [];

        switch (state.mode) {
            case 'student':
                options = getStudentOptions();
                break;
            case 'instructor':
                options = getInstructorOptions();
                break;
            case 'location':
                options = getLocationOptions();
                break;
        }

        selector.innerHTML = '<option value="">Select...</option>';
        options.forEach(function(opt) {
            var option = document.createElement('option');
            option.value = opt.id;
            option.textContent = opt.label;
            selector.appendChild(option);
        });

        // Restore selection if still valid
        if (currentValue) {
            var exists = false;
            for (var i = 0; i < selector.options.length; i++) {
                if (selector.options[i].value === currentValue) {
                    exists = true;
                    break;
                }
            }
            if (exists) {
                selector.value = currentValue;
            } else if (options.length > 0) {
                selector.value = options[0].id;
                state.selectedId = options[0].id;
            } else {
                state.selectedId = null;
            }
        } else if (options.length > 0) {
            selector.value = options[0].id;
            state.selectedId = options[0].id;
        } else {
            state.selectedId = null;
        }
    }

    function getStudentOptions() {
        var students = getStudents();
        return students.map(function(s) {
            return {
                id: s.id,
                label: getDisplayName(s)
            };
        }).sort(function(a, b) {
            return a.label.localeCompare(b.label);
        });
    }

    function getInstructorOptions() {
        var instructors = getInstructors();
        return instructors.map(function(i) {
            return {
                id: i.id,
                label: getDisplayName(i)
            };
        }).sort(function(a, b) {
            return a.label.localeCompare(b.label);
        });
    }

    function getLocationOptions() {
        var locations = getLocations();
        return locations.map(function(l) {
            var typeLabel = getLocationTypeLabel(l.type);
            return {
                id: l.id,
                label: l.name + ' (' + typeLabel + ')'
            };
        }).sort(function(a, b) {
            return a.label.localeCompare(b.label);
        });
    }

    // ============================================================
    // EVENTS
    // ============================================================

    function attachEvents(container) {
        // Mode switching
        var modeStudent = container.querySelector('#calendar-mode-student');
        var modeInstructor = container.querySelector('#calendar-mode-instructor');
        var modeLocation = container.querySelector('#calendar-mode-location');

        if (modeStudent) {
            modeStudent.addEventListener('click', function() {
                switchMode('student');
            });
        }

        if (modeInstructor) {
            modeInstructor.addEventListener('click', function() {
                switchMode('instructor');
            });
        }

        if (modeLocation) {
            modeLocation.addEventListener('click', function() {
                switchMode('location');
            });
        }

        // Selector
        var selector = container.querySelector('#calendar-selector');
        if (selector) {
            selector.addEventListener('change', function() {
                state.selectedId = this.value || null;
                render();
            });
        }

        // Week navigation
        var prevWeek = container.querySelector('#calendar-prev-week');
        if (prevWeek) {
            prevWeek.addEventListener('click', function() {
                if (state.week > 1) {
                    state.week--;
                    render();
                }
            });
        }

        var nextWeek = container.querySelector('#calendar-next-week');
        if (nextWeek) {
            nextWeek.addEventListener('click', function() {
                if (state.week < 52) {
                    state.week++;
                    render();
                }
            });
        }

        var gotoWeek = container.querySelector('#calendar-goto-week');
        if (gotoWeek) {
            gotoWeek.addEventListener('click', function() {
                var week = prompt('Enter week number (1-52):', state.week);
                if (week) {
                    var w = parseInt(week);
                    if (!isNaN(w) && w >= 1 && w <= 52) {
                        state.week = w;
                        render();
                    } else {
                        showNotification('Please enter a valid week (1-52).', 'error');
                    }
                }
            });
        }

        // Add button
        var addBtn = container.querySelector('#calendar-add-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() {
                showAddModal();
            });
        }

        // Event delegation for slot clicks (inside view container)
        var viewContainer = container.querySelector('#calendar-view-container');
        if (viewContainer) {
            viewContainer.addEventListener('click', function(e) {
                handleSlotClick(e);
            });

            viewContainer.addEventListener('contextmenu', function(e) {
                handleSlotRightClick(e);
            });
        }

        // Rest days save (delegated)
        container.addEventListener('click', function(e) {
            var target = e.target;
            if (target.id === 'save-rest-days-btn') {
                handleSaveRestDays();
            }
        });
    }

    // ============================================================
    // MODE SWITCHING
    // ============================================================

    function switchMode(mode) {
        if (mode === state.mode) return;

        state.mode = mode;
        state.selectedId = null;

        var selector = _container ? _container.querySelector('#calendar-selector') : null;
        if (selector) selector.value = '';

        render();
    }

    // ============================================================
    // SLOT INTERACTIONS
    // ============================================================

    function handleSlotClick(e) {
        var slot = e.target.closest('.time-slot');
        if (!slot) return;

        var day = parseInt(slot.dataset.day, 10);
        var hour = parseInt(slot.dataset.hour, 10);

        if (isNaN(day) || isNaN(hour)) return;

        var isOccupied = slot.classList.contains('occupied');
        var isBlocked = slot.classList.contains('blocked');
        var isEmpty = slot.classList.contains('empty');

        if (isEmpty) {
            showAddModal(day, hour);
        } else if (isBlocked) {
            showBlockDetailModal(day, hour);
        } else if (isOccupied) {
            showSlotDetailModal(day, hour);
        }
    }

    function handleSlotRightClick(e) {
        e.preventDefault();
        var slot = e.target.closest('.time-slot');
        if (!slot) return;

        var day = parseInt(slot.dataset.day, 10);
        var hour = parseInt(slot.dataset.hour, 10);

        if (isNaN(day) || isNaN(hour)) return;

        var isOccupied = slot.classList.contains('occupied');
        var isBlocked = slot.classList.contains('blocked');

        if (isBlocked) {
            if (showConfirmation('Remove this blocked time?')) {
                removeBlockedTime(day, hour);
            }
        } else if (isOccupied) {
            if (showConfirmation('Remove this class?')) {
                removeClass(day, hour);
            }
        }
    }

    // ============================================================
    // ADD MODAL
    // ============================================================

    function showAddModal(day, hour) {
        if (!state.selectedId) {
            showNotification('Please select an item first.', 'warning');
            return;
        }

        switch (state.mode) {
            case 'student':
                showAddStudentClassModal(day, hour);
                break;
            case 'instructor':
                showAddInstructorSlotModal(day, hour);
                break;
            case 'location':
                showAddLocationClassModal(day, hour);
                break;
        }
    }

    function showAddStudentClassModal(day, hour) {
        var studentId = state.selectedId;
        var week = state.week;
        var student = getCharacterById(studentId);
        if (!student) {
            showNotification('Student not found.', 'error');
            return;
        }

        var disciplines = getAvailableDisciplinesForStudent(studentId, week);
        if (!disciplines || disciplines.length === 0) {
            showNotification('No available disciplines for this student.', 'warning');
            return;
        }

        var hourDisplay = formatHourShort(hour);
        var dayName = getDayName(day);

        var modal = createModal('Add Class - ' + dayName + ' at ' + hourDisplay, function(modal) {
            modal.innerHTML = `
                <div class="form-group">
                    <label>Discipline:</label>
                    <select id="add-class-discipline" style="width:100%;padding:8px;margin-top:4px;">
                        ${disciplines.map(function(item) {
                            var d = item.discipline;
                            var instructorDisplay = item.instructorNames.length > 0
                                ? item.instructorNames.join(', ')
                                : 'No instructors';
                            return '<option value="' + escapeHtml(d.id) + '">' +
                                escapeHtml(d.name) + ' (' + escapeHtml(instructorDisplay) + ')' +
                                ' - ' + item.used + '/' + item.maxHours + 'h' +
                            '</option>';
                        }).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Duration (hours):</label>
                    <select id="add-class-duration" style="width:100%;padding:8px;margin-top:4px;">
                        <option value="1">1 hour</option>
                        <option value="2">2 hours</option>
                        <option value="3">3 hours</option>
                        <option value="4">4 hours</option>
                    </select>
                </div>
                <div class="form-actions" style="margin-top:16px;">
                    <button type="button" id="cancel-add" class="secondary">Cancel</button>
                    <button type="button" id="confirm-add" class="primary">Add Class</button>
                </div>
            `;

            modal.querySelector('#confirm-add').addEventListener('click', function() {
                var disciplineId = document.getElementById('add-class-discipline').value;
                var duration = parseInt(document.getElementById('add-class-duration').value) || 1;

                if (!disciplineId) {
                    showNotification('Please select a discipline.', 'error');
                    return;
                }

                var instructorId = null;
                var discipline = getDiscipline(disciplineId);
                if (discipline && discipline.instructorIds && discipline.instructorIds.length > 0) {
                    instructorId = discipline.instructorIds[0];
                }

                var result = CalendarCore.setStudentScheduleClass(
                    studentId, week, day, hour, disciplineId, duration, instructorId
                );

                if (result && result.success) {
                    closeModal(modal);
                    persistChange(
                        function() { return { success: true }; },
                        'Class added successfully!',
                        'Class added in memory, but persistence failed.',
                        function() { render(); }
                    );
                } else {
                    showNotification(result ? result.message : 'Failed to add class.', 'error');
                }
            });

            modal.querySelector('#cancel-add').addEventListener('click', function() {
                closeModal(modal);
            });
        });

        showModal(modal);
    }

    function showAddInstructorSlotModal(day, hour) {
        var instructorId = state.selectedId;
        var week = state.week;
        var instructor = getCharacterById(instructorId);
        if (!instructor) {
            showNotification('Instructor not found.', 'error');
            return;
        }

        var disciplines = getAvailableDisciplinesForInstructor(instructorId, week);
        if (!disciplines || disciplines.length === 0) {
            showNotification('No disciplines available for this instructor.', 'warning');
            return;
        }

        var hourDisplay = formatHourShort(hour);
        var dayName = getDayName(day);

        var modal = createModal('Add Class - ' + dayName + ' at ' + hourDisplay, function(modal) {
            modal.innerHTML = `
                <div class="form-group">
                    <label>Discipline:</label>
                    <select id="add-instructor-discipline" style="width:100%;padding:8px;margin-top:4px;">
                        ${disciplines.map(function(d) {
                            return '<option value="' + escapeHtml(d.id) + '">' +
                                escapeHtml(d.name) +
                            '</option>';
                        }).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Label (optional):</label>
                    <input type="text" id="add-instructor-label" placeholder="e.g., A, B, Group 1..." style="width:100%;padding:8px;margin-top:4px;">
                </div>
                <div class="form-group">
                    <label>Group Label (optional):</label>
                    <input type="text" id="add-instructor-group" placeholder="e.g., 1, 2, 3..." style="width:100%;padding:8px;margin-top:4px;">
                </div>
                <div class="form-group">
                    <label>Duration (hours):</label>
                    <select id="add-instructor-duration" style="width:100%;padding:8px;margin-top:4px;">
                        <option value="1">1 hour</option>
                        <option value="2">2 hours</option>
                        <option value="3">3 hours</option>
                        <option value="4">4 hours</option>
                    </select>
                </div>
                <div style="margin-top:8px;padding:8px;background:var(--warning-soft);border-radius:4px;font-size:0.75rem;color:var(--text-dim);">
                    ⚠ This creates a template class. Students must be assigned manually.
                </div>
                <div class="form-actions" style="margin-top:16px;">
                    <button type="button" id="cancel-add" class="secondary">Cancel</button>
                    <button type="button" id="confirm-add" class="primary">Add Template</button>
                </div>
            `;

            modal.querySelector('#confirm-add').addEventListener('click', function() {
                var disciplineId = document.getElementById('add-instructor-discipline').value;
                var duration = parseInt(document.getElementById('add-instructor-duration').value) || 1;
                var label = document.getElementById('add-instructor-label').value.trim();
                var groupLabel = document.getElementById('add-instructor-group').value.trim();

                if (!disciplineId) {
                    showNotification('Please select a discipline.', 'error');
                    return;
                }

                var result = CalendarCore.setInstructorTemplate(
                    instructorId, week, day, hour, {
                        disciplineId: disciplineId,
                        label: label,
                        groupLabel: groupLabel,
                        duration: duration,
                        assignedStudents: []
                    }
                );

                if (result && result.success) {
                    closeModal(modal);
                    persistChange(
                        function() { return { success: true }; },
                        'Template class added!',
                        'Template added in memory, but persistence failed.',
                        function() { render(); }
                    );
                } else {
                    showNotification(result ? result.message : 'Failed to add template.', 'error');
                }
            });

            modal.querySelector('#cancel-add').addEventListener('click', function() {
                closeModal(modal);
            });
        });

        showModal(modal);
    }

    function showAddLocationClassModal(day, hour) {
        var locationId = state.selectedId;
        var week = state.week;
        var location = getLocation(locationId);
        if (!location) {
            showNotification('Location not found.', 'error');
            return;
        }

        var disciplines = getAvailableDisciplines(week);
        if (!disciplines || disciplines.length === 0) {
            showNotification('No disciplines available for this week.', 'warning');
            return;
        }

        var hourDisplay = formatHourShort(hour);
        var dayName = getDayName(day);

        // Check if location already has a class at this time
        var currentSchedule = getLocationSchedule(locationId, week);
        var existingDisciplineId = currentSchedule && currentSchedule[day] ? currentSchedule[day][hour] : null;
        var existingDiscipline = existingDisciplineId ? getDiscipline(existingDisciplineId) : null;

        var modal = createModal(
            (existingDiscipline ? 'Change' : 'Assign') + ' Class - ' + dayName + ' at ' + hourDisplay,
            function(modal) {
                modal.innerHTML = `
                    <div class="form-group">
                        <label>Discipline:</label>
                        <select id="add-location-discipline" style="width:100%;padding:8px;margin-top:4px;">
                            <option value="">— None —</option>
                            ${disciplines.map(function(d) {
                                var selected = (existingDisciplineId && String(d.id) === String(existingDisciplineId)) ? 'selected' : '';
                                return '<option value="' + escapeHtml(d.id) + '" ' + selected + '>' +
                                    escapeHtml(d.name) +
                                '</option>';
                            }).join('')}
                        </select>
                    </div>
                    ${existingDiscipline ? '<div style="padding:8px;background:var(--warning-soft);border-radius:4px;font-size:0.75rem;color:var(--text-dim);margin-bottom:8px;">Currently: <strong>' + escapeHtml(existingDiscipline.name) + '</strong></div>' : ''}
                    <div class="form-actions" style="margin-top:16px;">
                        <button type="button" id="cancel-add" class="secondary">Cancel</button>
                        <button type="button" id="confirm-add" class="primary">${existingDiscipline ? 'Update' : 'Assign'}</button>
                    </div>
                `;

                modal.querySelector('#confirm-add').addEventListener('click', function() {
                    var disciplineId = document.getElementById('add-location-discipline').value;

                    if (!disciplineId) {
                        // Remove existing class
                        if (existingDisciplineId) {
                            var result = CalendarCore.removeLocationClass(locationId, week, day, hour);
                            if (result && result.success) {
                                closeModal(modal);
                                persistChange(
                                    function() { return { success: true }; },
                                    'Class removed from location!',
                                    'Class removed in memory, but persistence failed.',
                                    function() { render(); }
                                );
                            } else {
                                showNotification(result ? result.message : 'Failed to remove class.', 'error');
                            }
                        } else {
                            showNotification('Please select a discipline or cancel.', 'warning');
                        }
                        return;
                    }

                    var result = CalendarCore.setLocationClass(locationId, week, day, hour, disciplineId);

                    if (result && result.success) {
                        closeModal(modal);
                        persistChange(
                            function() { return { success: true }; },
                            'Class assigned to location!',
                            'Class assigned in memory, but persistence failed.',
                            function() { render(); }
                        );
                    } else {
                        showNotification(result ? result.message : 'Failed to assign class.', 'error');
                    }
                });

                modal.querySelector('#cancel-add').addEventListener('click', function() {
                    closeModal(modal);
                });
            }
        );

        showModal(modal);
    }

    // ============================================================
    // SLOT DETAIL MODAL
    // ============================================================

    function showSlotDetailModal(day, hour) {
        switch (state.mode) {
            case 'student':
                showStudentClassDetail(day, hour);
                break;
            case 'instructor':
                showInstructorClassDetail(day, hour);
                break;
            case 'location':
                showLocationClassDetail(day, hour);
                break;
        }
    }

    function showStudentClassDetail(day, hour) {
        var studentId = state.selectedId;
        var week = state.week;
        var student = getCharacterById(studentId);
        if (!student) return;

        var schedule = getStudentSchedule(studentId, week);
        if (!schedule || !schedule[day] || !schedule[day][hour]) {
            showNotification('No class at this time.', 'warning');
            return;
        }

        var disciplineId = schedule[day][hour];
        var discipline = getDiscipline(disciplineId);
        if (!discipline) {
            showNotification('Discipline not found.', 'error');
            return;
        }

        var instructorId = getClassInstructor(studentId, week, day, hour);
        var instructorName = '';
        if (instructorId) {
            var instructor = getCharacterById(instructorId);
            if (instructor) instructorName = getDisplayName(instructor);
        }

        var duration = getClassDuration(studentId, week, day, hour) || 1;
        var label = getClassLabel(studentId, week, day, hour);
        var groupLabel = getClassGroupLabel(studentId, week, day, hour);

        var hourDisplay = formatHourShort(hour);
        var dayName = getDayName(day);

        var modal = createModal(discipline.name + ' - ' + dayName + ' at ' + hourDisplay, function(modal) {
            modal.innerHTML = `
                <div class="detail-row"><span class="label">Discipline:</span> <span><strong>${escapeHtml(discipline.name)}</strong></span></div>
                <div class="detail-row"><span class="label">Instructor:</span> <span>${escapeHtml(instructorName || 'Not assigned')}</span></div>
                <div class="detail-row"><span class="label">Duration:</span> <span>${duration} hour${duration > 1 ? 's' : ''}</span></div>
                ${label ? '<div class="detail-row"><span class="label">Label:</span> <span>' + escapeHtml(label) + '</span></div>' : ''}
                ${groupLabel ? '<div class="detail-row"><span class="label">Group:</span> <span>' + escapeHtml(groupLabel) + '</span></div>' : ''}
                <div class="detail-row"><span class="label">Week:</span> <span>${week}</span></div>
                <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
                    <button type="button" id="remove-class" class="danger small">✕ Remove</button>
                    <button type="button" id="close-detail" class="secondary small">Close</button>
                </div>
            `;

            modal.querySelector('#remove-class').addEventListener('click', function() {
                if (showConfirmation('Remove this class from the schedule?')) {
                    var result = CalendarCore.removeStudentScheduleClass(studentId, week, day, hour);
                    if (result && result.success) {
                        closeModal(modal);
                        persistChange(
                            function() { return { success: true }; },
                            'Class removed!',
                            'Class removed in memory, but persistence failed.',
                            function() { render(); }
                        );
                    } else {
                        showNotification(result ? result.message : 'Failed to remove class.', 'error');
                    }
                }
            });

            modal.querySelector('#close-detail').addEventListener('click', function() {
                closeModal(modal);
            });
        });

        showModal(modal);
    }

    function showInstructorClassDetail(day, hour) {
        var instructorId = state.selectedId;
        var week = state.week;

        // Check if this is a template or a block
        var templates = getInstructorTemplates(instructorId, week);
        var templateKey = day + '_' + hour;
        var template = templates[templateKey];

        var blocks = getInstructorBlocks(instructorId, week);
        var block = blocks[day] && blocks[day][hour] ? blocks[day][hour] : null;

        var hourDisplay = formatHourShort(hour);
        var dayName = getDayName(day);

        if (block) {
            var modal = createModal('Blocked Time - ' + dayName + ' at ' + hourDisplay, function(modal) {
                modal.innerHTML = `
                    <div class="detail-row"><span class="label">Type:</span> <span><strong>Blocked Time</strong></span></div>
                    <div class="detail-row"><span class="label">Label:</span> <span>${escapeHtml(block.label || 'Blocked Time')}</span></div>
                    ${block.groupLabel ? '<div class="detail-row"><span class="label">Group:</span> <span>' + escapeHtml(block.groupLabel) + '</span></div>' : ''}
                    <div class="detail-row"><span class="label">Duration:</span> <span>${block.duration || 1} hour${block.duration > 1 ? 's' : ''}</span></div>
                    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
                        <button type="button" id="remove-block" class="danger small">✕ Remove Block</button>
                        <button type="button" id="close-detail" class="secondary small">Close</button>
                    </div>
                `;

                modal.querySelector('#remove-block').addEventListener('click', function() {
                    if (showConfirmation('Remove this blocked time?')) {
                        var result = CalendarCore.removeInstructorBlock(instructorId, week, day, hour);
                        if (result && result.success) {
                            closeModal(modal);
                            persistChange(
                                function() { return { success: true }; },
                                'Block removed!',
                                'Block removed in memory, but persistence failed.',
                                function() { render(); }
                            );
                        } else {
                            showNotification(result ? result.message : 'Failed to remove block.', 'error');
                        }
                    }
                });

                modal.querySelector('#close-detail').addEventListener('click', function() {
                    closeModal(modal);
                });
            });

            showModal(modal);
            return;
        }

        if (template) {
            var discipline = getDiscipline(template.disciplineId);
            var disciplineName = discipline ? discipline.name : 'Unknown';

            var modal = createModal('Template - ' + dayName + ' at ' + hourDisplay, function(modal) {
                modal.innerHTML = `
                    <div class="detail-row"><span class="label">Type:</span> <span><strong>Template Class</strong></span></div>
                    <div class="detail-row"><span class="label">Discipline:</span> <span>${escapeHtml(disciplineName)}</span></div>
                    ${template.label ? '<div class="detail-row"><span class="label">Label:</span> <span>' + escapeHtml(template.label) + '</span></div>' : ''}
                    ${template.groupLabel ? '<div class="detail-row"><span class="label">Group:</span> <span>' + escapeHtml(template.groupLabel) + '</span></div>' : ''}
                    <div class="detail-row"><span class="label">Duration:</span> <span>${template.duration || 1} hour${template.duration > 1 ? 's' : ''}</span></div>
                    <div class="detail-row"><span class="label">Assigned Students:</span> <span>${template.assignedStudents ? template.assignedStudents.length : 0}</span></div>
                    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
                        <button type="button" id="remove-template" class="danger small">✕ Remove Template</button>
                        <button type="button" id="close-detail" class="secondary small">Close</button>
                    </div>
                `;

                modal.querySelector('#remove-template').addEventListener('click', function() {
                    if (showConfirmation('Remove this template?')) {
                        var result = CalendarCore.removeInstructorTemplate(instructorId, week, day, hour);
                        if (result && result.success) {
                            closeModal(modal);
                            persistChange(
                                function() { return { success: true }; },
                                'Template removed!',
                                'Template removed in memory, but persistence failed.',
                                function() { render(); }
                            );
                        } else {
                            showNotification(result ? result.message : 'Failed to remove template.', 'error');
                        }
                    }
                });

                modal.querySelector('#close-detail').addEventListener('click', function() {
                    closeModal(modal);
                });
            });

            showModal(modal);
            return;
        }

        showNotification('No class or block at this time.', 'warning');
    }

    function showLocationClassDetail(day, hour) {
        var locationId = state.selectedId;
        var week = state.week;

        var schedule = getLocationSchedule(locationId, week);
        if (!schedule || !schedule[day] || !schedule[day][hour]) {
            showNotification('No class at this time.', 'warning');
            return;
        }

        var disciplineId = schedule[day][hour];
        var discipline = getDiscipline(disciplineId);
        if (!discipline) {
            showNotification('Discipline not found.', 'error');
            return;
        }

        var hourDisplay = formatHourShort(hour);
        var dayName = getDayName(day);

        // Find duration
        var duration = 1;
        for (var h = hour + 1; h <= 23; h++) {
            if (schedule[day] && schedule[day][h] === disciplineId) {
                duration++;
            } else {
                break;
            }
        }

        var modal = createModal(discipline.name + ' - ' + dayName + ' at ' + hourDisplay, function(modal) {
            modal.innerHTML = `
                <div class="detail-row"><span class="label">Discipline:</span> <span><strong>${escapeHtml(discipline.name)}</strong></span></div>
                <div class="detail-row"><span class="label">Duration:</span> <span>${duration} hour${duration > 1 ? 's' : ''}</span></div>
                <div class="detail-row"><span class="label">Week:</span> <span>${week}</span></div>
                <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
                    <button type="button" id="remove-class" class="danger small">✕ Remove</button>
                    <button type="button" id="close-detail" class="secondary small">Close</button>
                </div>
            `;

            modal.querySelector('#remove-class').addEventListener('click', function() {
                if (showConfirmation('Remove this class from the location?')) {
                    var result = CalendarCore.removeLocationClass(locationId, week, day, hour);
                    if (result && result.success) {
                        closeModal(modal);
                        persistChange(
                            function() { return { success: true }; },
                            'Class removed from location!',
                            'Class removed in memory, but persistence failed.',
                            function() { render(); }
                        );
                    } else {
                        showNotification(result ? result.message : 'Failed to remove class.', 'error');
                    }
                }
            });

            modal.querySelector('#close-detail').addEventListener('click', function() {
                closeModal(modal);
            });
        });

        showModal(modal);
    }

    // ============================================================
    // BLOCK DETAIL MODAL
    // ============================================================

    function showBlockDetailModal(day, hour) {
        if (state.mode !== 'instructor') {
            showNotification('Block details are only available in instructor view.', 'warning');
            return;
        }

        showInstructorClassDetail(day, hour);
    }

    function removeBlockedTime(day, hour) {
        if (state.mode !== 'instructor') {
            showNotification('Blocks can only be removed in instructor view.', 'warning');
            return;
        }

        var instructorId = state.selectedId;
        var week = state.week;

        var result = CalendarCore.removeInstructorBlock(instructorId, week, day, hour);

        if (result && result.success) {
            persistChange(
                function() { return { success: true }; },
                'Block removed!',
                'Block removed in memory, but persistence failed.',
                function() { render(); }
            );
        } else {
            showNotification(result ? result.message : 'Failed to remove block.', 'error');
        }
    }

    function removeClass(day, hour) {
        switch (state.mode) {
            case 'student':
                removeStudentClass(day, hour);
                break;
            case 'instructor':
                removeInstructorClass(day, hour);
                break;
            case 'location':
                removeLocationClass(day, hour);
                break;
        }
    }

    function removeStudentClass(day, hour) {
        var studentId = state.selectedId;
        var week = state.week;

        var result = CalendarCore.removeStudentScheduleClass(studentId, week, day, hour);

        if (result && result.success) {
            persistChange(
                function() { return { success: true }; },
                'Class removed!',
                'Class removed in memory, but persistence failed.',
                function() { render(); }
            );
        } else {
            showNotification(result ? result.message : 'Failed to remove class.', 'error');
        }
    }

    function removeInstructorClass(day, hour) {
        var instructorId = state.selectedId;
        var week = state.week;

        var templates = getInstructorTemplates(instructorId, week);
        var templateKey = day + '_' + hour;

        if (templates[templateKey]) {
            var result = CalendarCore.removeInstructorTemplate(instructorId, week, day, hour);
            if (result && result.success) {
                persistChange(
                    function() { return { success: true }; },
                    'Template removed!',
                    'Template removed in memory, but persistence failed.',
                    function() { render(); }
                );
            } else {
                showNotification(result ? result.message : 'Failed to remove template.', 'error');
            }
        } else {
            showNotification('No class at this time.', 'warning');
        }
    }

    function removeLocationClass(day, hour) {
        var locationId = state.selectedId;
        var week = state.week;

        var result = CalendarCore.removeLocationClass(locationId, week, day, hour);

        if (result && result.success) {
            persistChange(
                function() { return { success: true }; },
                'Class removed from location!',
                'Class removed in memory, but persistence failed.',
                function() { render(); }
            );
        } else {
            showNotification(result ? result.message : 'Failed to remove class.', 'error');
        }
    }

    // ============================================================
    // REST DAYS
    // ============================================================

    function handleSaveRestDays() {
        if (state.mode !== 'student') {
            showNotification('Rest days are only available in student view.', 'warning');
            return;
        }

        var studentId = state.selectedId;
        var week = state.week;

        if (!studentId) {
            showNotification('Please select a student.', 'warning');
            return;
        }

        var checkboxes = document.querySelectorAll('.rest-day-check');
        var restDays = [];

        checkboxes.forEach(function(cb) {
            if (cb.checked) {
                restDays.push(parseInt(cb.dataset.day));
            }
        });

        var result = CalendarCore.setStudentRestDays(studentId, week, restDays);

        if (result && result.success) {
            persistChange(
                function() { return { success: true }; },
                'Rest days saved!',
                'Rest days saved in memory, but persistence failed.',
                function() { render(); }
            );
        } else {
            showNotification(result ? result.message : 'Failed to save rest days.', 'error');
        }
    }

    // ============================================================
    // MODAL HELPERS
    // ============================================================

    var _modalStack = [];

    function createModal(title, contentFn) {
        var modal = document.createElement('div');
        modal.className = 'modal';

        var content = document.createElement('div');
        content.className = 'modal-content small';

        var header = document.createElement('div');
        header.className = 'modal-header';

        var titleEl = document.createElement('h3');
        titleEl.textContent = title;

        var closeBtn = document.createElement('button');
        closeBtn.className = 'close-modal';
        closeBtn.textContent = '×';

        header.appendChild(titleEl);
        header.appendChild(closeBtn);
        content.appendChild(header);

        var body = document.createElement('div');
        body.className = 'modal-body';
        content.appendChild(body);

        modal.appendChild(content);

        // Call content function with body
        contentFn(body);

        // Close on backdrop click
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeModal(modal);
            }
        });

        // Close button
        closeBtn.addEventListener('click', function() {
            closeModal(modal);
        });

        return modal;
    }

    function showModal(modal) {
        document.body.appendChild(modal);
        _modalStack.push(modal);

        // Show with animation
        requestAnimationFrame(function() {
            modal.style.display = 'flex';
        });
    }

    function closeModal(modal) {
        modal.style.display = 'none';
        var index = _modalStack.indexOf(modal);
        if (index !== -1) {
            _modalStack.splice(index, 1);
        }
        setTimeout(function() {
            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
        }, 300);
    }

    function closeAllModals() {
        while (_modalStack.length > 0) {
            var modal = _modalStack.pop();
            if (modal && modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
        }
    }

    // ============================================================
    // DATA ACCESS WRAPPERS
    // ============================================================

    function getStudents() {
        if (typeof window.getStudents === 'function') {
            return window.getStudents();
        }
        return [];
    }

    function getInstructors() {
        if (typeof window.getInstructors === 'function') {
            return window.getInstructors();
        }
        return [];
    }

    function getLocations() {
        if (typeof window.getLocations === 'function') {
            return window.getLocations();
        }
        return [];
    }

    function getCharacterById(id) {
        if (typeof window.getCharacterById === 'function') {
            return window.getCharacterById(id);
        }
        return null;
    }

    function getDisplayName(char) {
        if (typeof window.getDisplayName === 'function') {
            return window.getDisplayName(char);
        }
        return char ? char.name || 'Unknown' : 'Unknown';
    }

    function getLocationTypeLabel(type) {
        if (typeof window.getLocationTypeLabel === 'function') {
            return window.getLocationTypeLabel(type);
        }
        return type || 'Other';
    }

    function getDiscipline(id) {
        if (typeof window.getDiscipline === 'function') {
            return window.getDiscipline(id);
        }
        return null;
    }

    function getAvailableDisciplines(week) {
        if (typeof window.getAvailableDisciplines === 'function') {
            return window.getAvailableDisciplines(week);
        }
        return [];
    }

    function getAvailableDisciplinesForStudent(studentId, week) {
        if (typeof window.getAvailableDisciplinesForStudent === 'function') {
            return window.getAvailableDisciplinesForStudent(studentId, week);
        }
        return [];
    }

    function getAvailableDisciplinesForInstructor(instructorId, week) {
        if (typeof window.getAvailableDisciplinesForInstructor === 'function') {
            return window.getAvailableDisciplinesForInstructor(instructorId, week);
        }
        return [];
    }

    function getStudentSchedule(studentId, week) {
        if (typeof window.getStudentSchedule === 'function') {
            return window.getStudentSchedule(studentId, week);
        }
        return {};
    }

    function getClassInstructor(studentId, week, day, hour) {
        if (typeof window.getClassInstructor === 'function') {
            return window.getClassInstructor(studentId, week, day, hour);
        }
        return null;
    }

    function getClassLabel(studentId, week, day, hour) {
        if (typeof window.getClassLabel === 'function') {
            return window.getClassLabel(studentId, week, day, hour);
        }
        return null;
    }

    function getClassGroupLabel(studentId, week, day, hour) {
        if (typeof window.getClassGroupLabel === 'function') {
            return window.getClassGroupLabel(studentId, week, day, hour);
        }
        return null;
    }

    function getClassDuration(studentId, week, day, hour) {
        if (typeof window.getClassDuration === 'function') {
            return window.getClassDuration(studentId, week, day, hour);
        }
        return 1;
    }

    function getInstructorTemplates(instructorId, week) {
        if (typeof window.getInstructorTemplates === 'function') {
            return window.getInstructorTemplates(instructorId, week);
        }
        return {};
    }

    function getInstructorBlocks(instructorId, week) {
        if (typeof window.getInstructorBlocks === 'function') {
            return window.getInstructorBlocks(instructorId, week);
        }
        return {};
    }

    function getLocationSchedule(locationId, week) {
        if (typeof window.getLocationSchedule === 'function') {
            return window.getLocationSchedule(locationId, week);
        }
        return {};
    }

    function getLocation(id) {
        if (typeof window.getLocation === 'function') {
            return window.getLocation(id);
        }
        return null;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function formatHourShort(hour) {
        var h = hour;
        var ampm = h >= 12 ? 'PM' : 'AM';
        if (h === 0) { h = 12; ampm = 'AM'; }
        if (h === 12) { ampm = 'PM'; }
        if (h > 12) { h = h - 12; }
        return h + ampm;
    }

    function getDayName(day) {
        var names = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        return names[day] || 'Unknown';
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CalendarUI = {
        init: init,
        render: render,
        destroy: destroy,
        switchMode: switchMode,
        goToWeek: function(week) {
            state.week = parseInt(week) || 1;
            render();
        },
        getState: function() {
            return {
                mode: state.mode,
                week: state.week,
                selectedId: state.selectedId
            };
        },
        setState: function(newState) {
            if (newState.mode) state.mode = newState.mode;
            if (newState.week) state.week = parseInt(newState.week) || 1;
            if (newState.selectedId !== undefined) state.selectedId = newState.selectedId;
            render();
        }
    };

})();
