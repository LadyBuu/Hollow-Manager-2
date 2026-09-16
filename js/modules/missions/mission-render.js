/**
 * js/modules/missions/mission-render.js - Mission Rendering
 *
 * Path: js/modules/missions/mission-render.js
 *
 * Pure HTML rendering for the mission UI.
 *
 * WHAT THIS MODULE OWNS:
 *   - Turning a mission view model into HTML strings.
 *   - Rendering the shell markup (list container, modals).
 *   - Emitting data-* attributes for the UI controller to dispatch
 *     on.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Data. Every value comes off the VM. No queries, no domain
 *     reads, no team lookups, no character lookups, no date parsing.
 *   - State. This module does not track which mission is selected,
 *     which filter is applied, or which modal is open. The UI
 *     controller owns that.
 *   - Events. No addEventListener. All interaction is emitted as
 *     data-action attributes.
 *   - Composition. MissionAggregator builds VMs; this module only
 *     formats them.
 *
 * VM CONTRACT:
 *   The renderer trusts the VM shape the aggregator produces. It
 *   does not default missing fields to fabricated values. When a
 *   VM field is absent, the renderer either omits that region of
 *   the markup or shows a clearly-marked empty state. It never
 *   invents data.
 *
 * DATA-ACTION CONVENTION:
 *   Every interactive element that the controller should respond to
 *   carries data-action="<verb>". The controller's delegated
 *   listener reads the attribute and dispatches.
 *
 *   Actions emitted here:
 *     mission-list-item          (row click; opens detail)
 *     mission-new                (new mission button)
 *     mission-edit               (edit button on detail panel)
 *     mission-delete             (delete button on detail panel)
 *     mission-archive            (archive button on detail panel)
 *     mission-unarchive          (unarchive button)
 *     mission-complete           (complete button)
 *     mission-cancel             (cancel button)
 *     mission-reactivate         (reactivate button)
 *     mission-objective-toggle   (objective checkbox)
 *     mission-add-objective      (add-objective button)
 *     mission-remove-objective   (remove-objective button)
 *     mission-add-support        (add-support button)
 *     mission-remove-support     (remove-support button)
 *     mission-add-log            (add-log button)
 *     mission-report-add         (add-report button)
 *     mission-report-edit        (edit-report button)
 *     mission-report-delete      (delete-report button)
 *     mission-close-detail       (close button on detail modal)
 *     mission-close-form         (close button on form modal)
 *
 *   Each action carries the identity it needs via data-* attributes:
 *     data-mission-id            mission UUID
 *     data-objective-index       objective index (integer)
 *     data-character-id          character UUID
 *     data-report-id             report UUID
 *
 * MODAL SHELL CONVENTION:
 *   renderContainer() emits the modal shells. Each shell has a
 *   stable id so the UI controller can find it:
 *     #mission-detail-modal
 *     #mission-form-modal
 *   The controller opens and closes them by toggling the `hidden`
 *   class. Modal content is written into stable host elements:
 *     #mission-detail-content
 *     #mission-form-content
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 */

