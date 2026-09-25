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
 *   - Rendering the Schedule tab body (week selector + grid host +
 *     enrollment summary host)
 *
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no domain logic.
 *   - Does NOT fetch data. Does NOT call AcademyDisciplines.
 *   - Receives a view model from AcademyDisciplineController.
 *   - Does NOT bind events. Rows, buttons, inputs, and selects emit
 *     data-* attributes (or stable ids) that AcademyView's delegated
 *     container listeners resolve.
 *   - Uses DomUtils for escaping (MANDATORY, no fallback).
 *   - Returns an HTML string.
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
 *     scheduleWeek:  number                  // valid while Schedule tab exists
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
 *   Every bound object and every list is guaranteed present. This
 *   renderer does not fall back; if a field the contract names is
 *   missing, that is the controller's bug.
 *
 * TABS:
 *   The detail panel gains a two-tab bar when a discipline is
 *   selected or a new draft is open:
 *
 *     Edit       the existing discipline editor.
 *     Schedule   a calendar grid scoped to (this discipline, the
 *                Academy-selected class, the display week), plus a
 *                summary panel below the grid that reports how many
 *                students are enrolled and how many are still
 *                without a group.
 *
 *   The active tab is carried on the VM as `activeTab`. When the
 *   editor mode is 'empty' (no discipline selected, no draft),
 *   neither tab renders; the empty state shows instead.
 *
 *   The Schedule tab is READ-ONLY. The controller mounts the grid
 *   into #academy-discipline-schedule-host and the summary into
 *   #academy-discipline-schedule-summary-host. The class is NOT
 *   selectable here; it comes from AcademyUI.getSelectedClassId().
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
 *
 *   Editor — top-level fields:
 *     [data-discipline-field="name"]
 *     [data-discipline-field="type"]
 *     [data-discipline-field="startWeek"]
 *     [data-discipline-field="endWeek"]
 *     [data-discipline-field="weeklyHours"]
 *     [data-discipline-field="weight"]
 *
 *   Editor — grade scheme:
 *     [data-discipline-field="schemeLabel"]
 *     [data-discipline-field="schemePresetId"]
 *     [data-action="discipline-apply-scheme-preset"]            (click)
 *     [data-band-index="N"] [data-band-field="label"]           (input)
 *     [data-band-index="N"] [data-band-field="minPercent"]      (input)
 *     [data-action="discipline-add-band"]                       (click)
 *     [data-action="discipline-remove-band"] [data-band-index="N"] (click)
 *
 *   Editor — assessment weights:
 *     [data-assessment-weight-type="exam"]                      (input)
 *     [data-action="discipline-reset-assessment-weights"]       (click)
 *
 *   Editor — actions:
 *     [data-action="discipline-save"]                           (click)
 *     [data-action="discipline-cancel"]                         (click)
 *     [data-action="discipline-delete"] [data-discipline-id]    (click)
 *
 * TERMINOLOGY:
 *   The discipline domain is an Academy concern. The retired
 *   `curriculum` subsystem is no longer referenced here. The word
 *   "curriculum" does not appear in this module.
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
    var DEFAULT_TAB = 'edit';

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
    //
    // Strict. The renderer trusts the VM's shape. Missing fields are
    // controller bugs and must surface, not be silently replaced.

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
                    vm.scheduleWeek
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

    function renderDetailPanel(selected, editorMode, activeTab, scheduleWeek) {
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
            html += renderScheduleTab(scheduleWeek);
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
    // The schedule tab body: a week selector, the grid host, and the
    // enrollment summary host.
    //
    // The class is NOT selectable here. It comes from
    // AcademyUI.getSelectedClassId(). The controller reads the
    // class, mounts the grid into the grid host, and mounts the
    // enrollment summary into the summary host.
    //
    // Both hosts are intentionally empty at render time. The
    // controller fills them.
    //
    // `week` is guaranteed a finite number by the VM contract.

    function renderScheduleTab(week) {
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

        html += '<div id="academy-discipline-schedule-host" ' +
                    'class="academy-discipline-schedule-host"></div>';

        // Summary host. Populated by the controller after the grid
        // is mounted. Empty on its own.
        html += '<div id="academy-discipline-schedule-summary-host" ' +
                    'class="academy-discipline-schedule-summary-host">' +
                '</div>';

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

        // Every bounds object is guaranteed by the VM contract. A
        // missing one is a controller bug, not a request for the
        // legacy hard-coded default.
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

        // Name
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

        // Type
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

        // Start week
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

        // End week
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

        // Weekly hours
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

        // Weight
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

        html += '</div>'; // grid
        html += '</div>'; // section

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
        // The canonical shape is guaranteed by the VM contract. A
        // missing scheme is a controller bug; the renderer does not
        // fabricate a numeric default.
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

        html += '</div>'; // grid

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

        html += '</div>'; // bands

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

        html += '</div>'; // section
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

        html += '</div>'; // grid
        html += '</div>'; // section

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
