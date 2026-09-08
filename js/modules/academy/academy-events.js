/**
 * modules/academy/academy-events.js - Academy Events
 * Thin event orchestration for the Academy module
 * 
 * This module provides:
 *   - init - Bind all event listeners
 *   - destroy - Clean up all event listeners
 *   - Tab switching event handlers
 *   - Selection event handlers
 *   - Filter event handlers
 *   - Week change event handlers
 *   - Command delegation to domain cores
 * 
 * IMPORTANT:
 *   - Orchestrates UI interactions - THIN layer
 *   - Calls AcademyCore for mutations
 *   - Calls AcademyAggregator for projections
 *   - Calls AcademyUI for state management
 *   - Uses NotificationSystem for notifications
 *   - No direct data mutation
 *   - No direct DOM manipulation (delegates to Tabs)
 *   - No direct window.data access
 * 
 * DEPENDENCIES:
 *   - window.AcademyUI (from academy-ui.js) - MANDATORY
 *   - window.AcademyAggregator (from academy-aggregator.js) - MANDATORY
 *   - window.AcademyCore (from academy-core.js) - MANDATORY
 *   - window.AcademyQueries (from academy-queries.js) - MANDATORY
 *   - window.NotificationSystem (from notification.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 * 
 * USAGE:
 *   var AE = window.AcademyEvents;
 *   AE.init(container);
 *   // Later:
 *   AE.destroy();
 */

