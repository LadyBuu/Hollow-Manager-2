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
 *   - Rendering the Schedule tab body (week selector, highlight filter
 *     panel, grid host, enrollment summary host, sessions host)
 *
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no domain logic.
 *   - Does NOT fetch data for the editor or list. Receives a view
 *     model from AcademyDisciplineController.
 *   - Does NOT bind events. Rows, buttons, inputs, and selects emit
 *     data-* attributes (or stable ids) that AcademyView's delegated
 *     container listeners resolve.
 *   - Uses DomUtils for escaping (MANDATORY, no fallback).
 *   - Returns an HTML string.
 *
 * THE ONE DOMAIN READ:
 *   The highlight filter panel needs the class roster to populate
 *   its student multi-select. Rendering that list from the VM would
 *   mean threading `AcademyAggregator.getClassStudentsViewModel` and
 *   `AcademyEnrolments.getStudentDisciplineIds` through the
 *   controller. Instead, the view reads them directly, in exactly
 *   one function: buildHighlightFilterStudents(). That is the only
 *   domain read in this module.
 *
 *   When the class cannot be resolved, or the aggregator is absent,
 *   the filter panel renders with an empty student list and the user
 *   sees why. It does NOT fabricate students.
 *
 * VM CONTRACT (STRICT):
 *   The renderer trusts the VM. Every field it reads is guaranteed by
 *   the controller. A malformed VM is a controller bug and must
 *   surface as a thrown error, not as an empty panel that quietly
 *   claims fewer disciplines than exist.
 *
 *   {
 *     disciplines:   [ listRowVM, ... ],    // guaranteed array
 *     selected:      disciplineVM | null,   // null when no selection
 *     editorMode:    'empty' | 'edit',
 *     filters:       { type, search },      // guaranteed object
 *     activeTab:     'edit' | 'schedule',
 *     scheduleWeek:  number,                // valid while Schedule tab exists
 *     scheduleHighlightVM: highlightVM | null
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
 *     id:               string | null,      // null when isNew
 *     isNew:            boolean,
 *     name:             string,
 *     type:             'mandatory' | 'optional',
 *     startWeek:        number,
 *     endWeek:          number,
 *     weeklyHours:      number,
 *     weight:           number,
 *     gradeScheme:      schemeObject,       // canonical shape
 *     schemePresetId:   string,
 *     schemePreview:    string,
 *     schemePresets:    [ { id, label }, ... ],
 *     assessmentTypes:  [ string, ... ],
 *     assessmentWeights: { [type]: number },
 *     fieldErrors:      { [field]: string },
 *     weekBounds:       { min, max },
 *     weeklyHoursBounds: { min, max, step },
 *     weightBounds:     { min, max, step },
 *     bandPercentBounds: { min, max, step }
 *   }
 *
 *   highlightVM (present when a highlight filter is active):
 *   {
 *     instructorId:   string,
 *     instructorName: string,
 *     studentCount:   number,
 *     checkWeeks:     number
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
 *   The active tab is carried on the VM as `activeTab`. When the
 *   editor mode is 'empty' (no discipline selected, no draft),
 *   neither tab renders; the empty state shows instead.
 *
 *   The Schedule tab is INTERACTIVE. The grid emits
 *   schedule-discipline-assign on empty cells and
 *   schedule-discipline-slot-open on occupied cells; the controller
 *   routes both. The class is NOT selectable here; it comes from
 *   AcademyUI.getSelectedClassId().
 *
 * HIGHLIGHT FILTER:
 *   The Schedule tab header carries a "Find free slot" section. It
 *   is rendered as an inline disclosure:
 *
 *     - Closed state: a single button labeled "Find free slot".
 *       Emits data-action="discipline-schedule-find-free-slot"? No —
 *       that action is reserved for the "apply" button inside the
 *       expanded panel. The launcher is a plain toggle that flips a
 *       data-expanded attribute on the wrapper. See TOGGLE BELOW.
 *
 *     - Open state: instructor select, student multi-select,
 *       check-weeks number input, and an Apply button that emits
 *       data-action="discipline-schedule-find-free-slot".
 *
 *   The disclosure is driven purely by a data-expanded attribute on
 *   the wrapper and a small amount of inline style on the body. The
 *   launcher button does not carry a data-action, because there is
 *   no handler for it; the shell routes nothing. It is toggled by
 *   the browser? No — it needs a handler. See TOGGLE BELOW.
 *
 *   Actually, the disclosure toggle is a controller concern. The
 *   launcher emits data-action="discipline-schedule-toggle-filter-panel"
 *   and the controller flips the attribute and inline display. This
 *   keeps the view stateless and matches the summary disclosure
 *   pattern used elsewhere in this file (which is also controller-
 *   toggled, via discipline-summary-toggle).
 *
 *   When a highlight filter is ACTIVE (scheduleHighlightVM non-null),
 *   the panel is FORCED OPEN and shows a summary line plus a Clear
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
 *     [data-action="discipline-schedule-toggle-filter-panel"]  (click)
 *     [data-action="discipline-schedule-find-free-slot"]       (click)
 *     [data-action="discipline-schedule-clear-highlight"]      (click)
 *
 *   The grid cells (emitted by CalendarRenderer, not by this file):
 *     [data-action="schedule-discipline-assign"]
 *     [data-action="schedule-discipline-slot-open"]
 *
 *   The summary panel (emitted by AcademyDisciplineScheduleSummary):
 *     [data-action="discipline-summary-toggle"]
 *
 *   The sessions panel (emitted by AcademyDisciplineSessionsPanel):
 *     [data-action="discipline-sessions-add-student"]
 *     [data-action="discipline-sessions-add-student-cancel"]
 *     [data-action="discipline-sessions-add-student-submit"]
 *     [data-action="discipline-sessions-remove-student"]
 *
 * TERMINOLOGY:
 *   The discipline domain is an Academy concern. The retired
 *   `curriculum` subsystem is no longer referenced here.
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
 *   - window.CalendarConstants (MANDATORY) — week bounds
 *   - window.AcademyUI (LAZY, for the highlight filter's class)
 *   - window.AcademyAggregator (LAZY, for the highlight filter's roster)
 *   - window.AcademyEnrolments (LAZY, for the highlight filter's
 *     enrolment filter)
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
    var DEFAULT_TAB = 'edit';

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
    // HIGHLIGHT FILTER — DOMAIN READS
    // ============================================================
    //
    // This is the ONLY place in this module that reads from a domain
    // module. Everything else is pure rendering from the VM.
    //
    // The reads are:
    //   - AcademyUI.getSelectedClassId()             class context
    //   - AcademyAggregator.getClassStudentsViewModel(classId, week)
    //                                                 roster + name
    //   - AcademyEnrolments.getStudentDisciplineIds(charId, classId)
    //                                                 enrolment filter
    //
    // A student appears in the filter list when they are enrolled in
    // THIS discipline for THIS class. The view does not know the
    // discipline id — it is not on the highlight VM. So we take the
    // discipline id from the SELECTED discipline VM, which the
    // caller passes in. When there is no selected discipline, the
    // filter list is empty.
    //
    // Failure modes:
    //   - AcademyUI or AcademyAggregator missing → empty list
    //   - no class selected                     → empty list
    //   - no selected discipline                → empty list
    //   - aggregator throws                     → empty list, logged
    //
    // Empty list is honest: the user sees "no students available"
    // and the panel's hint text explains why (see the caller).

    function buildHighlightFilterStudents(selectedDiscipline, week) {
        if (!selectedDiscipline || !selectedDiscipline.id) {
            return [];
        }
        if (typeof week !== 'number') {
            return [];
        }

        var AcademyUI = window.AcademyUI;
        var Aggregator = window.AcademyAggregator;
        var Enrolments = window.AcademyEnrolments;

        if (!AcademyUI ||
            typeof AcademyUI.getSelectedClassId !== 'function') {
            return [];
        }
        if (!Aggregator ||
            typeof Aggregator.getClassStudentsViewModel !== 'function') {
            return [];
        }

        var classId = AcademyUI.getSelectedClassId();
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var roster = [];
        try {
            roster = Aggregator.getClassStudentsViewModel(
                classId, week
            ) || [];
        } catch (e) {
            console.warn(
                '[AcademyDisciplineView] getClassStudentsViewModel ' +
                'threw while building the highlight filter:', e
            );
            return [];
        }

        if (!Array.isArray(roster) || roster.length === 0) {
            return [];
        }

        var disciplineId = String(selectedDiscipline.id);
        var targetClass = String(classId);

        var result = [];

        for (var i = 0; i < roster.length; i++) {
            var student = roster[i];
            if (!student || !student.id) { continue; }

            var enrolledHere = true;
            if (Enrolments &&
                typeof Enrolments.getStudentDisciplineIds ===
                    'function') {
                try {
                    var ids = Enrolments.getStudentDisciplineIds(
                        student.id, targetClass
                    ) || [];
                    enrolledHere = ids.indexOf(disciplineId) !== -1;
                } catch (e) {
                    // A read failure here is a data-integrity
                    // problem; treat the student as not enrolled so
                    // the filter list stays honest. The user can
                    // still see the roster elsewhere.
                    enrolledHere = false;
                }
            }

            if (!enrolledHere) { continue; }

            result.push({
                id: String(student.id),
                name: isNonEmptyString(student.name)
                    ? student.name
                    : 'Unknown'
            });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    // ============================================================
    // HIGHLIGHT FILTER — INSTRUCTOR OPTIONS
    // ============================================================
    //
    // The instructor list is resolved from
    // AcademyClasses.getClassInstructorIds, week-scoped to the
    // schedule week and discipline-scoped to the selected discipline.
    // That is the same source the instructor picker modal uses; the
    // filter offers the same set of instructors the picker would.
    //
    // Failure modes collapse to "empty list," same as students.

    function buildHighlightFilterInstructors(selectedDiscipline, week) {
        if (!selectedDiscipline || !selectedDiscipline.id) {
            return [];
        }
        if (typeof week !== 'number') {
            return [];
        }

        var AcademyUI = window.AcademyUI;
        var AcademyClasses = window.AcademyClasses;
        var CQ = window.CharacterQueries;

        if (!AcademyUI ||
            typeof AcademyUI.getSelectedClassId !== 'function') {
            return [];
        }
        if (!AcademyClasses ||
            typeof AcademyClasses.getClassInstructorIds !== 'function') {
            return [];
        }
        if (!CQ || typeof CQ.getCharacterById !== 'function') {
            return [];
        }

        var classId = AcademyUI.getSelectedClassId();
        if (!isNonEmptyString(classId)) {
            return [];
        }

        var ids = [];
        try {
            ids = AcademyClasses.getClassInstructorIds(
                String(classId),
                week,
                { disciplineId: String(selectedDiscipline.id) }
            ) || [];
        } catch (e) {
            console.warn(
                '[AcademyDisciplineView] getClassInstructorIds threw ' +
                'while building the highlight filter:', e
            );
            return [];
        }

        if (!Array.isArray(ids)) { return []; }

        var seen = Object.create(null);
        var result = [];

        for (var i = 0; i < ids.length; i++) {
            if (!isNonEmptyString(ids[i])) { continue; }
            var id = String(ids[i]);
            if (seen[id]) { continue; }
            seen[id] = true;

            var char = CQ.getCharacterById(id);
            if (!char) { continue; }

            var name = CQ.getDisplayName(char);
            if (!isNonEmptyString(name)) { name = 'Unknown'; }

            result.push({ id: id, name: name });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
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
                    vm.scheduleHighlightVM
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
        highlightVM
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
            html += renderScheduleTab(scheduleWeek, highlightVM, selected);
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
    //
    // The schedule tab body: a week selector, the highlight filter
    // panel, the grid host, the enrollment summary host, and the
    // discipline sessions panel host.
    //
    // The class is NOT selectable here. It comes from
    // AcademyUI.getSelectedClassId(). The controller reads the
    // class, mounts the grid into the grid host, mounts the
    // enrollment summary into the summary host, and mounts the
    // sessions panel into the sessions host.
    //
    // All three hosts are intentionally empty at render time. The
    // controller fills them.

    function renderScheduleTab(week, highlightVM, selectedDiscipline) {
        var weekValue = String(week);

        var html = '';
        html += '<div class="academy-discipline-schedule-tab">';

        html += '<div class="academy-discipline-schedule-header">';
        html += '<label class="academy-top-label" ' +
                    'for="academy-discipline-schedule-week">Week:</label>';
        html += '<input type="number" ' +
                    'id="academy-discipline-schedule-week" ' +
                    'class="academy-week-input ' +
                        'academy-discipline-schedule-week" ' +
                    'value="' + escapeAttribute(weekValue) + '" ' +
                    'min="' + escapeAttribute(String(MIN_WEEK)) + '" ' +
                    'max="' + escapeAttribute(String(MAX_WEEK)) + '">';
        html += '<span class="academy-discipline-schedule-hint">' +
                    'Scoped to the Academy-selected class.' +
                '</span>';
        html += '</div>';

        html += renderHighlightFilterPanel(
            week, highlightVM, selectedDiscipline
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
    // HIGHLIGHT FILTER PANEL
    // ============================================================
    //
    // Two states:
    //
    //   No active filter (highlightVM === null):
    //     Closed disclosure. A single toggle button. Clicking it
    //     emits data-action="discipline-schedule-toggle-filter-panel"
    //     which the controller handles by flipping data-expanded on
    //     the wrapper and toggling inline display on the body.
    //     The body carries the instructor select, student multi-
    //     select, check-weeks input, and an Apply button emitting
    //     data-action="discipline-schedule-find-free-slot".
    //
    //   Active filter (highlightVM !== null):
    //     Forced-open disclosure. The body shows a summary line
    //     (instructor name, student count, weeks) and a Clear
    //     button. The Apply button is hidden, since the filter is
    //     already applied. The toggle button is disabled and the
    //     body is shown unconditionally.
    //
    // The launcher's data-action is on the wrapper, not the body,
    // so the delegated click finds the toggle even when a caller
    // clicks somewhere inside the button's padding.

    function renderHighlightFilterPanel(
        week,
        highlightVM,
        selectedDiscipline
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
                week, selectedDiscipline
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

    function renderHighlightForm(week, selectedDiscipline) {
        var instructors = buildHighlightFilterInstructors(
            selectedDiscipline, week
        );
        var students = buildHighlightFilterStudents(
            selectedDiscipline, week
        );

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
        html += '<div class="discipline-highlight-field">';
        html += '<label class="discipline-highlight-label">' +
                    'Students' +
                '</label>';

        if (students.length === 0) {
            html += '<p class="discipline-highlight-empty">' +
                        'No students are enrolled in this discipline ' +
                        'for the selected class.' +
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
        html += '<div class="discipline-highlight-actions">';
        html += '<button type="button" class="primary small" ' +
                    'data-action="discipline-schedule-find-free-slot"' +
                    (instructors.length === 0 || students.length === 0
                        ? ' disabled'
                        : '') + '>' +
                    'Highlight slots' +
                '</button>';
        html += '</div>';

        return html;
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
