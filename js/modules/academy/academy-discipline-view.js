/**
 * modules/academy/academy-discipline-view.js - Academy Discipline View
 * Standalone view for browsing and editing Academy disciplines.
 *
 * Path: js/modules/academy/academy-discipline-view.js
 *
 * This module is responsible for:
 *   - Rendering the discipline list (sidebar) with a search and type filter
 *   - Rendering the "+ Add Discipline" button at the top of the sidebar
 *   - Rendering the inline discipline editor in the detail panel
 *   - Rendering the grade scheme editor (preset + band table + live preview)
 *   - Rendering the assessment weights editor (per-type weight inputs)
 *   - Rendering an empty state when no discipline is selected
 *   - Rendering a tab bar in the detail panel: Edit | Schedule
 *   - Rendering the Schedule tab body (week selector, header actions,
 *     free-slots filter panel, grid host, enrollment summary host,
 *     sessions host)
 *
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no domain reads, no logic.
 *   - Receives a view model from AcademyDisciplineController.
 *   - Does NOT bind events. Rows, buttons, inputs, and selects emit
 *     data-* attributes (or stable ids) that AcademyView's delegated
 *     container listeners resolve.
 *   - Uses DomUtils for escaping (MANDATORY, no fallback).
 *   - Returns an HTML string.
 *
 * PURITY:
 *   This module does NOT read from any domain module. Earlier
 *   revisions read the class roster and the discipline enrolment
 *   list directly from inside buildHighlightFilterStudents. That
 *   put domain reads inside a renderer, which is exactly the
 *   architectural smell the aggregator layer exists to prevent.
 *
 *   The controller now owns those reads. It calls
 *   AcademyAggregator.getFreeSlotCandidateStudentsViewModel and
 *   AcademyAggregator.getClassInstructorDisciplines, then hands
 *   this view a `highlightFilterVM`:
 *
 *     {
 *       students:    [ { id, name }, ... ],
 *       instructors: [ { id, name }, ... ],
 *       unavailable: boolean    // true when the class/discipline
 *                               // context is missing
 *     }
 *
 *   The view renders that VM verbatim. It does not compute
 *   eligibility, does not filter, and does not reach into a domain
 *   module for anything.
 *
 * VM CONTRACT (STRICT):
 *   The renderer trusts the VM. Every field it reads is guaranteed
 *   by the controller. A malformed VM is a controller bug and must
 *   surface as a thrown error, not as an empty panel that quietly
 *   claims fewer disciplines than exist.
 *
 *   {
 *     disciplines:   [ listRowVM, ... ],    // guaranteed array
 *     selected:      disciplineVM | null,   // null when no selection
 *     editorMode:    'empty' | 'edit',
 *     filters:       { type, search },      // guaranteed object
 *     activeTab:     'edit' | 'schedule',
 *     scheduleWeek:  number,
 *     scheduleHighlightVM: highlightVM | null,
 *     highlightFilterVM: filterVM            // guaranteed object
 *   }
 *
 *   listRowVM:
 *   {
 *     id, name, type, typeLabel,
 *     startWeek, endWeek, weeklyHours
 *   }
 *
 *   disciplineVM (editorMode === 'edit'):
 *   {
 *     id, isNew, name, type, startWeek, endWeek, weeklyHours, weight,
 *     gradeScheme, schemePresetId, schemePreview, schemePresets,
 *     assessmentTypes, assessmentWeights, defaultAssessmentWeights,
 *     fieldErrors, weekBounds, weeklyHoursBounds, weightBounds,
 *     bandPercentBounds
 *   }
 *
 *   highlightVM (present when a highlight filter is active):
 *   {
 *     instructorId, instructorName, studentCount, checkWeeks
 *   }
 *
 *   filterVM (always present):
 *   {
 *     students:    [ { id, name }, ... ],
 *     instructors: [ { id, name }, ... ],
 *     unavailable: boolean
 *   }
 *
 * TABS:
 *   The detail panel gains a two-tab bar when a discipline is
 *   selected or a new draft is open:
 *
 *     Edit       the existing discipline editor.
 *     Schedule   a calendar grid scoped to (this discipline, the
 *                Academy-selected class, the display week), plus a
 *                summary panel below the grid and a discipline
 *                sessions panel below the summary.
 *
 *   The Schedule tab is INTERACTIVE. The grid emits
 *   schedule-discipline-assign on empty cells and
 *   schedule-discipline-slot-open on occupied cells; the controller
 *   routes both.
 *
 * SCHEDULE HEADER ACTIONS:
 *   The Schedule tab header carries three buttons:
 *
 *     Manage Groups    emits data-action="discipline-manage-groups"
 *     Rebalance Groups emits data-action="discipline-rebalance"
 *     Find free slot   the launcher for the free-slots filter panel;
 *                      emits data-action="discipline-schedule-toggle-filter-panel"
 *
 *   The first two are new. The controller routes each to its modal.
 *
 * FREE SLOTS FILTER PANEL:
 *   The panel is a disclosure:
 *
 *     Closed: a single launcher button.
 *     Open:   instructor select, student multi-select, check-weeks
 *             number, Apply button.
 *
 *   Students come from `highlightFilterVM.students`. This list has
 *   already been filtered to unassigned, eligible students by the
 *   aggregator. The view does not filter further.
 *
 *   The student list is rendered as a two-column grid, not a
 *   running list. That was the "clunky" layout fix.
 *
 *   When `highlightFilterVM.unavailable` is true, the panel renders
 *   an explanatory message and disables the Apply button. That
 *   happens when the class is not selected or the discipline has
 *   not been saved.
 *
 *   When a filter is ACTIVE (scheduleHighlightVM non-null), the
 *   panel is FORCED OPEN and shows a summary line plus a Clear
 *   button. The Clear button emits
 *   data-action="discipline-schedule-clear-highlight".
 *
 * EVENTS EMITTED (data-* attributes, for AcademyView to bind):
 *   Sidebar:
 *     [data-action="discipline-add"]                 (click)
 *     #academy-discipline-search                     (input)
 *     #academy-discipline-type-filter                (change)
 *     .academy-discipline-row [data-discipline-id]   (click)
 *
 *   Tab bar:
 *     [data-action="discipline-tab-select"] [data-tab="edit|schedule"]  (click)
 *
 *   Schedule tab:
 *     #academy-discipline-schedule-week              (change / Enter)
 *     [data-action="discipline-manage-groups"]       (click)
 *     [data-action="discipline-rebalance"]           (click)
 *     [data-action="discipline-schedule-toggle-filter-panel"]  (click)
 *     [data-action="discipline-schedule-find-free-slot"]       (click)
 *     [data-action="discipline-schedule-clear-highlight"]      (click)
 *
 * TERMINOLOGY:
 *   The discipline domain is an Academy concern.
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
 *   - window.CalendarConstants (MANDATORY) — week bounds
 */

