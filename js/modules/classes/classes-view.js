/**
 * js/modules/classes/classes-view.js - Classes Management View
 * Handles class CRUD, roster view, and auto-distribution
 * Path: js/modules/classes/classes-view.js
 * 
 * This module is responsible for:
 *   - Rendering the classes UI
 *   - Class CRUD operations (delegates to ClassesCore)
 *   - Auto-distribution of students to teams (delegates to ClassesCore)
 *   - Roster and detail views
 * 
 * IMPORTANT: 
 *   - All application-data mutations are delegated to core functions.
 *   - This module does NOT mutate window.data directly.
 *   - UI state is managed through shared classes state.
 *   - Persistence is handled through the central saveData() function.
 *   - All core mutation functions return { success: boolean, message?: string, ... }
 *   - USES ClassesCore for all mutations
 *   - USES ClassesQueries for all queries
 *   - USES CharacterQueries for character data
 *   - USES TeamQueries for team data
 *   - USES NotificationSystem for notifications
 *   - USES CALENDAR_CONSTANTS for calendar bounds
 * 
 * LIFECYCLE:
 *   This module is rendered by classes-main.js via TabManager.
 *   It does not independently listen for lifecycle events.
 */

(function() {
    'use strict';

    // ============================================================
    // GUARD AGAINST DUPLICATE LOADING
    // ============================================================

    if (window.__classesViewLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var ClassesCore = window.ClassesCore;
    var ClassesQueries = window.ClassesQueries;
    var CharacterQueries = window.CharacterQueries;
    var TeamQueries = window.TeamQueries;
    var NotificationSystem = window.NotificationSystem;
    var CalendarConstants = window.CALENDAR_CONSTANTS;

    // ============================================================
    // DEPENDENCY VALIDATION
    // ============================================================

    function validateDependencies(container) {
        var missing = [];

        if (!ClassesQueries || typeof ClassesQueries.getClasses !== 'function') {
            missing.push('ClassesQueries.getClasses');
        }
        if (!ClassesQueries || typeof ClassesQueries.getClass !== 'function') {
            missing.push('ClassesQueries.getClass');
        }
        if (!ClassesQueries || typeof ClassesQueries.getCharactersByClass !== 'function') {
            missing.push('ClassesQueries.getCharactersByClass');
        }
        if (!ClassesQueries || typeof ClassesQueries.getTeamsByClass !== 'function') {
            missing.push('ClassesQueries.getTeamsByClass');
        }
        if (!ClassesQueries || typeof ClassesQueries.getAvailableStudentsForClass !== 'function') {
            missing.push('ClassesQueries.getAvailableStudentsForClass');
        }
        if (!ClassesQueries || typeof ClassesQueries.getClassDisplayName !== 'function') {
            missing.push('ClassesQueries.getClassDisplayName');
        }

        if (!ClassesCore || typeof ClassesCore.createClass !== 'function') {
            missing.push('ClassesCore.createClass');
        }
        if (!ClassesCore || typeof ClassesCore.updateClass !== 'function') {
            missing.push('ClassesCore.updateClass');
        }
        if (!ClassesCore || typeof ClassesCore.deleteClass !== 'function') {
            missing.push('ClassesCore.deleteClass');
        }
        if (!ClassesCore || typeof ClassesCore.addCharacterToClass !== 'function') {
            missing.push('ClassesCore.addCharacterToClass');
        }
        if (!ClassesCore || typeof ClassesCore.removeCharacterFromClass !== 'function') {
            missing.push('ClassesCore.removeCharacterFromClass');
        }

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCurrentStatus !== 'function') {
            missing.push('CharacterQueries.getCurrentStatus');
        }

        if (!TeamQueries || typeof TeamQueries.getActiveTeamMembers !== 'function') {
            missing.push('TeamQueries.getActiveTeamMembers');
        }
        if (!TeamQueries || typeof TeamQueries.getTeamById !== 'function') {
            missing.push('TeamQueries.getTeamById');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!CalendarConstants || typeof CalendarConstants.MIN_WEEK !== 'number') {
            missing.push('CALENDAR_CONSTANTS');
        }

        if (missing.length > 0) {
            if (container) {
                container.innerHTML = '<p class="empty-state">Classes dependencies not loaded. Please refresh the page.</p>';
            }
            return false;
        }

        return true;
    }

    if (!validateDependencies()) {
        return;
    }

    window.__classesViewLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;
    var MAX_TEAM_SIZE = 20;

    // ============================================================
    // NOTIFICATION - Uses NotificationSystem (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // ACTIVITY LOGGING - Uses ActivityLog (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function recordActivity(message) {
        try {
            if (window.ActivityLog && typeof window.ActivityLog.record === 'function') {
                window.ActivityLog.record(message);
            }
        } catch (e) {
            // Activity logging failure should not abort the operation
        }
    }

    // ============================================================
    // RENDER CLASSES VIEW - Public API
    // ============================================================

    function render(container) {
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

        // Get state from classes-main if available
        var selectedClassId = null;
        var distributionWeek = 1;
        var maxTeamSize = 4;

        if (window.classesState && typeof window.classesState.getState === 'function') {
            var mainState = window.classesState.getState();
            selectedClassId = mainState.selectedClassId || null;
            distributionWeek = mainState.distributionWeek || 1;
            maxTeamSize = mainState.maxTeamSize || 4;
        }

        // Store state for rendering functions
        var renderState = {
            selectedClassId: selectedClassId,
            distributionWeek: distributionWeek,
            maxTeamSize: maxTeamSize
        };

        container.innerHTML = getClassesHTML();
        renderClassList(container, renderState);
        renderClassDetail(container, renderState);
    }

    // ============================================================
    // CLASSES HTML
    // ============================================================

    function getClassesHTML() {
        return [
            '<div id="class-list" class="class-list-panel">',
                '<p class="empty-state">No classes created yet.</p>',
            '</div>',
            '<div id="class-detail" class="class-detail-panel">',
                '<p class="empty-state">Select a class to view details.</p>',
            '</div>'
        ].join('');
    }

    // ============================================================
    // RENDER CLASS LIST
    // ============================================================

    function renderClassList(container, state) {
        var listContainer = container.querySelector('#class-list');
        if (!listContainer) {
            return;
        }

        var classes = ClassesQueries.getClasses();

        if (classes.length === 0) {
            listContainer.innerHTML = '<p class="empty-state">No classes created yet. Create your first class.</p>';
            return;
        }

        var selectedId = state ? state.selectedClassId : null;

        var html = '';
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var count = ClassesQueries.getCharactersByClass(cls.id).length;
            var teamCount = ClassesQueries.getTeamsByClass(cls.id).length;
            var isSelected = selectedId === cls.id;

            html += '<div class="class-list-item' + (isSelected ? ' selected' : '') + '" data-id="' + escapeAttribute(cls.id) + '">';
            html += '<div class="class-list-item-content">';
            html += '<span class="class-list-item-name">' + escapeHtml(cls.name) + '</span>';
            html += '<span class="class-list-item-meta">' + count + ' students, ' + teamCount + ' teams</span>';
            html += '</div>';
            html += '</div>';
        }

        listContainer.innerHTML = html;
    }

    // ============================================================
    // RENDER CLASS DETAIL
    // ============================================================

    function renderClassDetail(container, state) {
        var detailContainer = container.querySelector('#class-detail');
        if (!detailContainer) {
            return;
        }

        var selectedId = state ? state.selectedClassId : null;

        if (!selectedId) {
            detailContainer.innerHTML = '<p class="empty-state">Select a class to view details.</p>';
            return;
        }

        var cls = ClassesQueries.getClass(selectedId);

        if (!cls) {
            detailContainer.innerHTML = '<p class="empty-state">Select a class to view details.</p>';
            return;
        }

        var distributionWeek = state ? state.distributionWeek || 1 : 1;

        var characters = ClassesQueries.getCharactersByClass(cls.id);
        var teams = ClassesQueries.getTeamsByClass(cls.id);
        var available = ClassesQueries.getAvailableStudentsForClass(cls.id, distributionWeek);

        var html = '';
        html += '<div class="class-detail-header">';
        html += '<h3 class="class-detail-title">' + escapeHtml(cls.name) + '</h3>';
        html += '<div class="class-detail-actions">';
        html += '<button class="edit-class-btn secondary small" data-id="' + escapeAttribute(cls.id) + '">Edit</button>';
        html += '<button class="distribute-class-btn primary small" data-id="' + escapeAttribute(cls.id) + '">+ Auto-Distribute</button>';
        html += '<button class="delete-class-btn danger small" data-id="' + escapeAttribute(cls.id) + '">Delete Class</button>';
        html += '</div>';
        html += '</div>';

        html += '<div class="class-detail-stats">';
        html += '<div class="stat-item"><span class="stat-label">Students</span><span class="stat-value">' + characters.length + '</span></div>';
        html += '<div class="stat-item"><span class="stat-label">Teams</span><span class="stat-value">' + teams.length + '</span></div>';
        html += '<div class="stat-item"><span class="stat-label">Available</span><span class="stat-value">' + available.length + '</span></div>';
        html += '</div>';

        // Roster
        html += '<h4 class="class-detail-section-title">Roster (' + characters.length + ')</h4>';

        if (characters.length === 0) {
            html += '<p class="empty-state small">No students in this class.</p>';
        } else {
            html += '<div class="class-roster">';
            for (var i = 0; i < characters.length; i++) {
                var character = characters[i];
                var name = CharacterQueries.getDisplayName(character);
                var status = CharacterQueries.getCurrentStatus(character);
                var isDeceased = character.deceased || false;

                html += '<span class="class-roster-item' + (isDeceased ? ' deceased' : '') + '">';
                html += escapeHtml(name);
                html += ' <span class="class-roster-status">(' + escapeHtml(status) + ')</span>';
                html += ' <button class="remove-student-btn" data-character-id="' + escapeAttribute(character.id) + '">×</button>';
                html += '</span>';
            }
            html += '</div>';
        }

        // Teams
        html += '<h4 class="class-detail-section-title">Teams (' + teams.length + ')</h4>';

        if (teams.length === 0) {
            html += '<p class="empty-state small">No academic teams for this class. Create teams in the Teams tab.</p>';
        } else {
            html += '<div class="class-team-list">';
            for (var j = 0; j < teams.length; j++) {
                var team = teams[j];
                var activeCount = TeamQueries.getActiveTeamMembers(team, distributionWeek).length;
                html += '<span class="class-team-item">';
                html += '<strong>' + escapeHtml(team.name) + '</strong>';
                if (team.teamNumber) {
                    html += ' (#' + escapeHtml(team.teamNumber) + ')';
                }
                html += ' - ' + activeCount + ' active members';
                html += '</span>';
            }
            html += '</div>';
        }

        detailContainer.innerHTML = html;
    }

    // ============================================================
    // SELECT CLASS - Public API
    // ============================================================

    function selectClass(container, classId) {
        if (classId && !ClassesQueries.getClass(classId)) {
            showNotification('Class not found.', 'error');
            return;
        }

        // Update main state if available
        if (window.classesState && typeof window.classesState.selectClass === 'function') {
            window.classesState.selectClass(classId);
        }

        // Get current state for rendering
        var state = null;
        if (window.classesState && typeof window.classesState.getState === 'function') {
            state = window.classesState.getState();
        }

        renderClassList(container, state);
        renderClassDetail(container, state);
    }

    // ============================================================
    // SHOW CLASS FORM
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
            var cls = ClassesQueries.getClass(editId);

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
        input.select();
    }

    // ============================================================
    // SHOW DISTRIBUTE MODAL
    // ============================================================

    function showDistributeModal(container, classId) {
        var cls = ClassesQueries.getClass(classId);

        if (!cls) {
            showNotification('Class not found.', 'error');
            return;
        }

        // Get state from classes-main
        var distributionWeek = 1;
        var maxTeamSize = 4;

        if (window.classesState && typeof window.classesState.getState === 'function') {
            var mainState = window.classesState.getState();
            distributionWeek = mainState.distributionWeek || 1;
            maxTeamSize = mainState.maxTeamSize || 4;
        }

        var teams = ClassesQueries.getTeamsByClass(classId);
        var available = ClassesQueries.getAvailableStudentsForClass(classId, distributionWeek);

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

        if (!modal || !content) {
            showNotification('Modal elements not found. Please refresh.', 'error');
            return;
        }

        // Store classId on modal for use by executeDistribution
        modal.dataset.classId = classId;

        var html = '';
        html += '<p class="distribute-info">';
        html += 'Distribute <strong id="distribute-available-count">' + available.length + '</strong> available students across selected teams.';
        html += ' Students will be assigned as "Member" with join period = selected week.';
        html += '</p>';

        html += '<div class="form-group">';
        html += '<label for="distribute-week">Week:</label>';
        html += '<input type="number" id="distribute-week" value="' + distributionWeek + '" min="' + MIN_WEEK + '" max="' + MAX_WEEK + '">';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="distribute-max-size">Max Students Per Team:</label>';
        html += '<input type="number" id="distribute-max-size" value="' + maxTeamSize + '" min="1" max="' + MAX_TEAM_SIZE + '">';
        html += '</div>';

        html += '<div class="distribute-teams-section">';
        html += '<label class="distribute-teams-label">Select Teams:</label>';
        html += '<div id="distribute-team-list" class="distribute-team-list">';

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            var activeCount = TeamQueries.getActiveTeamMembers(team, distributionWeek).length;
            var checked = activeCount < maxTeamSize ? 'checked' : '';
            var disabled = activeCount >= maxTeamSize ? 'disabled' : '';

            html += '<label class="distribute-team-option">';
            html += '<input type="checkbox" class="team-checkbox" value="' + escapeAttribute(team.id) + '" ' + checked + ' ' + disabled + '>';
            html += escapeHtml(team.name);
            if (team.teamNumber) {
                html += ' (#' + escapeHtml(team.teamNumber) + ')';
            }
            html += ' (' + activeCount + ' active members)';
            if (disabled) {
                html += ' <span class="distribute-team-full">FULL</span>';
            }
            html += '</label>';
        }

        html += '</div>';
        html += '</div>';

        html += '<div class="distribute-note">';
        html += 'Students will be distributed evenly across selected teams.';
        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" id="cancel-distribute" class="secondary">Cancel</button>';
        html += '<button type="button" id="confirm-distribute" class="primary">Distribute Students</button>';
        html += '</div>';

        content.innerHTML = html;
        modal.classList.remove('hidden');

        // Bind events for dynamic updates
        var weekInput = document.getElementById('distribute-week');
        var maxSizeInput = document.getElementById('distribute-max-size');

        if (weekInput) {
            weekInput.addEventListener('change', function() {
                updateDistributeTeamList(container, classId);
            });
        }

        if (maxSizeInput) {
            maxSizeInput.addEventListener('change', function() {
                updateDistributeTeamList(container, classId);
            });
        }
    }

    // ============================================================
    // UPDATE DISTRIBUTE TEAM LIST
    // ============================================================

    function updateDistributeTeamList(container, classId) {
        var modal = document.getElementById('distribute-modal');
        if (!modal) {
            return;
        }

        var teams = ClassesQueries.getTeamsByClass(classId);

        var weekInput = document.getElementById('distribute-week');
        var maxSizeInput = document.getElementById('distribute-max-size');

        var newWeek = parseInt(weekInput ? weekInput.value : 1, 10) || 1;
        var newMaxSize = parseInt(maxSizeInput ? maxSizeInput.value : 4, 10) || 4;

        var teamList = document.getElementById('distribute-team-list');
        if (!teamList) {
            return;
        }

        var newAvailable = ClassesQueries.getAvailableStudentsForClass(classId, newWeek);
        var availableCount = document.getElementById('distribute-available-count');

        if (availableCount) {
            availableCount.textContent = newAvailable.length;
        }

        // Preserve checkbox states
        var checkboxStates = {};
        var teamCheckboxes = teamList.querySelectorAll('.team-checkbox');

        for (var c = 0; c < teamCheckboxes.length; c++) {
            var cb = teamCheckboxes[c];
            checkboxStates[cb.value] = cb.checked;
        }

        var newHtml = '';

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            var activeCount = TeamQueries.getActiveTeamMembers(team, newWeek).length;

            var checked;
            var disabled = '';

            if (activeCount >= newMaxSize) {
                checked = '';
                disabled = 'disabled';
            } else if (checkboxStates[team.id] !== undefined) {
                checked = checkboxStates[team.id] ? 'checked' : '';
            } else {
                checked = 'checked';
            }

            newHtml += '<label class="distribute-team-option">';
            newHtml += '<input type="checkbox" class="team-checkbox" value="' + escapeAttribute(team.id) + '" ' + checked + ' ' + disabled + '>';
            newHtml += escapeHtml(team.name);
            if (team.teamNumber) {
                newHtml += ' (#' + escapeHtml(team.teamNumber) + ')';
            }
            newHtml += ' (' + activeCount + ' active members)';
            if (disabled) {
                newHtml += ' <span class="distribute-team-full">FULL</span>';
            }
            newHtml += '</label>';
        }

        teamList.innerHTML = newHtml;
    }

    // ============================================================
    // EXECUTE DISTRIBUTION
    // ============================================================

    function executeDistribution(container) {
        var modal = document.getElementById('distribute-modal');
        if (!modal) {
            return;
        }

        var classId = modal.dataset.classId;
        if (!classId) {
            showNotification('No class selected.', 'error');
            return;
        }

        var cls = ClassesQueries.getClass(classId);
        if (!cls) {
            showNotification('Class not found.', 'error');
            return;
        }

        var weekInput = document.getElementById('distribute-week');
        var maxSizeInput = document.getElementById('distribute-max-size');

        var week = parseInt(weekInput ? weekInput.value : 1, 10) || 1;
        var maxSize = parseInt(maxSizeInput ? maxSizeInput.value : 4, 10) || 4;

        if (week < MIN_WEEK || week > MAX_WEEK) {
            showNotification('Week must be between ' + MIN_WEEK + ' and ' + MAX_WEEK + '.', 'error');
            return;
        }

        if (maxSize < 1 || maxSize > MAX_TEAM_SIZE) {
            showNotification('Max students per team must be between 1 and ' + MAX_TEAM_SIZE + '.', 'error');
            return;
        }

        // Update state
        if (window.classesState && typeof window.classesState.setState === 'function') {
            window.classesState.setState({
                distributionWeek: week,
                maxTeamSize: maxSize
            });
        }

        var selectedTeamIds = [];
        var checkboxes = modal.querySelectorAll('.team-checkbox:checked');

        for (var c = 0; c < checkboxes.length; c++) {
            selectedTeamIds.push(checkboxes[c].value);
        }

        if (selectedTeamIds.length === 0) {
            showNotification('Please select at least one team.', 'error');
            return;
        }

        var teams = [];
        for (var i = 0; i < selectedTeamIds.length; i++) {
            var team = TeamQueries.getTeamById(selectedTeamIds[i]);
            if (team) {
                teams.push(team);
            }
        }

        var available = ClassesQueries.getAvailableStudentsForClass(classId, week);

        if (available.length === 0) {
            showNotification('No available students for this class at week ' + week + '.', 'error');
            return;
        }

        // Calculate available slots
        var teamActiveCounts = {};
        for (var tIdx = 0; tIdx < teams.length; tIdx++) {
            var t = teams[tIdx];
            var activeMembers = TeamQueries.getActiveTeamMembers(t, week);
            teamActiveCounts[t.id] = activeMembers.length;
        }

        var totalAvailableSlots = 0;
        for (var tIdx2 = 0; tIdx2 < teams.length; tIdx2++) {
            var team2 = teams[tIdx2];
            var currentActive = teamActiveCounts[team2.id] || 0;
            var availableSlots = Math.max(0, maxSize - currentActive);
            totalAvailableSlots += availableSlots;
        }

        if (available.length > totalAvailableSlots) {
            if (!confirm('You have ' + available.length + ' students but only ' + totalAvailableSlots + ' slots available.\n\nSome students will not be assigned. Continue?')) {
                return;
            }
        }

        // Shuffle students
        var shuffled = available.slice();
        for (var s = shuffled.length - 1; s > 0; s--) {
            var j = Math.floor(Math.random() * (s + 1));
            var temp = shuffled[s];
            shuffled[s] = shuffled[j];
            shuffled[j] = temp;
        }

        var capacityExceeded = 0;
        var assignments = [];

        for (var assignIdx = 0; assignIdx < shuffled.length; assignIdx++) {
            var student = shuffled[assignIdx];

            var availableTeams = [];

            for (var teamIdx = 0; teamIdx < teams.length; teamIdx++) {
                var tm = teams[teamIdx];
                if (teamActiveCounts[tm.id] < maxSize) {
                    availableTeams.push(tm);
                }
            }

            if (availableTeams.length === 0) {
                capacityExceeded++;
                continue;
            }

            // Sort by current member count (least filled first)
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

        // Add members using TeamCore
        for (var aIdx = 0; aIdx < assignments.length; aIdx++) {
            var assignment = assignments[aIdx];
            try {
                if (window.TeamCore && typeof window.TeamCore.addMember === 'function') {
                    var result = window.TeamCore.addMember(assignment.teamId, {
                        characterId: assignment.studentId,
                        role: 'Member',
                        joinPeriod: String(assignment.week),
                        leavePeriod: ''
                    });
                    if (result) {
                        successCount++;
                    } else {
                        failCount++;
                    }
                } else {
                    failCount++;
                }
            } catch (e) {
                failCount++;
            }
        }

        if (successCount > 0) {
            recordActivity('Auto-distributed ' + successCount + ' students for class ' + cls.name);
        }

        modal.classList.add('hidden');

        // Refresh UI
        renderClassDetail(container);

        if (typeof window.renderTeamManager === 'function') {
            var teamContainer = document.getElementById('tab-teams');
            if (teamContainer) {
                window.renderTeamManager(teamContainer);
            }
        }

        if (typeof window.renderCharacterList === 'function') {
            window.renderCharacterList();
        }

        var msg = 'Distribution complete.\n\nAssigned: ' + successCount + ' students\nNot assigned (capacity): ' + capacityExceeded + ' students';

        if (failCount > 0) {
            msg += '\n\nFailed assignments: ' + failCount + ' (see console for details)';
        }

        if (successCount === 0) {
            msg += '\n\nNo students were assigned. Please check team capacity and student availability.';
        }

        showNotification(msg, 'success');

        // Persist
        if (typeof window.saveData === 'function') {
            window.saveData().catch(function() {
                showNotification('Distribution completed in memory, but persistence failed.', 'error');
            });
        }
    }

    // ============================================================
    // HTML ESCAPING HELPERS
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
            .replace(/'/g, '&#039;')
            .replace(/`/g, '&#x60;');
    }

    function escapeAttribute(value) {
        if (value === undefined || value === null) {
            return '';
        }
        var str = String(value);
        return str
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // EXPOSE - Public API
    // ============================================================

    window.ClassesView = {
        // Rendering
        render: render,
        renderClassList: renderClassList,
        renderClassDetail: renderClassDetail,

        // Selection
        selectClass: selectClass,

        // Modals
        showClassForm: showClassForm,
        showDistributeModal: showDistributeModal,
        updateDistributeTeamList: updateDistributeTeamList,
        executeDistribution: executeDistribution,

        // Constants
        MIN_WEEK: MIN_WEEK,
        MAX_WEEK: MAX_WEEK
    };

})();