(function() {
    'use strict';

    if (window.__missionRenderLoaded) {
        return;
    }

    var DomUtils = window.DomUtils;

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        throw new Error(
            '[MissionRender] Missing mandatory dependency: ' +
            'DomUtils.escapeHtml / DomUtils.escapeAttribute'
        );
    }

    window.__missionRenderLoaded = true;

    // ============================================================
    // ESCAPING
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

    function isArray(value) {
        return Array.isArray(value);
    }

    function safeString(value) {
        if (value === undefined || value === null) { return ''; }
        return String(value);
    }

    // ============================================================
    // SHELL
    // ============================================================

    /**
     * Render the top-level container: header, filter bar, list
     * host, and modal shells.
     *
     * @param {object} vm - Optional { filter, counts }
     * @returns {string} HTML string
     */
    function renderContainer(vm) {
        vm = vm || {};
        var filter = isNonEmptyString(vm.filter) ? vm.filter : 'all';
        var counts = vm.counts || {};

        var html = '';

        html += '<div class="page-header">';
        html += '<h2>Mission Manager</h2>';
        html += '<div class="header-actions">';
        html += '<button type="button" class="primary" ' +
                    'data-action="mission-new">' +
                    '+ New Mission' +
                '</button>';
        html += '</div>';
        html += '</div>';

        html += '<div class="filter-section">';
        html += '<label for="mission-filter">Filter:</label>';
        html += '<select id="mission-filter" class="mission-filter-select">';
        html += '<option value="all"' +
                    (filter === 'all' ? ' selected' : '') +
                    '>All Missions</option>';
        html += '<option value="active"' +
                    (filter === 'active' ? ' selected' : '') +
                    '>Active</option>';
        html += '<option value="completed"' +
                    (filter === 'completed' ? ' selected' : '') +
                    '>Completed</option>';
        html += '<option value="cancelled"' +
                    (filter === 'cancelled' ? ' selected' : '') +
                    '>Cancelled</option>';
        html += '</select>';

        html += '<span class="mission-count">';
        html += 'Total: <span id="mission-count-total">' +
                    escapeHtml(safeString(counts.total || 0)) +
                '</span>';
        if (isNonEmptyString(String(counts.readyForCompletion))) {
            html += ' &middot; Ready: ' +
                '<span id="mission-count-ready">' +
                    escapeHtml(safeString(counts.readyForCompletion)) +
                '</span>';
        }
        html += '</span>';
        html += '</div>';

        html += '<div id="missions-list" class="missions-list"></div>';

        html += renderModals();

        return html;
    }

    function renderModals() {
        var html = '';

        html += '<div id="mission-detail-modal" class="modal hidden">' +
                    '<div class="modal-content modal-detail-content">' +
                        '<div class="modal-header">' +
                            '<h3 id="mission-detail-title">Mission</h3>' +
                            '<button type="button" class="close-modal" ' +
                                    'data-action="mission-close-detail">' +
                                '&times;' +
                            '</button>' +
                        '</div>' +
                        '<div class="modal-body">' +
                            '<div id="mission-detail-content"></div>' +
                        '</div>' +
                    '</div>' +
                '</div>';

        html += '<div id="mission-form-modal" class="modal hidden">' +
                    '<div class="modal-content modal-form-content">' +
                        '<div class="modal-header">' +
                            '<h3 id="mission-form-title">Mission</h3>' +
                            '<button type="button" class="close-modal" ' +
                                    'data-action="mission-close-form">' +
                                '&times;' +
                            '</button>' +
                        '</div>' +
                        '<div class="modal-body">' +
                            '<div id="mission-form-content"></div>' +
                        '</div>' +
                    '</div>' +
                '</div>';

        return html;
    }

    // ============================================================
    // LIST
    // ============================================================

    /**
     * Render the list of missions.
     *
     * @param {array} missions - List item VMs from
     *   MissionAggregator.getMissionListViewModel
     * @returns {string} HTML string
     */
    function renderList(missions) {
        if (!isArray(missions) || missions.length === 0) {
            return '<p class="empty-state">No missions found.</p>';
        }

        var html = '';

        for (var i = 0; i < missions.length; i++) {
            var item = missions[i];
            if (!item) { continue; }
            html += renderListItem(item);
        }

        return html;
    }

    function renderListItem(item) {
        var classes = 'list-item mission-item';
        if (item.isArchived) { classes += ' mission-archived'; }
        if (item.isCompleted) { classes += ' mission-completed'; }
        if (item.isCancelled) { classes += ' mission-cancelled'; }

        var html = '';

        html += '<div class="' + classes + '" ' +
                    'data-action="mission-list-item" ' +
                    'data-mission-id="' +
                        escapeAttribute(item.id) + '">';

        html += '<span class="mission-id">' +
                    escapeHtml(item.missionId || '—') +
                '</span>';

        html += '<span class="mission-date">' +
                    escapeHtml(item.dateDisplay || '') +
                '</span>';

        html += '<span class="mission-title">';
        html += '<strong>' + escapeHtml(item.title || 'Untitled') + '</strong>';
        if (item.isCompleted) {
            html += ' <span class="mission-completed-badge">✓</span>';
        }
        if (item.isArchived) {
            html += ' <span class="mission-archived-badge">Archived</span>';
        }
        if (item.supportCount > 0) {
            html += ' <span class="mission-support-badge">+' +
                        escapeHtml(String(item.supportCount)) +
                        ' support</span>';
        }
        html += '</span>';

        html += '<span class="mission-type">' +
                    escapeHtml(item.typeDisplay || '') +
                '</span>';

        html += '<span class="mission-escalation">' +
                    escapeHtml(item.escalationLabel || '') +
                '</span>';

        html += '<span class="mission-priority ' +
                    escapeAttribute(item.priorityClass) + '">' +
                    escapeHtml(item.priorityLabel) +
                '</span>';

        html += '<span class="mission-difficulty">' +
                    escapeHtml(item.difficultyLabel) +
                '</span>';

        html += '<span class="mission-status ' +
                    escapeAttribute(item.statusClass) + '">' +
                    escapeHtml(item.statusLabel) +
                '</span>';

        html += '<span class="mission-team">' +
                    escapeHtml(item.teamName || 'Unassigned') +
                '</span>';

        html += '<span class="mission-progress">';
        html += '<div class="progress-bar">' +
                    '<div class="progress-fill" ' +
                        'style="width:' +
                            escapeAttribute(String(item.progress || 0)) +
                        '%;"></div>' +
                '</div>';
        html += '<span class="progress-label">' +
                    escapeHtml(String(item.progress || 0)) +
                    '%</span>';
        html += '</span>';

        html += '</div>';

        return html;
    }

    // ============================================================
    // DETAIL
    // ============================================================

    /**
     * Render the mission detail panel.
     *
     * @param {object} vm - Detail VM from
     *   MissionAggregator.getMissionDetailViewModel
     * @returns {string} HTML string
     */
    function renderDetail(vm) {
        if (!vm || !vm.id) {
            return '<p class="empty-state">Mission not found.</p>';
        }

        var html = '';

        html += '<div class="mission-detail" ' +
                    'data-mission-id="' + escapeAttribute(vm.id) + '">';

        html += renderDetailHeader(vm);
        html += renderDetailFields(vm);
        html += renderObjectives(vm);
        html += renderSupportPersonnel(vm);
        html += renderReports(vm);
        html += renderLog(vm);
        html += renderDetailActions(vm);

        html += '</div>';

        return html;
    }

    function renderDetailHeader(vm) {
        var html = '';
        html += '<div class="mission-detail-header">';

        html += '<div class="mission-detail-title-row">';
        html += '<h3 class="mission-detail-title">' +
                    escapeHtml(vm.title || 'Untitled') +
                '</h3>';
        html += '<span class="mission-status ' +
                    escapeAttribute(vm.statusClass) + '">' +
                    escapeHtml(vm.statusLabel) +
                '</span>';
        html += '<span class="mission-priority ' +
                    escapeAttribute(vm.priorityClass) + '">' +
                    escapeHtml(vm.priorityLabel) +
                '</span>';
        html += '</div>';

        if (isNonEmptyString(vm.missionId)) {
            html += '<div class="mission-detail-id">' +
                        'Mission ID: ' +
                        '<span class="mission-id-display">' +
                            escapeHtml(vm.missionId) +
                        '</span>' +
                    '</div>';
        }

        if (isNonEmptyString(vm.description)) {
            html += '<p class="mission-detail-description">' +
                        escapeHtml(vm.description) +
                    '</p>';
        }

        html += '</div>';
        return html;
    }

    function renderDetailFields(vm) {
        var html = '';
        html += '<div class="mission-detail-fields">';

        html += renderDetailRow('Date', vm.dateDisplay);
        html += renderDetailRow('Difficulty', vm.difficultyLabel);
        html += renderDetailRow('Type', vm.typeDisplay);
        html += renderDetailRow('Escalation', vm.escalationLabel);
        html += renderDetailRow('Team', vm.teamName);
        html += renderDetailRow('Location', vm.location);
        html += renderDetailRow('Duration', vm.duration);
        html += renderDetailRow('Billing', vm.billingLabel);

        if (isNonEmptyString(vm.pay)) {
            html += renderDetailRow('Pay', vm.pay);
        }

        html += renderDetailRow('Created', vm.createdAtDisplay);
        html += renderDetailRow('Completed', vm.completedAtDisplay);
        if (isNonEmptyString(vm.archivedAtDisplay)) {
            html += renderDetailRow('Archived', vm.archivedAtDisplay);
        }

        if (isNonEmptyString(vm.threatType)) {
            html += renderDetailRow('Threat type', vm.threatType);
        }
        if (isNonEmptyString(vm.environment)) {
            html += renderDetailRow('Environment', vm.environment);
        }

        if (isNonEmptyString(vm.notes)) {
            html += '<div class="detail-row description-row">' +
                        '<span class="label">Notes:</span>' +
                        '<span class="description-text">' +
                            escapeHtml(vm.notes) +
                        '</span>' +
                    '</div>';
        }

        if (isArray(vm.tags) && vm.tags.length > 0) {
            html += '<div class="detail-row tags-row">' +
                        '<span class="label">Tags:</span>' +
                        '<span class="tags-list">';
            for (var i = 0; i < vm.tags.length; i++) {
                html += '<span class="tag">#' +
                            escapeHtml(vm.tags[i]) +
                        '</span>';
            }
            html += '</span></div>';
        }

        html += '</div>';
        return html;
    }

    function renderDetailRow(label, value) {
        if (!isNonEmptyString(value)) { return ''; }
        return (
            '<div class="detail-row">' +
                '<span class="label">' + escapeHtml(label) + ':</span>' +
                '<span>' + escapeHtml(value) + '</span>' +
            '</div>'
        );
    }

    function renderObjectives(vm) {
        var html = '';
        html += '<div class="objectives-section">';

        html += '<div class="section-header">';
        html += '<strong>Objectives</strong>';
        html += '<span class="progress-label">' +
                    escapeHtml(String(vm.progress || 0)) + '%' +
                '</span>';
        if (vm.capabilities && vm.capabilities.modifyObjectives) {
            html += '<button type="button" class="small secondary" ' +
                        'data-action="mission-add-objective" ' +
                        'data-mission-id="' + escapeAttribute(vm.id) + '">' +
                        '+ Objective' +
                    '</button>';
        }
        html += '</div>';

        html += '<div class="progress-bar">' +
                    '<div class="progress-fill" ' +
                        'style="width:' +
                            escapeAttribute(String(vm.progress || 0)) +
                        '%;"></div>' +
                '</div>';

        if (!isArray(vm.objectives) || vm.objectives.length === 0) {
            html += '<p class="empty-state small">No objectives.</p>';
            html += '</div>';
            return html;
        }

        html += '<ul class="objectives-list">';

        for (var i = 0; i < vm.objectives.length; i++) {
            var obj = vm.objectives[i];
            var doneClass = obj.done ? ' objective-done' : '';

            html += '<li class="objective-item' + doneClass + '">';

            if (vm.capabilities && vm.capabilities.modifyObjectives) {
                html += '<input type="checkbox" class="objective-check" ' +
                            (obj.done ? 'checked ' : '') +
                            'data-action="mission-objective-toggle" ' +
                            'data-mission-id="' +
                                escapeAttribute(vm.id) + '" ' +
                            'data-objective-index="' +
                                escapeAttribute(String(obj.index)) + '">';
            } else {
                html += '<span class="objective-check-static">' +
                            (obj.done ? '✓' : '·') +
                        '</span>';
            }

            html += '<span class="objective-text">' +
                        escapeHtml(obj.text) +
                    '</span>';

            if (vm.capabilities && vm.capabilities.modifyObjectives) {
                html += '<button type="button" class="small danger" ' +
                            'data-action="mission-remove-objective" ' +
                            'data-mission-id="' +
                                escapeAttribute(vm.id) + '" ' +
                            'data-objective-index="' +
                                escapeAttribute(String(obj.index)) + '">' +
                            '×' +
                        '</button>';
            }

            html += '</li>';
        }

        html += '</ul>';
        html += '</div>';
        return html;
    }

    function renderSupportPersonnel(vm) {
        var html = '';
        html += '<div class="support-section">';

        html += '<div class="section-header">';
        html += '<strong>Support Personnel</strong>';
        html += '<span class="count">' +
                    escapeHtml(String(vm.supportCount || 0)) +
                '</span>';
        if (vm.capabilities && vm.capabilities.edit) {
            html += '<button type="button" class="small secondary" ' +
                        'data-action="mission-add-support" ' +
                        'data-mission-id="' + escapeAttribute(vm.id) + '">' +
                        '+ Support' +
                    '</button>';
        }
        html += '</div>';

        if (!isArray(vm.supportPersonnel) ||
            vm.supportPersonnel.length === 0) {
            html += '<p class="empty-state small">' +
                        'No support personnel assigned.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<ul class="support-list">';

        for (var i = 0; i < vm.supportPersonnel.length; i++) {
            var s = vm.supportPersonnel[i];
            if (!s || !s.id) { continue; }

            html += '<li class="support-item" ' +
                        'data-character-id="' +
                            escapeAttribute(s.id) + '">';
            html += '<span class="support-name">' +
                        escapeHtml(s.name || 'Unknown') +
                    '</span>';

            if (vm.capabilities && vm.capabilities.edit) {
                html += '<button type="button" class="small danger" ' +
                            'data-action="mission-remove-support" ' +
                            'data-mission-id="' +
                                escapeAttribute(vm.id) + '" ' +
                            'data-character-id="' +
                                escapeAttribute(s.id) + '">' +
                            '×' +
                        '</button>';
            }

            html += '</li>';
        }

        html += '</ul>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // REPORTS
    // ============================================================

    function renderReports(vm) {
        var html = '';
        html += '<div class="reports-section">';

        html += '<div class="section-header">';
        html += '<strong>Reports</strong>';
        html += '<span class="count">' +
                    escapeHtml(String(vm.reportCount || 0)) +
                '</span>';
        html += '<button type="button" class="small primary" ' +
                    'data-action="mission-report-add" ' +
                    'data-mission-id="' + escapeAttribute(vm.id) + '">' +
                    '+ Add Report' +
                '</button>';
        html += '</div>';

        if (!isArray(vm.reports) || vm.reports.length === 0) {
            html += '<p class="empty-state small">' +
                        'No reports yet.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        for (var i = 0; i < vm.reports.length; i++) {
            html += renderReportRow(vm, vm.reports[i]);
        }

        html += '</div>';
        return html;
    }

    function renderReportRow(vm, report) {
        if (!report || !report.id) { return ''; }

        var rowClass = 'report-row';
        if (report.authorRedacted) {
            rowClass += ' report-author-redacted';
        }

        var html = '';
        html += '<div class="' + rowClass + '" ' +
                    'data-report-id="' +
                        escapeAttribute(report.id) + '">';

        html += '<div class="report-meta">';
        html += '<span class="report-author">' +
                    escapeHtml(report.authorName || 'Unknown') +
                '</span>';
        html += '<span class="report-timestamp">' +
                    escapeHtml(report.createdAtDisplay || '') +
                '</span>';
        if (report.isEdited) {
            html += '<span class="report-edited" ' +
                        'title="Edited at ' +
                            escapeAttribute(
                                report.updatedAtDisplay || ''
                            ) + '">' +
                        '(edited)' +
                    '</span>';
        }
        html += '</div>';

        html += '<div class="report-body">' +
                    escapeHtml(report.text || '') +
                '</div>';

        html += '<div class="report-actions">';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="mission-report-edit" ' +
                    'data-mission-id="' + escapeAttribute(vm.id) + '" ' +
                    'data-report-id="' +
                        escapeAttribute(report.id) + '">' +
                    'Edit' +
                '</button>';
        html += '<button type="button" class="small danger" ' +
                    'data-action="mission-report-delete" ' +
                    'data-mission-id="' + escapeAttribute(vm.id) + '" ' +
                    'data-report-id="' +
                        escapeAttribute(report.id) + '">' +
                    'Delete' +
                '</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // LOG
    // ============================================================

    function renderLog(vm) {
        var html = '';
        html += '<div class="log-section">';

        html += '<div class="section-header">';
        html += '<strong>Activity Log</strong>';
        html += '<span class="count">' +
                    escapeHtml(String(vm.logCount || 0)) +
                '</span>';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="mission-add-log" ' +
                    'data-mission-id="' + escapeAttribute(vm.id) + '">' +
                    '+ Log Entry' +
                '</button>';
        html += '</div>';

        if (!isArray(vm.log) || vm.log.length === 0) {
            html += '<p class="empty-state small">No activity yet.</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="log-list">';

        for (var i = 0; i < vm.log.length; i++) {
            var entry = vm.log[i];
            if (!entry) { continue; }
            html += '<div class="log-entry">';
            html += '<span class="log-timestamp">' +
                        escapeHtml(entry.timestampDisplay || '') +
                    '</span>';
            html += '<span class="log-message">' +
                        escapeHtml(entry.message || '') +
                    '</span>';
            html += '</div>';
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // ACTIONS
    // ============================================================

    function renderDetailActions(vm) {
        var caps = vm.capabilities || {};

        var html = '';
        html += '<div class="mission-detail-actions">';

        if (caps.complete) {
            html += '<button type="button" class="primary" ' +
                        'data-action="mission-complete" ' +
                        'data-mission-id="' + escapeAttribute(vm.id) + '">' +
                        'Complete' +
                    '</button>';
        }

        if (caps.cancel) {
            html += '<button type="button" class="secondary" ' +
                        'data-action="mission-cancel" ' +
                        'data-mission-id="' + escapeAttribute(vm.id) + '">' +
                        'Cancel Mission' +
                    '</button>';
        }

        if (caps.reactivate) {
            html += '<button type="button" class="secondary" ' +
                        'data-action="mission-reactivate" ' +
                        'data-mission-id="' + escapeAttribute(vm.id) + '">' +
                        'Reactivate' +
                    '</button>';
        }

        if (caps.edit) {
            html += '<button type="button" class="secondary" ' +
                        'data-action="mission-edit" ' +
                        'data-mission-id="' + escapeAttribute(vm.id) + '">' +
                        'Edit' +
                    '</button>';
        }

        if (vm.isArchived) {
            html += '<button type="button" class="secondary" ' +
                        'data-action="mission-unarchive" ' +
                        'data-mission-id="' + escapeAttribute(vm.id) + '">' +
                        'Unarchive' +
                    '</button>';
        } else {
            html += '<button type="button" class="danger" ' +
                        'data-action="mission-archive" ' +
                        'data-mission-id="' + escapeAttribute(vm.id) + '">' +
                        'Archive' +
                    '</button>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // FORM
    // ============================================================

    /**
     * Render the mission form.
     *
     * @param {object} vm - Form VM from
     *   MissionAggregator.getMissionFormViewModel
     * @returns {string} HTML string
     */
    function renderForm(vm) {
        if (!vm) {
            return '<p class="empty-state">Form data not available.</p>';
        }

        var isEdit = vm.isEdit === true;
        var m = vm.mission || {};

        var html = '';
        html += '<form id="mission-form-inner" class="mission-form">';
        html += '<div class="form-grid">';

        // ---- Title ----
        html += '<div class="form-group full-width">';
        html += '<label for="mission-title">Mission Title *</label>';
        html += '<input type="text" id="mission-title" ' +
                    'value="' + escapeAttribute(m.title || '') + '" ' +
                    'required placeholder="e.g., Operation Nightfall">';
        html += '</div>';

        // ---- Description ----
        html += '<div class="form-group full-width">';
        html += '<label for="mission-description">Description</label>';
        html += '<textarea id="mission-description" rows="2" ' +
                    'placeholder="Brief description...">' +
                    escapeHtml(m.description || '') +
                '</textarea>';
        html += '</div>';

        // ---- Mission ID (read-only preview) ----
        html += '<div class="form-group">';
        html += '<label>Mission ID</label>';
        html += '<input type="text" class="mission-id-preview" readonly ' +
                    'value="' + escapeAttribute(vm.previewLabel || '') + '">';
        html += '<span class="field-hint">' +
                    'Derived from Year and Difficulty. Updates as you edit them.' +
                '</span>';
        html += '</div>';

        // ---- Date ----
        html += '<div class="form-group">';
        html += '<label>Date</label>';
        html += '<div class="date-input-group">';
        html += '<div class="date-field">';
        html += '<label class="date-label" ' +
                    'for="mission-year">Year</label>';
        html += '<input type="number" id="mission-year" class="date-year" ' +
                    'value="' + escapeAttribute(safeString(
                        m.year !== undefined && m.year !== null
                            ? m.year
                            : (vm.defaults ? vm.defaults.year : '')
                    )) + '">';
        html += '</div>';
        html += '<div class="date-field">';
        html += '<label class="date-label" ' +
                    'for="mission-month">Month</label>';
        html += '<input type="number" id="mission-month" class="date-month" ' +
                    'min="1" max="12" value="' + escapeAttribute(safeString(
                        m.month !== undefined && m.month !== null
                            ? m.month
                            : (vm.defaults ? vm.defaults.month : '')
                    )) + '">';
        html += '</div>';
        html += '<div class="date-field">';
        html += '<label class="date-label" ' +
                    'for="mission-day">Day</label>';
        html += '<input type="number" id="mission-day" class="date-day" ' +
                    'min="1" max="31" value="' + escapeAttribute(safeString(
                        m.day !== undefined && m.day !== null
                            ? m.day
                            : (vm.defaults ? vm.defaults.day : '')
                    )) + '">';
        html += '</div>';
        html += '</div></div>';

        // ---- Difficulty ----
        html += '<div class="form-group">';
        html += '<label for="mission-difficulty">Difficulty</label>';
        html += '<select id="mission-difficulty">';
        html += renderOptions(
            vm.difficulties || [],
            m.difficulty
        );
        html += '</select>';
        html += '</div>';

        // ---- Priority ----
        html += '<div class="form-group">';
        html += '<label for="mission-priority">Priority</label>';
        html += '<select id="mission-priority">';
        html += renderOptions(vm.priorities || [], m.priority);
        html += '</select>';
        html += '</div>';

        // ---- Primary Type ----
        html += '<div class="form-group">';
        html += '<label for="mission-primary-type">Primary Category</label>';
        html += '<select id="mission-primary-type">';
        html += '<option value="">Select...</option>';
        var types = vm.missionTypes || [];
        for (var t = 0; t < types.length; t++) {
            var type = types[t];
            var selected = m.primaryType === type.id ? ' selected' : '';
            html += '<option value="' + escapeAttribute(type.id) + '"' +
                        selected + '>' +
                        escapeHtml(type.label) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        // ---- Subtype ----
        html += '<div class="form-group">';
        html += '<label for="mission-subtype">Subtype</label>';
        html += '<select id="mission-subtype">';
        html += '<option value="">Select...</option>';
        // The subtype options for the current primary type. The UI
        // controller refreshes these on primary-type change.
        var currentType = null;
        for (var tt = 0; tt < types.length; tt++) {
            if (types[tt].id === m.primaryType) {
                currentType = types[tt];
                break;
            }
        }
        if (currentType && isArray(currentType.subtypes)) {
            for (var s = 0; s < currentType.subtypes.length; s++) {
                var st = currentType.subtypes[s];
                var stSel = m.subtype === st.id ? ' selected' : '';
                html += '<option value="' + escapeAttribute(st.id) + '"' +
                            stSel + '>' +
                            escapeHtml(st.label) +
                        '</option>';
            }
        }
        html += '</select>';
        html += '</div>';

        // ---- Secondary Type ----
        html += '<div class="form-group">';
        html += '<label for="mission-secondary-type">' +
                    'Secondary Category' +
                '</label>';
        html += '<select id="mission-secondary-type">';
        html += '<option value="">None</option>';
        for (var ts = 0; ts < types.length; ts++) {
            var type2 = types[ts];
            var sel2 = m.secondaryType === type2.id ? ' selected' : '';
            html += '<option value="' + escapeAttribute(type2.id) + '"' +
                        sel2 + '>' +
                        escapeHtml(type2.label) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        // ---- Escalation ----
        html += '<div class="form-group">';
        html += '<label for="mission-escalation">Escalation Level</label>';
        html += '<select id="mission-escalation">';
        html += renderOptions(vm.escalationTiers || [], m.escalation);
        html += '</select>';
        html += '</div>';

        // ---- Threat Type ----
        html += '<div class="form-group">';
        html += '<label for="mission-threat-type">Threat Type</label>';
        html += '<input type="text" id="mission-threat-type" ' +
                    'value="' + escapeAttribute(m.threatType || '') + '" ' +
                    'placeholder="e.g., Human / Magical / Construct">';
        html += '</div>';

        // ---- Environment ----
        html += '<div class="form-group">';
        html += '<label for="mission-environment">Environment</label>';
        html += '<input type="text" id="mission-environment" ' +
                    'value="' + escapeAttribute(m.environment || '') + '" ' +
                    'placeholder="e.g., Rural / Ley-Line Site">';
        html += '</div>';

        // ---- Location ----
        html += '<div class="form-group">';
        html += '<label for="mission-location">Location</label>';
        html += '<input type="text" id="mission-location" ' +
                    'value="' + escapeAttribute(m.location || '') + '" ' +
                    'placeholder="e.g., Berlin, Germany">';
        html += '</div>';

        // ---- Duration ----
        html += '<div class="form-group">';
        html += '<label for="mission-duration">Expected Duration</label>';
        html += '<input type="text" id="mission-duration" ' +
                    'value="' + escapeAttribute(m.duration || '') + '" ' +
                    'placeholder="e.g., 3 days, 2 weeks">';
        html += '</div>';

        // ---- Base Pay ----
        html += '<div class="form-group">';
        html += '<label for="mission-base-pay">Base Contract Pay</label>';
        html += '<input type="text" id="mission-base-pay" ' +
                    'value="' + escapeAttribute(m.basePay || '') + '" ' +
                    'placeholder="e.g., 5000">';
        html += '</div>';

        // ---- Surcharge Pay ----
        html += '<div class="form-group">';
        html += '<label for="mission-surcharge-pay">' +
                    'Surcharge / Escalation Pay' +
                '</label>';
        html += '<input type="text" id="mission-surcharge-pay" ' +
                    'value="' + escapeAttribute(m.surchargePay || '') + '" ' +
                    'placeholder="e.g., 2000">';
        html += '</div>';

        // ---- Billing ----
        html += '<div class="form-group">';
        html += '<label for="mission-billing">Billing Status</label>';
        html += '<select id="mission-billing">';
        html += renderOptions(vm.billingTypes || [], m.billing);
        html += '</select>';
        html += '</div>';

        // ---- Status ----
        html += '<div class="form-group">';
        html += '<label for="mission-status">Status</label>';
        html += '<select id="mission-status">';
        html += renderOptions(vm.statuses || [], m.status);
        html += '</select>';
        html += '</div>';

        // ---- Assign Team ----
        html += '<div class="form-group">';
        html += '<label for="mission-team">Assign Team</label>';
        html += '<p class="field-hint">' +
                    'Missions may be assigned to Professional or Temporary teams.' +
                '</p>';
        html += '<select id="mission-team">';
        html += '<option value="">Unassigned</option>';
        var teams = vm.teams || [];
        for (var tm = 0; tm < teams.length; tm++) {
            var team = teams[tm];
            var tSel = String(m.assignedTeamId || '') === String(team.id)
                ? ' selected'
                : '';
            html += '<option value="' + escapeAttribute(team.id) + '"' +
                        tSel + '>' +
                        escapeHtml(team.name) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        // ---- Support Personnel ----
        html += '<div class="form-group full-width">';
        html += '<label>Support Personnel</label>';
        html += '<p class="field-hint">' +
                    'Individual characters supporting this mission.' +
                '</p>';
        html += '<div class="support-input-group">';
        html += '<select id="mission-support-select" class="support-select">';
        html += '<option value="">Select character...</option>';
        var characters = vm.characters || [];
        for (var c = 0; c < characters.length; c++) {
            var character = characters[c];
            html += '<option value="' +
                        escapeAttribute(character.id) + '">' +
                        escapeHtml(character.name) +
                    '</option>';
        }
        html += '</select>';
        html += '<button type="button" class="small primary" ' +
                    'data-action="mission-add-support">' +
                    '+ Add' +
                '</button>';
        html += '</div>';
        html += '<div id="mission-support-list" class="support-list">';
        html += renderFormSupportList(vm);
        html += '</div>';
        html += '</div>';

        // ---- Objectives ----
        html += '<div class="form-group full-width">';
        html += '<label>Objectives</label>';
        html += '<div class="objective-input-group">';
        html += '<input type="text" id="mission-objective-input" ' +
                    'placeholder="Add objective..." class="objective-input">';
        html += '<button type="button" class="small primary" ' +
                    'data-action="mission-add-objective">' +
                    '+ Add' +
                '</button>';
        html += '</div>';
        html += '<div id="mission-objectives-list" class="objectives-list">';
        html += renderFormObjectivesList(vm);
        html += '</div>';
        html += '</div>';

        // ---- Notes ----
        html += '<div class="form-group full-width">';
        html += '<label for="mission-notes">Notes</label>';
        html += '<textarea id="mission-notes" rows="2" ' +
                    'placeholder="Additional notes...">' +
                    escapeHtml(m.notes || '') +
                '</textarea>';
        html += '</div>';

        // ---- Tags ----
        html += '<div class="form-group full-width">';
        html += '<label for="mission-tags">Tags (comma separated)</label>';
        html += '<input type="text" id="mission-tags" ' +
                    'value="' + escapeAttribute(
                        isArray(m.tags) ? m.tags.join(', ') : ''
                    ) + '" ' +
                    'placeholder="e.g., covert, rescue, extraction">';
        html += '</div>';

        html += '</div>'; // form-grid

        // ---- Actions ----
        html += '<div class="form-actions">';
        html += '<button type="button" class="secondary" ' +
                    'data-action="mission-close-form">' +
                    'Cancel' +
                '</button>';
        html += '<button type="submit" class="primary">' +
                    (isEdit ? 'Update Mission' : 'Create Mission') +
                '</button>';
        html += '</div>';

        html += '</form>';
        return html;
    }

    function renderFormSupportList(vm) {
        var m = vm.mission || {};
        var supportIds = isArray(m.supportPersonnel)
            ? m.supportPersonnel
            : [];
        var characters = vm.characters || [];

        if (supportIds.length === 0) {
            return '<p class="empty-state small">No support assigned.</p>';
        }

        var nameById = {};
        for (var i = 0; i < characters.length; i++) {
            nameById[characters[i].id] = characters[i].name;
        }

        var html = '';
        for (var j = 0; j < supportIds.length; j++) {
            var id = supportIds[j];
            if (!id) { continue; }
            html += '<div class="support-row" data-character-id="' +
                        escapeAttribute(id) + '">';
            html += '<span class="support-name">' +
                        escapeHtml(nameById[id] || 'Unknown') +
                    '</span>';
            html += '<button type="button" class="small danger" ' +
                        'data-action="mission-remove-support" ' +
                        'data-character-id="' + escapeAttribute(id) + '">' +
                        '×' +
                    '</button>';
            html += '</div>';
        }
        return html;
    }

    function renderFormObjectivesList(vm) {
        var m = vm.mission || {};
        var objectives = isArray(m.objectives) ? m.objectives : [];

        if (objectives.length === 0) {
            return '<p class="empty-state small">No objectives.</p>';
        }

        var html = '';
        for (var i = 0; i < objectives.length; i++) {
            var obj = objectives[i];
            html += '<div class="objective-row">';
            html += '<input type="checkbox" class="objective-done"' +
                        (obj.done ? ' checked' : '') + '>';
            html += '<input type="text" class="objective-text-input" ' +
                        'value="' + escapeAttribute(obj.text || '') + '">';
            html += '<button type="button" class="small danger" ' +
                        'data-action="mission-remove-objective" ' +
                        'data-objective-index="' +
                            escapeAttribute(String(i)) + '">' +
                        '×' +
                    '</button>';
            html += '</div>';
        }
        return html;
    }

    /**
     * Render <option> elements from a list of { id, label } or
     * { value, label } items. Selects the entry matching
     * `selectedValue`.
     */
    function renderOptions(options, selectedValue) {
        if (!isArray(options)) { return ''; }

        var html = '';
        for (var i = 0; i < options.length; i++) {
            var opt = options[i];
            if (!opt) { continue; }
            var value = opt.id !== undefined ? opt.id : opt.value;
            var label = opt.label !== undefined ? opt.label : value;
            if (value === undefined || value === null) { continue; }
            var selected = String(value) === String(selectedValue)
                ? ' selected'
                : '';
            html += '<option value="' + escapeAttribute(String(value)) +
                        '"' + selected + '>' +
                        escapeHtml(String(label)) +
                    '</option>';
        }
        return html;
    }

    // ============================================================
    // SIMPLE STATES
    // ============================================================

    function renderEmpty(message) {
        return '<p class="empty-state">' +
                    escapeHtml(message || 'No items found.') +
                '</p>';
    }

    function renderLoading() {
        return '<p class="empty-state">Loading mission data...</p>';
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionRender = Object.freeze({
        renderContainer: renderContainer,
        renderModals: renderModals,
        renderList: renderList,
        renderListItem: renderListItem,
        renderDetail: renderDetail,
        renderForm: renderForm,
        renderEmpty: renderEmpty,
        renderLoading: renderLoading
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.MissionRender;
        var missing = [];

        var required = [
            'renderContainer',
            'renderModals',
            'renderList',
            'renderListItem',
            'renderDetail',
            'renderForm',
            'renderEmpty',
            'renderLoading'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[MissionRender] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
