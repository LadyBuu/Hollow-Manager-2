/**
 * modules/academy/academy-weekly-teams-members.js
 * Academy Weekly Teams Member Manager.
 *
 * Path: js/modules/academy/academy-weekly-teams-members.js
 *
 * Week-scoped member management for a specific (class, team) pair.
 * Container-based: the caller supplies the modal shell and this
 * module renders into it.
 *
 * LAYOUT:
 *   Current Members section: one block per member. Each block has a
 *   header (name, role, status, Remove-member button) and one row
 *   per interval (Join, Leave, Leave-at-week button, Remove-interval
 *   button). The currently-active interval is highlighted and gets
 *   the Leave button.
 *
 *   Former Members section: read-only rows. Each former interval is
 *   shown with a Restore action that offers two paths.
 *
 *   Add Member picker: at the bottom of the Current Members section.
 *
 *   Footer: Revert / Save / Close. Save batches every dirty interval
 *   row into one transaction.
 *
 * SAVE SEMANTICS:
 *   A row is "dirty" when its Leave input differs from its
 *   data-initial-leave attribute. Save collects every dirty row and
 *   calls AcademyWeeklyTeams.updateMemberWindows with the list. One
 *   transaction, all-or-nothing.
 *
 *   Join is immutable. The Join input is disabled. To change when a
 *   stint started, remove it and add a new one.
 *
 * LEAVE-AT-WEEK SEMANTICS (Reading 1):
 *   The per-row Leave button sets the currently-active interval's
 *   leavePeriod to the display week. "Their last active week is
 *   this one." The member is active through the display week and
 *   inactive from the next.
 *
 *   Contrast with endMembership, which uses the "effective week"
 *   convention (leavePeriod = effectiveWeek - 1). The UI uses the
 *   Leave-at-week convention because it matches user intuition.
 *
 * RESTORE SEMANTICS:
 *   The Restore action on a former member opens a small modal with
 *   two options:
 *
 *     1. Correct the leave week — edits the former interval's
 *        leavePeriod in place. Use when the leave week was recorded
 *        wrong.
 *
 *     2. Reopen with a new interval — appends a new interval via
 *        AcademyWeeklyTeams.addMemberInterval. The former interval
 *        survives as history. Use when the member took a break and
 *        came back.
 *
 * MEMBER IDENTITY:
 *   Every entry is addressed by memberId (for whole-member actions)
 *   or { characterId, joinPeriod } (for interval-scoped actions).
 *   The VM carries memberId on each member and joinPeriod on each
 *   interval row.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.AcademyAggregator
 *   - window.AcademyWeeklyTeams
 *   - window.Modal
 *   - window.DomUtils
 *   - window.NotificationSystem
 *   - window.CalendarConstants
 */

