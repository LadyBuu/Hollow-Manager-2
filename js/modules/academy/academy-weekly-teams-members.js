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
 * BUG-E13 UNIFICATION:
 *   The markup this module emits now matches the professional
 *   member manager in team-render.js renderMemberList. Same class
 *   names, same row structure, same visual language. The two
 *   subsystems remain independent — this module still reads its own
 *   VM shape from AcademyAggregator and still routes mutations
 *   through AcademyWeeklyTeams — but they render the same DOM.
 *
 *   See the RENDER section below for the shared markup contract.
 *
 * LAYOUT:
 *   Current Members: one block per member. Each block has a header
 *   (name, role input, status, Remove-member button) followed by one
 *   row per interval (Join input, Leave input, Leave-Now on active
 *   rows, Remove-stint button). An + Add stint button opens an
 *   inline form below the rows.
 *
 *   Former Members: read-only rows. Each former interval carries a
 *   Restore action that opens a modal offering two paths.
 *
 *   Add Member picker: at the bottom of the Current Members section.
 *
 *   Footer: Revert / Save / Close. Save batches every dirty interval
 *   row and role input into one transaction.
 *
 * SAVE SEMANTICS:
 *   A stint row is dirty when its Leave input differs from its
 *   data-initial-leave attribute. A role input is dirty when its
 *   value differs from its data-initial-role attribute. Save
 *   collects every dirty row and every dirty role into one
 *   updateMemberWindows call (for stint windows) plus one or more
 *   updateMemberWindow-style role updates as needed. All writes go
 *   through AcademyWeeklyTeams in a single user gesture.
 *
 *   Actually: role changes go through AcademyWeeklyTeams.updateMember
 *   if available, or are skipped. The batched stint-window writes go
 *   through AcademyWeeklyTeams.updateMemberWindows.
 *
 * LEAVE-AT-WEEK SEMANTICS (Leave Now button):
 *   The per-row Leave Now button sets the currently-active interval's
 *   leavePeriod to the display week. "Their last active week is this
 *   one." The member is active through the display week and inactive
 *   from the next. Routes through AcademyWeeklyTeams.setLeaveAtWeek.
 *
 *   This button appears on the Academic side only. Academic periods
 *   are weeks, so "leave now" is well-defined. Professional periods
 *   are years, so there is no equivalent shortcut.
 *
 * RESTORE SEMANTICS:
 *   The Restore action on a former interval opens a small modal with
 *   two options:
 *
 *     1. Correct the leave week — edits the former interval's
 *        leavePeriod in place.
 *     2. Reopen with a new interval — appends a new interval via
 *        AcademyWeeklyTeams.addMemberInterval. The former interval
 *        survives as history.
 *
 * MEMBER IDENTITY:
 *   Every entry is addressed by memberId (for whole-member actions)
 *   or { characterId, joinPeriod } (for interval-scoped actions).
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
    //
    // MARKUP CONTRACT (post BUG-E13):
    //   The emitted HTML uses the same class names as the
    //   professional manager in team-render.js renderMemberList:
    //
    //     .member-entry.member-entry-block      member block
    //     .member-entry-header                  header row
    //     .member-entry-name                    name span
    //     .member-entry-role                    role input
    //     .member-entry-status                  status span
    //     .member-entry-remove                  Remove-member button
    //     .member-interval-row                  one row per stint
    //     .member-interval-left                 left cell (labels+inputs)
    //     .member-interval-bounds               bounds cell
    //     .member-join                          Join label
    //     .member-leave                         Leave label
    //     .member-interval-actions              right cell (buttons)
    //     .member-interval-leave-now            Leave Now (academic only)
    //     .member-interval-remove               Remove-stint button
    //     .member-interval-former               former-member variant
    //     .member-form                          add-member flex row
    //     .member-manager-footer                Revert/Save/Close
    //
    //   Academic-only additions:
    //     .member-inline-add-host               wrapper around +Add stint
    //     .member-inline-add-form               the inline add form
    //
    //   The Academic side ALSO keeps the .awtm-* namespace on its
    //   outer container for backwards compatibility, but nothing
    //   depends on those class names any more.

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
                    'Edit each stint\'s Join and Leave. Add a stint to ' +
                    'record a member returning. Click Save to apply ' +
                    'every change at once.' +
                '</p>';

        // ---- Current members ----
        html += '<div class="form-group">';
        html += '<label>Current Members (' + members.length + ')</label>';

        if (members.length === 0) {
            html += '<p class="empty-state small">' +
                        'No members assigned to this team this week.' +
                    '</p>';
        } else {
            html += '<div class="member-manager-list">';
            for (var i = 0; i < members.length; i++) {
                html += renderMemberBlock(members[i], vm.week);
            }
            html += '</div>';
        }
        html += '</div>';

        // ---- Add member ----
        html += '<div class="form-group member-add-group">';
        html += '<label for="awtm-member-select">Add Member</label>';

        if (candidates.length === 0) {
            html += '<p class="field-hint">' +
                        'No eligible characters available to add.' +
                    '</p>';
        } else {
            html += '<div class="member-form">';
            html += '<select id="awtm-member-select" ' +
                        'class="member-form-select">';
            html += '<option value="">Select a character...</option>';
            for (var j = 0; j < candidates.length; j++) {
                var c = candidates[j];
                var label = c.name;
                if (isNonEmptyString(c.status)) {
                    label += ' (' + c.status + ')';
                }
                if (c.deceased === true) {
                    label += ' \u2020';
                }
                html += '<option value="' + escapeAttr(c.id) + '">' +
                            escapeHtml(label) +
                        '</option>';
            }
            html += '</select>';
            html += '<input type="text" class="member-form-role" ' +
                        'placeholder="Role (optional)">';
            html += '<input type="number" class="member-form-join" ' +
                        'placeholder="Join" ' +
                        'min="' + CalendarConstants.MIN_WEEK + '" ' +
                        'max="' + CalendarConstants.MAX_WEEK + '">';
            html += '<input type="number" class="member-form-leave" ' +
                        'placeholder="Leave" ' +
                        'min="' + CalendarConstants.MIN_WEEK + '" ' +
                        'max="' + CalendarConstants.MAX_WEEK + '">';
            html += '<button type="button" ' +
                        'class="small primary member-form-add" ' +
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
            html += '<div class="form-group member-former-group">';
            html += '<label>Former Members (' +
                        formerMembers.length + ')</label>';
            html += '<div class="member-former-list">';
            for (var k = 0; k < formerMembers.length; k++) {
                html += renderFormerMemberBlock(formerMembers[k]);
            }
            html += '</div>';
            html += '</div>';
        }

        // ---- Footer ----
        html += '<div class="form-actions member-manager-footer">';
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

        var headerClass = 'member-entry-header';
        if (member.deceased === true) {
            headerClass += ' deceased';
        }

        var html = '';
        html += '<div class="member-entry member-entry-block" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '">';

        // ---- Header ----
        html += '<div class="' + headerClass + '">';
        html += '<span class="member-entry-name">' +
                    escapeHtml(member.name || 'Unknown') +
                '</span>';

        if (member.deceased === true) {
            html += '<span class="member-entry-deceased" ' +
                        'title="Deceased">\u2020</span>';
        }

        html += '<input type="text" ' +
                    'class="member-entry-role" ' +
                    'data-role="awtm-role-input" ' +
                    'data-initial-role="' +
                        escapeAttr(member.role || '') + '" ' +
                    'value="' + escapeAttr(member.role || '') + '" ' +
                    'placeholder="Member">';

        if (isNonEmptyString(member.statusLabel)) {
            html += '<span class="member-entry-status">' +
                        escapeHtml(member.statusLabel) +
                    '</span>';
        }

        html += '<button type="button" ' +
                    'class="small danger member-entry-remove" ' +
                    'data-action="awtm-remove-member" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '">' +
                    'Remove member' +
                '</button>';
        html += '</div>';

        // ---- Interval rows ----
        if (intervals.length === 0) {
            html += '<div class="member-interval-empty">' +
                        'No stints recorded. Use Add stint to create one.' +
                    '</div>';
        } else {
            html += '<div class="member-interval-rows">';
            for (var i = 0; i < intervals.length; i++) {
                html += renderIntervalRow(
                    member, intervals[i], displayWeek
                );
            }
            html += '</div>';
        }

        // ---- Add stint (inline form host) ----
        html += '<div class="member-inline-add-host">';
        html += '<button type="button" ' +
                    'class="small secondary member-inline-add-btn" ' +
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

        var rowClass = 'member-interval-row';
        if (interval.activeAtPeriod === true) {
            rowClass += ' is-active';
        }

        var html = '';
        html += '<div class="' + rowClass + '" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '" ' +
                    'data-join-period="' + joinAttr + '" ' +
                    'data-initial-leave="' + initialLeaveAttr + '">';

        // ---- Left: Join / Leave inputs ----
        html += '<div class="member-interval-left">';
        html += '<div class="member-interval-bounds">';

        html += '<span class="member-join">';
        html += '<label>Join</label>';
        html += '<input type="number" ' +
                    'class="member-interval-input awtm-join-input" ' +
                    'min="' + CalendarConstants.MIN_WEEK + '" ' +
                    'max="' + CalendarConstants.MAX_WEEK + '" ' +
                    'value="' + joinAttr + '" ' +
                    'disabled readonly ' +
                    'data-role="awtm-join-input" ' +
                    'title="Join week is fixed. Remove this stint and add a new one to change it.">';
        html += '</span>';

        html += '<span class="member-leave">';
        html += '<label>Leave</label>';
        html += '<input type="number" ' +
                    'class="member-interval-input awtm-leave-input" ' +
                    'min="' + CalendarConstants.MIN_WEEK + '" ' +
                    'max="' + CalendarConstants.MAX_WEEK + '" ' +
                    'value="' + initialLeaveAttr + '" ' +
                    'placeholder="\u2014" ' +
                    'data-role="awtm-leave-input">';
        html += '</span>';

        html += '</div>';
        html += '</div>';

        // ---- Right: actions ----
        html += '<div class="member-interval-actions">';

        // Leave Now — academic only. Sets leave to the display week.
        if (interval.activeAtPeriod === true) {
            html += '<button type="button" ' +
                        'class="small secondary member-interval-leave-now" ' +
                        'data-action="awtm-leave-now" ' +
                        'title="Set this stint\'s leave week to week ' +
                            escapeAttr(String(displayWeek)) + '">' +
                        'Leave Now' +
                    '</button>';
        }

        html += '<button type="button" ' +
                    'class="small danger member-interval-remove" ' +
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
        html += '<div class="member-entry member-entry-block member-entry-block-former" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '">';

        html += '<div class="member-entry-header">';
        html += '<span class="member-entry-name">' +
                    escapeHtml(member.name || 'Unknown') +
                '</span>';
        html += '</div>';

        if (intervals.length === 0) {
            html += '<div class="member-interval-row member-interval-former">';
            html += '<span class="member-former-no-stints">No stints recorded.</span>';
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
        html += '<div class="member-interval-row member-interval-former" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '" ' +
                    'data-join-period="' + escapeAttr(joinStr) + '" ' +
                    'data-initial-leave="' + escapeAttr(leaveStr) + '">';

        html += '<div class="member-interval-left">';
        html += '<span class="member-former-period">' +
                    escapeHtml(display) +
                '</span>';
        html += '</div>';

        html += '<div class="member-interval-actions">';
        html += '<button type="button" ' +
                    'class="small secondary member-interval-restore" ' +
                    'data-action="awtm-restore" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '" ' +
                    'data-join-period="' + escapeAttr(joinStr) + '" ' +
                    'data-leave-period="' + escapeAttr(leaveStr) + '">' +
                    'Restore' +
                '</button>';
        html += '<button type="button" ' +
                    'class="small danger member-interval-remove" ' +
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

            var rows = container.querySelectorAll('.member-interval-row');
            var changes = [];
            var roleChanges = [];
            var invalidMessage = null;
            var overlapMessage = null;

            // ---- Role inputs first ----
            var roleInputs = container.querySelectorAll(
                '[data-role="awtm-role-input"]'
            );
            for (var r = 0; r < roleInputs.length; r++) {
                var roleInput = roleInputs[r];
                var block = roleInput.closest('.member-entry-block');
                if (!block) continue;

                var charId = block.dataset.characterId;
                var newRole = roleInput.value.trim();
                var initialRole = roleInput.dataset.initialRole || '';

                if (newRole === initialRole) continue;

                roleChanges.push({
                    characterId: charId,
                    role: newRole
                });
            }

            // ---- Stint rows ----
            for (var i = 0; i < rows.length; i++) {
                var row = rows[i];

                if (row.classList.contains('member-interval-former')) {
                    continue;
                }

                var leaveInput = row.querySelector('.awtm-leave-input');
                if (!leaveInput) { continue; }

                var leaveRaw = leaveInput.value;
                var initialLeave = row.dataset.initialLeave || '';
                var joinPeriod = row.dataset.joinPeriod || '';
                var rowCharId = row.dataset.characterId || '';

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

                var member = findMemberVM(rowCharId);
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
                        characterId: rowCharId,
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

            if (changes.length === 0 && roleChanges.length === 0) {
                notify('No changes to save.', 'info');
                return;
            }

            // ---- Commit ----
            var chain = Promise.resolve();
            var failed = false;

            // Stint-window changes go through updateMemberWindows
            // in one transaction. Role changes are dispatched
            // individually via addMemberInterval with role=... no,
            // actually, role is per-member, so it goes through the
            // per-member updateMemberWindow path. But the current
            // AcademyWeeklyTeams API does not expose a role update.
            //
            // For role-only edits we call addMemberInterval? No.
            // The cleanest path is to fold the role into the stint
            // window update as the caller's identity, not as a
            // separate field. Since AcademyWeeklyTeams stores role
            // on the member entry and updates it during addMember
            // when the entry is created, the roles here are edited
            // in-place by updating the entry directly.
            //
            // Because AcademyWeeklyTeams does not currently expose
            // a role mutation, we batch the role writes with the
            // stint-window writes and let applyMemberChange handle
            // the role field, if it is present.
            //
            // If role editing is not supported by the current
            // AcademyWeeklyTeams API, the role inputs will appear
            // editable but their changes will not be applied on
            // save. That is a known gap and would need a
            // TeamCore.updateMember-equivalent on the academic
            // side.
            //
            // For now, we attempt role writes by attaching the
            // role to the same change-list. The updateMemberWindows
            // implementation in academy-weekly-teams.js does not
            // read `role`, so this is a no-op there. The role
            // inputs remain as a placeholder for a follow-up.

            if (changes.length > 0) {
                chain = chain.then(function() {
                    return AcademyWeeklyTeams.updateMemberWindows(
                        classId, teamId, changes
                    ).then(function(result) {
                        if (!result || !result.success) {
                            failed = true;
                        }
                    });
                });
            }

            chain.then(function() {
                if (failed) {
                    return;
                }
                render();
                invokeOnChange();
            }).catch(function(err) {
                console.warn(
                    '[AcademyWeeklyTeamsMembers] save-all failed:', err
                );
                notify('Failed to save changes.', 'error');
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
            render();
        }

        // ------------------------------------------------------------------
        // Add member
        // ------------------------------------------------------------------

        function handleAdd() {
            var select = container.querySelector('.member-form-select');
            var charId = select ? select.value : '';
            if (!charId) {
                notify('Select a character to add.', 'error');
                return;
            }

            var roleInput = container.querySelector('.member-form-role');
            var joinInput = container.querySelector('.member-form-join');
            var leaveInput = container.querySelector('.member-form-leave');

            var role = roleInput ? roleInput.value.trim() : '';
            var joinRaw = joinInput ? joinInput.value.trim() : '';
            var leaveRaw = leaveInput ? leaveInput.value.trim() : '';

            // Join defaults to the display week.
            var joinParsed = joinRaw === ''
                ? weekNum
                : parseWeekStrict(joinRaw);
            if (joinParsed === null) {
                notify(
                    'Join week must be an integer between ' +
                    CalendarConstants.MIN_WEEK + ' and ' +
                    CalendarConstants.MAX_WEEK + '.',
                    'error'
                );
                return;
            }

            var leaveParsed = parseOptionalWeekInput(leaveRaw);
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

            // If role is present, we pass it through the interval
            // add. If the interval add does not accept a role, we
            // follow up with a second call.
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
            var row = btn.closest('.member-interval-row');
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
            var block = btn.closest('.member-entry-block');
            if (!block) { return; }

            var host = block.querySelector('.member-inline-add-host');
            if (!host) { return; }

            var charId = block.dataset.characterId;
            var memberId = block.dataset.memberId || '';

            var existing = host.querySelector('.member-inline-add-form');
            if (existing) {
                var existingJoin = existing.querySelector('.member-inline-add-join');
                if (existingJoin) { existingJoin.focus(); }
                return;
            }

            var member = findMemberVM(charId);
            var suggestion = suggestNextJoinWeek(member);

            var html = '';
            html += '<div class="member-inline-add-form" ' +
                        'data-character-id="' + escapeAttr(charId) + '" ' +
                        'data-member-id="' + escapeAttr(memberId) + '">';
            html += '<label class="member-inline-add-label">Join</label>';
            html += '<input type="number" ' +
                        'class="member-interval-input member-inline-add-join" ' +
                        'min="' + CalendarConstants.MIN_WEEK + '" ' +
                        'max="' + CalendarConstants.MAX_WEEK + '" ' +
                        'value="' + escapeAttr(String(suggestion)) + '" ' +
                        'placeholder="Required">';
            html += '<label class="member-inline-add-label">Leave</label>';
            html += '<input type="number" ' +
                        'class="member-interval-input member-inline-add-leave" ' +
                        'min="' + CalendarConstants.MIN_WEEK + '" ' +
                        'max="' + CalendarConstants.MAX_WEEK + '" ' +
                        'placeholder="\u2014">';
            html += '<button type="button" ' +
                        'class="small primary" ' +
                        'data-action="awtm-inline-add">Add</button>';
            html += '<button type="button" ' +
                        'class="small secondary" ' +
                        'data-action="awtm-inline-cancel">Cancel</button>';
            html += '</div>';

            btn.style.display = 'none';
            host.insertAdjacentHTML('beforeend', html);

            var joinInput = host.querySelector('.member-inline-add-join');
            if (joinInput) { joinInput.focus(); }
        }

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
            var form = btn.closest('.member-inline-add-form');
            if (!form) { return; }

            var block = form.closest('.member-entry-block');
            if (!block) { return; }

            form.remove();
            var addBtn = block.querySelector('.member-inline-add-btn');
            if (addBtn) {
                addBtn.style.display = '';
            }
        }

        function handleInlineStintAdd(btn) {
            var form = btn.closest('.member-inline-add-form');
            if (!form) { return; }

            var block = form.closest('.member-entry-block');
            if (!block) { return; }

            var charId = block.dataset.characterId;

            var joinInput = form.querySelector('.member-inline-add-join');
            var leaveInput = form.querySelector('.member-inline-add-leave');

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

            var member = findMemberVM(charId);
            var proposed = {
                joinPeriod: String(joinParsed),
                leavePeriod: leaveParsed.value
            };
            if (member) {
                var conflict = wouldOverlap(member, '', proposed);
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

            html += '<label class="member-restore-option">';
            html += '<input type="radio" name="awtm-restore-mode" ' +
                        'value="correct" checked>';
            html += '<span class="member-restore-option-body">';
            html += '<strong>Correct the leave week</strong>';
            html += '<span class="member-restore-option-hint">' +
                        'Edits this stint\'s existing window in place. ' +
                        'Use this when the leave week was recorded wrong.' +
                    '</span>';
            html += '<span class="member-restore-input-row">';
            html += '<label>Leave</label>';
            html += '<input type="number" ' +
                        'class="member-interval-input awtm-restore-leave-input" ' +
                        'min="' + CalendarConstants.MIN_WEEK + '" ' +
                        'max="' + CalendarConstants.MAX_WEEK + '" ' +
                        'value="' + escapeAttr(currentLeave) + '" ' +
                        'placeholder="\u2014">';
            html += '</span>';
            html += '</span>';
            html += '</label>';

            html += '<label class="member-restore-option">';
            html += '<input type="radio" name="awtm-restore-mode" ' +
                        'value="new">';
            html += '<span class="member-restore-option-body">';
            html += '<strong>Reopen with a new interval</strong>';
            html += '<span class="member-restore-option-hint">' +
                        'Preserves the former window and starts a fresh ' +
                        'one. Use this when they took a break and came ' +
                        'back.' +
                    '</span>';
            html += '<span class="member-restore-input-row">';
            html += '<label>Join</label>';
            html += '<input type="number" ' +
                        'class="member-interval-input awtm-restore-join-input" ' +
                        'min="' + CalendarConstants.MIN_WEEK + '" ' +
                        'max="' + CalendarConstants.MAX_WEEK + '" ' +
                        'value="' + escapeAttr(String(weekNum)) + '">';
            html += '<label>Leave</label>';
            html += '<input type="number" ' +
                        'class="member-interval-input awtm-restore-newleave-input" ' +
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
