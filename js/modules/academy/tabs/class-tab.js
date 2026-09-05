/**
 * js/modules/academy/tabs/class-tab.js - Class Sub-Tab
 * Handles class management, rosters, academic teams, and tournaments
 * Path: js/modules/academy/tabs/class-tab.js
 * 
 * This module is responsible for:
 *   - Class CRUD (list, create, edit, delete)
 *   - Class roster management (add/remove students)
 *   - Academic team management for a class
 *   - Tournament management for a class
 *   - Auto-distribute students to teams
 * 
 * IMPORTANT:
 *   - This module is UI-ONLY - all mutations delegate to domain cores
 *   - Uses ClassesCore for class operations
 *   - Uses TeamCore for academic team operations
 *   - Uses AcademyGroups for auto-group operations
 *   - Uses AcademyDistribute for student distribution
 *   - Uses AcademyQueries for read-only access
 *   - All HTML escaping uses DomUtils.escapeHtml()
 *   - All notifications use NotificationSystem.notify()
 *   - All modals use Modal system
 * 
 * DEPENDENCIES:
 *   - window.ClassesCore (from classes-core.js)
 *   - window.TeamCore (from team-core.js)
 *   - window.AcademyGroups (from academy-groups.js)
 *   - window.AcademyDistribute (from academy-distribute.js)
 *   - window.AcademyQueries (from academy-queries.js)
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.Modal (from modal.js)
 *   - window.saveData (from database.js)
 */