(function() {
    'use strict';

    if (window.__academyWeeklyTeamsMembersLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var AcademyAggregator = window.AcademyAggregator;
    var AcademyWeeklyTeams = window.AcademyWeeklyTeams;
    var Modal = window.Modal;
    var DomUtils = window.DomUtils;
    var NotificationSystem = window.NotificationSystem;
    var CalendarConstants = window.CalendarConstants;

    var _missing = [];

    if (!AcademyAggregator ||
        typeof AcademyAggregator.getWeeklyTeamMemberManagerViewModel !== 'function') {
        _missing.push('AcademyAggregator.getWeeklyTeamMemberManagerViewModel');
    }
    if (!AcademyWeeklyTeams ||
        typeof AcademyWeeklyTeams.addMemberInterval !== 'function' ||
        typeof AcademyWeeklyTeams.updateMemberWindows !== 'function' ||
        typeof AcademyWeeklyTeams.purgeMemberRecords !== 'function' ||
        typeof AcademyWeeklyTeams.removeMemberEntry !== 'function' ||
        typeof AcademyWeeklyTeams.setLeaveAtWeek !== 'function') {
        _missing.push('AcademyWeeklyTeams (interval-aware API)');
    }
    if (!Modal ||
        typeof Modal.createModal !== 'function' ||
        typeof Modal.showModal !== 'function') {
        _missing.push('Modal');
    }
    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        _missing.push('DomUtils.escapeHtml/escapeAttribute');
    }
    if (!NotificationSystem ||
        typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }
    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        _missing.push('CalendarConstants.MIN_WEEK/MAX_WEEK');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyWeeklyTeamsMembers] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyWeeklyTeamsMembersLoaded = true;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttr(value) {
        return DomUtils.escapeAttribute(value);
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    // ============================================================
    // STRICT WEEK PARSING
    // ============================================================

    function parseWeekStrict(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        if (typeof value === 'number') {
            if (!Number.isInteger(value)) { return null; }
            if (value < CalendarConstants.MIN_WEEK ||
                value > CalendarConstants.MAX_WEEK) {
                return null;
            }
            return value;
        }
        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '' || !/^\d+$/.test(trimmed)) { return null; }
            var n = Number(trimmed);
            if (!Number.isInteger(n)) { return null; }
            if (n < CalendarConstants.MIN_WEEK ||
                n > CalendarConstants.MAX_WEEK) {
                return null;
            }
            return n;
        }
        return null;
    }

    /**
     * Parse an optional week input. Blank means "unbounded".
     * Returns:
     *   { ok: true, value: '' } for blank
     *   { ok: true, value: 'N' } for a valid week (canonical string)
     *   { ok: false } for invalid input
     */
    function parseOptionalWeekInput(raw) {
        if (raw === undefined || raw === null) {
            return { ok: true, value: '' };
        }
        var str = String(raw).trim();
        if (str === '') {
            return { ok: true, value: '' };
        }
        var parsed = parseWeekStrict(str);
        if (parsed === null) {
            return { ok: false };
        }
        return { ok: true, value: String(parsed) };
    }

    // ============================================================
    // INTERVAL OVERLAP CHECK
    // ============================================================
    //
    // Used by the local pre-check in the batch Save and by the
    // Add-stint form. The mutation layer ALSO enforces non-overlap;
    // this is a friendly-UI duplicate that surfaces the error before
    // the transaction runs.

    function effectiveStart(interval) {
        if (!interval) return 0;
        var v = interval.joinPeriod;
        if (v === undefined || v === null || v === '') return 0;
        var n = parseInt(v, 10);
        return isNaN(n) ? 0 : n;
    }

    function effectiveEnd(interval) {
        if (!interval) return Infinity;
        var v = interval.leavePeriod;
        if (v === undefined || v === null || v === '') return Infinity;
        var n = parseInt(v, 10);
        return isNaN(n) ? Infinity : n;
    }

    function intervalsOverlap(a, b) {
        return effectiveStart(a) <= effectiveEnd(b) &&
               effectiveStart(b) <= effectiveEnd(a);
    }

    /**
     * Given a member VM and a proposed change to one interval's
     * leave period, does the resulting interval overlap any OTHER
     * interval on the same member?
     *
     * `proposed` is { joinPeriod, leavePeriod } with canonical
     * string values. `member` is the VM (has .intervals[]).
     * `targetJoinPeriod` identifies which interval is being changed.
     */
    function wouldOverlap(member, targetJoinPeriod, proposed) {
        if (!member || !Array.isArray(member.intervals)) {
            return null;
        }
        var targetJoin = String(targetJoinPeriod);
        for (var i = 0; i < member.intervals.length; i++) {
            var iv = member.intervals[i];
            if (!iv) continue;
            var ivJoin = (iv.joinPeriod === undefined || iv.joinPeriod === null)
                ? ''
                : String(iv.joinPeriod);
            if (ivJoin === targetJoin) continue;
            if (intervalsOverlap(proposed, iv)) {
                return iv;
            }
        }
        return null;
    }

    // ============================================================
    // RENDER — TOP LEVEL
    // ============================================================

    function renderManagerBody(vm, opts) {
        opts = opts || {};
        var notFound = opts.notFound === true;

        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Manage Members \u2014 ' +
                    escapeHtml(vm.teamName || 'Team') +
                '</h3>';
        html += '<button type="button" ' +
                    'class="close-modal" ' +
                    'data-action="awtm-close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        if (notFound) {
            html += '<p class="empty-state small">Team not found.</p>';
            html += '</div>';
            return html;
        }

        var members = Array.isArray(vm.members) ? vm.members : [];
        var formerMembers = Array.isArray(vm.formerMembers)
            ? vm.formerMembers
            : [];
        var candidates = Array.isArray(vm.candidates) ? vm.candidates : [];

        html += '<p class="field-hint">' +
                    'Edit each stint\'s Leave week. Join is fixed at ' +
                    'creation; to change it, remove the stint and add a ' +
                    'new one. Click Save to apply every change at once.' +
                '</p>';

        // ---- Current members ----
        html += '<div class="form-group">';
        html += '<label>Current Members (' + members.length + ')</label>';

        if (members.length === 0) {
            html += '<p class="empty-state small">' +
                        'No members assigned to this team this week.' +
                    '</p>';
        } else {
            html += '<div class="awtm-members-list">';
            for (var i = 0; i < members.length; i++) {
                html += renderMemberBlock(members[i], vm.week);
            }
            html += '</div>';
        }
        html += '</div>';

        // ---- Add member ----
        html += '<div class="form-group awtm-add-group">';
        html += '<label for="awtm-member-select">Add Member</label>';

        if (candidates.length === 0) {
            html += '<p class="field-hint">' +
                        'No eligible characters available to add.' +
                    '</p>';
        } else {
            html += '<div class="awtm-add-row">';
            html += '<select id="awtm-member-select" ' +
                        'class="awtm-member-select">';
            html += '<option value="">Select a character...</option>';
            for (var j = 0; j < candidates.length; j++) {
                var c = candidates[j];
                var label = c.name;
                if (isNonEmptyString(c.status)) {
                    label += ' (' + c.status + ')';
                }
                html += '<option value="' + escapeAttr(c.id) + '">' +
                            escapeHtml(label) +
                        '</option>';
            }
            html += '</select>';
            html += '<button type="button" ' +
                        'class="small primary" ' +
                        'data-action="awtm-add">Add</button>';
            html += '</div>';
            html += '<p class="field-hint">' +
                        'Adds the character starting from week ' +
                        escapeHtml(String(vm.week)) + '.' +
                    '</p>';
        }
        html += '</div>';

        // ---- Former members ----
        if (formerMembers.length > 0) {
            html += '<div class="form-group awtm-former-group">';
            html += '<label>Former Members (' +
                        formerMembers.length + ')</label>';
            html += '<div class="awtm-former-list">';
            for (var k = 0; k < formerMembers.length; k++) {
                html += renderFormerMemberBlock(formerMembers[k]);
            }
            html += '</div>';
            html += '</div>';
        }

        // ---- Footer ----
        html += '<div class="form-actions awtm-footer">';
        html += '<button type="button" class="secondary" ' +
                    'data-action="awtm-revert">Revert</button>';
        html += '<button type="button" class="primary" ' +
                    'data-action="awtm-save">Save</button>';
        html += '<button type="button" class="secondary" ' +
                    'data-action="awtm-close">Close</button>';
        html += '</div>';

        html += '</div>';

        return html;
    }

    /**
     * Render one member block: header + one row per interval +
     * inline add-stint form.
     */
    function renderMemberBlock(member, displayWeek) {
        if (!member || !member.characterId) { return ''; }

        var memberIdAttr = escapeAttr(member.memberId || '');
        var charIdAttr = escapeAttr(member.characterId);

        var intervals = Array.isArray(member.intervals)
            ? member.intervals
            : [];

        var headerClass = 'awtm-member-block-header';
        if (member.deceased === true) {
            headerClass += ' deceased';
        }

        var html = '';
        html += '<div class="awtm-member-block" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '">';

        // ---- Header ----
        html += '<div class="' + headerClass + '">';
        html += '<span class="awtm-member-name">' +
                    escapeHtml(member.name || 'Unknown') +
                '</span>';
        if (member.deceased === true) {
            html += '<span class="awtm-member-deceased" title="Deceased">\u2020</span>';
        }
        if (isNonEmptyString(member.role) && member.role !== 'Member') {
            html += '<span class="awtm-member-role">' +
                        escapeHtml(member.role) +
                    '</span>';
        }
        if (isNonEmptyString(member.statusLabel)) {
            html += '<span class="awtm-member-status">' +
                        escapeHtml(member.statusLabel) +
                    '</span>';
        }
        html += '<button type="button" ' +
                    'class="small danger awtm-remove-member-btn" ' +
                    'data-action="awtm-remove-member" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '">' +
                    'Remove member' +
                '</button>';
        html += '</div>';

        // ---- Interval rows ----
        if (intervals.length === 0) {
            html += '<div class="awtm-interval-empty">' +
                        'No stints recorded. Use Add stint to create one.' +
                    '</div>';
        } else {
            html += '<div class="awtm-interval-rows">';
            for (var i = 0; i < intervals.length; i++) {
                html += renderIntervalRow(
                    member, intervals[i], displayWeek
                );
            }
            html += '</div>';
        }

        // ---- Add stint (inline form host) ----
        html += '<div class="awtm-add-stint-host">';
        html += '<button type="button" ' +
                    'class="small secondary awtm-add-stint-btn" ' +
                    'data-action="awtm-add-stint" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '">' +
                    '+ Add stint' +
                '</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderIntervalRow(member, interval, displayWeek) {
        if (!interval || typeof interval !== 'object') { return ''; }

        var charIdAttr = escapeAttr(member.characterId);
        var memberIdAttr = escapeAttr(member.memberId || '');

        var joinStr = (interval.joinPeriod === undefined ||
                       interval.joinPeriod === null)
            ? ''
            : String(interval.joinPeriod);
        var leaveStr = (interval.leavePeriod === undefined ||
                        interval.leavePeriod === null)
            ? ''
            : String(interval.leavePeriod);

        var joinAttr = escapeAttr(joinStr);
        var initialLeaveAttr = escapeAttr(leaveStr);

        var rowClass = 'awtm-interval-row';
        if (interval.activeAtPeriod === true) {
            rowClass += ' is-active';
        }

        var html = '';
        html += '<div class="' + rowClass + '" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '" ' +
                    'data-join-period="' + joinAttr + '" ' +
                    'data-initial-leave="' + initialLeaveAttr + '">';

        // ---- Join (disabled) ----
        html += '<div class="awtm-interval-inputs">';
        html += '<label class="awtm-period-label">Join</label>';
        html += '<input type="number" ' +
                    'class="awtm-period-input awtm-join-input" ' +
                    'value="' + joinAttr + '" ' +
                    'disabled readonly ' +
                    'data-role="awtm-join-input" ' +
                    'title="Join week is fixed. To change it, remove this stint and add a new one.">';

        // ---- Leave (editable) ----
        html += '<label class="awtm-period-label">Leave</label>';
        html += '<input type="number" ' +
                    'class="awtm-period-input awtm-leave-input" ' +
                    'min="' + CalendarConstants.MIN_WEEK + '" ' +
                    'max="' + CalendarConstants.MAX_WEEK + '" ' +
                    'value="' + initialLeaveAttr + '" ' +
                    'placeholder="\u2014" ' +
                    'data-role="awtm-leave-input">';
        html += '</div>';

        // ---- Actions ----
        html += '<div class="awtm-interval-actions">';

        if (interval.activeAtPeriod === true) {
            html += '<button type="button" ' +
                        'class="small secondary awtm-leave-now-btn" ' +
                        'data-action="awtm-leave-now" ' +
                        'title="Set this stint\'s leave week to week ' +
                            escapeAttr(String(displayWeek)) + '">' +
                        'Leave' +
                    '</button>';
        }

        html += '<button type="button" ' +
                    'class="small danger awtm-remove-interval-btn" ' +
                    'data-action="awtm-remove-interval" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '" ' +
                    'data-join-period="' + joinAttr + '" ' +
                    'title="Remove this stint">' +
                    '\u2715' +
                '</button>';

        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderFormerMemberBlock(member) {
        if (!member || !member.characterId) { return ''; }

        var charIdAttr = escapeAttr(member.characterId);
        var memberIdAttr = escapeAttr(member.memberId || '');

        var intervals = Array.isArray(member.intervals)
            ? member.intervals
            : [];

        var html = '';
        html += '<div class="awtm-member-block awtm-member-block-former" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '">';

        html += '<div class="awtm-member-block-header">';
        html += '<span class="awtm-member-name">' +
                    escapeHtml(member.name || 'Unknown') +
                '</span>';
        html += '</div>';

        if (intervals.length === 0) {
            html += '<div class="awtm-interval-row awtm-interval-row-former">';
            html += '<span class="awtm-former-no-stints">No stints recorded.</span>';
            html += '</div>';
        } else {
            for (var i = 0; i < intervals.length; i++) {
                html += renderFormerIntervalRow(member, intervals[i]);
            }
        }

        html += '</div>';
        return html;
    }

    function renderFormerIntervalRow(member, interval) {
        if (!interval || typeof interval !== 'object') { return ''; }

        var charIdAttr = escapeAttr(member.characterId);
        var memberIdAttr = escapeAttr(member.memberId || '');

        var joinStr = (interval.joinPeriod === undefined ||
                       interval.joinPeriod === null)
            ? ''
            : String(interval.joinPeriod);
        var leaveStr = (interval.leavePeriod === undefined ||
                        interval.leavePeriod === null)
            ? ''
            : String(interval.leavePeriod);

        var display = interval.periodDisplay;
        if (!isNonEmptyString(display)) {
            display = (joinStr || '\u2014') + ' \u2013 ' +
                      (leaveStr || '\u2014');
        }

        var html = '';
        html += '<div class="awtm-interval-row awtm-interval-row-former" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '" ' +
                    'data-join-period="' + escapeAttr(joinStr) + '" ' +
                    'data-initial-leave="' + escapeAttr(leaveStr) + '">';

        html += '<span class="awtm-former-period">' +
                    escapeHtml(display) +
                '</span>';

        html += '<div class="awtm-interval-actions">';
        html += '<button type="button" ' +
                    'class="small secondary awtm-restore-btn" ' +
                    'data-action="awtm-restore" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '" ' +
                    'data-join-period="' + escapeAttr(joinStr) + '" ' +
                    'data-leave-period="' + escapeAttr(leaveStr) + '">' +
                    'Restore' +
                '</button>';
        html += '<button type="button" ' +
                    'class="small danger awtm-remove-interval-btn" ' +
                    'data-action="awtm-remove-interval" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '" ' +
                    'data-join-period="' + escapeAttr(joinStr) + '" ' +
                    'title="Remove this stint">' +
                    '\u2715' +
                '</button>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // PUBLIC ENTRY POINT
    // ============================================================

    function openMemberManager(container, classId, week, teamId, options) {
        if (!container || !isNonEmptyString(classId) || !isNonEmptyString(teamId)) {
            return null;
        }

        options = options || {};
        var onClose = (typeof options.onClose === 'function')
            ? options.onClose
            : null;
        var onChange = (typeof options.onChange === 'function')
            ? options.onChange
            : null;

        var weekNum = parseWeekStrict(week);
        if (weekNum === null) {
            container.innerHTML =
                '<div class="modal-body">' +
                    '<p class="empty-state small">' +
                        'Valid week is required.' +
                    '</p>' +
                '</div>';
            return null;
        }

        var disposed = false;
        var clickHandler = null;

        function invokeOnClose() {
            if (typeof onClose === 'function') {
                try { onClose(); } catch (e) {
                    console.warn('[AcademyWeeklyTeamsMembers] onClose threw:', e);
                }
            }
        }

        function invokeOnChange() {
            if (typeof onChange === 'function') {
                try { onChange(); } catch (e) {
                    console.warn('[AcademyWeeklyTeamsMembers] onChange threw:', e);
                }
            }
        }

        var currentVM = null;

        function render() {
            if (disposed || !container.parentNode) {
                return;
            }

            var vm;
            try {
                vm = AcademyAggregator.getWeeklyTeamMemberManagerViewModel({
                    classId: classId,
                    teamId: teamId,
                    week: weekNum
                });
            } catch (e) {
                console.error(
                    '[AcademyWeeklyTeamsMembers] Aggregator threw while ' +
                    'building the member-manager VM. Original error:',
                    e
                );
                throw e;
            }

            currentVM = vm;

            if (!vm) {
                container.innerHTML = renderManagerBody({
                    teamId: teamId,
                    teamName: 'Team',
                    week: weekNum,
                    members: [],
                    formerMembers: [],
                    candidates: []
                }, { notFound: true });
                bindEvents(container);
                return;
            }

            container.innerHTML = renderManagerBody(vm, { notFound: false });
            bindEvents(container);
        }

        function bindEvents(rootEl) {
            if (clickHandler) {
                rootEl.removeEventListener('click', clickHandler);
            }
            clickHandler = function(e) {
                var target = e.target.closest('[data-action]');
                if (!target) return;
                var action = target.dataset.action;
                switch (action) {
                    case 'awtm-close':
                        e.preventDefault();
                        close();
                        return;
                    case 'awtm-save':
                        e.preventDefault();
                        handleSaveAll();
                        return;
                    case 'awtm-revert':
                        e.preventDefault();
                        handleRevert();
                        return;
                    case 'awtm-add':
                        e.preventDefault();
                        handleAdd();
                        return;
                    case 'awtm-remove-member':
                        e.preventDefault();
                        handleRemoveMember(target);
                        return;
                    case 'awtm-remove-interval':
                        e.preventDefault();
                        handleRemoveInterval(target);
                        return;
                    case 'awtm-leave-now':
                        e.preventDefault();
                        handleLeaveNow(target);
                        return;
                    case 'awtm-add-stint':
                        e.preventDefault();
                        handleAddStint(target);
                        return;
                    case 'awtm-restore':
                        e.preventDefault();
                        handleOpenRestore(target);
                        return;
                    case 'awtm-inline-add':
                        e.preventDefault();
                        handleInlineStintAdd(target);
                        return;
                    case 'awtm-inline-cancel':
                        e.preventDefault();
                        handleInlineStintCancel(target);
                        return;
                    default:
                        return;
                }
            };
            rootEl.addEventListener('click', clickHandler);
        }

        // ------------------------------------------------------------------
        // Save all
        // ------------------------------------------------------------------

        function handleSaveAll() {
            if (!currentVM) { return; }

            var rows = container.querySelectorAll('.awtm-interval-row');
            var changes = [];
            var invalidMessage = null;
            var overlapMessage = null;

            for (var i = 0; i < rows.length; i++) {
                var row = rows[i];

                // Skip former rows — they aren't editable through Save.
                if (row.classList.contains('awtm-interval-row-former')) {
                    continue;
                }

                var leaveInput = row.querySelector('.awtm-leave-input');
                if (!leaveInput) { continue; }

                var leaveRaw = leaveInput.value;
                var initialLeave = row.dataset.initialLeave || '';
                var joinPeriod = row.dataset.joinPeriod || '';
                var charId = row.dataset.characterId || '';

                var leaveParse = parseOptionalWeekInput(leaveRaw);
                if (!leaveParse.ok) {
                    invalidMessage =
                        'Leave week must be blank or an integer between ' +
                        CalendarConstants.MIN_WEEK + ' and ' +
                        CalendarConstants.MAX_WEEK + '.';
                    break;
                }

                var leaveCanonical = leaveParse.value;
                if (leaveCanonical === initialLeave) {
                    continue;
                }

                // Validate join <= leave when both present.
                if (joinPeriod !== '' && leaveCanonical !== '') {
                    var jn = parseInt(joinPeriod, 10);
                    var lv = parseInt(leaveCanonical, 10);
                    if (!isNaN(jn) && !isNaN(lv) && lv < jn) {
                        invalidMessage =
                            'Leave cannot be before Join (week ' + lv +
                            ' < ' + jn + ').';
                        break;
                    }
                }

                // Overlap pre-check against the member's other intervals.
                var member = findMemberVM(charId);
                if (member) {
                    var proposed = {
                        joinPeriod: joinPeriod,
                        leavePeriod: leaveCanonical
                    };
                    var conflict = wouldOverlap(member, joinPeriod, proposed);
                    if (conflict) {
                        overlapMessage =
                            'Leave week ' + leaveCanonical + ' for ' +
                            (member.name || 'this member') +
                            ' overlaps an existing stint (join ' +
                            (conflict.joinPeriod || '\u2014') + ').';
                        break;
                    }
                }

                changes.push({
                    identifier: {
                        characterId: charId,
                        joinPeriod: joinPeriod
                    },
                    leavePeriod: leaveCanonical
                });
            }

            if (invalidMessage) {
                notify(invalidMessage, 'error');
                return;
            }
            if (overlapMessage) {
                notify(overlapMessage, 'error');
                return;
            }

            if (changes.length === 0) {
                notify('No changes to save.', 'info');
                return;
            }

            AcademyWeeklyTeams.updateMemberWindows(
                classId, teamId, changes
            )
            .then(function(result) {
                if (result && result.success) {
                    render();
                    invokeOnChange();
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyWeeklyTeamsMembers] updateMemberWindows failed:',
                    err
                );
            });
        }

        function findMemberVM(charId) {
            if (!currentVM || !Array.isArray(currentVM.members)) {
                return null;
            }
            var target = String(charId);
            for (var i = 0; i < currentVM.members.length; i++) {
                var m = currentVM.members[i];
                if (m && String(m.characterId) === target) {
                    return m;
                }
            }
            return null;
        }

        function handleRevert() {
            // Re-render from the VM. Discards every uncommitted edit.
            render();
        }

        // ------------------------------------------------------------------
        // Add member
        // ------------------------------------------------------------------

        function handleAdd() {
            var select = container.querySelector('.awtm-member-select');
            var charId = select ? select.value : '';
            if (!charId) {
                notify('Select a character to add.', 'error');
                return;
            }

            // Add via the flat-input path. AcademyWeeklyTeams.addMember
            // is now the "append interval" primitive; it takes a week.
            AcademyWeeklyTeams.addMember(
                classId, teamId, charId, weekNum
            )
            .then(function(result) {
                if (result && result.success) {
                    render();
                    invokeOnChange();
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyWeeklyTeamsMembers] addMember failed:', err
                );
            });
        }

        // ------------------------------------------------------------------
        // Remove member (whole entry)
        // ------------------------------------------------------------------

        function handleRemoveMember(btn) {
            var charId = btn.dataset.characterId;
            if (!charId) { return; }

            var member = findMemberVM(charId);
            var name = member && member.name ? member.name : 'this member';

            if (!confirm(
                'Remove ' + name + ' entirely (all stints)?\n\n' +
                'This deletes the member\'s history on this team.'
            )) {
                return;
            }

            AcademyWeeklyTeams.removeMemberEntry(classId, teamId, charId)
                .then(function(result) {
                    if (result && result.success) {
                        render();
                        invokeOnChange();
                    }
                })
                .catch(function(err) {
                    console.warn(
                        '[AcademyWeeklyTeamsMembers] removeMemberEntry failed:',
                        err
                    );
                });
        }

        // ------------------------------------------------------------------
        // Remove interval (one stint)
        // ------------------------------------------------------------------

        function handleRemoveInterval(btn) {
            var charId = btn.dataset.characterId;
            var joinPeriod = btn.dataset.joinPeriod;
            if (!charId) { return; }

            if (joinPeriod === undefined || joinPeriod === null) {
                joinPeriod = '';
            }

            var member = findMemberVM(charId);
            var name = member && member.name ? member.name : 'this member';

            if (!confirm(
                'Remove this stint from ' + name + '?\n\n' +
                'If it is the last stint, the member is removed from the team.'
            )) {
                return;
            }

            AcademyWeeklyTeams.purgeMemberRecords(
                classId,
                teamId,
                { characterId: charId, joinPeriod: joinPeriod }
            )
            .then(function(result) {
                if (result && result.success) {
                    render();
                    invokeOnChange();
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyWeeklyTeamsMembers] purgeMemberRecords failed:',
                    err
                );
            });
        }

        // ------------------------------------------------------------------
        // Leave now (set leave at the display week)
        // ------------------------------------------------------------------

        function handleLeaveNow(btn) {
            var row = btn.closest('.awtm-interval-row');
            if (!row) { return; }

            var charId = row.dataset.characterId;
            var joinPeriod = row.dataset.joinPeriod || '';

            if (!charId) { return; }

            AcademyWeeklyTeams.setLeaveAtWeek(
                classId,
                teamId,
                { characterId: charId, joinPeriod: joinPeriod },
                weekNum
            )
            .then(function(result) {
                if (result && result.success) {
                    render();
                    invokeOnChange();
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyWeeklyTeamsMembers] setLeaveAtWeek failed:', err
                );
            });
        }

        // ------------------------------------------------------------------
        // Add stint (inline form)
        // ------------------------------------------------------------------

        function handleAddStint(btn) {
            var block = btn.closest('.awtm-member-block');
            if (!block) { return; }

            var host = block.querySelector('.awtm-add-stint-host');
            if (!host) { return; }

            var charId = block.dataset.characterId;
            var memberId = block.dataset.memberId || '';

            // If the form is already open, focus it instead of
            // rendering a second one.
            var existing = host.querySelector('.awtm-inline-form');
            if (existing) {
                var existingJoin = existing.querySelector('.awtm-inline-join');
                if (existingJoin) { existingJoin.focus(); }
                return;
            }

            var member = findMemberVM(charId);
            var suggestion = suggestNextJoinWeek(member);

            var html = '';
            html += '<div class="awtm-inline-form" ' +
                        'data-character-id="' + escapeAttr(charId) + '" ' +
                        'data-member-id="' + escapeAttr(memberId) + '">';
            html += '<label class="awtm-period-label">Join</label>';
            html += '<input type="number" ' +
                        'class="awtm-period-input awtm-inline-join" ' +
                        'min="' + CalendarConstants.MIN_WEEK + '" ' +
                        'max="' + CalendarConstants.MAX_WEEK + '" ' +
                        'value="' + escapeAttr(String(suggestion)) + '" ' +
                        'placeholder="Required">';
            html += '<label class="awtm-period-label">Leave</label>';
            html += '<input type="number" ' +
                        'class="awtm-period-input awtm-inline-leave" ' +
                        'min="' + CalendarConstants.MIN_WEEK + '" ' +
                        'max="' + CalendarConstants.MAX_WEEK + '" ' +
                        'placeholder="\u2014">';
            html += '<button type="button" ' +
                        'class="small primary awtm-inline-add" ' +
                        'data-action="awtm-inline-add">Add</button>';
            html += '<button type="button" ' +
                        'class="small secondary awtm-inline-cancel" ' +
                        'data-action="awtm-inline-cancel">Cancel</button>';
            html += '</div>';

            // Hide the "+ Add stint" button, insert the form.
            btn.style.display = 'none';
            host.insertAdjacentHTML('beforeend', html);

            var joinInput = host.querySelector('.awtm-inline-join');
            if (joinInput) { joinInput.focus(); }
        }

        /**
         * Suggest a sensible default join week for a new stint.
         * If the member's last interval ended, start right after it.
         * Otherwise, start at the display week.
         */
        function suggestNextJoinWeek(member) {
            if (!member || !Array.isArray(member.intervals) ||
                member.intervals.length === 0) {
                return weekNum;
            }

            var latestLeave = 0;
            for (var i = 0; i < member.intervals.length; i++) {
                var iv = member.intervals[i];
                if (!iv) continue;
                var lv = parseInt(iv.leavePeriod, 10);
                if (!isNaN(lv) && lv > latestLeave) {
                    latestLeave = lv;
                }
            }

            if (latestLeave > 0) {
                var candidate = latestLeave + 1;
                if (candidate >= CalendarConstants.MIN_WEEK &&
                    candidate <= CalendarConstants.MAX_WEEK) {
                    return candidate;
                }
            }

            return weekNum;
        }

        function handleInlineStintCancel(btn) {
            var form = btn.closest('.awtm-inline-form');
            if (!form) { return; }

            var host = form.parentNode;
            var block = form.closest('.awtm-member-block');
            if (!block) { return; }

            form.remove();
            var addBtn = block.querySelector('.awtm-add-stint-btn');
            if (addBtn) {
                addBtn.style.display = '';
            }
        }

        function handleInlineStintAdd(btn) {
            var form = btn.closest('.awtm-inline-form');
            if (!form) { return; }

            var block = form.closest('.awtm-member-block');
            if (!block) { return; }

            var charId = block.dataset.characterId;

            var joinInput = form.querySelector('.awtm-inline-join');
            var leaveInput = form.querySelector('.awtm-inline-leave');

            var joinParsed = parseWeekStrict(joinInput ? joinInput.value : '');
            if (joinParsed === null) {
                notify(
                    'Join week must be an integer between ' +
                    CalendarConstants.MIN_WEEK + ' and ' +
                    CalendarConstants.MAX_WEEK + '.',
                    'error'
                );
                return;
            }

            var leaveParsed = parseOptionalWeekInput(
                leaveInput ? leaveInput.value : ''
            );
            if (!leaveParsed.ok) {
                notify(
                    'Leave week must be blank or an integer between ' +
                    CalendarConstants.MIN_WEEK + ' and ' +
                    CalendarConstants.MAX_WEEK + '.',
                    'error'
                );
                return;
            }

            if (leaveParsed.value !== '' &&
                parseInt(leaveParsed.value, 10) < joinParsed) {
                notify('Leave cannot be before join.', 'error');
                return;
            }

            // Overlap pre-check.
            var member = findMemberVM(charId);
            var proposed = {
                joinPeriod: String(joinParsed),
                leavePeriod: leaveParsed.value
            };
            if (member) {
                var conflict = wouldOverlap(member, '', proposed);
                // The 'proposed' is a NEW interval, so it overlaps if
                // it touches ANY existing interval.
                if (conflict) {
                    notify(
                        'This stint would overlap an existing one ' +
                        '(join ' + (conflict.joinPeriod || '\u2014') +
                        ', leave ' + (conflict.leavePeriod || '\u2014') + ').',
                        'error'
                    );
                    return;
                }
            }

            AcademyWeeklyTeams.addMemberInterval(
                classId, teamId, charId,
                String(joinParsed),
                leaveParsed.value
            )
            .then(function(result) {
                if (result && result.success) {
                    render();
                    invokeOnChange();
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyWeeklyTeamsMembers] addMemberInterval failed:',
                    err
                );
            });
        }

        // ------------------------------------------------------------------
        // Restore
        // ------------------------------------------------------------------

        function handleOpenRestore(btn) {
            var charId = btn.dataset.characterId;
            var memberId = btn.dataset.memberId;
            var joinPeriod = btn.dataset.joinPeriod;
            var leavePeriod = btn.dataset.leavePeriod;

            if (!charId) { return; }

            openRestoreModal({
                characterId: charId,
                memberId: memberId || '',
                joinPeriod: joinPeriod || '',
                leavePeriod: leavePeriod || ''
            });
        }

        function openRestoreModal(info) {
            var modal = Modal.createModal('awtm-restore-modal');
            if (!modal) {
                notify('Could not open restore dialog.', 'error');
                return;
            }

            var contentEl = document.createElement('div');
            contentEl.className = 'modal-content';
            contentEl.innerHTML = buildRestoreFormHTML(info);
            modal.appendChild(contentEl);

            Modal.modalSetup(modal);
            Modal.showModal(modal);

            var close = function() {
                try {
                    if (typeof Modal.closeModal === 'function') {
                        Modal.closeModal(modal);
                    } else if (typeof Modal.hideModal === 'function') {
                        Modal.hideModal(modal);
                    }
                } catch (e) {
                    console.warn(
                        '[AcademyWeeklyTeamsMembers] restore modal close failed:',
                        e
                    );
                }
                if (modal.parentNode) {
                    modal.parentNode.removeChild(modal);
                }
            };

            var closeBtn = modal.querySelector('.close-modal');
            if (closeBtn) { closeBtn.addEventListener('click', close); }

            var cancelBtn = modal.querySelector('.cancel-modal-btn');
            if (cancelBtn) { cancelBtn.addEventListener('click', close); }

            modal.addEventListener('click', function(ev) {
                if (ev.target === modal) { close(); }
            });

            var form = modal.querySelector('#awtm-restore-form');
            if (!form) { return; }

            form.addEventListener('submit', function(ev) {
                ev.preventDefault();

                var modeInput = form.querySelector(
                    'input[name="awtm-restore-mode"]:checked'
                );
                var modeValue = modeInput ? modeInput.value : '';

                if (modeValue === 'correct') {
                    handleRestoreCorrect(form, info, close);
                    return;
                }
                if (modeValue === 'new') {
                    handleRestoreNew(form, info, close);
                    return;
                }
            });
        }

        function handleRestoreCorrect(form, info, close) {
            var leaveInput = form.querySelector('.awtm-restore-leave-input');
            var leaveRaw = leaveInput ? leaveInput.value : '';

            var parsed = parseOptionalWeekInput(leaveRaw);
            if (!parsed.ok) {
                notify(
                    'Leave week must be blank or an integer between ' +
                    CalendarConstants.MIN_WEEK + ' and ' +
                    CalendarConstants.MAX_WEEK + '.',
                    'error'
                );
                return;
            }

            // Overlap pre-check: reopening in place could overlap a
            // later interval.
            var member = findMemberVM(info.characterId);
            if (member) {
                var proposed = {
                    joinPeriod: info.joinPeriod,
                    leavePeriod: parsed.value
                };
                var conflict = wouldOverlap(member, info.joinPeriod, proposed);
                if (conflict) {
                    notify(
                        'This change would overlap another stint of the ' +
                        'same member.',
                        'error'
                    );
                    return;
                }
            }

            AcademyWeeklyTeams.updateMemberWindows(
                classId,
                teamId,
                [{
                    identifier: {
                        characterId: info.characterId,
                        joinPeriod: info.joinPeriod
                    },
                    leavePeriod: parsed.value
                }]
            )
            .then(function(result) {
                if (result && result.success) {
                    close();
                    render();
                    invokeOnChange();
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyWeeklyTeamsMembers] restore (correct) failed:',
                    err
                );
            });
        }

        function handleRestoreNew(form, info, close) {
            var joinInput = form.querySelector('.awtm-restore-join-input');
            var newLeaveInput = form.querySelector('.awtm-restore-newleave-input');

            var joinRaw = joinInput ? joinInput.value : '';
            var newLeaveRaw = newLeaveInput ? newLeaveInput.value : '';

            var joinParsed = parseWeekStrict(joinRaw);
            if (joinParsed === null) {
                notify(
                    'New join week must be an integer between ' +
                    CalendarConstants.MIN_WEEK + ' and ' +
                    CalendarConstants.MAX_WEEK + '.',
                    'error'
                );
                return;
            }

            var newLeaveParsed = parseOptionalWeekInput(newLeaveRaw);
            if (!newLeaveParsed.ok) {
                notify(
                    'New leave week must be blank or an integer between ' +
                    CalendarConstants.MIN_WEEK + ' and ' +
                    CalendarConstants.MAX_WEEK + '.',
                    'error'
                );
                return;
            }

            if (newLeaveParsed.value !== '' &&
                parseInt(newLeaveParsed.value, 10) < joinParsed) {
                notify('Leave cannot be before join.', 'error');
                return;
            }

            // Overlap pre-check.
            var member = findMemberVM(info.characterId);
            if (member) {
                var proposed = {
                    joinPeriod: String(joinParsed),
                    leavePeriod: newLeaveParsed.value
                };
                var conflict = wouldOverlap(member, '', proposed);
                if (conflict) {
                    notify(
                        'This stint would overlap an existing one.',
                        'error'
                    );
                    return;
                }
            }

            AcademyWeeklyTeams.addMemberInterval(
                classId,
                teamId,
                info.characterId,
                String(joinParsed),
                newLeaveParsed.value
            )
            .then(function(result) {
                if (result && result.success) {
                    close();
                    render();
                    invokeOnChange();
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyWeeklyTeamsMembers] restore (new) failed:',
                    err
                );
            });
        }

        function buildRestoreFormHTML(info) {
            var currentLeave = isNonEmptyString(info.leavePeriod)
                ? info.leavePeriod
                : '';

            var html = '';
            html += '<form id="awtm-restore-form">';

            html += '<div class="modal-header">';
            html += '<h3>Restore Member</h3>';
            html += '<button type="button" class="close-modal">' +
                        '&times;' +
                    '</button>';
            html += '</div>';

            html += '<div class="modal-body">';

            html += '<p class="field-hint">' +
                        'Choose how to bring this member back.' +
                    '</p>';

            // ---- Option 1: correct the leave week ----
            html += '<label class="awtm-restore-option">';
            html += '<input type="radio" name="awtm-restore-mode" ' +
                        'value="correct" checked>';
            html += '<span class="awtm-restore-option-body">';
            html += '<strong>Correct the leave week</strong>';
            html += '<span class="awtm-restore-option-hint">' +
                        'Edits this stint\'s existing window in place. ' +
                        'Use this when the leave week was recorded wrong.' +
                    '</span>';
            html += '<span class="awtm-restore-input-row">';
            html += '<label>Leave</label>';
            html += '<input type="number" ' +
                        'class="awtm-period-input awtm-restore-leave-input" ' +
                        'min="' + CalendarConstants.MIN_WEEK + '" ' +
                        'max="' + CalendarConstants.MAX_WEEK + '" ' +
                        'value="' + escapeAttr(currentLeave) + '" ' +
                        'placeholder="\u2014">';
            html += '</span>';
            html += '</span>';
            html += '</label>';

            // ---- Option 2: reopen with a new interval ----
            html += '<label class="awtm-restore-option">';
            html += '<input type="radio" name="awtm-restore-mode" ' +
                        'value="new">';
            html += '<span class="awtm-restore-option-body">';
            html += '<strong>Reopen with a new interval</strong>';
            html += '<span class="awtm-restore-option-hint">' +
                        'Preserves the former window and starts a fresh ' +
                        'one. Use this when they took a break and came ' +
                        'back.' +
                    '</span>';
            html += '<span class="awtm-restore-input-row">';
            html += '<label>Join</label>';
            html += '<input type="number" ' +
                        'class="awtm-period-input awtm-restore-join-input" ' +
                        'min="' + CalendarConstants.MIN_WEEK + '" ' +
                        'max="' + CalendarConstants.MAX_WEEK + '" ' +
                        'value="' + escapeAttr(String(weekNum)) + '">';
            html += '<label>Leave</label>';
            html += '<input type="number" ' +
                        'class="awtm-period-input awtm-restore-newleave-input" ' +
                        'min="' + CalendarConstants.MIN_WEEK + '" ' +
                        'max="' + CalendarConstants.MAX_WEEK + '" ' +
                        'placeholder="\u2014">';
            html += '</span>';
            html += '</span>';
            html += '</label>';

            html += '<div class="form-actions">';
            html += '<button type="button" ' +
                        'class="cancel-modal-btn secondary">Cancel</button>';
            html += '<button type="submit" class="primary">Restore</button>';
            html += '</div>';

            html += '</div>';
            html += '</form>';

            return html;
        }

        function close() {
            if (disposed) return;
            disposed = true;
            if (clickHandler && container.parentNode) {
                try {
                    container.removeEventListener('click', clickHandler);
                } catch (e) {}
            }
            clickHandler = null;
            invokeOnClose();
        }

        function isMounted() {
            return !disposed && !!container.parentNode;
        }

        render();

        return {
            refresh: render,
            close: close,
            isMounted: isMounted
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyWeeklyTeamsMembers = {
        openMemberManager: openMemberManager
    };

})();
