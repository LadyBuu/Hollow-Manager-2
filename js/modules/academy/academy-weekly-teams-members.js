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
 *   - Current Members section: editable rows. Each row shows the
 *     character name and two editable inputs (Join, Leave). No
 *     per-row Save. A single footer Save commits every dirty row
 *     in one transaction.
 *   - Former Members section: read-only rows for entries whose
 *     window closed strictly before the displayed week. Lighter
 *     styling. Each row has a Restore button.
 *   - Add Member picker: at the bottom of the Current Members
 *     section.
 *   - Footer: Revert / Save / Close.
 *
 * SAVE SEMANTICS:
 *   A row is "dirty" when either input differs from its VM value
 *   (stored in data-initial-join / data-initial-leave).
 *   Save collects every dirty row and calls
 *   AcademyWeeklyTeams.updateMemberWindows with the list. One
 *   transaction, all-or-nothing.
 *
 * RESTORE SEMANTICS:
 *   The Restore button opens a small modal with two options:
 *
 *     1. Correct the leave week — edits the former entry in place.
 *        Use when the leave week was recorded wrong.
 *
 *     2. Reopen with a new interval — appends a new entry. The
 *        former entry survives as history. Use when the member
 *        took a break and came back.
 *
 * MEMBER IDENTITY:
 *   Every entry is addressed by its memberId when present, or by
 *   the composite { characterId, joinPeriod } when it predates
 *   memberId. The VM carries memberId per row.
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
        typeof AcademyWeeklyTeams.addMember !== 'function' ||
        typeof AcademyWeeklyTeams.updateMemberWindows !== 'function' ||
        typeof AcademyWeeklyTeams.purgeMemberRecords !== 'function') {
        _missing.push('AcademyWeeklyTeams (ranged API)');
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
    // IDENTIFIER CONSTRUCTION
    // ============================================================
    //
    // A row identifies a member entry by memberId when it has one.
    // Otherwise the composite { characterId, joinPeriod } is used.

    function buildIdentifierFromRow(row) {
        if (isNonEmptyString(row.dataset.memberId)) {
            return row.dataset.memberId;
        }
        return {
            characterId: row.dataset.characterId,
            joinPeriod: row.dataset.initialJoin || ''
        };
    }

    function buildIdentifierFromVM(member) {
        if (member && isNonEmptyString(member.memberId)) {
            return member.memberId;
        }
        return {
            characterId: member.characterId,
            joinPeriod: member.joinPeriod || ''
        };
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
                    'Edit any member\'s join or leave week, then ' +
                    'click Save. Blank means unbounded on that side. ' +
                    'Leave cannot be before join.' +
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
                html += renderCurrentMemberRow(members[i]);
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
                html += renderFormerMemberRow(formerMembers[k]);
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
     * Editable row for a current member.
     *
     * data-initial-join / data-initial-leave store the VM's
     * canonical values so the Save handler can detect changes
     * without keeping a parallel state object.
     *
     * data-member-id / data-character-id are the identity for the
     * change payload. When memberId is empty, the identifier is
     * built from characterId + joinPeriod.
     */
    function renderCurrentMemberRow(member) {
        if (!member || !member.characterId) { return ''; }

        var joinVal = isNonEmptyString(member.joinPeriod)
            ? member.joinPeriod
            : '';
        var leaveVal = isNonEmptyString(member.leavePeriod)
            ? member.leavePeriod
            : '';

        var statusLabel = isNonEmptyString(member.statusLabel)
            ? member.statusLabel
            : '';

        var rowClass = 'awtm-member-row';
        if (member.deceased === true) {
            rowClass += ' deceased';
        }

        var charIdAttr = escapeAttr(member.characterId);
        var memberIdAttr = escapeAttr(member.memberId || '');

        var html = '';
        html += '<div class="' + rowClass + '" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '" ' +
                    'data-initial-join="' + escapeAttr(joinVal) + '" ' +
                    'data-initial-leave="' + escapeAttr(leaveVal) + '">';

        html += '<span class="awtm-member-name">' +
                    escapeHtml(member.name || 'Unknown') +
                '</span>';

        if (member.deceased === true) {
            html += '<span class="awtm-member-deceased" ' +
                        'title="Deceased">\u2020</span>';
        }

        if (statusLabel) {
            html += '<span class="awtm-member-status">' +
                        escapeHtml(statusLabel) +
                    '</span>';
        }

        html += '<span class="awtm-member-fields">';

        html += '<label class="awtm-period-label">Join</label>';
        html += '<input type="number" ' +
                    'class="awtm-period-input awtm-join-input" ' +
                    'data-role="awtm-join-input" ' +
                    'min="' + CalendarConstants.MIN_WEEK + '" ' +
                    'max="' + CalendarConstants.MAX_WEEK + '" ' +
                    'value="' + escapeAttr(joinVal) + '" ' +
                    'placeholder="\u2014">';

        html += '<label class="awtm-period-label">Leave</label>';
        html += '<input type="number" ' +
                    'class="awtm-period-input awtm-leave-input" ' +
                    'data-role="awtm-leave-input" ' +
                    'min="' + CalendarConstants.MIN_WEEK + '" ' +
                    'max="' + CalendarConstants.MAX_WEEK + '" ' +
                    'value="' + escapeAttr(leaveVal) + '" ' +
                    'placeholder="\u2014">';

        html += '</span>';

        html += '</div>';
        return html;
    }

    /**
     * Read-only row for a former member.
     *
     * Carries the identity and period data the restore modal needs.
     */
    function renderFormerMemberRow(member) {
        if (!member || !member.characterId) { return ''; }

        var periodDisplay = isNonEmptyString(member.periodDisplay)
            ? member.periodDisplay
            : '';

        var charIdAttr = escapeAttr(member.characterId);
        var memberIdAttr = escapeAttr(member.memberId || '');
        var joinAttr = escapeAttr(member.joinPeriod || '');
        var leaveAttr = escapeAttr(member.leavePeriod || '');

        var html = '';
        html += '<div class="awtm-former-row" ' +
                    'data-character-id="' + charIdAttr + '" ' +
                    'data-member-id="' + memberIdAttr + '" ' +
                    'data-join-period="' + joinAttr + '" ' +
                    'data-leave-period="' + leaveAttr + '">';

        html += '<span class="awtm-former-name">' +
                    escapeHtml(member.name || 'Unknown') +
                '</span>';

        if (periodDisplay) {
            html += '<span class="awtm-former-period">' +
                        escapeHtml(periodDisplay) +
                    '</span>';
        }

        html += '<button type="button" ' +
                    'class="small secondary awtm-restore-btn" ' +
                    'data-action="awtm-restore">Restore</button>';

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
                    case 'awtm-restore':
                        e.preventDefault();
                        handleOpenRestore(target);
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
            var rows = container.querySelectorAll('.awtm-member-row');
            var changes = [];
            var invalidMessage = null;

            for (var i = 0; i < rows.length; i++) {
                var row = rows[i];
                var joinInput = row.querySelector('.awtm-join-input');
                var leaveInput = row.querySelector('.awtm-leave-input');

                var joinRaw = joinInput ? joinInput.value : '';
                var leaveRaw = leaveInput ? leaveInput.value : '';

                var initialJoin = row.dataset.initialJoin || '';
                var initialLeave = row.dataset.initialLeave || '';

                var joinParse = parseOptionalWeekInput(joinRaw);
                var leaveParse = parseOptionalWeekInput(leaveRaw);

                if (!joinParse.ok) {
                    invalidMessage =
                        'Join week must be blank or an integer between ' +
                        CalendarConstants.MIN_WEEK + ' and ' +
                        CalendarConstants.MAX_WEEK + '.';
                    break;
                }
                if (!leaveParse.ok) {
                    invalidMessage =
                        'Leave week must be blank or an integer between ' +
                        CalendarConstants.MIN_WEEK + ' and ' +
                        CalendarConstants.MAX_WEEK + '.';
                    break;
                }

                var joinCanonical = joinParse.value;
                var leaveCanonical = leaveParse.value;

                if (joinCanonical === initialJoin &&
                    leaveCanonical === initialLeave) {
                    continue;
                }

                if (joinCanonical !== '' && leaveCanonical !== '') {
                    var jn = parseInt(joinCanonical, 10);
                    var lv = parseInt(leaveCanonical, 10);
                    if (!isNaN(jn) && !isNaN(lv) && lv < jn) {
                        var nameEl = row.querySelector('.awtm-member-name');
                        invalidMessage =
                            'Row "' + (nameEl ? nameEl.textContent : '?') +
                            '": Leave cannot be before Join.';
                        break;
                    }
                }

                if (joinCanonical === '' && leaveCanonical === '') {
                    var nameEl2 = row.querySelector('.awtm-member-name');
                    invalidMessage =
                        'Row "' + (nameEl2 ? nameEl2.textContent : '?') +
                        '": set at least one of Join or Leave.';
                    break;
                }

                changes.push({
                    identifier: buildIdentifierFromRow(row),
                    joinPeriod: joinCanonical,
                    leavePeriod: leaveCanonical
                });
            }

            if (invalidMessage) {
                notify(invalidMessage, 'error');
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

        /**
         * Discard every dirty input by re-rendering from the VM.
         * The VM is the source of truth; a plain render() reverts
         * all uncommitted edits.
         */
        function handleRevert() {
            render();
        }

        // ------------------------------------------------------------------
        // Add
        // ------------------------------------------------------------------

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
                    '[AcademyWeeklyTeamsMembers] addMember failed:', err
                );
            });
        }

        // ------------------------------------------------------------------
        // Restore
        // ------------------------------------------------------------------

        function handleOpenRestore(btnEl) {
            var row = btnEl.closest('.awtm-former-row');
            if (!row) { return; }

            var characterId = row.dataset.characterId;
            var memberId = row.dataset.memberId;
            var joinPeriod = row.dataset.joinPeriod;
            var leavePeriod = row.dataset.leavePeriod;

            var identifier = isNonEmptyString(memberId)
                ? memberId
                : { characterId: characterId, joinPeriod: joinPeriod };

            openRestoreModal({
                characterId: characterId,
                memberId: memberId,
                joinPeriod: joinPeriod,
                leavePeriod: leavePeriod,
                identifier: identifier
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
            var leaveInput = form.querySelector(
                '.awtm-restore-leave-input'
            );
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

            AcademyWeeklyTeams.updateMemberWindows(
                classId,
                teamId,
                [{
                    identifier: info.identifier,
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
            var joinInput = form.querySelector(
                '.awtm-restore-join-input'
            );
            var newLeaveInput = form.querySelector(
                '.awtm-restore-newleave-input'
            );

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

            // Step 1: append a new stint via addMember. This creates
            // an entry with joinPeriod = joinParsed and
            // leavePeriod = ''.
            AcademyWeeklyTeams.addMember(
                classId, teamId, info.characterId, joinParsed
            )
            .then(function(addResult) {
                if (!addResult || !addResult.success) {
                    return;
                }

                if (newLeaveParsed.value === '') {
                    // No leave to set; done.
                    close();
                    render();
                    invokeOnChange();
                    return;
                }

                // Step 2: patch the newly-created entry's leave week.
                // Identify it by composite (characterId, joinPeriod) —
                // unique per character per join week.
                return AcademyWeeklyTeams.updateMemberWindows(
                    classId,
                    teamId,
                    [{
                        identifier: {
                            characterId: info.characterId,
                            joinPeriod: String(joinParsed)
                        },
                        leavePeriod: newLeaveParsed.value
                    }]
                ).then(function(updateResult) {
                    if (updateResult && updateResult.success) {
                        close();
                        render();
                        invokeOnChange();
                    }
                });
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
                        'Edits this entry\'s existing window in place. ' +
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
