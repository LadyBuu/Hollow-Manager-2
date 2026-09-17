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
 *   - Route add / drop-out / purge / close interactions to
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
 * DROP OUT vs DELETE RECORD:
 *   - Drop Out: AcademyWeeklyTeams.endMembership(classId, teamId,
 *     charId, effectiveWeek). The member's active window becomes
 *     [startWeek, effectiveWeek - 1]. History survives.
 *
 *   - Delete Record: AcademyWeeklyTeams.purgeMemberRecords(classId,
 *     teamId, charId). Hard-deletes the membership entry as if it
 *     never existed.
 *
 * CLOSE SEMANTICS:
 *   The caller owns the modal. This module does not call
 *   Modal.closeModal / hideModal. Container close buttons invoke
 *   options.onClose. The returned handle's .close() is idempotent.
 *
 * WEEK COERCION (v24):
 *   [FIX-3a] The week argument is validated strictly, using the same
 *   rule the AcademyAggregator uses:
 *     - integer in [CalendarConstants.MIN_WEEK, MAX_WEEK], OR
 *     - a pure-integer string whose value is in bounds.
 *   Anything else ("3abc", "3.9", 3.5, null, "") is rejected before
 *   the aggregator is called, so the caller gets "Valid week is
 *   required." instead of a "Team not found" that hides the real
 *   reason.
 *
 * ELIMINATION (v24):
 *   [FIX-3b] Candidate eligibility — including elimination — is
 *   resolved by AcademyAggregator.getWeeklyTeamMemberManagerViewModel.
 *   If the aggregator throws (because EliminationQueries is missing
 *   or throws internally), this module does NOT swallow the error.
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
    // [FIX-3a] Accepts integers in [MIN_WEEK, MAX_WEEK] and
    // pure-integer strings whose value is in bounds. Rejects
    // floats, trailing-character strings ("3abc"), empty strings,
    // null, undefined, and out-of-range values. No silent
    // coercion of "3.9" to 3.

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

    // ============================================================
    // RENDER
    // ============================================================

    function renderManagerBody(vm, opts) {
        opts = opts || {};
        var notFound = opts.notFound === true;

        var members = Array.isArray(vm.members) ? vm.members : [];
        var candidates = Array.isArray(vm.candidates) ? vm.candidates : [];

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
                        'Membership is week-scoped and range-based. ' +
                        'Adding a member records their start from the ' +
                        'displayed week. Dropping out ends their ' +
                        'membership from the displayed week onward.' +
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
                    html += renderMemberRow(members[i]);
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
                            escapeHtml(String(vm.week)) + '.' +
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

    function renderMemberRow(member) {
        if (!member || !member.characterId) { return ''; }

        var statusLabel = isNonEmptyString(member.status)
            ? member.status
            : '';
        var isDeceased = member.deceased === true;

        var rowClass = 'academy-team-member-row';
        if (isDeceased) {
            rowClass += ' deceased';
        }

        var html = '';
        html += '<div class="' + rowClass + '" ' +
                    'data-character-id="' +
                        escapeAttr(member.characterId) + '">';

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

        html += '<button type="button" ' +
                    'class="small danger" ' +
                    'data-action="awtm-dropout" ' +
                    'data-character-id="' +
                        escapeAttr(member.characterId) + '" ' +
                    'title="Drop out: end membership from this week onward">' +
                    'Drop Out' +
                '</button>';

        html += '<button type="button" ' +
                    'class="small danger" ' +
                    'data-action="awtm-purge" ' +
                    'data-character-id="' +
                        escapeAttr(member.characterId) + '" ' +
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

        // [FIX-3a] Strict week parse. Rejects "3abc", "3.9", 3.5, etc.
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

        function render() {
            if (disposed || !container.parentNode) {
                return;
            }

            // [FIX-3b] Do NOT swallow aggregator throws. The
            // aggregator now throws when EliminationQueries is
            // missing (fail-closed candidate filtering). A caught-
            // and-swallowed throw would render "Team not found",
            // which hides the real problem. Let the throw propagate
            // after logging a diagnostic line that names the likely
            // cause.
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
                // Re-throw so the caller sees the failure.
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
                    case 'awtm-dropout':
                        e.preventDefault();
                        handleDropOut(target.dataset.characterId);
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
        }

        function handleDropOut(charId) {
            if (!charId) return;
            if (!confirm(
                'Drop this member out from week ' + weekNum +
                ' onward? Their earlier membership is preserved.'
            )) {
                return;
            }

            AcademyWeeklyTeams.endMembership(
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
                    '[AcademyWeeklyTeamsMembers] endMembership failed:',
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
