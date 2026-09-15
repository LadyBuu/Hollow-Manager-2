/**
 * modules/academy/academy-character-detail.js - Academy Character Detail Panel
 * Pure renderer for the character detail VM.
 *
 * Path: js/modules/academy/academy-character-detail.js
 *
 * The VM is produced by AcademyCharacterDetailAggregator.getViewModel.
 * This module is a renderer: it takes a VM, returns HTML, and does
 * nothing else. Every domain-derived value in the output is already
 * present on the VM.
 *
 * NAME COLLISION:
 *   window.CharacterDetail is the modal in
 *   js/modules/characters/character-detail.js. This module exposes
 *   itself as window.AcademyCharacterDetail.
 *
 * GRADES EDITOR:
 *   The Grades tab renders an empty host element
 *   (#academy-grades-editor-host). Mounting the inline grades editor
 *   into that host is a controller-lifecycle concern and lives in
 *   AcademyView, not here.
 *
 * SCHEDULE GRID:
 *   The Schedule tab renders an empty host element
 *   (#academy-schedule-host). Mounting the CalendarRenderer grid into
 *   that host is a controller-lifecycle concern and lives in
 *   AcademyView's mountScheduleGridIfPresent(), not here. The renderer
 *   only emits the host; the Academy view injects the grid.
 *
 * TABS:
 *   The tabs come from vm.tabs. The active tab comes from
 *   vm.activeTab. The renderer does not decide which tabs are valid
 *   for a mode; the VM does.
 *
 * MODE VOCABULARY:
 *   'student' | 'instructor'. There is no 'trainee'.
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
 */

