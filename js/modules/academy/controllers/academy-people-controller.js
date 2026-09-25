/**
 * modules/academy/controllers/academy-people-controller.js
 * Academy People Controller
 *
 * Path: js/modules/academy/controllers/academy-people-controller.js
 *
 * The People feature controller. Owns the People view: its
 * rendering, its event handling, and its sub-editor lifecycle
 * (grades editor, schedule grid, teaching-group candidate picker).
 *
 * DISCIPLINE-HOURS PICKER:
 *   The picker reads two new VM fields from the aggregator:
 *
 *     entry.hasCurrentGroup   true when the student is already a
 *                             member of a group for this
 *                             discipline.
 *     entry.groups[].conflictingGroups
 *                             the list of existing groups of the
 *                             student that collide with this
 *                             candidate, deduped by groupId.
 *
 *   When hasCurrentGroup is true, the picker does NOT list
 *   alternative groups. It shows the current group and a single
 *   "Leave this group" action.
 *
 *   When a candidate is red, the picker lists every conflicting
 *   group the user would need to leave. The user chooses; the
 *   picker does not pre-select.
 *
 *   The "Leave this group" action calls
 *   AcademySchedule.dropStudentFromGroup, which ends ONLY the
 *   membership of the student in the named group. Enrolments and
 *   other groups are untouched. The student remains in the class.
 *
 * TEACHING GROUP BULK ACTIONS:
 *   The group block header carries two bulk actions, in addition
 *   to the existing per-student Remove button in the roster and
 *   the per-session Edit / Delete buttons in the sessions list.
 *
 *     teaching-groups-clear-roster
 *       Remove every member entry from a group. HARD DELETE, same
 *       semantic as the per-student Remove button: the member
 *       records are deleted, no history survives. The group and
 *       its sessions are untouched.
 *
 *       Routes to AcademyTeachingGroups.clearGroupRoster.
 *
 *     teaching-groups-delete-group
 *       Delete the group and every session on it. Members are
 *       removed from the roster as a side effect of the group
 *       record going away. Students enrolled in the discipline
 *       are not affected.
 *
 *       Routes to AcademySchedule.removeTeachingGroup, which owns
 *       the compound operation.
 *
 *   Both are confirmed inline before dispatch. The confirmation
 *   message names the group, and for delete-group names the
 *   session and member counts.
 *
 * CLASS SCHEDULE EXPORT:
 *   The class detail panel action row carries an "Export Schedule"
 *   button, which is only visible when no character is selected
 *   (i.e. when the class detail is showing).
 *
 *     class-export-schedule
 *       Downloads a readable plain-text dump of the class's
 *       schedule for the current display week.
 *
 *       Contents: every teaching session of every group in the
 *       class for that week, plus every instructor commitment
 *       attached to the class for that week.
 *
 *       Routes to ScheduleExport.exportClassScheduleText, which
 *       owns the projection and serialization.
 */

