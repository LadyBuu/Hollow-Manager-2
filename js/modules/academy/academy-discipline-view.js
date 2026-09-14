/**
 * modules/academy/academy-discipline-view.js - Academy Discipline View
 * Standalone view for browsing and editing disciplines (curriculum)
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
 *
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no domain logic
 *   - Does NOT fetch data. Does NOT call AcademyDisciplines.
 *   - Receives a view model from AcademyView
 *   - Does NOT bind events. Rows, buttons, inputs, and selects emit
 *     data-* attributes (or stable ids) that AcademyView's delegated
 *     container listeners resolve.
 *   - Uses DomUtils for escaping.
 *   - Returns an HTML string.
 *
 * EDITOR MODE:
 *   The view model carries `editorMode`:
 *     'empty'  — nothing selected; render the empty state
 *     'create' — new discipline form, blank defaults
 *     'edit'   — existing discipline form, populated from `selected`
 *
 *   The renderer does NOT distinguish beyond that. It renders whichever
 *   fields it has; the view model always supplies a fully-populated
 *   `selected` object for both 'create' and 'edit'.
 *
 * GRADE SCHEME EDITOR:
 *   The scheme is edited as a band table. Each band is one row:
 *     [ Label input ] [ Min % input ] [ Remove button ]
 *   The preset dropdown sits above the table, with an "Apply Preset"
 *   button. Applying a preset rewrites the bands array in the view
 *   model (via AcademyView's delegated click handler, which calls
 *   back into the view model builder). The renderer is stateless.
 *
 *   The renderer emits per-band rows with stable data attributes:
 *     data-band-index="0"
 *     data-band-field="label"
 *     data-band-field="minPercent"
 *     data-action="remove-band" data-band-index="0"
 *   AcademyView's delegated input listener reads these and updates
 *   a module-scoped draft on AcademyView's side.
 *
 *   LIVE PREVIEW:
 *     The view model supplies `schemePreview` — a precomputed string
 *     like "A: 90–100%, B: 80–89%, ...". The renderer just drops it
 *     in. AcademyView recomputes it after every band edit and
 *     re-renders.
 *
 * ASSESSMENT WEIGHTS EDITOR (Phase 3):
 *   The weights editor is a simple grid: one numeric input per
 *   assessment type. Types come from the view model
 *   (`assessmentTypes`). Weights come from `selected.assessmentWeights`.
 *
 *   The renderer emits per-type inputs with stable data attributes:
 *     data-assessment-weight-type="exam"
 *   AcademyView's delegated input listener reads these and updates
 *   the module-scoped draft.
 *
 *   A "Reset to Default" button emits:
 *     data-action="reset-assessment-weights"
 *   AcademyView's delegated click handler resets the draft's weights
 *   to the domain default.
 *
 *   There is NO live preview for weights. Weight changes affect the
 *   weighted average; showing a "preview" would require the student's
 *   actual grades, which the discipline editor does not have access
 *   to. That's the correct separation: the discipline editor edits
 *   the discipline's configuration; the grades view displays the
 *   result.
 *
 * INTERFACE:
 *   AcademyDisciplineView.renderHTML(viewModel) -> string
 *
 *   viewModel:
 *     {
 *       disciplines: [ <rowVM> ],       // for the sidebar list
 *       selected:    <editorVM>|null,   // for the detail panel
 *       editorMode:  'empty'|'create'|'edit',
 *       filters:     { type, search },
 *       total:       number
 *     }
 *
 *   rowVM:
 *     {
 *       id, name, type, startWeek, endWeek,
 *       weeklyHours, weight,
 *       instructorIds: [ ... ],
 *       instructorNames: [ ... ]
 *     }
 *
 *   editorVM:
 *     {
 *       id:              string|null,   // null when creating
 *       name:            string,
 *       type:            'mandatory'|'optional',
 *       startWeek:       number,
 *       endWeek:         number,
 *       weeklyHours:     number,
 *       weight:          number,
 *       instructorIds:   [ ... ],
 *       instructorNames: [ ... ],       // display-only
 *       availableInstructors: [ { id, name } ],
 *
 *       gradeScheme: {
 *         id:    'letter'|'pass_fail'|'numeric'|'custom',
 *         label: string,
 *         bands: [ { label, minPercent } ]
 *       },
 *       schemePresetId:  string,
 *       schemePreview:   string,
 *
 *       assessmentTypes:   [ 'exam', 'assignment', ... ],
 *       assessmentWeights: { exam: 2.0, assignment: 1.0, ... },
 *
 *       fieldErrors:     { field: message },  // optional; {} when clean
 *       isNew:           boolean
 *     }
 *
 * EVENTS EMITTED (data-* attributes, for AcademyView to bind):
 *   Sidebar:
 *     #academy-add-discipline-btn                    (click)
 *     #academy-discipline-search                     (input)
 *     #academy-discipline-type-filter                (change)
 *     .academy-discipline-row [data-discipline-id]   (click)
 *
 *   Editor — top-level fields:
 *     [data-discipline-field="name"]
 *     [data-discipline-field="type"]
 *     [data-discipline-field="startWeek"]
 *     [data-discipline-field="endWeek"]
 *     [data-discipline-field="weeklyHours"]
 *     [data-discipline-field="weight"]
 *     [data-discipline-field="instructors"]
 *
 *   Editor — grade scheme:
 *     [data-discipline-field="schemeLabel"]
 *     #academy-discipline-scheme-preset              (change)
 *     [data-action="apply-scheme-preset"]            (click)
 *     [data-band-index="N"] [data-band-field="label"]      (input)
 *     [data-band-index="N"] [data-band-field="minPercent"] (input)
 *     [data-action="add-band"]                       (click)
 *     [data-action="remove-band"] [data-band-index="N"] (click)
 *
 *   Editor — assessment weights:
 *     [data-assessment-weight-type="exam"]           (input)
 *     [data-action="reset-assessment-weights"]       (click)
 *
 *   Editor — actions:
 *     [data-action="save-discipline"]                (click)
 *     [data-action="cancel-discipline"]              (click)
 *     [data-action="delete-discipline"]              (click)
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
 *
 * USAGE:
 *   var html = AcademyDisciplineView.renderHTML(vm);
 *   container.innerHTML = html;
 */

