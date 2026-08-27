/**
 * js/modules/curriculum/disciplines.js - Discipline Management
 * Handles discipline CRUD operations and UI
 * Path: js/modules/curriculum/disciplines.js
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
 *   - UI state is managed locally (filter type is read from DOM).
 *   - Persistence is handled through the central saveData() function.
 *   - This module does not implement persistence itself.
 * 
 * LIFECYCLE:
 *   This module is rendered by curriculum-main.js via TabManager.
 *   It does not independently listen for lifecycle events.
 * 
 * ARCHITECTURAL NOTE:
 *   - Schema initialisation (ensureCurriculum) is idempotent and should
 *     ideally happen during application bootstrap. It's called here as a
 *     safety net, not as the primary initialisation path.
 *   - Discipline deletions cascade to schedules, groups, and calendars
 *     via the core. This module only requests deletion.
 *   - Instructor changes to a discipline may affect existing groups and
 *     schedules; the core handles that logic and reconciliation.
 *   - All core mutation functions return { success: boolean, message?: string, ... }
 */

(function() {
    'use strict';

    // ============================================================
    // STATE - UI state only (filter type is read from DOM)
    // ============================================================

    // No persistent UI state needed for disciplines beyond the filter,
    // which is read directly from the DOM on each render.

    // ============================================================
    // RENDER DISCIPLINES VIEW - Public API (only this is exposed)
    // ============================================================

    function renderDisciplinesView(container) {
        if (!container) {
            container = document.getElementById('disciplines-content');
        }
        if (!container) return;

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading disciplines data...</p>';
            return;
        }

        // Ensure schema exists (idempotent safety net)
        if (typeof window.ensureCurriculum !== 'function') {
            console.error('[Disciplines] ensureCurriculum() is not available.');
            container.innerHTML = '<p class="empty-state">Curriculum schema module not loaded. Please refresh the page.</p>';
            return;
        }

        window.ensureCurriculum();

        container.innerHTML = getDisciplinesHTML();
        renderDisciplines();
        initDisciplineEvents();
    }

    // ============================================================
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        return String(value == null ? '' : value)
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
        return `
            <div class="page-header">
                <h2>Disciplines</h2>
                <button id="add-discipline-btn" class="primary">+ Add Discipline</button>
            </div>
            <div class="filter-section">
                <label for="discipline-filter">Filter:</label>
                <select id="discipline-filter" style="background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 8px;font-size:0.75rem;">
                    <option value="all">All Disciplines</option>
                    <option value="mandatory">■ Mandatory</option>
                    <option value="optional">□ Optional</option>
                </select>
                <span style="font-size:0.75rem;color:var(--text-dim);margin-left:8px;">Total: <span id="discipline-count">0</span></span>
            </div>
            <div id="discipline-list">
                <div class="list-header" style="display:grid;grid-template-columns:1fr 0.8fr 1.2fr 0.6fr 0.6fr 0.6fr 0.8fr;gap:8px;padding:8px 12px;background:var(--panel-alt);border-radius:6px 6px 0 0;border:1px solid var(--border);border-bottom:none;font-weight:600;font-size:0.7rem;color:var(--text-dim);">
                    <span>Discipline</span>
                    <span>Type</span>
                    <span>Instructors</span>
                    <span>Weeks</span>
                    <span>Hours/Week</span>
                    <span>Students</span>
                    <span>Actions</span>
                </div>
                <div id="disciplines-container"></div>
            </div>

            <div id="discipline-form-modal" class="modal hidden">
                <div class="modal-content" style="max-width:600px;">
                    <div class="modal-header">
                        <h3 id="discipline-form-title">Add Discipline</h3>
                        <button class="close-modal" id="close-discipline-form">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="discipline-form-inner">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label>Discipline Name *</label>
                                    <input type="text" id="discipline-name" required>
                                </div>
                                <div class="form-group">
                                    <label>Discipline Type *</label>
                                    <select id="discipline-type" required>
                                        <option value="">Select type...</option>
                                        <option value="mandatory">■ Mandatory / Common</option>
                                        <option value="optional">□ Optional / Choice</option>
                                    </select>
                                </div>
                                <div class="form-group full-width">
                                    <label>Instructors *</label>
                                    <div id="instructors-container">
                                        <div class="instructor-entry">
                                            <select class="instructor-select">
                                                <option value="">Select instructor...</option>
                                            </select>
                                            <button type="button" class="small danger remove-instructor">✕</button>
                                        </div>
                                    </div>
                                    <button type="button" id="add-instructor-btn" class="small" style="margin-top:8px;">+ Add Instructor</button>
                                </div>
                                <div class="form-group">
                                    <label>Curriculum (free text)</label>
                                    <input type="text" id="discipline-curriculum" placeholder="e.g., Mathematics, Physics...">
                                </div>
                                <div class="form-group">
                                    <label>Start Week</label>
                                    <input type="number" id="discipline-start-week" min="1" max="52" step="1">
                                </div>
                                <div class="form-group">
                                    <label>End Week</label>
                                    <input type="number" id="discipline-end-week" min="1" max="52" step="1">
                                </div>
                                <div class="form-group">
                                    <label>Weekly Hours</label>
                                    <input type="number" id="discipline-hours" min="0" max="40" step="0.5">
                                </div>
                                <div class="form-group">
                                    <label>Max Students per Class</label>
                                    <input type="number" id="discipline-students" min="0" max="100" step="1">
                                </div>
                                <div class="form-group">
                                    <label>Weight (for grade calculation)</label>
                                    <input type="number" id="discipline-weight" min="0.1" max="10" step="0.1" value="1">
                                </div>
                                <div class="form-group full-width">
                                    <label>Grading System</label>
                                    <div id="grading-system-container">
                                        <div class="grading-entry">
                                            <input type="text" class="grading-letter" placeholder="Letter" style="width:80px;">
                                            <input type="number" class="grading-min" placeholder="Min %" min="0" max="100" style="width:80px;">
                                            <input type="number" class="grading-max" placeholder="Max %" min="0" max="100" style="width:80px;">
                                            <button type="button" class="small danger remove-grading">✕</button>
                                        </div>
                                    </div>
                                    <button type="button" id="add-grading-btn" class="small" style="margin-top:8px;">+ Add Grade Level</button>
                                </div>
                            </div>
                            <div class="form-actions">
                                <button type="button" id="cancel-discipline-form" class="secondary">Cancel</button>
                                <button type="submit" id="save-discipline-btn" class="primary">Save Discipline</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // RENDER DISCIPLINES - READ-ONLY (no data mutation)
    // ============================================================

    function renderDisciplines() {
        var container = document.getElementById('disciplines-container');
        var countEl = document.getElementById('discipline-count');
        if (!container) return;

        // READ-ONLY: Get disciplines without mutating window.data
        var disciplines = getDisciplines();

        var filterSelect = document.getElementById('discipline-filter');
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

        if (countEl) countEl.textContent = filteredDisciplines.length;

        if (filteredDisciplines.length === 0) {
            container.innerHTML = '<p class="empty-state">No disciplines found. Add your first discipline!</p>';
            return;
        }

        var html = '';
        filteredDisciplines.forEach(function(d) {
            var instructors = getInstructorNames(d);
            var instructorDisplay = instructors.length > 0 ? instructors.join(', ') : 'Not assigned';
            var weekDisplay = d.startWeek ? 'Wk ' + d.startWeek : '?';
            if (d.endWeek) weekDisplay += ' - Wk ' + d.endWeek;

            var typeLabel = d.type === 'mandatory' ? '■ Mandatory' : (d.type === 'optional' ? '□ Optional' : '—');
            var typeColor = d.type === 'mandatory' ? 'var(--accent)' : (d.type === 'optional' ? 'var(--warning)' : 'var(--text-dim)');

            var safeId = escapeHtml(d.id);
            var safeName = escapeHtml(d.name);
            var safeInstructorDisplay = escapeHtml(instructorDisplay);
            var safeWeekDisplay = escapeHtml(weekDisplay);
            var safeTypeLabel = escapeHtml(typeLabel);
            var safeHours = escapeHtml(d.weeklyHours !== undefined && d.weeklyHours !== null && d.weeklyHours !== '' ? d.weeklyHours : '-');
            var safeStudents = escapeHtml(d.maxStudents !== undefined && d.maxStudents !== null && d.maxStudents !== '' ? d.maxStudents : '-');

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
        });
        container.innerHTML = html;

        container.querySelectorAll('.edit-discipline').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                showDisciplineForm(btn.dataset.id);
            });
        });

        container.querySelectorAll('.delete-discipline').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                deleteDisciplineHandler(btn.dataset.id);
            });
        });
    }

    // ============================================================
    // GET DISCIPLINES - READ-ONLY ACCESSOR
    // ============================================================

    function getDisciplines() {
        if (window.data && 
            window.data.curriculum && 
            Array.isArray(window.data.curriculum.disciplines)) {
            return window.data.curriculum.disciplines.slice();
        }
        return [];
    }

    // ============================================================
    // GET DISCIPLINE BY ID - READ-ONLY ACCESSOR
    // ============================================================

    function getDiscipline(id) {
        var disciplines = getDisciplines();
        return disciplines.find(function(d) {
            return String(d.id) === String(id);
        }) || null;
    }

    // ============================================================
    // GET INSTRUCTOR NAMES (shared utility)
    // ============================================================

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
    // REFRESH DEPENDENT VIEWS
    // ============================================================

    function refreshDependentViews() {
        // Groups may be affected by discipline changes (instructors, etc.)
        if (typeof window.refreshGroupsView === 'function') {
            window.refreshGroupsView();
        }

        // Instructor calendars may be affected
        if (typeof window.renderInstructorCalendar === 'function') {
            window.renderInstructorCalendar();
        }

        // Student schedules may be affected
        if (typeof window.renderStudentScheduleView === 'function') {
            window.renderStudentScheduleView();
        } else if (typeof window.renderStudentSchedule === 'function') {
            window.renderStudentSchedule();
        }

        // Dashboard stats
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
    }

    // ============================================================
    // DELETE DISCIPLINE HANDLER
    // ============================================================

    function deleteDisciplineHandler(id) {
        var discipline = getDiscipline(id);
        if (!discipline) {
            showNotification('Discipline not found.', 'error');
            return;
        }

        if (!confirm('Delete "' + discipline.name + '" permanently? This will remove it from all schedules.')) {
            return;
        }

        var result = window.deleteDiscipline(id);
        if (result && result.success) {
            renderDisciplines();
            refreshDependentViews();

            if (typeof window.saveData === 'function') {
                window.saveData()
                    .then(function() {
                        showNotification('Discipline deleted successfully!', 'success');
                    })
                    .catch(function(err) {
                        console.error('Failed to save discipline deletion:', err);
                        showNotification('Discipline deleted in memory, but persistence failed.', 'error');
                    });
            } else {
                showNotification('Discipline deleted successfully!', 'success');
            }
        } else {
            showNotification(result && result.message ? result.message : 'Failed to delete discipline.', 'error');
        }
    }

    // ============================================================
    // SHOW DISCIPLINE FORM
    // ============================================================

    function showDisciplineForm(editId) {
        var modal = document.getElementById('discipline-form-modal');
        var title = document.getElementById('discipline-form-title');
        var form = document.getElementById('discipline-form-inner');

        if (!modal || !title || !form) {
            showNotification('Form elements not found. Please refresh.', 'error');
            return;
        }

        modal.classList.remove('hidden');

        // Reset form first
        form.reset();

        if (editId) {
            title.textContent = 'Edit Discipline';
            var discipline = getDiscipline(editId);

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

                var container = document.getElementById('instructors-container');
                container.innerHTML = '';
                if (discipline.instructorIds && discipline.instructorIds.length > 0) {
                    discipline.instructorIds.forEach(function(id) {
                        addInstructorEntry(container, id);
                    });
                } else {
                    addInstructorEntry(container);
                }

                var gradingContainer = document.getElementById('grading-system-container');
                gradingContainer.innerHTML = '';
                if (discipline.gradingSystem && discipline.gradingSystem.length > 0) {
                    discipline.gradingSystem.forEach(function(g) {
                        addGradingEntry(gradingContainer, g.letter, g.min, g.max);
                    });
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

            var container = document.getElementById('instructors-container');
            container.innerHTML = '';
            addInstructorEntry(container);

            var gradingContainer = document.getElementById('grading-system-container');
            gradingContainer.innerHTML = '';
            addGradingEntry(gradingContainer);
            delete form.dataset.editId;
        }
    }

    // ============================================================
    // ADD INSTRUCTOR ENTRY (self-contained, populates its own options)
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

        instructors.forEach(function(instructor) {
            var name = window.getDisplayName(instructor);
            var option = document.createElement('option');
            option.value = instructor.id;
            option.textContent = name;
            if (selectedId && String(instructor.id) === String(selectedId)) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'small danger remove-instructor';
        removeBtn.textContent = '✕';
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

    function addGradingEntry(container, letter, min, max) {
        var entry = document.createElement('div');
        entry.className = 'grading-entry';
        entry.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;align-items:center;';

        var letterInput = document.createElement('input');
        letterInput.type = 'text';
        letterInput.className = 'grading-letter';
        letterInput.placeholder = 'Letter';
        letterInput.style.cssText = 'width:80px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:0.78rem;';
        if (letter) letterInput.value = letter;

        var minInput = document.createElement('input');
        minInput.type = 'number';
        minInput.className = 'grading-min';
        minInput.placeholder = 'Min %';
        minInput.style.cssText = 'width:80px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:0.78rem;';
        minInput.min = '0';
        minInput.max = '100';
        if (min !== undefined && min !== null) minInput.value = min;

        var maxInput = document.createElement('input');
        maxInput.type = 'number';
        maxInput.className = 'grading-max';
        maxInput.placeholder = 'Max %';
        maxInput.style.cssText = 'width:80px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:0.78rem;';
        maxInput.min = '0';
        maxInput.max = '100';
        if (max !== undefined && max !== null) maxInput.value = max;

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'small danger remove-grading';
        removeBtn.textContent = '✕';
        removeBtn.style.cssText = 'padding:4px 8px;font-size:0.65rem;';
        removeBtn.addEventListener('click', function() {
            if (container.children.length > 1) {
                entry.remove();
            } else {
                showNotification('You need at least one grade level.', 'error');
            }
        });

        entry.appendChild(letterInput);
        entry.appendChild(minInput);
        entry.appendChild(maxInput);
        entry.appendChild(removeBtn);
        container.appendChild(entry);
    }

    // ============================================================
    // COLLECT INSTRUCTOR IDS - SCOPED TO FORM, DEDUPLICATED
    // ============================================================

    function collectInstructorIds(form) {
        var ids = [];
        form.querySelectorAll('.instructor-select').forEach(function(select) {
            if (select.value && ids.indexOf(select.value) === -1) {
                ids.push(select.value);
            }
        });
        return ids;
    }

    // ============================================================
    // COLLECT GRADING SYSTEM - SCOPED TO FORM
    // ============================================================

    function collectGradingSystem(form) {
        var system = [];
        form.querySelectorAll('.grading-entry').forEach(function(entry) {
            var letterInput = entry.querySelector('.grading-letter');
            var minInput = entry.querySelector('.grading-min');
            var maxInput = entry.querySelector('.grading-max');
            
            if (!letterInput || !minInput || !maxInput) return;
            
            var letter = letterInput.value.trim();
            var min = minInput.value;
            var max = maxInput.value;
            
            if (letter && min !== '' && max !== '') {
                var minNum = parseFloat(min);
                var maxNum = parseFloat(max);
                if (!isNaN(minNum) && !isNaN(maxNum) && minNum >= 0 && maxNum <= 100 && minNum <= maxNum) {
                    system.push({ 
                        letter: letter, 
                        min: minNum, 
                        max: maxNum 
                    });
                }
            }
        });
        return system;
    }

    // ============================================================
    // VALIDATE GRADING SYSTEM
    // ============================================================

    function validateGradingSystem(system) {
        if (system.length === 0) {
            return { valid: true }; // Empty grading system is allowed
        }

        // Check for overlapping ranges
        for (var i = 0; i < system.length; i++) {
            for (var j = i + 1; j < system.length; j++) {
                var a = system[i];
                var b = system[j];
                if (a.min <= b.max && b.min <= a.max) {
                    return { 
                        valid: false, 
                        message: 'Grading ranges for "' + a.letter + '" and "' + b.letter + '" overlap.' 
                    };
                }
            }
        }

        // Check for duplicate letters (case-insensitive)
        var letters = {};
        for (var i = 0; i < system.length; i++) {
            var letter = system[i].letter.trim().toUpperCase();
            if (letters[letter]) {
                return { 
                    valid: false, 
                    message: 'Duplicate grade letter "' + system[i].letter + '".' 
                };
            }
            letters[letter] = true;
        }

        return { valid: true };
    }

    // ============================================================
    // VALIDATE DISCIPLINE FORM DATA
    // ============================================================

    function validateDisciplineData(data) {
        if (!data.name) {
            return { valid: false, message: 'Discipline name is required.' };
        }
        if (!data.type) {
            return { valid: false, message: 'Please select a discipline type.' };
        }
        if (data.instructorIds.length === 0) {
            return { valid: false, message: 'Please select at least one instructor.' };
        }
        
        // Validate start week
        if (data.startWeek !== '' && data.startWeek !== undefined) {
            var start = parseInt(data.startWeek, 10);
            if (isNaN(start) || start < 1 || start > 52) {
                return { valid: false, message: 'Start week must be between 1 and 52.' };
            }
        }

        // Validate end week
        if (data.endWeek !== '' && data.endWeek !== undefined) {
            var end = parseInt(data.endWeek, 10);
            if (isNaN(end) || end < 1 || end > 52) {
                return { valid: false, message: 'End week must be between 1 and 52.' };
            }
        }

        // Validate week range
        if (data.startWeek !== '' && data.endWeek !== '') {
            var start = parseInt(data.startWeek, 10);
            var end = parseInt(data.endWeek, 10);
            if (!isNaN(start) && !isNaN(end) && start > end) {
                return { valid: false, message: 'Start week must be before end week.' };
            }
        }
        
        // Validate hours
        if (data.weeklyHours !== '' && data.weeklyHours !== undefined) {
            var hours = parseFloat(data.weeklyHours);
            if (isNaN(hours) || hours < 0 || hours > 40) {
                return { valid: false, message: 'Weekly hours must be between 0 and 40.' };
            }
        }
        
        // Validate max students
        if (data.maxStudents !== '' && data.maxStudents !== undefined) {
            var students = parseInt(data.maxStudents, 10);
            if (isNaN(students) || students < 0 || students > 100) {
                return { valid: false, message: 'Max students must be between 0 and 100.' };
            }
        }
        
        // Validate weight
        if (data.weight !== '' && data.weight !== undefined) {
            var weight = parseFloat(data.weight);
            if (isNaN(weight) || weight < 0.1 || weight > 10) {
                return { valid: false, message: 'Weight must be between 0.1 and 10.' };
            }
        }

        return { valid: true };
    }

    // ============================================================
    // SAVE DISCIPLINE
    // ============================================================

    function saveDiscipline(e) {
        e.preventDefault();
        var form = e.target;
        var editId = form.dataset.editId;

        var instructorIds = collectInstructorIds(form);
        var gradingSystem = collectGradingSystem(form);

        var gradingValidation = validateGradingSystem(gradingSystem);
        if (!gradingValidation.valid) {
            showNotification(gradingValidation.message, 'error');
            return;
        }

        var name = document.getElementById('discipline-name').value.trim();
        var type = document.getElementById('discipline-type').value;
        var curriculum = document.getElementById('discipline-curriculum').value.trim();
        var startWeek = document.getElementById('discipline-start-week').value;
        var endWeek = document.getElementById('discipline-end-week').value;
        var hours = document.getElementById('discipline-hours').value;
        var students = document.getElementById('discipline-students').value;
        var weight = document.getElementById('discipline-weight').value;

        var weeklyHours = (hours !== '' && hours !== undefined && hours !== null) ? parseFloat(hours) : '';
        var maxStudents = (students !== '' && students !== undefined && students !== null) ? parseInt(students, 10) : '';
        var disciplineWeight = (weight !== '' && weight !== undefined && weight !== null) ? parseFloat(weight) : 1;

        var disciplineData = {
            name: name,
            type: type,
            instructorIds: instructorIds,
            curriculum: curriculum,
            startWeek: startWeek,
            endWeek: endWeek,
            weeklyHours: weeklyHours,
            maxStudents: maxStudents,
            weight: disciplineWeight,
            gradingSystem: gradingSystem
        };

        var validation = validateDisciplineData(disciplineData);
        if (!validation.valid) {
            showNotification(validation.message, 'error');
            return;
        }

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
        renderDisciplines();
        refreshDependentViews();

        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    showNotification(editId ? 'Discipline updated successfully!' : 'Discipline created successfully!', 'success');
                })
                .catch(function(err) {
                    console.error('Failed to save discipline:', err);
                    showNotification('Discipline changed in memory, but persistence failed.', 'error');
                });
        } else {
            showNotification(editId ? 'Discipline updated successfully!' : 'Discipline created successfully!', 'success');
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
        } else {
            console.log('[Disciplines]', message);
        }
    }

    // ============================================================
    // EVENT INITIALISATION
    // ============================================================

    function initDisciplineEvents() {
        var addBtn = document.getElementById('add-discipline-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() {
                showDisciplineForm();
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
            form.addEventListener('submit', saveDiscipline);
        }

        var modal = document.getElementById('discipline-form-modal');
        if (modal) {
            modal.addEventListener('click', function(e) {
                if (e.target === this) this.classList.add('hidden');
            });
        }

        var addGradingBtn = document.getElementById('add-grading-btn');
        if (addGradingBtn) {
            addGradingBtn.addEventListener('click', function() {
                var container = document.getElementById('grading-system-container');
                addGradingEntry(container);
            });
        }

        var addInstructorBtn = document.getElementById('add-instructor-btn');
        if (addInstructorBtn) {
            addInstructorBtn.addEventListener('click', function() {
                var container = document.getElementById('instructors-container');
                addInstructorEntry(container);
            });
        }

        var filterSelect = document.getElementById('discipline-filter');
        if (filterSelect) {
            filterSelect.addEventListener('change', function() {
                renderDisciplines();
            });
        }
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderDisciplinesView = renderDisciplinesView;

})();
