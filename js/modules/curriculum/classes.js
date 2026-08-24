/**
 * js/modules/curriculum/classes.js - Class Management Module
 * Handles class CRUD, roster view, and auto-distribution
 * Path: js/modules/curriculum/classes.js
 */

(function() {
    'use strict';

    var state = {
        selectedClassId: null,
        viewMode: 'roster',
        distributionWeek: 1,
        maxTeamSize: 4
    };

    function renderClassesView(container) {
        if (!container) {
            container = document.getElementById('classes-content');
        }
        if (!container) return;

        // Check if data exists
        if (!window.data) {
            console.warn('No data available for classes, waiting for dataReady event');
            container.innerHTML = '<p class="empty-state">Loading class data...</p>';
            return;
        }

        // Ensure classes array exists
        if (!window.data.classes) {
            window.data.classes = [];
        }

        container.innerHTML = getClassesHTML();
        renderClassList();
        renderClassDetail();
        initClassEvents();
    }

    function getClassesHTML() {
        return `
            <div class="page-header">
                <h2>Academic Classes</h2>
                <button id="add-class-btn" class="primary">+ New Class</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 2fr;gap:16px;">
                <div id="class-list-container" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;max-height:500px;overflow-y:auto;">
                    <div id="class-list">
                        <p class="empty-state">No classes created yet.</p>
                    </div>
                </div>
                <div id="class-detail-container" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;">
                    <div id="class-detail">
                        <p class="empty-state">Select a class to view details.</p>
                    </div>
                </div>
            </div>

            <!-- Add/Edit Class Modal -->
            <div id="class-form-modal" class="modal hidden">
                <div class="modal-content" style="max-width:450px;">
                    <div class="modal-header">
                        <h3 id="class-form-title">Add Class</h3>
                        <button class="close-modal" id="close-class-form">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="class-form-inner">
                            <div class="form-group">
                                <label>Class Name *</label>
                                <input type="text" id="class-name" placeholder="e.g., Spring 1424, March 1436" required>
                                <span style="font-size:0.6rem;color:var(--text-dim);">Free text - use any naming convention you prefer.</span>
                            </div>
                            <div class="form-actions">
                                <button type="button" id="cancel-class-form" class="secondary">Cancel</button>
                                <button type="submit" id="save-class-btn" class="primary">Save Class</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <!-- Auto-Distribute Modal -->
            <div id="distribute-modal" class="modal hidden">
                <div class="modal-content" style="max-width:500px;">
                    <div class="modal-header">
                        <h3>Auto-Distribute Students</h3>
                        <button class="close-modal" id="close-distribute-modal">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div id="distribute-content"></div>
                    </div>
                </div>
            </div>
        `;
    }

    function renderClassList() {
        var container = document.getElementById('class-list');
        if (!container) return;

        var classes = window.getClasses();
        if (classes.length === 0) {
            container.innerHTML = '<p class="empty-state">No classes created yet. Create your first class!</p>';
            return;
        }

        var html = '';
        classes.forEach(function(cls) {
            var count = window.getCharactersByClass(cls.id).length;
            var isSelected = state.selectedClassId === cls.id;
            var teamCount = window.getTeamsByClass(cls.id).length;
            
            html += '<div class="class-list-item" style="padding:8px 12px;border-bottom:1px solid var(--border-soft);cursor:pointer;' + 
                (isSelected ? 'background:var(--accent-soft);border-left:3px solid var(--accent);' : '') + '" data-id="' + cls.id + '">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
            html += '<span style="font-weight:600;">' + cls.name + '</span>';
            html += '<span style="font-size:0.7rem;color:var(--text-dim);">' + count + ' students, ' + teamCount + ' teams</span>';
            html += '</div>';
            html += '</div>';
        });
        container.innerHTML = html;

        container.querySelectorAll('.class-list-item').forEach(function(el) {
            el.addEventListener('click', function() {
                state.selectedClassId = this.dataset.id;
                renderClassList();
                renderClassDetail();
            });
        });
    }

    function renderClassDetail() {
        var container = document.getElementById('class-detail');
        if (!container) return;

        if (!state.selectedClassId) {
            container.innerHTML = '<p class="empty-state">Select a class to view details.</p>';
            return;
        }

        var cls = window.getClass(state.selectedClassId);
        if (!cls) {
            container.innerHTML = '<p class="empty-state">Class not found.</p>';
            return;
        }

        var characters = window.getCharactersByClass(cls.id);
        var teams = window.getTeamsByClass(cls.id);
        var available = window.getAvailableStudentsForClass(cls.id, state.distributionWeek || 1);

        var html = '';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">';
        html += '<h3 style="color:var(--accent);">' + cls.name + '</h3>';
        html += '<div style="display:flex;gap:4px;">';
        html += '<button id="distribute-class-btn" class="primary small">+ Auto-Distribute</button>';
        html += '<button id="delete-class-btn" class="danger small">Delete Class</button>';
        html += '</div>';
        html += '</div>';

        html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;">';
        html += '<div style="background:var(--bg);padding:8px;border-radius:4px;text-align:center;">';
        html += '<span style="font-size:0.6rem;color:var(--text-dim);">Students</span>';
        html += '<div style="font-size:1.2rem;font-weight:700;color:var(--accent);">' + characters.length + '</div>';
        html += '</div>';
        html += '<div style="background:var(--bg);padding:8px;border-radius:4px;text-align:center;">';
        html += '<span style="font-size:0.6rem;color:var(--text-dim);">Teams</span>';
        html += '<div style="font-size:1.2rem;font-weight:700;color:var(--info);">' + teams.length + '</div>';
        html += '</div>';
        html += '<div style="background:var(--bg);padding:8px;border-radius:4px;text-align:center;">';
        html += '<span style="font-size:0.6rem;color:var(--text-dim);">Available</span>';
        html += '<div style="font-size:1.2rem;font-weight:700;color:var(--warning);">' + available.length + '</div>';
        html += '</div>';
        html += '</div>';

        // Roster
        html += '<h4 style="color:var(--text-dim);font-size:0.8rem;margin-bottom:4px;">Roster (' + characters.length + ')</h4>';
        if (characters.length === 0) {
            html += '<p class="empty-state" style="padding:8px;font-size:0.75rem;">No students in this class.</p>';
        } else {
            html += '<div style="display:flex;flex-wrap:wrap;gap:4px;max-height:150px;overflow-y:auto;padding:4px;background:var(--bg);border-radius:4px;">';
            characters.forEach(function(char) {
                var name = window.getDisplayName(char);
                var status = window.getCurrentStatus(char);
                var isDeceased = char.deceased || false;
                html += '<span style="background:var(--panel-alt);padding:2px 10px;border-radius:12px;font-size:0.7rem;' + 
                    (isDeceased ? 'opacity:0.4;text-decoration:line-through;' : '') + '">' + 
                    name + ' <span style="color:var(--text-dim);font-size:0.6rem;">(' + status + ')</span></span>';
            });
            html += '</div>';
        }

        // Teams
        html += '<h4 style="color:var(--text-dim);font-size:0.8rem;margin:8px 0 4px 0;">Teams (' + teams.length + ')</h4>';
        if (teams.length === 0) {
            html += '<p class="empty-state" style="padding:8px;font-size:0.75rem;">No academic teams for this class. Create teams in the Teams tab.</p>';
        } else {
            html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
            teams.forEach(function(team) {
                var memberCount = team.members ? team.members.length : 0;
                html += '<span style="background:var(--panel-alt);padding:2px 10px;border-radius:12px;font-size:0.7rem;border:1px solid var(--border-soft);">';
                html += '<strong>' + team.name + '</strong>';
                if (team.teamNumber) html += ' (#' + team.teamNumber + ')';
                html += ' - ' + memberCount + ' members';
                html += '</span>';
            });
            html += '</div>';
        }

        container.innerHTML = html;

        var distributeBtn = document.getElementById('distribute-class-btn');
        if (distributeBtn) {
            distributeBtn.addEventListener('click', function() {
                showDistributeModal(cls.id);
            });
        }

        var deleteBtn = document.getElementById('delete-class-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', function() {
                var result = window.deleteClass(cls.id);
                if (result.success) {
                    state.selectedClassId = null;
                    renderClassList();
                    renderClassDetail();
                    if (typeof window.updateDashboardStats === 'function') {
                        window.updateDashboardStats();
                    }
                }
            });
        }
    }

    function showDistributeModal(classId) {
        var cls = window.getClass(classId);
        if (!cls) return;

        var teams = window.getTeamsByClass(classId);
        var available = window.getAvailableStudentsForClass(classId, state.distributionWeek || 1);

        if (teams.length === 0) {
            alert('No academic teams found for this class. Create teams first in the Teams tab.');
            return;
        }

        if (available.length === 0) {
            alert('No available students for this class at week ' + (state.distributionWeek || 1) + '. All students may already be in teams.');
            return;
        }

        var modal = document.getElementById('distribute-modal');
        var content = document.getElementById('distribute-content');

        var html = '';
        html += '<p style="color:var(--text-dim);font-size:0.85rem;margin-bottom:12px;">';
        html += 'Distribute <strong>' + available.length + '</strong> available students across selected teams.';
        html += ' Students will be assigned as "Member" with join period = selected week.';
        html += '</p>';

        html += '<div class="form-group">';
        html += '<label>Week:</label>';
        html += '<input type="number" id="distribute-week" value="' + (state.distributionWeek || 1) + '" min="1" max="52" style="width:80px;padding:4px 8px;">';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label>Max Students Per Team:</label>';
        html += '<input type="number" id="distribute-max-size" value="' + (state.maxTeamSize || 4) + '" min="1" max="20" style="width:80px;padding:4px 8px;">';
        html += '</div>';

        html += '<div style="margin:12px 0;">';
        html += '<label style="font-weight:600;color:var(--text-dim);">Select Teams:</label>';
        html += '<div id="distribute-team-list" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;">';
        teams.forEach(function(team) {
            var memberCount = team.members ? team.members.length : 0;
            var checked = memberCount < (state.maxTeamSize || 4) ? 'checked' : '';
            var disabled = memberCount >= (state.maxTeamSize || 4) ? 'disabled' : '';
            html += '<label style="display:flex;align-items:center;gap:4px;font-size:0.75rem;cursor:pointer;padding:4px 8px;background:var(--bg);border-radius:4px;border:1px solid var(--border-soft);">';
            html += '<input type="checkbox" class="team-checkbox" value="' + team.id + '" ' + checked + ' ' + disabled + '>';
            html += team.name + (team.teamNumber ? ' (#' + team.teamNumber + ')' : '') + ' (' + memberCount + ' members)';
            if (disabled) html += ' <span style="color:var(--danger);font-size:0.6rem;">FULL</span>';
            html += '</label>';
        });
        html += '</div>';
        html += '</div>';

        html += '<div style="padding:8px;background:var(--bg);border-radius:4px;font-size:0.75rem;color:var(--text-dim);">';
        html += 'Students will be distributed evenly across selected teams.';
        html += ' If a student has a conflict (already in a class at that time), you will be prompted to override.';
        html += '</div>';

        html += '<div class="form-actions" style="margin-top:16px;">';
        html += '<button type="button" id="cancel-distribute" class="secondary">Cancel</button>';
        html += '<button type="button" id="confirm-distribute" class="primary">Distribute Students</button>';
        html += '</div>';

        content.innerHTML = html;
        modal.dataset.classId = classId;
        modal.classList.remove('hidden');

        document.getElementById('cancel-distribute').onclick = function() {
            modal.classList.add('hidden');
        };

        document.getElementById('close-distribute-modal').onclick = function() {
            modal.classList.add('hidden');
        };

        modal.addEventListener('click', function(e) {
            if (e.target === modal) modal.classList.add('hidden');
        });

        document.getElementById('confirm-distribute').onclick = function() {
            executeDistribution(classId);
        };
    }

    function executeDistribution(classId) {
        var week = parseInt(document.getElementById('distribute-week').value) || 1;
        var maxSize = parseInt(document.getElementById('distribute-max-size').value) || 4;
        
        var selectedTeamIds = [];
        document.querySelectorAll('.team-checkbox:checked').forEach(function(cb) {
            selectedTeamIds.push(cb.value);
        });

        if (selectedTeamIds.length === 0) {
            alert('Please select at least one team.');
            return;
        }

        var teams = selectedTeamIds.map(function(id) { return window.getTeamById(id); }).filter(function(t) { return t; });
        var available = window.getAvailableStudentsForClass(classId, week);

        if (available.length === 0) {
            alert('No available students for this class at week ' + week + '.');
            return;
        }

        var totalCapacity = teams.length * maxSize;
        if (available.length > totalCapacity) {
            if (!confirm('You have ' + available.length + ' students but only ' + totalCapacity + ' slots available.\n\nSome students will not be assigned. Continue?')) {
                return;
            }
        }

        // Shuffle available students
        var shuffled = available.slice();
        for (var i = shuffled.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var temp = shuffled[i];
            shuffled[i] = shuffled[j];
            shuffled[j] = temp;
        }

        var assigned = 0;
        var skipped = 0;

        var teamSizes = {};
        teams.forEach(function(t) {
            teamSizes[t.id] = t.members ? t.members.length : 0;
        });

        for (var i = 0; i < shuffled.length; i++) {
            var student = shuffled[i];
            
            var availableTeams = teams.filter(function(t) {
                return teamSizes[t.id] < maxSize;
            });
            
            if (availableTeams.length === 0) break;
            
            availableTeams.sort(function(a, b) {
                return teamSizes[a.id] - teamSizes[b.id];
            });
            
            var targetTeam = availableTeams[0];
            
            var schedule = window.getStudentSchedule(student.id, week);
            var hasConflict = false;
            
            for (var day in schedule) {
                for (var hour in schedule[day]) {
                    if (schedule[day][hour]) {
                        hasConflict = true;
                        break;
                    }
                }
                if (hasConflict) break;
            }
            
            if (hasConflict) {
                var studentName = window.getDisplayName(student);
                if (confirm(studentName + ' already has classes in week ' + week + '.\n\nAdd them to ' + targetTeam.name + ' anyway? (This will overwrite their existing schedule)')) {
                    // Remove existing classes
                    for (var day in schedule) {
                        for (var hour in schedule[day]) {
                            if (schedule[day][hour]) {
                                delete schedule[day][hour];
                                window.setClassInstructor(student.id, week, parseInt(day), parseInt(hour), null);
                                window.setClassLabel(student.id, week, parseInt(day), parseInt(hour), null);
                                window.setClassGroupLabel(student.id, week, parseInt(day), parseInt(hour), null);
                                window.setClassDuration(student.id, week, parseInt(day), parseInt(hour), null);
                            }
                        }
                    }
                    addStudentToTeam(student.id, targetTeam.id, week);
                    teamSizes[targetTeam.id]++;
                    assigned++;
                } else {
                    skipped++;
                }
            } else {
                addStudentToTeam(student.id, targetTeam.id, week);
                teamSizes[targetTeam.id]++;
                assigned++;
            }
        }

        if (typeof window.saveData === 'function') {
            window.saveData().then(function() {
                if (typeof window.logActivity === 'function') {
                    window.logActivity('Auto-distributed ' + assigned + ' students for class ' + window.getClassDisplayName(classId));
                }
                document.getElementById('distribute-modal').classList.add('hidden');
                renderClassDetail();
                if (typeof window.renderStudentSchedule === 'function') {
                    window.renderStudentSchedule();
                }
                if (typeof window.renderTeamManager === 'function') {
                    var teamContainer = document.getElementById('tab-teams');
                    if (teamContainer) {
                        window.renderTeamManager(teamContainer);
                    }
                }
                var msg = 'Distribution complete!\n\n' +
                    'Assigned: ' + assigned + ' students\n' +
                    'Skipped: ' + skipped + ' students (conflicts)\n';
                if (assigned === 0) {
                    msg += '\nNo students were assigned. Please check team capacity and student availability.';
                }
                alert(msg);
            }).catch(function(err) {
                alert('Failed to save distribution: ' + err.message);
            });
        } else {
            document.getElementById('distribute-modal').classList.add('hidden');
            renderClassDetail();
            alert('Distribution complete! ' + assigned + ' students assigned.');
        }
    }

    function addStudentToTeam(studentId, teamId, week) {
        var data = window.data || {};
        var team = data.teams.find(function(t) { return String(t.id) === String(teamId); });
        if (!team) return false;
        
        if (!team.members) team.members = [];
        
        var existing = team.members.find(function(m) { return String(m.characterId) === String(studentId); });
        if (existing) return false;
        
        team.members.push({
            characterId: studentId,
            role: 'Member',
            joinPeriod: String(week),
            leavePeriod: ''
        });
        
        return true;
    }

    function initClassEvents() {
        var addBtn = document.getElementById('add-class-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() {
                showClassForm();
            });
        }

        var closeFormBtn = document.getElementById('close-class-form');
        if (closeFormBtn) {
            closeFormBtn.addEventListener('click', function() {
                document.getElementById('class-form-modal').classList.add('hidden');
            });
        }

        var cancelFormBtn = document.getElementById('cancel-class-form');
        if (cancelFormBtn) {
            cancelFormBtn.addEventListener('click', function() {
                document.getElementById('class-form-modal').classList.add('hidden');
            });
        }

        var form = document.getElementById('class-form-inner');
        if (form) {
            form.addEventListener('submit', function(e) {
                e.preventDefault();
                saveClass();
            });
        }

        var formModal = document.getElementById('class-form-modal');
        if (formModal) {
            formModal.addEventListener('click', function(e) {
                if (e.target === this) this.classList.add('hidden');
            });
        }
    }

    function showClassForm(editId) {
        var modal = document.getElementById('class-form-modal');
        var title = document.getElementById('class-form-title');
        var input = document.getElementById('class-name');
        var form = document.getElementById('class-form-inner');

        modal.classList.remove('hidden');

        if (editId) {
            title.textContent = 'Edit Class';
            var cls = window.getClass(editId);
            if (cls) {
                input.value = cls.name;
                form.dataset.editId = editId;
            }
        } else {
            title.textContent = 'Add Class';
            input.value = '';
            delete form.dataset.editId;
        }

        input.focus();
    }

    function saveClass() {
        var name = document.getElementById('class-name').value.trim();
        var form = document.getElementById('class-form-inner');
        var editId = form.dataset.editId;

        if (!name) {
            alert('Class name is required.');
            return;
        }

        var result;
        if (editId) {
            var oldClass = window.getClass(editId);
            if (oldClass) {
                if (oldClass.name !== name) {
                    var existing = window.getClassByName(name);
                    if (existing && String(existing.id) !== String(editId)) {
                        alert('A class with this name already exists.');
                        return;
                    }
                    var delResult = window.deleteClass(editId);
                    if (delResult.success) {
                        result = window.createClass(name);
                    } else {
                        alert('Failed to update class: ' + delResult.message);
                        return;
                    }
                } else {
                    document.getElementById('class-form-modal').classList.add('hidden');
                    renderClassList();
                    renderClassDetail();
                    return;
                }
            } else {
                alert('Class not found.');
                return;
            }
        } else {
            result = window.createClass(name);
        }

        if (result.success) {
            document.getElementById('class-form-modal').classList.add('hidden');
            state.selectedClassId = result.class.id;
            renderClassList();
            renderClassDetail();
            if (typeof window.updateDashboardStats === 'function') {
                window.updateDashboardStats();
            }
        } else {
            alert(result.message);
        }
    }

    // ============================================================
    // REGISTER WITH CURRICULUM MAIN
    // ============================================================

    if (typeof window.curriculumState !== 'undefined') {
        window.curriculumState.classes = state;
    }

    document.addEventListener('dataReady', function() {
        var container = document.getElementById('classes-content');
        if (container && container.style.display !== 'none') {
            renderClassesView(container);
        }
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'classes') {
            var container = document.getElementById('classes-content');
            if (container) {
                renderClassesView(container);
            }
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('classes-content');
            if (container && container.style.display !== 'none') {
                renderClassesView(container);
            }
        }, 100);
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderClassesView = renderClassesView;
    window.renderClassList = renderClassList;
    window.renderClassDetail = renderClassDetail;
    window.showDistributeModal = showDistributeModal;
    window.executeDistribution = executeDistribution;
    window.addStudentToTeam = addStudentToTeam;
    window.showClassForm = showClassForm;
    window.saveClass = saveClass;
    window.initClassEvents = initClassEvents;
    window.classState = state;

    console.log('classes.js loaded');

})();