(function() {
    'use strict';

    if (window.__academyDisciplineViewLoaded) {
        return;
    }
    window.__academyDisciplineViewLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var DomUtils = window.DomUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }
        if (!DomUtils || typeof DomUtils.escapeAttribute !== 'function') {
            missing.push('DomUtils.escapeAttribute');
        }

        if (missing.length > 0) {
            console.warn('[AcademyDisciplineView] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

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
    // RENDER - Top-level entry point
    // ============================================================

    function renderHTML(viewModel) {
        if (!checkDependencies()) {
            return (
                '<div class="academy-body academy-body-empty">' +
                    '<p class="empty-state">Discipline view dependencies not loaded.</p>' +
                '</div>'
            );
        }

        var vm = viewModel || {};
        var disciplines = Array.isArray(vm.disciplines) ? vm.disciplines : [];
        var selected = vm.selected || null;
        var editorMode = vm.editorMode || 'empty';
        var filters = vm.filters || { type: 'all', search: '' };

        return (
            '<div class="academy-body academy-discipline-layout">' +
                renderListPanel(disciplines, filters) +
                renderDetailPanel(selected, editorMode) +
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
            '<button type="button" id="academy-add-discipline-btn" ' +
                'class="primary small academy-add-discipline-btn">' +
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

        html += '<label class="academy-filter-label">Type:</label>';
        html += '<select id="academy-discipline-type-filter" class="academy-discipline-type-filter">';
        html += '<option value="all" ' + (type === 'all' ? 'selected' : '') + '>All</option>';
        html += '<option value="mandatory" ' + (type === 'mandatory' ? 'selected' : '') + '>Mandatory</option>';
        html += '<option value="optional" ' + (type === 'optional' ? 'selected' : '') + '>Optional</option>';
        html += '</select>';

        html += '</div>';
        return html;
    }

    function renderListItems(disciplines) {
        var html = '<div class="academy-discipline-list" id="academy-discipline-list">';

        if (!Array.isArray(disciplines) || disciplines.length === 0) {
            html += '<p class="empty-state small">No disciplines match the current filters.</p>';
            html += '</div>';
            return html;
        }

        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            if (!d || !d.id) {
                continue;
            }
            html += renderListRow(d);
        }

        html += '</div>';
        return html;
    }

    function renderListRow(d) {
        var badgeClass = getDisciplineTypeBadgeClass(d.type);

        var html = '';
        html += '<div class="academy-discipline-row" ' +
                    'data-discipline-id="' + escapeAttribute(d.id) + '" ' +
                    'role="button" tabindex="0">';

        html += '<div class="academy-discipline-row-main">';
        html += '<span class="academy-discipline-name">' + escapeHtml(d.name || 'Unnamed Discipline') + '</span>';
        html += '<span class="' + badgeClass + '">' + escapeHtml(getDisciplineTypeLabel(d.type)) + '</span>';
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
            html += '<div class="academy-discipline-row-meta">' + meta.join(' &middot; ') + '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // DETAIL PANEL - Right side
    // ============================================================

    function renderDetailPanel(selected, editorMode) {
        var html = '<div class="academy-discipline-detail" id="academy-discipline-detail">';

        if (editorMode === 'empty' || !selected) {
            html += renderEmptyDetailState();
        } else {
            html += renderEditor(selected);
        }

        html += '</div>';
        return html;
    }

    function renderEmptyDetailState() {
        return (
            '<div class="academy-detail-empty">' +
                '<p class="empty-state small">Select a discipline to view its details, or click "+ Add Discipline".</p>' +
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
        html += '<div class="academy-discipline-editor-field academy-discipline-editor-field-wide">';
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
                    'min="1" max="52">';
        html += renderFieldError(errors, 'startWeek');
        html += '</div>';

        // End week
        html += '<div class="academy-discipline-editor-field">';
        html += '<label for="academy-discipline-end-week">End Week</label>';
        html += '<input type="number" id="academy-discipline-end-week" ' +
                    'class="' + withErrorClass('academy-discipline-input', errors, 'endWeek') + '" ' +
                    'data-discipline-field="endWeek" ' +
                    'value="' + escapeAttribute(safeString(d.endWeek)) + '" ' +
                    'min="1" max="52">';
        html += renderFieldError(errors, 'endWeek');
        html += '</div>';

        // Weekly hours
        html += '<div class="academy-discipline-editor-field">';
        html += '<label for="academy-discipline-weekly-hours">Weekly Hours</label>';
        html += '<input type="number" id="academy-discipline-weekly-hours" ' +
                    'class="' + withErrorClass('academy-discipline-input', errors, 'weeklyHours') + '" ' +
                    'data-discipline-field="weeklyHours" ' +
                    'value="' + escapeAttribute(safeString(d.weeklyHours)) + '" ' +
                    'min="0.5" max="40" step="0.5">';
        html += renderFieldError(errors, 'weeklyHours');
        html += '</div>';

        // Weight
        html += '<div class="academy-discipline-editor-field">';
        html += '<label for="academy-discipline-weight">Weight</label>';
        html += '<input type="number" id="academy-discipline-weight" ' +
                    'class="' + withErrorClass('academy-discipline-input', errors, 'weight') + '" ' +
                    'data-discipline-field="weight" ' +
                    'value="' + escapeAttribute(safeString(d.weight)) + '" ' +
                    'min="0.1" max="10" step="0.1">';
        html += renderFieldError(errors, 'weight');
        html += '</div>';

        html += '</div>'; // grid
        html += '</div>'; // section

        // ---- Instructors ----
        html += '<div class="academy-discipline-editor-section">';
        html += '<div class="academy-discipline-editor-field academy-discipline-editor-field-wide">';
        html += '<label for="academy-discipline-instructors">Instructors</label>';
        html += '<select id="academy-discipline-instructors" ' +
                    'class="' + withErrorClass('academy-discipline-input academy-discipline-instructors', errors, 'instructors') + '" ' +
                    'data-discipline-field="instructors" ' +
                    'multiple size="6">';
        html += renderInstructorOptions(d);
        html += '</select>';
        html += '<p class="field-hint">Ctrl/Cmd-click to select multiple.</p>';
        html += renderFieldError(errors, 'instructors');
        html += '</div>';
        html += '</div>';

        // ---- Grade scheme ----
        html += renderGradeSchemeSection(d, errors);

        // ---- Assessment weights (Phase 3) ----
        html += renderAssessmentWeightsSection(d, errors);

        // ---- Actions ----
        html += renderEditorActions(d);

        return html;
    }

    function renderInstructorOptions(d) {
        var available = Array.isArray(d.availableInstructors)
            ? d.availableInstructors
            : null;

        var selectedIds = Array.isArray(d.instructorIds) ? d.instructorIds : [];
        var selectedNames = Array.isArray(d.instructorNames) ? d.instructorNames : [];

        if (available && available.length > 0) {
            var html = '';
            var seen = {};
            for (var i = 0; i < available.length; i++) {
                var inst = available[i];
                if (!inst || !inst.id) { continue; }
                var isSelected = false;
                for (var j = 0; j < selectedIds.length; j++) {
                    if (String(selectedIds[j]) === String(inst.id)) {
                        isSelected = true;
                        break;
                    }
                }
                seen[String(inst.id)] = true;
                html += '<option value="' + escapeAttribute(inst.id) + '"' +
                            (isSelected ? ' selected' : '') + '>' +
                            escapeHtml(inst.name || inst.id) +
                        '</option>';
            }
            // Any selected ID not present in the available list is
            // rendered as a selected option so it is not silently
            // dropped.
            for (var k = 0; k < selectedIds.length; k++) {
                var sid = String(selectedIds[k]);
                if (seen[sid]) { continue; }
                var sname = selectedNames[k] || sid;
                html += '<option value="' + escapeAttribute(sid) + '" selected>' +
                            escapeHtml(sname) +
                        '</option>';
            }
            return html;
        }

        if (selectedIds.length === 0) {
            return '<option value="" disabled>No instructors available</option>';
        }

        var out = '';
        for (var m = 0; m < selectedIds.length; m++) {
            var id = selectedIds[m];
            var name = selectedNames[m] || id;
            out += '<option value="' + escapeAttribute(id) + '" selected>' +
                        escapeHtml(name) +
                    '</option>';
        }
        return out;
    }

    // ============================================================
    // GRADE SCHEME SECTION
    // ============================================================

    function renderGradeSchemeSection(d, errors) {
        var scheme = d.gradeScheme && typeof d.gradeScheme === 'object'
            ? d.gradeScheme
            : { id: 'numeric', label: 'Numeric', bands: [{ label: '%', minPercent: 0 }] };

        var bands = Array.isArray(scheme.bands) ? scheme.bands : [];
        var presetId = d.schemePresetId || scheme.id || 'numeric';
        var preview = isNonEmptyString(d.schemePreview) ? d.schemePreview : '';

        var html = '';
        html += '<div class="academy-discipline-editor-section academy-discipline-scheme-section">';
        html += '<div class="academy-discipline-scheme-header">';
        html += '<h4 class="academy-discipline-editor-section-title">Grade Scheme</h4>';
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
        html += '<option value="letter"' +
                    (presetId === 'letter' ? ' selected' : '') +
                    '>Letter Grade</option>';
        html += '<option value="pass_fail"' +
                    (presetId === 'pass_fail' ? ' selected' : '') +
                    '>Pass / Fail</option>';
        html += '<option value="numeric"' +
                    (presetId === 'numeric' ? ' selected' : '') +
                    '>Numeric</option>';
        html += '<option value="custom"' +
                    (presetId === 'custom' ? ' selected' : '') +
                    '>Custom</option>';
        html += '</select>';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="apply-scheme-preset">' +
                    'Apply Preset' +
                '</button>';
        html += '</div>';
        html += '<p class="field-hint">Applying a preset replaces the bands below.</p>';
        html += '</div>';

        html += '</div>'; // grid

        // ---- Band editor ----
        html += '<div class="academy-discipline-scheme-bands">';
        html += '<div class="academy-discipline-scheme-bands-header">';
        html += '<span class="academy-discipline-scheme-bands-title">Bands</span>';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="add-band">' +
                    '+ Add Band' +
                '</button>';
        html += '</div>';

        html += renderFieldError(errors, 'bands');

        if (bands.length === 0) {
            html += '<p class="empty-state small">No bands. Add at least one band with min % 0.</p>';
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
                html += renderBandRow(bands[i], i, errors);
            }
            html += '</tbody>';
            html += '</table>';
        }

        html += '</div>'; // bands

        if (isNonEmptyString(preview)) {
            html += '<div class="academy-discipline-scheme-preview">';
            html += '<span class="academy-discipline-scheme-preview-label">Preview:</span> ';
            html += '<span class="academy-discipline-scheme-preview-text">' +
                        escapeHtml(preview) +
                    '</span>';
            html += '</div>';
        }

        html += '</div>'; // section
        return html;
    }

    function renderBandRow(band, index, errors) {
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
            html += '<p class="academy-field-error">' + escapeHtml(labelErr) + '</p>';
        }
        html += '</td>';

        html += '<td class="scheme-min-col">';
        html += '<input type="number" ' +
                    'class="academy-discipline-input academy-discipline-band-min' +
                    (minErr ? ' academy-field-has-error' : '') + '" ' +
                    'data-band-index="' + escapeAttribute(String(index)) + '" ' +
                    'data-band-field="minPercent" ' +
                    'value="' + escapeAttribute(minP) + '" ' +
                    'min="0" max="100" step="1" ' +
                    'placeholder="0">';
        if (minErr) {
            html += '<p class="academy-field-error">' + escapeHtml(minErr) + '</p>';
        }
        html += '</td>';

        html += '<td class="scheme-actions-col">';
        html += '<button type="button" class="small danger" ' +
                    'data-action="remove-band" ' +
                    'data-band-index="' + escapeAttribute(String(index)) + '" ' +
                    'title="Remove band">\u2715</button>';
        html += '</td>';

        html += '</tr>';
        return html;
    }

    // ============================================================
    // ASSESSMENT WEIGHTS SECTION (Phase 3)
    // ============================================================
    //
    // One numeric input per assessment type. Types come from the view
    // model. Weights come from selected.assessmentWeights. A "Reset
    // to Default" button emits data-action="reset-assessment-weights".
    //
    // No live preview. The editor edits configuration; it does not
    // have student grades to preview against.

    function renderAssessmentWeightsSection(d, errors) {
        var types = Array.isArray(d.assessmentTypes) ? d.assessmentTypes : [];
        var weights = d.assessmentWeights && typeof d.assessmentWeights === 'object'
            ? d.assessmentWeights
            : {};

        var html = '';
        html += '<div class="academy-discipline-editor-section academy-discipline-weights-section">';

        html += '<div class="academy-discipline-weights-header">';
        html += '<h4 class="academy-discipline-editor-section-title">Assessment Weights</h4>';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="reset-assessment-weights">' +
                    'Reset to Default' +
                '</button>';
        html += '</div>';

        html += '<p class="field-hint academy-discipline-weights-hint">' +
                    'Each assessment type contributes to a student\'s weighted average ' +
                    'in proportion to its weight. Weight 1.0 is neutral.' +
                '</p>';

        if (types.length === 0) {
            html += '<p class="empty-state small">No assessment types configured.</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="academy-discipline-weights-grid">';

        for (var i = 0; i < types.length; i++) {
            var type = types[i];
            if (!isNonEmptyString(type)) { continue; }

            var value = isFiniteNumber(weights[type]) ? weights[type] : '';
            var label = type.charAt(0).toUpperCase() + type.slice(1);

            html += '<div class="academy-discipline-weights-field">';
            html += '<label for="academy-discipline-weight-' + escapeAttribute(type) + '">' +
                        escapeHtml(label) +
                    '</label>';
            html += '<input type="number" ' +
                        'id="academy-discipline-weight-' + escapeAttribute(type) + '" ' +
                        'class="academy-discipline-input academy-discipline-weight-input" ' +
                        'data-assessment-weight-type="' + escapeAttribute(type) + '" ' +
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
                    'data-action="save-discipline">' +
                    (isNew ? 'Create Discipline' : 'Save Changes') +
                '</button>';

        html += '<button type="button" class="secondary" ' +
                    'data-action="cancel-discipline">' +
                    'Cancel' +
                '</button>';

        if (!isNew) {
            html += '<button type="button" class="danger academy-discipline-delete-btn" ' +
                        'data-action="delete-discipline" ' +
                        'data-discipline-id="' + escapeAttribute(d.id || '') + '">' +
                        'Delete Discipline' +
                    '</button>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyDisciplineView = {
        renderHTML: renderHTML
    };

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyDisciplineView;
        var missing = [];

        var required = ['renderHTML'];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademyDisciplineView] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();
