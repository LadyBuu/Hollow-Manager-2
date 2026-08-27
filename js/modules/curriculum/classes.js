/**
 * js/modules/curriculum/classes.js - Class Management Module
 * Handles class CRUD, roster view, and auto-distribution
 * Path: js/modules/curriculum/classes.js
 * 
 * This module is responsible for:
 *   - Rendering the classes UI
 *   - Class CRUD operations (delegates to core)
 *   - Auto-distribution of students to teams (delegates to core)
 *   - Roster and detail views
 * 
 * IMPORTANT: 
 *   - All application-data mutations are delegated to core functions.
 *   - UI state is managed locally through shared curriculum state.
 *   - This module does NOT mutate window.data directly.
 *   - Persistence is handled through the central saveData() function.
 *   - This module does not implement persistence itself.
 * 
 * LIFECYCLE:
 *   This module is rendered by curriculum-main.js via TabManager.
 *   It does not independently listen for lifecycle events.
 * 
 * ARCHITECTURAL NOTE:
 *   - The distribution algorithm relies on TeamCore's period semantics.
 *   - getActiveTeamMembers(team, week) must consider a member with
 *     joinPeriod <= week and (leavePeriod === '' OR leavePeriod >= week)
 *     as active. This contract is critical for capacity calculation.
 */

