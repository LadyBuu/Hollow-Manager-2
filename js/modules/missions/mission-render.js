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
 *   - The report form modal markup (renderReportFormModal).
 *   - The mission form's team editor (a chip list, not a single
 *     <select>).
 *   - The mission form's participants panel: one section per
 *     assigned team, plus a searchable rookie section.
 *   - The mission detail panel's participants section.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Data. Every value comes off the VM. No queries, no domain
 *     reads, no team lookups, no character lookups, no date parsing.
 *   - State. The UI controller owns which mission is selected,
 *     which filter is applied, which modal is open, what the
 *     report form currently contains, and what the participant
 *     search box currently contains.
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
 * PARTICIPANTS PANEL (form):
 *   The mission form carries a participant editor between the
 *   team chips and the support personnel block. Shape:
 *
 *     <div id="mission-participants-panel">
 *       <section per assigned team>
 *         header: team name + member count
 *         rows: one checkbox per active member at the mission's year
 *       </section>
 *       <section class="rookie-section">
 *         header: "Rookies" + count
 *         search input (data-action="mission-rookie-search")
 *         rows: one checkbox per rookie candidate
 *       </section>
 *     </div>
 *
 *   Every member checkbox carries:
 *     data-action="mission-toggle-participant"
 *     data-character-id="..."
 *     data-team-id="..."     (empty for rookie entries)
 *     data-source="team"|"rookie"
 *
 *   The controller reads those attributes, calls
 *   MissionCore.addParticipant or MissionCore.removeParticipant,
 *   and re-renders the panel. The checkbox state is derived from
 *   the participant's `isParticipant` flag on the VM, not from
 *   DOM state.
 *
 *   The rookie search box filters client-side. The controller
 *   re-renders with a `rookieFilter` string; the renderer applies
 *   a case-insensitive substring match on `displayName`.
 *
 * PARTICIPANTS SECTION (detail):
 *   The detail panel carries a participants block, grouped by
 *   team, with rookies at the bottom. Each row carries the
 *   character name, the team name, the source label, a deceased
 *   marker when set, and a remove button.
 *
 * REPORT FORM MODAL:
 *   The author select is built from two lists: `teamMembers`
 *   (active members of the mission's assigned teams) and
 *   `otherCharacters`. They render as two <optgroup> elements,
 *   with "Team members" first. Each option label carries a
 *   "(deceased)" suffix when the character is deceased.
 *
 *   In EDIT mode, the author select is disabled. The redaction
 *   checkbox is also disabled. Both are frozen at creation.
 *
 * MISSION LABEL:
 *   The mission label (YEAR-SEQ-DIFFICULTY) is a derived value.
 *   The form does not preview it. On the edit form,
 *   `vm.currentLabel` is displayed as static text; it is not an
 *   input and is not submitted. On the create form, a muted hint
 *   states that the label will be assigned on save.
 *
 * DATE FIELDS:
 *   The year / month / day inputs carry `data-mission-year-field`,
 *   `data-mission-month-field`, and `data-mission-day-field`
 *   respectively. The UI controller uses these to track whether
 *   the user has explicitly edited month/day, so that a year
 *   change can reset untouched values to Jan 1 without clobbering
 *   explicit ones.
 *
 * DATA-ACTION CONVENTION:
 *   Every interactive element that the controller should respond
 *   to carries data-action="<verb>". The controller's delegated
 *   listener reads the attribute and dispatches.
 *
 * MODAL SHELL CONVENTION:
 *   renderContainer() emits the mission detail and mission form
 *   modal shells. The report modal, the export modal, and the
 *   import modal are emitted lazily by the controller on first
 *   use; the controller supplies their markup. This module does
 *   not know about them.
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

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
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
        html += '<button type="button" class="secondary" ' +
                    'data-action="mission-import" ' +
                    'title="Import missions from JSON or CSV">' +
                    '\u2191 Import' +
                '</button>';
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
    // REPORT FORM MODAL
    // ============================================================
    //
    // VM shape (built by MissionUI):
    //
    //   {
    //     mode:            'create' | 'edit',
    //     missionId:       string,
    //     missionTitle:    string,
    //     reportId:        string | null,
    //     authorId:        string | null,
    //     authorRedacted:  boolean,
    //     text:            string,
    //     teamMembers:     [ { id, name, deceased } ],
    //     otherCharacters: [ { id, name, deceased } ]
    //   }

    function renderReportFormModal(vm) {
        if (!vm) {
            throw new Error(
                '[MissionRender] renderReportFormModal requires a VM.'
            );
        }

        return buildReportFormHTML(vm);
    }

    function buildReportFormHTML(vm) {
        var isEdit = vm.mode === 'edit';
        var missionTitle = isNonEmptyString(vm.missionTitle)
            ? vm.missionTitle
            : 'Mission';

        var teamMembers = isArray(vm.teamMembers)
            ? vm.teamMembers
            : [];
        var otherCharacters = isArray(vm.otherCharacters)
            ? vm.otherCharacters
            : [];

        var currentAuthorId = isNonEmptyString(vm.authorId)
            ? String(vm.authorId)
            : '';
        var redacted = vm.authorRedacted === true;
        var text = isNonEmptyString(vm.text) ? vm.text : '';

        // In edit mode the author select is locked. The stored
        // authorId is either a character id or null (redacted),
        // and changing it after the fact would misattribute the
        // report.
        var authorDisabled = isEdit || redacted;

        var title = isEdit
            ? 'Edit Report'
            : 'New Report';

        var html = '';

        // ---- Header ----
        html += '<div class="modal-header">';
        html += '<h3>' + escapeHtml(title) + ' \u2014 ' +
                    escapeHtml(missionTitle) +
                '</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-action="mission-report-cancel" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        // ---- Body ----
        html += '<div class="modal-body mission-report-body">';

        html += '<p class="field-hint" ' +
                    'style="font-size:0.75rem;color:var(--text-dim);' +
                    'margin:0 0 12px 0;line-height:1.5;">' +
                    (isEdit
                        ? 'Edit the report below. Changes are saved ' +
                          'when you click Save.'
                        : 'Write the report below. The author is ' +
                          'shown alongside the report in the ' +
                          'mission\u2019s history.') +
                '</p>';

        // ---- Author ----
        html += '<div class="form-group">';
        html += '<label for="mission-report-author">Author</label>';

        html += '<select id="mission-report-author"' +
                    (authorDisabled ? ' disabled' : '') + '>';
        html += '<option value="">Select author...</option>';

        if (teamMembers.length > 0) {
            html += '<optgroup label="Team members">';
            for (var i = 0; i < teamMembers.length; i++) {
                html += renderAuthorOption(
                    teamMembers[i], currentAuthorId
                );
            }
            html += '</optgroup>';
        }

        if (otherCharacters.length > 0) {
            html += '<optgroup label="Other characters">';
            for (var j = 0; j < otherCharacters.length; j++) {
                html += renderAuthorOption(
                    otherCharacters[j], currentAuthorId
                );
            }
            html += '</optgroup>';
        }

        html += '</select>';

        if (isEdit) {
            html += '<span class="field-hint">' +
                        'The author cannot be changed after the ' +
                        'report is saved. Delete the report and add ' +
                        'a new one if it was attributed to the wrong ' +
                        'character.' +
                    '</span>';
        } else {
            html += '<span class="field-hint">' +
                        'Leave as "Select author..." and tick the ' +
                        'box below to submit without attribution.' +
                    '</span>';
        }
        html += '</div>';

        // ---- Redacted checkbox ----
        html += '<div class="form-group mission-report-redact-row">';
        html += '<label class="csw-checkbox-row" ' +
                    'style="display:flex;align-items:center;gap:8px;' +
                    'cursor:pointer;font-size:0.75rem;' +
                    'color:var(--text);' +
                    (isEdit ? 'opacity:0.5;cursor:not-allowed;' : '') +
                    '">';
        html += '<input type="checkbox" ' +
                    'id="mission-report-redacted"' +
                    (redacted ? ' checked' : '') +
                    (isEdit ? ' disabled' : '') + '>';
        html += '<span>Submit as redacted (Unknown author)</span>';
        html += '</label>';
        if (isEdit) {
            html += '<span class="field-hint" ' +
                        'style="margin-left:20px;">' +
                        'Redaction state cannot be changed after ' +
                        'save.' +
                    '</span>';
        }
        html += '</div>';

        // ---- Text ----
        html += '<div class="form-group">';
        html += '<label for="mission-report-text">Report</label>';
        html += '<textarea id="mission-report-text" ' +
                    'rows="14" ' +
                    'spellcheck="true" ' +
                    'autocomplete="off" ' +
                    'placeholder="What happened?" ' +
                    'style="width:100%;min-height:280px;' +
                    'padding:10px 12px;' +
                    'background:var(--bg);' +
                    'border:1px solid var(--border);' +
                    'color:var(--text);' +
                    'border-radius:6px;' +
                    'font-family:inherit;' +
                    'font-size:0.85rem;' +
                    'line-height:1.55;' +
                    'resize:vertical;' +
                    'overflow:auto;">' +
                    escapeHtml(text) +
                '</textarea>';
        html += '<span class="field-hint" ' +
                    'style="font-size:0.65rem;">' +
                    'Ctrl / Cmd + Enter to save.' +
                '</span>';
        html += '</div>';

        // ---- Inline error region ----
        html += '<div id="mission-report-error" ' +
                    'class="mission-report-error" ' +
                    'style="display:none;margin-top:10px;' +
                    'padding:8px 12px;' +
                    'background:var(--danger-soft);' +
                    'border-left:3px solid var(--danger);' +
                    'border-radius:4px;' +
                    'font-size:0.75rem;' +
                    'color:var(--danger);"></div>';

        html += '</div>';

        // ---- Footer ----
        html += '<div class="form-actions mission-report-footer" ' +
                    'style="display:flex;gap:8px;' +
                    'justify-content:flex-end;' +
                    'margin-top:12px;padding-top:12px;' +
                    'border-top:1px solid var(--border-soft);">';
        html += '<button type="button" class="secondary" ' +
                    'data-action="mission-report-cancel">Cancel</button>';
        html += '<button type="button" class="primary" ' +
                    'data-action="mission-report-submit">' +
                    (isEdit ? 'Save Changes' : 'Add Report') +
                '</button>';
        html += '</div>';

        return html;
    }

    /**
     * One <option> for the author select. Appends " (deceased)"
     * to the label when the flag is set.
     */
    function renderAuthorOption(option, selectedId) {
        if (!option || !option.id) { return ''; }

        var label = isNonEmptyString(option.name)
            ? option.name
            : 'Unknown';

        if (option.deceased === true) {
            label += ' (deceased)';
        }

        var selected = String(option.id) === String(selectedId)
            ? ' selected'
            : '';

        return '<option value="' +
                    escapeAttribute(option.id) + '"' + selected + '>' +
                    escapeHtml(label) +
                '</option>';
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
        if (item.participantCount > 0) {
            html += ' <span class="mission-participant-badge">' +
                        escapeHtml(String(item.participantCount)) +
                        ' participants</span>';
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
                    renderExtraTeamsCount(item) +
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

    /**
     * If more than one team is assigned, append " +N" to the
     * primary team's name on the list row.
     */
    function renderExtraTeamsCount(item) {
        var count = item.assignedTeamCount;
        if (!isFiniteNumber(count) || count <= 1) { return ''; }
        var extra = count - 1;
        return ' <span class="mission-team-extra">+' +
                    escapeHtml(String(extra)) +
                '</span>';
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
        html += renderAssignedTeams(vm);
        html += renderParticipants(vm);
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
    // ASSIGNED TEAMS (detail panel)
    // ============================================================

    function renderAssignedTeams(vm) {
        var html = '';
        html += '<div class="assigned-teams-section">';

        html += '<div class="section-header">';
        html += '<strong>Assigned Teams</strong>';
        html += '<span class="count">' +
                    escapeHtml(String(vm.assignedTeamCount || 0)) +
                '</span>';
        if (vm.capabilities && vm.capabilities.edit) {
            html += '<button type="button" class="small secondary" ' +
                        'data-action="mission-add-team" ' +
                        'data-mission-id="' + escapeAttribute(vm.id) + '">' +
                        '+ Team' +
                    '</button>';
        }
        html += '</div>';

        var teams = isArray(vm.assignedTeams)
            ? vm.assignedTeams
            : [];

        if (teams.length === 0) {
            html += '<p class="empty-state small">Unassigned</p>';
            html += '</div>';
            return html;
        }

        html += '<ul class="assigned-teams-list">';

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || !team.id) { continue; }

            html += '<li class="assigned-team-item" ' +
                        'data-team-id="' +
                            escapeAttribute(team.id) + '">';
            html += '<span class="assigned-team-name">' +
                        escapeHtml(team.name || 'Unknown Team') +
                    '</span>';

            if (vm.capabilities && vm.capabilities.edit) {
                html += '<button type="button" class="small danger" ' +
                            'data-action="mission-remove-team" ' +
                            'data-mission-id="' +
                                escapeAttribute(vm.id) + '" ' +
                            'data-team-id="' +
                                escapeAttribute(team.id) + '">' +
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
    // PARTICIPANTS (detail panel)
    // ============================================================
    //
    // VM shape (from MissionAggregator.buildParticipantsVM):
    //   [ { characterId, displayName, deceased, teamId, teamName,
    //       source, sourceLabel } ]
    //
    // Rows are grouped: team participants first, then rookies.

    function renderParticipants(vm) {
        var html = '';
        html += '<div class="participants-section">';

        html += '<div class="section-header">';
        html += '<strong>Participants</strong>';
        html += '<span class="count">' +
                    escapeHtml(String(vm.participantCount || 0)) +
                '</span>';
        if (vm.capabilities && vm.capabilities.edit) {
            html += '<button type="button" class="small secondary" ' +
                        'data-action="mission-edit-participants" ' +
                        'data-mission-id="' +
                            escapeAttribute(vm.id) + '">' +
                        'Edit Participants' +
                    '</button>';
        }
        html += '</div>';

        var participants = isArray(vm.participants)
            ? vm.participants
            : [];

        if (participants.length === 0) {
            html += '<p class="empty-state small">' +
                        'No participants recorded.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<ul class="participants-list">';

        for (var i = 0; i < participants.length; i++) {
            html += renderParticipantRow(vm, participants[i]);
        }

        html += '</ul>';
        html += '</div>';
        return html;
    }

    function renderParticipantRow(vm, p) {
        if (!p || !p.characterId) { return ''; }

        var rowClass = 'participant-item';
        if (p.source === 'rookie') {
            rowClass += ' participant-rookie';
        }

        var html = '';
        html += '<li class="' + rowClass + '" ' +
                    'data-character-id="' +
                        escapeAttribute(p.characterId) + '" ' +
                    'data-team-id="' +
                        escapeAttribute(p.teamId || '') + '" ' +
                    'data-source="' +
                        escapeAttribute(p.source || '') + '">';

        html += '<span class="participant-name">' +
                    escapeHtml(p.displayName || 'Unknown') +
                '</span>';

        if (p.deceased === true) {
            html += '<span class="participant-deceased" ' +
                        'title="Deceased">\u2020</span>';
        }

        if (isNonEmptyString(p.teamName)) {
            html += '<span class="participant-team">' +
                        escapeHtml(p.teamName) +
                    '</span>';
        }

        html += '<span class="participant-source ' +
                    'participant-source-' +
                    escapeAttribute(p.source || 'unknown') + '">' +
                    escapeHtml(p.sourceLabel || '') +
                '</span>';

        if (vm.capabilities && vm.capabilities.edit) {
            html += '<button type="button" class="small danger" ' +
                        'data-action="mission-remove-participant" ' +
                        'data-mission-id="' +
                            escapeAttribute(vm.id) + '" ' +
                        'data-character-id="' +
                            escapeAttribute(p.characterId) + '" ' +
                        'data-team-id="' +
                            escapeAttribute(p.teamId || '') + '">' +
                        '×' +
                    '</button>';
        }

        html += '</li>';
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

        html += '<button type="button" class="secondary" ' +
                    'data-action="mission-export" ' +
                    'data-mission-id="' + escapeAttribute(vm.id) + '">' +
                    'Export' +
                '</button>';

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

        // ---- Mission ID (display only, never an input) ----
        html += '<div class="form-group">';
        html += '<label>Mission ID</label>';
        if (isEdit && isNonEmptyString(vm.currentLabel)) {
            html += '<div class="mission-form-id-display" ' +
                        'data-mission-id-label="' +
                            escapeAttribute(vm.currentLabel) + '">' +
                        escapeHtml(vm.currentLabel) +
                    '</div>';
            html += '<span class="field-hint">' +
                        'Derived from Year and Difficulty. Updates on save.' +
                    '</span>';
        } else {
            html += '<div class="mission-form-id-display ' +
                        'mission-form-id-pending">' +
                        'Assigned on save' +
                    '</div>';
            html += '<span class="field-hint">' +
                        'The Mission ID is generated from Year and ' +
                        'Difficulty when the mission is created.' +
                    '</span>';
        }
        html += '</div>';

        // ---- Date ----
        html += '<div class="form-group">';
        html += '<label>Date</label>';
        html += '<div class="date-input-group">';
        html += '<div class="date-field">';
        html += '<label class="date-label" ' +
                    'for="mission-year">Year</label>';
        html += '<input type="number" id="mission-year" class="date-year" ' +
                    'data-mission-year-field="true" ' +
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
                    'data-mission-month-field="true" ' +
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
                    'data-mission-day-field="true" ' +
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
        var currentType = null;
        for (var tt = 0; tt < types.length; tt++) {
            if (types[tt].id === m.primaryType) {
                currentType = types[tt];
                break;
            }
        }
        if (currentType && isArray(currentType.subtypes) &&
            currentType.subtypes.length > 0) {
            html += '<option value="">Select...</option>';
            for (var s = 0; s < currentType.subtypes.length; s++) {
                var st = currentType.subtypes[s];
                var stSel = m.subtype === st.id ? ' selected' : '';
                html += '<option value="' + escapeAttribute(st.id) + '"' +
                            stSel + '>' +
                            escapeHtml(st.label) +
                        '</option>';
            }
        } else if (currentType) {
            html += '<option value="" disabled>' +
                        '(no subtypes for this category)' +
                    '</option>';
        } else {
            html += '<option value="" disabled>' +
                        '(select a category first)' +
                    '</option>';
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

        // ---- Assign Teams (chip list) ----
        html += renderTeamEditor(vm, m);

        // ---- Participants panel ----
        html += renderParticipantsPanel(vm);

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

    // ============================================================
    // TEAM EDITOR (form)
    // ============================================================

    function renderTeamEditor(vm, m) {
        var allTeams = isArray(vm.teams) ? vm.teams : [];
        var assignedIds = isArray(m.assignedTeamIds)
            ? m.assignedTeamIds.map(function(id) { return String(id); })
            : [];

        var assignedSet = Object.create(null);
        for (var i = 0; i < assignedIds.length; i++) {
            assignedSet[assignedIds[i]] = true;
        }

        var nameById = Object.create(null);
        for (var n = 0; n < allTeams.length; n++) {
            var t = allTeams[n];
            if (t && t.id) {
                nameById[String(t.id)] = t.name;
            }
        }

        var available = [];
        for (var a = 0; a < allTeams.length; a++) {
            var candidate = allTeams[a];
            if (!candidate || !candidate.id) { continue; }
            if (assignedSet[String(candidate.id)]) { continue; }
            available.push(candidate);
        }

        var html = '';
        html += '<div class="form-group full-width mission-team-editor">';

        html += '<label>Assigned Teams</label>';
        html += '<p class="field-hint">' +
                    'A mission may be assigned to any number of ' +
                    'professional teams.' +
                '</p>';

        html += '<div class="mission-team-input-group">';
        html += '<select id="mission-team-select" ' +
                    'class="mission-team-select"' +
                    (available.length === 0 ? ' disabled' : '') + '>';

        if (available.length === 0) {
            var placeholderText = allTeams.length === 0
                ? 'No eligible teams'
                : 'All eligible teams are already assigned';
            html += '<option value="" disabled selected>' +
                        escapeHtml(placeholderText) +
                    '</option>';
        } else {
            html += '<option value="">Select team...</option>';
            for (var av = 0; av < available.length; av++) {
                var team = available[av];
                html += '<option value="' +
                            escapeAttribute(team.id) + '">' +
                            escapeHtml(team.name) +
                        '</option>';
            }
        }

        html += '</select>';
        html += '<button type="button" class="small primary" ' +
                    'data-action="mission-add-team"' +
                    (available.length === 0 ? ' disabled' : '') + '>' +
                    '+ Add' +
                '</button>';
        html += '</div>';

        html += '<div id="mission-teams-list" class="mission-teams-list">';

        if (assignedIds.length === 0) {
            html += '<p class="empty-state small">No teams assigned.</p>';
        } else {
            for (var ai = 0; ai < assignedIds.length; ai++) {
                var assignedId = assignedIds[ai];
                var assignedName = nameById[assignedId] || assignedId;
                html += renderTeamChip(assignedId, assignedName);
            }
        }

        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderTeamChip(teamId, teamName) {
        var html = '';
        html += '<div class="mission-team-chip" ' +
                    'data-team-id="' + escapeAttribute(teamId) + '">';
        html += '<span class="mission-team-chip-name">' +
                    escapeHtml(teamName) +
                '</span>';
        html += '<button type="button" class="small danger" ' +
                    'data-action="mission-remove-team" ' +
                    'data-team-id="' + escapeAttribute(teamId) + '">' +
                    '\u2715' +
                '</button>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // PARTICIPANTS PANEL (form)
    // ============================================================
    //
    // vm.participantsVM is the shape returned by
    // MissionAggregator.getParticipantsViewModel:
    //
    //   {
    //     missionId, missionTitle, missionYear,
    //     assignedTeams: [
    //       { teamId, teamName, members: [
    //           { characterId, displayName, role, deceased,
    //             isParticipant }
    //       ] }
    //     ],
    //     currentParticipants: [...]
    //   }
    //
    // vm.rookieCandidatesVM is the shape returned by
    // MissionAggregator.getRookieCandidatesViewModel:
    //
    //   {
    //     missionId, missionTitle, missionYear,
    //     candidates: [
    //       { characterId, displayName, deceased,
    //         isParticipant, onAssignedTeam }
    //     ]
    //   }
    //
    // vm.rookieFilter is the current search string from the UI
    // controller (default ''). It is applied case-insensitively
    // as a substring match on displayName.

    function renderParticipantsPanel(vm) {
        var participantsVM = vm.participantsVM || null;
        var rookieVM = vm.rookieCandidatesVM || null;

        // If the aggregator did not supply a participants VM — for
        // instance a fresh create form where no mission exists yet
        // — the panel renders a muted hint instead of a broken
        // editor. The panel becomes functional once the mission
        // exists and the form is reopened in edit mode.
        if (!participantsVM) {
            return renderParticipantsPanelPlaceholder(vm);
        }

        var html = '';
        html += '<div class="form-group full-width participants-panel" ' +
                    'id="mission-participants-panel">';

        html += '<label>Participants</label>';
        html += '<p class="field-hint">' +
                    'Tick the members of each assigned team who took ' +
                    'part in this mission. Members shown are those ' +
                    'active in ' +
                    escapeHtml(safeString(participantsVM.missionYear)) +
                    '. Rookies may be added below.' +
                '</p>';

        // ---- One section per assigned team ----
        var teams = isArray(participantsVM.assignedTeams)
            ? participantsVM.assignedTeams
            : [];

        if (teams.length === 0) {
            html += '<p class="empty-state small">' +
                        'Assign a team above to choose participants ' +
                        'from it.' +
                    '</p>';
        } else {
            for (var t = 0; t < teams.length; t++) {
                html += renderTeamParticipantsSection(
                    vm, teams[t]
                );
            }
        }

        // ---- Rookie section ----
        html += renderRookieSection(vm, rookieVM);

        html += '</div>';
        return html;
    }

    function renderParticipantsPanelPlaceholder(vm) {
        var html = '';
        html += '<div class="form-group full-width participants-panel" ' +
                    'id="mission-participants-panel">';
        html += '<label>Participants</label>';
        html += '<p class="field-hint">' +
                    'Participants can be recorded once the mission ' +
                    'has been created and at least one team is ' +
                    'assigned.' +
                '</p>';
        html += '</div>';
        return html;
    }

    function renderTeamParticipantsSection(vm, teamRow) {
        var teamId = teamRow.teamId;
        var teamName = isNonEmptyString(teamRow.teamName)
            ? teamRow.teamName
            : 'Unknown Team';
        var members = isArray(teamRow.members)
            ? teamRow.members
            : [];

        var html = '';
        html += '<div class="participant-team-section" ' +
                    'data-team-id="' +
                        escapeAttribute(teamId) + '">';

        html += '<div class="participant-section-header">';
        html += '<span class="participant-team-name">' +
                    escapeHtml(teamName) +
                '</span>';
        html += '<span class="participant-team-count">' +
                    members.length + ' member' +
                    (members.length === 1 ? '' : 's') +
                '</span>';
        html += '</div>';

        if (members.length === 0) {
            html += '<p class="empty-state small">' +
                        'No members active in ' +
                        escapeHtml(safeString(
                            vm.participantsVM.missionYear
                        )) +
                        '.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<ul class="participant-member-list">';

        for (var i = 0; i < members.length; i++) {
            html += renderTeamMemberCheckbox(
                vm, teamId, members[i]
            );
        }

        html += '</ul>';
        html += '</div>';
        return html;
    }

    function renderTeamMemberCheckbox(vm, teamId, member) {
        if (!member || !member.characterId) { return ''; }

        var checked = member.isParticipant === true;

        var html = '';
        html += '<li class="participant-member-row">';

        html += '<label class="participant-member-label">';
        html += '<input type="checkbox" ' +
                    'class="participant-member-checkbox" ' +
                    'data-action="mission-toggle-participant" ' +
                    'data-mission-id="' +
                        escapeAttribute(vm.editId || '') + '" ' +
                    'data-character-id="' +
                        escapeAttribute(member.characterId) + '" ' +
                    'data-team-id="' +
                        escapeAttribute(teamId) + '" ' +
                    'data-source="team"' +
                    (checked ? ' checked' : '') + '>';

        html += '<span class="participant-member-name">' +
                    escapeHtml(member.displayName || 'Unknown') +
                '</span>';

        if (isNonEmptyString(member.role)) {
            html += '<span class="participant-member-role">(' +
                        escapeHtml(member.role) +
                    ')</span>';
        }

        if (member.deceased === true) {
            html += '<span class="participant-member-deceased" ' +
                        'title="Deceased">\u2020</span>';
        }

        html += '</label>';
        html += '</li>';
        return html;
    }

    function renderRookieSection(vm, rookieVM) {
        var html = '';
        html += '<div class="participant-rookie-section">';

        var candidates = (rookieVM && isArray(rookieVM.candidates))
            ? rookieVM.candidates
            : [];

        // Apply the current filter string. The filter is a
        // case-insensitive substring match on displayName.
        var filter = isNonEmptyString(vm.rookieFilter)
            ? String(vm.rookieFilter).toLowerCase()
            : '';

        var visible = [];
        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            if (!c || !c.characterId) { continue; }
            if (filter !== '' &&
                String(c.displayName || '')
                    .toLowerCase()
                    .indexOf(filter) === -1) {
                continue;
            }
            visible.push(c);
        }

        var totalCount = candidates.length;

        html += '<div class="participant-section-header">';
        html += '<span class="participant-team-name">Rookies</span>';
        html += '<span class="participant-team-count">' +
                    totalCount + ' candidate' +
                    (totalCount === 1 ? '' : 's') +
                '</span>';
        html += '</div>';

        html += '<div class="rookie-search-row">';
        html += '<input type="text" ' +
                    'id="mission-rookie-search" ' +
                    'class="rookie-search-input" ' +
                    'placeholder="Search rookies by name..." ' +
                    'data-action="mission-rookie-search" ' +
                    'value="' +
                        escapeAttribute(vm.rookieFilter || '') +
                    '" ' +
                    'autocomplete="off" ' +
                    'spellcheck="false">';
        html += '</div>';

        if (totalCount === 0) {
            html += '<p class="empty-state small">' +
                        'No rookie candidates.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        if (visible.length === 0) {
            html += '<p class="empty-state small">' +
                        'No rookies match "' +
                        escapeHtml(vm.rookieFilter || '') +
                        '".' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<ul class="rookie-candidate-list">';

        for (var j = 0; j < visible.length; j++) {
            html += renderRookieCheckbox(vm, visible[j]);
        }

        html += '</ul>';
        html += '</div>';
        return html;
    }

    function renderRookieCheckbox(vm, candidate) {
        if (!candidate || !candidate.characterId) { return ''; }

        var checked = candidate.isParticipant === true;
        var onTeam = candidate.onAssignedTeam === true;

        // A rookie already on an assigned team is rendered as
        // disabled with an explanatory note: the correct place to
        // record them is the team-member section, not here.
        var rowClass = 'rookie-candidate-row';
        if (onTeam) {
            rowClass += ' rookie-on-team';
        }

        var html = '';
        html += '<li class="' + rowClass + '">';

        html += '<label class="rookie-candidate-label">';
        html += '<input type="checkbox" ' +
                    'class="rookie-candidate-checkbox" ' +
                    'data-action="mission-toggle-participant" ' +
                    'data-mission-id="' +
                        escapeAttribute(vm.editId || '') + '" ' +
                    'data-character-id="' +
                        escapeAttribute(candidate.characterId) + '" ' +
                    'data-team-id="" ' +
                    'data-source="rookie"' +
                    (checked ? ' checked' : '') +
                    (onTeam ? ' disabled' : '') + '>';

        html += '<span class="rookie-candidate-name">' +
                    escapeHtml(candidate.displayName || 'Unknown') +
                '</span>';

        if (candidate.deceased === true) {
            html += '<span class="rookie-candidate-deceased" ' +
                        'title="Deceased">\u2020</span>';
        }

        if (onTeam) {
            html += '<span class="rookie-candidate-note">' +
                        'Already on an assigned team' +
                    '</span>';
        }

        html += '</label>';
        html += '</li>';
        return html;
    }

    // ============================================================
    // FORM SUPPORT / OBJECTIVE LISTS
    // ============================================================

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
        renderReportFormModal: renderReportFormModal,
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
            'renderReportFormModal',
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