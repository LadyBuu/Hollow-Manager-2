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
 *   - RENDER ONLY - no mutations, no domain logic.
 *   - Does NOT fetch data. Does NOT call AcademyDisciplines.
 *   - Receives a view model from AcademyDisciplineController.
 *   - The VM's editor section comes from
 *     AcademyAggregator.getDisciplineEditorViewModel.
 *   - Does NOT bind events. Rows, buttons, inputs, and selects emit
 *     data-* attributes (or stable ids) that AcademyView's delegated
 *     container listeners resolve.
 *   - Uses DomUtils for escaping (MANDATORY, no fallback).
 *   - Returns an HTML string.
 *
 * EDITOR MODE:
 *   The view model carries `editorMode`:
 *     'empty'  — nothing selected; render the empty state
 *     'create' — new discipline form, blank defaults
 *     'edit'   — existing discipline form, populated from `selected`
 *
 *   The renderer does NOT distinguish beyond that.
 *
 * INPUT BOUNDS:
 *   Numeric input bounds (week range, hours, weight, band percent)
 *   come from the view model, not from hardcoded literals. This keeps
 *   the view decoupled from AcademyDisciplines's constants and lets
 *   the aggregator own the values.
 *
 * EVENTS EMITTED (data-* attributes, for AcademyView to bind):
 *   Sidebar:
 *     [data-action="discipline-add"]                 (click) — v27
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
 * v27 CHANGES:
 *   - The "+ Add Discipline" button was previously id-addressed
 *     (#academy-add-discipline-btn) and did not route through the
 *     controller's dispatch. It is now emitted with
 *     data-action="discipline-add", matching every other action in
 *     this view. The controller's dispatch switch has a matching
 *     case.
 *   - The instructor selector was REMOVED from the discipline editor.
 *     The relationship it expressed ("who teaches this discipline")
 *     is class-scoped and lives on the class-disciplines picker.
 *     AcademyDisciplines no longer carries an instructorIds field,
 *     and this editor no longer renders or emits one.
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

    var DomUtils = window.DomUtils;

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        throw new Error(
            '[AcademyDisciplineView] Missing mandatory dependency: ' +
            'DomUtils.escapeHtml / DomUtils.escapeAttribute'
        );
    }

    window.__academyDisciplineViewLoaded = true;

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

        if (!Array.isArray(disciplines) || disciplines.length === 0) {
            html += '<p class="empty-state small">' +
                        'No disciplines match the current filters.' +
                    '</p>';
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

    function renderDetailPanel(selected, editorMode) {
        var html = '<div class="academy-discipline-detail" ' +
                    'id="academy-discipline-detail">';

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
                '<p class="empty-state small">' +
                    'Select a discipline to view its details, ' +
                    'or click "+ Add Discipline".' +
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

        var weekBounds = d.weekBounds || { min: 1, max: 52 };
        var weeklyHoursBounds = d.weeklyHoursBounds || { min: 0.5, max: 40, step: 0.5 };
        var weightBounds = d.weightBounds || { min: 0.1, max: 10, step: 0.1 };
        var bandPercentBounds = d.bandPercentBounds || { min: 0, max: 100, step: 1 };

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
        var scheme = d.gradeScheme && typeof d.gradeScheme === 'object'
            ? d.gradeScheme
            : { id: 'numeric', label: 'Numeric', bands: [{ label: '%', minPercent: 0 }] };

        var bands = Array.isArray(scheme.bands) ? scheme.bands : [];
        var presetId = isNonEmptyString(d.schemePresetId)
            ? d.schemePresetId
            : 'numeric';
        var preview = isNonEmptyString(d.schemePreview) ? d.schemePreview : '';

        var presets = Array.isArray(d.schemePresets) ? d.schemePresets : [];

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
            if (!preset || !preset.id) { continue; }
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
    //
    // One numeric input per assessment type. Types come from the view
    // model. Weights come from selected.assessmentWeights.
    //
    // No live preview. The editor edits configuration; it does not
    // have student grades to preview against.

    function renderAssessmentWeightsSection(d, errors) {
        var types = Array.isArray(d.assessmentTypes) ? d.assessmentTypes : [];
        var weights = d.assessmentWeights && typeof d.assessmentWeights === 'object'
            ? d.assessmentWeights
            : {};

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
            if (!isNonEmptyString(type)) { continue; }

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

})();