(function() {
    'use strict';

    // ============================================================
    // STATE - Classes UI state, stored in shared curriculum state
    // ============================================================

    if (!window.curriculumState) {
        window.curriculumState = {};
    }
    
    if (!window.curriculumState.classes) {
        window.curriculumState.classes = {
            selectedClassId: null,
            distributionWeek: 1,
            maxTeamSize: 4
        };
    }

    var state = window.curriculumState.classes;

    // ============================================================
    // RENDER CLASSES VIEW - Public API (only this is exposed)
    // ============================================================

    function renderClassesView(container) {
        if (!container) {
            container = document.getElementById('classes-content');
        }
        if (!container) return;

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading class data...</p>';
            return;
        }

        if (typeof window.ensureCurriculum !== 'function') {
            console.error('[Classes] ensureCurriculum() is not available.');
            container.innerHTML = '<p class="empty-state">Curriculum schema module not loaded. Please refresh the page.</p>';
            return;
        }

        window.ensureCurriculum();

        container.innerHTML = getClassesHTML();
        renderClassList();
        renderClassDetail();
        initClassEvents();
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
    // CLASSES HTML
    // ============================================================

    function getClassesHTML() {
        return `
            <div class="page-header">
                <h2>Academic Classes</h2>
                <button id="add-class-btn" class="primary">+ New Class</button>
            </div>
            <div class="classes-layout" style="display:grid;grid-template-columns:1fr 2fr;gap:16px;">
                <div id="class-list-container" class="class-list-panel" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;max-height:500px;overflow-y:auto;">
                    <div id="class-list">
                        <p class="empty-state">No classes created yet.</p>
                    </div>
                </div>
                <div id="class-detail-container" class="class-detail-panel" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;">
                    <div id="class-detail">
                        <p class="empty-state">Select a class to view details.</p>
                    </div>
                </div>
            </div>

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

            <div id="distribute-modal" class="modal hidden">
                <div class="modal-content" style="max-width:550px;">
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

    // ============================================================
    // RENDER CLASS LIST
    // ============================================================

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
            
            var safeName = escapeHtml(cls.name);
            var safeId = escapeHtml(cls.id);
            
            html += '<div class="class-list-item" style="padding:8px 12px;border-bottom:1px solid var(--border-soft);cursor:pointer;' + 
                (isSelected ? 'background:var(--accent-soft);border-left:3px solid var(--accent);' : '') + '" data-id="' + safeId + '">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
            html += '<span style="font-weight:600;">' + safeName + '</span>';
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

    // ============================================================
    // RENDER CLASS DETAIL
    // ============================================================

    function renderClassDetail() {
        var container = document.getElementById('class-detail');
        if (!container) return;

        if (!state.selectedClassId) {
            container.innerHTML = '<p class="empty-state">Select a class to view details.</p>';
            return;
        }

        var cls = window.getClass(state.selectedClassId);
        if (!cls) {
            state.selectedClassId = null;
            container.innerHTML = '<p class="empty-state">Select a class to view details.</p>';
            return;
        }

        var characters = window.getCharactersByClass(cls.id);
        var teams = window.getTeamsByClass(cls.id);
        var available = window.getAvailableStudentsForClass(cls.id, state.distributionWeek || 1);

        var safeName = escapeHtml(cls.name);

        var html = '';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">';
        html += '<h3 style="color:var(--accent);">' + safeName + '</h3>';
        html += '<div class="class-header-actions" style="display:flex;gap:4px;">';
        html += '<button id="edit-class-btn" class="secondary small">Edit</button>';
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
                var safeName = escapeHtml(name);
                var safeStatus = escapeHtml(status);
                html += '<span style="background:var(--panel-alt);padding:2px 10px;border-radius:12px;font-size:0.7rem;' + 
                    (isDeceased ? 'opacity:0.4;text-decoration:line-through;' : '') + '">' + 
                    safeName + ' <span style="color:var(--text-dim);font-size:0.6rem;">(' + safeStatus + ')</span></span>';
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
                var activeCount = window.getActiveTeamMembers(team, state.distributionWeek || 1).length;
                var safeTeamName = escapeHtml(team.name);
                var safeTeamNumber = escapeHtml(team.teamNumber || '');
                html += '<span style="background:var(--panel-alt);padding:2px 10px;border-radius:12px;font-size:0.7rem;border:1px solid var(--border-soft);">';
                html += '<strong>' + safeTeamName + '</strong>';
                if (safeTeamNumber) html += ' (#' + safeTeamNumber + ')';
                html += ' - ' + activeCount + ' active members';
                html += '</span>';
            });
            html += '</div>';
        }

        container.innerHTML = html;

        var editBtn = document.getElementById('edit-class-btn');
        if (editBtn) {
            editBtn.addEventListener('click', function() {
                showClassForm(cls.id);
            });
        }

        var distributeBtn = document.getElementById('distribute-class-btn');
        if (distributeBtn) {
            distributeBtn.addEventListener('click', function() {
                showDistributeModal(cls.id);
            });
        }

        var deleteBtn = document.getElementById('delete-class-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', function() {
                deleteClassHandler(cls.id);
            });
        }
    }

    // ============================================================
    // DELETE CLASS HANDLER
    // ============================================================

    function deleteClassHandler(classId) {
        var cls = window.getClass(classId);
        if (!cls) {
            showNotification('Class not found.', 'error');
            return;
        }

        var students = window.getCharactersByClass(classId);
        var teams = window.getTeamsByClass(classId);

        var message = 'Delete "' + cls.name + '" permanently?';
        if (students.length > 0 || teams.length > 0) {
            message += '\n\n⚠ This class has ' + students.length + ' student(s) and ' + teams.length + ' team(s) assigned.';
            message += '\nAll references will be removed from students and teams.';
            message += '\n\nThis action cannot be undone.';
        }

        if (!confirm(message)) {
            return;
        }

        var result = window.deleteClass(classId, { removeReferences: true });
        if (result && result.success) {
            state.selectedClassId = null;
            renderClassList();
            renderClassDetail();
            if (typeof window.updateDashboardStats === 'function') {
                window.updateDashboardStats();
            }
            
            if (typeof window.saveData === 'function') {
                window.saveData()
                    .then(function() {
                        showNotification('Class deleted successfully!', 'success');
                    })
                    .catch(function(err) {
                        console.error('Failed to save class deletion:', err);
                        showNotification('Class deleted in memory, but persistence failed.', 'error');
                    });
            } else {
                showNotification('Class deleted successfully!', 'success');
            }
        } else {
            showNotification(result ? result.message : 'Failed to delete class.', 'error');
        }
    }

    // ============================================================
    // DISTRIBUTION MESSAGE HELPER
    // ============================================================

    function getDistributionMessage(successCount, capacityExceeded, failCount) {
        var msg = 'Distribution complete!\n\n' +
            'Assigned: ' + successCount + ' students\n' +
            'Not assigned (capacity): ' + capacityExceeded + ' students';

        if (failCount > 0) {
            msg += '\n\nFailed assignments: ' + failCount +
                ' (see console for details)';
        }

        if (successCount === 0) {
            msg += '\n\nNo students were assigned. Please check team capacity and student availability.';
        }

        return msg;
    }

    // ============================================================
    // SHOW DISTRIBUTE MODAL
    // ============================================================

    function showDistributeModal(classId) {
        var cls = window.getClass(classId);
        if (!cls) {
            showNotification('Class not found.', 'error');
            return;
        }

        var distributionWeek = state.distributionWeek || 1;
        var maxTeamSize = state.maxTeamSize || 4;

        var teams = window.getTeamsByClass(classId);
        var available = window.getAvailableStudentsForClass(classId, distributionWeek);

        if (teams.length === 0) {
            showNotification('No academic teams found for this class. Create teams first in the Teams tab.', 'error');
            return;
        }

        if (available.length === 0) {
            showNotification('No available students for this class at week ' + distributionWeek + '.', 'error');
            return;
        }

        var modal = document.getElementById('distribute-modal');
        var content = document.getElementById('distribute-content');

        var html = '';
        html += '<p style="color:var(--text-dim);font-size:0.85rem;margin-bottom:12px;">';
        html += 'Distribute <strong id="distribute-available-count">' + available.length + '</strong> available students across selected teams.';
        html += ' Students will be assigned as "Member" with join period = selected week.';
        html += '</p>';

        html += '<div class="form-group">';
        html += '<label>Week:</label>';
        html += '<input type="number" id="distribute-week" value="' + distributionWeek + '" min="1" max="52" style="width:80px;padding:4px 8px;">';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label>Max Students Per Team:</label>';
        html += '<input type="number" id="distribute-max-size" value="' + maxTeamSize + '" min="1" max="20" style="width:80px;padding:4px 8px;">';
        html += '</div>';

        html += '<div style="margin:12px 0;">';
        html += '<label style="font-weight:600;color:var(--text-dim);">Select Teams:</label>';
        html += '<div id="distribute-team-list" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;">';
        
        teams.forEach(function(team) {
            var activeCount = window.getActiveTeamMembers(team, distributionWeek).length;
            var checked = activeCount < maxTeamSize ? 'checked' : '';
            var disabled = activeCount >= maxTeamSize ? 'disabled' : '';
            var safeTeamName = escapeHtml(team.name);
            var safeTeamNumber = escapeHtml(team.teamNumber || '');
            var safeTeamId = escapeHtml(team.id);
            html += '<label style="display:flex;align-items:center;gap:4px;font-size:0.75rem;cursor:pointer;padding:4px 8px;background:var(--bg);border-radius:4px;border:1px solid var(--border-soft);">';
            html += '<input type="checkbox" class="team-checkbox" value="' + safeTeamId + '" ' + checked + ' ' + disabled + '>';
            html += safeTeamName + (safeTeamNumber ? ' (#' + safeTeamNumber + ')' : '') + ' (' + activeCount + ' active members)';
            if (disabled) html += ' <span style="color:var(--danger);font-size:0.6rem;">FULL</span>';
            html += '</label>';
        });
        html += '</div>';
        html += '</div>';

        html += '<div style="padding:8px;background:var(--bg);border-radius:4px;font-size:0.75rem;color:var(--text-dim);">';
        html += 'Students will be distributed evenly across selected teams.';
        html += '</div>';

        html += '<div class="form-actions" style="margin-top:16px;">';
        html += '<button type="button" id="cancel-distribute" class="secondary">Cancel</button>';
        html += '<button type="button" id="confirm-distribute" class="primary">Distribute Students</button>';
        html += '</div>';

        content.innerHTML = html;
        modal.classList.remove('hidden');

        var cancelBtn = document.getElementById('cancel-distribute');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function() {
                modal.classList.add('hidden');
            });
        }

        var closeBtn = document.getElementById('close-distribute-modal');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                modal.classList.add('hidden');
            });
        }

        var confirmBtn = document.getElementById('confirm-distribute');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', function() {
                executeDistribution(classId);
            });
        }

        var weekInput = document.getElementById('distribute-week');
        var maxSizeInput = document.getElementById('distribute-max-size');

        function updateTeamList() {
            var newWeek = parseInt(weekInput ? weekInput.value : distributionWeek) || distributionWeek;
            var newMaxSize = parseInt(maxSizeInput ? maxSizeInput.value : maxTeamSize) || maxTeamSize;
            
            var teamList = document.getElementById('distribute-team-list');
            if (!teamList) return;

            var newAvailable = window.getAvailableStudentsForClass(classId, newWeek);
            var availableCount = document.getElementById('distribute-available-count');
            if (availableCount) {
                availableCount.textContent = newAvailable.length;
            }

            var checkboxStates = {};
            teamList.querySelectorAll('.team-checkbox').forEach(function(cb) {
                checkboxStates[cb.value] = cb.checked;
            });

            var newHtml = '';
            teams.forEach(function(team) {
                var activeCount = window.getActiveTeamMembers(team, newWeek).length;
                
                var checked;
                var disabled = '';
                
                if (activeCount >= newMaxSize) {
                    checked = '';
                    disabled = 'disabled';
                } else if (Object.prototype.hasOwnProperty.call(checkboxStates, team.id)) {
                    checked = checkboxStates[team.id] ? 'checked' : '';
                } else {
                    checked = 'checked';
                }
                
                var safeTeamName = escapeHtml(team.name);
                var safeTeamNumber = escapeHtml(team.teamNumber || '');
                var safeTeamId = escapeHtml(team.id);
                newHtml += '<label style="display:flex;align-items:center;gap:4px;font-size:0.75rem;cursor:pointer;padding:4px 8px;background:var(--bg);border-radius:4px;border:1px solid var(--border-soft);">';
                newHtml += '<input type="checkbox" class="team-checkbox" value="' + safeTeamId + '" ' + checked + ' ' + disabled + '>';
                newHtml += safeTeamName + (safeTeamNumber ? ' (#' + safeTeamNumber + ')' : '') + ' (' + activeCount + ' active members)';
                if (disabled) newHtml += ' <span style="color:var(--danger);font-size:0.6rem;">FULL</span>';
                newHtml += '</label>';
            });
            teamList.innerHTML = newHtml;
        }

        if (weekInput) {
            weekInput.addEventListener('change', updateTeamList);
        }
        if (maxSizeInput) {
            maxSizeInput.addEventListener('change', updateTeamList);
        }
    }

    // ============================================================
    // EXECUTE DISTRIBUTION
    // ============================================================

    function executeDistribution(classId) {
        var modal = document.getElementById('distribute-modal');
        var weekInput = document.getElementById('distribute-week');
        var maxSizeInput = document.getElementById('distribute-max-size');
        
        var week = parseInt(weekInput ? weekInput.value : 1) || 1;
        var maxSize = parseInt(maxSizeInput ? maxSizeInput.value : 4) || 4;
        
        if (week < 1 || week > 52) {
            showNotification('Week must be between 1 and 52.', 'error');
            return;
        }
        
        if (maxSize < 1 || maxSize > 20) {
            showNotification('Max students per team must be between 1 and 20.', 'error');
            return;
        }
        
        state.distributionWeek = week;
        state.maxTeamSize = maxSize;
        
        var selectedTeamIds = [];
        if (modal) {
            modal.querySelectorAll('.team-checkbox:checked').forEach(function(cb) {
                selectedTeamIds.push(cb.value);
            });
        }

        if (selectedTeamIds.length === 0) {
            showNotification('Please select at least one team.', 'error');
            return;
        }

        var teams = selectedTeamIds.map(function(id) { 
            return window.getTeamById(id); 
        }).filter(function(t) { return t; });

        var available = window.getAvailableStudentsForClass(classId, week);

        if (available.length === 0) {
            showNotification('No available students for this class at week ' + week + '.', 'error');
            return;
        }

        var teamActiveCounts = {};
        teams.forEach(function(t) {
            var activeMembers = window.getActiveTeamMembers(t, week);
            teamActiveCounts[t.id] = activeMembers.length;
        });

        var totalAvailableSlots = teams.reduce(function(total, team) {
            var currentActive = teamActiveCounts[team.id] || 0;
            var availableSlots = Math.max(0, maxSize - currentActive);
            return total + availableSlots;
        }, 0);

        if (available.length > totalAvailableSlots) {
            if (!confirm('You have ' + available.length + ' students but only ' + totalAvailableSlots + ' slots available.\n\nSome students will not be assigned. Continue?')) {
                return;
            }
        }

        var shuffled = available.slice();
        for (var i = shuffled.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var temp = shuffled[i];
            shuffled[i] = shuffled[j];
            shuffled[j] = temp;
        }

        var capacityExceeded = 0;
        var assignments = [];

        for (var i = 0; i < shuffled.length; i++) {
            var student = shuffled[i];
            
            var availableTeams = teams.filter(function(t) {
                return teamActiveCounts[t.id] < maxSize;
            });
            
            if (availableTeams.length === 0) {
                capacityExceeded++;
                continue;
            }
            
            availableTeams.sort(function(a, b) {
                return teamActiveCounts[a.id] - teamActiveCounts[b.id];
            });
            
            var targetTeam = availableTeams[0];
            
            assignments.push({
                studentId: student.id,
                teamId: targetTeam.id,
                week: week
            });
            
            teamActiveCounts[targetTeam.id]++;
        }

        if (assignments.length === 0) {
            showNotification('No students could be assigned. Check team capacity.', 'error');
            return;
        }

        var successCount = 0;
        var failCount = 0;
        
        assignments.forEach(function(assignment) {
            var result = window.addTeamMember(assignment.teamId, {
                characterId: assignment.studentId,
                role: 'Member',
                joinPeriod: String(assignment.week),
                leavePeriod: ''
            });
            
            if (result && result.success) {
                successCount++;
            } else {
                failCount++;
                console.warn('Failed to assign student:', assignment.studentId, result);
            }
        });

        // Log only successful assignments
        if (successCount > 0 && typeof window.logActivity === 'function') {
            var activityMessage = 'Auto-distributed ' + successCount +
                ' students for class ' + window.getClassDisplayName(classId);
            if (failCount > 0) {
                activityMessage += ' (' + failCount + ' failed)';
            }
            window.logActivity(activityMessage);
        }

        // Update UI immediately (mutations are already in memory)
        if (modal) modal.classList.add('hidden');
        renderClassDetail();
        
        if (typeof window.renderStudentScheduleView === 'function') {
            window.renderStudentScheduleView();
        } else if (typeof window.renderStudentSchedule === 'function') {
            window.renderStudentSchedule();
        }
        
        if (typeof window.renderTeamManager === 'function') {
            var teamContainer = document.getElementById('tab-teams');
            if (teamContainer) {
                window.renderTeamManager(teamContainer);
            }
        }

        var msg = getDistributionMessage(successCount, capacityExceeded, failCount);

        // Then attempt persistence
        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    showNotification(msg, 'success');
                })
                .catch(function(err) {
                    console.error('Failed to save distribution:', err);
                    showNotification(
                        'Distribution completed in memory, but persistence failed: ' + err.message,
                        'error'
                    );
                });
        } else {
            showNotification(msg, 'success');
        }
    }

    // ============================================================
    // CLASS CRUD OPERATIONS
    // ============================================================

    function showClassForm(editId) {
        var modal = document.getElementById('class-form-modal');
        var title = document.getElementById('class-form-title');
        var input = document.getElementById('class-name');
        var form = document.getElementById('class-form-inner');

        if (!modal || !title || !input || !form) {
            showNotification('Form elements not found. Please refresh.', 'error');
            return;
        }

        modal.classList.remove('hidden');

        if (editId) {
            title.textContent = 'Edit Class';
            var cls = window.getClass(editId);
            if (cls) {
                input.value = cls.name;
                form.dataset.editId = editId;
            } else {
                showNotification('Class not found.', 'error');
                modal.classList.add('hidden');
                return;
            }
        } else {
            title.textContent = 'Add Class';
            input.value = '';
            delete form.dataset.editId;
        }

        input.focus();
    }

    function saveClass(e) {
        e.preventDefault();
        var name = document.getElementById('class-name').value.trim();
        var form = document.getElementById('class-form-inner');
        var editId = form ? form.dataset.editId : null;

        if (!name) {
            showNotification('Class name is required.', 'error');
            return;
        }

        var result;
        if (editId) {
            result = window.updateClass(editId, { name: name });
            if (!result || !result.success) {
                showNotification(result ? result.message : 'Failed to update class.', 'error');
                return;
            }
        } else {
            result = window.createClass(name);
            if (!result || !result.success) {
                showNotification(result ? result.message : 'Failed to create class.', 'error');
                return;
            }
        }

        document.getElementById('class-form-modal').classList.add('hidden');
        state.selectedClassId = result.class ? result.class.id : editId;
        renderClassList();
        renderClassDetail();
        
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }

        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    showNotification(editId ? 'Class updated successfully!' : 'Class created successfully!', 'success');
                })
                .catch(function(err) {
                    console.error('Failed to save class:', err);
                    showNotification('Class changed in memory, but persistence failed.', 'error');
                });
        } else {
            showNotification(editId ? 'Class updated successfully!' : 'Class created successfully!', 'success');
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
            console.log('[Classes]', message);
        }
    }

    // ============================================================
    // EVENT INITIALISATION
    // ============================================================

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
            form.addEventListener('submit', saveClass);
        }

        var formModal = document.getElementById('class-form-modal');
        if (formModal) {
            formModal.addEventListener('click', function(e) {
                if (e.target === this) this.classList.add('hidden');
            });
        }

        var distributeModal = document.getElementById('distribute-modal');
        if (distributeModal) {
            distributeModal.addEventListener('click', function(e) {
                if (e.target === this) this.classList.add('hidden');
            });
        }
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderClassesView = renderClassesView;

})();
