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
 *   - USES ActivityLog for activity logging
 *   - USES DomUtils for safe DOM operations
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
    window.__classesViewLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var ClassesCore = window.ClassesCore || window;
    var ClassesQueries = window.ClassesQueries || window;
    var CharacterQueries = window.CharacterQueries || window;
    var TeamQueries = window.TeamQueries || window;
    var NotificationSystem = window.NotificationSystem || window;
    var ActivityLog = window.ActivityLog || window;
    var DomUtils = window.DomUtils || window;

    // ============================================================
    // STATE - Classes UI state
    // ============================================================

    var _state = {
        selectedClassId: null,
        distributionWeek: 1,
        maxTeamSize: 4
    };

    // ============================================================
    // DEPENDENCY VALIDATION
    // ============================================================

    function validateDependencies(container) {
        var missing = [];

        // ClassesQueries is MANDATORY
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

        // ClassesCore is MANDATORY
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

        // CharacterQueries is MANDATORY
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCurrentStatus !== 'function') {
            missing.push('CharacterQueries.getCurrentStatus');
        }

        // TeamQueries is MANDATORY
        if (!TeamQueries || typeof TeamQueries.getActiveTeamMembers !== 'function') {
            missing.push('TeamQueries.getActiveTeamMembers');
        }
        if (!TeamQueries || typeof TeamQueries.getTeamById !== 'function') {
            missing.push('TeamQueries.getTeamById');
        }

        // ActivityLog is MANDATORY
        if (!ActivityLog || typeof ActivityLog.record !== 'function') {
            missing.push('ActivityLog.record');
        }

        // NotificationSystem is MANDATORY
        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        // DomUtils is MANDATORY
        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
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
    // HTML ESCAPING - Delegates to DomUtils (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function escapeHtml(value) {
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
        }
        // Emergency fallback (should never be reached)
        if (value === undefined || value === null) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/`/g, '&#x60;');
    }

    // ============================================================
    // NOTIFICATION - Uses NotificationSystem (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        if (NotificationSystem && typeof NotificationSystem.notify === 'function') {
            NotificationSystem.notify(message, type);
        } else if (type === 'error') {
            alert('Error: ' + message);
        } else {
            alert(message);
        }
    }

    // ============================================================
    // ACTIVITY LOGGING - Uses ActivityLog (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function recordActivity(message) {
        try {
            if (ActivityLog && typeof ActivityLog.record === 'function') {
                ActivityLog.record(message);
            }
        } catch (e) {
            // Ignore logging errors
        }
    }

    // ============================================================
    // PERSISTENCE HELPER
    // ============================================================

    function persistMutation(successMessage, errorMessage) {
        if (typeof window.saveData !== 'function') {
            console.warn('Persistence unavailable.');
            showNotification('Changes were applied in memory, but persistent storage is unavailable.', 'error');
            return;
        }

        window.saveData()
            .then(function() {
                if (successMessage) showNotification(successMessage, 'success');
            })
            .catch(function(err) {
                console.error('Persistence error:', err);
                if (errorMessage) showNotification(errorMessage, 'error');
            });
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

        // Ensure curriculum is initialized
        if (typeof window.ensureCurriculum === 'function') {
            try {
                window.ensureCurriculum();
            } catch (e) {
                console.warn('ClassesView: ensureCurriculum() failed:', e);
            }
        }

        if (!validateDependencies(container)) {
            return;
        }

        // Get state from classes-main if available
        if (window.classesState && typeof window.classesState.getState === 'function') {
            var mainState = window.classesState.getState();
            _state.selectedClassId = mainState.selectedClassId || null;
            _state.distributionWeek = mainState.distributionWeek || 1;
            _state.maxTeamSize = mainState.maxTeamSize || 4;
        }

        container.innerHTML = getClassesHTML();
        renderClassList(container);
        renderClassDetail(container);
    }

    // ============================================================
    // CLASSES HTML
    // ============================================================

    function getClassesHTML() {
        return `
            <div id="class-list" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;max-height:500px;overflow-y:auto;">
                <p class="empty-state">No classes created yet.</p>
            </div>
            <div id="class-detail" style="background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:12px;">
                <p class="empty-state">Select a class to view details.</p>
            </div>
        `;
    }

    // ============================================================
    // RENDER CLASS LIST
    // ============================================================

    function renderClassList(container) {
        var listContainer = container ? container.querySelector('#class-list') : document.getElementById('class-list');
        if (!listContainer) {
            return;
        }

        var classes = ClassesQueries.getClasses();

        if (classes.length === 0) {
            listContainer.innerHTML = '<p class="empty-state">No classes created yet. Create your first class.</p>';
            return;
        }

        var html = '';

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var count = ClassesQueries.getCharactersByClass(cls.id).length;
            var isSelected = _state.selectedClassId === cls.id;
            var teamCount = ClassesQueries.getTeamsByClass(cls.id).length;
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
    }

    // ============================================================
    // RENDER CLASS DETAIL
    // ============================================================

    function renderClassDetail(container) {
        var detailContainer = container ? container.querySelector('#class-detail') : document.getElementById('class-detail');
        if (!detailContainer) {
            return;
        }

        if (!_state.selectedClassId) {
            detailContainer.innerHTML = '<p class="empty-state">Select a class to view details.</p>';
            return;
        }

        var cls = ClassesQueries.getClass(_state.selectedClassId);

        if (!cls) {
            _state.selectedClassId = null;
            detailContainer.innerHTML = '<p class="empty-state">Select a class to view details.</p>';
            return;
        }

        var characters = ClassesQueries.getCharactersByClass(cls.id);
        var teams = ClassesQueries.getTeamsByClass(cls.id);
        var available = ClassesQueries.getAvailableStudentsForClass(cls.id, _state.distributionWeek || 1);
        var safeName = escapeHtml(cls.name);

        var html = '';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">';
        html += '<h3 style="color:var(--accent);">' + safeName + '</h3>';
        html += '<div class="class-header-actions" style="display:flex;gap:4px;">';
        html += '<button id="edit-class-btn" class="secondary small" data-id="' + escapeHtml(cls.id) + '">Edit</button>';
        html += '<button id="distribute-class-btn" class="primary small" data-id="' + escapeHtml(cls.id) + '">+ Auto-Distribute</button>';
        html += '<button id="delete-class-btn" class="danger small" data-id="' + escapeHtml(cls.id) + '">Delete Class</button>';
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

            for (var i = 0; i < characters.length; i++) {
                var char = characters[i];
                var name = CharacterQueries.getDisplayName(char);
                var status = CharacterQueries.getCurrentStatus(char);
                var isDeceased = char.deceased || false;
                var safeName2 = escapeHtml(name);
                var safeStatus = escapeHtml(status);

                html += '<span style="background:var(--panel-alt);padding:2px 10px;border-radius:12px;font-size:0.7rem;' +
                    (isDeceased ? 'opacity:0.4;text-decoration:line-through;' : '') + '">' +
                    safeName2 + ' <span style="color:var(--text-dim);font-size:0.6rem;">(' + safeStatus + ')</span>' +
                    ' <button class="remove-student-btn" data-character-id="' + escapeHtml(char.id) + '" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.5rem;padding:0 2px;">✕</button>' +
                    '</span>';
            }

            html += '</div>';
        }

        // Teams
        html += '<h4 style="color:var(--text-dim);font-size:0.8rem;margin:8px 0 4px 0;">Teams (' + teams.length + ')</h4>';

        if (teams.length === 0) {
            html += '<p class="empty-state" style="padding:8px;font-size:0.75rem;">No academic teams for this class. Create teams in the Teams tab.</p>';
        } else {
            html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">';

            for (var i = 0; i < teams.length; i++) {
                var team = teams[i];
                var activeCount = TeamQueries.getActiveTeamMembers(team, _state.distributionWeek || 1).length;
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
    }

    // ============================================================
    // SELECT CLASS - Public API
    // ============================================================

    function selectClass(container, classId) {
        if (classId && !ClassesQueries.getClass(classId)) {
            showNotification('Class not found.', 'error');
            return;
        }

        _state.selectedClassId = classId || null;

        // Update main state if available
        if (window.classesState && typeof window.classesState.setState === 'function') {
            window.classesState.setState({ selectedClassId: _state.selectedClassId });
        }

        renderClassList(container);
        renderClassDetail(container);
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

        var distributionWeek = _state.distributionWeek || 1;
        var maxTeamSize = _state.maxTeamSize || 4;

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
            var activeCount = TeamQueries.getActiveTeamMembers(team, distributionWeek).length;
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

        // Confirm button - handled by ClassesEvents
        var confirmBtn = document.getElementById('confirm-distribute');
        if (confirmBtn) {
            // Store classId for the event handler
            confirmBtn.dataset.classId = classId;
        }
    }

    // ============================================================
    // UPDATE DISTRIBUTE TEAM LIST
    // ============================================================

    function updateDistributeTeamList(container, classId) {
        var modal = document.getElementById('distribute-modal');
        if (!modal) return;

        var teams = ClassesQueries.getTeamsByClass(classId);

        var weekInput = document.getElementById('distribute-week');
        var maxSizeInput = document.getElementById('distribute-max-size');

        var newWeek = parseInt(weekInput ? weekInput.value : 1, 10) || 1;
        var newMaxSize = parseInt(maxSizeInput ? maxSizeInput.value : 4, 10) || 4;

        var teamList = document.getElementById('distribute-team-list');
        if (!teamList) return;

        var newAvailable = ClassesQueries.getAvailableStudentsForClass(classId, newWeek);
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
            var activeCount = TeamQueries.getActiveTeamMembers(team, newWeek).length;

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

    // ============================================================
    // EXECUTE DISTRIBUTION
    // ============================================================

    function executeDistribution(container) {
        var modal = document.getElementById('distribute-modal');
        if (!modal) return;

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

        if (week < 1 || week > 52) {
            showNotification('Week must be between 1 and 52.', 'error');
            return;
        }

        if (maxSize < 1 || maxSize > 20) {
            showNotification('Max students per team must be between 1 and 20.', 'error');
            return;
        }

        _state.distributionWeek = week;
        _state.maxTeamSize = maxSize;

        // Update main state if available
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
        for (var i = 0; i < teams.length; i++) {
            var t = teams[i];
            var activeMembers = TeamQueries.getActiveTeamMembers(t, week);
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

        // Shuffle students
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
        for (var i = 0; i < assignments.length; i++) {
            var assignment = assignments[i];
            try {
                // Use TeamCore.addMember if available
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
                    // Fallback - show error
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

        persistMutation(msg, 'Distribution completed in memory, but persistence failed.');
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

        // State
        getState: function() {
            return {
                selectedClassId: _state.selectedClassId,
                distributionWeek: _state.distributionWeek,
                maxTeamSize: _state.maxTeamSize
            };
        },
        setState: function(newState) {
            if (newState.selectedClassId !== undefined) {
                _state.selectedClassId = newState.selectedClassId;
            }
            if (newState.distributionWeek !== undefined) {
                _state.distributionWeek = newState.distributionWeek;
            }
            if (newState.maxTeamSize !== undefined) {
                _state.maxTeamSize = newState.maxTeamSize;
            }
        },

        // Constants
        MIN_WEEK: 1,
        MAX_WEEK: 52
    };

})();
