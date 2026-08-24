/**
 * js/modules/curriculum/disciplines.js - Discipline Management
 * CRUD operations for disciplines
 * Path: js/modules/curriculum/disciplines.js
 */

(function() {
    'use strict';

    function renderDisciplinesView(container) {
        if (!container) {
            container = document.getElementById('disciplines-content');
        }
        if (!container) return;

        // Check if data exists
        if (!window.data) {
            console.warn('No data available for disciplines, waiting for dataReady event');
            container.innerHTML = '<p class="empty-state">Loading disciplines data...</p>';
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
        if (!window.data.curriculum.disciplines) {
            window.data.curriculum.disciplines = [];
        }

        container.innerHTML = getDisciplinesHTML();
        renderDisciplines();
        initDisciplineEvents();
    }

    function getDisciplinesHTML() {
        return `
            <div class="page-header">
                <h2>Disciplines</h2>
                <button id="add-discipline-btn" class="primary">+ Add Discipline</button>
            </div>
            <div id="discipline-list">
                <div class="list-header">
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
            <div id="discipline-form" class="form-container hidden">
                <h3 id="discipline-form-title">Add Discipline</h3>
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
                            <input type="number" id="discipline-start-week" min="1" max="52">
                        </div>
                        <div class="form-group">
                            <label>End Week</label>
                            <input type="number" id="discipline-end-week" min="1" max="52">
                        </div>
                        <div class="form-group">
                            <label>Weekly Hours</label>
                            <input type="number" id="discipline-hours" min="1" max="40" step="0.5">
                        </div>
                        <div class="form-group">
                            <label>Max Students per Class</label>
                            <input type="number" id="discipline-students" min="1" max="100">
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
                        <button type="button" id="cancel-discipline-btn" class="secondary">Cancel</button>
                        <button type="submit" id="save-discipline-btn" class="primary">Save Discipline</button>
                    </div>
                </form>
            </div>
        `;
    }

    function renderDisciplines() {
        var container = document.getElementById('disciplines-container');
        if (!container) return;

        var data = window.data || {};
        if (!data.curriculum) {
            data.curriculum = { disciplines: [], schedules: {}, restDays: {}, examDays: {}, grades: {}, rankings: {}, currentWeek: 1 };
        }
        if (!data.curriculum.disciplines) {
            data.curriculum.disciplines = [];
        }

        if (data.curriculum.disciplines.length === 0) {
            container.innerHTML = '<p class="empty-state">No disciplines created yet. Add your first discipline!</p>';
            return;
        }

        var html = '';
        data.curriculum.disciplines.forEach(function(d) {
            var instructors = window.getInstructorNames(d);
            var instructorDisplay = instructors.length > 0 ? instructors.join(', ') : 'Not assigned';
            var weekDisplay = d.startWeek ? 'Wk ' + d.startWeek : '?';
            if (d.endWeek) weekDisplay += ' - Wk ' + d.endWeek;

            var typeLabel = d.type === 'mandatory' ? '■ Mandatory' : (d.type === 'optional' ? '□ Optional' : '—');
            var typeColor = d.type === 'mandatory' ? 'var(--accent)' : (d.type === 'optional' ? 'var(--warning)' : 'var(--text-dim)');

            html += '<div class="list-item" data-id="' + d.id + '">' +
                '<span><strong>' + d.name + '</strong></span>' +
                '<span style="color:' + typeColor + ';font-size:0.75rem;">' + typeLabel + '</span>' +
                '<span style="font-size:0.75rem;">' + instructorDisplay + '</span>' +
                '<span>' + weekDisplay + '</span>' +
                '<span>' + (d.weeklyHours || '-') + 'h</span>' +
                '<span>' + (d.maxStudents || '-') + '</span>' +
                '<span class="actions">' +
                    '<button class="small edit-discipline" data-id="' + d.id + '">Edit</button>' +
                    '<button class="small danger delete-discipline" data-id="' + d.id + '">Delete</button>' +
                '</span>' +
            '</div>';
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
                deleteDiscipline(btn.dataset.id);
            });
        });
    }

    function showDisciplineForm(editId) {
        var form = document.getElementById('discipline-form');
        var title = document.getElementById('discipline-form-title');
        var formElement = document.getElementById('discipline-form-inner');
        form.classList.remove('hidden');

        populateInstructorSelects();

        if (editId) {
            title.textContent = 'Edit Discipline';
            var data = window.data || {};
            var discipline = data.curriculum.disciplines.find(function(d) { return String(d.id) === String(editId); });
            if (discipline) {
                document.getElementById('discipline-name').value = discipline.name || '';
                document.getElementById('discipline-type').value = discipline.type || '';
                document.getElementById('discipline-curriculum').value = discipline.curriculum || '';
                document.getElementById('discipline-start-week').value = discipline.startWeek || '';
                document.getElementById('discipline-end-week').value = discipline.endWeek || '';
                document.getElementById('discipline-hours').value = discipline.weeklyHours || '';
                document.getElementById('discipline-students').value = discipline.maxStudents || '';
                document.getElementById('discipline-weight').value = discipline.weight || 1;

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
                formElement.dataset.editId = editId;
            }
        } else {
            title.textContent = 'Add Discipline';
            formElement.reset();
            document.getElementById('discipline-weight').value = 1;

            var container = document.getElementById('instructors-container');
            container.innerHTML = '';
            addInstructorEntry(container);

            var gradingContainer = document.getElementById('grading-system-container');
            gradingContainer.innerHTML = '';
            addGradingEntry(gradingContainer);
            delete formElement.dataset.editId;
        }
        form.scrollIntoView({ behavior: 'smooth' });
    }

    function hideDisciplineForm() {
        document.getElementById('discipline-form').classList.add('hidden');
    }

    function populateInstructorSelects() {
        var selects = document.querySelectorAll('.instructor-select');
        var instructors = window.getInstructors();

        selects.forEach(function(select) {
            var currentValue = select.value;
            select.innerHTML = '<option value="">Select instructor...</option>';
            instructors.forEach(function(instructor) {
                var name = window.getDisplayName(instructor);
                var option = document.createElement('option');
                option.value = instructor.id;
                option.textContent = name;
                select.appendChild(option);
            });
            if (currentValue) select.value = currentValue;
        });
    }

    function addInstructorEntry(container, selectedId) {
        var entry = document.createElement('div');
        entry.className = 'instructor-entry';
        entry.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;align-items:center;';

        var select = document.createElement('select');
        select.className = 'instructor-select';
        select.style.cssText = 'flex:1;min-width:120px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:0.78rem;font-family:Inter,sans-serif;';
        select.innerHTML = '<option value="">Select instructor...</option>';

        var instructors = window.getInstructors();
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
        removeBtn.onclick = function() {
            if (container.children.length > 1) {
                entry.remove();
            } else {
                alert('You need at least one instructor.');
            }
        };

        entry.appendChild(select);
        entry.appendChild(removeBtn);
        container.appendChild(entry);
    }

    function addGradingEntry(container, letter, min, max) {
        var entry = document.createElement('div');
        entry.className = 'grading-entry';
        entry.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;align-items:center;';
        entry.innerHTML = `
            <input type="text" class="grading-letter" placeholder="Letter" value="${letter || ''}" style="width:80px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:0.78rem;">
            <input type="number" class="grading-min" placeholder="Min %" value="${min || ''}" style="width:80px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:0.78rem;" min="0" max="100">
            <input type="number" class="grading-max" placeholder="Max %" value="${max || ''}" style="width:80px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:0.78rem;" min="0" max="100">
            <button type="button" class="small danger remove-grading" style="padding:4px 8px;font-size:0.65rem;">✕</button>
        `;
        container.appendChild(entry);
        entry.querySelector('.remove-grading').onclick = function() {
            if (container.children.length > 1) entry.remove();
            else alert('You need at least one grade level.');
        };
    }

    function saveDiscipline(e) {
        e.preventDefault();
        var form = e.target;
        var editId = form.dataset.editId;

        var instructorIds = [];
        document.querySelectorAll('.instructor-select').forEach(function(select) {
            if (select.value) {
                instructorIds.push(select.value);
            }
        });

        if (instructorIds.length === 0) {
            alert('Please select at least one instructor.');
            return;
        }

        var gradingSystem = [];
        document.querySelectorAll('.grading-entry').forEach(function(entry) {
            var letter = entry.querySelector('.grading-letter').value.trim();
            var min = entry.querySelector('.grading-min').value;
            var max = entry.querySelector('.grading-max').value;
            if (letter && min && max) {
                gradingSystem.push({ letter: letter, min: parseFloat(min), max: parseFloat(max) });
            }
        });

        var disciplineData = {
            name: document.getElementById('discipline-name').value.trim(),
            type: document.getElementById('discipline-type').value,
            instructorIds: instructorIds,
            curriculum: document.getElementById('discipline-curriculum').value.trim(),
            startWeek: document.getElementById('discipline-start-week').value || '',
            endWeek: document.getElementById('discipline-end-week').value || '',
            weeklyHours: parseFloat(document.getElementById('discipline-hours').value) || '',
            maxStudents: parseInt(document.getElementById('discipline-students').value) || '',
            weight: parseFloat(document.getElementById('discipline-weight').value) || 1,
            gradingSystem: gradingSystem
        };

        if (!disciplineData.name) { alert('Discipline name is required.'); return; }
        if (!disciplineData.type) { alert('Please select a discipline type.'); return; }

        var data = window.data || {};
        if (!data.curriculum) {
            data.curriculum = { disciplines: [], schedules: {}, restDays: {}, examDays: {}, grades: {}, rankings: {}, currentWeek: 1 };
        }

        if (editId) {
            var index = data.curriculum.disciplines.findIndex(function(d) { return String(d.id) === String(editId); });
            if (index !== -1) {
                data.curriculum.disciplines[index] = Object.assign({}, data.curriculum.disciplines[index], disciplineData);
                if (typeof window.logActivity === 'function') {
                    window.logActivity('Updated discipline: ' + disciplineData.name);
                }
            }
        } else {
            var newDiscipline = {
                id: window.generateId('disc'),
                name: disciplineData.name,
                type: disciplineData.type,
                instructorIds: disciplineData.instructorIds,
                curriculum: disciplineData.curriculum,
                startWeek: disciplineData.startWeek,
                endWeek: disciplineData.endWeek,
                weeklyHours: disciplineData.weeklyHours,
                maxStudents: disciplineData.maxStudents,
                weight: disciplineData.weight,
                gradingSystem: disciplineData.gradingSystem,
                createdAt: new Date().toISOString()
            };
            data.curriculum.disciplines.push(newDiscipline);
            if (typeof window.logActivity === 'function') {
                window.logActivity('Added discipline: ' + disciplineData.name + ' (' + disciplineData.type + ')');
            }
        }

        window.data = data;
        if (typeof window.saveData === 'function') {
            window.saveData().then(function() {
                renderDisciplines();
                hideDisciplineForm();
                if (typeof window.renderAllSections === 'function') {
                    window.renderAllSections();
                }
                if (typeof window.updateDashboardStats === 'function') {
                    window.updateDashboardStats();
                }
            }).catch(function(err) {
                console.error('Failed to save discipline:', err);
                renderDisciplines();
                hideDisciplineForm();
            });
        } else {
            renderDisciplines();
            hideDisciplineForm();
        }
    }

    function deleteDiscipline(id) {
        if (!confirm('Delete this discipline permanently? This will remove it from all schedules.')) return;

        var data = window.data || {};
        var discipline = data.curriculum.disciplines.find(function(d) { return String(d.id) === String(id); });
        if (!discipline) return;

        if (data.curriculum.schedules) {
            for (var studentId in data.curriculum.schedules) {
                for (var week in data.curriculum.schedules[studentId]) {
                    var schedule = data.curriculum.schedules[studentId][week];
                    for (var day in schedule) {
                        for (var hour in schedule[day]) {
                            if (String(schedule[day][hour]) === String(id)) {
                                delete schedule[day][hour];
                            }
                        }
                    }
                }
            }
        }

        data.curriculum.disciplines = data.curriculum.disciplines.filter(function(d) { return String(d.id) !== String(id); });
        if (typeof window.logActivity === 'function') {
            window.logActivity('Deleted discipline: ' + discipline.name);
        }
        if (typeof window.saveData === 'function') {
            window.saveData().then(function() {
                renderDisciplines();
                if (typeof window.renderAllSections === 'function') {
                    window.renderAllSections();
                }
                if (typeof window.updateDashboardStats === 'function') {
                    window.updateDashboardStats();
                }
            }).catch(function(err) {
                console.error('Failed to delete discipline:', err);
                renderDisciplines();
            });
        } else {
            renderDisciplines();
        }
    }

    function initDisciplineEvents() {
        var addBtn = document.getElementById('add-discipline-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() { showDisciplineForm(); });
        }

        var cancelBtn = document.getElementById('cancel-discipline-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', hideDisciplineForm);
        }

        var form = document.getElementById('discipline-form-inner');
        if (form) {
            form.addEventListener('submit', saveDiscipline);
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
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('disciplines', renderDisciplinesView);
    }

    document.addEventListener('dataReady', function() {
        var container = document.getElementById('disciplines-content');
        if (container && container.style.display !== 'none') {
            renderDisciplinesView(container);
        }
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'disciplines') {
            var container = document.getElementById('disciplines-content');
            if (container) {
                renderDisciplinesView(container);
            }
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('disciplines-content');
            if (container && container.style.display !== 'none') {
                renderDisciplinesView(container);
            }
        }, 100);
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderDisciplinesView = renderDisciplinesView;
    window.renderDisciplines = renderDisciplines;
    window.showDisciplineForm = showDisciplineForm;
    window.hideDisciplineForm = hideDisciplineForm;
    window.saveDiscipline = saveDiscipline;
    window.deleteDiscipline = deleteDiscipline;
    window.addGradingEntry = addGradingEntry;
    window.addInstructorEntry = addInstructorEntry;
    window.initDisciplineEvents = initDisciplineEvents;

    console.log('disciplines.js loaded');

})();
