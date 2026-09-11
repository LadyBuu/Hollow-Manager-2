/**
 * modules/academy/tabs/class-tab.js - Class Sub-Tab
 * Handles class management, rosters, academic teams, and tournaments
 * 
 * This module is responsible for:
 *   - Class CRUD (list, create, edit, delete) - uses AcademyClasses directly
 *   - Class roster management (add/remove students) - uses AcademyClasses
 *     delegating to CharacterClasses
 *   - Academic team management for a class - uses TeamCore for mutations,
 *     TeamQueries for reads
 *   - Tournament management for a class
 *   - Auto-distribute students to teams - uses AcademyDistribute
 * 
 * IMPORTANT:
 *   - UI-ONLY - all mutations delegate to domain cores
 *   - Uses AcademyClasses DIRECTLY for class ENTITY mutations
 *   - Uses AcademyClasses.addStudent/removeStudent for MEMBERSHIP mutations
 *     (DEPRECATED DELEGATES to CharacterClasses; still work but will be
 *     removed once the Academy UI rework lands)
 *   - Uses TeamQueries for READ operations (get team by ID)
 *   - Uses TeamCore for WRITE operations (create, delete, add/remove members)
 *   - Uses AcademyUI for state management
 *   - Uses AcademyAggregator for projections
 *   - Uses AcademyDistribute for student distribution
 *   - Uses AcademyQueries for read-only access
 *   - All HTML escaping uses DomUtils.escapeHtml()
 *   - All notifications use NotificationSystem.notify()
 *   - All modals route through Modal.showModal / Modal.hideModal
 * 
 * MODAL VISIBILITY:
 *   Modals in this file are shown and hidden through the Modal module.
 *   The three-layer visibility contract is:
 *     1. `hidden` class removed (it has `display: none !important`)
 *     2. `visible` class added (it has `display: flex`)
 *     3. `style.display = 'flex'` set inline
 *   Modal.showModal does all three atomically, plus focus management
 *   and animation. Modal.hideModal reverses all three. Do not manipulate
 *   modal classes or display directly; it's how half-visible modals
 *   happen.
 * 
 * PROMISE CONTRACT (v15+):
 *   - AcademyClasses.create / update / delete return Promises.
 *   - AcademyClasses.addStudent / removeStudent return Promises.
 *   - AcademyDistribute.autoDistribute is synchronous (returns an object).
 *   - TeamCore.createTeam / deleteTeam / addMember / removeMember are
 *     synchronous (return the team/member or null).
 *   - AcademyQueries and AcademyAggregator reads are synchronous.
 * 
 * DEPENDENCY RESOLUTION:
 *   - Modules guaranteed to be loaded before this file are captured at
 *     module load.
 *   - Modules NOT guaranteed at load time (TeamCore, AcademyRanking) are
 *     resolved lazily at call time via accessor functions.
 * 
 * DEPENDENCIES (loaded before this file - captured at load):
 *   - window.AcademyUI
 *   - window.AcademyAggregator
 *   - window.AcademyClasses
 *   - window.AcademyQueries
 *   - window.AcademyDistribute
 *   - window.TeamQueries
 *   - window.CharacterQueries
 *   - window.CalendarConstants
 *   - window.NotificationSystem
 *   - window.DomUtils
 *   - window.Modal
 * 
 * DEPENDENCIES (lazy - resolved at call time):
 *   - window.TeamCore
 *   - window.AcademyRanking
 * 
 * USAGE:
 *   var tab = window.ClassTab;
 *   var html = tab.render(state);
 *   tab.bindEvents(container);
 */

