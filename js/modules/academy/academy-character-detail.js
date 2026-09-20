/**
 * modules/academy/academy-character-detail.js
 * Academy Character Detail Panel
 * Pure renderer for the character detail VM.
 *
 * Path: js/modules/academy/academy-character-detail.js
 *
 * The VM is produced by AcademyCharacterDetailAggregator.getViewModel.
 * This module is a renderer: it takes a VM, returns HTML, and does
 * nothing else.
 *
 * NAME COLLISION:
 *   window.CharacterDetail is the modal in
 *   js/modules/characters/character-detail.js. This module exposes
 *   itself as window.AcademyCharacterDetail.
 *
 * GRADES EDITOR:
 *   The Grades tab renders an empty host element
 *   (#academy-grades-editor-host). Mounting the inline grades
 *   editor into that host is a controller-lifecycle concern and
 *   lives in AcademyView, not here.
 *
 * SCHEDULE GRID:
 *   The Schedule tab renders an empty host element
 *   (#academy-schedule-host). Mounting the CalendarRenderer grid
 *   into that host is a controller-lifecycle concern and lives in
 *   AcademyView, not here.
 *
 * TABS:
 *   The tabs come from vm.tabs. The active tab comes from
 *   vm.activeTab. The renderer does not decide which tabs are
 *   valid for a mode; the VM does.
 *
 * MODE VOCABULARY:
 *   'student' | 'instructor'. There is no 'trainee'.
 *
 * CLASS REMOVAL:
 *   Each class chip on the Main tab carries a small "x" button
 *   that emits data-action="character-remove-from-class".
 *   AcademyView's dispatcher routes it to
 *   CharacterClasses.removeClassById.
 *
 *   This is DISTINCT from "Drop Out":
 *     - Drop Out adds a standalone elimination record.
 *     - Remove from class strips the classId from the
 *       character's classIds array.
 *
 * INSTRUCTOR DISCIPLINES:
 *   The Disciplines tab in instructor mode emits the same
 *   data-actions the student flow does ("enroll-discipline" and
 *   "leave-discipline"). The only mode-aware behavior here is
 *   which affordances render and what their labels say.
 *
 * TEACHING GROUPS:
 *   The Teaching Groups tab (instructor mode) renders the groups
 *   the instructor runs for the currently selected class,
 *   grouped by discipline. Each group block carries:
 *
 *     - the roster, with per-member Remove buttons
 *     - the sessions list, with per-session Edit / Delete buttons
 *     - an inline "+ Add Student" affordance on the roster
 *     - an inline "+ Add Session" affordance on the sessions list
 *
 *   The sessions list is the "when" half of the group. A group is
 *   a who and a when; both render in the same card with the same
 *   edit language.
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
 *   - window.AcademyUI (for collapse state reads)
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
    // COLLAPSE STATE
    // ============================================================
    //
    // Read through AcademyUI if available; degrade to
    // expanded-by-default when it is not. Key format:
    //
    //   'teachingGroup:' + charId + ':' + disciplineId

    function getCharacterId(vm) {
        if (!vm || !vm.character || !vm.character.id) { return null; }
        return String(vm.character.id);
    }

    function isDisciplineExpanded(charId, disciplineId) {
        var AcademyUI = window.AcademyUI;
        if (!AcademyUI || typeof AcademyUI.isExpanded !== 'function') {
            return true;
        }
        var key = 'teachingGroup:' + charId + ':' + disciplineId;
        return AcademyUI.isExpanded(key) === true;
    }

    // ============================================================
    // PUBLIC ENTRY POINT
    // ============================================================

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
            case 'teachingGroups':
                html += renderTeachingGroupsTab(viewModel);
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

        html += renderClassChips(vm.classes, vm.character);

        if (mode === 'student' && vm.performance) {
            html += renderPerformanceScores(vm.performance);
        }

        if (mode === 'student') {
            html += renderDropOutSection(vm.character, vm.elimination);
        }

        return html;
    }

    // ============================================================
    // CLASS CHIPS
    // ============================================================

    function renderClassChips(classes, character) {
        var html = '';
        html += '<div class="academy-character-detail-section academy-character-class-chips">';

        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">Classes</h4>';
        html += '</div>';

        if (!Array.isArray(classes) || classes.length === 0) {
            html += '<p class="empty-state small">' +
                        'Not a member of any class.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="academy-character-chip-row">';

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || !cls.id) { continue; }

            html += '<span class="academy-character-class-chip" ' +
                        'data-class-id="' + escapeAttribute(cls.id) + '">';

            html += '<span class="academy-character-class-chip-name">' +
                        escapeHtml(cls.name) +
                    '</span>';

            html += '<button type="button" ' +
                        'class="academy-character-class-chip-remove" ' +
                        'data-action="character-remove-from-class" ' +
                        'data-character-id="' +
                            escapeAttribute(character.id) + '" ' +
                        'data-class-id="' +
                            escapeAttribute(cls.id) + '" ' +
                        'title="Remove from ' +
                            escapeAttribute(cls.name) + '" ' +
                        'aria-label="Remove from ' +
                            escapeAttribute(cls.name) + '">' +
                        '\u2715' +
                    '</button>';

            html += '</span>';
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
            return renderInstructorDisciplines(vm);
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

    function renderInstructorDisciplines(vm) {
        var instructor = vm.instructor;
        var character = vm.character;
        var classContext = vm.classContext;

        var html = '';
        html += '<div class="academy-character-detail-section ' +
                    'academy-character-instructor-disciplines">';

        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">' +
                    'Disciplines I Teach' +
                '</h4>';

        if (classContext && character && character.id) {
            html += '<button type="button" class="small primary" ' +
                        'data-action="enroll-discipline" ' +
                        'data-character-id="' +
                            escapeAttribute(character.id) + '">' +
                        '+ Assign to teach' +
                    '</button>';
        }
        html += '</div>';

        if (!classContext) {
            html += '<p class="empty-state small">' +
                        'Select a class to manage this instructor\'s ' +
                        'teaching assignments.' +
                    '</p>';
            html += '</div>';
            return html;
        }

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
                        'Not assigned to teach any disciplines. ' +
                        'Use "+ Assign to teach" to add one.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        var selectedClassId = classContext.id;

        html += '<div class="academy-character-discipline-list">';

        for (var i = 0; i < instructor.disciplines.length; i++) {
            html += renderInstructorDisciplineRow(
                instructor.disciplines[i],
                character,
                selectedClassId
            );
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderInstructorDisciplineRow(d, character, selectedClassId) {
        if (!d || !d.id) { return ''; }

        var classIds = Array.isArray(d.classIds) ? d.classIds : [];
        var classNames = Array.isArray(d.classNames) ? d.classNames : [];

        var teachesSelectedClass = false;
        if (isNonEmptyString(selectedClassId)) {
            var target = String(selectedClassId);
            for (var ci = 0; ci < classIds.length; ci++) {
                if (String(classIds[ci]) === target) {
                    teachesSelectedClass = true;
                    break;
                }
            }
        }

        var html = '';
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

        if (classNames.length > 0) {
            html += '<span class="academy-character-discipline-classes" ' +
                        'title="Classes this discipline is taught in">' +
                        escapeHtml(classNames.join(', ')) +
                    '</span>';
        }

        if (teachesSelectedClass && character && character.id) {
            html += '<button type="button" class="small danger ' +
                        'academy-instructor-stop-teaching-btn" ' +
                        'data-action="leave-discipline" ' +
                        'data-character-id="' +
                            escapeAttribute(character.id) + '" ' +
                        'data-discipline-id="' +
                            escapeAttribute(d.id) + '" ' +
                        'title="Stop teaching this discipline for ' +
                            'the currently selected class">' +
                        'Stop teaching this class' +
                    '</button>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // GRADES TAB
    // ============================================================

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
    // TEACHING GROUPS TAB
    // ============================================================
    //
    // The instructor's teaching groups for the selected class,
    // grouped by discipline. Every taught discipline appears as a
    // collapsible container, even when it has no groups yet.
    //
    // Each group block renders:
    //   - the roster, with a "+ Add Student" affordance and
    //     per-member Remove buttons
    //   - the sessions list, with a "+ Add Session" affordance
    //     and per-session Edit / Delete buttons
    //
    // The inline student picker is rendered only for the group
    // whose groupId matches vm._openPickerGroupId. That value is
    // set by the controller when the user clicks "+ Add Student"
    // and cleared on submit or cancel. The renderer reads it from
    // the VM; it does not hold state.
    //
    // The session form modal is opened by the controller, not by
    // this renderer. The renderer only emits the three session
    // actions.

    function renderTeachingGroupsTab(vm) {
        var instructor = vm.instructor;
        var classContext = vm.classContext;
        var charId = getCharacterId(vm);

        if (!classContext) {
            return (
                '<div class="academy-character-detail-section ' +
                        'academy-character-teaching-groups">' +
                    '<p class="empty-state small">' +
                        'Select a class to manage this instructor\'s ' +
                        'teaching groups.' +
                    '</p>' +
                '</div>'
            );
        }

        if (!instructor) {
            return (
                '<div class="academy-character-detail-section ' +
                        'academy-character-teaching-groups">' +
                    '<p class="empty-state small">' +
                        'Instructor data not available.' +
                    '</p>' +
                '</div>'
            );
        }

        var teachingGroups = Array.isArray(instructor.teachingGroups)
            ? instructor.teachingGroups
            : [];

        var html = '';
        html += '<div class="academy-character-detail-section ' +
                    'academy-character-teaching-groups">';

        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">' +
                    'Teaching Groups' +
                '</h4>';
        html += '<span class="academy-character-detail-section-subtitle">' +
                    escapeHtml(classContext.name) +
                '</span>';
        html += '</div>';

        if (teachingGroups.length === 0) {
            html += '<p class="empty-state small">' +
                        'Not assigned to teach any disciplines for ' +
                        'this class.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="academy-teaching-group-discipline-list">';

        for (var i = 0; i < teachingGroups.length; i++) {
            html += renderTeachingGroupDiscipline(
                teachingGroups[i],
                charId,
                vm._openPickerGroupId,
                vm._pickerCandidates
            );
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderTeachingGroupDiscipline(
        discipline,
        charId,
        openPickerGroupId,
        pickerCandidates
    ) {
        if (!discipline || !discipline.disciplineId) { return ''; }

        var groups = Array.isArray(discipline.groups)
            ? discipline.groups
            : [];

        var isExpanded = isDisciplineExpanded(
            charId, discipline.disciplineId
        );

        var groupCountLabel = groups.length === 1
            ? '1 group'
            : groups.length + ' groups';

        var html = '';
        html += '<div class="academy-teaching-group-discipline" ' +
                    'data-discipline-id="' +
                        escapeAttribute(discipline.disciplineId) + '">';

        // ---- Discipline header (toggle) ----
        html += '<button type="button" ' +
                    'class="academy-teaching-group-discipline-header" ' +
                    'data-action="teaching-groups-toggle-discipline" ' +
                    'data-discipline-id="' +
                        escapeAttribute(discipline.disciplineId) + '" ' +
                    'aria-expanded="' +
                        escapeAttribute(isExpanded ? 'true' : 'false') + '">';

        html += '<span class="academy-teaching-group-discipline-caret">' +
                    (isExpanded ? '\u25be' : '\u25b8') +
                '</span>';
        html += '<span class="academy-teaching-group-discipline-name">' +
                    escapeHtml(discipline.disciplineName) +
                '</span>';
        html += '<span class="academy-teaching-group-discipline-count">' +
                    escapeHtml(groupCountLabel) +
                '</span>';

        html += '</button>';

        if (!isExpanded) {
            html += '</div>';
            return html;
        }

        // ---- Body ----
        html += '<div class="academy-teaching-group-discipline-body">';

        if (groups.length === 0) {
            html += '<p class="empty-state small ' +
                        'academy-teaching-group-empty">' +
                        'No groups yet. Students appear here when they ' +
                        'are assigned to a slot on the schedule grid.' +
                    '</p>';
            html += '</div>';
            html += '</div>';
            return html;
        }

        for (var i = 0; i < groups.length; i++) {
            html += renderTeachingGroupBlock(
                groups[i],
                charId,
                openPickerGroupId,
                pickerCandidates
            );
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderTeachingGroupBlock(
        group,
        charId,
        openPickerGroupId,
        pickerCandidates
    ) {
        if (!group || !group.groupId) { return ''; }

        var members = Array.isArray(group.members) ? group.members : [];
        var isPickerOpen = openPickerGroupId &&
            String(openPickerGroupId) === String(group.groupId);

        var html = '';
        html += '<div class="academy-teaching-group-block" ' +
                    'data-group-id="' +
                        escapeAttribute(group.groupId) + '">';

        // ---- Group header ----
        html += '<div class="academy-teaching-group-header">';
        html += '<span class="academy-teaching-group-name">' +
                    escapeHtml(group.displayName) +
                '</span>';
        html += '<span class="academy-teaching-group-count">' +
                    group.memberCount + ' student' +
                    (group.memberCount === 1 ? '' : 's') +
                '</span>';

        if (!isPickerOpen) {
            html += '<button type="button" class="small primary ' +
                        'academy-teaching-group-add-btn" ' +
                        'data-action="teaching-groups-add-student" ' +
                        'data-group-id="' +
                            escapeAttribute(group.groupId) + '">' +
                        '+ Add Student' +
                    '</button>';
        }
        html += '</div>';

        // ---- Inline candidate picker ----
        if (isPickerOpen) {
            html += renderCandidatePicker(
                group,
                charId,
                pickerCandidates
            );
        }

        // ---- Roster ----
        if (members.length === 0) {
            html += '<p class="empty-state small ' +
                        'academy-teaching-group-roster-empty">' +
                        'No students in this group yet.' +
                    '</p>';
        } else {
            html += '<div class="academy-teaching-group-roster">';
            for (var i = 0; i < members.length; i++) {
                html += renderTeachingGroupMemberRow(
                    members[i],
                    group.groupId
                );
            }
            html += '</div>';
        }

        // ---- Sessions ----
        html += renderTeachingGroupSessionsList(group);

        html += '</div>';
        return html;
    }

    function renderTeachingGroupMemberRow(member, groupId) {
        if (!member || !member.id) { return ''; }

        var html = '';
        html += '<div class="academy-teaching-group-roster-row" ' +
                    'data-character-id="' +
                        escapeAttribute(member.id) + '">';

        html += '<span class="academy-teaching-group-roster-name">' +
                    escapeHtml(member.name) +
                '</span>';

        if (isNonEmptyString(member.status)) {
            html += '<span class="academy-teaching-group-roster-status">' +
                        escapeHtml(member.status) +
                    '</span>';
        }

        html += '<button type="button" class="small danger" ' +
                    'data-action="teaching-groups-remove-student" ' +
                    'data-group-id="' +
                        escapeAttribute(groupId) + '" ' +
                    'data-character-id="' +
                        escapeAttribute(member.id) + '">' +
                    'Remove' +
                '</button>';

        html += '</div>';
        return html;
    }

    function renderCandidatePicker(group, charId, pickerCandidates) {
        var candidates = Array.isArray(pickerCandidates)
            ? pickerCandidates
            : null;

        var html = '';
        html += '<div class="academy-teaching-group-candidate-picker" ' +
                    'data-group-id="' +
                        escapeAttribute(group.groupId) + '">';

        if (candidates === null) {
            html += '<p class="empty-state small">' +
                        'Loading candidates...' +
                    '</p>';
        } else if (candidates.length === 0) {
            html += '<p class="empty-state small">' +
                        'No eligible students. Every enrolled student ' +
                        'is either already in a group for this ' +
                        'discipline, or unavailable this week.' +
                    '</p>';
        } else {
            html += '<label class="academy-teaching-group-candidate-label">' +
                        'Add student' +
                    '</label>';
            html += '<select class="academy-teaching-group-candidate-select">';
            html += '<option value="">Select a student...</option>';
            for (var i = 0; i < candidates.length; i++) {
                var c = candidates[i];
                if (!c || !c.id) { continue; }
                html += '<option value="' +
                            escapeAttribute(c.id) + '">' +
                            escapeHtml(c.name) +
                        '</option>';
            }
            html += '</select>';

            html += '<div class="academy-teaching-group-candidate-actions">';
            html += '<button type="button" class="small secondary" ' +
                        'data-action="teaching-groups-add-student-cancel" ' +
                        'data-group-id="' +
                            escapeAttribute(group.groupId) + '">' +
                        'Cancel' +
                    '</button>';
            html += '<button type="button" class="small primary" ' +
                        'data-action="teaching-groups-add-student-submit" ' +
                        'data-group-id="' +
                            escapeAttribute(group.groupId) + '">' +
                        'Add' +
                    '</button>';
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // SESSIONS LIST (inside a teaching-group block)
    // ============================================================
    //
    // Rendered below the roster. Each row shows day, start hour,
    // duration, and (optionally) location. Two actions per row:
    // Edit and Delete.
    //
    // There is NO "End" action. The session window is the
    // discipline's window; the editor never surfaces week fields.
    // Delete is the only removal path.

    function renderTeachingGroupSessionsList(group) {
        if (!group || !group.groupId) { return ''; }

        var sessions = Array.isArray(group.sessions)
            ? group.sessions
            : [];

        var html = '';
        html += '<div class="academy-teaching-group-sessions">';

        html += '<div class="academy-teaching-group-sessions-header">';
        html += '<span class="academy-teaching-group-sessions-title">' +
                    'Sessions' +
                '</span>';
        html += '<span class="academy-teaching-group-sessions-count">' +
                    sessions.length +
                '</span>';
        html += '</div>';

        if (sessions.length === 0) {
            html += '<p class="empty-state small ' +
                        'academy-teaching-group-sessions-empty">' +
                        'No sessions scheduled for this group yet.' +
                    '</p>';
        } else {
            html += '<div class="academy-teaching-group-sessions-list">';
            for (var i = 0; i < sessions.length; i++) {
                html += renderTeachingGroupSessionRow(
                    sessions[i],
                    group.groupId
                );
            }
            html += '</div>';
        }

        html += renderTeachingGroupAddSessionButton(group.groupId);

        html += '</div>';
        return html;
    }

    function renderTeachingGroupSessionRow(session, groupId) {
        if (!session || !session.sessionId) { return ''; }

        var dayLabel = isNonEmptyString(session.dayLabel)
            ? session.dayLabel
            : 'Day ?';
        var startLabel = isNonEmptyString(session.startTimeLabel)
            ? session.startTimeLabel
            : '';
        var durationLabel = isNonEmptyString(session.durationLabel)
            ? session.durationLabel
            : '';
        var locationName = isNonEmptyString(session.locationName)
            ? session.locationName
            : '';

        var html = '';
        html += '<div class="academy-teaching-group-session-row" ' +
                    'data-session-id="' +
                        escapeAttribute(session.sessionId) + '" ' +
                    'data-group-id="' +
                        escapeAttribute(groupId) + '">';

        html += '<div class="academy-teaching-group-session-main">';
        html += '<span class="academy-teaching-group-session-time">' +
                    escapeHtml(dayLabel) +
                    (startLabel ? ', ' + escapeHtml(startLabel) : '') +
                '</span>';
        if (durationLabel) {
            html += '<span class="academy-teaching-group-session-duration">' +
                        escapeHtml(durationLabel) +
                    '</span>';
        }
        html += '</div>';

        if (locationName) {
            html += '<div class="academy-teaching-group-session-location">' +
                        escapeHtml(locationName) +
                    '</div>';
        }

        html += '<div class="academy-teaching-group-session-actions">';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="teaching-groups-edit-session" ' +
                    'data-group-id="' +
                        escapeAttribute(groupId) + '" ' +
                    'data-session-id="' +
                        escapeAttribute(session.sessionId) + '">' +
                    'Edit' +
                '</button>';
        html += '<button type="button" class="small danger" ' +
                    'data-action="teaching-groups-delete-session" ' +
                    'data-group-id="' +
                        escapeAttribute(groupId) + '" ' +
                    'data-session-id="' +
                        escapeAttribute(session.sessionId) + '">' +
                    'Delete' +
                '</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderTeachingGroupAddSessionButton(groupId) {
        return (
            '<button type="button" class="small secondary ' +
                'academy-teaching-group-add-session-btn" ' +
                'data-action="teaching-groups-add-session" ' +
                'data-group-id="' +
                    escapeAttribute(groupId) + '">' +
                '+ Add Session' +
            '</button>'
        );
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyCharacterDetail = {
        renderHTML: renderHTML
    };

})();