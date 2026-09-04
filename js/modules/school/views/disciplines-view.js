/**
 * js/modules/curriculum/disciplines-view.js - Discipline Management View
 * Handles discipline CRUD operations and UI
 * Path: js/modules/curriculum/disciplines-view.js
 * 
 * This module is responsible for:
 *   - Discipline list rendering and filtering
 *   - Discipline CRUD form UI
 *   - Instructor assignment
 *   - Grading system management
 * 
 * IMPORTANT: 
 *   - All application-data mutations are delegated to core functions.
 *   - This module does NOT mutate window.data directly.
 *   - The core owns validation and parsing.
 *   - This module collects raw form data and passes it to core.
 *   - UI validation is for UX only; core validation is authoritative.
 * 
 * LIFECYCLE:
 *   This module is rendered by curriculum-main.js via TabManager.
 *   It does not independently listen for lifecycle events.
 */

(function() {
    'use strict';

    // ============================================================
    // DEPENDENCY VALIDATION
    // ============================================================

    function validateDependencies(container) {
        var missing = [];

        if (typeof window.getDisciplines !== 'function') {
            missing.push('getDisciplines');
        }

        if (typeof window.getDiscipline !== 'function') {
            missing.push('getDiscipline');
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

        if (typeof window.getInstructors !== 'function') {
            missing.push('getInstructors');
        }

        if (typeof window.getCharacterById !== 'function') {
            missing.push('getCharacterById');
        }

        if (typeof window.getDisplayName !== 'function') {
            missing.push('getDisplayName');
        }

        if (typeof window.saveData !== 'function') {
            missing.push('saveData');
        }

        if (typeof window.ensureCurriculum !== 'function') {
            missing.push('ensureCurriculum');
        }

        if (missing.length > 0) {
            if (container) {
                container.innerHTML = '<p class="empty-state">Disciplines dependencies not loaded. Please refresh the page.</p>';
            }
            return false;
        }

        return true;
    }

    // ============================================================
    // RENDER DISCIPLINES VIEW - Public API
    // ============================================================

    function renderDisciplinesView(container) {
        if (!container) {
            container = document.getElementById('disciplines-content');
        }
        if (!container) {
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading disciplines data...</p>';
            return;
        }

        // Validate dependencies BEFORE calling ensureCurriculum
        if (!validateDependencies(container)) {
            return;
        }

        // Schema initialisation - safe to call after deps verified
        window.ensureCurriculum();

        container.innerHTML = getDisciplinesHTML();
        renderDisciplines(container);
        initDisciplineEvents(container);
    }

    // ============================================================
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        if (value === undefined || value === null) {
            return '';
        }
        var str = String(value);
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // DISCIPLINES HTML
    // ============================================================

    function getDisciplinesHTML() {
        return (
            '<div class="page-header">' +
                '<h2>Disciplines</h2>' +
                '<button id="add-discipline-btn" class="primary">+ Add Discipline</button>' +
            '</div>' +
            '<div class="filter-section">' +
                '<label for="discipline-filter">Filter:</label>' +
                '<select id="discipline-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">' +
                    '<option value="all">All Disciplines</option>' +
                    '<option value="mandatory">Mandatory</option>' +
                    '<option value="optional">Optional</option>' +
                '</select>' +
                '<span style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Total: <span id="discipline-count">0</span></span>' +
            '</div>' +
            '<div id="discipline-list">' +
                '<div class="list-header" style="display:grid;grid-template-columns:1fr 0.8fr 1.2fr 0.6fr 0.6fr 0.6fr 0.8fr;gap:8px;padding:8px 12px;background:var(--panel-alt);border-radius:6px 6px 0 0;border:1px solid var(--border);border-bottom:none;font-weight:600;font-size:0.7rem;color:var(--text-dim);">' +
                    '<span>Discipline</span>' +
                    '<span>Type</span>' +
                    '<span>Instructors</span>' +
                    '<span>Weeks</span>' +
                    '<span>Hours/Week</span>' +
                    '<span>Students</span>' +
                    '<span>Actions</span>' +
                '</div>' +
                '<div id="disciplines-container"></div>' +
            '</div>' +
            '<div id="discipline-form-modal" class="modal hidden">' +
                '<div class="modal-content" style="max-width:600px;">' +
                    '<div class="modal-header">' +
                        '<h3 id="discipline-form-title">Add Discipline</h3>' +
                        '<button class="close-modal" id="close-discipline-form">&times;</button>' +
                    '</div>' +
                    '<div class="modal-body">' +
                        '<form id="discipline-form-inner">' +
                            '<div class="form-grid">' +
                                '<div class="form-group">' +
                                    '<label>Discipline Name *</label>' +
                                    '<input type="text" id="discipline-name" required>' +
                                '</div>' +
                                '<div class="form-group">' +
                                    '<label>Discipline Type *</label>' +
                                    '<select id="discipline-type" required>' +
                                        '<option value="">Select type...</option>' +
                                        '<option value="mandatory">Mandatory / Common</option>' +
                                        '<option value="optional">Optional / Choice</option>' +
                                    '</select>' +
                                '</div>' +
                                '<div class="form-group full-width">' +
                                    '<label>Instructors</label>' +
                                    '<div id="instructors-container">' +
                                        '<div class="instructor-entry">' +
                                            '<select class="instructor-select">' +
                                                '<option value="">Select instructor...</option>' +
                                            '</select>' +
                                            '<button type="button" class="small danger remove-instructor">[X]</button>' +
                                        '</div>' +
                                    '</div>' +
                                    '<button type="button" id="add-instructor-btn" class="small" style="margin-top:8px;">+ Add Instructor</button>' +
                                '</div>' +
                                '<div class="form-group">' +
                                    '<label>Curriculum (free text)</label>' +
                                    '<input type="text" id="discipline-curriculum" placeholder="e.g., Mathematics, Physics...">' +
                                '</div>' +
                                '<div class="form-group">' +
                                    '<label>Start Week</label>' +
                                    '<input type="number" id="discipline-start-week" min="1" max="52" step="1">' +
                                '</div>' +
                                '<div class="form-group">' +
                                    '<label>End Week</label>' +
                                    '<input type="number" id="discipline-end-week" min="1" max="52" step="1">' +
                                '</div>' +
                                '<div class="form-group">' +
                                    '<label>Weekly Hours</label>' +
                                    '<input type="number" id="discipline-hours" min="0" max="40" step="0.5">' +
                                '</div>' +
                                '<div class="form-group">' +
                                    '<label>Max Students per Class</label>' +
                                    '<input type="number" id="discipline-students" min="0" max="100" step="1">' +
                                '</div>' +
                                '<div class="form-group">' +
                                    '<label>Weight (for grade calculation)</label>' +
                                    '<input type="number" id="discipline-weight" min="0.1" max="10" step="0.1" value="1">' +
                                '</div>' +
                                '<div class="form-group full-width">' +
                                    '<label>Grading System</label>' +
                                    '<div id="grading-system-container">' +
                                        '<div class="grading-entry">' +
                                            '<input type="text" class="grading-label" placeholder="Label" style="width:80px;">' +
                                            '<input type="number" class="grading-min" placeholder="Min %" min="0" max="100" style="width:80px;">' +
                                            '<input type="number" class="grading-max" placeholder="Max %" min="0" max="100" style="width:80px;">' +
                                            '<button type="button" class="small danger remove-grading">[X]</button>' +
                                        '</div>' +
                                    '</div>' +
                                    '<button type="button" id="add-grading-btn" class="small" style="margin-top:8px;">+ Add Grade Level</button>' +
                                '</div>' +
                            '</div>' +
                            '<div class="form-actions">' +
                                '<button type="button" id="cancel-discipline-form" class="secondary">Cancel</button>' +
                                '<button type="submit" id="save-discipline-btn" class="primary">Save Discipline</button>' +
                            '</div>' +
                        '</form>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );
    }

    // ============================================================
    // RENDER DISCIPLINES - READ-ONLY
    // ============================================================

    function renderDisciplines(container) {
        var listContainer = container ? container.querySelector('#disciplines-container') : document.getElementById('disciplines-container');
        var countEl = container ? container.querySelector('#discipline-count') : document.getElementById('discipline-count');

        if (!listContainer) {
            return;
        }

        var disciplines = window.getDisciplines();

        var filterSelect = container ? container.querySelector('#discipline-filter') : document.getElementById('discipline-filter');
        var filterType = filterSelect ? filterSelect.value : 'all';

        var filteredDisciplines = disciplines.slice();

        if (filterType !== 'all') {
            filteredDisciplines = filteredDisciplines.filter(function(d) {
                return d.type === filterType;
            });
        }

        filteredDisciplines.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        if (countEl) {
            countEl.textContent = String(filteredDisciplines.length);
        }

        if (filteredDisciplines.length === 0) {
            listContainer.innerHTML = '<p class="empty-state">No disciplines found. Add your first discipline.</p>';
            return;
        }

        var html = '';

        for (var i = 0; i < filteredDisciplines.length; i++) {
            var d = filteredDisciplines[i];
            var instructors = getInstructorNames(d);
            var instructorDisplay = instructors.length > 0 ? instructors.join(', ') : 'Not assigned';

            var weekDisplay = '';
            if (d.startWeek && d.endWeek) {
                weekDisplay = 'Wk ' + d.startWeek + ' - Wk ' + d.endWeek;
            } else if (d.startWeek) {
                weekDisplay = 'Wk ' + d.startWeek + ' +';
            } else if (d.endWeek) {
                weekDisplay = 'Until Wk ' + d.endWeek;
            } else {
                weekDisplay = 'All year';
            }

            var typeLabel = d.type === 'mandatory' ? 'Mandatory' : (d.type === 'optional' ? 'Optional' : '--');
            var typeColor = d.type === 'mandatory' ? 'var(--accent)' : (d.type === 'optional' ? 'var(--warning)' : 'var(--text-dim)');

            var safeId = escapeHtml(d.id);
            var safeName = escapeHtml(d.name);
            var safeInstructorDisplay = escapeHtml(instructorDisplay);
            var safeWeekDisplay = escapeHtml(weekDisplay);
            var safeTypeLabel = escapeHtml(typeLabel);
            var safeHours = escapeHtml(d.weeklyHours !== undefined && d.weeklyHours !== null && d.weeklyHours !== '' ? String(d.weeklyHours) : '-');
            var safeStudents = escapeHtml(d.maxStudents !== undefined && d.maxStudents !== null && d.maxStudents !== '' ? String(d.maxStudents) : '-');

            html += '<div class="list-item" style="display:grid;grid-template-columns:1fr 0.8fr 1.2fr 0.6fr 0.6fr 0.6fr 0.8fr;gap:8px;padding:8px 12px;background:var(--panel);border:1px solid var(--border);border-top:none;" data-id="' + safeId + '">';
            html += '<span><strong>' + safeName + '</strong></span>';
            html += '<span style="color:' + typeColor + ';font-size:0.75rem;">' + safeTypeLabel + '</span>';
            html += '<span style="font-size:0.75rem;">' + safeInstructorDisplay + '</span>';
            html += '<span>' + safeWeekDisplay + '</span>';
            html += '<span>' + safeHours + 'h</span>';
            html += '<span>' + safeStudents + '</span>';
            html += '<span class="actions" style="display:flex;gap:4px;">' +
                '<button class="small edit-discipline" data-id="' + safeId + '">Edit</button>' +
                '<button class="small danger delete-discipline" data-id="' + safeId + '">Delete</button>' +
            '</span>';
            html += '</div>';
        }

        listContainer.innerHTML = html;

        var editBtns = listContainer.querySelectorAll('.edit-discipline');
        for (var j = 0; j < editBtns.length; j++) {
            var btn = editBtns[j];
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                showDisciplineForm(container, this.dataset.id);
            });
        }

        var deleteBtns = listContainer.querySelectorAll('.delete-discipline');
        for (var k = 0; k < deleteBtns.length; k++) {
            var delBtn = deleteBtns[k];
            delBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                deleteDisciplineHandler(container, this.dataset.id);
            });
        }
    }

    // ============================================================
    // GET INSTRUCTOR NAMES
    // ============================================================

    function getInstructorNames(discipline) {
        var names = [];

        if (discipline && discipline.instructorIds) {
            for (var i = 0; i < discipline.instructorIds.length; i++) {
                var id = discipline.instructorIds[i];
                var instructor = window.getCharacterById(id);

                if (instructor) {
                    names.push(window.getDisplayName(instructor));
                }
            }
        }

        return names;
    }

    // ============================================================
    // REFRESH DEPENDENT VIEWS
    // ============================================================

    function refreshDependentViews() {
        if (typeof window.refreshGroupsView === 'function') {
            window.refreshGroupsView();
        }

        if (typeof window.renderInstructorCalendar === 'function') {
            window.renderInstructorCalendar();
        }

        if (typeof window.renderStudentScheduleView === 'function') {
            window.renderStudentScheduleView();
        } else if (typeof window.renderStudentSchedule === 'function') {
            window.renderStudentSchedule();
        }

        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
    }

    // ============================================================
    // DELETE DISCIPLINE HANDLER
    // ============================================================

    function deleteDisciplineHandler(container, id) {
        var disciplines = window.getDisciplines();
        var discipline = null;

        for (var i = 0; i < disciplines.length; i++) {
            if (String(disciplines[i].id) === String(id)) {
                discipline = disciplines[i];
                break;
            }
        }

        if (!discipline) {
            showNotification('Discipline not found.', 'error');
            return;
        }

        var confirmMsg = 'Delete "' + discipline.name + '" permanently?\n\n';
        confirmMsg += 'This will remove it from all schedules and auto-groups.\n';
        confirmMsg += 'Historical grade records will be preserved.\n\n';
        confirmMsg += 'This action cannot be undone.';

        if (!confirm(confirmMsg)) {
            return;
        }

        var result = window.deleteDiscipline(id);

        if (result && result.success) {
            renderDisciplines(container);
            refreshDependentViews();

            if (typeof window.saveData === 'function') {
                window.saveData()
                    .then(function() {
                        showNotification('Discipline deleted successfully.', 'success');
                    })
                    .catch(function() {
                        showNotification('Discipline deleted in memory, but persistence failed.', 'error');
                    });
            } else {
                showNotification('Discipline deleted successfully.', 'success');
            }
        } else {
            showNotification(result && result.message ? result.message : 'Failed to delete discipline.', 'error');
        }
    }

    // ============================================================
    // SHOW DISCIPLINE FORM
    // ============================================================

    function showDisciplineForm(container, editId) {
        var modal = document.getElementById('discipline-form-modal');
        var title = document.getElementById('discipline-form-title');
        var form = document.getElementById('discipline-form-inner');

        if (!modal || !title || !form) {
            showNotification('Form elements not found. Please refresh.', 'error');
            return;
        }

        modal.classList.remove('hidden');
        form.reset();

        if (editId) {
            title.textContent = 'Edit Discipline';
            var discipline = window.getDiscipline(editId);

            if (discipline) {
                document.getElementById('discipline-name').value = discipline.name || '';
                document.getElementById('discipline-type').value = discipline.type || '';
                document.getElementById('discipline-curriculum').value = discipline.curriculum || '';

                document.getElementById('discipline-start-week').value =
                    discipline.startWeek !== undefined && discipline.startWeek !== null && discipline.startWeek !== ''
                        ? discipline.startWeek
                        : '';

                document.getElementById('discipline-end-week').value =
                    discipline.endWeek !== undefined && discipline.endWeek !== null && discipline.endWeek !== ''
                        ? discipline.endWeek
                        : '';

                document.getElementById('discipline-hours').value =
                    discipline.weeklyHours !== undefined && discipline.weeklyHours !== null && discipline.weeklyHours !== ''
                        ? discipline.weeklyHours
                        : '';

                document.getElementById('discipline-students').value =
                    discipline.maxStudents !== undefined && discipline.maxStudents !== null && discipline.maxStudents !== ''
                        ? discipline.maxStudents
                        : '';

                document.getElementById('discipline-weight').value =
                    discipline.weight !== undefined && discipline.weight !== null ? discipline.weight : 1;

                var instructorsContainer = document.getElementById('instructors-container');
                instructorsContainer.innerHTML = '';

                if (discipline.instructorIds && discipline.instructorIds.length > 0) {
                    for (var i = 0; i < discipline.instructorIds.length; i++) {
                        addInstructorEntry(instructorsContainer, discipline.instructorIds[i]);
                    }
                } else {
                    addInstructorEntry(instructorsContainer);
                }

                var gradingContainer = document.getElementById('grading-system-container');
                gradingContainer.innerHTML = '';

                if (discipline.gradingSystem && discipline.gradingSystem.length > 0) {
                    for (var i = 0; i < discipline.gradingSystem.length; i++) {
                        var g = discipline.gradingSystem[i];
                        addGradingEntry(gradingContainer, g.label || g.letter, g.min, g.max);
                    }
                } else {
                    addGradingEntry(gradingContainer);
                }

                form.dataset.editId = editId;
            } else {
                showNotification('Discipline not found.', 'error');
                modal.classList.add('hidden');
                return;
            }
        } else {
            title.textContent = 'Add Discipline';
            document.getElementById('discipline-type').value = '';
            document.getElementById('discipline-weight').value = 1;

            var instructorsContainer = document.getElementById('instructors-container');
            instructorsContainer.innerHTML = '';
            addInstructorEntry(instructorsContainer);

            var gradingContainer = document.getElementById('grading-system-container');
            gradingContainer.innerHTML = '';
            addGradingEntry(gradingContainer);
            delete form.dataset.editId;
        }
    }

    // ============================================================
    // ADD INSTRUCTOR ENTRY
    // ============================================================

    function addInstructorEntry(container, selectedId) {
        var entry = document.createElement('div');
        entry.className = 'instructor-entry';
        entry.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;align-items:center;';

        var select = document.createElement('select');
        select.className = 'instructor-select';
        select.style.cssText = 'flex:1;min-width:120px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:0.78rem;font-family:Inter,sans-serif;';

        var instructors = window.getInstructors();

        var emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = 'Select instructor...';
        select.appendChild(emptyOption);

        for (var i = 0; i < instructors.length; i++) {
            var instructor = instructors[i];
            var name = window.getDisplayName(instructor);
            var option = document.createElement('option');
            option.value = instructor.id;
            option.textContent = name;

            if (selectedId && String(instructor.id) === String(selectedId)) {
                option.selected = true;
            }

            select.appendChild(option);
        }

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'small danger remove-instructor';
        removeBtn.textContent = '[X]';
        removeBtn.style.cssText = 'padding:4px 8px;font-size:0.65rem;';

        removeBtn.addEventListener('click', function() {
            if (container.children.length > 1) {
                entry.remove();
            } else {
                showNotification('You need at least one instructor.', 'error');
            }
        });

        entry.appendChild(select);
        entry.appendChild(removeBtn);
        container.appendChild(entry);
    }

    // ============================================================
    // ADD GRADING ENTRY
    // ============================================================

    function addGradingEntry(container, label, min, max) {
        var entry = document.createElement('div');
        entry.className = 'grading-entry';
        entry.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;align-items:center;';

        var labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.className = 'grading-label';
        labelInput.placeholder = 'Label';
        labelInput.style.cssText = 'width:80px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:0.78rem;';

        if (label) {
            labelInput.value = label;
        }

        var minInput = document.createElement('input');
        minInput.type = 'number';
        minInput.className = 'grading-min';
        minInput.placeholder = 'Min %';
        minInput.style.cssText = 'width:80px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:0.78rem;';
        minInput.min = '0';
        minInput.max = '100';
        minInput.step = '0.5';

        if (min !== undefined && min !== null) {
            minInput.value = min;
        }

        var maxInput = document.createElement('input');
        maxInput.type = 'number';
        maxInput.className = 'grading-max';
        maxInput.placeholder = 'Max %';
        maxInput.style.cssText = 'width:80px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:0.78rem;';
        maxInput.min = '0';
        maxInput.max = '100';
        maxInput.step = '0.5';

        if (max !== undefined && max !== null) {
            maxInput.value = max;
        }

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'small danger remove-grading';
        removeBtn.textContent = '[X]';
        removeBtn.style.cssText = 'padding:4px 8px;font-size:0.65rem;';

        removeBtn.addEventListener('click', function() {
            if (container.children.length > 1) {
                entry.remove();
            } else {
                showNotification('You need at least one grade level.', 'error');
            }
        });

        entry.appendChild(labelInput);
        entry.appendChild(minInput);
        entry.appendChild(maxInput);
        entry.appendChild(removeBtn);
        container.appendChild(entry);
    }

    // ============================================================
    // COLLECT INSTRUCTOR IDS
    // ============================================================

    function collectInstructorIds(form) {
        var ids = [];
        var selects = form.querySelectorAll('.instructor-select');

        for (var i = 0; i < selects.length; i++) {
            var select = selects[i];
            if (select.value && ids.indexOf(select.value) === -1) {
                ids.push(select.value);
            }
        }

        return ids;
    }

    // ============================================================
    // COLLECT GRADING SYSTEM - Preserve ALL non-empty rows
    // ============================================================

    function collectGradingSystem(form) {
        var system = [];
        var entries = form.querySelectorAll('.grading-entry');

        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var labelInput = entry.querySelector('.grading-label');
            var minInput = entry.querySelector('.grading-min');
            var maxInput = entry.querySelector('.grading-max');

            if (!labelInput || !minInput || !maxInput) {
                continue;
            }

            var label = labelInput.value.trim();
            var min = minInput.value.trim();
            var max = maxInput.value.trim();

            // Skip completely blank rows
            if (!label && min === '' && max === '') {
                continue;
            }

            // Collect EVERY non-empty row, even if incomplete.
            // The core validator will reject invalid ones.
            system.push({
                label: label || '',
                min: min !== '' ? parseFloat(min) : undefined,
                max: max !== '' ? parseFloat(max) : undefined
            });
        }

        return system;
    }

    // ============================================================
    // SAVE DISCIPLINE - Delegate validation to core
    // ============================================================

    function saveDiscipline(e, container) {
        e.preventDefault();

        var form = e.target;
        var editId = form.dataset.editId;

        var instructorIds = collectInstructorIds(form);
        var gradingSystem = collectGradingSystem(form);

        var name = document.getElementById('discipline-name').value.trim();
        var type = document.getElementById('discipline-type').value;
        var curriculum = document.getElementById('discipline-curriculum').value.trim();
        var startWeek = document.getElementById('discipline-start-week').value;
        var endWeek = document.getElementById('discipline-end-week').value;
        var hours = document.getElementById('discipline-hours').value;
        var students = document.getElementById('discipline-students').value;
        var weight = document.getElementById('discipline-weight').value;

        // Build data object - let core handle parsing and validation
        var disciplineData = {
            name: name,
            type: type,
            instructorIds: instructorIds,
            curriculum: curriculum,
            startWeek: startWeek,
            endWeek: endWeek,
            weeklyHours: hours,
            maxStudents: students,
            weight: weight,
            gradingSystem: gradingSystem
        };

        var result;

        if (editId) {
            result = window.updateDiscipline(editId, disciplineData);

            if (!result || !result.success) {
                showNotification(result && result.message ? result.message : 'Failed to update discipline.', 'error');
                return;
            }
        } else {
            result = window.createDiscipline(disciplineData);

            if (!result || !result.success) {
                showNotification(result && result.message ? result.message : 'Failed to create discipline.', 'error');
                return;
            }
        }

        document.getElementById('discipline-form-modal').classList.add('hidden');
        renderDisciplines(container);
        refreshDependentViews();

        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    showNotification(editId ? 'Discipline updated successfully.' : 'Discipline created successfully.', 'success');
                })
                .catch(function() {
                    showNotification('Discipline changed in memory, but persistence failed.', 'error');
                });
        } else {
            showNotification(editId ? 'Discipline updated successfully.' : 'Discipline created successfully.', 'success');
        }
    }

    // ============================================================
    // NOTIFICATION HELPER
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';

        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }

        if (type === 'error') {
            alert('Error: ' + message);
        } else if (type === 'success') {
            alert(message);
        }
    }

    // ============================================================
    // EVENT INITIALISATION
    // ============================================================

    function initDisciplineEvents(container) {
        var addBtn = container ? container.querySelector('#add-discipline-btn') : document.getElementById('add-discipline-btn');

        if (addBtn) {
            addBtn.addEventListener('click', function() {
                showDisciplineForm(container);
            });
        }

        var cancelBtn = document.getElementById('cancel-discipline-form');

        if (cancelBtn) {
            cancelBtn.addEventListener('click', function() {
                document.getElementById('discipline-form-modal').classList.add('hidden');
            });
        }

        var closeBtn = document.getElementById('close-discipline-form');

        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                document.getElementById('discipline-form-modal').classList.add('hidden');
            });
        }

        var form = document.getElementById('discipline-form-inner');

        if (form) {
            form.addEventListener('submit', function(e) {
                saveDiscipline(e, container);
            });
        }

        var modal = document.getElementById('discipline-form-modal');

        if (modal) {
            modal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                }
            });
        }

        var addGradingBtn = document.getElementById('add-grading-btn');

        if (addGradingBtn) {
            addGradingBtn.addEventListener('click', function() {
                var gradingContainer = document.getElementById('grading-system-container');
                addGradingEntry(gradingContainer);
            });
        }

        var addInstructorBtn = document.getElementById('add-instructor-btn');

        if (addInstructorBtn) {
            addInstructorBtn.addEventListener('click', function() {
                var instructorsContainer = document.getElementById('instructors-container');
                addInstructorEntry(instructorsContainer);
            });
        }

        var filterSelect = container ? container.querySelector('#discipline-filter') : document.getElementById('discipline-filter');

        if (filterSelect) {
            filterSelect.addEventListener('change', function() {
                renderDisciplines(container);
            });
        }
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderDisciplinesView = renderDisciplinesView;

})();