(function() {
    'use strict';

    if (window.__classTabLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY IMPORTS - LOAD-TIME (guaranteed available)
    // ============================================================

    var AcademyUI = window.AcademyUI;
    var AcademyAggregator = window.AcademyAggregator;
    var AcademyClasses = window.AcademyClasses;
    var AcademyQueries = window.AcademyQueries;
    var AcademyDistribute = window.AcademyDistribute;
    var TeamQueries = window.TeamQueries;
    var CharacterQueries = window.CharacterQueries;
    var CalendarConstants = window.CalendarConstants;
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;
    var Modal = window.Modal;

    // ============================================================
    // DEPENDENCY RESOLUTION - LAZY (not guaranteed at load time)
    // ============================================================

    function getTeamCore() {
        return window.TeamCore || null;
    }

    function getAcademyRanking() {
        return window.AcademyRanking || null;
    }

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademyUI || typeof AcademyUI.getSelectedClassId !== 'function') {
            missing.push('AcademyUI.getSelectedClassId');
        }
        if (!AcademyUI || typeof AcademyUI.selectClass !== 'function') {
            missing.push('AcademyUI.selectClass');
        }

        if (!AcademyAggregator || typeof AcademyAggregator.getClassViewModel !== 'function') {
            missing.push('AcademyAggregator.getClassViewModel');
        }
        if (!AcademyAggregator || typeof AcademyAggregator.getClassListViewModel !== 'function') {
            missing.push('AcademyAggregator.getClassListViewModel');
        }

        if (!AcademyClasses || typeof AcademyClasses.create !== 'function') {
            missing.push('AcademyClasses.create');
        }
        if (!AcademyClasses || typeof AcademyClasses.update !== 'function') {
            missing.push('AcademyClasses.update');
        }
        if (!AcademyClasses || typeof AcademyClasses.delete !== 'function') {
            missing.push('AcademyClasses.delete');
        }
        if (!AcademyClasses || typeof AcademyClasses.addStudent !== 'function') {
            missing.push('AcademyClasses.addStudent');
        }
        if (!AcademyClasses || typeof AcademyClasses.removeStudent !== 'function') {
            missing.push('AcademyClasses.removeStudent');
        }

        if (!AcademyQueries || typeof AcademyQueries.getClass !== 'function') {
            missing.push('AcademyQueries.getClass');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClasses !== 'function') {
            missing.push('AcademyQueries.getClasses');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClassStudents !== 'function') {
            missing.push('AcademyQueries.getClassStudents');
        }
        if (!AcademyQueries || typeof AcademyQueries.getAvailableStudents !== 'function') {
            missing.push('AcademyQueries.getAvailableStudents');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClassTeams !== 'function') {
            missing.push('AcademyQueries.getClassTeams');
        }

        if (!AcademyDistribute || typeof AcademyDistribute.autoDistribute !== 'function') {
            missing.push('AcademyDistribute.autoDistribute');
        }

        if (!TeamQueries || typeof TeamQueries.getTeamById !== 'function') {
            missing.push('TeamQueries.getTeamById');
        }

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }

        if (!CalendarConstants || typeof CalendarConstants.MIN_WEEK !== 'number') {
            missing.push('CalendarConstants.MIN_WEEK');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (!Modal || typeof Modal.showModal !== 'function' || typeof Modal.hideModal !== 'function') {
            missing.push('Modal.showModal / Modal.hideModal');
        }

        // TeamCore and AcademyRanking are deliberately NOT checked here.

        if (missing.length > 0) {
            console.warn('[ClassTab] Missing load-time dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        if (DomUtils && typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // NOTIFICATION
    // ============================================================

    function notify(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // MODAL HELPERS
    // ============================================================
    // 
    // All modal show/hide in this file routes through these two helpers.
    // They use Modal.showModal / Modal.hideModal when available, and
    // fall back to the three-step manual sequence when Modal isn't
    // loaded. The fallback replicates exactly what Modal.showModal does
    // internally, so the CSS state stays consistent either way.

    /**
     * Show a modal correctly.
     * 
     * @param {HTMLElement} modal - Modal element
     */
    function showModal(modal) {
        if (!modal) { return; }

        if (Modal && typeof Modal.showModal === 'function') {
            Modal.showModal(modal);
            return;
        }

        // Fallback: three-step manual show.
        modal.classList.remove('hidden');
        modal.classList.add('visible');
        modal.style.display = 'flex';
    }

    /**
     * Hide a modal correctly.
     * 
     * @param {HTMLElement} modal - Modal element
     */
    function hideModal(modal) {
        if (!modal) { return; }

        if (Modal && typeof Modal.hideModal === 'function') {
            Modal.hideModal(modal);
            return;
        }

        // Fallback: three-step manual hide.
        modal.classList.add('hidden');
        modal.classList.remove('visible');
        modal.style.display = 'none';
    }

    // ============================================================
    // REFRESH HELPER
    // ============================================================

    var _currentContainer = null;

    /**
     * Ask the Academy shell to re-render the current sub-tab.
     * Falls back to a local re-render if the shell isn't available.
     */
    function requestRefresh() {
        if (window.AcademyEvents && typeof window.AcademyEvents.refreshUI === 'function') {
            window.AcademyEvents.refreshUI();
        } else if (_currentContainer) {
            var html = render({
                selectedClassId: AcademyUI.getSelectedClassId(),
                displayWeek: AcademyUI.getDisplayWeek()
            });
            _currentContainer.innerHTML = html;
            bindEvents(_currentContainer);
        }
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK || 1;
    var MAX_WEEK = CalendarConstants.MAX_WEEK || 52;

    // ============================================================
    // TEAM LOOKUP - READ via TeamQueries
    // ============================================================

    function getTeamById(teamId) {
        if (TeamQueries && typeof TeamQueries.getTeamById === 'function') {
            return TeamQueries.getTeamById(teamId);
        }
        return null;
    }

    // ============================================================
    // RENDER - Main entry point
    // ============================================================

    function render(state) {
        if (!checkDependencies()) {
            return '<p class="empty-state">Class tab dependencies not loaded.</p>';
        }

        state = state || {};
        var selectedClassId = state.selectedClassId || null;
        var week = state.displayWeek || 1;

        var classVM = null;
        if (selectedClassId) {
            classVM = AcademyAggregator.getClassViewModel(selectedClassId, {
                week: week,
                includeStudents: true,
                includeTeams: true,
                includeRankings: true
            });
        }

        var listVM = AcademyAggregator.getClassListViewModel({
            status: 'active'
        });

        var html = '';
        html += '<div class="class-tab-layout">';

        // Sidebar - Class list
        html += '<div class="class-tab-sidebar">';
        html += '<div class="class-tab-header">';
        html += '<h3>Classes</h3>';
        html += '<button id="academy-add-class-btn" class="primary small">+ Add</button>';
        html += '</div>';
        html += '<div class="class-tab-filters">';
        html += '<input type="text" id="class-filter-input" class="academy-filter-input small" ' +
            'data-tab="class" data-key="search" placeholder="Filter classes..." value="' +
            escapeHtml((AcademyUI.getFilter('class') || {}).search || '') + '">';
        html += '<button id="class-filter-clear" class="academy-filter-clear small secondary" data-tab="class">Clear</button>';
        html += '</div>';
        html += '<div id="academy-class-list">';
        html += renderClassList(listVM, selectedClassId);
        html += '</div>';
        html += '</div>';

        // Detail - Class details
        html += '<div class="class-tab-detail">';
        if (classVM) {
            html += renderClassDetail(classVM, week);
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

    function renderClassList(listVM, selectedId) {
        var classes = listVM.classes || [];

        if (classes.length === 0) {
            return '<p class="empty-state">No classes created yet.</p>';
        }

        var html = '';
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var isSelected = selectedId === cls.id;

            html += '<div class="class-list-item' + (isSelected ? ' selected' : '') + '" data-id="' + escapeHtml(cls.id) + '">';
            html += '<div class="class-list-item-content">';
            html += '<span class="class-list-item-name">' + escapeHtml(cls.name) + '</span>';
            html += '<span class="class-list-item-meta">' + cls.studentCount + ' students, ' + cls.teamCount + ' teams</span>';
            html += '</div>';
            html += '</div>';
        }

        return html;
    }

    // ============================================================
    // RENDER CLASS DETAIL
    // ============================================================

    function renderClassDetail(classVM, week) {
        if (!classVM) {
            return '<p class="empty-state">Class not found.</p>';
        }

        var students = classVM.students || [];
        var teams = classVM.teams || [];
        var rankings = classVM.rankings || [];

        var html = '';

        // Header
        html += '<div class="class-detail-header">';
        html += '<h3 class="class-detail-title">' + escapeHtml(classVM.name) + '</h3>';
        html += '<div class="class-detail-actions">';
        html += '<button class="edit-class-btn secondary small" data-id="' + escapeHtml(classVM.id) + '">Edit</button>';
        html += '<button class="distribute-class-btn primary small" data-id="' + escapeHtml(classVM.id) + '">Distribute</button>';
        html += '<button class="delete-class-btn danger small" data-id="' + escapeHtml(classVM.id) + '">Delete</button>';
        html += '</div>';
        html += '</div>';

        // Stats
        html += '<div class="class-detail-stats">';
        html += '<div class="stat-item"><span class="stat-label">Students</span><span class="stat-value">' + students.length + '</span></div>';
        html += '<div class="stat-item"><span class="stat-label">Teams</span><span class="stat-value">' + teams.length + '</span></div>';
        html += '<div class="stat-item"><span class="stat-label">Ranked</span><span class="stat-value">' + rankings.length + '</span></div>';
        html += '</div>';

        // Tabs
        html += '<div class="class-detail-tabs">';
        html += '<button class="class-detail-tab-btn active" data-tab="roster">Roster</button>';
        html += '<button class="class-detail-tab-btn" data-tab="teams">Teams</button>';
        html += '<button class="class-detail-tab-btn" data-tab="rankings">Rankings</button>';
        html += '</div>';

        // Roster tab
        html += '<div class="detail-tab-panel active" data-tab="roster">';
        html += renderRosterTab(classVM, students);
        html += '</div>';

        // Teams tab
        html += '<div class="detail-tab-panel" data-tab="teams" style="display:none;">';
        html += renderTeamsTab(classVM, teams, week);
        html += '</div>';

        // Rankings tab
        html += '<div class="detail-tab-panel" data-tab="rankings" style="display:none;">';
        html += renderRankingsTab(classVM, rankings);
        html += '</div>';

        return html;
    }

    // ============================================================
    // RENDER ROSTER TAB
    // ============================================================

    function renderRosterTab(classVM, students) {
        var classId = classVM.id;
        var html = '';

        html += '<div class="roster-add-form">';
        html += '<select id="roster-add-student" class="small">';
        html += '<option value="">Add student...</option>';

        var available = AcademyQueries.getAvailableStudents(classId, 1);
        for (var i = 0; i < available.length; i++) {
            var student = available[i];
            var name = CharacterQueries.getDisplayName(student);
            html += '<option value="' + escapeHtml(student.id) + '">' + escapeHtml(name) + '</option>';
        }

        html += '</select>';
        html += '<button id="roster-add-btn" class="primary small">Add</button>';
        html += '</div>';

        if (students.length === 0) {
            html += '<p class="empty-state small">No students in this class.</p>';
        } else {
            html += '<div class="roster-list">';
            for (var j = 0; j < students.length; j++) {
                var s = students[j];
                if (!s) { continue; }
                var name = s.name || CharacterQueries.getDisplayName(s);
                var status = s.status || CharacterQueries.getCurrentStatus(s);
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

    function renderTeamsTab(classVM, teams, week) {
        var classId = classVM.id;
        var html = '';

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
                var memberCount = team.memberCount || 0;

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

                html += '<div class="team-members-list" style="display:none;">';
                var members = team.members || [];
                if (members.length === 0) {
                    html += '<p class="empty-state small">No members</p>';
                } else {
                    for (var j = 0; j < members.length; j++) {
                        var member = members[j];
                        html += '<div class="team-member-item">';
                        html += '<span>' + escapeHtml(member.name || 'Unknown') + '</span>';
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

        html += '<div class="teams-distribute">';
        html += '<button id="distribute-class-btn" class="primary" data-class="' + escapeHtml(classId) + '">Auto-Distribute Students</button>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // RENDER RANKINGS TAB
    // ============================================================

    function renderRankingsTab(classVM, rankings) {
        var html = '';

        if (rankings.length === 0) {
            html += '<p class="empty-state small">No rankings for this week.</p>';
        } else {
            html += '<div class="rankings-table-container">';
            html += '<table class="rankings-table">';
            html += '<thead>';
            html += '<tr>';
            html += '<th>Rank</th>';
            html += '<th>Student</th>';
            html += '<th>Average</th>';
            html += '</tr>';
            html += '</thead>';
            html += '<tbody>';

            for (var i = 0; i < rankings.length; i++) {
                var entry = rankings[i];
                html += '<tr>';
                html += '<td><strong>#' + entry.rank + '</strong></td>';
                html += '<td>' + escapeHtml(entry.studentName || 'Unknown') + '</td>';
                html += '<td>' + (entry.average !== null ? entry.average.toFixed(1) + '%' : '--') + '</td>';
                html += '</tr>';
            }

            html += '</tbody>';
            html += '</table>';
            html += '</div>';
        }

        html += '<div class="rankings-actions">';
        html += '<button id="ranking-auto-btn" class="secondary small">Auto-Generate Rankings</button>';
        html += '</div>';

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
    // BIND EVENTS
    // ============================================================

    function bindEvents(container) {
        if (!container) {
            return;
        }

        _currentContainer = container;

        // ---- Class list selection ----
        var listContainer = container.querySelector('#academy-class-list');
        if (listContainer) {
            listContainer.addEventListener('click', function(e) {
                var item = e.target.closest('.class-list-item');
                if (!item) { return; }
                var id = item.dataset.id;
                if (id) {
                    AcademyUI.selectClass(id);
                    requestRefresh();
                }
            });
        }

        // ---- Add class ----
        var addBtn = container.querySelector('#academy-add-class-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() {
                showClassForm(null);
            });
        }

        // ---- Edit class ----
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.edit-class-btn');
            if (btn) {
                var id = btn.dataset.id;
                if (id) {
                    showClassForm(id);
                }
            }
        });

        // ---- Delete class ----
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.delete-class-btn');
            if (btn) {
                var id = btn.dataset.id;
                if (id && confirm('Delete this class permanently?')) {
                    handleDeleteClass(id);
                }
            }
        });

        // ---- Distribute class ----
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.distribute-class-btn, #distribute-class-btn');
            if (btn) {
                var id = btn.dataset.class || btn.dataset.id;
                if (id) {
                    showDistributeModal(id);
                }
            }
        });

        // ---- Roster add ----
        var rosterAddBtn = container.querySelector('#roster-add-btn');
        if (rosterAddBtn) {
            rosterAddBtn.addEventListener('click', function() {
                var select = container.querySelector('#roster-add-student');
                if (select && select.value) {
                    handleAddStudentToClass(select.value);
                }
            });
        }

        // ---- Roster remove ----
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.roster-remove-btn');
            if (btn) {
                var studentId = btn.dataset.student;
                if (studentId && confirm('Remove this student from the class?')) {
                    var classId = AcademyUI.getSelectedClassId();
                    if (classId) {
                        handleRemoveStudentFromClass(classId, studentId);
                    }
                }
            }
        });

        // ---- Team add ----
        var teamAddBtn = container.querySelector('#team-add-btn');
        if (teamAddBtn) {
            teamAddBtn.addEventListener('click', function() {
                handleAddTeam(container);
            });
        }

        // ---- Team manage members ----
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.team-manage-members');
            if (btn) {
                var teamId = btn.dataset.team;
                if (teamId) {
                    showTeamMembersModal(teamId);
                }
            }
        });

        // ---- Team delete ----
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.team-delete-btn');
            if (btn) {
                var teamId = btn.dataset.team;
                if (teamId && confirm('Delete this team?')) {
                    handleDeleteTeam(teamId);
                }
            }
        });

        // ---- Team member remove ----
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.team-member-remove');
            if (btn) {
                var teamId = btn.dataset.team;
                var studentId = btn.dataset.student;
                if (teamId && studentId && confirm('Remove this member?')) {
                    handleRemoveTeamMember(teamId, studentId);
                }
            }
        });

        // ---- Detail tab switching ----
        container.addEventListener('click', function(e) {
            var btn = e.target.closest('.class-detail-tab-btn');
            if (btn) {
                var tab = btn.dataset.tab;
                if (tab) {
                    switchDetailTab(container, tab);
                }
            }
        });

        // ---- Auto-generate rankings ----
        var rankingAutoBtn = container.querySelector('#ranking-auto-btn');
        if (rankingAutoBtn) {
            rankingAutoBtn.addEventListener('click', function() {
                handleAutoGenerateRankings();
            });
        }

        // ---- Modal event binding ----
        bindClassFormEvents();
        bindDistributeEvents();
        bindTeamMembersEvents();

        // ---- Filter events ----
        var filterInput = container.querySelector('#class-filter-input');
        if (filterInput) {
            filterInput.addEventListener('input', function() {
                var tab = this.dataset.tab;
                var key = this.dataset.key || 'search';
                if (tab) {
                    AcademyUI.setFilter(tab, key, this.value);
                    requestRefresh();
                }
            });
        }

        var clearBtn = container.querySelector('#class-filter-clear');
        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                var tab = this.dataset.tab;
                if (tab) {
                    AcademyUI.resetFilter(tab);
                    requestRefresh();
                }
            });
        }

        return function() {
            // Cleanup - no-op for now
        };
    }

    // ============================================================
    // CLASS FORM EVENTS
    // ============================================================
    // 
    // IMPORTANT: Modals live in the DOM once (rendered by ClassTab.render).
    // If ClassTab.render is called again, they're re-created, which means
    // any listeners bound to them are lost. The listeners here are bound
    // to document.querySelector, which finds the current modal each time.
    // 
    // To guard against duplicate binding (if bindEvents runs twice without
    // a re-render), we use a flag on the modal element itself.

    function bindClassFormEvents() {
        var modal = document.getElementById('academy-class-modal');
        var form = document.getElementById('academy-class-form');
        var closeBtn = document.getElementById('academy-class-modal-close');
        var cancelBtn = document.getElementById('academy-class-modal-cancel');
        var nameInput = document.getElementById('academy-class-name');
        var saveBtn = document.getElementById('academy-class-modal-save');

        if (modal && modal.dataset.bound === 'true') {
            return;  // Already bound to this modal instance
        }
        if (modal) {
            modal.dataset.bound = 'true';
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                hideModal(modal);
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', function() {
                hideModal(modal);
            });
        }

        if (modal) {
            modal.addEventListener('click', function(e) {
                if (e.target === this) {
                    hideModal(modal);
                }
            });
        }

        if (form) {
            form.addEventListener('submit', function(e) {
                e.preventDefault();

                var name = nameInput ? nameInput.value.trim() : '';
                if (!name) {
                    notify('Class name is required.', 'error');
                    return;
                }

                var editId = form.dataset.editId;

                if (saveBtn) {
                    saveBtn.disabled = true;
                }

                var promise = editId
                    ? AcademyClasses.update(editId, { name: name })
                    : AcademyClasses.create(name);

                promise
                    .then(function(result) {
                        if (result && result.success) {
                            notify(editId ? 'Class updated successfully.' : 'Class created successfully.', 'success');
                            hideModal(modal);

                            if (!editId && result.data && result.data.classId) {
                                AcademyUI.selectClass(result.data.classId);
                            }

                            requestRefresh();
                        } else {
                            notify(result ? result.message : 'Failed to save class.', 'error');
                        }
                    })
                    .catch(function(err) {
                        notify('Failed to save class.', 'error');
                        console.error('[ClassTab] saveClass error:', err);
                    })
                    .then(function() {
                        if (saveBtn) {
                            saveBtn.disabled = false;
                        }
                    });
            });
        }
    }

    // ============================================================
    // DISTRIBUTE EVENTS
    // ============================================================

    function bindDistributeEvents() {
        var modal = document.getElementById('academy-distribute-modal');
        var closeBtn = document.getElementById('academy-distribute-close');
        var cancelBtn = document.getElementById('academy-distribute-cancel');
        var confirmBtn = document.getElementById('academy-distribute-confirm');

        if (modal && modal.dataset.bound === 'true') {
            return;
        }
        if (modal) {
            modal.dataset.bound = 'true';
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                hideModal(modal);
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', function() {
                hideModal(modal);
            });
        }

        if (modal) {
            modal.addEventListener('click', function(e) {
                if (e.target === this) {
                    hideModal(modal);
                }
            });
        }

        if (confirmBtn) {
            confirmBtn.addEventListener('click', function() {
                var classId = modal ? modal.dataset.classId : null;
                if (!classId) {
                    notify('No class selected.', 'error');
                    return;
                }

                var weekInput = document.getElementById('distribute-week');
                var maxSizeInput = document.getElementById('distribute-max-size');

                var week = weekInput ? parseInt(weekInput.value, 10) : 1;
                var maxSize = maxSizeInput ? parseInt(maxSizeInput.value, 10) : 4;

                if (isNaN(week) || week < MIN_WEEK || week > MAX_WEEK) {
                    notify('Valid week is required (' + MIN_WEEK + '-' + MAX_WEEK + ').', 'error');
                    return;
                }

                if (isNaN(maxSize) || maxSize < 1) {
                    notify('Max team size must be at least 1.', 'error');
                    return;
                }

                var teamCheckboxes = modal.querySelectorAll('.distribute-team-checkbox:checked');
                var teamIds = [];
                for (var i = 0; i < teamCheckboxes.length; i++) {
                    teamIds.push(teamCheckboxes[i].value);
                }

                if (teamIds.length === 0) {
                    notify('Please select at least one team.', 'error');
                    return;
                }

                var result = AcademyDistribute.autoDistribute(classId, week, {
                    maxPerGroup: maxSize,
                    teamIds: teamIds
                });

                if (result && result.success) {
                    var data = result.data || {};
                    notify('Distributed ' + (data.totalStudents || 0) + ' students successfully.', 'success');
                    hideModal(modal);
                    requestRefresh();
                } else {
                    notify(result ? result.message : 'Failed to distribute students.', 'error');
                }
            });
        }
    }

    // ============================================================
    // TEAM MEMBERS EVENTS
    // ============================================================

    function bindTeamMembersEvents() {
        var modal = document.getElementById('academy-team-members-modal');
        var closeBtn = document.getElementById('academy-team-members-close');

        if (modal && modal.dataset.bound === 'true') {
            return;
        }
        if (modal) {
            modal.dataset.bound = 'true';
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                hideModal(modal);
            });
        }

        if (modal) {
            modal.addEventListener('click', function(e) {
                if (e.target === this) {
                    hideModal(modal);
                }
            });

            // Add member (delegated on the modal body)
            modal.addEventListener('click', function(e) {
                var btn = e.target.closest('#team-member-add-btn');
                if (btn) {
                    var teamId = modal.dataset.teamId;
                    var select = document.getElementById('team-member-select');
                    var roleInput = document.getElementById('team-member-role');
                    var joinInput = document.getElementById('team-member-join');

                    if (!teamId) {
                        notify('No team selected.', 'error');
                        return;
                    }

                    var studentId = select ? select.value : '';
                    if (!studentId) {
                        notify('Please select a student.', 'error');
                        return;
                    }

                    var TeamCore = getTeamCore();
                    if (!TeamCore || typeof TeamCore.addMember !== 'function') {
                        notify('TeamCore is not available.', 'error');
                        return;
                    }

                    var role = roleInput ? roleInput.value.trim() : 'Member';
                    var join = joinInput ? joinInput.value.trim() : String(AcademyUI.getDisplayWeek());

                    var result = TeamCore.addMember(teamId, {
                        characterId: studentId,
                        role: role,
                        joinPeriod: join,
                        leavePeriod: ''
                    });

                    if (result) {
                        notify('Student added to team.', 'success');
                        refreshTeamMembersModal(teamId);
                    } else {
                        notify('Failed to add student.', 'error');
                    }
                }

                var removeBtn = e.target.closest('.team-member-remove-btn');
                if (removeBtn) {
                    var rmTeamId = removeBtn.dataset.team;
                    var rmStudentId = removeBtn.dataset.student;

                    if (!rmTeamId || !rmStudentId) {
                        return;
                    }

                    if (!confirm('Remove this member?')) {
                        return;
                    }

                    var TeamCore = getTeamCore();
                    if (!TeamCore || typeof TeamCore.removeMember !== 'function') {
                        notify('TeamCore is not available.', 'error');
                        return;
                    }

                    var result = TeamCore.removeMember(rmTeamId, rmStudentId);
                    if (result) {
                        notify('Member removed.', 'success');
                        refreshTeamMembersModal(rmTeamId);
                    } else {
                        notify('Failed to remove member.', 'error');
                    }
                }
            });
        }
    }

    // ============================================================
    // HANDLERS
    // ============================================================

    function switchDetailTab(container, tab) {
        var btns = container.querySelectorAll('.class-detail-tab-btn');
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

    function showClassForm(editId) {
        var modal = document.getElementById('academy-class-modal');
        var form = document.getElementById('academy-class-form');
        var nameInput = document.getElementById('academy-class-name');
        var titleEl = document.getElementById('academy-class-modal-title');

        if (!modal || !form || !nameInput) {
            notify('Form elements not found.', 'error');
            return;
        }

        if (editId) {
            var cls = AcademyQueries.getClass(editId);
            if (!cls) {
                notify('Class not found.', 'error');
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

        showModal(modal);
        nameInput.focus();
        nameInput.select();
    }

    function showDistributeModal(classId) {
        var modal = document.getElementById('academy-distribute-modal');
        var content = document.getElementById('academy-distribute-content');

        if (!modal || !content) {
            notify('Modal elements not found.', 'error');
            return;
        }

        modal.dataset.classId = classId;

        var teams = AcademyQueries.getClassTeams(classId);
        var week = AcademyUI.getDisplayWeek();

        var html = '';
        html += '<p class="distribute-info">';
        html += 'Distribute students across selected teams.';
        html += '</p>';

        html += '<div class="form-group">';
        html += '<label>Week</label>';
        html += '<input type="number" id="distribute-week" value="' + week + '" min="' + MIN_WEEK + '" max="' + MAX_WEEK + '">';
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
        showModal(modal);
    }

    function showTeamMembersModal(teamId) {
        var modal = document.getElementById('academy-team-members-modal');
        if (!modal) {
            notify('Modal not found.', 'error');
            return;
        }

        modal.dataset.teamId = teamId;
        refreshTeamMembersModal(teamId);
        showModal(modal);
    }

    function refreshTeamMembersModal(teamId) {
        var content = document.getElementById('academy-team-members-content');
        var title = document.getElementById('academy-team-members-title');

        if (!content) { return; }

        var team = getTeamById(teamId);
        if (!team) {
            content.innerHTML = '<p class="empty-state">Team not found.</p>';
            return;
        }

        if (title) {
            title.textContent = team.name + ' - Members';
        }

        var week = AcademyUI.getDisplayWeek();
        var members = AcademyQueries.getAcademicTeamMembers(teamId, week);

        var html = '';

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

        if (members.length === 0) {
            html += '<p class="empty-state small">No members in this team.</p>';
        } else {
            html += '<div class="team-member-list">';
            for (var j = 0; j < members.length; j++) {
                var m = members[j];
                html += '<div class="team-member-item">';
                html += '<span>' + escapeHtml(m.name || 'Unknown') + '</span>';
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
    // MUTATION HANDLERS
    // ============================================================

    function handleDeleteClass(classId) {
        AcademyClasses.delete(classId)
            .then(function(result) {
                if (result && result.success) {
                    notify('Class deleted successfully.', 'success');

                    AcademyUI.clearSelection('class');
                    AcademyUI.clearSelection('student');

                    requestRefresh();
                } else {
                    notify(result ? result.message : 'Failed to delete class.', 'error');
                }
            })
            .catch(function(err) {
                notify('Failed to delete class.', 'error');
                console.error('[ClassTab] handleDeleteClass error:', err);
            });
    }

    function handleAddStudentToClass(studentId) {
        var classId = AcademyUI.getSelectedClassId();
        if (!classId) {
            notify('No class selected.', 'error');
            return;
        }

        AcademyClasses.addStudent(classId, studentId)
            .then(function(result) {
                if (result && result.success) {
                    notify('Student added to class.', 'success');
                    requestRefresh();
                } else {
                    notify(result ? result.message : 'Failed to add student.', 'error');
                }
            })
            .catch(function(err) {
                notify('Failed to add student.', 'error');
                console.error('[ClassTab] handleAddStudentToClass error:', err);
            });
    }

    function handleRemoveStudentFromClass(classId, studentId) {
        AcademyClasses.removeStudent(classId, studentId)
            .then(function(result) {
                if (result && result.success) {
                    notify('Student removed from class.', 'success');
                    requestRefresh();
                } else {
                    notify(result ? result.message : 'Failed to remove student.', 'error');
                }
            })
            .catch(function(err) {
                notify('Failed to remove student.', 'error');
                console.error('[ClassTab] handleRemoveStudentFromClass error:', err);
            });
    }

    function handleAddTeam(container) {
        var classId = AcademyUI.getSelectedClassId();
        if (!classId) {
            notify('No class selected.', 'error');
            return;
        }

        var TeamCore = getTeamCore();
        if (!TeamCore || typeof TeamCore.createTeam !== 'function') {
            notify('TeamCore is not available.', 'error');
            return;
        }

        var nameInput = container.querySelector('#team-add-name');
        var numberInput = container.querySelector('#team-add-number');

        var name = nameInput ? nameInput.value.trim() : '';
        if (!name) {
            notify('Team name is required.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        var teamData = {
            name: name,
            type: 'academic',
            classId: classId,
            teamNumber: numberInput ? numberInput.value.trim() : '',
            startPeriod: String(week),
            endPeriod: '',
            status: 'active'
        };

        var result = TeamCore.createTeam(teamData);
        if (result) {
            notify('Team created successfully.', 'success');
            if (nameInput) { nameInput.value = ''; }
            if (numberInput) { numberInput.value = ''; }
            requestRefresh();
        } else {
            notify('Failed to create team.', 'error');
        }
    }

    function handleDeleteTeam(teamId) {
        var TeamCore = getTeamCore();
        if (!TeamCore || typeof TeamCore.deleteTeam !== 'function') {
            notify('TeamCore is not available.', 'error');
            return;
        }

        var result = TeamCore.deleteTeam(teamId);
        if (result) {
            notify('Team deleted successfully.', 'success');
            requestRefresh();
        } else {
            notify('Failed to delete team.', 'error');
        }
    }

    function handleRemoveTeamMember(teamId, studentId) {
        var TeamCore = getTeamCore();
        if (!TeamCore || typeof TeamCore.removeMember !== 'function') {
            notify('TeamCore is not available.', 'error');
            return;
        }

        var result = TeamCore.removeMember(teamId, studentId);
        if (result) {
            notify('Member removed.', 'success');
            refreshTeamMembersModal(teamId);
            requestRefresh();
        } else {
            notify('Failed to remove member.', 'error');
        }
    }

    function handleAutoGenerateRankings() {
        var classId = AcademyUI.getSelectedClassId();
        if (!classId) {
            notify('No class selected.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        if (!confirm('Auto-generate rankings for week ' + week + ' from grade data?')) {
            return;
        }

        var AcademyRanking = getAcademyRanking();
        if (!AcademyRanking || typeof AcademyRanking.autoGenerate !== 'function') {
            notify('Ranking generation not available.', 'error');
            return;
        }

        var result = AcademyRanking.autoGenerate(classId, week);

        if (result && result.success) {
            notify('Auto-generated rankings for week ' + week + '.', 'success');
            requestRefresh();
        } else {
            notify(result ? result.message : 'Failed to auto-generate rankings.', 'error');
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.ClassTab = {
        render: render,
        bindEvents: bindEvents,
        showClassForm: showClassForm,
        showDistributeModal: showDistributeModal,
        showTeamMembersModal: showTeamMembersModal,
        refreshTeamMembersModal: refreshTeamMembersModal,
        switchDetailTab: switchDetailTab
    };

    window.__classTabLoaded = true;

})();