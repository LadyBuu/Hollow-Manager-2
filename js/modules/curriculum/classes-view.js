/**
 * js/modules/curriculum/classes-view.js - Classes Management View
 * Handles class CRUD, roster view, and auto-distribution
 * Path: js/modules/curriculum/classes-view.js
 * 
 * This module is responsible for:
 *   - Rendering the classes UI
 *   - Class CRUD operations (delegates to core)
 *   - Auto-distribution of students to teams (delegates to core)
 *   - Roster and detail views
 * 
 * IMPORTANT: 
 *   - All application-data mutations are delegated to core functions.
 *   - This module does NOT mutate window.data directly.
 *   - UI state is managed through shared curriculum state.
 *   - Persistence is handled through the central saveData() function.
 *   - All core mutation functions return { success: boolean, message?: string, ... }
 * 
 * LIFECYCLE:
 *   This module is rendered by curriculum-main.js via TabManager.
 *   It does not independently listen for lifecycle events.
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
    // DEPENDENCY VALIDATION
    // ============================================================

    function validateDependencies(container) {
        var missing = [];

        if (typeof window.getClasses !== 'function') {
            missing.push('getClasses');
        }

        if (typeof window.getClass !== 'function') {
            missing.push('getClass');
        }

        if (typeof window.createClass !== 'function') {
            missing.push('createClass');
        }

        if (typeof window.updateClass !== 'function') {
            missing.push('updateClass');
        }

        if (typeof window.deleteClass !== 'function') {
            missing.push('deleteClass');
        }

        if (typeof window.getCharactersByClass !== 'function') {
            missing.push('getCharactersByClass');
        }

        if (typeof window.getTeamsByClass !== 'function') {
            missing.push('getTeamsByClass');
        }

        if (typeof window.getAvailableStudentsForClass !== 'function') {
            missing.push('getAvailableStudentsForClass');
        }

        if (typeof window.getActiveTeamMembers !== 'function') {
            missing.push('getActiveTeamMembers');
        }

        if (typeof window.getTeamById !== 'function') {
            missing.push('getTeamById');
        }

        if (typeof window.addTeamMember !== 'function') {
            missing.push('addTeamMember');
        }

        if (typeof window.getClassDisplayName !== 'function') {
            missing.push('getClassDisplayName');
        }

        if (typeof window.getDisplayName !== 'function') {
            missing.push('getDisplayName');
        }

        if (typeof window.getCurrentStatus !== 'function') {
            missing.push('getCurrentStatus');
        }

        if (typeof window.saveData !== 'function') {
            missing.push('saveData');
        }

        if (typeof window.logActivity !== 'function') {
            missing.push('logActivity');
        }

        if (typeof window.ensureCurriculum !== 'function') {
            missing.push('ensureCurriculum');
        }

        if (typeof window.getCharacterById !== 'function') {
            missing.push('getCharacterById');
        }

        if (missing.length > 0) {
            if (container) {
                container.innerHTML = '<p class="empty-state">Classes dependencies not loaded. Please refresh the page.</p>';
            }
            return false;
        }

        return true;
    }

    // ============================================================
    // RENDER CLASSES VIEW - Public API
    // ============================================================

    function renderClassesView(container) {
        if (!container) {
            container = document.getElementById('classes-content');
        }
        if (!container) {
            return;
        }

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading class data...</p>';
            return;
        }

        window.ensureCurriculum();

        if (!validateDependencies(container)) {
            return;
        }

        container.innerHTML = getClassesHTML();
        renderClassList(container);
        renderClassDetail(container);
        initClassEvents(container);
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
    // CLASSES HTML
    // ============================================================

    function getClassesHTML() {
        return (
            '<div class="page-header">' +
                '<h2>Academic Classes</h2>' +
                '<button id="add-class-btn" class="primary">+ New Class</button>' +
            '</div>' +
            '<div class="classes-layout" style="display:grid;grid-template-columns:1fr 2fr;gap:16px;">' +
                '<div id="class-list-container" class="class-list-panel" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;max-height:500px;overflow-y:auto;">' +
                    '<div id="class-list">' +
                        '<p class="empty-state">No classes created yet.</p>' +
                    '</div>' +
                '</div>' +
                '<div id="class-detail-container" class="class-detail-panel" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;">' +
                    '<div id="class-detail">' +
                        '<p class="empty-state">Select a class to view details.</p>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div id="class-form-modal" class="modal hidden">' +
                '<div class="modal-content" style="max-width:450px;">' +
                    '<div class="modal-header">' +
                        '<h3 id="class-form-title">Add Class</h3>' +
                        '<button class="close-modal" id="close-class-form">&times;</button>' +
                    '</div>' +
                    '<div class="modal-body">' +
                        '<form id="class-form-inner">' +
                            '<div class="form-group">' +
                                '<label>Class Name *</label>' +
                                '<input type="text" id="class-name" placeholder="e.g., Spring 1424, March 1436" required>' +
                                '<span style="font-size:0.6rem;color:var(--text-dim);">Free text - use any naming convention you prefer.</span>' +
                            '</div>' +
                            '<div class="form-actions">' +
                                '<button type="button" id="cancel-class-form" class="secondary">Cancel</button>' +
                                '<button type="submit" id="save-class-btn" class="primary">Save Class</button>' +
                            '</div>' +
                        '</form>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div id="distribute-modal" class="modal hidden">' +
                '<div class="modal-content" style="max-width:550px;">' +
                    '<div class="modal-header">' +
                        '<h3>Auto-Distribute Students</h3>' +
                        '<button class="close-modal" id="close-distribute-modal">&times;</button>' +
                    '</div>' +
                    '<div class="modal-body">' +
                        '<div id="distribute-content"></div>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );
    }

    // ============================================================
    // RENDER CLASS LIST
    // ============================================================

    function renderClassList(container) {
        var listContainer = container ? container.querySelector('#class-list') : document.getElementById('class-list');
        if (!listContainer) {
            return;
        }

        var classes = window.getClasses();

        if (classes.length === 0) {
            listContainer.innerHTML = '<p class="empty-state">No classes created yet. Create your first class.</p>';
            return;
        }

        var html = '';

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
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
        }

        listContainer.innerHTML = html;

        var items = listContainer.querySelectorAll('.class-list-item');
        for (var i = 0; i < items.length; i++) {
            var el = items[i];
            el.addEventListener('click', function() {
                state.selectedClassId = this.dataset.id;
                renderClassList(container);
                renderClassDetail(container);
            });
        }
    }

    // ============================================================
    // RENDER CLASS DETAIL
    // ============================================================

    function renderClassDetail(container) {
        var detailContainer = container ? container.querySelector('#class-detail') : document.getElementById('class-detail');
        if (!detailContainer) {
            return;
        }

        if (!state.selectedClassId) {
            detailContainer.innerHTML = '<p class="empty-state">Select a class to view details.</p>';
            return;
        }

        var cls = window.getClass(state.selectedClassId);

        if (!cls) {
            state.selectedClassId = null;
            detailContainer.innerHTML = '<p class="empty-state">Select a class to view details.</p>';
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

        html += '<h4 style="color:var(--text-dim);font-size:0.8rem;margin-bottom:4px;">Roster (' + characters.length + ')</h4>';

        if (characters.length === 0) {
            html += '<p class="empty-state" style="padding:8px;font-size:0.75rem;">No students in this class.</p>';
        } else {
            html += '<div style="display:flex;flex-wrap:wrap;gap:4px;max-height:150px;overflow-y:auto;padding:4px;background:var(--bg);border-radius:4px;">';

            for (var i = 0; i < characters.length; i++) {
                var char = characters[i];
                var name = window.getDisplayName(char);
                var status = window.getCurrentStatus(char);
                var isDeceased = char.deceased || false;
                var safeName2 = escapeHtml(name);
                var safeStatus = escapeHtml(status);

                html += '<span style="background:var(--panel-alt);padding:2px 10px;border-radius:12px;font-size:0.7rem;' +
                    (isDeceased ? 'opacity:0.4;text-decoration:line-through;' : '') + '">' +
                    safeName2 + ' <span style="color:var(--text-dim);font-size:0.6rem;">(' + safeStatus + ')</span></span>';
            }

            html += '</div>';
        }

        html += '<h4 style="color:var(--text-dim);font-size:0.8rem;margin:8px 0 4px 0;">Teams (' + teams.length + ')</h4>';

        if (teams.length === 0) {
            html += '<p class="empty-state" style="padding:8px;font-size:0.75rem;">No academic teams for this class. Create teams in the Teams tab.</p>';
        } else {
            html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';

            for (var i = 0; i < teams.length; i++) {
                var team = teams[i];
                var activeCount = window.getActiveTeamMembers(team, state.distributionWeek || 1).length;
                var safeTeamName = escapeHtml(team.name);
                var safeTeamNumber = escapeHtml(team.teamNumber || '');

                html += '<span style="background:var(--panel-alt);padding:2px 10px;border-radius:12px;font-size:0.7rem;border:1px solid var(--border-soft);">';
                html += '<strong>' + safeTeamName + '</strong>';
                if (safeTeamNumber) {
                    html += ' (#' + safeTeamNumber + ')';
                }
                html += ' - ' + activeCount + ' active members';
                html += '</span>';
            }

            html += '</div>';
        }

        detailContainer.innerHTML = html;

        var editBtn = detailContainer.querySelector('#edit-class-btn');
        if (editBtn) {
            editBtn.addEventListener('click', function() {
                showClassForm(container, cls.id);
            });
        }

        var distributeBtn = detailContainer.querySelector('#distribute-class-btn');
        if (distributeBtn) {
            distributeBtn.addEventListener('click', function() {
                showDistributeModal(container, cls.id);
            });
        }

        var deleteBtn = detailContainer.querySelector('#delete-class-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', function() {
                deleteClassHandler(container, cls.id);
            });
        }
    }

    // ============================================================
    // DELETE CLASS HANDLER
    // ============================================================

    function deleteClassHandler(container, classId) {
        var cls = window.getClass(classId);

        if (!cls) {
            showNotification('Class not found.', 'error');
            return;
        }

        var students = window.getCharactersByClass(classId);
        var teams = window.getTeamsByClass(classId);

        var message = 'Delete "' + cls.name + '" permanently?';

        if (students.length > 0 || teams.length > 0) {
            message += '\n\nThis class has ' + students.length + ' student(s) and ' + teams.length + ' team(s) assigned.';
            message += '\nAll references will be removed from students and teams.';
            message += '\n\nThis action cannot be undone.';
        }

        if (!confirm(message)) {
            return;
        }

        var result = window.deleteClass(classId);

        if (result && result.success) {
            state.selectedClassId = null;
            renderClassList(container);
            renderClassDetail(container);

            if (typeof window.updateDashboardStats === 'function') {
                window.updateDashboardStats();
            }

            if (typeof window.saveData === 'function') {
                window.saveData()
                    .then(function() {
                        showNotification('Class deleted successfully.', 'success');
                    })
                    .catch(function() {
                        showNotification('Class deleted in memory, but persistence failed.', 'error');
                    });
            } else {
                showNotification('Class deleted successfully.', 'success');
            }
        } else {
            showNotification(result && result.message ? result.message : 'Failed to delete class.', 'error');
        }
    }

    // ============================================================
    // SHOW DISTRIBUTE MODAL
    // ============================================================

    function showDistributeModal(container, classId) {
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

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            var activeCount = window.getActiveTeamMembers(team, distributionWeek).length;
            var checked = activeCount < maxTeamSize ? 'checked' : '';
            var disabled = activeCount >= maxTeamSize ? 'disabled' : '';
            var safeTeamName = escapeHtml(team.name);
            var safeTeamNumber = escapeHtml(team.teamNumber || '');
            var safeTeamId = escapeHtml(team.id);

            html += '<label style="display:flex;align-items:center;gap:4px;font-size:0.75rem;cursor:pointer;padding:4px 8px;background:var(--bg);border-radius:4px;border:1px solid var(--border-soft);">';
            html += '<input type="checkbox" class="team-checkbox" value="' + safeTeamId + '" ' + checked + ' ' + disabled + '>';
            html += safeTeamName + (safeTeamNumber ? ' (#' + safeTeamNumber + ')' : '') + ' (' + activeCount + ' active members)';

            if (disabled) {
                html += ' <span style="color:var(--danger);font-size:0.6rem;">FULL</span>';
            }

            html += '</label>';
        }

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
                executeDistribution(container, classId);
            });
        }

        var weekInput = document.getElementById('distribute-week');
        var maxSizeInput = document.getElementById('distribute-max-size');

        function updateTeamList() {
            var newWeek = parseInt(weekInput ? weekInput.value : distributionWeek, 10) || distributionWeek;
            var newMaxSize = parseInt(maxSizeInput ? maxSizeInput.value : maxTeamSize, 10) || maxTeamSize;

            var teamList = document.getElementById('distribute-team-list');
            if (!teamList) {
                return;
            }

            var newAvailable = window.getAvailableStudentsForClass(classId, newWeek);
            var availableCount = document.getElementById('distribute-available-count');

            if (availableCount) {
                availableCount.textContent = newAvailable.length;
            }

            var checkboxStates = {};
            var teamCheckboxes = teamList.querySelectorAll('.team-checkbox');

            for (var c = 0; c < teamCheckboxes.length; c++) {
                var cb = teamCheckboxes[c];
                checkboxStates[cb.value] = cb.checked;
            }

            var newHtml = '';

            for (var i = 0; i < teams.length; i++) {
                var team = teams[i];
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

                if (disabled) {
                    newHtml += ' <span style="color:var(--danger);font-size:0.6rem;">FULL</span>';
                }

                newHtml += '</label>';
            }

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

    function executeDistribution(container, classId) {
        var modal = document.getElementById('distribute-modal');
        var weekInput = document.getElementById('distribute-week');
        var maxSizeInput = document.getElementById('distribute-max-size');

        var week = parseInt(weekInput ? weekInput.value : 1, 10) || 1;
        var maxSize = parseInt(maxSizeInput ? maxSizeInput.value : 4, 10) || 4;

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
            var checkboxes = modal.querySelectorAll('.team-checkbox:checked');
            for (var c = 0; c < checkboxes.length; c++) {
                selectedTeamIds.push(checkboxes[c].value);
            }
        }

        if (selectedTeamIds.length === 0) {
            showNotification('Please select at least one team.', 'error');
            return;
        }

        var teams = [];

        for (var i = 0; i < selectedTeamIds.length; i++) {
            var team = window.getTeamById(selectedTeamIds[i]);
            if (team) {
                teams.push(team);
            }
        }

        var available = window.getAvailableStudentsForClass(classId, week);

        if (available.length === 0) {
            showNotification('No available students for this class at week ' + week + '.', 'error');
            return;
        }

        var teamActiveCounts = {};

        for (var i = 0; i < teams.length; i++) {
            var t = teams[i];
            var activeMembers = window.getActiveTeamMembers(t, week);
            teamActiveCounts[t.id] = activeMembers.length;
        }

        var totalAvailableSlots = 0;

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            var currentActive = teamActiveCounts[team.id] || 0;
            var availableSlots = Math.max(0, maxSize - currentActive);
            totalAvailableSlots += availableSlots;
        }

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

            var availableTeams = [];

            for (var j = 0; j < teams.length; j++) {
                var t = teams[j];
                if (teamActiveCounts[t.id] < maxSize) {
                    availableTeams.push(t);
                }
            }

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

        for (var i = 0; i < assignments.length; i++) {
            var assignment = assignments[i];
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
            }
        }

        if (successCount > 0 && typeof window.logActivity === 'function') {
            var activityMessage = 'Auto-distributed ' + successCount + ' students for class ' + window.getClassDisplayName(classId);

            if (failCount > 0) {
                activityMessage += ' (' + failCount + ' failed)';
            }

            window.logActivity(activityMessage);
        }

        if (modal) {
            modal.classList.add('hidden');
        }

        renderClassDetail(container);

        if (typeof window.renderTeamManager === 'function') {
            var teamContainer = document.getElementById('tab-teams');
            if (teamContainer) {
                window.renderTeamManager(teamContainer);
            }
        }

        var msg = 'Distribution complete.\n\nAssigned: ' + successCount + ' students\nNot assigned (capacity): ' + capacityExceeded + ' students';

        if (failCount > 0) {
            msg += '\n\nFailed assignments: ' + failCount + ' (see console for details)';
        }

        if (successCount === 0) {
            msg += '\n\nNo students were assigned. Please check team capacity and student availability.';
        }

        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    showNotification(msg, 'success');
                })
                .catch(function() {
                    showNotification('Distribution completed in memory, but persistence failed.', 'error');
                });
        } else {
            showNotification(msg, 'success');
        }
    }

    // ============================================================
    // CLASS CRUD OPERATIONS
    // ============================================================

    function showClassForm(container, editId) {
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

    function saveClass(e, container) {
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
                showNotification(result && result.message ? result.message : 'Failed to update class.', 'error');
                return;
            }
        } else {
            result = window.createClass(name);

            if (!result || !result.success) {
                showNotification(result && result.message ? result.message : 'Failed to create class.', 'error');
                return;
            }
        }

        document.getElementById('class-form-modal').classList.add('hidden');

        state.selectedClassId = result.class ? result.class.id : editId;

        renderClassList(container);
        renderClassDetail(container);

        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }

        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    showNotification(editId ? 'Class updated successfully.' : 'Class created successfully.', 'success');
                })
                .catch(function() {
                    showNotification('Class changed in memory, but persistence failed.', 'error');
                });
        } else {
            showNotification(editId ? 'Class updated successfully.' : 'Class created successfully.', 'success');
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

    function initClassEvents(container) {
        var addBtn = container ? container.querySelector('#add-class-btn') : document.getElementById('add-class-btn');

        if (addBtn) {
            addBtn.addEventListener('click', function() {
                showClassForm(container);
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
                saveClass(e, container);
            });
        }

        var formModal = document.getElementById('class-form-modal');
        if (formModal) {
            formModal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                }
            });
        }

        var distributeModal = document.getElementById('distribute-modal');
        if (distributeModal) {
            distributeModal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                }
            });
        }
    }

    // ============================================================
    // EXPOSE FUNCTIONS
    // ============================================================

    window.renderClassesView = renderClassesView;
    window.classesState = state;

})();