(function() {
    'use strict';

    if (window.__academyEventsLoaded) {
        return;
    }
    window.__academyEventsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var AcademyUI = window.AcademyUI;
    var AcademyAggregator = window.AcademyAggregator;
    var AcademyCore = window.AcademyCore;
    var AcademyQueries = window.AcademyQueries;
    var NotificationSystem = window.NotificationSystem;
    var CharacterQueries = window.CharacterQueries;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademyUI || typeof AcademyUI.getActiveTab !== 'function') {
            missing.push('AcademyUI.getActiveTab');
        }
        if (!AcademyUI || typeof AcademyUI.setActiveTab !== 'function') {
            missing.push('AcademyUI.setActiveTab');
        }
        if (!AcademyUI || typeof AcademyUI.selectClass !== 'function') {
            missing.push('AcademyUI.selectClass');
        }

        if (!AcademyAggregator || typeof AcademyAggregator.getClassListViewModel !== 'function') {
            missing.push('AcademyAggregator.getClassListViewModel');
        }

        if (!AcademyCore || typeof AcademyCore.createClass !== 'function') {
            missing.push('AcademyCore.createClass');
        }
        if (!AcademyCore || typeof AcademyCore.updateClass !== 'function') {
            missing.push('AcademyCore.updateClass');
        }
        if (!AcademyCore || typeof AcademyCore.deleteClass !== 'function') {
            missing.push('AcademyCore.deleteClass');
        }

        if (!AcademyQueries || typeof AcademyQueries.getClass !== 'function') {
            missing.push('AcademyQueries.getClass');
        }
        if (!AcademyQueries || typeof AcademyQueries.getClasses !== 'function') {
            missing.push('AcademyQueries.getClasses');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }

        if (missing.length > 0) {
            console.warn('[AcademyEvents] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // NOTIFICATION - Delegates to NotificationSystem
    // ============================================================

    function notify(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // STATE
    // ============================================================

    var _initialized = false;
    var _eventListeners = [];
    var _container = null;

    // ============================================================
    // EVENT BINDING HELPERS
    // ============================================================

    function addEventListener(element, eventName, handler, options) {
        if (!element) {
            return;
        }
        element.addEventListener(eventName, handler, options || false);
        _eventListeners.push({
            element: element,
            eventName: eventName,
            handler: handler,
            options: options || false
        });
    }

    function removeAllEventListeners() {
        _eventListeners.forEach(function(item) {
            try {
                item.element.removeEventListener(item.eventName, item.handler, item.options);
            } catch (e) {
                // Ignore cleanup errors
            }
        });
        _eventListeners = [];
    }

    function delegate(selector, eventName, handler) {
        function wrappedHandler(e) {
            var target = e.target.closest ? e.target.closest(selector) : null;
            if (!target) {
                return;
            }
            handler(e, target);
        }

        document.addEventListener(eventName, wrappedHandler);

        _eventListeners.push({
            element: document,
            eventName: eventName,
            handler: wrappedHandler,
            options: false
        });

        return wrappedHandler;
    }

    // ============================================================
    // REFRESH UI
    // ============================================================

    function refreshUI() {
        if (!_container) {
            return;
        }

        var activeTab = AcademyUI.getActiveTab();
        var selectedClassId = AcademyUI.getSelectedClassId();
        var selectedStudentId = AcademyUI.getSelectedStudentId();
        var selectedInstructorId = AcademyUI.getSelectedInstructorId();
        var displayWeek = AcademyUI.getDisplayWeek();

        // Refresh based on active tab
        var tabContent = _container.querySelector('#academy-subtab-content');
        if (!tabContent) {
            return;
        }

        var html = '';

        switch (activeTab) {
            case 'class':
                html = renderClassTab({
                    selectedClassId: selectedClassId,
                    displayWeek: displayWeek
                });
                break;
            case 'student':
                html = renderStudentTab({
                    selectedClassId: selectedClassId,
                    selectedStudentId: selectedStudentId,
                    displayWeek: displayWeek
                });
                break;
            case 'faculty':
                html = renderFacultyTab({
                    selectedClassId: selectedClassId,
                    selectedInstructorId: selectedInstructorId,
                    displayWeek: displayWeek
                });
                break;
            default:
                html = '<p class="empty-state">Unknown tab: ' + activeTab + '</p>';
        }

        tabContent.innerHTML = html;

        // Re-bind events for the new content
        bindTabContentEvents(tabContent);
    }

    // ============================================================
    // TAB RENDERERS - Simple wrappers (real rendering in tabs)
    // ============================================================

    function renderClassTab(state) {
        // This will be replaced with actual tab rendering
        // For now, delegate to the tab module if available
        if (window.ClassTab && typeof window.ClassTab.render === 'function') {
            return window.ClassTab.render(state);
        }

        // Fallback
        var viewModel = AcademyAggregator.getClassListViewModel({
            status: 'active'
        });

        var html = '<div class="academy-class-tab">';
        html += '<div class="class-tab-header">';
        html += '<h3>Classes</h3>';
        html += '<button id="academy-add-class-btn" class="primary small">+ Add Class</button>';
        html += '</div>';

        if (viewModel.classes.length === 0) {
            html += '<p class="empty-state">No classes found.</p>';
        } else {
            html += '<div class="class-list">';
            for (var i = 0; i < viewModel.classes.length; i++) {
                var cls = viewModel.classes[i];
                var isSelected = state.selectedClassId === cls.id;
                html += '<div class="class-list-item' + (isSelected ? ' selected' : '') + '" data-id="' + escapeHtml(cls.id) + '">';
                html += '<span class="class-name">' + escapeHtml(cls.name) + '</span>';
                html += '<span class="class-meta">' + cls.studentCount + ' students, ' + cls.teamCount + ' teams</span>';
                html += '</div>';
            }
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    function renderStudentTab(state) {
        if (window.StudentTab && typeof window.StudentTab.render === 'function') {
            return window.StudentTab.render(state);
        }

        var html = '<div class="academy-student-tab">';
        html += '<div class="student-tab-header">';
        html += '<h3>Students</h3>';
        html += '</div>';
        html += '<p class="empty-state">Select a class to view students.</p>';
        html += '</div>';
        return html;
    }

    function renderFacultyTab(state) {
        if (window.FacultyTab && typeof window.FacultyTab.render === 'function') {
            return window.FacultyTab.render(state);
        }

        var html = '<div class="academy-faculty-tab">';
        html += '<div class="faculty-tab-header">';
        html += '<h3>Faculty</h3>';
        html += '</div>';
        html += '<p class="empty-state">Select a class to view faculty.</p>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // HTML ESCAPING - Simple fallback
    // ============================================================

    function escapeHtml(value) {
        if (window.DomUtils && typeof window.DomUtils.escapeHtml === 'function') {
            return window.DomUtils.escapeHtml(value);
        }
        if (value === undefined || value === null) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttribute(value) {
        if (window.DomUtils && typeof window.DomUtils.escapeAttribute === 'function') {
            return window.DomUtils.escapeAttribute(value);
        }
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // BIND TAB CONTENT EVENTS
    // ============================================================

    function bindTabContentEvents(container) {
        if (!container) {
            return;
        }

        // ---- Tab switching (sub-tabs) ----
        var tabBtns = container.querySelectorAll('.academy-subtab-btn');
        for (var i = 0; i < tabBtns.length; i++) {
            var btn = tabBtns[i];
            addEventListener(btn, 'click', function() {
                var tab = this.dataset.tab;
                if (tab) {
                    handleTabSwitch(tab);
                }
            });
        }

        // ---- Class list selection ----
        delegate('.class-list-item', 'click', function(e, target) {
            var id = target.dataset.id;
            if (id) {
                AcademyUI.selectClass(id);
                refreshUI();
            }
        });

        // ---- Add class ----
        var addBtn = container.querySelector('#academy-add-class-btn');
        if (addBtn) {
            addEventListener(addBtn, 'click', function() {
                handleAddClass();
            });
        }

        // ---- Edit class ----
        delegate('.edit-class-btn', 'click', function(e, target) {
            var id = target.dataset.id;
            if (id) {
                handleEditClass(id);
            }
        });

        // ---- Delete class ----
        delegate('.delete-class-btn', 'click', function(e, target) {
            var id = target.dataset.id;
            if (id && confirm('Delete this class permanently?')) {
                handleDeleteClass(id);
            }
        });

        // ---- Week selector ----
        var weekInput = container.querySelector('.academy-week-input');
        var weekApply = container.querySelector('.academy-week-apply');
        if (weekInput && weekApply) {
            addEventListener(weekApply, 'click', function() {
                var week = parseInt(weekInput.value, 10);
                if (!isNaN(week) && week >= 1) {
                    AcademyUI.setDisplayWeek(week);
                    refreshUI();
                }
            });
            addEventListener(weekInput, 'keydown', function(e) {
                if (e.key === 'Enter') {
                    weekApply.click();
                }
            });
        }

        // ---- Student selection ----
        delegate('.student-list-item', 'click', function(e, target) {
            var id = target.dataset.id;
            if (id) {
                AcademyUI.selectStudent(id);
                refreshUI();
            }
        });

        // ---- Instructor selection ----
        delegate('.instructor-list-item', 'click', function(e, target) {
            var id = target.dataset.id;
            if (id) {
                AcademyUI.selectInstructor(id);
                refreshUI();
            }
        });

        // ---- Filter inputs ----
        var filterInputs = container.querySelectorAll('.academy-filter-input');
        for (var j = 0; j < filterInputs.length; j++) {
            var input = filterInputs[j];
            addEventListener(input, 'input', function() {
                var tab = this.dataset.tab;
                var key = this.dataset.key || 'search';
                if (tab) {
                    AcademyUI.setFilter(tab, key, this.value);
                    refreshUI();
                }
            });
        }

        // ---- Filter clears ----
        var clearBtns = container.querySelectorAll('.academy-filter-clear');
        for (var k = 0; k < clearBtns.length; k++) {
            var btn = clearBtns[k];
            addEventListener(btn, 'click', function() {
                var tab = this.dataset.tab;
                if (tab) {
                    AcademyUI.resetFilter(tab);
                    refreshUI();
                }
            });
        }

        // ---- Delegate events for tab-specific actions ----
        delegate('.class-detail-tab-btn', 'click', function(e, target) {
            var tab = target.dataset.tab;
            if (tab) {
                switchClassDetailTab(container, tab);
            }
        });

        // ---- Grade save ----
        var gradeSaveBtn = container.querySelector('#grades-save-btn');
        if (gradeSaveBtn) {
            addEventListener(gradeSaveBtn, 'click', function() {
                handleSaveGrades(container);
            });
        }

        // ---- Rest days save ----
        var restDaysBtn = container.querySelector('#schedule-rest-days-save');
        if (restDaysBtn) {
            addEventListener(restDaysBtn, 'click', function() {
                handleSaveRestDays(container);
            });
        }

        // ---- Auto-generate rankings ----
        var rankingAutoBtn = container.querySelector('#ranking-auto-btn');
        if (rankingAutoBtn) {
            addEventListener(rankingAutoBtn, 'click', function() {
                handleAutoGenerateRankings();
            });
        }

        // ---- Add team ----
        var teamAddBtn = container.querySelector('#team-add-btn');
        if (teamAddBtn) {
            addEventListener(teamAddBtn, 'click', function() {
                handleAddTeam(container);
            });
        }

        // ---- Add tournament ----
        var tournAddBtn = container.querySelector('#tournament-add-btn');
        if (tournAddBtn) {
            addEventListener(tournAddBtn, 'click', function() {
                handleAddTournament(container);
            });
        }

        // ---- Auto-distribute ----
        var distributeBtn = container.querySelector('#distribute-class-btn');
        if (distributeBtn) {
            addEventListener(distributeBtn, 'click', function() {
                handleAutoDistribute(container);
            });
        }

        // ---- Manage team members ----
        delegate('.team-manage-members', 'click', function(e, target) {
            var teamId = target.dataset.team;
            if (teamId) {
                handleManageTeamMembers(teamId);
            }
        });

        // ---- Remove team ----
        delegate('.team-delete-btn', 'click', function(e, target) {
            var teamId = target.dataset.team;
            if (teamId && confirm('Delete this team?')) {
                handleDeleteTeam(teamId);
            }
        });

        // ---- Remove member from team ----
        delegate('.team-member-remove', 'click', function(e, target) {
            var teamId = target.dataset.team;
            var studentId = target.dataset.student;
            if (teamId && studentId && confirm('Remove this member?')) {
                handleRemoveTeamMember(teamId, studentId);
            }
        });

        // ---- Add member to team ----
        var memberAddBtn = container.querySelector('#team-member-add-btn');
        if (memberAddBtn) {
            addEventListener(memberAddBtn, 'click', function() {
                handleAddTeamMember(container);
            });
        }
    }

    // ============================================================
    // HANDLERS
    // ============================================================

    function handleTabSwitch(tab) {
        if (AcademyUI.setActiveTab(tab)) {
            refreshUI();
        }
    }

    function handleAddClass() {
        // This will be handled by ClassTab.showClassForm
        if (window.ClassTab && typeof window.ClassTab.showClassForm === 'function') {
            window.ClassTab.showClassForm(null);
        } else {
            notify('Class form not available.', 'error');
        }
    }

    function handleEditClass(classId) {
        if (window.ClassTab && typeof window.ClassTab.showClassForm === 'function') {
            window.ClassTab.showClassForm(classId);
        } else {
            notify('Class form not available.', 'error');
        }
    }

    function handleDeleteClass(classId) {
        if (!classId) {
            return;
        }

        var result = AcademyCore.deleteClass(classId);
        if (result && result.success) {
            notify('Class deleted successfully.', 'success');
            AcademyUI.clearSelection('class');
            refreshUI();
        } else {
            notify(result ? result.message : 'Failed to delete class.', 'error');
        }
    }

    function switchClassDetailTab(container, tab) {
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

    function handleSaveGrades(container) {
        var studentId = AcademyUI.getSelectedStudentId();
        if (!studentId) {
            notify('No student selected.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();
        var gradeInputs = container.querySelectorAll('.grade-input');
        var grades = {};
        var hasChanges = false;

        for (var i = 0; i < gradeInputs.length; i++) {
            var input = gradeInputs[i];
            var disciplineId = input.dataset.discipline;
            var value = input.value.trim();

            if (value === '') {
                grades[disciplineId] = null;
                hasChanges = true;
                continue;
            }

            var num = parseFloat(value);
            if (isNaN(num) || num < 0 || num > 100) {
                notify('Invalid score for discipline: ' + disciplineId, 'error');
                return;
            }

            grades[disciplineId] = Math.round(num * 10) / 10;
            hasChanges = true;
        }

        if (!hasChanges) {
            notify('No changes to save.', 'info');
            return;
        }

        // Delegate to AcademyGrades
        if (window.AcademyGrades && typeof window.AcademyGrades.saveGrades === 'function') {
            var result = window.AcademyGrades.saveGrades(studentId, week, grades);
            if (result && result.success) {
                notify('Grades saved successfully.', 'success');
                refreshUI();
            } else {
                notify(result ? result.message : 'Failed to save grades.', 'error');
            }
        } else {
            notify('Grade saving not available.', 'error');
        }
    }

    function handleSaveRestDays(container) {
        var studentId = AcademyUI.getSelectedStudentId();
        if (!studentId) {
            notify('No student selected.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();
        var checkboxes = container.querySelectorAll('.rest-day-checkbox:checked');
        var days = [];

        for (var i = 0; i < checkboxes.length; i++) {
            days.push(parseInt(checkboxes[i].value, 10));
        }

        if (window.AcademySchedule && typeof window.AcademySchedule.setRestDays === 'function') {
            var result = window.AcademySchedule.setRestDays(studentId, week, days);
            if (result && result.success) {
                notify('Rest days saved successfully.', 'success');
                refreshUI();
            } else {
                notify(result ? result.message : 'Failed to save rest days.', 'error');
            }
        } else {
            notify('Rest days not available.', 'error');
        }
    }

    function handleAutoGenerateRankings() {
        var week = AcademyUI.getDisplayWeek();

        if (!confirm('Auto-generate rankings for week ' + week + ' from grade data?')) {
            return;
        }

        if (window.AcademyRanking && typeof window.AcademyRanking.autoGenerate === 'function') {
            var result = window.AcademyRanking.autoGenerate(week);
            if (result && result.success) {
                notify('Auto-generated rankings for week ' + week + '.', 'success');
                refreshUI();
            } else {
                notify(result ? result.message : 'Failed to auto-generate rankings.', 'error');
            }
        } else {
            notify('Ranking generation not available.', 'error');
        }
    }

    function handleAddTeam(container) {
        var classId = AcademyUI.getSelectedClassId();
        if (!classId) {
            notify('No class selected.', 'error');
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

        if (window.TeamCore && typeof window.TeamCore.createTeam === 'function') {
            var result = window.TeamCore.createTeam(teamData);
            if (result) {
                notify('Team created successfully.', 'success');
                if (nameInput) { nameInput.value = ''; }
                if (numberInput) { numberInput.value = ''; }
                refreshUI();
            } else {
                notify('Failed to create team.', 'error');
            }
        } else {
            notify('Team creation not available.', 'error');
        }
    }

    function handleDeleteTeam(teamId) {
        if (window.TeamCore && typeof window.TeamCore.deleteTeam === 'function') {
            var result = window.TeamCore.deleteTeam(teamId);
            if (result) {
                notify('Team deleted successfully.', 'success');
                refreshUI();
            } else {
                notify('Failed to delete team.', 'error');
            }
        } else {
            notify('Team deletion not available.', 'error');
        }
    }

    function handleAddTeamMember(container) {
        var teamId = container ? container.dataset.teamId : null;
        if (!teamId) {
            notify('No team selected.', 'error');
            return;
        }

        var select = container.querySelector('#team-member-select');
        var roleInput = container.querySelector('#team-member-role');
        var joinInput = container.querySelector('#team-member-join');

        var studentId = select ? select.value : '';
        if (!studentId) {
            notify('Please select a student.', 'error');
            return;
        }

        var role = roleInput ? roleInput.value.trim() : 'Member';
        var join = joinInput ? joinInput.value.trim() : String(AcademyUI.getDisplayWeek());

        if (window.TeamCore && typeof window.TeamCore.addMember === 'function') {
            var result = window.TeamCore.addMember(teamId, {
                characterId: studentId,
                role: role,
                joinPeriod: join,
                leavePeriod: ''
            });

            if (result) {
                notify('Student added to team.', 'success');
                if (select) { select.value = ''; }
                if (roleInput) { roleInput.value = ''; }
                refreshUI();
            } else {
                notify('Failed to add student.', 'error');
            }
        } else {
            notify('Team member management not available.', 'error');
        }
    }

    function handleRemoveTeamMember(teamId, studentId) {
        if (window.TeamCore && typeof window.TeamCore.removeMember === 'function') {
            var result = window.TeamCore.removeMember(teamId, studentId);
            if (result) {
                notify('Member removed.', 'success');
                refreshUI();
            } else {
                notify('Failed to remove member.', 'error');
            }
        } else {
            notify('Team member management not available.', 'error');
        }
    }

    function handleManageTeamMembers(teamId) {
        if (window.ClassTab && typeof window.ClassTab.showTeamMembersModal === 'function') {
            window.ClassTab.showTeamMembersModal(teamId);
        } else {
            notify('Team members modal not available.', 'error');
        }
    }

    function handleAddTournament(container) {
        var classId = AcademyUI.getSelectedClassId();
        if (!classId) {
            notify('No class selected.', 'error');
            return;
        }

        var nameInput = container.querySelector('#tournament-add-name');
        var descInput = container.querySelector('#tournament-add-desc');
        var weekInput = container.querySelector('#tournament-add-week');

        var name = nameInput ? nameInput.value.trim() : '';
        if (!name) {
            notify('Tournament name is required.', 'error');
            return;
        }

        var week = weekInput ? parseInt(weekInput.value, 10) : AcademyUI.getDisplayWeek();

        // Delegate to AcademyTournaments if available
        if (window.AcademyTournaments && typeof window.AcademyTournaments.createTournament === 'function') {
            var result = window.AcademyTournaments.createTournament(classId, name, descInput ? descInput.value.trim() : '', week);
            if (result && result.success) {
                notify('Tournament created successfully.', 'success');
                if (nameInput) { nameInput.value = ''; }
                if (descInput) { descInput.value = ''; }
                refreshUI();
            } else {
                notify(result ? result.message : 'Failed to create tournament.', 'error');
            }
        } else {
            notify('Tournament creation not available.', 'error');
        }
    }

    function handleAutoDistribute(container) {
        var classId = AcademyUI.getSelectedClassId();
        if (!classId) {
            notify('No class selected.', 'error');
            return;
        }

        if (window.ClassTab && typeof window.ClassTab.showDistributeModal === 'function') {
            window.ClassTab.showDistributeModal(classId);
        } else {
            notify('Distribution modal not available.', 'error');
        }
    }

    // ============================================================
    // INIT / DESTROY
    // ============================================================

    function init(container) {
        if (_initialized) {
            destroy();
        }

        if (!checkDependencies()) {
            console.warn('[AcademyEvents] Dependencies not met, skipping initialization');
            return;
        }

        if (!container) {
            container = document.getElementById('tab-academy');
        }
        if (!container) {
            console.warn('[AcademyEvents] Container not found');
            return;
        }

        _container = container;
        removeAllEventListeners();

        // Initialize UI state
        AcademyUI.init();

        // Render the container
        renderAcademyContainer(container);

        // Bind events
        bindAcademyEvents(container);

        _initialized = true;
    }

    function renderAcademyContainer(container) {
        var activeTab = AcademyUI.getActiveTab();
        var displayWeek = AcademyUI.getDisplayWeek();

        // Get sub-tab labels from AcademyConstants
        var subTabs = [];
        if (window.AcademyConstants && window.AcademyConstants.ACADEMY_SUBTABS) {
            subTabs = window.AcademyConstants.ACADEMY_SUBTABS;
        } else {
            subTabs = [
                { id: 'class', label: 'Classes' },
                { id: 'student', label: 'Students' },
                { id: 'faculty', label: 'Faculty' }
            ];
        }

        var html = '';

        // Sub-tab navigation
        html += '<div class="academy-subtab-nav">';
        for (var i = 0; i < subTabs.length; i++) {
            var tab = subTabs[i];
            var isActive = tab.id === activeTab;
            html += '<button class="academy-subtab-btn' + (isActive ? ' active' : '') + '" data-tab="' + escapeAttribute(tab.id) + '">';
            html += escapeHtml(tab.label);
            html += '</button>';
        }
        html += '</div>';

        // Week selector
        html += '<div class="academy-week-selector">';
        html += '<label>Week:</label>';
        html += '<input type="number" class="academy-week-input" value="' + displayWeek + '" min="1" max="52">';
        html += '<button class="academy-week-apply small secondary">Apply</button>';
        html += '</div>';

        // Content
        html += '<div id="academy-subtab-content" class="academy-subtab-content"></div>';

        container.innerHTML = html;

        // Initial render of content
        refreshUI();
    }

    function bindAcademyEvents(container) {
        // Sub-tab switching
        var tabBtns = container.querySelectorAll('.academy-subtab-btn');
        for (var i = 0; i < tabBtns.length; i++) {
            var btn = tabBtns[i];
            addEventListener(btn, 'click', function() {
                var tab = this.dataset.tab;
                if (tab) {
                    handleTabSwitch(tab);
                }
            });
        }

        // Week selector
        var weekApply = container.querySelector('.academy-week-apply');
        var weekInput = container.querySelector('.academy-week-input');
        if (weekApply && weekInput) {
            addEventListener(weekApply, 'click', function() {
                var week = parseInt(weekInput.value, 10);
                if (!isNaN(week) && week >= 1) {
                    AcademyUI.setDisplayWeek(week);
                    refreshUI();
                }
            });
            addEventListener(weekInput, 'keydown', function(e) {
                if (e.key === 'Enter') {
                    weekApply.click();
                }
            });
        }

        // Delegate for tab content events
        var content = container.querySelector('#academy-subtab-content');
        if (content) {
            bindTabContentEvents(content);
        }
    }

    function destroy() {
        removeAllEventListeners();
        _initialized = false;
        _container = null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyEvents = {
        // Main
        init: init,
        destroy: destroy,

        // Refresh
        refreshUI: refreshUI,

        // Render
        renderAcademyContainer: renderAcademyContainer,

        // Handlers (exposed for testing)
        handleTabSwitch: handleTabSwitch,
        handleAddClass: handleAddClass,
        handleEditClass: handleEditClass,
        handleDeleteClass: handleDeleteClass,
        handleSaveGrades: handleSaveGrades,
        handleSaveRestDays: handleSaveRestDays,
        handleAutoGenerateRankings: handleAutoGenerateRankings,
        handleAddTeam: handleAddTeam,
        handleDeleteTeam: handleDeleteTeam,
        handleAddTeamMember: handleAddTeamMember,
        handleRemoveTeamMember: handleRemoveTeamMember,
        handleManageTeamMembers: handleManageTeamMembers,
        handleAddTournament: handleAddTournament,
        handleAutoDistribute: handleAutoDistribute
    };

})();