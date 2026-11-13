/**
 * js/modules/missions/mission-render.js - Mission Rendering
 *
 * Path: js/modules/missions/mission-render.js
 *
 * Pure HTML rendering for the missions tab.
 *
 * WHAT THIS MODULE OWNS:
 *   - renderContainer:  the page shell (header, stats strip,
 *                       filter bar, list mount point, modal
 *                       shells for detail and form, and the
 *                       report-form modal shell).
 *   - renderList:       one row per mission, inside #missions-list.
 *   - renderDetail:     the detail panel body, inside
 *                       #mission-detail-content.
 *   - renderForm:       the mission form body, inside
 *                       #mission-form-content. Includes the
 *                       participants panel, rendered from
 *                       vm.participantsVM.
 *   - renderReportFormModal: the report form body, inside the
 *                       report modal's .modal-report-content.
 *   - renderEmpty / renderLoading: list placeholders.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Reads, mutations, projections. Everything is a view model.
 *   - Event binding. mission-ui.js owns every listener.
 *   - The participants VM. mission-ui.js builds it from the
 *     current form state and attaches it as vm.participantsVM
 *     before calling renderForm; on a team-chip, year-field, or
 *     participant-toggle change, mission-ui.js rebuilds it and
 *     swaps only the #mission-participants-panel node.
 *   - Layout of the participants panel. That is owned by
 *     missions.css. The renderer emits class names only.
 *   - The custom calendar. That is owned by CalendarConfig
 *     (js/modules/shared/calendar-config.js). This module calls
 *     CalendarConfig.getMonthsForYear(year) and getDaysInMonth()
 *     to build the month <select> and to clamp the day input.
 *     When CalendarConfig is not loaded, the date fields fall
 *     back to Gregorian in-line, so the form keeps working.
 *
 * LAYOUT CONTRACT (missions.css):
 *   The participant editor's layout is:
 *
 *     .participants-panel                 outer column
 *     .participant-team-section           one box per team
 *     .participant-rookie-section         one box for rookies
 *     .participant-section-header         name + count + action
 *     .participant-member-list            reset ul
 *     .participant-member-row             <li>
 *     .participant-member-label           flex row (CSS)
 *     .participant-member-checkbox        auto width (CSS)
 *     .participant-member-name            flex:1 wrap (CSS)
 *     .participant-member-role            trailing
 *     .participant-member-deceased        trailing dagger
 *     .rookie-chip-list / .rookie-chip*   rookie chips
 *
 *   The two-class selector
 *   `.participants-panel .participant-member-checkbox` beats
 *   the generic `.form-group input { width:100% }` rule. The
 *   renderer does not need to fight that rule; it emits the
 *   class and the stylesheet wins.
 *
 * DETAIL PARTICIPANT LIST:
 *   The detail panel's participants are a flat list, not a
 *   grouped editor. The classes are distinct from the form
 *   editor:
 *
 *     .participants-list / .participant-item
 *     .participant-name / .participant-team
 *     .participant-source-(team|rookie|unknown)
 *     .participant-deceased
 *
 *   These match MissionViews.getParticipantSourceClass()
 *   exactly. The renderer uses vm.sourceClass.
 *
 * DOM CONTRACT (mission-ui.js):
 *   The form must expose these exact IDs/classes so the
 *   controller can read the form back on submit:
 *
 *     #mission-support-list       .support-row[data-character-id]
 *     #mission-objectives-list    .objective-row
 *     #mission-teams-list         .mission-team-chip[data-team-id]
 *     #mission-participants-panel (swapped in place)
 *     #mission-title, #mission-description, #mission-year,
 *     #mission-month, #mission-day, #mission-primary-type,
 *     #mission-subtype, #mission-secondary-type,
 *     #mission-escalation, #mission-threat-type,
 *     #mission-environment, #mission-location, #mission-duration,
 *     #mission-difficulty, #mission-priority, #mission-base-pay,
 *     #mission-surcharge-pay, #mission-billing, #mission-status,
 *     #mission-notes, #mission-tags
 *
 *   The participant checkboxes on the form must emit:
 *
 *     data-action="mission-toggle-participant"
 *     data-character-id="..."
 *     data-team-id="..."
 *     data-source="team"
 *     data-mission-id="..."      (edit only; omitted on create)
 *
 *   The Discard Changes button must emit
 *   data-action="mission-close-form". It is labelled
 *   "Discard Changes", NOT "Cancel", so it cannot be confused
 *   with the detail panel's "Cancel Mission".
 *
 * DATE FIELDS (E1):
 *   The three date inputs are:
 *
 *     <input  id="mission-year"  data-mission-year-field="true">
 *     <select id="mission-month" data-mission-month-field="true">
 *     <input  id="mission-day"   data-mission-day-field="true">
 *
 *   The month is now a <select>, not an <input>. The option
 *   values are the month ids returned by
 *   CalendarConfig.getMonthsForYear(year). Those ids are
 *   integers 1..N, renumbered in calendar order per year. In a
 *   year that carries a per-year leap month, N is larger than
 *   in an ordinary year; the leap month appears in the select
 *   with its own name.
 *
 *   The day's `max` attribute is set to
 *   CalendarConfig.getDaysInMonth(year, month). When the user
 *   changes the year or month in the UI, mission-ui.js
 *   (E1.6, one-line edit) updates the day's `max` in place.
 *   Until that edit lands, the schema still rejects out-of-range
 *   days on submit via CalendarValidation.isValidCalendarDate,
 *   so the model stays correct.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.MissionConstants
 *   - window.MissionViews
 *
 * DEPENDENCIES (LAZY, at call time, optional):
 *   - window.CalendarConfig   (custom month names and lengths;
 *                              Gregorian fallback when absent)
 */