(function() {
    'use strict';

    if (window.__academyPeopleControllerLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var AcademyUI = window.AcademyUI;
    var AcademyAggregator = window.AcademyAggregator;
    var AcademyCharacterDetailAggregator = window.AcademyCharacterDetailAggregator;
    var CharacterCRUD = window.CharacterCRUD;
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;
    var AcademyClasses = window.AcademyClasses;

    var _missing = [];

    if (!AcademyUI ||
        typeof AcademyUI.getSelectedClassId !== 'function' ||
        typeof AcademyUI.getSelectedCharacterId !== 'function' ||
        typeof AcademyUI.getDisplayWeek !== 'function' ||
        typeof AcademyUI.selectClass !== 'function' ||
        typeof AcademyUI.selectCharacter !== 'function' ||
        typeof AcademyUI.getCharacterMode !== 'function' ||
        typeof AcademyUI.getPeopleFilter !== 'function' ||
        typeof AcademyUI.setPeopleFilter !== 'function' ||
        typeof AcademyUI.setPeopleSearch !== 'function') {
        _missing.push('AcademyUI typed API');
    }
    if (!AcademyAggregator ||
        typeof AcademyAggregator.getClassListViewModel !== 'function' ||
        typeof AcademyAggregator.getClassViewModel !== 'function' ||
        typeof AcademyAggregator.getClassStudentsViewModel !== 'function' ||
        typeof AcademyAggregator.getPeopleViewModel !== 'function') {
        _missing.push('AcademyAggregator People VMs');
    }
    if (!AcademyCharacterDetailAggregator ||
        typeof AcademyCharacterDetailAggregator.getViewModel !== 'function' ||
        typeof AcademyCharacterDetailAggregator.getScheduleGridViewModel !== 'function' ||
        typeof AcademyCharacterDetailAggregator.getTeachingGroupCandidateViewModel !== 'function') {
        _missing.push('AcademyCharacterDetailAggregator API');
    }
    if (!CharacterCRUD ||
        typeof CharacterCRUD.setMode !== 'function') {
        _missing.push('CharacterCRUD.setMode');
    }
    if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }
    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        _missing.push('DomUtils.escapeHtml/escapeAttribute');
    }
    if (!AcademyClasses ||
        typeof AcademyClasses.getClassInstructorIds !== 'function') {
        _missing.push('AcademyClasses.getClassInstructorIds');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyPeopleController] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyPeopleControllerLoaded = true;

    // ============================================================
    // OPTIONAL DEPENDENCY ACCESSORS
    // ============================================================

    function getClassDetailModule() { return window.AcademyClassDetail || null; }
    function getCharacterDetailModule() { return window.AcademyCharacterDetail || null; }
    function getGradesEditor() { return window.AcademyGradesEditor || null; }
    function getCalendarRenderer() { return window.CalendarRenderer || null; }
    function getCRUDModals() { return window.AcademyCRUDModals || null; }
    function getDisciplines() { return window.AcademyDisciplines || null; }
    function getEnrolments() { return window.AcademyEnrolments || null; }
    function getAcademyEliminations() { return window.AcademyEliminations || null; }
    function getCharacterQueries() { return window.CharacterQueries || null; }
    function getCharacterClasses() { return window.AcademyClasses || null; }
    function getClassDisciplinesPicker() { return window.AcademyClassDisciplinesPicker || null; }
    function getEnrollmentModal() { return window.AcademyEnrollmentModal || null; }
    function getScheduleAssignModal() { return window.AcademyScheduleAssignModal || null; }
    function getScheduleInstructorModal() { return window.AcademyScheduleInstructorModal || null; }
    function getSessionFormModal() { return window.AcademySessionFormModal || null; }
    function getTeachingGroups() { return window.AcademyTeachingGroups || null; }
    function getTeachingSessions() { return window.AcademyTeachingSessions || null; }
    function getSchedule() { return window.AcademySchedule || null; }
    function getScheduleExport() { return window.ScheduleExport || null; }

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    function escapeHtml(value) { return DomUtils.escapeHtml(value); }
    function escapeAttribute(value) { return DomUtils.escapeAttribute(value); }

    function getDayName(day) {
        var AC = window.CalendarConstants;
        if (AC && typeof AC.getDayName === 'function') {
            try {
                return AC.getDayName(day) || ('Day ' + day);
            } catch (e) {
                return 'Day ' + day;
            }
        }
        return 'Day ' + day;
    }

    function getHourLabel(hour) {
        var AC = window.CalendarConstants;
        if (AC && typeof AC.formatHour === 'function') {
            try {
                var s = AC.formatHour(hour);
                return isNonEmptyString(s) ? s : (hour + ':00');
            } catch (e) {
                return hour + ':00';
            }
        }
        return hour + ':00';
    }

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _host = null;
    var _context = null;

    var _activeCharacterTab = 'main';
    var _lastCharacterIdForTab = null;
    var _searchTimer = null;

    var _openPickerGroupId = null;
    var _pickerCandidates = null;

    var _openDisciplinePicker = null;
    var _currentGridVM = null;

    // ============================================================
    // CONTEXT NORMALISATION
    // ============================================================

    function normaliseContext(rawContext) {
        var ctx = rawContext && typeof rawContext === 'object'
            ? rawContext
            : {};

        var onChange = typeof ctx.onChange === 'function'
            ? ctx.onChange
            : function() {};

        return { onChange: onChange };
    }

    function getContext() {
        if (_context) { return _context; }
        return normaliseContext(null);
    }

    // ============================================================
    // RENDER
    // ============================================================

    function render(host, rawContext) {
        if (!host || typeof host !== 'object') {
            return;
        }

        _host = host;
        _context = normaliseContext(rawContext);

        _openDisciplinePicker = null;
        _currentGridVM = null;

        var classId = AcademyUI.getSelectedClassId();
        var charId = AcademyUI.getSelectedCharacterId();
        var week = AcademyUI.getDisplayWeek();

        var html = '';

        try {
            html += renderTopBar(classId, week);
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] renderTopBar threw:', e
            );
            host.innerHTML =
                '<div class="academy-body academy-body-empty">' +
                    '<p class="empty-state">' +
                        'Failed to render People view.' +
                    '</p>' +
                '</div>';
            return;
        }

        if (!classId) {
            html += '<div class="academy-body academy-body-empty">' +
                        '<p class="empty-state">' +
                            'Select a class to view its members.' +
                        '</p>' +
                    '</div>';

            host.innerHTML = html;
            unmountSubEditors();
            return;
        }

        var classVM = null;
        try {
            classVM = AcademyAggregator.getClassViewModel(classId, week);
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] getClassViewModel threw:', e
            );
        }

        if (!classVM) {
            html += '<div class="academy-body academy-body-empty">' +
                        '<p class="empty-state">Class not found.</p>' +
                    '</div>';
            host.innerHTML = html;
            unmountSubEditors();
            return;
        }

        var peopleVM = null;
        try {
            peopleVM = AcademyAggregator.getPeopleViewModel(classId, {
                filters: AcademyUI.getPeopleFilter(),
                selectedCharacterId: charId,
                week: week
            });
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] getPeopleViewModel threw:', e
            );
            peopleVM = {
                classList: [],
                classId: classId,
                className: classVM.name,
                week: week,
                filters: AcademyUI.getPeopleFilter(),
                people: [],
                totalCount: 0,
                filteredCount: 0
            };
        }

        html += '<div class="academy-body academy-people-layout">';
        html += renderSidebar(peopleVM);
        html += '<div class="academy-people-detail" ' +
                    'id="academy-people-detail">';

        if (charId) {
            resetCharacterTabIfChanged(charId);
            html += renderCharacterDetailContent(classVM, charId);
        } else {
            _lastCharacterIdForTab = null;
            _activeCharacterTab = 'main';
            clearPickerState();
            html += renderClassDetailContent(classVM);
        }

        html += '</div>';
        html += '</div>';

        host.innerHTML = html;

        unmountSubEditors();
        if (charId) {
            if (_activeCharacterTab === 'grades') {
                mountGradesEditorIfPresent(charId, classId, week);
            } else if (_activeCharacterTab === 'schedule') {
                mountScheduleGridIfPresent(charId, classId, week);
            }
        }
    }

    // ============================================================
    // TOP BAR
    // ============================================================

    function renderTopBar(selectedClassId, week) {
        var classes = AcademyAggregator.getClassListViewModel() || [];

        var html = '';
        html += '<div class="academy-top-bar">';

        html += '<div class="academy-top-left">';
        html += '<label class="academy-top-label" ' +
                    'for="academy-class-select">Class:</label>';
        html += '<select id="academy-class-select" ' +
                    'class="academy-class-select">';
        html += '<option value="">Select a class...</option>';
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || !cls.id) { continue; }
            var isSelected = selectedClassId &&
                String(selectedClassId) === String(cls.id);
            html += '<option value="' +
                        DomUtils.escapeAttribute(cls.id) + '"' +
                        (isSelected ? ' selected' : '') + '>' +
                        DomUtils.escapeHtml(cls.name) +
                    '</option>';
        }
        html += '</select>';
        html += '<button type="button" id="academy-add-class-btn" ' +
                    'class="primary small">+ Add Class</button>';
        html += '</div>';

        html += '<div class="academy-top-right">';
        html += '<label class="academy-top-label" ' +
                    'for="academy-week-input">Week:</label>';
        html += '<input type="number" id="academy-week-input" ' +
                    'class="academy-week-input" ' +
                    'value="' +
                        DomUtils.escapeAttribute(String(week)) +
                    '" ' +
                    'min="1" max="52">';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // SIDEBAR
    // ============================================================

    function renderSidebar(vm) {
        var filters = vm.filters || {
            search: '',
            role: 'all',
            status: 'active'
        };

        var html = '<div class="academy-people-sidebar">';

        html += '<div class="academy-character-filters">';

        html += '<input type="text" id="academy-people-search" ' +
                    'class="academy-people-search" ' +
                    'placeholder="Search..." ' +
                    'value="' +
                        DomUtils.escapeAttribute(filters.search || '') +
                    '">';

        html += '<label class="academy-filter-label" ' +
                    'for="academy-people-role">Role:</label>';
        html += '<select id="academy-people-role" ' +
                    'class="academy-people-role">';
        html += '<option value="all"' +
                    (filters.role === 'all' ? ' selected' : '') +
                    '>All</option>';
        html += '<option value="student"' +
                    (filters.role === 'student' ? ' selected' : '') +
                    '>Students</option>';
        html += '<option value="instructor"' +
                    (filters.role === 'instructor' ? ' selected' : '') +
                    '>Instructors</option>';
        html += '</select>';

        html += '<label class="academy-filter-label" ' +
                    'for="academy-people-status">Status:</label>';
        html += '<select id="academy-people-status" ' +
                    'class="academy-people-status">';
        html += '<option value="active"' +
                    (filters.status === 'active' ? ' selected' : '') +
                    '>Active</option>';
        html += '<option value="eliminated"' +
                    (filters.status === 'eliminated' ? ' selected' : '') +
                    '>Eliminated</option>';
        html += '<option value="deceased"' +
                    (filters.status === 'deceased' ? ' selected' : '') +
                    '>Deceased</option>';
        html += '<option value="all"' +
                    (filters.status === 'all' ? ' selected' : '') +
                    '>All</option>';
        html += '</select>';

        html += '</div>';

        html += '<div class="academy-character-list" ' +
                    'id="academy-character-list">';

        var people = vm.people || [];
        if (people.length === 0) {
            html += '<p class="empty-state small">' +
                        'No characters match the current filters.' +
                    '</p>';
        } else {
            for (var i = 0; i < people.length; i++) {
                html += renderPersonRow(people[i]);
            }
        }

        html += '</div>';
        html += '</div>';

        return html;
    }

    function renderPersonRow(person) {
        if (!person || !person.id) { return ''; }

        var classes = 'academy-character-row';
        if (person.isSelected) { classes += ' selected'; }
        if (person.deceased) { classes += ' deceased'; }
        if (person.eliminated) { classes += ' eliminated'; }

        var html = '';
        html += '<div class="' + classes + '" ' +
                    'data-character-id="' +
                        DomUtils.escapeAttribute(person.id) + '" ' +
                    'role="button" tabindex="0">';

        html += '<div class="academy-character-row-main">';
        html += '<span class="academy-character-name">' +
                    DomUtils.escapeHtml(person.name || 'Unknown') +
                '</span>';
        if (person.role === 'instructor') {
            html += '<span class="academy-character-role-badge">' +
                        'Instructor' +
                    '</span>';
        }
        html += '</div>';

        if (person.eliminated) {
            var weekText = (typeof person.eliminationWeek === 'number')
                ? ' (Wk ' + person.eliminationWeek + ')'
                : '';
            html += '<div class="academy-character-row-warning">' +
                        '\u2715 Eliminated' +
                        DomUtils.escapeHtml(weekText) +
                    '</div>';
        }

        if (person.status && !person.eliminated) {
            html += '<div class="academy-character-row-status">' +
                        DomUtils.escapeHtml(person.status) +
                    '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // DETAIL PANELS
    // ============================================================

    function renderClassDetailContent(classVM) {
        var ClassDetail = getClassDetailModule();
        if (ClassDetail && typeof ClassDetail.renderHTML === 'function') {
            try {
                return ClassDetail.renderHTML(classVM);
            } catch (e) {
                console.warn(
                    '[AcademyPeopleController] AcademyClassDetail.' +
                    'renderHTML threw:', e
                );
            }
        }
        return (
            '<div class="academy-detail-placeholder">' +
                '<h3>' +
                    DomUtils.escapeHtml(classVM.name || 'Class') +
                '</h3>' +
                '<p class="empty-state small">' +
                    'Class detail view not available.' +
                '</p>' +
            '</div>'
        );
    }

    function renderCharacterDetailContent(classVM, charId) {
        var classId = classVM ? classVM.id : null;
        var week = AcademyUI.getDisplayWeek();
        var mode = AcademyUI.getCharacterMode(charId);

        var vm = null;
        try {
            vm = AcademyCharacterDetailAggregator.getViewModel(charId, {
                classId: classId,
                week: week,
                mode: mode,
                tab: _activeCharacterTab
            });
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] character detail ' +
                'getViewModel threw:', e
            );
        }

        if (!vm) {
            return '<p class="empty-state">Character not found.</p>';
        }

        vm._openPickerGroupId = _openPickerGroupId;
        vm._pickerCandidates = _pickerCandidates;

        var CharacterDetail = getCharacterDetailModule();
        if (CharacterDetail &&
            typeof CharacterDetail.renderHTML === 'function') {
            try {
                return CharacterDetail.renderHTML(vm);
            } catch (e) {
                console.warn(
                    '[AcademyPeopleController] AcademyCharacterDetail.' +
                    'renderHTML threw:', e
                );
            }
        }

        return (
            '<div class="academy-detail-placeholder">' +
                '<h3>' +
                    DomUtils.escapeHtml(vm.character.name) +
                '</h3>' +
                '<p class="empty-state small">' +
                    'Character detail view not available.' +
                '</p>' +
            '</div>'
        );
    }

    // ============================================================
    // CHARACTER TAB STATE
    // ============================================================

    function resetCharacterTabIfChanged(charId) {
        var normalised = charId ? String(charId) : null;
        if (_lastCharacterIdForTab !== normalised) {
            _lastCharacterIdForTab = normalised;
            _activeCharacterTab = 'main';
            clearPickerState();
        }
    }

    function clearPickerState() {
        _openPickerGroupId = null;
        _pickerCandidates = null;
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    function handleClick(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') {
            return;
        }

        var charRow = target.closest(
            '.academy-character-row, .academy-student-row'
        );
        if (charRow && charRow.dataset && charRow.dataset.characterId) {
            e.preventDefault();
            handleCharacterSelect(charRow.dataset.characterId);
            return;
        }

        if (target.closest('#academy-add-class-btn')) {
            e.preventDefault();
            handleAddClass();
            return;
        }

        var tabBtn = target.closest('.academy-character-tab-btn');
        if (tabBtn && tabBtn.dataset && tabBtn.dataset.tab) {
            e.preventDefault();
            _activeCharacterTab = tabBtn.dataset.tab;
            clearPickerState();
            _openDisciplinePicker = null;
            var ctx = getContext();
            ctx.onChange();
            return;
        }

        // ---- Bulk actions inside the candidate picker ----
        var bulkBtn = target.closest('[data-bulk-action]');
        if (bulkBtn && bulkBtn.dataset) {
            var bulkAction = bulkBtn.dataset.bulkAction;
            var bulkSection = bulkBtn.dataset.section;

            if (bulkAction === 'select-all' ||
                bulkAction === 'clear') {
                e.preventDefault();

                var picker = bulkBtn.closest(
                    '.academy-teaching-group-candidate-picker'
                );
                if (!picker) { return; }

                if (bulkAction === 'select-all') {
                    selectAllVisibleInSection(picker, bulkSection);
                } else {
                    clearSection(picker, bulkSection);
                }

                updateCandidateSelectionState(picker);
                return;
            }
        }

        var actionEl = target.closest('[data-action]');
        if (!actionEl || !actionEl.dataset) { return; }

        var action = actionEl.dataset.action;
        if (!isNonEmptyString(action)) { return; }

        e.preventDefault();
        dispatchAction(action, actionEl);
    }

    function handleChange(e) {
        var target = e.target;
        if (!target) { return; }

        if (target.id === 'academy-character-mode-checkbox') {
            handleCharacterModeToggle(target.checked);
            return;
        }

        if (target.id === 'academy-class-select') {
            handleClassSelect(target.value);
            return;
        }

        if (target.id === 'academy-week-input') {
            commitDisplayWeek(target.value);
            return;
        }

        if (target.id === 'academy-people-role') {
            AcademyUI.setPeopleRole(target.value);
            var ctx = getContext();
            ctx.onChange();
            return;
        }

        if (target.id === 'academy-people-status') {
            AcademyUI.setPeopleStatus(target.value);
            var c = getContext();
            c.onChange();
            return;
        }

        // ---- Candidate picker checkbox ----
        if (target.classList &&
            target.classList.contains(
                'academy-teaching-group-candidate-checkbox'
            )) {
            var picker = target.closest(
                '.academy-teaching-group-candidate-picker'
            );
            if (picker) {
                updateCandidateSelectionState(picker);
            }
            return;
        }
    }

    function handleInput(e) {
        var target = e.target;
        if (!target) { return; }

        if (target.id === 'academy-people-search') {
            debouncePeopleSearch(target.value);
            return;
        }

        if (target.classList &&
            target.classList.contains(
                'academy-teaching-group-candidate-search'
            )) {
            applyCandidateSearchFilter(target);
            return;
        }
    }

    function handleKeydown(e) {
        var target = e.target;
        if (!target || e.key !== 'Enter') { return; }

        if (target.id === 'academy-week-input') {
            e.preventDefault();
            commitDisplayWeek(target.value);
            return;
        }
    }

    // ============================================================
    // ACTION DISPATCH
    // ============================================================

    function dispatchAction(action, el) {
        switch (action) {
            case 'drop-out-character':
                handleDropOut(el.dataset.characterId);
                return;
            case 'character-remove-from-class':
                handleRemoveFromClass(
                    el.dataset.characterId,
                    el.dataset.classId
                );
                return;
            case 'enroll-discipline':
                handleEnrollDiscipline(el.dataset.characterId);
                return;
            case 'leave-discipline':
                handleLeaveDiscipline(
                    el.dataset.characterId,
                    el.dataset.disciplineId
                );
                return;

            case 'edit-social-score':
                handleEditSocialScore(el.dataset.characterId);
                return;

            case 'edit-class-add-character':
                handleClassAction('add-character', el.dataset.classId);
                return;
            case 'edit-class-disciplines':
                handleClassAction('disciplines', el.dataset.classId);
                return;
            case 'edit-class':
                handleClassAction('edit-class', el.dataset.classId);
                return;
            case 'delete-class':
                handleClassAction('delete-class', el.dataset.classId);
                return;

            case 'class-export-schedule':
                handleExportClassSchedule(el);
                return;

            case 'schedule-assign':
                handleScheduleAssign(el.dataset.day, el.dataset.hour);
                return;

            case 'schedule-assign-instructor':
                handleScheduleInstructorAssign(
                    el.dataset.day,
                    el.dataset.hour
                );
                return;

            case 'schedule-slot-open':
                handleScheduleSlotOpen(el);
                return;

            case 'schedule-co-occupants-open':
                return;
            case 'schedule-co-occupants-close':
                return;

            case 'schedule-discipline-picker-open':
                handleDisciplinePickerOpen(el.dataset.disciplineId);
                return;
            case 'schedule-discipline-picker-close':
                handleDisciplinePickerClose();
                return;
            case 'schedule-discipline-picker-add':
                handleDisciplinePickerAdd(el.dataset.groupId);
                return;
            case 'schedule-discipline-picker-leave':
                handleDisciplinePickerLeave(el.dataset.groupId);
                return;

            case 'teaching-groups-toggle-discipline':
                handleToggleTeachingGroupDiscipline(
                    el.dataset.disciplineId
                );
                return;
            case 'teaching-groups-create-group':
                handleCreateTeachingGroup(el);
                return;
            case 'teaching-groups-add-student':
                handleOpenTeachingGroupPicker(el.dataset.groupId);
                return;
            case 'teaching-groups-add-student-cancel':
                handleCloseTeachingGroupPicker();
                return;
            case 'teaching-groups-add-student-submit':
                handleSubmitTeachingGroupAdd(el.dataset.groupId);
                return;
            case 'teaching-groups-remove-student':
                handleRemoveTeachingGroupStudent(
                    el.dataset.groupId,
                    el.dataset.characterId
                );
                return;

            case 'teaching-groups-clear-roster':
                handleClearTeachingGroupRoster(el.dataset.groupId);
                return;
            case 'teaching-groups-delete-group':
                handleDeleteTeachingGroup(
                    el.dataset.groupId,
                    el.dataset.classId
                );
                return;

            case 'teaching-groups-add-session':
                handleAddTeachingGroupSession(el.dataset.groupId);
                return;
            case 'teaching-groups-edit-session':
                handleEditTeachingGroupSession(
                    el.dataset.groupId,
                    el.dataset.sessionId
                );
                return;
            case 'teaching-groups-delete-session':
                handleDeleteTeachingGroupSession(
                    el.dataset.groupId,
                    el.dataset.sessionId
                );
                return;

            default:
                return;
        }
    }

    // ============================================================
    // CLASS SELECTION
    // ============================================================

    function handleClassSelect(classId) {
        if (!classId) {
            AcademyUI.selectClass(null);
            var ctx = getContext();
            ctx.onChange();
            return;
        }

        var prevCharId = AcademyUI.getSelectedCharacterId();
        AcademyUI.selectClass(classId);

        if (prevCharId) {
            var week = AcademyUI.getDisplayWeek();
            var classVM = AcademyAggregator.getClassViewModel(
                classId, week
            );
            if (classVM && isCharacterInClassVM(prevCharId, classVM)) {
                AcademyUI.selectCharacter(prevCharId);
            }
        }

        var c = getContext();
        c.onChange();
    }

    function isCharacterInClassVM(charId, classVM) {
        if (!charId || !classVM || !classVM.id) { return false; }
        var target = String(charId);

        var week = AcademyUI.getDisplayWeek();
        var instructorIds = [];
        try {
            instructorIds = AcademyClasses.getClassInstructorIds(
                classVM.id, week
            );
        } catch (e) {
            instructorIds = [];
        }
        if (Array.isArray(instructorIds)) {
            for (var ii = 0; ii < instructorIds.length; ii++) {
                if (String(instructorIds[ii]) === target) {
                    return true;
                }
            }
        }

        var students = AcademyAggregator.getClassStudentsViewModel(
            classVM.id,
            week
        ) || [];
        for (var i = 0; i < students.length; i++) {
            if (students[i] && String(students[i].id) === target) {
                return true;
            }
        }

        return false;
    }

    function handleCharacterSelect(charId) {
        if (!charId) { return; }
        var current = AcademyUI.getSelectedCharacterId();
        if (current && String(current) === String(charId)) {
            AcademyUI.selectCharacter(null);
        } else {
            AcademyUI.selectCharacter(charId);
        }
        var ctx = getContext();
        ctx.onChange();
    }

    function handleAddClass() {
        var CRUD = getCRUDModals();
        if (CRUD && typeof CRUD.openClassForm === 'function') {
            CRUD.openClassForm(null);
        } else {
            notify('CRUD module not available.', 'error');
        }
    }

    function handleClassAction(action, classId) {
        switch (action) {
            case 'disciplines':
                handleOpenDisciplinesPicker(classId);
                return;
            default:
                break;
        }

        var CRUD = getCRUDModals();
        if (!CRUD) {
            notify('CRUD module not available.', 'error');
            return;
        }
        switch (action) {
            case 'add-character':
                if (typeof CRUD.openAddCharacterToClass === 'function') {
                    CRUD.openAddCharacterToClass(classId);
                }
                return;
            case 'edit-class':
                if (typeof CRUD.openClassForm === 'function') {
                    CRUD.openClassForm(classId);
                }
                return;
            case 'delete-class':
                if (typeof CRUD.openClassDelete === 'function') {
                    CRUD.openClassDelete(classId);
                }
                return;
            default:
                return;
        }
    }

    function handleOpenDisciplinesPicker(classId) {
        if (!isNonEmptyString(classId)) {
            notify('Class ID is required.', 'error');
            return;
        }

        var Picker = getClassDisciplinesPicker();
        if (!Picker || typeof Picker.openModal !== 'function') {
            notify(
                'Class-disciplines picker is not available.',
                'error'
            );
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        try {
            Picker.openModal(classId, {
                week: week,
                onClose: function() {
                    var ctx = getContext();
                    ctx.onChange();
                }
            });
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] picker openModal threw:', e
            );
            notify('Failed to open the disciplines picker.', 'error');
        }
    }

    // ============================================================
    // CLASS SCHEDULE EXPORT FLOW
    // ============================================================
    //
    // Downloads a readable plain-text dump of the class's schedule
    // for the current display week. The schedule is composed of
    // every teaching session of every group in the class, plus
    // every instructor commitment attached to the class, both
    // filtered to the display week.
    //
    // The button carries data-class-id from the class detail
    // panel's action row. The handler reads it from the button
    // rather than re-reading AcademyUI.getSelectedClassId(), so
    // the button is robust to selection changes between render and
    // click.
    //
    // The export module (window.ScheduleExport) owns the
    // projection and serialization. This handler only resolves the
    // week, dispatches the export, and notifies.

    function handleExportClassSchedule(el) {
        var classId = el && el.dataset ? el.dataset.classId : null;

        if (!isNonEmptyString(classId)) {
            notify('No class selected.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();
        if (!isFiniteNumber(week)) {
            notify('No display week set.', 'error');
            return;
        }

        var Exporter = getScheduleExport();
        if (!Exporter ||
            typeof Exporter.exportClassScheduleText !== 'function') {
            notify('Schedule export module is not loaded.', 'error');
            return;
        }

        var result;
        try {
            result = Exporter.exportClassScheduleText(classId, week);
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] exportClassScheduleText ' +
                'threw:', e
            );
            notify('Schedule export failed.', 'error');
            return;
        }

        if (result && result.exported) {
            notify(
                'Schedule exported: ' + result.filename,
                'success'
            );
            return;
        }

        notify(
            (result && result.error) || 'Schedule export failed.',
            'error'
        );
    }

    // ============================================================
    // WEEK COMMIT
    // ============================================================

    function commitDisplayWeek(value) {
        var accepted = AcademyUI.setDisplayWeek(value);
        if (accepted) {
            var ctx = getContext();
            ctx.onChange();
        }
    }

    // ============================================================
    // CHARACTER MODE
    // ============================================================

    function handleCharacterModeToggle(checked) {
        var charId = AcademyUI.getSelectedCharacterId();
        if (!charId) { return; }

        var newMode = checked ? 'instructor' : 'student';

        if (newMode === 'instructor' &&
            (_activeCharacterTab === 'grades' ||
                _activeCharacterTab === 'teams')) {
            _activeCharacterTab = 'main';
        }
        if (newMode === 'student' &&
            _activeCharacterTab === 'teachingGroups') {
            _activeCharacterTab = 'main';
        }

        clearPickerState();
        _openDisciplinePicker = null;

        CharacterCRUD.setMode(charId, newMode)
            .then(function(result) {
                if (result && result.success) {
                    var ctx = getContext();
                    ctx.onChange();
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyPeopleController] setMode failed:', err
                );
                notify('Failed to change character mode.', 'error');
            });
    }

    // ============================================================
    // CHARACTER FLOWS
    // ============================================================

    function handleDropOut(charId) {
        if (!charId) { return; }

        var CQ = getCharacterQueries();
        if (!CQ) {
            notify('Character queries not available.', 'error');
            return;
        }

        var char = CQ.getCharacterById(charId);
        if (!char) {
            notify('Character not found.', 'error');
            return;
        }

        var name = CQ.getDisplayName(char);
        if (!confirm('Drop out "' + name +
            '" from the Academy? They will remain on the class roster ' +
            'as an eliminated character.')) {
            return;
        }

        var AE = getAcademyEliminations();
        if (!AE || typeof AE.addStandalone !== 'function') {
            notify('Elimination module not available.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();
        AE.addStandalone(charId, week, 'Dropped out').then(function(result) {
            if (result && result.success) {
                var ctx = getContext();
                ctx.onChange();
            }
        }).catch(function(err) {
            console.warn(
                '[AcademyPeopleController] Drop Out failed:', err
            );
            notify('Failed to drop out character.', 'error');
        });
    }

    function handleRemoveFromClass(charId, classId) {
        if (!charId || !classId) { return; }

        var CharacterClasses = getCharacterClasses();
        if (!CharacterClasses ||
            typeof CharacterClasses.removeClassById !== 'function') {
            notify('Character classes module not available.', 'error');
            return;
        }

        var className = 'this class';
        var week = AcademyUI.getDisplayWeek();
        var classVM = AcademyAggregator.getClassViewModel(classId, week);
        if (classVM && classVM.name) {
            className = '"' + classVM.name + '"';
        }

        if (!confirm('Remove this character from ' + className + '?')) {
            return;
        }

        CharacterClasses.removeClassById(charId, classId)
            .then(function(result) {
                if (result && result.success) {
                    var ctx = getContext();
                    ctx.onChange();
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyPeopleController] removeClassById failed:', err
                );
                notify(
                    'Failed to remove character from class.', 'error'
                );
            });
    }

    function handleEditSocialScore(charId) {
        var CRUD = getCRUDModals();
        if (CRUD && typeof CRUD.openSocialScoreForm === 'function') {
            CRUD.openSocialScoreForm(
                charId,
                AcademyUI.getSelectedClassId(),
                AcademyUI.getDisplayWeek()
            );
        }
    }

    // ============================================================
    // DISCIPLINE ENROLMENT FLOWS
    // ============================================================

    function handleEnrollDiscipline(charId) {
        if (!isNonEmptyString(charId)) {
            return;
        }

        var classId = AcademyUI.getSelectedClassId();
        if (!classId) {
            notify(
                'Select a class before enrolling in disciplines.',
                'error'
            );
            return;
        }

        var Modal = getEnrollmentModal();
        if (!Modal || typeof Modal.openModal !== 'function') {
            notify(
                'Enrollment modal is not available.',
                'error'
            );
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        var mode = AcademyUI.getCharacterMode(charId);
        var title = mode === 'instructor'
            ? 'Assign to teach a discipline'
            : null;

        try {
            Modal.openModal(charId, {
                classId: classId,
                week: week,
                title: title,
                onClose: function() {
                    var ctx = getContext();
                    ctx.onChange();
                }
            });
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] enrollment modal ' +
                'openModal threw:', e
            );
            notify('Failed to open the enrollment modal.', 'error');
        }
    }

    function handleLeaveDiscipline(charId, disciplineId) {
        if (!charId || !disciplineId) { return; }

        var classId = AcademyUI.getSelectedClassId();
        if (!classId) {
            notify('No class selected.', 'error');
            return;
        }

        var AE = getEnrolments();
        if (!AE || typeof AE.leave !== 'function') {
            notify('Enrollment module not available.', 'error');
            return;
        }

        var disciplineName = 'this discipline';
        var AD = getDisciplines();
        if (AD && typeof AD.getDiscipline === 'function') {
            var disc = AD.getDiscipline(disciplineId);
            if (disc && disc.name) {
                disciplineName = '"' + disc.name + '"';
            }
        }

        if (!confirm('Leave ' + disciplineName +
            '? You can re-enroll later.')) {
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        AE.leave(charId, classId, disciplineId, week).then(function(result) {
            if (result && result.success) {
                var ctx = getContext();
                ctx.onChange();
            } else if (result && result.message) {
                notify(result.message, 'error');
            }
        }).catch(function(err) {
            console.warn(
                '[AcademyPeopleController] Leave failed:', err
            );
            notify('Failed to leave discipline.', 'error');
        });
    }

    // ============================================================
    // GRADES EDITOR SUB-EDITOR
    // ============================================================

    function mountGradesEditorIfPresent(charId, classId, week) {
        var GE = getGradesEditor();
        if (!GE || typeof GE.mount !== 'function') {
            return;
        }

        var container = document.getElementById(
            'academy-grades-editor-host'
        );
        if (!container) { return; }

        try {
            GE.mount(container, charId, classId, week);
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] mountGradesEditor failed:', e
            );
        }
    }

    function unmountGradesEditor() {
        var GE = getGradesEditor();
        if (GE && typeof GE.unmount === 'function') {
            try {
                GE.unmount();
            } catch (e) {
                // Ignore.
            }
        }
    }

    // ============================================================
    // SCHEDULE GRID SUB-EDITOR
    // ============================================================

    function mountScheduleGridIfPresent(charId, classId, week) {
        var host = document.getElementById('academy-schedule-host');
        if (!host) { return; }

        var Renderer = getCalendarRenderer();
        if (!Renderer || typeof Renderer.renderGrid !== 'function') {
            host.innerHTML = '<p class="empty-state small">' +
                'Calendar renderer not available.' +
                '</p>';
            return;
        }

        var mode = AcademyUI.getCharacterMode(charId);

        var gridVM = null;
        if (typeof AcademyCharacterDetailAggregator
                .getScheduleGridViewModel === 'function') {
            try {
                gridVM = AcademyCharacterDetailAggregator
                    .getScheduleGridViewModel(charId, {
                        week: week,
                        mode: mode,
                        classId: classId
                    });
            } catch (e) {
                console.warn(
                    '[AcademyPeopleController] ' +
                    'getScheduleGridViewModel threw:', e
                );
            }
        }

        if (!gridVM) {
            host.innerHTML = '<p class="empty-state small">' +
                'Schedule data not available.' +
                '</p>';
            return;
        }

        _currentGridVM = gridVM;

        var renderState = {
            selectedId: charId,
            week: week
        };

        var renderVM = {
            mode: gridVM.mode,
            canEdit: gridVM.canEdit,
            canEditInstructorSlot: gridVM.canEditInstructorSlot,
            schedule: gridVM.schedule,
            restDays: gridVM.restDays,
            entityName: gridVM.entityName,
            modeLabel: gridVM.modeLabel,
            showEmptySlots: false,
            showRestDays: true,
            hours: gridVM.hours,
            disciplineHours: gridVM.disciplineHours
        };

        try {
            host.innerHTML = Renderer.renderGrid(renderState, renderVM);
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] renderGrid failed:', e
            );
            host.innerHTML = '<p class="empty-state small">' +
                'Failed to render schedule grid.' +
                '</p>';
            return;
        }

        if (_openDisciplinePicker) {
            mountDisciplinePickerPanel();
        }
    }

    function unmountScheduleGrid() {
        var host = document.getElementById('academy-schedule-host');
        if (host) {
            host.innerHTML = '';
        }
    }

    function unmountSubEditors() {
        unmountGradesEditor();
        unmountScheduleGrid();
    }

    // ============================================================
    // SCHEDULE ASSIGN FLOW (student mode)
    // ============================================================

    function handleScheduleAssign(dayRaw, hourRaw) {
        var charId = AcademyUI.getSelectedCharacterId();
        if (!isNonEmptyString(charId)) {
            notify('No character selected.', 'error');
            return;
        }

        var classId = AcademyUI.getSelectedClassId();
        if (!isNonEmptyString(classId)) {
            notify(
                'Select a class before assigning a slot.',
                'error'
            );
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        var day = parseInt(dayRaw, 10);
        if (isNaN(day)) {
            notify('Invalid day.', 'error');
            return;
        }

        var hour = parseInt(hourRaw, 10);
        if (isNaN(hour)) {
            notify('Invalid hour.', 'error');
            return;
        }

        var Modal = getScheduleAssignModal();
        if (!Modal || typeof Modal.openModal !== 'function') {
            notify(
                'Schedule assign modal is not available.',
                'error'
            );
            return;
        }

        try {
            Modal.openModal({
                charId: String(charId),
                classId: String(classId),
                week: week,
                day: day,
                startHour: hour,
                onClose: function() {
                    var ctx = getContext();
                    ctx.onChange();
                }
            });
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] schedule assign modal ' +
                'openModal threw:', e
            );
            notify('Failed to open the assign modal.', 'error');
        }
    }

    // ============================================================
    // SCHEDULE ASSIGN-INSTRUCTOR FLOW
    // ============================================================

    function handleScheduleInstructorAssign(dayRaw, hourRaw) {
        var charId = AcademyUI.getSelectedCharacterId();
        if (!isNonEmptyString(charId)) {
            notify('No character selected.', 'error');
            return;
        }

        var classId = AcademyUI.getSelectedClassId();
        if (!isNonEmptyString(classId)) {
            notify(
                'Select a class before adding a slot.',
                'error'
            );
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        var day = parseInt(dayRaw, 10);
        if (isNaN(day)) {
            notify('Invalid day.', 'error');
            return;
        }

        var hour = parseInt(hourRaw, 10);
        if (isNaN(hour)) {
            notify('Invalid hour.', 'error');
            return;
        }

        var Modal = getScheduleInstructorModal();
        if (!Modal || typeof Modal.openModal !== 'function') {
            notify(
                'Instructor schedule modal is not available.',
                'error'
            );
            return;
        }

        try {
            Modal.openModal({
                instructorId: String(charId),
                classId: String(classId),
                week: week,
                day: day,
                startHour: hour,
                onClose: function() {
                    var ctx = getContext();
                    ctx.onChange();
                }
            });
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] instructor schedule ' +
                'modal openModal threw:', e
            );
            notify(
                'Failed to open the instructor slot modal.',
                'error'
            );
        }
    }

    // ============================================================
    // SCHEDULE SLOT OPEN FLOW
    // ============================================================

    function handleScheduleSlotOpen(el) {
        if (!el || !el.dataset) { return; }

        var classId = AcademyUI.getSelectedClassId();
        if (!isNonEmptyString(classId)) {
            notify(
                'Select a class before editing a slot.',
                'error'
            );
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        var day = parseInt(el.dataset.day, 10);
        if (isNaN(day)) {
            notify('Invalid day.', 'error');
            return;
        }

        var hour = parseInt(el.dataset.hour, 10);
        if (isNaN(hour)) {
            notify('Invalid hour.', 'error');
            return;
        }

        var mode = isNonEmptyString(el.dataset.mode)
            ? String(el.dataset.mode)
            : 'remove-student';

        var groupId = isNonEmptyString(el.dataset.groupId)
            ? String(el.dataset.groupId)
            : null;

        var sessionId = isNonEmptyString(el.dataset.sessionId)
            ? String(el.dataset.sessionId)
            : null;

        if (!groupId) {
            notify(
                'Cannot open this slot: group ID is missing.',
                'error'
            );
            return;
        }

        var charId = AcademyUI.getSelectedCharacterId();
        if (mode === 'remove-student' && !isNonEmptyString(charId)) {
            notify('No character selected.', 'error');
            return;
        }

        var disciplineName = '';
        var duration = null;
        var memberCount = null;
        var sessionCount = null;

        var TG = getTeachingGroups();
        if (TG && typeof TG.getGroup === 'function') {
            var group = null;
            try {
                group = TG.getGroup(groupId);
            } catch (e) {
                group = null;
            }

            if (group) {
                var AD = getDisciplines();
                if (AD && typeof AD.getDiscipline === 'function') {
                    var disc = AD.getDiscipline(group.disciplineId);
                    if (disc && isNonEmptyString(disc.name)) {
                        disciplineName = disc.name;
                    }
                }

                if (typeof TG.getActiveMembers === 'function') {
                    try {
                        var members = TG.getActiveMembers(groupId, week);
                        if (Array.isArray(members)) {
                            memberCount = members.length;
                        }
                    } catch (e) {
                        memberCount = null;
                    }
                }
            }
        }

        var TS = getTeachingSessions();
        if (TS && groupId) {
            var sessions = [];
            if (typeof TS.getSessionsForGroup === 'function') {
                try {
                    sessions = TS.getSessionsForGroup(groupId) || [];
                } catch (e) {
                    sessions = [];
                }
            }

            if (Array.isArray(sessions)) {
                sessionCount = sessions.length;

                var targetSession = null;
                for (var i = 0; i < sessions.length; i++) {
                    var s = sessions[i];
                    if (!s) { continue; }
                    if (sessionId && String(s.id) === sessionId) {
                        targetSession = s;
                        break;
                    }
                    if (!targetSession &&
                        s.day === day &&
                        s.startTime === hour) {
                        targetSession = s;
                    }
                }

                if (targetSession &&
                    typeof targetSession.duration === 'number') {
                    duration = targetSession.duration;
                }
            }
        }

        var Modal = getScheduleAssignModal();
        if (!Modal || typeof Modal.openModal !== 'function') {
            notify(
                'Schedule assign modal is not available.',
                'error'
            );
            return;
        }

        try {
            Modal.openModal({
                mode: mode,
                charId: mode === 'remove-student' ? String(charId) : null,
                classId: String(classId),
                week: week,
                day: day,
                startHour: hour,
                groupId: groupId,
                sessionId: sessionId,
                disciplineName: disciplineName,
                duration: duration,
                memberCount: memberCount,
                sessionCount: sessionCount,
                onClose: function() {
                    var ctx = getContext();
                    ctx.onChange();
                }
            });
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] schedule slot-open modal ' +
                'openModal threw:', e
            );
            notify('Failed to open the slot editor.', 'error');
        }
    }

    // ============================================================
    // DISCIPLINE-HOURS PICKER FLOW
    // ============================================================

    function handleDisciplinePickerOpen(disciplineId) {
        if (!isNonEmptyString(disciplineId)) { return; }

        if (_openDisciplinePicker &&
            _openDisciplinePicker.disciplineId === String(disciplineId)) {
            handleDisciplinePickerClose();
            return;
        }

        _openDisciplinePicker = { disciplineId: String(disciplineId) };
        mountDisciplinePickerPanel();
    }

    function handleDisciplinePickerClose() {
        _openDisciplinePicker = null;
        var host = document.getElementById(
            'academy-schedule-discipline-picker-host'
        );
        if (host) { host.innerHTML = ''; }
    }

    function mountDisciplinePickerPanel() {
        var host = document.getElementById(
            'academy-schedule-discipline-picker-host'
        );
        if (!host) { return; }

        if (!_openDisciplinePicker) {
            host.innerHTML = '';
            return;
        }

        if (!_currentGridVM || !Array.isArray(_currentGridVM.disciplineHours)) {
            host.innerHTML = '';
            return;
        }

        var entry = null;
        for (var i = 0; i < _currentGridVM.disciplineHours.length; i++) {
            var candidate = _currentGridVM.disciplineHours[i];
            if (candidate &&
                String(candidate.disciplineId) ===
                _openDisciplinePicker.disciplineId) {
                entry = candidate;
                break;
            }
        }

        if (!entry) {
            host.innerHTML = '';
            _openDisciplinePicker = null;
            return;
        }

        host.innerHTML = buildDisciplinePickerHTML(entry);
    }

    function buildDisciplinePickerHTML(entry) {
        var disciplineName = isNonEmptyString(entry.disciplineName)
            ? entry.disciplineName
            : 'Unknown Discipline';

        var html = '';
        html += '<div class="schedule-discipline-picker">';

        html += '<div class="schedule-discipline-picker-header">';
        html += '<span class="schedule-discipline-picker-title">' +
                    escapeHtml(disciplineName) +
                '</span>';

        if (entry.hasCurrentGroup === true) {
            html += '<span class="schedule-discipline-picker-hint">' +
                        'You are in a group for this discipline.' +
                    '</span>';
        } else {
            html += '<span class="schedule-discipline-picker-hint">' +
                        'Click a green group to add the student.' +
                    '</span>';
        }

        html += '<button type="button" ' +
                    'class="schedule-discipline-picker-close" ' +
                    'data-action="schedule-discipline-picker-close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        if (entry.hasCurrentGroup === true) {
            html += renderCurrentGroupPanel(entry.currentGroup);
            html += '</div>';
            return html;
        }

        var groups = Array.isArray(entry.groups) ? entry.groups : [];

        if (groups.length === 0) {
            html += '<p class="empty-state small ' +
                        'schedule-discipline-picker-empty">' +
                        'No groups exist for this discipline yet. ' +
                        'Groups are created by the instructor from ' +
                        'their own schedule grid.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<ul class="schedule-discipline-picker-list">';
        for (var i = 0; i < groups.length; i++) {
            html += renderDisciplinePickerGroupRow(groups[i]);
        }
        html += '</ul>';

        html += '</div>';
        return html;
    }

    function renderCurrentGroupPanel(currentGroup) {
        if (!currentGroup || !currentGroup.groupId) {
            return (
                '<p class="empty-state small">' +
                    'Current group information is not available.' +
                '</p>'
            );
        }

        var displayName = isNonEmptyString(currentGroup.displayName)
            ? currentGroup.displayName
            : 'Unnamed Group';

        var html = '';
        html += '<div class="schedule-discipline-picker-current">';

        html += '<div class="schedule-discipline-picker-current-main">';
        html += '<span class="schedule-discipline-picker-current-name">' +
                    escapeHtml(displayName) +
                '</span>';
        if (isNonEmptyString(currentGroup.instructorName)) {
            html += '<span class="schedule-discipline-picker-current-instructor">' +
                        escapeHtml(currentGroup.instructorName) +
                    '</span>';
        }
        if (isFiniteNumber(currentGroup.classmateCount)) {
            html += '<span class="schedule-discipline-picker-current-classmates">' +
                        currentGroup.classmateCount + ' classmate' +
                        (currentGroup.classmateCount === 1 ? '' : 's') +
                    '</span>';
        }
        html += '</div>';

        html += '<div class="schedule-discipline-picker-current-actions">';
        html += '<button type="button" class="small danger" ' +
                    'data-action="schedule-discipline-picker-leave" ' +
                    'data-group-id="' +
                        escapeAttribute(currentGroup.groupId) + '">' +
                    'Leave this group' +
                '</button>';
        html += '</div>';

        html += '<p class="field-hint schedule-discipline-picker-current-hint">' +
                    'Leaving this group frees the slot. You stay ' +
                    'enrolled in the discipline. Reopen the picker ' +
                    'afterwards to choose another group.' +
                '</p>';

        html += '</div>';
        return html;
    }

    function renderDisciplinePickerGroupRow(group) {
        if (!group || !group.groupId) { return ''; }

        var isGreen = group.status === 'green';
        var isRed = group.status === 'red';

        var rowClass = 'schedule-discipline-picker-row';
        if (isGreen) { rowClass += ' schedule-discipline-picker-row-green'; }
        if (isRed) { rowClass += ' schedule-discipline-picker-row-red'; }

        var displayName = isNonEmptyString(group.displayName)
            ? group.displayName
            : 'Unnamed Group';

        var html = '';
        html += '<li class="' + rowClass + '">';

        if (isGreen) {
            html += '<button type="button" ' +
                        'class="schedule-discipline-picker-row-btn" ' +
                        'data-action="schedule-discipline-picker-add" ' +
                        'data-group-id="' +
                            escapeAttribute(group.groupId) + '">';
        } else {
            html += '<div class="schedule-discipline-picker-row-btn" ' +
                        'aria-disabled="true">';
        }

        html += '<div class="schedule-discipline-picker-row-main">';
        html += '<span class="schedule-discipline-picker-group-name">' +
                    escapeHtml(displayName) +
                '</span>';
        if (isNonEmptyString(group.instructorName)) {
            html += '<span class="schedule-discipline-picker-instructor">' +
                        escapeHtml(group.instructorName) +
                    '</span>';
        }
        if (isFiniteNumber(group.memberCount)) {
            html += '<span class="schedule-discipline-picker-members">' +
                        group.memberCount + ' member' +
                        (group.memberCount === 1 ? '' : 's') +
                    '</span>';
        }
        html += '</div>';

        if (Array.isArray(group.sessions) && group.sessions.length > 0) {
            html += '<ul class="schedule-discipline-picker-sessions">';
            for (var s = 0; s < group.sessions.length; s++) {
                html += renderDisciplinePickerSessionRow(
                    group.sessions[s],
                    group
                );
            }
            html += '</ul>';
        }

        var conflicts = Array.isArray(group.conflictingGroups)
            ? group.conflictingGroups
            : [];

        if (isRed && conflicts.length > 0) {
            html += renderConflictingGroupsList(conflicts);
        } else if (isRed) {
            html += '<div class="schedule-discipline-picker-conflict">' +
                        'Conflicts with an existing session.' +
                    '</div>';
        }

        if (isGreen) {
            html += '</button>';
        } else {
            html += '</div>';
        }

        html += '</li>';
        return html;
    }

    function renderConflictingGroupsList(conflicts) {
        var html = '';
        html += '<div class="schedule-discipline-picker-conflicts">';
        html += '<div class="schedule-discipline-picker-conflicts-title">' +
                    'Would conflict with:' +
                '</div>';
        html += '<ul class="schedule-discipline-picker-conflicts-list">';

        for (var i = 0; i < conflicts.length; i++) {
            var c = conflicts[i];
            if (!c) { continue; }

            var name = isNonEmptyString(c.conflictingDisciplineName)
                ? c.conflictingDisciplineName
                : 'a scheduled session';

            var when = '';
            if (isFiniteNumber(c.conflictDay)) {
                when += getDayName(c.conflictDay);
                if (isFiniteNumber(c.conflictStartTime)) {
                    when += ' at ' + getHourLabel(c.conflictStartTime);
                }
            }

            html += '<li class="schedule-discipline-picker-conflicts-item">';
            html += '<span class="schedule-discipline-picker-conflicts-discipline">' +
                        escapeHtml(name) +
                    '</span>';
            if (when !== '') {
                html += '<span class="schedule-discipline-picker-conflicts-when">' +
                            escapeHtml(when) +
                        '</span>';
            }
            html += '</li>';
        }

        html += '</ul>';
        html += '<p class="schedule-discipline-picker-conflicts-hint">' +
                    'Leave the conflicting group from its own ' +
                    'discipline row, then come back here.' +
                '</p>';
        html += '</div>';
        return html;
    }

    function renderDisciplinePickerSessionRow(session, group) {
        if (!session) { return ''; }

        var dayLabel = isNonEmptyString(session.dayLabel)
            ? session.dayLabel
            : '?';
        var startLabel = isNonEmptyString(session.startTimeLabel)
            ? session.startTimeLabel
            : '';
        var durationLabel = isNonEmptyString(session.durationLabel)
            ? session.durationLabel
            : '';

        var isConflictSource = false;
        if (group && group.status === 'red' &&
            Array.isArray(group.conflictingGroups)) {
            for (var i = 0; i < group.conflictingGroups.length; i++) {
                var c = group.conflictingGroups[i];
                if (c && String(c.detectedSessionId) ===
                    String(session.sessionId)) {
                    isConflictSource = true;
                    break;
                }
            }
        }

        var rowClass = 'schedule-discipline-picker-session';
        if (isConflictSource) {
            rowClass += ' schedule-discipline-picker-session-conflict';
        }

        var html = '';
        html += '<li class="' + rowClass + '">';

        html += '<span class="schedule-discipline-picker-session-time">' +
                    escapeHtml(dayLabel) +
                    (startLabel ? ', ' + escapeHtml(startLabel) : '') +
                '</span>';

        if (durationLabel) {
            html += '<span class="schedule-discipline-picker-session-duration">' +
                        escapeHtml(durationLabel) +
                    '</span>';
        }

        if (isNonEmptyString(session.locationName)) {
            html += '<span class="schedule-discipline-picker-session-location">' +
                        escapeHtml(session.locationName) +
                    '</span>';
        }

        html += '</li>';
        return html;
    }

    function handleDisciplinePickerAdd(groupId) {
        if (!isNonEmptyString(groupId)) { return; }

        var charId = AcademyUI.getSelectedCharacterId();
        if (!isNonEmptyString(charId)) {
            notify('No character selected.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        var Schedule = getSchedule();
        if (!Schedule ||
            typeof Schedule.addStudentToTeachingGroup !== 'function') {
            notify('Schedule module not available.', 'error');
            return;
        }

        Schedule.addStudentToTeachingGroup(groupId, charId, week)
            .then(function(result) {
                if (result && result.success) {
                    _openDisciplinePicker = null;
                    notify('Student added to group.', 'success');
                    var ctx = getContext();
                    ctx.onChange();
                    return;
                }

                if (result && result.message) {
                    notify(result.message, 'error');
                } else {
                    notify('Could not add the student to this group.', 'error');
                }

                _openDisciplinePicker = null;
                var c = getContext();
                c.onChange();
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyPeopleController] ' +
                    'addStudentToTeachingGroup failed:', err
                );
                notify('Failed to add student to group.', 'error');
            });
    }

    function handleDisciplinePickerLeave(groupId) {
        if (!isNonEmptyString(groupId)) { return; }

        var charId = AcademyUI.getSelectedCharacterId();
        if (!isNonEmptyString(charId)) {
            notify('No character selected.', 'error');
            return;
        }

        var classId = AcademyUI.getSelectedClassId();
        if (!isNonEmptyString(classId)) {
            notify('No class selected.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        if (!confirm('Leave this group? The slot will be freed.')) {
            return;
        }

        var Schedule = getSchedule();
        if (!Schedule ||
            typeof Schedule.dropStudentFromGroup !== 'function') {
            notify('Schedule module not available.', 'error');
            return;
        }

        Schedule.dropStudentFromGroup(classId, groupId, charId, week)
            .then(function(result) {
                if (result && result.success) {
                    _openDisciplinePicker = null;
                    notify('Left the group.', 'success');
                    var ctx = getContext();
                    ctx.onChange();
                    return;
                }
                if (result && result.message) {
                    notify(result.message, 'error');
                } else {
                    notify('Could not leave the group.', 'error');
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyPeopleController] ' +
                    'dropStudentFromGroup failed:', err
                );
                notify('Failed to leave the group.', 'error');
            });
    }

    // ============================================================
    // TEACHING GROUPS — ROSTER FLOW
    // ============================================================

    function handleToggleTeachingGroupDiscipline(disciplineId) {
        if (!isNonEmptyString(disciplineId)) { return; }

        var charId = AcademyUI.getSelectedCharacterId();
        if (!isNonEmptyString(charId)) { return; }

        if (typeof AcademyUI.toggleExpanded !== 'function') {
            return;
        }

        var key = 'teachingGroup:' + String(charId) + ':' +
            String(disciplineId);
        AcademyUI.toggleExpanded(key);

        var ctx = getContext();
        ctx.onChange();
    }

    function handleCreateTeachingGroup(el) {
        if (!el || !el.dataset) { return; }

        var classId = isNonEmptyString(el.dataset.classId)
            ? String(el.dataset.classId)
            : null;
        var disciplineId = isNonEmptyString(el.dataset.disciplineId)
            ? String(el.dataset.disciplineId)
            : null;
        var characterId = isNonEmptyString(el.dataset.characterId)
            ? String(el.dataset.characterId)
            : null;
        var weekRaw = el.dataset.week;
        var week = parseInt(weekRaw, 10);

        if (!classId) {
            notify('Class ID is required.', 'error');
            return;
        }
        if (!disciplineId) {
            notify('Discipline ID is required.', 'error');
            return;
        }
        if (!characterId) {
            notify('Instructor ID is required.', 'error');
            return;
        }
        if (isNaN(week)) {
            notify('Valid week is required.', 'error');
            return;
        }

        var Schedule = getSchedule();
        if (!Schedule ||
            typeof Schedule.createTeachingGroup !== 'function') {
            notify(
                'Schedule module does not support group creation.',
                'error'
            );
            return;
        }

        var disciplineName = '';
        var AD = getDisciplines();
        if (AD && typeof AD.getDiscipline === 'function') {
            var disc = AD.getDiscipline(disciplineId);
            if (disc && isNonEmptyString(disc.name)) {
                disciplineName = disc.name;
            }
        }

        var label = disciplineName || 'this discipline';

        if (!confirm(
            'Create a new teaching group for ' + label + '?\n\n' +
            'The group starts empty. Add sessions and students to ' +
            'it from the group block below.'
        )) {
            return;
        }

        Schedule.createTeachingGroup({
            classId: classId,
            disciplineId: disciplineId,
            instructorId: characterId,
            week: week
        }).then(function(result) {
            if (result && result.success) {
                notify('Teaching group created.', 'success');
                var ctx = getContext();
                ctx.onChange();
                return;
            }
            if (result && result.message) {
                notify(result.message, 'error');
            } else {
                notify('Failed to create teaching group.', 'error');
            }
        }).catch(function(err) {
            console.warn(
                '[AcademyPeopleController] createTeachingGroup ' +
                'failed:', err
            );
            notify('Failed to create teaching group.', 'error');
        });
    }

    function handleOpenTeachingGroupPicker(groupId) {
        if (!isNonEmptyString(groupId)) { return; }

        var charId = AcademyUI.getSelectedCharacterId();
        if (!isNonEmptyString(charId)) {
            notify('No character selected.', 'error');
            return;
        }

        var week = AcademyUI.getDisplayWeek();

        var vm = null;
        try {
            vm = AcademyCharacterDetailAggregator                .getTeachingGroupCandidateViewModel(charId, groupId, {
                    week: week
                });
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] ' +
                'getTeachingGroupCandidateViewModel threw:', e
            );
            vm = null;
        }

        if (!vm) {
            notify('Could not open the candidate list.', 'error');
            return;
        }

        _openPickerGroupId = String(groupId);
        _pickerCandidates = {
            candidates: Array.isArray(vm.candidates)
                ? vm.candidates
                : [],
            blocked: Array.isArray(vm.blocked)
                ? vm.blocked
                : []
        };

        var ctx = getContext();
        ctx.onChange();
    }

    function handleCloseTeachingGroupPicker() {
        if (_openPickerGroupId === null && _pickerCandidates === null) {
            return;
        }
        clearPickerState();
        var ctx = getContext();
        ctx.onChange();
    }

    function handleSubmitTeachingGroupAdd(groupId) {
        if (!isNonEmptyString(groupId)) { return; }

        var picker = document.querySelector(
            '.academy-teaching-group-candidate-picker' +
            '[data-group-id="' + cssEscape(groupId) + '"]'
        );
        if (!picker) {
            notify('Could not read the selected students.', 'error');
            return;
        }

        var checkedEls = picker.querySelectorAll(
            '.academy-teaching-group-candidate-checkbox:checked'
        );
        var charIds = [];
        for (var i = 0; i < checkedEls.length; i++) {
            var v = checkedEls[i].value;
            if (isNonEmptyString(v)) { charIds.push(String(v)); }
        }

        if (charIds.length === 0) {
            notify('Select at least one student.', 'error');
            return;
        }

        var TG = getTeachingGroups();
        if (!TG || typeof TG.addMemberToGroup !== 'function') {
            notify('Teaching groups module not available.', 'error');
            return;
        }

        var submitBtn = picker.querySelector(
            '[data-action="teaching-groups-add-student-submit"]'
        );
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Adding\u2026';
        }

        var week = AcademyUI.getDisplayWeek();
        var succeeded = 0;
        var failures = [];

        var chain = Promise.resolve();
        charIds.forEach(function (charId) {
            chain = chain.then(function () {
                return TG.addMemberToGroup(groupId, charId, week)
                    .then(function (result) {
                        if (result && result.success) {
                            succeeded++;
                        } else {
                            failures.push({
                                characterId: charId,
                                message: (result && result.message) ||
                                    'Unknown error'
                            });
                        }
                    })
                    .catch(function (err) {
                        failures.push({
                            characterId: charId,
                            message: String(
                                (err && err.message) || err
                            )
                        });
                    });
            });
        });

        chain.then(function () {
            var total = succeeded + failures.length;

            if (failures.length === 0) {
                notify(
                    'Added ' + succeeded + ' student' +
                    (succeeded === 1 ? '' : 's') + ' to the group.',
                    'success'
                );
            } else if (succeeded === 0) {
                notify(
                    'Could not add any of the ' + total +
                    ' selected students. See console for details.',
                    'error'
                );
            } else {
                notify(
                    'Added ' + succeeded + ' of ' + total +
                    ' students. Some failed. See console for details.',
                    'warning'
                );
            }

            for (var f = 0; f < failures.length; f++) {
                console.warn(
                    '[AcademyPeopleController] candidate add failed:',
                    failures[f]
                );
            }

            clearPickerState();
            var ctx = getContext();
            ctx.onChange();
        });
    }

    function handleRemoveTeachingGroupStudent(groupId, charId) {
        if (!isNonEmptyString(groupId) || !isNonEmptyString(charId)) {
            return;
        }

        var TG = getTeachingGroups();
        if (!TG || typeof TG.removeMemberRecord !== 'function') {
            notify('Teaching groups module not available.', 'error');
            return;
        }

        var name = 'this student';
        var CQ = getCharacterQueries();
        if (CQ) {
            var char = CQ.getCharacterById(charId);
            if (char) {
                name = '"' + CQ.getDisplayName(char) + '"';
            }
        }

        if (!confirm(
            'Remove ' + name + ' from this group?\n\n' +
            'This is a correction. The student is completely removed ' +
            'from the group; there is no record of them having been in ' +
            'it. To change a group, remove here and re-assign from the ' +
            'schedule grid.'
        )) {
            return;
        }

        TG.removeMemberRecord(groupId, charId)
            .then(function(result) {
                if (result && result.success) {
                    if (_openPickerGroupId &&
                        String(_openPickerGroupId) === String(groupId)) {
                        handleOpenTeachingGroupPicker(groupId);
                        return;
                    }
                    var ctx = getContext();
                    ctx.onChange();
                } else if (result && result.message) {
                    notify(result.message, 'error');
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyPeopleController] removeMemberRecord failed:',
                    err
                );
                notify('Failed to remove student from group.', 'error');
            });
    }

    // ============================================================
    // TEACHING GROUPS — BULK ROSTER OPERATIONS
    // ============================================================

    /**
     * Clear Roster: remove every member from a group, keeping the
     * group and its sessions.
     *
     * HARD DELETE. The member records are removed entirely. No
     * history survives. This matches the per-student Remove button
     * in the group block header, which also calls a hard-delete
     * operation. The intent is correction: "this assignment was a
     * mistake and the records should not have existed."
     *
     * The group record, its startWeek / endWeek, its customName,
     * its groupNumber, and every teaching session owned by it are
     * unchanged.
     */
    function handleClearTeachingGroupRoster(groupId) {
        if (!isNonEmptyString(groupId)) { return; }

        var TG = getTeachingGroups();
        if (!TG || typeof TG.clearGroupRoster !== 'function') {
            notify('Teaching groups module not available.', 'error');
            return;
        }

        var group = null;
        try {
            group = TG.getGroup(groupId);
        } catch (e) {
            group = null;
        }

        if (!group) {
            notify('Teaching group not found.', 'error');
            return;
        }

        var members = Array.isArray(group.members) ? group.members : [];
        var memberCount = members.length;

        if (memberCount === 0) {
            notify('This group has no students to clear.', 'info');
            return;
        }

        var groupName = isNonEmptyString(group.customName)
            ? '"' + group.customName + '"'
            : 'this group';

        if (!confirm(
            'Remove all ' + memberCount + ' student' +
            (memberCount === 1 ? '' : 's') +
            ' from ' + groupName + '?\n\n' +
            'Their membership records will be deleted. This cannot ' +
            'be undone.\n\n' +
            'The group and its sessions are not affected. To delete ' +
            'the group itself, use the delete button on the group ' +
            'header.'
        )) {
            return;
        }

        TG.clearGroupRoster(groupId)
            .then(function(result) {
                if (result && result.success) {
                    var ctx = getContext();
                    ctx.onChange();
                    return;
                }
                if (result && result.message) {
                    notify(result.message, 'error');
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyPeopleController] clearGroupRoster failed:',
                    err
                );
                notify('Failed to clear the group roster.', 'error');
            });
    }

    /**
     * Delete Group: remove the teaching group and every session on
     * it, in one transaction. Members are unassigned.
     *
     * Routes to AcademySchedule.removeTeachingGroup, which owns
     * the compound operation. It deletes the group record and
     * every teaching session whose groupId matches. Students
     * enrolled in the discipline are not affected; their
     * enrolments are independent of their membership in this
     * group.
     */
    function handleDeleteTeachingGroup(groupId, classId) {
        if (!isNonEmptyString(groupId)) { return; }

        var resolvedClassId = isNonEmptyString(classId)
            ? String(classId)
            : AcademyUI.getSelectedClassId();

        if (!isNonEmptyString(resolvedClassId)) {
            notify('No class selected.', 'error');
            return;
        }

        var Schedule = getSchedule();
        if (!Schedule ||
            typeof Schedule.removeTeachingGroup !== 'function') {
            notify('Schedule module not available.', 'error');
            return;
        }

        var TG = getTeachingGroups();
        var group = null;
        if (TG && typeof TG.getGroup === 'function') {
            try {
                group = TG.getGroup(groupId);
            } catch (e) {
                group = null;
            }
        }

        var groupName = 'this group';
        if (group) {
            groupName = isNonEmptyString(group.customName)
                ? '"' + group.customName + '"'
                : 'this group';
        }

        var memberCount = 0;
        var sessionCount = 0;
        if (group) {
            if (Array.isArray(group.members)) {
                memberCount = group.members.length;
            }
            var TS = getTeachingSessions();
            if (TS && typeof TS.getSessionsForGroup === 'function') {
                try {
                    var sessions = TS.getSessionsForGroup(groupId) || [];
                    sessionCount = sessions.length;
                } catch (e) {
                    sessionCount = 0;
                }
            }
        }

        var summaryParts = [];
        if (sessionCount > 0) {
            summaryParts.push(sessionCount + ' session' +
                (sessionCount === 1 ? '' : 's'));
        }
        if (memberCount > 0) {
            summaryParts.push(memberCount + ' student' +
                (memberCount === 1 ? '' : 's'));
        }
        var summary = summaryParts.length > 0
            ? ' (' + summaryParts.join(', ') + ')'
            : '';

        if (!confirm(
            'Delete ' + groupName + summary + '?\n\n' +
            'The group and every session on it will be removed. ' +
            'Students enrolled in the discipline are not affected; ' +
            'only their membership in this group is removed.\n\n' +
            'This cannot be undone.'
        )) {
            return;
        }

        Schedule.removeTeachingGroup({
            groupId: String(groupId),
            classId: String(resolvedClassId)
        }).then(function(result) {
            if (result && result.success) {
                var ctx = getContext();
                ctx.onChange();
                return;
            }
            if (result && result.message) {
                notify(result.message, 'error');
            } else {
                notify('Failed to delete the teaching group.', 'error');
            }
        }).catch(function(err) {
            console.warn(
                '[AcademyPeopleController] removeTeachingGroup failed:',
                err
            );
            notify('Failed to delete the teaching group.', 'error');
        });
    }

    // ============================================================
    // CANDIDATE PICKER — SEARCH, BULK, SELECTION STATE
    // ============================================================

    function applyCandidateSearchFilter(inputEl) {
        if (!inputEl) { return; }
        var picker = inputEl.closest(
            '.academy-teaching-group-candidate-picker'
        );
        if (!picker) { return; }

        var term = (inputEl.value || '').toLowerCase().trim();
        var rows = picker.querySelectorAll(
            '.academy-teaching-group-candidate-row'
        );

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var key = row.dataset ? (row.dataset.searchKey || '') : '';
            var matches = term === '' || key.indexOf(term) !== -1;
            row.style.display = matches ? '' : 'none';
        }

        var sections = picker.querySelectorAll(
            '.academy-teaching-group-candidate-section'
        );
        var totalVisible = 0;

        for (var s = 0; s < sections.length; s++) {
            var section = sections[s];
            var sectionRows = section.querySelectorAll(
                '.academy-teaching-group-candidate-row'
            );
            var visibleInSection = 0;
            for (var r = 0; r < sectionRows.length; r++) {
                if (sectionRows[r].style.display !== 'none') {
                    visibleInSection++;
                }
            }
            totalVisible += visibleInSection;
            section.style.display = visibleInSection === 0 ? 'none' : '';
        }

        var noMatches = picker.querySelector('[data-no-matches]');
        if (noMatches) {
            noMatches.style.display = totalVisible === 0 ? '' : 'none';
        }
    }

    function selectAllVisibleInSection(picker, sectionKey) {
        if (!picker || !sectionKey) { return; }

        var section = picker.querySelector(
            '.academy-teaching-group-candidate-section' +
            '[data-section="' + cssEscape(sectionKey) + '"]'
        );
        if (!section) { return; }

        var rows = section.querySelectorAll(
            '.academy-teaching-group-candidate-row'
        );
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            if (row.style.display === 'none') { continue; }
            var cb = row.querySelector(
                '.academy-teaching-group-candidate-checkbox'
            );
            if (cb) { cb.checked = true; }
        }
    }

    function clearSection(picker, sectionKey) {
        if (!picker || !sectionKey) { return; }

        var section = picker.querySelector(
            '.academy-teaching-group-candidate-section' +
            '[data-section="' + cssEscape(sectionKey) + '"]'
        );
        if (!section) { return; }

        var cbs = section.querySelectorAll(
            '.academy-teaching-group-candidate-checkbox'
        );
        for (var i = 0; i < cbs.length; i++) {
            cbs[i].checked = false;
        }
    }

    function updateCandidateSelectionState(picker) {
        if (!picker) { return; }

        var eligibleSection = picker.querySelector(
            '.academy-teaching-group-candidate-section' +
            '[data-section="eligible"]'
        );

        if (eligibleSection) {
            var totalCbs = eligibleSection.querySelectorAll(
                '.academy-teaching-group-candidate-checkbox'
            );
            var checkedCbs = eligibleSection.querySelectorAll(
                '.academy-teaching-group-candidate-checkbox:checked'
            );

            var countEl = eligibleSection.querySelector(
                '[data-section-count="eligible"]'
            );
            if (countEl) {
                countEl.textContent =
                    checkedCbs.length + ' / ' + totalCbs.length;
            }
        }

        var addBtn = picker.querySelector(
            '[data-action="teaching-groups-add-student-submit"]'
        );
        if (!addBtn) { return; }

        var checked = picker.querySelectorAll(
            '.academy-teaching-group-candidate-checkbox:checked'
        ).length;

        if (checked === 0) {
            addBtn.setAttribute('disabled', 'disabled');
            addBtn.textContent = 'Add';
        } else {
            addBtn.removeAttribute('disabled');
            addBtn.textContent = 'Add (' + checked + ')';
        }
    }

    function cssEscape(value) {
        if (typeof CSS !== 'undefined' &&
            typeof CSS.escape === 'function') {
            return CSS.escape(String(value));
        }
        return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    }

    // ============================================================
    // TEACHING GROUPS — SESSIONS FLOW
    // ============================================================

    function handleAddTeachingGroupSession(groupId) {
        if (!isNonEmptyString(groupId)) { return; }

        var Modal = getSessionFormModal();
        if (!Modal || typeof Modal.openModal !== 'function') {
            notify(
                'Session form modal is not available.',
                'error'
            );
            return;
        }

        try {
            Modal.openModal({
                mode: 'add',
                groupId: String(groupId),
                onClose: function() {
                    var ctx = getContext();
                    ctx.onChange();
                }
            });
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] session form ' +
                'openModal(add) threw:', e
            );
            notify('Failed to open the session form.', 'error');
        }
    }

    function handleEditTeachingGroupSession(groupId, sessionId) {
        if (!isNonEmptyString(groupId) ||
            !isNonEmptyString(sessionId)) {
            return;
        }

        var Modal = getSessionFormModal();
        if (!Modal || typeof Modal.openModal !== 'function') {
            notify(
                'Session form modal is not available.',
                'error'
            );
            return;
        }

        try {
            Modal.openModal({
                mode: 'edit',
                groupId: String(groupId),
                sessionId: String(sessionId),
                onClose: function() {
                    var ctx = getContext();
                    ctx.onChange();
                }
            });
        } catch (e) {
            console.warn(
                '[AcademyPeopleController] session form ' +
                'openModal(edit) threw:', e
            );
            notify('Failed to open the session form.', 'error');
        }
    }

    function handleDeleteTeachingGroupSession(groupId, sessionId) {
        if (!isNonEmptyString(groupId) ||
            !isNonEmptyString(sessionId)) {
            return;
        }

        var TS = getTeachingSessions();
        if (!TS || typeof TS.removeSessionRecord !== 'function') {
            notify('Teaching sessions module not available.', 'error');
            return;
        }

        if (!confirm(
            'Delete this session?\n\n' +
            'The session is removed from the schedule. Students ' +
            'enrolled in the discipline are not affected; only ' +
            'this one meeting is removed.'
        )) {
            return;
        }

        TS.removeSessionRecord(sessionId)
            .then(function(result) {
                if (result && result.success) {
                    var ctx = getContext();
                    ctx.onChange();
                } else if (result && result.message) {
                    notify(result.message, 'error');
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyPeopleController] ' +
                    'removeSessionRecord failed:', err
                );
                notify('Failed to delete session.', 'error');
            });
    }

    // ============================================================
    // SEARCH DEBOUNCE
    // ============================================================

    function debouncePeopleSearch(value) {
        if (_searchTimer) {
            clearTimeout(_searchTimer);
        }
        _searchTimer = setTimeout(function() {
            _searchTimer = null;
            AcademyUI.setPeopleSearch(value);
            var ctx = getContext();
            ctx.onChange();
        }, 150);
    }

    // ============================================================
    // UNMOUNT
    // ============================================================

    function unmount() {
        unmountSubEditors();

        if (_searchTimer) {
            clearTimeout(_searchTimer);
            _searchTimer = null;
        }

        _activeCharacterTab = 'main';
        _lastCharacterIdForTab = null;
        clearPickerState();

        _openDisciplinePicker = null;
        _currentGridVM = null;

        _host = null;
        _context = null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyPeopleController = Object.freeze({
        render: render,
        handleClick: handleClick,
        handleChange: handleChange,
        handleInput: handleInput,
        handleKeydown: handleKeydown,
        unmount: unmount
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyPeopleController;
        var missing = [];

        var required = [
            'render',
            'handleClick',
            'handleChange',
            'handleInput',
            'handleKeydown',
            'unmount'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyPeopleController] Verification - some exports ' +
                'may be missing:', missing.join(', ')
            );
        }
    })();

})();