(function() {
    'use strict';

    // Guard against duplicate loading
    if (window.__classTabLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - NO FALLBACKS
    // ============================================================

    var ClassesCore = window.ClassesCore;
    var TeamCore = window.TeamCore;
    var AcademyGroups = window.AcademyGroups;
    var AcademyDistribute = window.AcademyDistribute;
    var AcademyQueries = window.AcademyQueries;
    var CharacterQueries = window.CharacterQueries;
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;
    var Modal = window.Modal;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!ClassesCore || typeof ClassesCore.getClass !== 'function') {
            missing.push('ClassesCore.getClass');
        }
        if (!ClassesCore || typeof ClassesCore.getClasses !== 'function') {
            missing.push('ClassesCore.getClasses');
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

        if (!TeamCore || typeof TeamCore.getTeam !== 'function') {
            missing.push('TeamCore.getTeam');
        }
        if (!TeamCore || typeof TeamCore.createTeam !== 'function') {
            missing.push('TeamCore.createTeam');
        }
        if (!TeamCore || typeof TeamCore.updateTeam !== 'function') {
            missing.push('TeamCore.updateTeam');
        }
        if (!TeamCore || typeof TeamCore.deleteTeam !== 'function') {
            missing.push('TeamCore.deleteTeam');
        }
        if (!TeamCore || typeof TeamCore.addMember !== 'function') {
            missing.push('TeamCore.addMember');
        }
        if (!TeamCore || typeof TeamCore.removeMember !== 'function') {
            missing.push('TeamCore.removeMember');
        }

        if (!AcademyGroups || typeof AcademyGroups.getGroupStudents !== 'function') {
            missing.push('AcademyGroups.getGroupStudents');
        }

        if (!AcademyDistribute || typeof AcademyDistribute.autoDistributeStudents !== 'function') {
            missing.push('AcademyDistribute.autoDistributeStudents');
        }

        if (!AcademyQueries || typeof AcademyQueries.getClasses !== 'function') {
            missing.push('AcademyQueries.getClasses');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClass !== 'function') {
            missing.push('AcademyQueries.getClass');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClassStudents !== 'function') {
            missing.push('AcademyQueries.getClassStudents');
        }
        if (!AcademyQueries || typeof AcademyQueries.getAcademicTeams !== 'function') {
            missing.push('AcademyQueries.getAcademicTeams');
        }
        if (!AcademyQueries || typeof AcademyQueries.getAvailableStudents !== 'function') {
            missing.push('AcademyQueries.getAvailableStudents');
        }
        if (!AcademyQueries || typeof AcademyQueries.getTournaments !== 'function') {
            missing.push('AcademyQueries.getTournaments');
        }

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCurrentStatus !== 'function') {
            missing.push('CharacterQueries.getCurrentStatus');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (!Modal || typeof Modal.createModal !== 'function') {
            missing.push('Modal.createModal');
        }

        if (missing.length > 0) {
            console.warn('ClassTab: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    if (!checkDependencies()) {
        return;
    }

    window.__classTabLoaded = true;

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    // ============================================================
    // NOTIFICATION - Delegates to NotificationSystem
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // PERSISTENCE HELPER
    // ============================================================

    function persistMutation(successMessage, errorMessage) {
        if (typeof window.saveData !== 'function') {
            showNotification('Changes were applied in memory, but persistent storage is unavailable.', 'error');
            return;
        }

        window.saveData()
            .then(function() {
                if (successMessage) {
                    showNotification(successMessage, 'success');
                }
            })
            .catch(function() {
                if (errorMessage) {
                    showNotification(errorMessage, 'error');
                }
            });
    }

    // ============================================================
    // RENDER CLASS TAB
    // ============================================================

    function renderClassTab(state) {
        var classes = AcademyQueries.getClasses();
        var selectedClassId = state.selectedClassId;
        var selectedClass = selectedClassId ? AcademyQueries.getClass(selectedClassId) : null;

        var html = '';

        // Class list
        html += '<div class="class-tab-layout">';
        html += '<div class="class-tab-sidebar">';
        html += '<div class="class-tab-header">';
        html += '<h3>Classes</h3>';
        html += '<button id="academy-add-class-btn" class="primary small">+ Add</button>';
        html += '</div>';
        html += '<div id="academy-class-list">';
        html += renderClassList(state);
        html += '</div>';
        html += '</div>';

        // Class detail
        html += '<div class="class-tab-detail">';
        if (selectedClass) {
            html += renderClassDetail(state, selectedClass);
        } else {
            html += '<p class="empty-state">Select a class to view details.</p>';
        }
        html += '</div>';
        html += '</div>';

        // Modals
        html += getModalsHTML();

        return html;
    }

    // ============================================================
    // RENDER CLASS LIST
    // ============================================================

    function renderClassList(state) {
        var classes = ClassesCore.getClasses();
        var selectedId = state.selectedClassId;

        if (classes.length === 0) {
            return '<p class="empty-state">No classes created yet.</p>';
        }

        var html = '';
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var count = AcademyQueries.getClassStudentCount(cls.id);
            var teamCount = AcademyQueries.getClassTeamCount(cls.id);
            var isSelected = selectedId === cls.id;

            html += '<div class="class-list-item' + (isSelected ? ' selected' : '') + '" data-id="' + escapeHtml(cls.id) + '">';
            html += '<div class="class-list-item-content">';
            html += '<span class="class-list-item-name">' + escapeHtml(cls.name) + '</span>';
            html += '<span class="class-list-item-meta">' + count + ' students, ' + teamCount + ' teams</span>';
            html += '</div>';
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // RENDER CLASS DETAIL
    // ============================================================

    function renderClassDetail(state, cls) {
        if (!cls) {
            return '<p class="empty-state">Class not found.</p>';
        }

        var students = AcademyQueries.getClassStudents(cls.id);
        var teams = AcademyQueries.getAcademicTeams(cls.id);
        var tournaments = AcademyQueries.getTournaments(cls.id);
        var week = state.selectedWeek || 1;

        var html = '';

        // Header
        html += '<div class="class-detail-header">';
        html += '<h3 class="class-detail-title">' + escapeHtml(cls.name) + '</h3>';
        html += '<div class="class-detail-actions">';
        html += '<button class="edit-class-btn secondary small" data-id="' + escapeHtml(cls.id) + '">Edit</button>';
        html += '<button class="distribute-class-btn primary small" data-id="' + escapeHtml(cls.id) + '">Distribute</button>';
        html += '<button class="delete-class-btn danger small" data-id="' + escapeHtml(cls.id) + '">Delete</button>';
        html += '</div>';
        html += '</div>';

        // Stats
        html += '<div class="class-detail-stats">';
        html += '<div class="stat-item"><span class="stat-label">Students</span><span class="stat-value">' + students.length + '</span></div>';
        html += '<div class="stat-item"><span class="stat-label">Teams</span><span class="stat-value">' + teams.length + '</span></div>';
        html += '<div class="stat-item"><span class="stat-label">Tournaments</span><span class="stat-value">' + tournaments.length + '</span></div>';
        html += '</div>';

        // Tabs within detail
        html += '<div class="class-detail-tabs">';
        html += '<button class="detail-tab-btn active" data-tab="roster">Roster</button>';
        html += '<button class="detail-tab-btn" data-tab="teams">Teams</button>';
        html += '<button class="detail-tab-btn" data-tab="tournaments">Tournaments</button>';
        html += '</div>';

        // Roster tab
        html += '<div class="detail-tab-panel active" data-tab="roster">';
        html += renderRosterTab(state, cls, students);
        html += '</div>';

        // Teams tab
        html += '<div class="detail-tab-panel" data-tab="teams" style="display:none;">';
        html += renderTeamsTab(state, cls, teams);
        html += '</div>';

        // Tournaments tab
        html += '<div class="detail-tab-panel" data-tab="tournaments" style="display:none;">';
        html += renderTournamentsTab(state, cls, tournaments);
        html += '</div>';

        return html;
    }

    // ============================================================
    // RENDER ROSTER TAB
    // ============================================================

    function renderRosterTab(state, cls, students) {
        var html = '';

        // Add student form
        html += '<div class="roster-add-form">';
        html += '<select id="roster-add-student" class="small">';
        html += '<option value="">Add student...</option>';

        var available = AcademyQueries.getAvailableStudents(cls.id, state.selectedWeek || 1);
        for (var i = 0; i < available.length; i++) {
            var student = available[i];
            var name = CharacterQueries.getDisplayName(student);
            html += '<option value="' + escapeHtml(student.id) + '">' + escapeHtml(name) + '</option>';
        }

        html += '</select>';
        html += '<button id="roster-add-btn" class="primary small">Add</button>';
        html += '</div>';

        // Student list
        if (students.length === 0) {
            html += '<p class="empty-state small">No students in this class.</p>';
        } else {
            html += '<div class="roster-list">';
            for (var j = 0; j < students.length; j++) {
                var s = students[j];
                var name = CharacterQueries.getDisplayName(s);
                var status = CharacterQueries.getCurrentStatus(s);
                var isDeceased = s.deceased || false;

                html += '<div class="roster-item' + (isDeceased ? ' deceased' : '') + '">';
                html += '<span class="roster-name">' + escapeHtml(name) + '</span>';
                html += '<span class="roster-status">(' + escapeHtml(status) + ')</span>';
                html += '<button class="roster-remove-btn small danger" data-student="' + escapeHtml(s.id) + '">x</button>';
                html += '</div>';
            }
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // RENDER TEAMS TAB
    // ============================================================

    function renderTeamsTab(state, cls, teams) {
        var html = '';

        // Add team form
        html += '<div class="teams-add-form">';
        html += '<input type="text" id="team-add-name" placeholder="Team name" class="small">';
        html += '<input type="text" id="team-add-number" placeholder="Number (optional)" class="small">';
        html += '<button id="team-add-btn" class="primary small">+ Add Team</button>';
        html += '</div>';

        if (teams.length === 0) {
            html += '<p class="empty-state small">No academic teams for this class.</p>';
        } else {
            html += '<div class="teams-list">';
            for (var i = 0; i < teams.length; i++) {
                var team = teams[i];
                var memberCount = TeamCore.getActiveMembers(team, state.selectedWeek || 1).length;

                html += '<div class="team-item">';
                html += '<div class="team-item-header">';
                html += '<span class="team-name"><strong>' + escapeHtml(team.name) + '</strong>';
                if (team.teamNumber) {
                    html += ' <span class="team-number">(#' + escapeHtml(team.teamNumber) + ')</span>';
                }
                html += ' <span class="team-count">' + memberCount + ' members</span>';
                html += '</span>';
                html += '<div class="team-actions">';
                html += '<button class="team-manage-members small" data-team="' + escapeHtml(team.id) + '">Members</button>';
                html += '<button class="team-delete-btn small danger" data-team="' + escapeHtml(team.id) + '">x</button>';
                html += '</div>';
                html += '</div>';

                // Members (collapsed by default)
                html += '<div class="team-members-list" style="display:none;">';
                var members = TeamCore.getActiveMembers(team, state.selectedWeek || 1);
                if (members.length === 0) {
                    html += '<p class="empty-state small">No members</p>';
                } else {
                    for (var j = 0; j < members.length; j++) {
                        var member = members[j];
                        var char = CharacterQueries.getCharacterById(member.characterId);
                        var name = char ? CharacterQueries.getDisplayName(char) : 'Unknown';
                        html += '<div class="team-member-item">';
                        html += '<span>' + escapeHtml(name) + '</span>';
                        html += '<span class="team-member-role">' + escapeHtml(member.role || 'Member') + '</span>';
                        html += '<button class="team-member-remove small danger" data-team="' + escapeHtml(team.id) + '" data-student="' + escapeHtml(member.characterId) + '">x</button>';
                        html += '</div>';
                    }
                }
                html += '</div>';
                html += '</div>';
            }
            html += '</div>';
        }

        // Distribute button
        html += '<div class="teams-distribute">';
        html += '<button id="distribute-class-btn" class="primary" data-class="' + escapeHtml(cls.id) + '">Auto-Distribute Students</button>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // RENDER TOURNAMENTS TAB
    // ============================================================

    function renderTournamentsTab(state, cls, tournaments) {
        var html = '';

        // Add tournament form
        html += '<div class="tournament-add-form">';
        html += '<input type="text" id="tournament-add-name" placeholder="Tournament name" class="small">';
        html += '<input type="text" id="tournament-add-desc" placeholder="Description (optional)" class="small">';
        html += '<input type="number" id="tournament-add-week" placeholder="Week" value="' + (state.selectedWeek || 1) + '" class="small" min="1" max="52">';
        html += '<button id="tournament-add-btn" class="primary small">+ Add Tournament</button>';
        html += '</div>';

        if (tournaments.length === 0) {
            html += '<p class="empty-state small">No tournaments for this class.</p>';
        } else {
            html += '<div class="tournaments-list">';
            for (var i = 0; i < tournaments.length; i++) {
                var t = tournaments[i];

                html += '<div class="tournament-item">';
                html += '<div class="tournament-item-header">';
                html += '<span class="tournament-name"><strong>' + escapeHtml(t.name) + '</strong>';
                if (t.description) {
                    html += ' <span class="tournament-desc">- ' + escapeHtml(t.description) + '</span>';
                }
                html += ' <span class="tournament-week">(Week ' + escapeHtml(t.week) + ')</span>';
                html += ' <span class="tournament-status">' + escapeHtml(t.status || 'active') + '</span>';
                html += '</span>';
                html += '<div class="tournament-actions">';
                html += '<button class="tournament-manage-teams small" data-tournament="' + escapeHtml(t.id) + '">Teams</button>';
                html += '<button class="tournament-delete-btn small danger" data-tournament="' + escapeHtml(t.id) + '">x</button>';
                html += '</div>';
                html += '</div>';

                // Teams list (collapsed by default)
                html += '<div class="tournament-teams-list" style="display:none;">';
                var teams = AcademyQueries.getTournamentTeams(t.id);
                if (teams.length === 0) {
                    html += '<p class="empty-state small">No teams in this tournament.</p>';
                    html += '<div class="tournament-add-team-form">';
                    html += '<select class="tournament-team-select small">';
                    html += '<option value="">Add team...</option>';
                    var availableTeams = AcademyQueries.getAcademicTeams(cls.id);
                    for (var j = 0; j < availableTeams.length; j++) {
                        var at = availableTeams[j];
                        var inTournament = false;
                        for (var k = 0; k < teams.length; k++) {
                            if (String(teams[k].id) === String(at.id)) {
                                inTournament = true;
                                break;
                            }
                        }
                        if (!inTournament) {
                            html += '<option value="' + escapeHtml(at.id) + '">' + escapeHtml(at.name) + '</option>';
                        }
                    }
                    html += '</select>';
                    html += '<button class="tournament-add-team-btn small primary" data-tournament="' + escapeHtml(t.id) + '">Add</button>';
                    html += '</div>';
                } else {
                    for (var j = 0; j < teams.length; j++) {
                        var team = teams[j];
                        html += '<div class="tournament-team-item">';
                        html += '<span>' + escapeHtml(team.name) + '</span>';
                        html += '<button class="tournament-remove-team small danger" data-tournament="' + escapeHtml(t.id) + '" data-team="' + escapeHtml(team.id) + '">x</button>';
                        html += '</div>';
                    }
                    html += '<div class="tournament-add-team-form">';
                    html += '<select class="tournament-team-select small">';
                    html += '<option value="">Add team...</option>';
                    var availableTeams2 = AcademyQueries.getAcademicTeams(cls.id);
                    for (var j2 = 0; j2 < availableTeams2.length; j2++) {
                        var at2 = availableTeams2[j2];
                        var inTournament2 = false;
                        for (var k2 = 0; k2 < teams.length; k2++) {
                            if (String(teams[k2].id) === String(at2.id)) {
                                inTournament2 = true;
                                break;
                            }
                        }
                        if (!inTournament2) {
                            html += '<option value="' + escapeHtml(at2.id) + '">' + escapeHtml(at2.name) + '</option>';
                        }
                    }
                    html += '</select>';
                    html += '<button class="tournament-add-team-btn small primary" data-tournament="' + escapeHtml(t.id) + '">Add</button>';
                    html += '</div>';
                }
                html += '</div>';
                html += '</div>';
            }
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // MODALS HTML
    // ============================================================

    function getModalsHTML() {
        return [
            '<!-- Class Form Modal -->',
            '<div id="academy-class-modal" class="modal hidden">',
                '<div class="modal-content small">',
                    '<div class="modal-header">',
                        '<h3 id="academy-class-modal-title">Add Class</h3>',
                        '<button class="close-modal" id="academy-class-modal-close">&times;</button>',
                    '</div>',
                    '<div class="modal-body">',
                        '<form id="academy-class-form">',
                            '<div class="form-group">',
                                '<label>Class Name *</label>',
                                '<input type="text" id="academy-class-name" placeholder="e.g., Spring 2025" required>',
                            '</div>',
                            '<div class="form-actions">',
                                '<button type="button" id="academy-class-modal-cancel" class="secondary">Cancel</button>',
                                '<button type="submit" id="academy-class-modal-save" class="primary">Save</button>',
                            '</div>',
                        '</form>',
                    '</div>',
                '</div>',
            '</div>',

            '<!-- Distribute Modal -->',
            '<div id="academy-distribute-modal" class="modal hidden">',
                '<div class="modal-content">',
                    '<div class="modal-header">',
                        '<h3>Auto-Distribute Students</h3>',
                        '<button class="close-modal" id="academy-distribute-close">&times;</button>',
                    '</div>',
                    '<div class="modal-body">',
                        '<div id="academy-distribute-content"></div>',
                        '<div class="form-actions">',
                            '<button type="button" id="academy-distribute-cancel" class="secondary">Cancel</button>',
                            '<button type="button" id="academy-distribute-confirm" class="primary">Distribute</button>',
                        '</div>',
                    '</div>',
                '</div>',
            '</div>',

            '<!-- Team Members Modal -->',
            '<div id="academy-team-members-modal" class="modal hidden">',
                '<div class="modal-content">',
                    '<div class="modal-header">',
                        '<h3 id="academy-team-members-title">Team Members</h3>',
                        '<button class="close-modal" id="academy-team-members-close">&times;</button>',
                    '</div>',
                    '<div class="modal-body">',
                        '<div id="academy-team-members-content"></div>',
                    '</div>',
                '</div>',
            '</div>'
        ].join('');
    }

    // ============================================================
    // EVENT BINDING
    // ============================================================

    function bindClassTabEvents(container) {
        // Class list click - select class
        var listContainer = container.querySelector('#academy-class-list');
        if (listContainer) {
            listContainer.addEventListener('click', function(e) {
                var item = e.target.closest('.class-list-item');
                if (!item) {
                    return;
                }
                var id = item.dataset.id;
                if (id && window.academyState && typeof window.academyState.selectClass === 'function') {
                    window.academyState.selectClass(id);
                    if (typeof window.refreshAcademy === 'function') {
                        window.refreshAcademy();
                    }
                }
            });
        }

        // Add class button
        var addBtn = container.querySelector('#academy-add-class-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() {
                showClassForm(null);
            });
        }

        // Edit class buttons (delegated)
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.edit-class-btn');
            if (btn) {
                var id = btn.dataset.id;
                if (id) {
                    showClassForm(id);
                }
            }
        });

        // Delete class buttons (delegated)
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.delete-class-btn');
            if (btn) {
                var id = btn.dataset.id;
                if (id && confirm('Delete this class permanently?')) {
                    handleDeleteClass(id);
                }
            }
        });

        // Distribute buttons (delegated)
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.distribute-class-btn, #distribute-class-btn');
            if (btn) {
                var id = btn.dataset.class || btn.dataset.id;
                if (id) {
                    showDistributeModal(id);
                }
            }
        });

        // Roster add
        var rosterAddBtn = container.querySelector('#roster-add-btn');
        if (rosterAddBtn) {
            rosterAddBtn.addEventListener('click', function() {
                var select = container.querySelector('#roster-add-student');
                if (select && select.value) {
                    handleAddStudentToClass(select.value);
                }
            });
        }

        // Roster remove (delegated)
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.roster-remove-btn');
            if (btn) {
                var studentId = btn.dataset.student;
                if (studentId && confirm('Remove this student from the class?')) {
                    var classId = window.academyState ? window.academyState.getSelectedClassId() : null;
                    if (classId) {
                        handleRemoveStudentFromClass(classId, studentId);
                    }
                }
            }
        });

        // Team add
        var teamAddBtn = container.querySelector('#team-add-btn');
        if (teamAddBtn) {
            teamAddBtn.addEventListener('click', function() {
                var nameInput = container.querySelector('#team-add-name');
                var numberInput = container.querySelector('#team-add-number');
                var classId = window.academyState ? window.academyState.getSelectedClassId() : null;

                if (!classId) {
                    showNotification('No class selected.', 'error');
                    return;
                }

                var name = nameInput ? nameInput.value.trim() : '';
                if (!name) {
                    showNotification('Team name is required.', 'error');
                    return;
                }

                var teamData = {
                    name: name,
                    type: 'academic',
                    classId: classId,
                    teamNumber: numberInput ? numberInput.value.trim() : '',
                    startPeriod: String(state.selectedWeek || 1),
                    endPeriod: '',
                    status: 'active'
                };

                var result = TeamCore.createTeam(teamData);
                if (result) {
                    showNotification('Team created successfully.', 'success');
                    if (nameInput) { nameInput.value = ''; }
                    if (numberInput) { numberInput.value = ''; }
                    if (typeof window.refreshAcademy === 'function') {
                        window.refreshAcademy();
                    }
                    persistMutation(null, 'Team created in memory, but persistence failed.');
                } else {
                    showNotification('Failed to create team.', 'error');
                }
            });
        }

        // Team manage members (delegated)
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.team-manage-members');
            if (btn) {
                var teamId = btn.dataset.team;
                if (teamId) {
                    showTeamMembersModal(teamId);
                }
            }
        });

        // Team delete (delegated)
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.team-delete-btn');
            if (btn) {
                var teamId = btn.dataset.team;
                if (teamId && confirm('Delete this team?')) {
                    handleDeleteAcademicTeam(teamId);
                }
            }
        });

        // Team member remove (delegated)
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.team-member-remove');
            if (btn) {
                var teamId = btn.dataset.team;
                var studentId = btn.dataset.student;
                if (teamId && studentId && confirm('Remove this member?')) {
                    handleRemoveStudentFromAcademicTeam(teamId, studentId);
                }
            }
        });

        // Tournament add
        var tournAddBtn = container.querySelector('#tournament-add-btn');
        if (tournAddBtn) {
            tournAddBtn.addEventListener('click', function() {
                var nameInput = container.querySelector('#tournament-add-name');
                var descInput = container.querySelector('#tournament-add-desc');
                var weekInput = container.querySelector('#tournament-add-week');
                var classId = window.academyState ? window.academyState.getSelectedClassId() : null;

                if (!classId) {
                    showNotification('No class selected.', 'error');
                    return;
                }

                var name = nameInput ? nameInput.value.trim() : '';
                if (!name) {
                    showNotification('Tournament name is required.', 'error');
                    return;
                }

                var week = weekInput ? parseInt(weekInput.value, 10) : 1;
                if (isNaN(week) || week < 1 || week > 52) {
                    week = 1;
                }

                var result = AcademyTournaments.createTournament(classId, name, descInput ? descInput.value.trim() : '', week);
                if (result && result.success) {
                    showNotification('Tournament created successfully.', 'success');
                    if (nameInput) { nameInput.value = ''; }
                    if (descInput) { descInput.value = ''; }
                    if (typeof window.refreshAcademy === 'function') {
                        window.refreshAcademy();
                    }
                    persistMutation(null, 'Tournament created in memory, but persistence failed.');
                } else {
                    showNotification(result ? result.message : 'Failed to create tournament.', 'error');
                }
            });
        }

        // Tournament delete (delegated)
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.tournament-delete-btn');
            if (btn) {
                var tournamentId = btn.dataset.tournament;
                if (tournamentId && confirm('Delete this tournament?')) {
                    handleDeleteTournament(tournamentId);
                }
            }
        });

        // Tournament manage teams (delegated)
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.tournament-manage-teams');
            if (btn) {
                var tournamentId = btn.dataset.tournament;
                if (tournamentId) {
                    toggleTournamentTeams(tournamentId, container);
                }
            }
        });

        // Tournament add team (delegated)
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.tournament-add-team-btn');
            if (btn) {
                var tournamentId = btn.dataset.tournament;
                var select = btn.parentElement.querySelector('.tournament-team-select');
                if (tournamentId && select && select.value) {
                    handleAddTeamToTournament(tournamentId, select.value);
                }
            }
        });

        // Tournament remove team (delegated)
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.tournament-remove-team');
            if (btn) {
                var tournamentId = btn.dataset.tournament;
                var teamId = btn.dataset.team;
                if (tournamentId && teamId && confirm('Remove this team from the tournament?')) {
                    handleRemoveTeamFromTournament(tournamentId, teamId);
                }
            }
        });

        // Detail tab switching
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.detail-tab-btn');
            if (btn) {
                var tab = btn.dataset.tab;
                if (tab) {
                    switchDetailTab(container, tab);
                }
            }
        });

        // Class form modal
        bindClassFormEvents(container);

        // Distribute modal
        bindDistributeEvents(container);

        // Team members modal
        bindTeamMembersEvents(container);
    }

    // ============================================================
    // DETAIL TAB SWITCHING
    // ============================================================

    function switchDetailTab(container, tab) {
        var btns = container.querySelectorAll('.detail-tab-btn');
        for (var i = 0; i < btns.length; i++) {
            btns[i].classList.toggle('active', btns[i].dataset.tab === tab);
        }

        var panels = container.querySelectorAll('.detail-tab-panel');
        for (var j = 0; j < panels.length; j++) {
            var panel = panels[j];
            var isActive = panel.dataset.tab === tab;
            panel.style.display = isActive ? 'block' : 'none';
            panel.classList.toggle('active', isActive);
        }
    }

    // ============================================================
    // CLASS FORM EVENTS
    // ============================================================

    function bindClassFormEvents(container) {
        var modal = document.getElementById('academy-class-modal');
        var form = document.getElementById('academy-class-form');
        var closeBtn = document.getElementById('academy-class-modal-close');
        var cancelBtn = document.getElementById('academy-class-modal-cancel');
        var nameInput = document.getElementById('academy-class-name');
        var titleEl = document.getElementById('academy-class-modal-title');

        // Close handlers
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                if (modal) { modal.classList.add('hidden'); }
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', function() {
                if (modal) { modal.classList.add('hidden'); }
            });
        }

        if (modal) {
            modal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                }
            });
        }

        // Form submit
        if (form) {
            form.addEventListener('submit', function(e) {
                e.preventDefault();
                var name = nameInput ? nameInput.value.trim() : '';
                if (!name) {
                    showNotification('Class name is required.', 'error');
                    return;
                }

                var editId = form.dataset.editId;
                var result;

                if (editId) {
                    result = ClassesCore.updateClass(editId, { name: name });
                } else {
                    result = ClassesCore.createClass(name);
                }

                if (result && result.success) {
                    showNotification(editId ? 'Class updated successfully.' : 'Class created successfully.', 'success');
                    if (modal) { modal.classList.add('hidden'); }
                    if (typeof window.refreshAcademy === 'function') {
                        window.refreshAcademy();
                    }
                    persistMutation(null, 'Class changes in memory, but persistence failed.');
                } else {
                    showNotification(result ? result.message : 'Failed to save class.', 'error');
                }
            });
        }

        // Store references for showClassForm
        window._academyClassModal = modal;
        window._academyClassForm = form;
        window._academyClassNameInput = nameInput;
        window._academyClassTitle = titleEl;
    }

    function showClassForm(editId) {
        var modal = document.getElementById('academy-class-modal');
        var form = document.getElementById('academy-class-form');
        var nameInput = document.getElementById('academy-class-name');
        var titleEl = document.getElementById('academy-class-modal-title');

        if (!modal || !form || !nameInput) {
            showNotification('Form elements not found.', 'error');
            return;
        }

        if (editId) {
            var cls = ClassesCore.getClass(editId);
            if (!cls) {
                showNotification('Class not found.', 'error');
                return;
            }
            titleEl.textContent = 'Edit Class';
            nameInput.value = cls.name;
            form.dataset.editId = editId;
        } else {
            titleEl.textContent = 'Add Class';
            nameInput.value = '';
            delete form.dataset.editId;
        }

        modal.classList.remove('hidden');
        nameInput.focus();
        nameInput.select();
    }

    // ============================================================
    // DISTRIBUTE EVENTS
    // ============================================================

    function bindDistributeEvents(container) {
        var modal = document.getElementById('academy-distribute-modal');
        var closeBtn = document.getElementById('academy-distribute-close');
        var cancelBtn = document.getElementById('academy-distribute-cancel');
        var confirmBtn = document.getElementById('academy-distribute-confirm');

        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                if (modal) { modal.classList.add('hidden'); }
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', function() {
                if (modal) { modal.classList.add('hidden'); }
            });
        }

        if (modal) {
            modal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                }
            });
        }

        if (confirmBtn) {
            confirmBtn.addEventListener('click', function() {
                var classId = modal ? modal.dataset.classId : null;
                if (!classId) {
                    showNotification('No class selected.', 'error');
                    return;
                }

                var weekInput = document.getElementById('distribute-week');
                var maxSizeInput = document.getElementById('distribute-max-size');

                var week = weekInput ? parseInt(weekInput.value, 10) : 1;
                var maxSize = maxSizeInput ? parseInt(maxSizeInput.value, 10) : 4;

                if (isNaN(week) || week < 1 || week > 52) {
                    showNotification('Valid week is required (1-52).', 'error');
                    return;
                }

                if (isNaN(maxSize) || maxSize < 1) {
                    showNotification('Max team size must be at least 1.', 'error');
                    return;
                }

                // Get selected teams
                var teamCheckboxes = modal.querySelectorAll('.distribute-team-checkbox:checked');
                var teamIds = [];
                for (var i = 0; i < teamCheckboxes.length; i++) {
                    teamIds.push(teamCheckboxes[i].value);
                }

                if (teamIds.length === 0) {
                    showNotification('Please select at least one team.', 'error');
                    return;
                }

                var result = AcademyDistribute.autoDistributeStudents(classId, week, maxSize, teamIds);

                if (result && result.success) {
                    var data = result;
                    showNotification('Distributed ' + data.assigned + ' students successfully.', 'success');
                    if (modal) { modal.classList.add('hidden'); }
                    if (typeof window.refreshAcademy === 'function') {
                        window.refreshAcademy();
                    }
                    persistMutation(null, 'Distribution applied in memory, but persistence failed.');
                } else {
                    showNotification(result ? result.message : 'Failed to distribute students.', 'error');
                }
            });
        }
    }

    function showDistributeModal(classId) {
        var modal = document.getElementById('academy-distribute-modal');
        var content = document.getElementById('academy-distribute-content');

        if (!modal || !content) {
            showNotification('Modal elements not found.', 'error');
            return;
        }

        modal.dataset.classId = classId;

        var cls = ClassesCore.getClass(classId);
        var teams = AcademyQueries.getAcademicTeams(classId);
        var week = window.academyState ? window.academyState.getSelectedWeek() : 1;

        var html = '';
        html += '<p class="distribute-info">';
        html += 'Distribute students across selected teams.';
        html += '</p>';

        html += '<div class="form-group">';
        html += '<label>Week</label>';
        html += '<input type="number" id="distribute-week" value="' + week + '" min="1" max="52">';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label>Max Students Per Team</label>';
        html += '<input type="number" id="distribute-max-size" value="4" min="1" max="20">';
        html += '</div>';

        html += '<div class="distribute-teams-section">';
        html += '<label>Select Teams</label>';
        html += '<div class="distribute-team-list">';

        if (teams.length === 0) {
            html += '<p class="empty-state small">No teams available. Create teams first.</p>';
        } else {
            for (var i = 0; i < teams.length; i++) {
                var team = teams[i];
                html += '<label class="distribute-team-option">';
                html += '<input type="checkbox" class="distribute-team-checkbox" value="' + escapeHtml(team.id) + '" checked>';
                html += escapeHtml(team.name);
                if (team.teamNumber) {
                    html += ' (#' + escapeHtml(team.teamNumber) + ')';
                }
                html += '</label>';
            }
        }

        html += '</div>';
        html += '</div>';

        content.innerHTML = html;
        modal.classList.remove('hidden');
    }

    // ============================================================
    // TEAM MEMBERS MODAL
    // ============================================================

    function bindTeamMembersEvents(container) {
        var modal = document.getElementById('academy-team-members-modal');
        var closeBtn = document.getElementById('academy-team-members-close');

        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                if (modal) { modal.classList.add('hidden'); }
            });
        }

        if (modal) {
            modal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                }
            });
        }

        // Add member button (delegated)
        modal.addEventListener('click', function(e) {
            var btn = e.target.closest('#team-member-add-btn');
            if (btn) {
                var teamId = modal.dataset.teamId;
                var select = document.getElementById('team-member-select');
                var roleInput = document.getElementById('team-member-role');
                var joinInput = document.getElementById('team-member-join');

                if (!teamId) {
                    showNotification('No team selected.', 'error');
                    return;
                }

                var studentId = select ? select.value : '';
                if (!studentId) {
                    showNotification('Please select a student.', 'error');
                    return;
                }

                var role = roleInput ? roleInput.value.trim() : 'Member';
                var join = joinInput ? joinInput.value.trim() : String(window.academyState ? window.academyState.getSelectedWeek() : 1);

                var result = TeamCore.addMember(teamId, {
                    characterId: studentId,
                    role: role,
                    joinPeriod: join,
                    leavePeriod: ''
                });

                if (result) {
                    showNotification('Student added to team.', 'success');
                    refreshTeamMembersModal(teamId);
                    persistMutation(null, 'Student added in memory, but persistence failed.');
                } else {
                    showNotification('Failed to add student.', 'error');
                }
            }
        });

        // Remove member (delegated)
        modal.addEventListener('click', function(e) {
            var btn = e.target.closest('.team-member-remove-btn');
            if (btn) {
                var teamId = btn.dataset.team;
                var studentId = btn.dataset.student;
                if (teamId && studentId && confirm('Remove this member?')) {
                    var result = TeamCore.removeMember(teamId, studentId);
                    if (result) {
                        showNotification('Member removed.', 'success');
                        refreshTeamMembersModal(teamId);
                        persistMutation(null, 'Member removed in memory, but persistence failed.');
                    } else {
                        showNotification('Failed to remove member.', 'error');
                    }
                }
            }
        });
    }

    function showTeamMembersModal(teamId) {
        var modal = document.getElementById('academy-team-members-modal');
        if (!modal) {
            showNotification('Modal not found.', 'error');
            return;
        }

        modal.dataset.teamId = teamId;
        refreshTeamMembersModal(teamId);
        modal.classList.remove('hidden');
    }

    function refreshTeamMembersModal(teamId) {
        var content = document.getElementById('academy-team-members-content');
        var title = document.getElementById('academy-team-members-title');

        if (!content) { return; }

        var team = TeamCore.getTeam(teamId);
        if (!team) {
            content.innerHTML = '<p class="empty-state">Team not found.</p>';
            return;
        }

        if (title) {
            title.textContent = team.name + ' - Members';
        }

        var members = TeamCore.getActiveMembers(team, window.academyState ? window.academyState.getSelectedWeek() : 1);
        var week = window.academyState ? window.academyState.getSelectedWeek() : 1;

        var html = '';

        // Add member form
        html += '<div class="team-member-add-form">';
        html += '<select id="team-member-select" class="small">';
        html += '<option value="">Add student...</option>';

        var classId = team.classId;
        if (classId) {
            var available = AcademyQueries.getAvailableStudents(classId, week);
            var currentMembers = members.map(function(m) { return m.characterId; });
            for (var i = 0; i < available.length; i++) {
                var s = available[i];
                if (currentMembers.indexOf(s.id) === -1) {
                    var name = CharacterQueries.getDisplayName(s);
                    html += '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(name) + '</option>';
                }
            }
        }

        html += '</select>';
        html += '<input type="text" id="team-member-role" placeholder="Role" class="small" value="Member">';
        html += '<input type="text" id="team-member-join" placeholder="Join Week" class="small" value="' + week + '">';
        html += '<button id="team-member-add-btn" class="primary small">Add</button>';
        html += '</div>';

        // Member list
        if (members.length === 0) {
            html += '<p class="empty-state small">No members in this team.</p>';
        } else {
            html += '<div class="team-member-list">';
            for (var j = 0; j < members.length; j++) {
                var m = members[j];
                var char = CharacterQueries.getCharacterById(m.characterId);
                var name = char ? CharacterQueries.getDisplayName(char) : 'Unknown';
                html += '<div class="team-member-item">';
                html += '<span>' + escapeHtml(name) + '</span>';
                html += '<span class="team-member-role">' + escapeHtml(m.role || 'Member') + '</span>';
                html += '<span class="team-member-period">(Wk ' + escapeHtml(m.joinPeriod || '?') + (m.leavePeriod ? ' - Wk ' + escapeHtml(m.leavePeriod) : '') + ')</span>';
                html += '<button class="team-member-remove-btn small danger" data-team="' + escapeHtml(teamId) + '" data-student="' + escapeHtml(m.characterId) + '">x</button>';
                html += '</div>';
            }
            html += '</div>';
        }

        content.innerHTML = html;
    }

    // ============================================================
    // TOURNAMENT HELPERS
    // ============================================================

    function toggleTournamentTeams(tournamentId, container) {
        var item = container.querySelector('.tournament-item[data-tournament="' + tournamentId + '"]');
        if (!item) {
            var items = container.querySelectorAll('.tournament-item');
            for (var i = 0; i < items.length; i++) {
                if (items[i].querySelector('[data-tournament="' + tournamentId + '"]')) {
                    item = items[i];
                    break;
                }
            }
        }

        if (item) {
            var list = item.querySelector('.tournament-teams-list');
            if (list) {
                var isVisible = list.style.display !== 'none';
                list.style.display = isVisible ? 'none' : 'block';
            }
        }
    }

    // ============================================================
    // HANDLERS
    // ============================================================

    function handleDeleteClass(classId) {
        var result = ClassesCore.deleteClass(classId);
        if (result && result.success) {
            showNotification('Class deleted successfully.', 'success');
            if (window.academyState && typeof window.academyState.clearSelections === 'function') {
                window.academyState.clearSelections();
            }
            if (typeof window.refreshAcademy === 'function') {
                window.refreshAcademy();
            }
            persistMutation(null, 'Class deleted in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to delete class.', 'error');
        }
    }

    function handleAddStudentToClass(studentId) {
        var classId = window.academyState ? window.academyState.getSelectedClassId() : null;
        if (!classId) {
            showNotification('No class selected.', 'error');
            return;
        }

        var result = ClassesCore.addCharacterToClass(studentId, classId);
        if (result && result.success) {
            showNotification('Student added to class.', 'success');
            if (typeof window.refreshAcademy === 'function') {
                window.refreshAcademy();
            }
            persistMutation(null, 'Student added in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to add student.', 'error');
        }
    }

    function handleRemoveStudentFromClass(classId, studentId) {
        var result = ClassesCore.removeCharacterFromClass(studentId, classId);
        if (result && result.success) {
            showNotification('Student removed from class.', 'success');
            if (typeof window.refreshAcademy === 'function') {
                window.refreshAcademy();
            }
            persistMutation(null, 'Student removed in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to remove student.', 'error');
        }
    }

    function handleDeleteAcademicTeam(teamId) {
        var team = TeamCore.getTeam(teamId);
        var result = TeamCore.deleteTeam(teamId);
        if (result) {
            showNotification('Team deleted successfully.', 'success');
            if (typeof window.refreshAcademy === 'function') {
                window.refreshAcademy();
            }
            persistMutation(null, 'Team deleted in memory, but persistence failed.');
        } else {
            showNotification('Failed to delete team.', 'error');
        }
    }

    function handleRemoveStudentFromAcademicTeam(teamId, studentId) {
        var result = TeamCore.removeMember(teamId, studentId);
        if (result) {
            showNotification('Student removed from team.', 'success');
            if (typeof window.refreshAcademy === 'function') {
                window.refreshAcademy();
            }
            persistMutation(null, 'Student removed in memory, but persistence failed.');
        } else {
            showNotification('Failed to remove student from team.', 'error');
        }
    }

    function handleDeleteTournament(tournamentId) {
        var result = AcademyTournaments.deleteTournament(tournamentId);
        if (result && result.success) {
            showNotification('Tournament deleted successfully.', 'success');
            if (typeof window.refreshAcademy === 'function') {
                window.refreshAcademy();
            }
            persistMutation(null, 'Tournament deleted in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to delete tournament.', 'error');
        }
    }

    function handleAddTeamToTournament(tournamentId, teamId) {
        var result = AcademyTournaments.addTeamToTournament(tournamentId, teamId);
        if (result && result.success) {
            showNotification('Team added to tournament.', 'success');
            if (typeof window.refreshAcademy === 'function') {
                window.refreshAcademy();
            }
            persistMutation(null, 'Team added in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to add team to tournament.', 'error');
        }
    }

    function handleRemoveTeamFromTournament(tournamentId, teamId) {
        var result = AcademyTournaments.removeTeamFromTournament(tournamentId, teamId);
        if (result && result.success) {
            showNotification('Team removed from tournament.', 'success');
            if (typeof window.refreshAcademy === 'function') {
                window.refreshAcademy();
            }
            persistMutation(null, 'Team removed in memory, but persistence failed.');
        } else {
            showNotification(result ? result.message : 'Failed to remove team from tournament.', 'error');
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ClassTab = {
        render: renderClassTab,
        renderClassList: renderClassList,
        renderClassDetail: renderClassDetail,
        bindEvents: bindClassTabEvents,
        showClassForm: showClassForm,
        showDistributeModal: showDistributeModal,
        showTeamMembersModal: showTeamMembersModal,
        refreshTeamMembersModal: refreshTeamMembersModal
    };

})();