(function() {
    'use strict';

    if (window.__missionRenderLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var DomUtils = window.DomUtils;
    var MissionConstants = window.MissionConstants;
    var MissionViews = window.MissionViews;

    var _missing = [];

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        _missing.push('DomUtils.escapeHtml/escapeAttribute');
    }
    if (!MissionConstants) {
        _missing.push('MissionConstants (module)');
    }
    if (!MissionViews) {
        _missing.push('MissionViews (module)');
    } else {
        if (typeof MissionViews.getStatusInfo !== 'function') {
            _missing.push('MissionViews.getStatusInfo');
        }
        if (typeof MissionViews.getPriorityInfo !== 'function') {
            _missing.push('MissionViews.getPriorityInfo');
        }
        if (typeof MissionViews.getParticipantSourceClass !== 'function') {
            _missing.push('MissionViews.getParticipantSourceClass');
        }
    }

    if (_missing.length > 0) {
        throw new Error(
            '[MissionRender] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__missionRenderLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isArray(value) {
        return Array.isArray(value);
    }

    function isPlainObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value);
    }

    function safeString(value) {
        return value === undefined || value === null
            ? ''
            : String(value);
    }

    function toPositiveInt(value, fallback) {
        var n = parseInt(value, 10);
        if (isNaN(n) || n < 1) { return fallback; }
        return n;
    }

    // ============================================================
    // CALENDAR ACCESS (with Gregorian fallback)
    // ============================================================
    //
    // The month <select> and the day input's max come from
    // CalendarConfig. When it is not loaded, or when the active
    // project has no custom calendar, everything falls back to
    // Gregorian exactly as before. The fallback lives here so
    // mission-render.js is self-contained and works in a stripped
    // build that does not include calendar-config.js.

    var GREG_MONTHS = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    function isGregorianLeap(y) {
        return (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
    }

    function gregorianMonths(year) {
        var lp = isGregorianLeap(year);
        var out = [];
        for (var i = 0; i < 12; i++) {
            out.push({
                id: i + 1,
                name: GREG_MONTHS[i],
                days: i === 1 && lp ? 29 :
                      [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][i]
            });
        }
        return out;
    }

    function getMonthsForYear(year) {
        var cfg = window.CalendarConfig;
        if (cfg && typeof cfg.getMonthsForYear === 'function') {
            var list = cfg.getMonthsForYear(year);
            if (isArray(list) && list.length > 0) {
                return list;
            }
        }
        return gregorianMonths(year);
    }

    function getDaysInMonth(year, monthId) {
        var cfg = window.CalendarConfig;
        if (cfg && typeof cfg.getDaysInMonth === 'function') {
            var n = cfg.getDaysInMonth(year, monthId);
            if (typeof n === 'number' && n >= 1) {
                return n;
            }
        }
        var m = toPositiveInt(monthId, 1);
        var list = gregorianMonths(year);
        if (m > list.length) { return 31; }
        return list[m - 1].days;
    }

    // ============================================================
    // CONTAINER
    // ============================================================
    //
    // The page shell. mission-ui.js calls this once per render and
    // then swaps the contents of #missions-list in place via
    // renderList. The modal shells are also installed here once
    // and then filled by openDetailModal / openFormModal /
    // openReportFormModal.

    function renderContainer(vm) {
        vm = vm || {};
        var filter = isNonEmptyString(vm.filter) ? vm.filter : 'all';
        var counts = isPlainObject(vm.counts) ? vm.counts : {};

        var html = '';

        // ---- Page header ----
        html += '<div class="page-header">';
        html += '<h2>Missions</h2>';
        html += '<div class="header-actions">';
        html += '<button type="button" class="secondary" ' +
                    'data-action="mission-import">Import</button>';
        html += '<button type="button" class="primary" ' +
                    'data-action="mission-new">+ New Mission</button>';
        html += '</div>';
        html += '</div>';

        // ---- Filter bar ----
        html += '<div class="filter-section">';
        html += '<label for="mission-filter">Status:</label>';
        html += '<select id="mission-filter">';
        html += renderFilterOption('all', 'All', filter);
        html += renderFilterOption('active', 'Active', filter);
        html += renderFilterOption('completed', 'Completed', filter);
        html += renderFilterOption('cancelled', 'Cancelled', filter);
        html += '</select>';
        html += '<span class="mission-count">' +
                    '<span id="mission-count-total">' +
                        escapeHtml(String(counts.total || 0)) +
                    '</span> total' +
                    ' &middot; ' +
                    '<span id="mission-count-ready">' +
                        escapeHtml(String(counts.readyForCompletion || 0)) +
                    '</span> ready' +
                '</span>';
        html += '</div>';

        // ---- List mount point ----
        html += '<div id="missions-list" class="missions-list"></div>';

        // ---- Detail modal shell ----
        html += '<div id="mission-detail-modal" class="modal hidden">';
        html += '<div class="modal-content wide">';
        html += '<div class="modal-header">';
        html += '<h3 id="mission-detail-title">Mission</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-action="mission-close-detail" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';
        html += '<div id="mission-detail-content" ' +
                    'class="modal-body"></div>';
        html += '</div>';
        html += '</div>';

        // ---- Form modal shell ----
        html += '<div id="mission-form-modal" class="modal hidden">';
        html += '<div class="modal-content wide">';
        html += '<div class="modal-header">';
        html += '<h3 id="mission-form-title">Mission</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-action="mission-close-form" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';
        html += '<div id="mission-form-content" ' +
                    'class="modal-body"></div>';
        html += '</div>';
        html += '</div>';

        return html;
    }

    function renderFilterOption(value, label, current) {
        var selected = current === value ? ' selected' : '';
        return '<option value="' + escapeAttribute(value) + '"' +
                    selected + '>' +
                    escapeHtml(label) +
                '</option>';
    }

    // ============================================================
    // LIST
    // ============================================================

    function renderList(missions) {
        if (!isArray(missions) || missions.length === 0) {
            return renderEmpty();
        }

        var html = '';

        for (var i = 0; i < missions.length; i++) {
            html += renderListRow(missions[i]);
        }

        return html;
    }

    function renderListRow(m) {
        if (!m || typeof m !== 'object') { return ''; }

        var rowClass = 'list-item mission-item';
        if (m.isArchived === true) {
            rowClass += ' mission-archived';
        } else if (m.isCompleted === true) {
            rowClass += ' mission-completed';
        } else if (m.isCancelled === true) {
            rowClass += ' mission-cancelled';
        }

        var statusInfo = MissionViews.getStatusInfo(m.status);
        var priorityInfo = MissionViews.getPriorityInfo(m.priority);

        var html = '';

        html += '<div class="' + rowClass + '" ' +
                    'data-action="mission-list-item" ' +
                    'data-mission-id="' +
                        escapeAttribute(m.id) + '">';

        // ---- 1. Mission ID label ----
        html += '<span class="mission-id">' +
                    escapeHtml(m.missionId || '\u2014') +
                '</span>';

        // ---- 2. Date ----
        html += '<span class="mission-date">' +
                    escapeHtml(m.dateDisplay || '\u2014') +
                '</span>';

        // ---- 3. Title + badges ----
        html += '<span class="mission-title">';
        html += '<strong>' +
                    escapeHtml(m.title || 'Untitled') +
                '</strong>';
        if (m.isCompleted === true) {
            html += '<span class="mission-completed-badge" ' +
                        'title="Completed">\u2714</span>';
        }
        if (m.isArchived === true) {
            html += '<span class="mission-archived-badge">' +
                        'Archived' +
                    '</span>';
        }
        if (typeof m.supportCount === 'number' && m.supportCount > 0) {
            html += '<span class="mission-support-badge" ' +
                        'title="Support personnel">' +
                        'S' + escapeHtml(String(m.supportCount)) +
                    '</span>';
        }
        html += '</span>';

        // ---- 4. Type ----
        html += '<span class="mission-type">' +
                    escapeHtml(m.typeDisplay || 'Unclassified') +
                '</span>';

        // ---- 5. Escalation ----
        html += '<span class="mission-escalation">' +
                    escapeHtml(m.escalationLabel || '\u2014') +
                '</span>';

        // ---- 6. Difficulty ----
        html += '<span class="mission-difficulty">' +
                    escapeHtml(m.difficultyLabel || '\u2014') +
                '</span>';

        // ---- 7. Assigned team(s) ----
        html += '<span class="mission-team">' +
                    renderAssignedTeamsInline(m) +
                '</span>';

        // ---- 8. Progress ----
        html += '<span class="mission-progress">' +
                    renderProgressBar(m.progress) +
                '</span>';

        // ---- 9. Status + priority badges ----
        html += '<span class="mission-status-priority">';
        html += '<span class="mission-status ' +
                    escapeAttribute(statusInfo.class) + '">' +
                    escapeHtml(statusInfo.label) +
                '</span>';
        html += ' ';
        html += '<span class="mission-priority ' +
                    escapeAttribute(priorityInfo.class) + '">' +
                    escapeHtml(priorityInfo.label) +
                '</span>';
        html += '</span>';

        // ---- 10. Grid filler ----
        html += '<span class="mission-row-tail"></span>';

        html += '</div>';
        return html;
    }

    function renderAssignedTeamsInline(m) {
        var teams = isArray(m.assignedTeams) ? m.assignedTeams : [];

        if (teams.length === 0) {
            return escapeHtml(m.teamName || 'Unassigned');
        }

        var first = teams[0];
        var html = escapeHtml(first.name || 'Unnamed Team');
        if (teams.length > 1) {
            html += '<span class="mission-team-extra">' +
                        '+' + (teams.length - 1) +
                    '</span>';
        }
        return html;
    }

    function renderProgressBar(progress) {
        var pct = (typeof progress === 'number' &&
                   isFinite(progress))
            ? Math.max(0, Math.min(100, Math.round(progress)))
            : 0;

        var html = '';
        html += '<span class="progress-bar">';
        html += '<span class="progress-fill" ' +
                    'style="width:' + pct + '%;"></span>';
        html += '</span>';
        html += '<span class="progress-label">' + pct + '%</span>';
        return html;
    }

    // ============================================================
    // EMPTY / LOADING
    // ============================================================

    function renderEmpty() {
        return '<p class="empty-state">No missions found.</p>';
    }

    function renderLoading() {
        return '<p class="empty-state">Loading missions\u2026</p>';
    }

    // ============================================================
    // DETAIL
    // ============================================================

    function renderDetail(vm) {
        if (!vm) { return ''; }

        var statusInfo = MissionViews.getStatusInfo(vm.status);
        var priorityInfo = MissionViews.getPriorityInfo(vm.priority);

        var html = '';

        html += '<div class="mission-detail">';

        // ---- Header ----
        html += '<div class="mission-detail-header">';

        html += '<div class="mission-detail-title-row">';
        html += '<h3 class="mission-detail-title">' +
                    escapeHtml(vm.title || 'Untitled') +
                '</h3>';
        html += '<span class="mission-status ' +
                    escapeAttribute(statusInfo.class) + '">' +
                    escapeHtml(statusInfo.label) +
                '</span>';
        html += '<span class="mission-priority ' +
                    escapeAttribute(priorityInfo.class) + '">' +
                    escapeHtml(priorityInfo.label) +
                '</span>';
        if (vm.isArchived === true) {
            html += '<span class="mission-archived-badge">' +
                        'Archived' +
                    '</span>';
        }
        html += '</div>';

        html += '<div class="mission-detail-id">' +
                    'ID: <span class="mission-id-display">' +
                        escapeHtml(vm.missionId || '\u2014') +
                    '</span>' +
                '</div>';

        if (isNonEmptyString(vm.description)) {
            html += '<p class="mission-detail-description">' +
                        escapeHtml(vm.description) +
                    '</p>';
        }

        html += '</div>';

        // ---- Scalar fields ----
        html += '<div class="mission-detail-fields">';

        html += renderDetailField('Date', vm.dateDisplay);
        html += renderDetailField('Type', vm.typeDisplay);
        html += renderDetailField('Difficulty', vm.difficultyLabel);
        html += renderDetailField('Escalation', vm.escalationLabel);
        html += renderDetailField('Billing', vm.billingLabel);
        html += renderDetailField('Pay', vm.pay);
        html += renderDetailField('Threat type', vm.threatType);
        html += renderDetailField('Environment', vm.environment);
        html += renderDetailField('Location', vm.location);
        html += renderDetailField('Duration', vm.duration);

        html += renderDetailField('Progress',
            (typeof vm.progress === 'number'
                ? vm.progress + '%'
                : ''));

        html += renderDetailField('Created', vm.createdAtDisplay);
        html += renderDetailField('Completed', vm.completedAtDisplay);
        html += renderDetailField('Archived', vm.archivedAtDisplay);

        if (isArray(vm.tags) && vm.tags.length > 0) {
            html += '<div class="detail-row tags-row">';
            html += '<span class="label">Tags</span>';
            html += '<span class="tags-list">';
            for (var t = 0; t < vm.tags.length; t++) {
                html += '<span class="tag">' +
                            escapeHtml(vm.tags[t]) +
                        '</span>';
            }
            html += '</span>';
            html += '</div>';
        }

        if (isNonEmptyString(vm.notes)) {
            html += '<div class="detail-row description-row">';
            html += '<span class="label">Notes</span>';
            html += '<span class="description-text">' +
                        escapeHtml(vm.notes) +
                    '</span>';
            html += '</div>';
        }

        html += '</div>'; // mission-detail-fields

        // ---- Assigned teams ----
        html += renderDetailAssignedTeams(vm);

        // ---- Objectives ----
        html += renderDetailObjectives(vm);

        // ---- Participants ----
        html += renderDetailParticipants(vm);

        // ---- Support personnel ----
        html += renderDetailSupportPersonnel(vm);

        // ---- Reports ----
        html += renderDetailReports(vm);

        // ---- Actions ----
        html += renderDetailActions(vm);

        html += '</div>'; // mission-detail

        return html;
    }

    function renderDetailField(label, value) {
        if (!isNonEmptyString(value)) { return ''; }
        return '<div class="detail-row">' +
                    '<span class="label">' +
                        escapeHtml(label) +
                    '</span>' +
                    '<span class="value">' +
                        escapeHtml(value) +
                    '</span>' +
                '</div>';
    }

    function renderDetailAssignedTeams(vm) {
        var teams = isArray(vm.assignedTeams) ? vm.assignedTeams : [];
        if (teams.length === 0) { return ''; }

        var html = '';
        html += '<div class="assigned-teams-section">';
        html += '<div class="section-header">';
        html += '<strong>Assigned Teams</strong>';
        html += '<span class="count">' + teams.length + '</span>';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="mission-edit" ' +
                    'data-mission-id="' +
                        escapeAttribute(vm.id) + '">' +
                    'Edit' +
                '</button>';
        html += '</div>';
        html += '<ul class="assigned-teams-list">';
        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team) { continue; }
            html += '<li class="assigned-team-item">';
            html += '<span class="assigned-team-name">' +
                        escapeHtml(team.name || 'Unnamed Team') +
                    '</span>';
            html += '<button type="button" class="small danger" ' +
                        'data-action="mission-remove-team" ' +
                        'data-mission-id="' +
                            escapeAttribute(vm.id) + '" ' +
                        'data-team-id="' +
                            escapeAttribute(team.id) + '" ' +
                        'title="Remove this team from the mission">' +
                        '\u2715' +
                    '</button>';
            html += '</li>';
        }
        html += '</ul>';
        html += '</div>';
        return html;
    }

    function renderDetailObjectives(vm) {
        var objectives = isArray(vm.objectives) ? vm.objectives : [];
        var progress = typeof vm.progress === 'number'
            ? vm.progress : 0;

        var html = '';
        html += '<div class="objectives-section">';

        html += '<div class="section-header">';
        html += '<strong>Objectives</strong>';
        html += '<span class="count">' + objectives.length + '</span>';
        html += '<span class="progress-label">' + progress + '%</span>';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="mission-add-objective" ' +
                    'data-mission-id="' +
                        escapeAttribute(vm.id) + '">' +
                    '+ Add' +
                '</button>';
        html += '</div>';

        if (objectives.length === 0) {
            html += '<p class="empty-state small">No objectives.</p>';
            html += '</div>';
            return html;
        }

        html += '<ul class="objectives-list">';
        for (var i = 0; i < objectives.length; i++) {
            var obj = objectives[i];
            if (!obj) { continue; }

            var itemClass = 'objective-item';
            if (obj.done === true) { itemClass += ' objective-done'; }

            html += '<li class="' + itemClass + '">';
            html += '<input type="checkbox" ' +
                        'data-action="mission-objective-toggle" ' +
                        'data-mission-id="' +
                            escapeAttribute(vm.id) + '" ' +
                        'data-objective-index="' +
                            escapeAttribute(String(obj.index)) + '"' +
                        (obj.done === true ? ' checked' : '') +
                        '>';
            html += '<span class="objective-text">' +
                        escapeHtml(obj.text || '(empty)') +
                    '</span>';
            html += '<button type="button" class="small danger" ' +
                        'data-action="mission-remove-objective" ' +
                        'data-mission-id="' +
                            escapeAttribute(vm.id) + '" ' +
                        'data-objective-index="' +
                            escapeAttribute(String(obj.index)) + '" ' +
                        'title="Remove this objective">' +
                        '\u2715' +
                    '</button>';
            html += '</li>';
        }
        html += '</ul>';
        html += '</div>';
        return html;
    }

    function renderDetailParticipants(vm) {
        var participants = isArray(vm.participants)
            ? vm.participants
            : [];

        var html = '';
        html += '<div class="participants-section">';

        html += '<div class="section-header">';
        html += '<strong>Participants</strong>';
        html += '<span class="count">' + participants.length + '</span>';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="mission-open-rookie-picker" ' +
                    'data-mission-id="' +
                        escapeAttribute(vm.id) + '">' +
                    'Add Rookies' +
                '</button>';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="mission-edit-participants" ' +
                    'data-mission-id="' +
                        escapeAttribute(vm.id) + '">' +
                    'Edit Participants' +
                '</button>';
        html += '</div>';

        if (participants.length === 0) {
            html += '<p class="empty-state small">' +
                        'No participants recorded.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<ul class="participants-list">';
        for (var i = 0; i < participants.length; i++) {
            var p = participants[i];
            if (!p) { continue; }

            var itemClass = 'participant-item';
            if (p.source === 'rookie') {
                itemClass += ' participant-rookie';
            }

            var sourceClass = MissionViews.getParticipantSourceClass(
                p.source
            );

            html += '<li class="' + itemClass + '">';

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
                        escapeAttribute(sourceClass) + '">' +
                        escapeHtml(p.sourceLabel || p.source || '') +
                    '</span>';

            html += '<button type="button" class="small danger" ' +
                        'data-action="mission-remove-participant" ' +
                        'data-mission-id="' +
                            escapeAttribute(vm.id) + '" ' +
                        'data-character-id="' +
                            escapeAttribute(p.characterId) + '" ' +
                        'data-team-id="' +
                            escapeAttribute(
                                p.teamId === null || p.teamId === undefined
                                    ? ''
                                    : p.teamId
                            ) + '" ' +
                        'title="Remove this participant">' +
                        '\u2715' +
                    '</button>';

            html += '</li>';
        }
        html += '</ul>';
        html += '</div>';
        return html;
    }

    function renderDetailSupportPersonnel(vm) {
        var support = isArray(vm.supportPersonnel)
            ? vm.supportPersonnel
            : [];

        var html = '';
        html += '<div class="support-section">';

        html += '<div class="section-header">';
        html += '<strong>Support Personnel</strong>';
        html += '<span class="count">' + support.length + '</span>';
        html += '</div>';

        if (support.length === 0) {
            html += '<p class="empty-state small">' +
                        'No support assigned.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<ul class="support-list">';
        for (var i = 0; i < support.length; i++) {
            var s = support[i];
            if (!s) { continue; }

            html += '<li class="support-item">';
            html += '<span class="support-name">' +
                        escapeHtml(s.name || 'Unknown') +
                    '</span>';
            html += '<button type="button" class="small danger" ' +
                        'data-action="mission-remove-support" ' +
                        'data-mission-id="' +
                            escapeAttribute(vm.id) + '" ' +
                        'data-character-id="' +
                            escapeAttribute(s.id) + '" ' +
                        'title="Remove this support assignment">' +
                        '\u2715' +
                    '</button>';
            html += '</li>';
        }
        html += '</ul>';
        html += '</div>';
        return html;
    }

    function renderDetailReports(vm) {
        var reports = isArray(vm.reports) ? vm.reports : [];

        var html = '';
        html += '<div class="reports-section">';

        html += '<div class="section-header">';
        html += '<strong>Reports</strong>';
        html += '<span class="count">' + reports.length + '</span>';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="mission-report-add" ' +
                    'data-mission-id="' +
                        escapeAttribute(vm.id) + '">' +
                    '+ Add Report' +
                '</button>';
        html += '</div>';

        if (reports.length === 0) {
            html += '<p class="empty-state small">No reports.</p>';
            html += '</div>';
            return html;
        }

        for (var i = 0; i < reports.length; i++) {
            var r = reports[i];
            if (!r) { continue; }

            var rowClass = 'report-row';
            if (r.authorRedacted === true) {
                rowClass += ' report-author-redacted';
            }

            html += '<div class="' + rowClass + '">';

            html += '<div class="report-meta">';
            html += '<span class="report-author">' +
                        escapeHtml(r.authorName || 'Unknown') +
                    '</span>';
            html += '<span class="report-timestamp">' +
                        escapeHtml(r.createdAtDisplay || '') +
                    '</span>';
            if (r.isEdited === true) {
                html += '<span class="report-edited">' +
                            '(edited ' +
                            escapeHtml(r.updatedAtDisplay || '') +
                            ')' +
                        '</span>';
            }
            html += '</div>';

            html += '<div class="report-body">' +
                        escapeHtml(r.text || '') +
                    '</div>';

            html += '<div class="report-actions">';
            html += '<button type="button" class="small secondary" ' +
                        'data-action="mission-report-edit" ' +
                        'data-mission-id="' +
                            escapeAttribute(vm.id) + '" ' +
                        'data-report-id="' +
                            escapeAttribute(r.id) + '">' +
                        'Edit' +
                    '</button>';
            html += '<button type="button" class="small danger" ' +
                        'data-action="mission-report-delete" ' +
                        'data-mission-id="' +
                            escapeAttribute(vm.id) + '" ' +
                        'data-report-id="' +
                            escapeAttribute(r.id) + '">' +
                        'Delete' +
                    '</button>';
            html += '</div>';

            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    function renderDetailActions(vm) {
        var caps = vm.capabilities || {};

        var html = '';
        html += '<div class="mission-detail-actions">';

        if (caps.edit === true) {
            html += '<button type="button" class="primary" ' +
                        'data-action="mission-edit" ' +
                        'data-mission-id="' +
                            escapeAttribute(vm.id) + '">' +
                        'Edit' +
                    '</button>';
        }

        if (caps.complete === true) {
            html += '<button type="button" class="secondary" ' +
                        'data-action="mission-complete" ' +
                        'data-mission-id="' +
                            escapeAttribute(vm.id) + '">' +
                        'Mark Complete' +
                    '</button>';
        }

        if (caps.cancel === true) {
            html += '<button type="button" class="secondary" ' +
                        'data-action="mission-cancel" ' +
                        'data-mission-id="' +
                            escapeAttribute(vm.id) + '">' +
                        'Cancel Mission' +
                    '</button>';
        }

        if (caps.reactivate === true) {
            html += '<button type="button" class="secondary" ' +
                        'data-action="mission-reactivate" ' +
                        'data-mission-id="' +
                            escapeAttribute(vm.id) + '">' +
                        'Reactivate' +
                    '</button>';
        }

        html += '<button type="button" class="secondary" ' +
                    'data-action="mission-export" ' +
                    'data-mission-id="' +
                        escapeAttribute(vm.id) + '">' +
                    'Export' +
                '</button>';

        if (vm.isArchived === true) {
            html += '<button type="button" class="danger" ' +
                        'data-action="mission-unarchive" ' +
                        'data-mission-id="' +
                            escapeAttribute(vm.id) + '">' +
                        'Unarchive' +
                    '</button>';
        } else {
            html += '<button type="button" class="danger" ' +
                        'data-action="mission-archive" ' +
                        'data-mission-id="' +
                            escapeAttribute(vm.id) + '">' +
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
        if (!vm) { return ''; }

        var isEdit = vm.isEdit === true;
        var mission = isPlainObject(vm.mission) ? vm.mission : {};
        var defaults = isPlainObject(vm.defaults) ? vm.defaults : {};

        var titleVal = isNonEmptyString(mission.title)
            ? mission.title
            : '';
        var descriptionVal = isNonEmptyString(mission.description)
            ? mission.description
            : '';
        var yearVal = (mission.year !== undefined &&
                       mission.year !== null)
            ? String(mission.year)
            : String(defaults.year || '');
        var monthVal = (mission.month !== undefined &&
                        mission.month !== null)
            ? String(mission.month)
            : String(defaults.month || 1);
        var dayVal = (mission.day !== undefined &&
                      mission.day !== null)
            ? String(mission.day)
            : String(defaults.day || 1);
        var notesVal = isNonEmptyString(mission.notes)
            ? mission.notes
            : '';
        var tagsVal = isArray(mission.tags)
            ? mission.tags.join(', ')
            : '';

        var html = '';

        html += '<form id="mission-form-inner" class="mission-form" ' +
                    'data-edit-id="' +
                        escapeAttribute(isEdit ? (vm.editId || '') : '') +
                    '">';

        html += '<div class="form-grid">';

        html += renderFormText('mission-title', 'Title',
            titleVal, 'full-width', true);

        html += renderFormTextarea('mission-description', 'Description',
            descriptionVal, 'full-width');

        html += renderDateFields(yearVal, monthVal, dayVal);

        html += renderTypeFields(vm, mission);

        html += renderFormSelect('mission-escalation', 'Escalation',
            vm.escalationTiers || [], mission.escalation || '');
        html += renderFormText('mission-threat-type', 'Threat Type',
            mission.threatType || '');

        html += renderFormText('mission-environment', 'Environment',
            mission.environment || '');
        html += renderFormText('mission-location', 'Location',
            mission.location || '');
        html += renderFormText('mission-duration', 'Duration',
            mission.duration || '');

        html += renderFormSelect('mission-difficulty', 'Difficulty',
            vm.difficulties || [], mission.difficulty || '');
        html += renderFormSelect('mission-priority', 'Priority',
            vm.priorities || [], mission.priority || '');

        html += renderFormText('mission-base-pay', 'Base Pay',
            mission.basePay || '');
        html += renderFormText('mission-surcharge-pay',
            'Surcharge Pay', mission.surchargePay || '');
        html += renderFormSelect('mission-billing', 'Billing',
            vm.billingTypes || [], mission.billing || '');

        html += renderFormSelect('mission-status', 'Status',
            vm.statuses || [], mission.status || '');

        html += renderDerivedLabel(vm, isEdit);

        html += renderTeamsEditor(vm, mission);

        html += renderSupportEditor(vm, mission);

        html += renderObjectivesEditor(mission);

        html += renderParticipantsPanel(vm);

        html += renderFormTextarea('mission-notes', 'Notes',
            notesVal, 'full-width');

        html += renderFormText('mission-tags', 'Tags',
            tagsVal, 'full-width',
            false,
            'Comma-separated. e.g. urgent, night, long-term');

        html += '</div>'; // form-grid

        // ---- Action bar ----
        html += '<div class="form-actions">';
        html += '<button type="button" class="secondary" ' +
                    'data-action="mission-close-form">' +
                    'Discard Changes' +
                '</button>';
        html += '<button type="submit" class="primary">' +
                    (isEdit ? 'Update Mission' : 'Create Mission') +
                '</button>';
        html += '</div>';

        html += '</form>';

        return html;
    }

    // ============================================================
    // FORM FIELD HELPERS
    // ============================================================

    function renderFormText(id, label, value, extraClass,
                            required, hint) {
        var groupClass = 'form-group';
        if (isNonEmptyString(extraClass)) {
            groupClass += ' ' + extraClass;
        }

        var html = '';
        html += '<div class="' + groupClass + '">';
        html += '<label for="' + escapeAttribute(id) + '">' +
                    escapeHtml(label) +
                    (required === true ? ' *' : '') +
                '</label>';
        html += '<input type="text" ' +
                    'id="' + escapeAttribute(id) + '" ' +
                    'name="' + escapeAttribute(id) + '" ' +
                    'value="' + escapeAttribute(safeString(value)) + '"' +
                    (required === true ? ' required' : '') +
                    '>';
        if (isNonEmptyString(hint)) {
            html += '<span class="field-hint">' +
                        escapeHtml(hint) +
                    '</span>';
        }
        html += '</div>';
        return html;
    }

    function renderFormTextarea(id, label, value, extraClass) {
        var groupClass = 'form-group';
        if (isNonEmptyString(extraClass)) {
            groupClass += ' ' + extraClass;
        }

        var html = '';
        html += '<div class="' + groupClass + '">';
        html += '<label for="' + escapeAttribute(id) + '">' +
                    escapeHtml(label) +
                '</label>';
        html += '<textarea id="' + escapeAttribute(id) + '" ' +
                    'name="' + escapeAttribute(id) + '" ' +
                    'rows="3">' +
                    escapeHtml(safeString(value)) +
                '</textarea>';
        html += '</div>';
        return html;
    }

    function renderFormSelect(id, label, options, currentValue) {
        var html = '';
        html += '<div class="form-group">';
        html += '<label for="' + escapeAttribute(id) + '">' +
                    escapeHtml(label) +
                '</label>';
        html += '<select id="' + escapeAttribute(id) + '" ' +
                    'name="' + escapeAttribute(id) + '">';
        html += '<option value="">Select...</option>';
        if (isArray(options)) {
            for (var i = 0; i < options.length; i++) {
                var opt = options[i];
                if (!opt) { continue; }
                var selected = currentValue === opt.id
                    ? ' selected'
                    : '';
                html += '<option value="' +
                            escapeAttribute(opt.id) + '"' +
                            selected + '>' +
                            escapeHtml(opt.label || opt.id) +
                        '</option>';
            }
        }
        html += '</select>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // DATE FIELDS (custom-calendar aware)
    // ============================================================
    //
    // Year is a number input. Month is a <select> populated from
    // CalendarConfig.getMonthsForYear(year) — the active project's
    // calendar when one is set, Gregorian otherwise. The month ids
    // are integers 1..N, renumbered per year so that in a year with
    // a leap-month insertion, the leap month appears at its own
    // position and the following months shift by one.
    //
    // Day's max is the number of days in that month, in that year,
    // in that calendar. The browser clamps the number spinner; a
    // manually typed out-of-range day is rejected on submit by
    // MissionSchema via CalendarValidation.isValidCalendarDate.
    //
    // The data-* markers on the three fields are what mission-ui.js
    // reads to reset untouched month/day when the year changes.

    function renderDateFields(yearVal, monthVal, dayVal) {
        var yearNum = toPositiveInt(yearVal, null);
        var fallbackYear = yearNum !== null
            ? yearNum
            : new Date().getFullYear();

        var months = getMonthsForYear(fallbackYear);
        if (!isArray(months) || months.length === 0) {
            months = gregorianMonths(fallbackYear);
        }

        var selectedMonth = toPositiveInt(monthVal, 1);
        if (selectedMonth > months.length) {
            selectedMonth = 1;
        }

        var maxDays = months[selectedMonth - 1].days;
        var selectedDay = toPositiveInt(dayVal, 1);
        if (selectedDay > maxDays) {
            selectedDay = maxDays;
        }

        var html = '';
        html += '<div class="form-group full-width">';
        html += '<label>Date</label>';
        html += '<div class="date-input-group">';

        // ---- Year ----
        html += '<div class="date-field">';
        html += '<span class="date-label">Year</span>';
        html += '<input type="number" id="mission-year" ' +
                    'class="date-year" min="1" ' +
                    'data-mission-year-field="true" ' +
                    'value="' + escapeAttribute(yearVal) + '" ' +
                    'placeholder="Year">';
        html += '</div>';

        // ---- Month (custom-calendar <select>) ----
        html += '<div class="date-field">';
        html += '<span class="date-label">Month</span>';
        html += '<select id="mission-month" ' +
                    'class="date-month" ' +
                    'data-mission-month-field="true">';
        for (var i = 0; i < months.length; i++) {
            var m = months[i];
            var isSel = m.id === selectedMonth;
            html += '<option value="' + escapeAttribute(m.id) + '"' +
                        (isSel ? ' selected' : '') + '>' +
                        escapeHtml(m.name) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        // ---- Day ----
        html += '<div class="date-field">';
        html += '<span class="date-label">Day</span>';
        html += '<input type="number" id="mission-day" ' +
                    'class="date-day" min="1" max="' +
                    escapeAttribute(String(maxDays)) + '" ' +
                    'data-mission-day-field="true" ' +
                    'value="' + escapeAttribute(String(selectedDay)) + '">';
        html += '</div>';

        html += '</div>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // TYPE FIELDS (primary / subtype / secondary)
    // ============================================================

    function renderTypeFields(vm, mission) {
        var types = isArray(vm.missionTypes) ? vm.missionTypes : [];
        var primaryType = mission.primaryType || '';
        var subtype = mission.subtype || '';
        var secondaryType = mission.secondaryType || '';

        var primary = null;
        for (var i = 0; i < types.length; i++) {
            if (types[i] && types[i].id === primaryType) {
                primary = types[i];
                break;
            }
        }

        var html = '';

        // ---- Primary type ----
        html += '<div class="form-group">';
        html += '<label for="mission-primary-type">' +
                    'Primary Type' +
                '</label>';
        html += '<select id="mission-primary-type" ' +
                    'name="mission-primary-type">';
        html += '<option value="">Select...</option>';
        for (var p = 0; p < types.length; p++) {
            var pt = types[p];
            if (!pt || !pt.id) { continue; }
            var pSel = primaryType === pt.id ? ' selected' : '';
            html += '<option value="' +
                        escapeAttribute(pt.id) + '"' + pSel + '>' +
                        escapeHtml(pt.label || pt.id) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        // ---- Subtype ----
        html += '<div class="form-group">';
        html += '<label for="mission-subtype">Subtype</label>';
        html += '<select id="mission-subtype" ' +
                    'name="mission-subtype">';
        if (primary && isArray(primary.subtypes) &&
            primary.subtypes.length > 0) {
            html += '<option value="">Select...</option>';
            for (var s = 0; s < primary.subtypes.length; s++) {
                var st = primary.subtypes[s];
                if (!st || !st.id) { continue; }
                var sSel = subtype === st.id ? ' selected' : '';
                html += '<option value="' +
                            escapeAttribute(st.id) + '"' + sSel + '>' +
                            escapeHtml(st.label || st.id) +
                        '</option>';
            }
        } else {
            var placeholder = primary
                ? '(no subtypes for this category)'
                : '(select a category first)';
            html += '<option value="" disabled selected>' +
                        escapeHtml(placeholder) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        // ---- Secondary type ----
        html += '<div class="form-group">';
        html += '<label for="mission-secondary-type">' +
                    'Secondary Type' +
                '</label>';
        html += '<select id="mission-secondary-type" ' +
                    'name="mission-secondary-type">';
        html += '<option value="">None</option>';
        for (var q = 0; q < types.length; q++) {
            var qt = types[q];
            if (!qt || !qt.id) { continue; }
            var qSel = secondaryType === qt.id ? ' selected' : '';
            html += '<option value="' +
                        escapeAttribute(qt.id) + '"' + qSel + '>' +
                        escapeHtml(qt.label || qt.id) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // DERIVED LABEL
    // ============================================================

    function renderDerivedLabel(vm, isEdit) {
        var label = isNonEmptyString(vm.currentLabel)
            ? vm.currentLabel
            : '';

        var html = '';
        html += '<div class="form-group full-width">';
        html += '<label>Mission ID</label>';
        if (isEdit && label !== '') {
            html += '<div class="mission-form-id-display">' +
                        escapeHtml(label) +
                    '</div>';
        } else {
            html += '<div class="mission-form-id-display ' +
                        'mission-form-id-pending">' +
                        'Assigned on save' +
                    '</div>';
        }
        html += '</div>';
        return html;
    }

    // ============================================================
    // TEAMS EDITOR
    // ============================================================

    function renderTeamsEditor(vm, mission) {
        var teamOptions = isArray(vm.teams) ? vm.teams : [];
        var currentTeamIds = isArray(mission.assignedTeamIds)
            ? mission.assignedTeamIds
            : [];

        var currentSet = Object.create(null);
        for (var c = 0; c < currentTeamIds.length; c++) {
            if (isNonEmptyString(currentTeamIds[c])) {
                currentSet[String(currentTeamIds[c])] = true;
            }
        }

        var optionById = Object.create(null);
        for (var o = 0; o < teamOptions.length; o++) {
            var opt = teamOptions[o];
            if (!opt || !opt.id) { continue; }
            optionById[String(opt.id)] = opt;
        }

        var pickable = [];
        for (var p = 0; p < teamOptions.length; p++) {
            var pt = teamOptions[p];
            if (!pt || !pt.id) { continue; }
            if (currentSet[String(pt.id)] === true) { continue; }
            pickable.push(pt);
        }

        var html = '';
        html += '<div class="form-group full-width">';
        html += '<label>Assigned Teams</label>';
        html += '<div class="mission-team-editor">';

        html += '<div class="mission-team-input-group">';
        html += '<select id="mission-team-select" ' +
                    'class="mission-team-select"' +
                    (pickable.length === 0 ? ' disabled' : '') + '>';
        if (pickable.length === 0) {
            var placeholder = teamOptions.length === 0
                ? 'No eligible teams available'
                : 'All eligible teams assigned';
            html += '<option value="" disabled selected>' +
                        escapeHtml(placeholder) +
                    '</option>';
        } else {
            html += '<option value="">Select a team...</option>';
            for (var pk = 0; pk < pickable.length; pk++) {
                var pt2 = pickable[pk];
                html += '<option value="' +
                            escapeAttribute(pt2.id) + '">' +
                            escapeHtml(pt2.name || pt2.id) +
                        '</option>';
            }
        }
        html += '</select>';
        html += '<button type="button" class="small primary ' +
                    'mission-add-team" ' +
                    'data-action="mission-add-team"' +
                    (pickable.length === 0 ? ' disabled' : '') + '>' +
                    '+ Add Team' +
                '</button>';
        html += '</div>';

        html += '<div id="mission-teams-list" ' +
                    'class="mission-teams-list">';
        if (currentTeamIds.length === 0) {
            html += '<p class="empty-state small">' +
                        'No teams assigned.' +
                    '</p>';
        } else {
            for (var t = 0; t < currentTeamIds.length; t++) {
                var teamId = String(currentTeamIds[t]);
                var team = optionById[teamId];
                var teamName = team && isNonEmptyString(team.name)
                    ? team.name
                    : teamId;
                html += '<div class="mission-team-chip" ' +
                            'data-team-id="' +
                                escapeAttribute(teamId) + '">';
                html += '<span class="mission-team-chip-name">' +
                            escapeHtml(teamName) +
                        '</span>';
                html += '<button type="button" ' +
                            'class="small danger" ' +
                            'data-action="mission-remove-team" ' +
                            'data-team-id="' +
                                escapeAttribute(teamId) + '" ' +
                            'title="Remove this team">' +
                            '\u2715' +
                        '</button>';
                html += '</div>';
            }
        }
        html += '</div>';

        html += '</div>'; // mission-team-editor
        html += '</div>'; // form-group full-width

        return html;
    }

    // ============================================================
    // SUPPORT EDITOR
    // ============================================================

    function renderSupportEditor(vm, mission) {
        var charOptions = isArray(vm.characters) ? vm.characters : [];
        var currentSupportIds = isArray(mission.supportPersonnel)
            ? mission.supportPersonnel
            : [];

        var currentSet = Object.create(null);
        for (var c = 0; c < currentSupportIds.length; c++) {
            if (isNonEmptyString(currentSupportIds[c])) {
                currentSet[String(currentSupportIds[c])] = true;
            }
        }

        var charById = Object.create(null);
        for (var ch = 0; ch < charOptions.length; ch++) {
            var char = charOptions[ch];
            if (!char || !char.id) { continue; }
            charById[String(char.id)] = char;
        }

        var pickable = [];
        for (var p = 0; p < charOptions.length; p++) {
            var pc = charOptions[p];
            if (!pc || !pc.id) { continue; }
            if (currentSet[String(pc.id)] === true) { continue; }
            pickable.push(pc);
        }

        var html = '';
        html += '<div class="form-group full-width">';
        html += '<label>Support Personnel</label>';

        html += '<div class="support-input-group">';
        html += '<select id="mission-support-select" ' +
                    'class="support-select"' +
                    (pickable.length === 0 ? ' disabled' : '') + '>';
        if (pickable.length === 0) {
            var placeholder = charOptions.length === 0
                ? 'No characters available'
                : 'All characters are already support';
            html += '<option value="" disabled selected>' +
                        escapeHtml(placeholder) +
                    '</option>';
        } else {
            html += '<option value="">Select a character...</option>';
            for (var pk = 0; pk < pickable.length; pk++) {
                var pc2 = pickable[pk];
                html += '<option value="' +
                            escapeAttribute(pc2.id) + '">' +
                            escapeHtml(pc2.name || pc2.id) +
                        '</option>';
            }
        }
        html += '</select>';
        html += '<button type="button" class="small primary ' +
                    'data-action="mission-add-support"' +
                    (pickable.length === 0 ? ' disabled' : '') + '>' +
                    '+ Add' +
                '</button>';
        html += '</div>';

        html += '<div id="mission-support-list">';
        if (currentSupportIds.length === 0) {
            html += '<p class="empty-state small">' +
                        'No support assigned.' +
                    '</p>';
        } else {
            for (var s = 0; s < currentSupportIds.length; s++) {
                var sId = String(currentSupportIds[s]);
                var sChar = charById[sId];
                var sName = sChar && isNonEmptyString(sChar.name)
                    ? sChar.name
                    : sId;
                html += '<div class="support-row" ' +
                            'data-character-id="' +
                                escapeAttribute(sId) + '">';
                html += '<span class="support-name">' +
                            escapeHtml(sName) +
                        '</span>';
                html += '<button type="button" ' +
                            'class="small danger" ' +
                            'data-action="mission-remove-support" ' +
                            'data-character-id="' +
                                escapeAttribute(sId) + '">' +
                            '\u2715' +
                        '</button>';
                html += '</div>';
            }
        }
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // OBJECTIVES EDITOR
    // ============================================================

    function renderObjectivesEditor(mission) {
        var objectives = isArray(mission.objectives)
            ? mission.objectives
            : [];

        var html = '';
        html += '<div class="form-group full-width">';
        html += '<label>Objectives</label>';

        html += '<div class="objective-input-group">';
        html += '<input type="text" ' +
                    'id="mission-objective-input" ' +
                    'class="objective-input" ' +
                    'placeholder="New objective...">';
        html += '<button type="button" class="small primary" ' +
                    'data-action="mission-add-objective">' +
                    '+ Add' +
                '</button>';
        html += '</div>';

        html += '<div id="mission-objectives-list">';
        if (objectives.length === 0) {
            html += '<p class="empty-state small">No objectives.</p>';
        } else {
            for (var i = 0; i < objectives.length; i++) {
                var obj = objectives[i];
                if (!obj) { continue; }
                html += '<div class="objective-row">';
                html += '<input type="checkbox" class="objective-done"' +
                            (obj.done === true ? ' checked' : '') +
                        '>';
                html += '<input type="text" ' +
                            'class="objective-text-input" ' +
                            'value="' +
                                escapeAttribute(obj.text || '') + '">';
                html += '<button type="button" ' +
                            'class="small danger" ' +
                            'data-action="mission-remove-objective" ' +
                            'data-objective-index="' +
                                escapeAttribute(String(obj.index)) + '">' +
                            '\u2715' +
                        '</button>';
                html += '</div>';
            }
        }
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // PARTICIPANTS PANEL
    // ============================================================

    function renderParticipantsPanel(vm) {
        var pvm = vm && vm.participantsVM
            ? vm.participantsVM
            : null;

        var html = '';
        html += '<div class="form-group full-width">';
        html += '<label>Participants</label>';
        html += '<div id="mission-participants-panel" ' +
                    'class="participants-panel">';

        if (!pvm) {
            html += '<p class="empty-state small">' +
                        'Add a team to the mission to manage ' +
                        'its participants.' +
                    '</p>';
            html += '</div>';
            html += '</div>';
            return html;
        }

        var missionId = pvm.missionId || null;
        var missionIdAttr = missionId
            ? ' data-mission-id="' +
                escapeAttribute(String(missionId)) + '"'
            : '';

        var assignedTeams = isArray(pvm.assignedTeams)
            ? pvm.assignedTeams
            : [];
        var currentParticipants = isArray(pvm.currentParticipants)
            ? pvm.currentParticipants
            : [];

        if (assignedTeams.length === 0) {
            html += '<p class="empty-state small">' +
                        'No teams assigned yet. Add a team above to ' +
                        'manage its participants.' +
                    '</p>';
        } else {
            for (var t = 0; t < assignedTeams.length; t++) {
                html += renderParticipantTeamSection(
                    assignedTeams[t], missionIdAttr
                );
            }
        }

        html += renderRookieSection(
            currentParticipants, missionIdAttr
        );

        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderParticipantTeamSection(team, missionIdAttr) {
        if (!team || !team.teamId) { return ''; }

        var members = isArray(team.members) ? team.members : [];

        var html = '';
        html += '<div class="participant-team-section">';

        html += '<div class="participant-section-header">';
        html += '<span class="participant-team-name">' +
                    escapeHtml(team.teamName || 'Unnamed Team') +
                '</span>';
        html += '<span class="participant-team-count">' +
                    members.length + ' member' +
                    (members.length === 1 ? '' : 's') +
                '</span>';
        html += '</div>';

        if (members.length === 0) {
            html += '<p class="empty-state small">' +
                        'No active members at the mission year.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<ul class="participant-member-list">';
        for (var i = 0; i < members.length; i++) {
            html += renderTeamMemberCheckbox(
                team, members[i], missionIdAttr
            );
        }
        html += '</ul>';

        html += '</div>';
        return html;
    }

    function renderTeamMemberCheckbox(team, member, missionIdAttr) {
        if (!member || !member.characterId) { return ''; }

        var charId = String(member.characterId);
        var teamId = String(team.teamId);
        var checked = member.isParticipant === true;

        var html = '';
        html += '<li class="participant-member-row">';
        html += '<label class="participant-member-label">';

        html += '<input type="checkbox" ' +
                    'class="participant-member-checkbox" ' +
                    'data-action="mission-toggle-participant" ' +
                    'data-character-id="' +
                        escapeAttribute(charId) + '" ' +
                    'data-team-id="' +
                        escapeAttribute(teamId) + '" ' +
                    'data-source="team"' +
                    missionIdAttr +
                    (checked ? ' checked' : '') +
                    '>';

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

    function renderRookieSection(currentParticipants, missionIdAttr) {
        var rookies = [];
        for (var i = 0; i < currentParticipants.length; i++) {
            var p = currentParticipants[i];
            if (!p) { continue; }
            if (p.source !== 'rookie') { continue; }
            rookies.push(p);
        }

        var html = '';
        html += '<div class="participant-rookie-section">';

        html += '<div class="participant-section-header">';
        html += '<span class="participant-team-name">Rookies</span>';
        html += '<span class="participant-team-count">' +
                    rookies.length +
                '</span>';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="mission-open-rookie-picker"' +
                    missionIdAttr + '>' +
                    '+ Add Rookies' +
                '</button>';
        html += '</div>';

        if (rookies.length === 0) {
            html += '<p class="empty-state small">' +
                        'No rookies selected.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="rookie-chip-list">';
        for (var r = 0; r < rookies.length; r++) {
            var rook = rookies[r];

            html += '<span class="rookie-chip">';
            html += '<span class="rookie-chip-name">' +
                        escapeHtml(rook.displayName || 'Unknown') +
                    '</span>';
            if (rook.deceased === true) {
                html += '<span class="rookie-chip-deceased" ' +
                            'title="Deceased">\u2020</span>';
            }
            html += '<button type="button" ' +
                        'class="rookie-chip-remove" ' +
                        'data-action="mission-remove-participant" ' +
                        'data-character-id="' +
                            escapeAttribute(rook.characterId) + '" ' +
                        'data-team-id=""' +
                        missionIdAttr + ' ' +
                        'title="Remove this rookie">' +
                        '\u2715' +
                    '</button>';
            html += '</span>';
        }
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // REPORT FORM MODAL
    // ============================================================

    function renderReportFormModal(vm) {
        if (!vm) { return ''; }

        var isEdit = vm.mode === 'edit';

        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>' +
                    (isEdit ? 'Edit Report' : 'Add Report') +
                    ' \u2014 ' +
                    escapeHtml(vm.missionTitle || 'Mission') +
                '</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-action="mission-report-cancel" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body mission-report-body">';

        html += '<div class="form-group">';
        html += '<label for="mission-report-author">Author</label>';
        html += '<select id="mission-report-author"' +
                    (vm.authorRedacted === true ? ' disabled' : '') +
                    '>';
        html += '<option value="">Select...</option>';
        html += renderAuthorOptgroup(
            'Assigned Team Members',
            vm.teamMembers,
            vm.authorId
        );
        html += renderAuthorOptgroup(
            'Other Characters',
            vm.otherCharacters,
            vm.authorId
        );
        html += '</select>';
        html += '</div>';

        html += '<div class="form-group mission-report-redact-row">';
        html += '<label>';
        html += '<input type="checkbox" ' +
                    'id="mission-report-redacted"' +
                    (vm.authorRedacted === true ? ' checked' : '') +
                    '> ';
        html += 'Submit as redacted (no author)';
        html += '</label>';
        html += '<span class="field-hint">' +
                    'When redacted, the report is filed under ' +
                    '\u201cUnknown\u201d and the author select ' +
                    'is disabled.' +
                '</span>';
        html += '</div>';

        html += '<div class="form-group">';
        html += '<label for="mission-report-text">' +
                    'Report Text' +
                '</label>';
        html += '<textarea id="mission-report-text" ' +
                    'rows="10" ' +
                    'spellcheck="true" ' +
                    'placeholder="Write the report...">' +
                    escapeHtml(vm.text || '') +
                '</textarea>';
        html += '<span class="field-hint">' +
                    'Ctrl / Cmd + Enter to submit.' +
                '</span>';
        html += '</div>';

        html += '<div id="mission-report-error" ' +
                    'class="mission-report-error" ' +
                    'style="display:none;padding:8px 12px;' +
                    'background:var(--danger-soft);' +
                    'border-left:3px solid var(--danger);' +
                    'border-radius:4px;' +
                    'font-size:0.75rem;color:var(--danger);"></div>';

        html += '</div>';

        html += '<div class="form-actions" ' +
                    'style="display:flex;gap:8px;' +
                    'justify-content:flex-end;' +
                    'margin-top:12px;padding-top:12px;' +
                    'border-top:1px solid var(--border-soft);">';
        html += '<button type="button" class="secondary" ' +
                    'data-action="mission-report-cancel">' +
                    'Cancel' +
                '</button>';
        html += '<button type="button" class="primary" ' +
                    'data-action="mission-report-submit">' +
                    (isEdit ? 'Update Report' : 'Add Report') +
                '</button>';
        html += '</div>';

        return html;
    }

    function renderAuthorOptgroup(label, options, currentAuthorId) {
        if (!isArray(options) || options.length === 0) {
            return '';
        }

        var html = '';
        html += '<optgroup label="' +
                    escapeAttribute(label) + '">';
        for (var i = 0; i < options.length; i++) {
            var opt = options[i];
            if (!opt || !opt.id) { continue; }

            var selected = currentAuthorId &&
                           String(currentAuthorId) === String(opt.id)
                ? ' selected'
                : '';

            var display = opt.name || 'Unknown';
            if (opt.deceased === true) {
                display += ' \u2020';
            }

            html += '<option value="' +
                        escapeAttribute(opt.id) + '"' + selected + '>' +
                        escapeHtml(display) +
                    '</option>';
        }
        html += '</optgroup>';
        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionRender = Object.freeze({
        renderContainer: renderContainer,
        renderList: renderList,
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
            'renderList',
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

        // Smoke test: participant panel contract, no inline styles.
        try {
            var fakeVM = {
                isEdit: false,
                editId: null,
                mission: {
                    title: '',
                    description: '',
                    year: 2026,
                    month: 1,
                    day: 1,
                    primaryType: '',
                    subtype: '',
                    secondaryType: '',
                    escalation: '',
                    threatType: '',
                    environment: '',
                    location: '',
                    duration: '',
                    difficulty: '',
                    priority: '',
                    basePay: '',
                    surchargePay: '',
                    billing: '',
                    status: '',
                    objectives: [],
                    notes: '',
                    tags: [],
                    assignedTeamIds: [],
                    supportPersonnel: [],
                    participants: []
                },
                currentLabel: null,
                teams: [],
                characters: [],
                difficulties: [],
                priorities: [],
                statuses: [],
                billingTypes: [],
                escalationTiers: [],
                missionTypes: [],
                defaults: { year: 2026, month: 1, day: 1 },
                participantsVM: {
                    missionId: null,
                    missionTitle: 'Mission',
                    missionYear: 2026,
                    assignedTeams: [
                        {
                            teamId: 'team_a',
                            teamName: 'Alpha',
                            members: [
                                {
                                    characterId: 'char_1',
                                    displayName: 'Anne',
                                    role: 'Leader',
                                    deceased: false,
                                    isParticipant: true
                                }
                            ]
                        }
                    ],
                    currentParticipants: [
                        {
                            characterId: 'char_2',
                            displayName: 'Beth',
                            teamId: null,
                            teamName: null,
                            source: 'rookie',
                            sourceLabel: 'Rookie',
                            deceased: false
                        }
                    ]
                }
            };

            var html = renderForm(fakeVM);

            if (html.indexOf('id="mission-participants-panel"') === -1) {
                missing.push(
                    'renderForm did not emit #mission-participants-panel'
                );
            }
            if (html.indexOf('class="participant-member-checkbox"') === -1) {
                missing.push(
                    'renderForm did not emit .participant-member-checkbox'
                );
            }
            if (html.indexOf('data-action="mission-toggle-participant"') === -1) {
                missing.push(
                    'renderForm did not emit the toggle action'
                );
            }
            if (html.indexOf('data-character-id="char_1"') === -1) {
                missing.push(
                    'renderForm did not emit the character id on the toggle'
                );
            }
            if (html.indexOf('data-team-id="team_a"') === -1) {
                missing.push(
                    'renderForm did not emit the team id on the toggle'
                );
            }
            if (html.indexOf('class="rookie-chip"') === -1) {
                missing.push(
                    'renderForm did not emit .rookie-chip for the rookie'
                );
            }
            if (html.indexOf('data-action="mission-close-form"') === -1) {
                missing.push(
                    'renderForm did not emit the Discard Changes action'
                );
            }
            if (html.indexOf('Discard Changes') === -1) {
                missing.push(
                    'renderForm did not label the abandon button ' +
                    '"Discard Changes"'
                );
            }

            // No inline flex on the participant panel.
            if (html.indexOf('participant-member-label" ' +
                             'style="display:flex') !== -1) {
                missing.push(
                    'renderForm re-introduced inline flex styles on ' +
                    'the participant label'
                );
            }
            if (html.indexOf('participant-member-checkbox" ' +
                             'style=') !== -1) {
                missing.push(
                    'renderForm re-introduced inline styles on the ' +
                    'participant checkbox'
                );
            }
            if (html.indexOf('participant-member-name" ' +
                             'style=') !== -1) {
                missing.push(
                    'renderForm re-introduced inline styles on the ' +
                    'participant name'
                );
            }

            // E1: date fields emit the correct elements.
            if (html.indexOf('id="mission-year"') === -1) {
                missing.push('renderForm missing #mission-year');
            }
            if (html.indexOf('id="mission-month"') === -1) {
                missing.push('renderForm missing #mission-month');
            }
            if (html.indexOf('id="mission-day"') === -1) {
                missing.push('renderForm missing #mission-day');
            }
            // Month is a <select>, not an <input>.
            if (html.indexOf('select id="mission-month"') === -1) {
                missing.push(
                    'renderForm did not emit #mission-month as a <select>'
                );
            }
            // data-* markers must survive.
            if (html.indexOf('data-mission-year-field="true"') === -1) {
                missing.push(
                    'renderForm lost data-mission-year-field'
                );
            }
            if (html.indexOf('data-mission-month-field="true"') === -1) {
                missing.push(
                    'renderForm lost data-mission-month-field'
                );
            }
            if (html.indexOf('data-mission-day-field="true"') === -1) {
                missing.push(
                    'renderForm lost data-mission-day-field'
                );
            }
            // January must appear in the Gregorian fallback.
            if (html.indexOf('>January<') === -1) {
                missing.push(
                    'renderForm month <select> did not include Gregorian ' +
                    'fallback months'
                );
            }
        } catch (e) {
            missing.push('form smoke test threw: ' + e.message);
        }

        // Smoke test: report form modal.
        try {
            var reportHtml = renderReportFormModal({
                mode: 'create',
                missionId: 'm1',
                missionTitle: 'Test',
                reportId: null,
                authorId: '',
                authorRedacted: false,
                text: '',
                teamMembers: [
                    { id: 'c1', name: 'Anne', deceased: false }
                ],
                otherCharacters: [
                    { id: 'c2', name: 'Beth', deceased: true }
                ]
            });

            if (reportHtml.indexOf('id="mission-report-author"') === -1) {
                missing.push(
                    'renderReportFormModal missing #mission-report-author'
                );
            }
            if (reportHtml.indexOf('id="mission-report-redacted"') === -1) {
                missing.push(
                    'renderReportFormModal missing #mission-report-redacted'
                );
            }
            if (reportHtml.indexOf('id="mission-report-text"') === -1) {
                missing.push(
                    'renderReportFormModal missing #mission-report-text'
                );
            }
            if (reportHtml.indexOf('data-action="mission-report-submit"') === -1) {
                missing.push(
                    'renderReportFormModal missing submit action'
                );
            }
            if (reportHtml.indexOf('<optgroup label="Assigned Team Members"') === -1) {
                missing.push(
                    'renderReportFormModal missing team-members optgroup'
                );
            }
            if (reportHtml.indexOf('<optgroup label="Other Characters"') === -1) {
                missing.push(
                    'renderReportFormModal missing other-characters optgroup'
                );
            }
        } catch (e) {
            missing.push('report smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[MissionRender] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