(function() {
    'use strict';

    if (window.__academyDisciplineViewLoaded) {
        return;
    }

    var DomUtils = window.DomUtils;
    var CalendarConstants = window.CalendarConstants;

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        throw new Error(
            '[AcademyDisciplineView] Missing mandatory dependency: ' +
            'DomUtils.escapeHtml / DomUtils.escapeAttribute'
        );
    }

    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        throw new Error(
            '[AcademyDisciplineView] Missing mandatory dependency: ' +
            'CalendarConstants.MIN_WEEK / MAX_WEEK'
        );
    }

    window.__academyDisciplineViewLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_WEEK = CalendarConstants.MIN_WEEK;
    var MAX_WEEK = CalendarConstants.MAX_WEEK;

    var VALID_TABS = ['edit', 'schedule'];

    var DEFAULT_HIGHLIGHT_CHECK_WEEKS = 4;
    var MAX_HIGHLIGHT_CHECK_WEEKS = 12;

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

    function safeString(value) {
        if (value === undefined || value === null) {
            return '';
        }
        return String(value);
    }

    function getDisciplineTypeBadgeClass(type) {
        switch (type) {
            case 'mandatory': return 'academy-discipline-type-badge academy-discipline-type-mandatory';
            case 'optional':  return 'academy-discipline-type-badge academy-discipline-type-optional';
            default:          return 'academy-discipline-type-badge academy-discipline-type-unknown';
        }
    }

    function getDisciplineTypeLabel(type) {
        if (type === 'mandatory') return 'Mandatory';
        if (type === 'optional')  return 'Optional';
        return 'Unknown';
    }

    function formatWeekRange(startWeek, endWeek) {
        var s = isFiniteNumber(startWeek) ? String(startWeek) : '';
        var e = isFiniteNumber(endWeek) ? String(endWeek) : '';
        if (s && e) {
            return 'Weeks ' + s + '\u2013' + e;
        }
        if (s) {
            return 'From week ' + s;
        }
        if (e) {
            return 'Until week ' + e;
        }
        return '';
    }

    function renderFieldError(errors, field) {
        if (!errors || typeof errors !== 'object') { return ''; }
        var message = errors[field];
        if (!isNonEmptyString(message)) { return ''; }
        return '<p class="academy-field-error" ' +
                    'data-field-error-for="' + escapeAttribute(field) + '">' +
                    escapeHtml(message) +
                '</p>';
    }

    function withErrorClass(baseClass, errors, field) {
        if (!errors || typeof errors !== 'object') { return baseClass; }
        if (!isNonEmptyString(errors[field])) { return baseClass; }
        return baseClass + ' academy-field-has-error';
    }

    // ============================================================
    // VM VALIDATION
    // ============================================================

    function validateVM(viewModel) {
        if (!viewModel || typeof viewModel !== 'object') {
            throw new Error(
                '[AcademyDisciplineView] renderHTML requires a view model.'
            );
        }

        if (!Array.isArray(viewModel.disciplines)) {
            throw new Error(
                '[AcademyDisciplineView] VM.disciplines must be an array.'
            );
        }

        if (!viewModel.filters || typeof viewModel.filters !== 'object') {
            throw new Error(
                '[AcademyDisciplineView] VM.filters must be an object.'
            );
        }

        if (viewModel.editorMode !== 'empty' && viewModel.editorMode !== 'edit') {
            throw new Error(
                '[AcademyDisciplineView] VM.editorMode must be ' +
                '"empty" or "edit"; got ' +
                JSON.stringify(viewModel.editorMode) + '.'
            );
        }

        if (VALID_TABS.indexOf(viewModel.activeTab) === -1) {
            throw new Error(
                '[AcademyDisciplineView] VM.activeTab must be one of: ' +
                VALID_TABS.join(', ') + '; got ' +
                JSON.stringify(viewModel.activeTab) + '.'
            );
        }

        if (!isFiniteNumber(viewModel.scheduleWeek)) {
            throw new Error(
                '[AcademyDisciplineView] VM.scheduleWeek must be a ' +
                'finite number.'
            );
        }

        if (!viewModel.highlightFilterVM ||
            typeof viewModel.highlightFilterVM !== 'object') {
            throw new Error(
                '[AcademyDisciplineView] VM.highlightFilterVM must be ' +
                'an object. The controller is responsible for building it.'
            );
        }

        if (viewModel.editorMode === 'edit') {
            if (!viewModel.selected || typeof viewModel.selected !== 'object') {
                throw new Error(
                    '[AcademyDisciplineView] VM.selected must be an ' +
                    'object when editorMode is "edit".'
                );
            }
        }

        return viewModel;
    }

    // ============================================================
    // RENDER - Top-level entry point
    // ============================================================

    function renderHTML(viewModel) {
        var vm = validateVM(viewModel);

        return (
            '<div class="academy-body academy-discipline-layout">' +
                renderListPanel(vm.disciplines, vm.filters) +
                renderDetailPanel(
                    vm.selected,
                    vm.editorMode,
                    vm.activeTab,
                    vm.scheduleWeek,
                    vm.scheduleHighlightVM,
                    vm.highlightFilterVM
                ) +
            '</div>'
        );
    }

    // ============================================================
    // LIST PANEL - Left side
    // ============================================================

    function renderListPanel(disciplines, filters) {
        var html = '<div class="academy-discipline-sidebar">';

        html += renderAddButton();
        html += renderListFilters(filters);
        html += renderListItems(disciplines);

        html += '</div>';
        return html;
    }

    function renderAddButton() {
        return (
            '<button type="button" ' +
                'class="primary small academy-add-discipline-btn" ' +
                'data-action="discipline-add">' +
                '+ Add Discipline' +
            '</button>'
        );
    }

    function renderListFilters(filters) {
        var type = filters.type || 'all';
        var search = filters.search || '';

        var html = '<div class="academy-discipline-filters">';

        html += '<input type="text" id="academy-discipline-search" ' +
            'class="academy-discipline-search" ' +
            'placeholder="Search disciplines..." ' +
            'value="' + escapeAttribute(search) + '">';

        html += '<label class="academy-filter-label" ' +
                    'for="academy-discipline-type-filter">Type:</label>';
        html += '<select id="academy-discipline-type-filter" ' +
                    'class="academy-discipline-type-filter">';
        html += '<option value="all"' +
                    (type === 'all' ? ' selected' : '') + '>All</option>';
        html += '<option value="mandatory"' +
                    (type === 'mandatory' ? ' selected' : '') + '>Mandatory</option>';
        html += '<option value="optional"' +
                    (type === 'optional' ? ' selected' : '') + '>Optional</option>';
        html += '</select>';

        html += '</div>';
        return html;
    }

    function renderListItems(disciplines) {
        var html = '<div class="academy-discipline-list" ' +
                    'id="academy-discipline-list">';

        if (disciplines.length === 0) {
            html += '<p class="empty-state small">' +
                        'No disciplines match the current filters.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            if (!d || !d.id) {
                throw new Error(
                    '[AcademyDisciplineView] VM.disciplines[' + i +
                    '] must be an object with an id.'
                );
            }
            html += renderListRow(d);
        }

        html += '</div>';
        return html;
    }

    function renderListRow(d) {
        var badgeClass = getDisciplineTypeBadgeClass(d.type);
        var typeLabel = isNonEmptyString(d.typeLabel)
            ? d.typeLabel
            : getDisciplineTypeLabel(d.type);

        var html = '';
        html += '<div class="academy-discipline-row" ' +
                    'data-discipline-id="' + escapeAttribute(d.id) + '" ' +
                    'role="button" tabindex="0">';

        html += '<div class="academy-discipline-row-main">';
        html += '<span class="academy-discipline-name">' +
                    escapeHtml(d.name || 'Unnamed Discipline') +
                '</span>';
        html += '<span class="' + badgeClass + '">' +
                    escapeHtml(typeLabel) +
                '</span>';
        html += '</div>';

        var meta = [];
        var range = formatWeekRange(d.startWeek, d.endWeek);
        if (range) {
            meta.push(escapeHtml(range));
        }
        if (isFiniteNumber(d.weeklyHours)) {
            meta.push(escapeHtml(String(d.weeklyHours)) + 'h/wk');
        }

        if (meta.length > 0) {
            html += '<div class="academy-discipline-row-meta">' +
                        meta.join(' &middot; ') +
                    '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // DETAIL PANEL - Right side
    // ============================================================

    function renderDetailPanel(
        selected,
        editorMode,
        activeTab,
        scheduleWeek,
        highlightVM,
        filterVM
    ) {
        var html = '<div class="academy-discipline-detail" ' +
                    'id="academy-discipline-detail">';

        if (editorMode === 'empty') {
            html += renderEmptyDetailState();
            html += '</div>';
            return html;
        }

        html += renderTabBar(activeTab);

        html += '<div class="academy-discipline-tab-body">';

        if (activeTab === 'schedule') {
            html += renderScheduleTab(
                scheduleWeek,
                highlightVM,
                selected,
                filterVM
            );
        } else {
            html += renderEditor(selected);
        }

        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderEmptyDetailState() {
        return (
            '<div class="academy-detail-empty">' +
                '<p class="empty-state small">' +
                    'Select a discipline to view its details, ' +
                    'or click "+ Add Discipline".' +
                '</p>' +
            '</div>'
        );
    }

    // ============================================================
    // TAB BAR
    // ============================================================

    function renderTabBar(activeTab) {
        var tabs = [
            { id: 'edit',     label: 'Edit' },
            { id: 'schedule', label: 'Schedule' }
        ];

        var html = '';
        html += '<div class="academy-discipline-tabs">';
        for (var i = 0; i < tabs.length; i++) {
            var t = tabs[i];
            var isActive = t.id === activeTab;
            html += '<button type="button" ' +
                        'class="academy-discipline-tab-btn' +
                            (isActive ? ' active' : '') + '" ' +
                        'data-action="discipline-tab-select" ' +
                        'data-tab="' + escapeAttribute(t.id) + '">' +
                        escapeHtml(t.label) +
                    '</button>';
        }
        html += '</div>';
        return html;
    }

    // ============================================================
    // SCHEDULE TAB
    // ============================================================

    function renderScheduleTab(week, highlightVM, selectedDiscipline, filterVM) {
        var weekValue = String(week);
        var isNewDraft = !selectedDiscipline ||
            !isNonEmptyString(selectedDiscipline.id);

        var html = '';
        html += '<div class="academy-discipline-schedule-tab">';

        // ---- Header row: week selector + actions ----
        html += '<div class="academy-discipline-schedule-header">';

        html += '<div class="academy-discipline-schedule-header-week">';
        html += '<label class="academy-top-label" ' +
                    'for="academy-discipline-schedule-week">Week:</label>';
        html += '<input type="number" ' +
                    'id="academy-discipline-schedule-week" ' +
                    'class="academy-week-input ' +
                        'academy-discipline-schedule-week" ' +
                    'value="' + escapeAttribute(weekValue) + '" ' +
                    'min="' + escapeAttribute(String(MIN_WEEK)) + '" ' +
                    'max="' + escapeAttribute(String(MAX_WEEK)) + '">';
        html += '</div>';

        // ---- Header actions: Manage Groups, Rebalance, Find free slot ----
        //
        // The first two open modals. They are disabled while the
        // discipline is an unsaved draft, because both operate on a
        // persisted discipline.
        //
        // The "Find free slot" launcher is part of the free-slots
        // filter panel, which lives below.
        html += '<div class="academy-discipline-schedule-header-actions">';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="discipline-manage-groups"' +
                    (isNewDraft ? ' disabled' : '') + '>' +
                    'Manage Groups' +
                '</button>';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="discipline-rebalance"' +
                    (isNewDraft ? ' disabled' : '') + '>' +
                    'Rebalance Groups' +
                '</button>';
        html += '</div>';

        html += '</div>';

        html += renderFreeSlotsPanel(
            week,
            highlightVM,
            selectedDiscipline,
            filterVM,
            isNewDraft
        );

        html += '<div id="academy-discipline-schedule-host" ' +
                    'class="academy-discipline-schedule-host"></div>';

        html += '<div id="academy-discipline-schedule-summary-host" ' +
                    'class="academy-discipline-schedule-summary-host">' +
                '</div>';

        html += '<div id="academy-discipline-sessions-host" ' +
                    'class="academy-discipline-sessions-host"></div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // FREE SLOTS FILTER PANEL
    // ============================================================
    //
    // Two states:
    //
    //   No active filter (highlightVM === null):
    //     Closed disclosure by default. The launcher toggles it.
    //     The open form shows:
    //       - instructor select (from filterVM.instructors)
    //       - student multi-select (from filterVM.students)
    //       - check-weeks number input
    //       - Apply button
    //
    //   Active filter (highlightVM !== null):
    //     Force-open. The form is replaced by a summary line and a
    //     Clear button.
    //
    // The form's markup contract with the controller:
    //   .discipline-highlight-instructor-select
    //   .discipline-highlight-student-checkbox
    //   .discipline-highlight-check-weeks
    //
    // Those three class names are read by the controller's
    // handleFindFreeSlotSubmit. Rename them here and you must
    // rename them there.
    //
    // The students list is a TWO-COLUMN grid, not a running list.
    // That is the layout fix. The wrapper carries
    // `.discipline-highlight-students` and each row carries
    // `.discipline-highlight-student-option`; the CSS defines the
    // grid.

    function renderFreeSlotsPanel(
        week,
        highlightVM,
        selectedDiscipline,
        filterVM,
        isNewDraft
    ) {
        var isActive = highlightVM !== null &&
            typeof highlightVM === 'object';

        var expanded = isActive ? 'true' : 'false';

        var html = '';
        html += '<div class="discipline-highlight-filter" ' +
                    'data-expanded="' + expanded + '">';

        // ---- Launcher ----
        html += '<button type="button" ' +
                    'class="discipline-highlight-launcher" ' +
                    'data-action="discipline-schedule-toggle-filter-panel"' +
                    (isActive ? ' disabled' : '') + '>';
        html += '<span class="discipline-highlight-launcher-caret">' +
                    (isActive ? '\u25be' : '\u25b8') +
                '</span>';
        html += '<span class="discipline-highlight-launcher-label">' +
                    'Find free slot' +
                '</span>';
        html += '</button>';

        // ---- Body ----
        html += '<div class="discipline-highlight-body" ' +
                    'style="display:' +
                    (isActive ? 'block' : 'none') + ';">';

        if (isActive) {
            html += renderHighlightSummary(highlightVM);
        } else {
            html += renderHighlightForm(
                week,
                selectedDiscipline,
                filterVM,
                isNewDraft
            );
        }

        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderHighlightSummary(highlightVM) {
        var instructorName = isNonEmptyString(highlightVM.instructorName)
            ? highlightVM.instructorName
            : 'Unknown instructor';

        var studentCount = isFiniteNumber(highlightVM.studentCount)
            ? highlightVM.studentCount
            : 0;

        var checkWeeks = isFiniteNumber(highlightVM.checkWeeks)
            ? highlightVM.checkWeeks
            : DEFAULT_HIGHLIGHT_CHECK_WEEKS;

        var studentLabel = studentCount === 1
            ? '1 student'
            : studentCount + ' students';

        var weekLabel = checkWeeks === 1
            ? '1 week'
            : checkWeeks + ' weeks';

        var html = '';
        html += '<div class="discipline-highlight-summary">';
        html += '<div class="discipline-highlight-summary-line">';
        html += '<span class="discipline-highlight-summary-label">' +
                    'Highlighting slots for ' +
                '</span>';
        html += '<span class="discipline-highlight-summary-value">' +
                    escapeHtml(instructorName) +
                '</span>';
        html += '<span class="discipline-highlight-summary-sep">' +
                    ' with ' +
                '</span>';
        html += '<span class="discipline-highlight-summary-value">' +
                    escapeHtml(studentLabel) +
                '</span>';
        html += '</div>';

        html += '<div class="discipline-highlight-summary-meta">' +
                    'Checking ' + escapeHtml(weekLabel) +
                    ' ahead from the current week.' +
                '</div>';

        html += '<div class="discipline-highlight-summary-actions">';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="discipline-schedule-clear-highlight">' +
                    'Clear highlight' +
                '</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderHighlightForm(week, selectedDiscipline, filterVM, isNewDraft) {
        // ---- Unavailable context ----
        //
        // The panel cannot produce useful results without a
        // persisted discipline and a selected class. When the
        // controller flags the filter VM as unavailable, render an
        // explanation and disable Apply. Do not fabricate an empty
        // dropdown.
        if (filterVM.unavailable === true || isNewDraft) {
            return renderHighlightUnavailable(isNewDraft);
        }

        var instructors = Array.isArray(filterVM.instructors)
            ? filterVM.instructors
            : [];
        var students = Array.isArray(filterVM.students)
            ? filterVM.students
            : [];

        var html = '';

        // ---- Instructor ----
        html += '<div class="discipline-highlight-field">';
        html += '<label class="discipline-highlight-label" ' +
                    'for="discipline-highlight-instructor">' +
                    'Instructor' +
                '</label>';

        if (instructors.length === 0) {
            html += '<p class="discipline-highlight-empty">' +
                        'No instructor teaches this discipline for ' +
                        'the selected class during this week.' +
                    '</p>';
            html += '<select class="discipline-highlight-instructor-select" ' +
                        'id="discipline-highlight-instructor" disabled>';
            html += '<option value="">' +
                        'No instructors available' +
                    '</option>';
            html += '</select>';
        } else {
            html += '<select class="discipline-highlight-instructor-select" ' +
                        'id="discipline-highlight-instructor">';
            html += '<option value="">Select an instructor...</option>';
            for (var i = 0; i < instructors.length; i++) {
                var instr = instructors[i];
                html += '<option value="' +
                            escapeAttribute(instr.id) + '">' +
                            escapeHtml(instr.name) +
                        '</option>';
            }
            html += '</select>';
        }

        html += '</div>';

        // ---- Students ----
        //
        // The students list is a two-column grid. Every student
        // here is already unassigned and eligible; the aggregator
        // filtered them. The view does not filter further.
        html += '<div class="discipline-highlight-field">';
        html += '<label class="discipline-highlight-label">' +
                    'Students' +
                '</label>';

        if (students.length === 0) {
            html += '<p class="discipline-highlight-empty">' +
                        'No unassigned students are eligible for a ' +
                        'new slot in this discipline this week.' +
                    '</p>';
        } else {
            html += '<div class="discipline-highlight-students">';
            for (var s = 0; s < students.length; s++) {
                var stu = students[s];
                html += '<label class="discipline-highlight-student-option">';
                html += '<input type="checkbox" ' +
                            'class="discipline-highlight-student-checkbox" ' +
                            'value="' + escapeAttribute(stu.id) + '">';
                html += '<span class="discipline-highlight-student-name">' +
                            escapeHtml(stu.name) +
                        '</span>';
                html += '</label>';
            }
            html += '</div>';
        }

        html += '</div>';

        // ---- Check weeks ----
        html += '<div class="discipline-highlight-field">';
        html += '<label class="discipline-highlight-label" ' +
                    'for="discipline-highlight-check-weeks">' +
                    'Check weeks ahead' +
                '</label>';
        html += '<input type="number" ' +
                    'id="discipline-highlight-check-weeks" ' +
                    'class="discipline-highlight-check-weeks" ' +
                    'value="' +
                        escapeAttribute(String(DEFAULT_HIGHLIGHT_CHECK_WEEKS)) +
                    '" ' +
                    'min="1" ' +
                    'max="' +
                        escapeAttribute(String(MAX_HIGHLIGHT_CHECK_WEEKS)) +
                    '">';
        html += '<p class="discipline-highlight-hint">' +
                    'How many weeks ahead to test. The badge on a ' +
                    'highlighted cell shows the length of the free ' +
                    'run.' +
                '</p>';
        html += '</div>';

        // ---- Apply ----
        var canApply = instructors.length > 0 && students.length > 0;

        html += '<div class="discipline-highlight-actions">';
        html += '<button type="button" class="primary small" ' +
                    'data-action="discipline-schedule-find-free-slot"' +
                    (canApply ? '' : ' disabled') + '>' +
                    'Highlight slots' +
                '</button>';
        html += '</div>';

        return html;
    }

    function renderHighlightUnavailable(isNewDraft) {
        var message = isNewDraft
            ? 'Save the discipline first to search for free slots.'
            : 'Select a class in the Academy header to search for ' +
              'free slots.';

        return (
            '<div class="discipline-highlight-field">' +
                '<p class="discipline-highlight-empty">' +
                    escapeHtml(message) +
                '</p>' +
            '</div>'
        );
    }

    // ============================================================
    // EDITOR
    // ============================================================

    function renderEditor(d) {
        var errors = d.fieldErrors && typeof d.fieldErrors === 'object'
            ? d.fieldErrors
            : {};

        var isNew = d.isNew === true;

        var weekBounds = d.weekBounds;
        var weeklyHoursBounds = d.weeklyHoursBounds;
        var weightBounds = d.weightBounds;
        var bandPercentBounds = d.bandPercentBounds;

        if (!weekBounds || typeof weekBounds !== 'object') {
            throw new Error(
                '[AcademyDisciplineView] VM.selected.weekBounds is ' +
                'required by the editor.'
            );
        }
        if (!weeklyHoursBounds || typeof weeklyHoursBounds !== 'object') {
            throw new Error(
                '[AcademyDisciplineView] VM.selected.weeklyHoursBounds ' +
                'is required by the editor.'
            );
        }
        if (!weightBounds || typeof weightBounds !== 'object') {
            throw new Error(
                '[AcademyDisciplineView] VM.selected.weightBounds is ' +
                'required by the editor.'
            );
        }
        if (!bandPercentBounds || typeof bandPercentBounds !== 'object') {
            throw new Error(
                '[AcademyDisciplineView] VM.selected.bandPercentBounds ' +
                'is required by the editor.'
            );
        }

        var html = '';

        // ---- Header ----
        html += '<div class="academy-discipline-editor-header">';
        html += '<div class="academy-discipline-editor-title-row">';
        html += '<h3 class="academy-discipline-editor-title">' +
                    (isNew ? 'New Discipline' : 'Edit Discipline') +
                '</h3>';
        if (!isNew) {
            html += '<span class="' + getDisciplineTypeBadgeClass(d.type) + '">' +
                        escapeHtml(getDisciplineTypeLabel(d.type)) +
                    '</span>';
        }
        html += '</div>';

        if (!isNew) {
            html += '<div class="academy-discipline-editor-meta">';
            html += '<span class="academy-discipline-editor-meta-item">';
            html += '<span class="meta-label">ID:</span> ' +
                    escapeHtml(d.id || '');
            html += '</span>';
            html += '</div>';
        }
        html += '</div>';

        // ---- Core fields ----
        html += '<div class="academy-discipline-editor-section">';
        html += '<div class="academy-discipline-editor-grid">';

        html += '<div class="academy-discipline-editor-field ' +
                    'academy-discipline-editor-field-wide">';
        html += '<label for="academy-discipline-name">Name</label>';
        html += '<input type="text" id="academy-discipline-name" ' +
                    'class="' + withErrorClass('academy-discipline-input', errors, 'name') + '" ' +
                    'data-discipline-field="name" ' +
                    'value="' + escapeAttribute(d.name || '') + '" ' +
                    'placeholder="e.g., Combat Training">';
        html += renderFieldError(errors, 'name');
        html += '</div>';

        html += '<div class="academy-discipline-editor-field">';
        html += '<label for="academy-discipline-type">Type</label>';
        html += '<select id="academy-discipline-type" ' +
                    'class="' + withErrorClass('academy-discipline-input', errors, 'type') + '" ' +
                    'data-discipline-field="type">';
        html += '<option value="mandatory"' +
                    (d.type === 'mandatory' ? ' selected' : '') +
                    '>Mandatory</option>';
        html += '<option value="optional"' +
                    (d.type === 'optional' ? ' selected' : '') +
                    '>Optional</option>';
        html += '</select>';
        html += renderFieldError(errors, 'type');
        html += '</div>';

        html += '<div class="academy-discipline-editor-field">';
        html += '<label for="academy-discipline-start-week">Start Week</label>';
        html += '<input type="number" id="academy-discipline-start-week" ' +
                    'class="' + withErrorClass('academy-discipline-input', errors, 'startWeek') + '" ' +
                    'data-discipline-field="startWeek" ' +
                    'value="' + escapeAttribute(safeString(d.startWeek)) + '" ' +
                    'min="' + escapeAttribute(String(weekBounds.min)) + '" ' +
                    'max="' + escapeAttribute(String(weekBounds.max)) + '">';
        html += renderFieldError(errors, 'startWeek');
        html += '</div>';

        html += '<div class="academy-discipline-editor-field">';
        html += '<label for="academy-discipline-end-week">End Week</label>';
        html += '<input type="number" id="academy-discipline-end-week" ' +
                    'class="' + withErrorClass('academy-discipline-input', errors, 'endWeek') + '" ' +
                    'data-discipline-field="endWeek" ' +
                    'value="' + escapeAttribute(safeString(d.endWeek)) + '" ' +
                    'min="' + escapeAttribute(String(weekBounds.min)) + '" ' +
                    'max="' + escapeAttribute(String(weekBounds.max)) + '">';
        html += renderFieldError(errors, 'endWeek');
        html += '</div>';

        html += '<div class="academy-discipline-editor-field">';
        html += '<label for="academy-discipline-weekly-hours">Weekly Hours</label>';
        html += '<input type="number" id="academy-discipline-weekly-hours" ' +
                    'class="' + withErrorClass('academy-discipline-input', errors, 'weeklyHours') + '" ' +
                    'data-discipline-field="weeklyHours" ' +
                    'value="' + escapeAttribute(safeString(d.weeklyHours)) + '" ' +
                    'min="' + escapeAttribute(String(weeklyHoursBounds.min)) + '" ' +
                    'max="' + escapeAttribute(String(weeklyHoursBounds.max)) + '" ' +
                    'step="' + escapeAttribute(String(weeklyHoursBounds.step)) + '">';
        html += renderFieldError(errors, 'weeklyHours');
        html += '</div>';

        html += '<div class="academy-discipline-editor-field">';
        html += '<label for="academy-discipline-weight">Weight</label>';
        html += '<input type="number" id="academy-discipline-weight" ' +
                    'class="' + withErrorClass('academy-discipline-input', errors, 'weight') + '" ' +
                    'data-discipline-field="weight" ' +
                    'value="' + escapeAttribute(safeString(d.weight)) + '" ' +
                    'min="' + escapeAttribute(String(weightBounds.min)) + '" ' +
                    'max="' + escapeAttribute(String(weightBounds.max)) + '" ' +
                    'step="' + escapeAttribute(String(weightBounds.step)) + '">';
        html += renderFieldError(errors, 'weight');
        html += '</div>';

        html += '</div>';
        html += '</div>';

        // ---- Grade scheme ----
        html += renderGradeSchemeSection(d, errors, bandPercentBounds);

        // ---- Assessment weights ----
        html += renderAssessmentWeightsSection(d, errors);

        // ---- Actions ----
        html += renderEditorActions(d);

        return html;
    }

    // ============================================================
    // GRADE SCHEME SECTION
    // ============================================================

    function renderGradeSchemeSection(d, errors, bandPercentBounds) {
        if (!d.gradeScheme || typeof d.gradeScheme !== 'object') {
            throw new Error(
                '[AcademyDisciplineView] VM.selected.gradeScheme is ' +
                'required by the editor.'
            );
        }
        if (!Array.isArray(d.schemePresets)) {
            throw new Error(
                '[AcademyDisciplineView] VM.selected.schemePresets is ' +
                'required by the editor.'
            );
        }

        var scheme = d.gradeScheme;
        var bands = Array.isArray(scheme.bands) ? scheme.bands : [];

        var presetId = isNonEmptyString(d.schemePresetId)
            ? d.schemePresetId
            : 'numeric';
        var preview = isNonEmptyString(d.schemePreview) ? d.schemePreview : '';

        var presets = d.schemePresets;

        var html = '';
        html += '<div class="academy-discipline-editor-section ' +
                    'academy-discipline-scheme-section">';
        html += '<div class="academy-discipline-scheme-header">';
        html += '<h4 class="academy-discipline-editor-section-title">' +
                    'Grade Scheme' +
                '</h4>';
        html += '</div>';

        html += '<div class="academy-discipline-editor-grid">';

        html += '<div class="academy-discipline-editor-field">';
        html += '<label for="academy-discipline-scheme-label">Scheme Name</label>';
        html += '<input type="text" id="academy-discipline-scheme-label" ' +
                    'class="' + withErrorClass('academy-discipline-input', errors, 'schemeLabel') + '" ' +
                    'data-discipline-field="schemeLabel" ' +
                    'value="' + escapeAttribute(scheme.label || '') + '" ' +
                    'placeholder="e.g., Letter Grade">';
        html += renderFieldError(errors, 'schemeLabel');
        html += '</div>';

        html += '<div class="academy-discipline-editor-field">';
        html += '<label for="academy-discipline-scheme-preset">Preset</label>';
        html += '<div class="academy-discipline-preset-row">';
        html += '<select id="academy-discipline-scheme-preset" ' +
                    'class="academy-discipline-input" ' +
                    'data-discipline-field="schemePresetId">';
        for (var p = 0; p < presets.length; p++) {
            var preset = presets[p];
            if (!preset || !preset.id) {
                throw new Error(
                    '[AcademyDisciplineView] VM.selected.schemePresets[' +
                    p + '] must be an object with an id.'
                );
            }
            html += '<option value="' + escapeAttribute(preset.id) + '"' +
                        (presetId === preset.id ? ' selected' : '') + '>' +
                        escapeHtml(preset.label) +
                    '</option>';
        }
        html += '</select>';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="discipline-apply-scheme-preset">' +
                    'Apply Preset' +
                '</button>';
        html += '</div>';
        html += '<p class="field-hint">' +
                    'Applying a preset replaces the bands below.' +
                '</p>';
        html += '</div>';

        html += '</div>';

        // ---- Band editor ----
        html += '<div class="academy-discipline-scheme-bands">';
        html += '<div class="academy-discipline-scheme-bands-header">';
        html += '<span class="academy-discipline-scheme-bands-title">Bands</span>';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="discipline-add-band">' +
                    '+ Add Band' +
                '</button>';
        html += '</div>';

        html += renderFieldError(errors, 'bands');

        if (bands.length === 0) {
            html += '<p class="empty-state small">' +
                        'No bands. Add at least one band with min % 0.' +
                    '</p>';
        } else {
            html += '<table class="academy-discipline-scheme-table">';
            html += '<thead>';
            html += '<tr>';
            html += '<th class="scheme-label-col">Label</th>';
            html += '<th class="scheme-min-col">Min %</th>';
            html += '<th class="scheme-actions-col"></th>';
            html += '</tr>';
            html += '</thead>';
            html += '<tbody>';
            for (var i = 0; i < bands.length; i++) {
                html += renderBandRow(bands[i], i, errors, bandPercentBounds);
            }
            html += '</tbody>';
            html += '</table>';
        }

        html += '</div>';

        if (isNonEmptyString(preview)) {
            html += '<div class="academy-discipline-scheme-preview">';
            html += '<span class="academy-discipline-scheme-preview-label">' +
                        'Preview:' +
                    '</span> ';
            html += '<span class="academy-discipline-scheme-preview-text">' +
                        escapeHtml(preview) +
                    '</span>';
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    function renderBandRow(band, index, errors, bandPercentBounds) {
        var label = isNonEmptyString(band.label) ? band.label : '';
        var minP = isFiniteNumber(band.minPercent)
            ? String(band.minPercent)
            : '';

        var bandErrors = (errors && typeof errors.bandErrors === 'object')
            ? errors.bandErrors
            : {};
        var perBand = bandErrors && bandErrors[String(index)];
        var labelErr = perBand && perBand.label;
        var minErr = perBand && perBand.minPercent;

        var html = '';
        html += '<tr class="academy-discipline-scheme-row">';

        html += '<td class="scheme-label-col">';
        html += '<input type="text" ' +
                    'class="academy-discipline-input academy-discipline-band-label' +
                    (labelErr ? ' academy-field-has-error' : '') + '" ' +
                    'data-band-index="' + escapeAttribute(String(index)) + '" ' +
                    'data-band-field="label" ' +
                    'value="' + escapeAttribute(label) + '" ' +
                    'maxlength="12" ' +
                    'placeholder="A">';
        if (labelErr) {
            html += '<p class="academy-field-error">' +
                        escapeHtml(labelErr) +
                    '</p>';
        }
        html += '</td>';

        html += '<td class="scheme-min-col">';
        html += '<input type="number" ' +
                    'class="academy-discipline-input academy-discipline-band-min' +
                    (minErr ? ' academy-field-has-error' : '') + '" ' +
                    'data-band-index="' + escapeAttribute(String(index)) + '" ' +
                    'data-band-field="minPercent" ' +
                    'value="' + escapeAttribute(minP) + '" ' +
                    'min="' + escapeAttribute(String(bandPercentBounds.min)) + '" ' +
                    'max="' + escapeAttribute(String(bandPercentBounds.max)) + '" ' +
                    'step="' + escapeAttribute(String(bandPercentBounds.step)) + '" ' +
                    'placeholder="0">';
        if (minErr) {
            html += '<p class="academy-field-error">' +
                        escapeHtml(minErr) +
                    '</p>';
        }
        html += '</td>';

        html += '<td class="scheme-actions-col">';
        html += '<button type="button" class="small danger" ' +
                    'data-action="discipline-remove-band" ' +
                    'data-band-index="' + escapeAttribute(String(index)) + '" ' +
                    'title="Remove band">\u2715</button>';
        html += '</td>';

        html += '</tr>';
        return html;
    }

    // ============================================================
    // ASSESSMENT WEIGHTS SECTION
    // ============================================================

    function renderAssessmentWeightsSection(d, errors) {
        if (!Array.isArray(d.assessmentTypes)) {
            throw new Error(
                '[AcademyDisciplineView] VM.selected.assessmentTypes ' +
                'is required by the editor.'
            );
        }
        if (!d.assessmentWeights || typeof d.assessmentWeights !== 'object') {
            throw new Error(
                '[AcademyDisciplineView] VM.selected.assessmentWeights ' +
                'is required by the editor.'
            );
        }

        var types = d.assessmentTypes;
        var weights = d.assessmentWeights;

        var html = '';
        html += '<div class="academy-discipline-editor-section ' +
                    'academy-discipline-weights-section">';

        html += '<div class="academy-discipline-weights-header">';
        html += '<h4 class="academy-discipline-editor-section-title">' +
                    'Assessment Weights' +
                '</h4>';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="discipline-reset-assessment-weights">' +
                    'Reset to Default' +
                '</button>';
        html += '</div>';

        html += '<p class="field-hint academy-discipline-weights-hint">' +
                    'Each assessment type contributes to a student\'s weighted average ' +
                    'in proportion to its weight. Weight 1.0 is neutral.' +
                '</p>';

        if (types.length === 0) {
            html += '<p class="empty-state small">' +
                        'No assessment types configured.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="academy-discipline-weights-grid">';

        for (var i = 0; i < types.length; i++) {
            var type = types[i];
            if (!isNonEmptyString(type)) {
                throw new Error(
                    '[AcademyDisciplineView] VM.selected.assessmentTypes[' +
                    i + '] must be a non-empty string.'
                );
            }

            var value = isFiniteNumber(weights[type]) ? weights[type] : '';
            var label = type.charAt(0).toUpperCase() + type.slice(1);

            html += '<div class="academy-discipline-weights-field">';
            html += '<label for="academy-discipline-weight-' +
                        escapeAttribute(type) + '">' +
                        escapeHtml(label) +
                    '</label>';
            html += '<input type="number" ' +
                        'id="academy-discipline-weight-' +
                            escapeAttribute(type) + '" ' +
                        'class="academy-discipline-input ' +
                            'academy-discipline-weight-input" ' +
                        'data-assessment-weight-type="' +
                            escapeAttribute(type) + '" ' +
                        'value="' + escapeAttribute(safeString(value)) + '" ' +
                        'min="0.1" max="10" step="0.1">';
            html += '</div>';
        }

        html += '</div>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // EDITOR ACTIONS
    // ============================================================

    function renderEditorActions(d) {
        var isNew = d.isNew === true;

        var html = '';
        html += '<div class="academy-discipline-editor-actions">';

        html += '<button type="button" class="primary" ' +
                    'data-action="discipline-save">' +
                    (isNew ? 'Create Discipline' : 'Save Changes') +
                '</button>';

        html += '<button type="button" class="secondary" ' +
                    'data-action="discipline-cancel">' +
                    'Cancel' +
                '</button>';

        if (!isNew) {
            html += '<button type="button" ' +
                        'class="danger academy-discipline-delete-btn" ' +
                        'data-action="discipline-delete" ' +
                        'data-discipline-id="' +
                            escapeAttribute(d.id || '') + '">' +
                        'Delete Discipline' +
                    '</button>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyDisciplineView = Object.freeze({
        renderHTML: renderHTML
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyDisciplineView;
        var missing = [];

        if (typeof exports.renderHTML !== 'function') {
            missing.push('renderHTML');
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyDisciplineView] Verification - some exports ' +
                'may be missing:', missing.join(', ')
            );
        }
    })();

})();