(function() {
    'use strict';

    if (window.__academyCharacterDetailLoaded) {
        return;
    }

    var DomUtils = window.DomUtils;

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        throw new Error(
            '[AcademyCharacterDetail] Missing mandatory dependency: ' +
            'DomUtils.escapeHtml / DomUtils.escapeAttribute'
        );
    }

    window.__academyCharacterDetailLoaded = true;

    // ============================================================
    // ESCAPING HELPERS
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function getRoleBadgeClass(role) {
        return role === 'instructor'
            ? 'academy-role-badge academy-role-instructor'
            : 'academy-role-badge academy-role-student';
    }

    function getRoleLabel(role) {
        return role === 'instructor' ? 'Instructor' : 'Student';
    }

    // ============================================================
    // PUBLIC ENTRY POINT
    // ============================================================

    /**
     * Render the character detail panel.
     *
     * @param {object|null} viewModel - VM from
     *   AcademyCharacterDetailAggregator.getViewModel
     * @returns {string} HTML string
     */
    function renderHTML(viewModel) {
        if (!viewModel || !viewModel.character || !viewModel.character.id) {
            return renderEmptyState();
        }

        var mode = viewModel.mode === 'instructor' ? 'instructor' : 'student';
        var activeTab = viewModel.activeTab || 'main';
        var tabs = Array.isArray(viewModel.tabs) ? viewModel.tabs : [];

        var html = '';
        html += '<div class="academy-character-detail" ' +
                    'data-character-id="' + escapeAttribute(viewModel.character.id) + '" ' +
                    'data-mode="' + escapeAttribute(mode) + '">';

        html += renderHeader(viewModel.character, mode);
        html += renderEliminationWarning(viewModel.elimination);
        html += renderTabBar(tabs, activeTab);
        html += '<div class="academy-character-tab-body">';

        switch (activeTab) {
            case 'main':
                html += renderMainTab(viewModel, mode);
                break;
            case 'disciplines':
                html += renderDisciplinesTab(viewModel, mode);
                break;
            case 'grades':
                html += renderGradesTab(viewModel);
                break;
            case 'schedule':
                html += renderScheduleTab(viewModel);
                break;
            case 'teams':
                html += renderTeamsTab(viewModel);
                break;
            case 'autoGroups':
                html += renderAutoGroupsTab(viewModel);
                break;
            default:
                html += renderMainTab(viewModel, mode);
        }

        html += '</div>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // EMPTY STATE
    // ============================================================

    function renderEmptyState() {
        return (
            '<div class="academy-detail-empty">' +
                '<p class="empty-state small">' +
                    'Select a character to view their details.' +
                '</p>' +
            '</div>'
        );
    }

    // ============================================================
    // HEADER
    // ============================================================
    //
    // The role badge follows the MODE, not the class roster. The mode
    // toggle is the user's assertion about how to view this character.
    // The class roster remains authoritative for the People list and
    // for any other class-scoped projection.

    function renderHeader(character, mode) {
        var displayRole = mode === 'instructor' ? 'instructor' : 'student';

        var html = '';
        html += '<div class="academy-character-detail-header">';

        html += '<div class="academy-character-detail-title-row">';
        html += '<h3 class="academy-character-detail-title">' +
                    escapeHtml(character.name) +
                '</h3>';
        html += '<span class="' + getRoleBadgeClass(displayRole) + '">' +
                    escapeHtml(getRoleLabel(displayRole)) +
                '</span>';
        html += '</div>';

        html += '<div class="academy-character-detail-meta">';

        if (isNonEmptyString(character.status)) {
            html += '<span class="academy-character-detail-meta-item">' +
                        '<span class="meta-label">Status:</span> ' +
                        escapeHtml(character.status) +
                    '</span>';
        }

        if (isNonEmptyString(character.age) && character.age !== '-') {
            html += '<span class="academy-character-detail-meta-item">' +
                        '<span class="meta-label">Age:</span> ' +
                        escapeHtml(character.age) +
                    '</span>';
        }

        if (character.deceased) {
            html += '<span class="academy-character-detail-meta-item academy-meta-danger">' +
                        'Deceased' +
                    '</span>';
        }

        html += '</div>';

        html += renderModeToggle(mode);

        html += '</div>';

        return html;
    }

    function renderModeToggle(mode) {
        var isInstructor = mode === 'instructor';

        var html = '';
        html += '<div class="academy-character-mode-toggle">';
        html += '<label class="academy-mode-checkbox-label" ' +
                    'for="academy-character-mode-checkbox">';
        html += '<input type="checkbox" id="academy-character-mode-checkbox" ' +
                    'class="academy-character-mode-checkbox"' +
                    (isInstructor ? ' checked' : '') + '>';
        html += '<span class="academy-mode-checkbox-text">Instructor mode</span>';
        html += '</label>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // ELIMINATION WARNING
    // ============================================================
    //
    // The VM provides state: 'current' | 'past'. The renderer maps it
    // to a banner style. No week comparison happens here.

    function renderEliminationWarning(elimination) {
        if (!elimination) {
            return '';
        }

        var reasonSuffix = isNonEmptyString(elimination.reason)
            ? ' \u2014 ' + escapeHtml(elimination.reason)
            : '';

        if (elimination.state === 'current') {
            return (
                '<div class="academy-character-detail-warning academy-warning-elimination-now">' +
                    '<span class="academy-warning-icon">\u26a0</span>' +
                    '<span class="academy-warning-text">' +
                        'Eliminated this week (Week ' +
                        escapeHtml(String(elimination.week)) +
                        ')' +
                        reasonSuffix +
                    '</span>' +
                '</div>'
            );
        }

        return (
            '<div class="academy-character-detail-warning academy-warning-eliminated">' +
                '<span class="academy-warning-icon">\u26a0</span>' +
                '<span class="academy-warning-text">' +
                    'Eliminated in Week ' +
                    escapeHtml(String(elimination.week)) +
                    reasonSuffix +
                '</span>' +
            '</div>'
        );
    }

    // ============================================================
    // TAB BAR
    // ============================================================

    function renderTabBar(tabs, activeTab) {
        var html = '';
        html += '<div class="academy-character-tabs">';

        for (var i = 0; i < tabs.length; i++) {
            var t = tabs[i];
            if (!t || !t.id) { continue; }
            var isActive = t.id === activeTab;
            html += '<button type="button" ' +
                        'class="academy-character-tab-btn' +
                            (isActive ? ' active' : '') + '" ' +
                        'data-tab="' + escapeAttribute(t.id) + '">' +
                        escapeHtml(t.label) +
                    '</button>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // MAIN TAB
    // ============================================================

    function renderMainTab(vm, mode) {
        var html = '';

        html += renderClassChips(vm.classes);

        if (mode === 'student' && vm.performance) {
            html += renderPerformanceScores(vm.performance);
        }

        if (mode === 'student') {
            html += renderDropOutSection(vm.character, vm.elimination);
        }

        return html;
    }

    function renderClassChips(classes) {
        if (!Array.isArray(classes) || classes.length === 0) {
            return '';
        }

        var html = '';
        html += '<div class="academy-character-detail-section academy-character-class-chips">';
        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">Classes</h4>';
        html += '</div>';
        html += '<div class="academy-character-chip-row">';

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || !cls.id) { continue; }
            html += '<span class="academy-character-class-chip" ' +
                        'data-class-id="' + escapeAttribute(cls.id) + '">' +
                        escapeHtml(cls.name) +
                    '</span>';
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // PERFORMANCE SCORES
    // ============================================================

    function renderPerformanceScores(performance) {
        var html = '';
        html += '<div class="academy-character-detail-section academy-character-scores">';
        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">Performance</h4>';
        html += '<span class="academy-character-detail-section-subtitle">' +
                    'Week ' + escapeHtml(String(performance.week)) +
                '</span>';
        html += '</div>';

        html += '<div class="academy-score-grid">';

        html += renderScoreCard(
            'Academic Average',
            performance.academicAverage,
            'academic-average'
        );

        html += renderScoreCard(
            'Social Score',
            performance.socialScore,
            'social-score',
            {
                action: 'edit-social-score',
                characterId: performance.characterId,
                label: 'Edit'
            }
        );

        html += renderScoreCard(
            'Overall',
            performance.overallScore,
            'overall-score'
        );

        html += '</div>';
        html += '</div>';

        return html;
    }

    function renderScoreCard(label, value, kind, action) {
        var hasValue = isFiniteNumber(value);
        var display = hasValue
            ? String(Math.round(value * 10) / 10)
            : '\u2014';

        var valueClass = 'academy-score-value academy-score-value-' + kind;
        if (!hasValue) {
            valueClass += ' academy-score-value-empty';
        }

        var html = '';
        html += '<div class="academy-score-card academy-score-card-' + kind + '">';
        html += '<div class="academy-score-label">' + escapeHtml(label) + '</div>';
        html += '<div class="' + valueClass + '">' + escapeHtml(display) + '</div>';

        if (action && action.action) {
            html += '<div class="academy-score-actions">';
            html += '<button type="button" class="small secondary" ' +
                        'data-action="' + escapeAttribute(action.action) + '" ' +
                        (action.characterId
                            ? 'data-character-id="' +
                                escapeAttribute(action.characterId) + '" '
                            : '') +
                        '>' +
                        escapeHtml(action.label || 'Edit') +
                    '</button>';
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // DROP OUT
    // ============================================================

    function renderDropOutSection(character, elimination) {
        var isEliminated = elimination !== null && elimination !== undefined;

        var html = '';
        html += '<div class="academy-character-detail-section ' +
                    'academy-character-dropout-section">';
        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">Enrollment</h4>';
        html += '</div>';

        if (isEliminated) {
            html += '<div class="academy-dropout-status academy-dropout-status-eliminated">';
            html += '<span class="academy-dropout-status-label">Eliminated</span>';

            if (isFiniteNumber(elimination.week)) {
                html += '<span class="academy-dropout-status-detail">Week ' +
                            escapeHtml(String(elimination.week)) +
                        '</span>';
            }

            if (isNonEmptyString(elimination.reason)) {
                html += '<span class="academy-dropout-status-detail">' +
                            escapeHtml(elimination.reason) +
                        '</span>';
            }

            html += '</div>';
        } else {
            html += '<div class="academy-dropout-controls">';
            html += '<button type="button" ' +
                        'class="small danger academy-dropout-btn" ' +
                        'data-action="drop-out-character" ' +
                        'data-character-id="' +
                            escapeAttribute(character.id) + '">' +
                        'Drop Out' +
                    '</button>';
            html += '<span class="academy-dropout-hint">' +
                        'Marks this character as eliminated. ' +
                        'They remain on the class roster.' +
                    '</span>';
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // DISCIPLINES TAB
    // ============================================================

    function renderDisciplinesTab(vm, mode) {
        if (mode === 'instructor') {
            return renderInstructorDisciplines(vm.instructor);
        }
        return renderStudentDisciplines(
            vm.student,
            vm.classContext,
            vm.character
        );
    }

    function renderStudentDisciplines(student, classContext, character) {
        var html = '';
        html += '<div class="academy-character-detail-section ' +
                    'academy-character-disciplines">';

        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">Disciplines</h4>';

        if (classContext) {
            html += '<button type="button" class="small primary" ' +
                        'data-action="enroll-discipline" ' +
                        'data-character-id="' +
                            escapeAttribute(character.id) + '">' +
                        '+ Enroll' +
                    '</button>';
        }
        html += '</div>';

        if (!classContext) {
            html += '<p class="empty-state small">' +
                        'Select a class to view this student\'s enrollment.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        if (!student || student.disciplines === null) {
            html += '<p class="empty-state small">' +
                        'Enrollment module not available.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        if (student.disciplines.length === 0) {
            html += '<p class="empty-state small">' +
                        'Not enrolled in any disciplines for this class.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="academy-character-discipline-list">';

        for (var i = 0; i < student.disciplines.length; i++) {
            var d = student.disciplines[i];
            html += '<div class="academy-character-discipline-row" ' +
                        'data-discipline-id="' + escapeAttribute(d.id) + '">';
            html += '<span class="academy-character-discipline-name">' +
                        escapeHtml(d.name) +
                    '</span>';
            html += '<button type="button" class="small danger" ' +
                        'data-action="leave-discipline" ' +
                        'data-character-id="' +
                            escapeAttribute(character.id) + '" ' +
                        'data-discipline-id="' +
                            escapeAttribute(d.id) + '">' +
                        'Leave' +
                    '</button>';
            html += '</div>';
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderInstructorDisciplines(instructor) {
        var html = '';
        html += '<div class="academy-character-detail-section ' +
                    'academy-character-instructor-disciplines">';

        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">' +
                    'Disciplines I Teach' +
                '</h4>';
        html += '</div>';

        if (!instructor) {
            html += '<p class="empty-state small">' +
                        'Instructor data not available.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        if (!Array.isArray(instructor.disciplines) ||
            instructor.disciplines.length === 0) {
            html += '<p class="empty-state small">' +
                        'Not assigned to teach any disciplines.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="academy-character-discipline-list">';

        for (var i = 0; i < instructor.disciplines.length; i++) {
            var d = instructor.disciplines[i];
            html += '<div class="academy-character-discipline-row ' +
                        'academy-instructor-discipline-row" ' +
                        'data-discipline-id="' + escapeAttribute(d.id) + '">';
            html += '<span class="academy-character-discipline-name">' +
                        escapeHtml(d.name) +
                    '</span>';
            if (isNonEmptyString(d.type)) {
                html += '<span class="academy-character-discipline-meta">' +
                            escapeHtml(d.type) +
                        '</span>';
            }
            html += '</div>';
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // GRADES TAB
    // ============================================================
    //
    // The panel renders an empty host element. AcademyView mounts the
    // inline grades editor into it when the tab is active.

    function renderGradesTab(vm) {
        var html = '';
        html += '<div class="academy-character-detail-section ' +
                    'academy-character-grades">';

        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">Grades</h4>';

        if (!vm.classContext) {
            html += '</div>';
            html += '<p class="empty-state small">' +
                        'Select a class to view this student\'s grades.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        if (vm.student && vm.student.grades && vm.student.grades.hasAny) {
            html += '<span class="academy-character-detail-section-subtitle">' +
                        'Avg ' +
                        escapeHtml(String(vm.student.grades.average)) +
                    '</span>';
        }

        html += '</div>';

        html += '<div id="academy-grades-editor-host" ' +
                    'class="academy-grades-editor-host"></div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // SCHEDULE TAB
    // ============================================================
    //
    // The panel renders an empty host element. AcademyView's
    // mountScheduleGridIfPresent() reads the host, gets a grid VM from
    // AcademyCharacterDetailAggregator.getScheduleGridViewModel, and
    // injects the rendered grid via CalendarRenderer.renderGrid.
    //
    // The host is a plain container. The Academy view decides whether
    // to render the grid into it; the renderer only emits the anchor.

    function renderScheduleTab(vm) {
        var html = '';
        html += '<div class="academy-character-detail-section ' +
                    'academy-character-schedule">';

        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">Schedule</h4>';

        if (vm.performance && isFiniteNumber(vm.performance.week)) {
            html += '<span class="academy-character-detail-section-subtitle">' +
                        'Week ' +
                        escapeHtml(String(vm.performance.week)) +
                    '</span>';
        }

        html += '</div>';

        // Host element. Academy view populates this with the grid.
        html += '<div id="academy-schedule-host" ' +
                    'class="academy-schedule-host"></div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // TEAMS TAB
    // ============================================================

    function renderTeamsTab(vm) {
        var student = vm.student;
        var teams = student && Array.isArray(student.teams)
            ? student.teams
            : null;

        if (teams === null) {
            return (
                '<div class="academy-character-detail-section">' +
                    '<p class="empty-state small">' +
                        'Team data not available.' +
                    '</p>' +
                '</div>'
            );
        }

        if (teams.length === 0) {
            return (
                '<div class="academy-character-detail-section ' +
                        'academy-character-teams">' +
                    '<div class="academy-character-detail-section-header">' +
                        '<h4 class="academy-character-detail-section-title">' +
                            'Teams' +
                        '</h4>' +
                        '<span class="academy-character-detail-section-count">' +
                            '0' +
                        '</span>' +
                    '</div>' +
                    '<p class="empty-state small">' +
                        'Not a member of any teams.' +
                    '</p>' +
                '</div>'
            );
        }

        var html = '';
        html += '<div class="academy-character-detail-section ' +
                    'academy-character-teams">';

        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">Teams</h4>';
        html += '<span class="academy-character-detail-section-count">' +
                    teams.length +
                '</span>';
        html += '</div>';

        html += '<div class="academy-character-team-list">';

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || !team.id) { continue; }
            html += '<div class="academy-character-team-row" ' +
                        'data-team-id="' + escapeAttribute(team.id) + '">';
            html += '<span class="academy-character-team-name">' +
                        escapeHtml(team.name) +
                    '</span>';
            html += '<span class="academy-character-team-type">' +
                        escapeHtml(team.typeLabel) +
                    '</span>';
            html += '</div>';
        }

        html += '</div>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // AUTO-GROUPS TAB
    // ============================================================

    function renderAutoGroupsTab(vm) {
        var instructor = vm.instructor;

        if (!instructor) {
            return (
                '<div class="academy-character-detail-section">' +
                    '<p class="empty-state small">' +
                        'Instructor data not available.' +
                    '</p>' +
                '</div>'
            );
        }

        if (instructor.autoGroups === null) {
            return (
                '<div class="academy-character-detail-section">' +
                    '<p class="empty-state small">' +
                        'Auto-groups module not available.' +
                    '</p>' +
                '</div>'
            );
        }

        if (!Array.isArray(instructor.autoGroups) ||
            instructor.autoGroups.length === 0) {
            return (
                '<div class="academy-character-detail-section ' +
                        'academy-character-auto-groups">' +
                    '<div class="academy-character-detail-section-header">' +
                        '<h4 class="academy-character-detail-section-title">' +
                            'Auto-Groups' +
                        '</h4>' +
                        '<span class="academy-character-detail-section-count">' +
                            '0' +
                        '</span>' +
                    '</div>' +
                    '<p class="empty-state small">' +
                        'Not managing any groups.' +
                    '</p>' +
                '</div>'
            );
        }

        var html = '';
        html += '<div class="academy-character-detail-section ' +
                    'academy-character-auto-groups">';

        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">Auto-Groups</h4>';
        html += '<span class="academy-character-detail-section-count">' +
                    instructor.autoGroups.length +
                '</span>';
        html += '</div>';

        for (var i = 0; i < instructor.autoGroups.length; i++) {
            html += renderInstructorGroupBlock(
                vm.character,
                instructor.autoGroups[i]
            );
        }

        html += '</div>';
        return html;
    }

    function renderInstructorGroupBlock(character, group) {
        if (!group) { return ''; }

        var students = Array.isArray(group.students) ? group.students : [];

        var html = '';
        html += '<div class="academy-instructor-group" ' +
                    'data-group-key="' +
                        escapeAttribute(group.key || '') + '">';

        html += '<div class="academy-instructor-group-header">';
        html += '<span class="academy-instructor-group-name">' +
                    escapeHtml(group.disciplineName || 'Unknown Discipline') +
                '</span>';
        html += '<span class="academy-instructor-group-count">' +
                    students.length + ' student' +
                    (students.length === 1 ? '' : 's') +
                '</span>';
        html += '<button type="button" class="small primary" ' +
                    'data-action="add-group-student" ' +
                    'data-instructor-id="' +
                        escapeAttribute(character.id) + '" ' +
                    'data-group-key="' +
                        escapeAttribute(group.key || '') + '">' +
                    '+ Add Student' +
                '</button>';
        html += '</div>';

        if (students.length === 0) {
            html += '<p class="empty-state small ' +
                        'academy-instructor-group-empty">' +
                        'No students in this group yet.' +
                    '</p>';
        } else {
            html += '<div class="academy-instructor-group-roster">';
            for (var i = 0; i < students.length; i++) {
                var s = students[i];
                if (!s || !s.id) { continue; }
                html += '<div class="academy-instructor-group-roster-row" ' +
                            'data-character-id="' +
                                escapeAttribute(s.id) + '">';
                html += '<span class="academy-instructor-group-roster-name">' +
                            escapeHtml(s.name) +
                        '</span>';
                if (isNonEmptyString(s.status)) {
                    html += '<span class="academy-instructor-group-roster-status">' +
                                escapeHtml(s.status) +
                            '</span>';
                }
                html += '<button type="button" class="small danger" ' +
                            'data-action="remove-group-student" ' +
                            'data-group-key="' +
                                escapeAttribute(group.key || '') + '" ' +
                            'data-character-id="' +
                                escapeAttribute(s.id) + '">' +
                            'Remove' +
                        '</button>';
                html += '</div>';
            }
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyCharacterDetail = {
        renderHTML: renderHTML
    };

})();
