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
 * RESPONSIBILITIES:
 *   - Fetch the member-manager VM from AcademyAggregator.
 *   - Render the VM into the caller's container.
 *   - Allow per-member editing of joinPeriod / leavePeriod.
 *   - Route add / drop-out / rejoin / purge / close interactions to
 *     AcademyWeeklyTeams.
 *   - Re-render in place after mutations.
 *   - Invoke the caller's onChange / onClose callbacks.
 *
 * NOT RESPONSIBILITIES:
 *   - Candidate eligibility. The aggregator decides.
 *   - Elimination filtering. The aggregator decides, fail-closed.
 *   - Member VM construction. The aggregator decides.
 *   - Persistent roster writes. AcademyWeeklyTeams owns them.
 *   - Modal lifecycle. The caller owns the shell.
 *
 * EDITABLE PERIODS (v24):
 *   [FIX-M1] Each member row exposes two editable inputs: Join Wk
 *   and Leave Wk. Both accept an integer in [MIN_WEEK, MAX_WEEK] or
 *   blank (meaning unbounded on that side). The row is committed by
 *   pressing Enter inside either input or clicking the row's Save
 *   button. The commit calls
 *   AcademyWeeklyTeams.updateMemberWindow(classId, teamId, charId,
 *   { joinPeriod, leavePeriod }).
 *
 *   [FIX-M2] Drop Out is a shortcut: it sets leavePeriod to
 *   displayedWeek - 1 and commits. Rejoin appears on rows whose
 *   leavePeriod is in the past relative to the display week; it
 *   asks for a new start week, purges the old interval, and opens
 *   a fresh one.
 *
 *   [FIX-M3] The Save handler validates both inputs strictly.
 *   Blank is valid. A non-blank value must be an integer in bounds.
 *   leave < join is rejected. Failures surface as toasts, never as
 *   silent no-ops.
 *
 * DROP OUT vs DELETE RECORD:
 *   - Drop Out: endMembership. History survives.
 *   - Delete Record: purgeMemberRecords. Hard-deletes.
 *
 * CLOSE SEMANTICS:
 *   The caller owns the modal. This module does not call
 *   Modal.closeModal / hideModal. Container close buttons invoke
 *   options.onClose. The returned handle's .close() is idempotent.
 *
 * WEEK COERCION (v24):
 *   The week argument is validated strictly, using the same rule the
 *   AcademyAggregator uses:
 *     - integer in [CalendarConstants.MIN_WEEK, MAX_WEEK], OR
 *     - a pure-integer string whose value is in bounds.
 *   Anything else is rejected before the aggregator is called.
 *
 * ELIMINATION (v24):
 *   Candidate eligibility, including elimination, is resolved by
 *   AcademyAggregator.getWeeklyTeamMemberManagerViewModel. If the
 *   aggregator throws (because EliminationQueries is missing or
 *   throws internally), this module does NOT swallow the error.
 *   The throw propagates, and a console warning names the
 *   dependency so a load-order mistake is loud.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.AcademyAggregator
 *   - window.AcademyWeeklyTeams
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
    var DomUtils = window.DomUtils;
    var NotificationSystem = window.NotificationSystem;
    var CalendarConstants = window.CalendarConstants;

    var _missing = [];

    if (!AcademyAggregator ||
        typeof AcademyAggregator.getWeeklyTeamMemberManagerViewModel !== 'function') {
        _missing.push('AcademyAggregator.getWeeklyTeamMemberManagerViewModel');
    }
    if (!AcademyWeeklyTeams ||
        typeof AcademyWeeklyTeams.addMember !== 'function' ||
        typeof AcademyWeeklyTeams.endMembership !== 'function' ||
        typeof AcademyWeeklyTeams.purgeMemberRecords !== 'function') {
        _missing.push('AcademyWeeklyTeams (ranged API)');
    }
    if (!AcademyWeeklyTeams ||
        typeof AcademyWeeklyTeams.updateMemberWindow !== 'function') {
        _missing.push('AcademyWeeklyTeams.updateMemberWindow');
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
    //
    // Accepts integers in [MIN_WEEK, MAX_WEEK] and pure-integer
    // strings whose value is in bounds. Rejects floats, trailing-
    // character strings, empty strings, null, undefined, and
    // out-of-range values.

    function parseWeekStrict(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }

        if (typeof value === 'number') {
            if (!Number.isInteger(value)) {
                return null;
            }
            if (value < CalendarConstants.MIN_WEEK ||
                value > CalendarConstants.MAX_WEEK) {
                return null;
            }
            return value;
        }

        if (typeof value === 'string') {
            var trimmed = value.trim();
            if (trimmed === '' || !/^\d+$/.test(trimmed)) {
                return null;
            }
            var n = Number(trimmed);
            if (!Number.isInteger(n)) {
                return null;
            }
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
     *   { ok: true, value: null } for blank
     *   { ok: true, value: N }    for a valid week
     *   { ok: false }             for invalid input
     */
    function parseOptionalWeekInput(raw) {
        if (raw === undefined || raw === null) {
            return { ok: true, value: null };
        }
        var str = String(raw).trim();
        if (str === '') {
            return { ok: true, value: null };
        }
        var parsed = parseWeekStrict(str);
        if (parsed === null) {
            return { ok: false };
        }
        return { ok: true, value: parsed };
    }

    // ============================================================
    // RENDER
    // ============================================================

    function renderManagerBody(vm, opts) {
        opts = opts || {};
        var notFound = opts.notFound === true;

        var members = Array.isArray(vm.members) ? vm.members : [];
        var candidates = Array.isArray(vm.candidates) ? vm.candidates : [];
        var displayedWeek = vm.week;

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
        } else {
            html += '<p class="field-hint">' +
                        'Each member has an independent join and leave ' +
                        'week. Edit either and press Enter or click ' +
                        'Save on that row. Blank means unbounded on ' +
                        'that side.' +
                    '</p>';

            // ---- Current members ----
            html += '<div class="form-group">';
            html += '<label>Current Members (' + members.length + ')</label>';

            if (members.length === 0) {
                html += '<p class="empty-state small">' +
                            'No members assigned to this team this week.' +
                        '</p>';
            } else {
                html += '<div class="academy-team-members-list">';
                for (var i = 0; i < members.length; i++) {
                    html += renderMemberRow(members[i], displayedWeek);
                }
                html += '</div>';
            }
            html += '</div>';

            // ---- Add member ----
            html += '<div class="form-group">';
            html += '<label for="awtm-member-select">Add Member</label>';

            if (candidates.length === 0) {
                html += '<p class="field-hint">' +
                            'No eligible characters available to add.' +
                        '</p>';
            } else {
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

                html += '<div class="awtm-member-add-row">';
                html += '<button type="button" ' +
                            'class="small primary" ' +
                            'data-action="awtm-add">Add</button>';
                html += '</div>';

                html += '<p class="field-hint">' +
                            'Adds the character starting from week ' +
                            escapeHtml(String(displayedWeek)) + '.' +
                        '</p>';
            }
            html += '</div>';
        }

        // ---- Actions ----
        html += '<div class="form-actions">';
        html += '<button type="button" class="secondary" ' +
                    'data-action="awtm-close">Close</button>';
        html += '</div>';

        html += '</div>';

        return html;
    }

    /**
     * Render one member row with editable period inputs.
     *
     * data-action values:
     *   awtm-save    — commit the row's edits
     *   awtm-dropout — shortcut: set leavePeriod = displayedWeek - 1
     *   awtm-rejoin  — open a new interval after a closed one
     *   awtm-purge   — hard-delete the member entry
     *
     * data-role values on inputs:
     *   awtm-join-input
     *   awtm-leave-input
     */
    function renderMemberRow(member, displayedWeek) {
        if (!member || !member.characterId) { return ''; }

        var statusLabel = isNonEmptyString(member.statusLabel)
            ? member.statusLabel
            : '';
        var isDeceased = member.deceased === true;

        var joinVal = isNonEmptyString(member.joinPeriod)
            ? member.joinPeriod
            : '';
        var leaveVal = isNonEmptyString(member.leavePeriod)
            ? member.leavePeriod
            : '';

        var rowClass = 'academy-team-member-row';
        if (isDeceased) {
            rowClass += ' deceased';
        }

        // Rejoin is offered when the member's leave week is in the
        // past relative to the displayed week: their window is
        // closed and they can start a fresh interval.
        var leaveNum = parseWeekStrict(leaveVal);
        var showRejoin =
            leaveNum !== null &&
            displayedWeek !== null &&
            leaveNum < displayedWeek;

        var charIdAttr = escapeAttr(member.characterId);

        var html = '';
        html += '<div class="' + rowClass + '" ' +
                    'data-character-id="' + charIdAttr + '">';

        // ---- Name and status ----
        html += '<span class="academy-team-member-name">' +
                    escapeHtml(member.name || 'Unknown') +
                '</span>';

        if (isDeceased) {
            html += '<span class="academy-team-member-deceased-marker" ' +
                        'title="Deceased">\u2020</span>';
        }

        if (statusLabel) {
            html += '<span class="academy-team-member-status">' +
                        escapeHtml(statusLabel) +
                    '</span>';
        }

        // ---- Editable join / leave ----
        html += '<span class="awtm-member-period-fields">';

        html += '<label class="awtm-period-label" ' +
                    'for="awtm-join-' + charIdAttr + '">Join</label>';
        html += '<input type="number" ' +
                    'class="awtm-period-input awtm-join-input" ' +
                    'id="awtm-join-' + charIdAttr + '" ' +
                    'data-role="awtm-join-input" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'min="' + CalendarConstants.MIN_WEEK + '" ' +
                    'max="' + CalendarConstants.MAX_WEEK + '" ' +
                    'value="' + escapeAttr(joinVal) + '" ' +
                    'placeholder="\u2014">';

        html += '<label class="awtm-period-label" ' +
                    'for="awtm-leave-' + charIdAttr + '">Leave</label>';
        html += '<input type="number" ' +
                    'class="awtm-period-input awtm-leave-input" ' +
                    'id="awtm-leave-' + charIdAttr + '" ' +
                    'data-role="awtm-leave-input" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'min="' + CalendarConstants.MIN_WEEK + '" ' +
                    'max="' + CalendarConstants.MAX_WEEK + '" ' +
                    'value="' + escapeAttr(leaveVal) + '" ' +
                    'placeholder="\u2014">';

        html += '<button type="button" ' +
                    'class="small primary awtm-save-btn" ' +
                    'data-action="awtm-save" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'title="Save this member\'s period">' +
                    'Save' +
                '</button>';

        html += '</span>';

        // ---- Shortcut actions ----
        html += '<button type="button" ' +
                    'class="small secondary" ' +
                    'data-action="awtm-dropout" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'title="Set leave week to ' +
                        (displayedWeek - 1) + '">' +
                    'Drop Out' +
                '</button>';

        if (showRejoin) {
            html += '<button type="button" ' +
                        'class="small secondary" ' +
                        'data-action="awtm-rejoin" ' +
                        'data-character-id="' + charIdAttr + '" ' +
                        'title="Open a new interval starting now">' +
                        'Rejoin' +
                    '</button>';
        }

        html += '<button type="button" ' +
                    'class="small danger" ' +
                    'data-action="awtm-purge" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'title="Delete record: remove all history">' +
                    '\u2715' +
                '</button>';

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
        var keydownHandler = null;

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
                    'building the member-manager VM. This usually means ' +
                    'EliminationQueries is not loaded, or the candidate ' +
                    'pool could not be computed. Original error:',
                    e
                );
                throw e;
            }

            if (!vm) {
                container.innerHTML = renderManagerBody({
                    teamId: teamId,
                    teamName: 'Team',
                    week: weekNum,
                    members: [],
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
                        handleSave(target.dataset.characterId);
                        return;
                    case 'awtm-dropout':
                        e.preventDefault();
                        handleDropOut(target.dataset.characterId);
                        return;
                    case 'awtm-rejoin':
                        e.preventDefault();
                        handleRejoin(target.dataset.characterId);
                        return;
                    case 'awtm-purge':
                        e.preventDefault();
                        handlePurge(target.dataset.characterId);
                        return;
                    case 'awtm-add':
                        e.preventDefault();
                        handleAdd();
                        return;
                    default:
                        return;
                }
            };
            rootEl.addEventListener('click', clickHandler);

            if (keydownHandler) {
                rootEl.removeEventListener('keydown', keydownHandler);
            }
            keydownHandler = function(e) {
                if (e.key !== 'Enter') { return; }
                var input = e.target;
                if (!input) { return; }
                var role = input.dataset ? input.dataset.role : '';
                if (role !== 'awtm-join-input' &&
                    role !== 'awtm-leave-input') {
                    return;
                }
                e.preventDefault();
                var charId = input.dataset.characterId;
                if (charId) { handleSave(charId); }
            };
            rootEl.addEventListener('keydown', keydownHandler);
        }

        // ------------------------------------------------------------------
        // Row-edit commit
        // ------------------------------------------------------------------
        //
        // [FIX-M3] Reads the two inputs on the member's row, validates
        // them, and calls AcademyWeeklyTeams.updateMemberWindow. On
        // success, re-renders in place. On failure, notifies the user
        // and leaves the inputs as-is.

        function handleSave(charId) {
            if (!charId) { return; }

            var joinInput = container.querySelector(
                '.awtm-join-input[data-character-id="' + charId + '"]'
            );
            var leaveInput = container.querySelector(
                '.awtm-leave-input[data-character-id="' + charId + '"]'
            );

            var joinRaw = joinInput ? joinInput.value : '';
            var leaveRaw = leaveInput ? leaveInput.value : '';

            var joinParse = parseOptionalWeekInput(joinRaw);
            if (!joinParse.ok) {
                notify(
                    'Join week must be blank or an integer between ' +
                    CalendarConstants.MIN_WEEK + ' and ' +
                    CalendarConstants.MAX_WEEK + '.',
                    'error'
                );
                return;
            }

            var leaveParse = parseOptionalWeekInput(leaveRaw);
            if (!leaveParse.ok) {
                notify(
                    'Leave week must be blank or an integer between ' +
                    CalendarConstants.MIN_WEEK + ' and ' +
                    CalendarConstants.MAX_WEEK + '.',
                    'error'
                );
                return;
            }

            var joinNum = joinParse.value;
            var leaveNum = leaveParse.value;

            if (joinNum !== null &&
                leaveNum !== null &&
                leaveNum < joinNum) {
                notify(
                    'Leave week cannot be before join week.',
                    'error'
                );
                return;
            }

            // Both blank would leave the entry in a meaningless
            // state. Reject rather than write.
            if (joinNum === null && leaveNum === null) {
                notify(
                    'Set at least one of Join or Leave.',
                    'error'
                );
                return;
            }

            AcademyWeeklyTeams.updateMemberWindow(
                classId,
                teamId,
                charId,
                {
                    joinPeriod: joinNum === null ? '' : String(joinNum),
                    leavePeriod: leaveNum === null ? '' : String(leaveNum)
                }
            )
            .then(function(result) {
                if (result && result.success) {
                    render();
                    invokeOnChange();
                }
                // On failure, MutationPipeline has already surfaced
                // the reason; do not double-notify.
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyWeeklyTeamsMembers] updateMemberWindow failed:',
                    err
                );
            });
        }

        // ------------------------------------------------------------------
        // Drop Out
        // ------------------------------------------------------------------
        //
        // Shortcut: set leavePeriod = displayedWeek - 1. This uses the
        // same updateMemberWindow mutation as Save, so the member entry
        // is edited in place rather than replaced.

        function handleDropOut(charId) {
            if (!charId) return;
            var dropLeave = weekNum - 1;

            if (dropLeave < CalendarConstants.MIN_WEEK) {
                notify(
                    'Cannot drop out: current week is already the first ' +
                    'week of the calendar.',
                    'error'
                );
                return;
            }

            if (!confirm(
                'Drop this member out from week ' + weekNum +
                ' onward? Their earlier membership is preserved.'
            )) {
                return;
            }

            AcademyWeeklyTeams.updateMemberWindow(
                classId,
                teamId,
                charId,
                {
                    joinPeriod: undefined,
                    leavePeriod: String(dropLeave)
                }
            )
            .then(function(result) {
                if (result && result.success) {
                    render();
                    invokeOnChange();
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyWeeklyTeamsMembers] drop out failed:',
                    err
                );
            });
        }

        // ------------------------------------------------------------------
        // Rejoin
        // ------------------------------------------------------------------
        //
        // [FIX-M2] The schema stores one window per member entry. A
        // rejoin is therefore: purge the old entry, add a fresh one
        // starting at the user-supplied week. The user is prompted
        // for the start week; leave is unbounded.

        function handleRejoin(charId) {
            if (!charId) return;

            var input = prompt(
                'Rejoin starting at which week? (between ' +
                CalendarConstants.MIN_WEEK + ' and ' +
                CalendarConstants.MAX_WEEK + ')',
                String(weekNum)
            );

            if (input === null) { return; }

            var rejoinStart = parseWeekStrict(input);
            if (rejoinStart === null) {
                notify(
                    'Rejoin week must be an integer between ' +
                    CalendarConstants.MIN_WEEK + ' and ' +
                    CalendarConstants.MAX_WEEK + '.',
                    'error'
                );
                return;
            }

            // Purge first (removes the historical entry for this
            // character in this team), then re-add with the new
            // join week.
            AcademyWeeklyTeams.purgeMemberRecords(
                classId, teamId, charId
            )
            .then(function(purgeResult) {
                if (!purgeResult || !purgeResult.success) {
                    // Purge found nothing to remove; proceed anyway.
                    return null;
                }
                return AcademyWeeklyTeams.addMember(
                    classId, teamId, charId, rejoinStart
                );
            })
            .then(function(addResult) {
                if (!addResult) { return; }
                if (addResult && addResult.success) {
                    render();
                    invokeOnChange();
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyWeeklyTeamsMembers] rejoin failed:',
                    err
                );
            });
        }

        function handlePurge(charId) {
            if (!charId) return;
            if (!confirm(
                'Permanently delete this membership record? ' +
                'This removes all history for this member in this team ' +
                'and cannot be undone.'
            )) {
                return;
            }

            AcademyWeeklyTeams.purgeMemberRecords(
                classId, teamId, charId
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

        function handleAdd() {
            var select = container.querySelector('.awtm-member-select');
            var charId = select ? select.value : '';

            if (!charId) {
                notify('Select a character to add.', 'error');
                return;
            }

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
                    '[AcademyWeeklyTeamsMembers] addMember failed:',
                    err
                );
            });
        }

        function close() {
            if (disposed) return;
            disposed = true;
            if (clickHandler && container.parentNode) {
                try {
                    container.removeEventListener('click', clickHandler);
                } catch (e) {}
            }
            if (keydownHandler && container.parentNode) {
                try {
                    container.removeEventListener('keydown', keydownHandler);
                } catch (e) {}
            }
            clickHandler = null;
            keydownHandler = null;
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
