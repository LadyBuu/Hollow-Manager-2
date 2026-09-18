/**
 * modules/shared/member-manager.js - Shared Member Manager
 *
 * Path: js/modules/shared/member-manager.js
 *
 * The ONE member manager. Rendered identically by the Teams tab and
 * Academy Weekly Teams. All domain knowledge lives in an adapter;
 * this module never imports TeamCore, AcademyWeeklyTeams, or any
 * query module.
 *
 * WHY IT EXISTS:
 *   Before this, there were two member managers — one in
 *   team-events.js and one in academy-weekly-teams-members.js —
 *   with different markup, different features, and different
 *   visual languages. They drifted every time either was touched.
 *   Option 2 (chosen) collapses them into one implementation plus
 *   two thin adapters.
 *
 * CONFIG SHAPE:
 *   MemberManager.open(container, config)
 *
 *   config = {
 *     teamId:   string,
 *     period:   number,
 *     adapter:  <adapter object>,
 *     onClose:  function()   // called when the manager closes
 *   }
 *
 * ADAPTER CONTRACT:
 *   Every adapter provides exactly these seven methods. Each
 *   returns a Promise<{ success, message? }> or, for fetchVM,
 *   returns the VM synchronously (or throws).
 *
 *     fetchVM(teamId, period)
 *       → {
 *           teamId,
 *           teamName,
 *           period,
 *           members:       [ MemberVM ],
 *           formerMembers: [ MemberVM ],
 *           candidates:    [ { id, name, status, deceased } ]
 *         }
 *
 *     addMember(teamId, period, { charId, role, join, leave })
 *       → Promise<{ success, message? }>
 *
 *     updateMembers(teamId, period, changes)
 *       changes = [ { identifier, role?, join?, leave? } ]
 *       → Promise<{ success, message? }>
 *
 *     removeStint(teamId, period, identifier)
 *       → Promise<{ success, message? }>
 *
 *     rejoinStint(teamId, period, identifier)
 *       → Promise<{ success, message? }>
 *
 *     removeMember(teamId, period, charId)
 *       → Promise<{ success, message? }>
 *
 *   `identifier` is either:
 *     - a composite { characterId, joinPeriod }, or
 *     - a memberId string
 *
 *   The adapter decides which form it prefers. The manager passes
 *   whatever is on the row's dataset, preferring the composite when
 *   joinPeriod is non-empty, and the memberId when it is not.
 *
 * MEMBER VM SHAPE:
 *   {
 *     characterId, memberId, name, role, deceased,
 *     isFormer,            // true for former members
 *     intervals: [
 *       { joinPeriod, leavePeriod, periodDisplay, activeAtPeriod }
 *     ]
 *   }
 *
 *   The manager renders ONE ROW PER INTERVAL.
 *
 * INTERACTION MODEL:
 *   - Add Member row at the top: select, role, join, leave, Add.
 *     Add commits immediately.
 *   - Each stint row: [Name (role)] [Join: X] [Leave: Y] [Rejoin?] [✕]
 *   - Join and Leave are click-to-edit. Span → input on click.
 *     Enter or blur commits to the dirty set. Escape cancels.
 *   - Role is per-member. Every row shows the member's current
 *     role. Editing any row's role input updates all rows for that
 *     member. Committed to the dirty set on Save.
 *   - Rejoin (former rows only): clears the leave. Commits
 *     immediately. No confirm.
 *   - ✕: removes the stint. If it is the member's last stint, the
 *     member entry is pruned. Commits immediately. Confirms first
 *     when it will prune the whole member.
 *   - Footer: Revert (discard dirty edits), Save (commit dirty
 *     edits), Close (close manager, notify caller).
 *
 * DIRTY MODEL:
 *   "Dirty" means "has an unsaved period edit or role edit."
 *   Rejoins, ✕, and Adds are not staged; they commit immediately.
 *   Revert discards dirty period and role edits only. Documented
 *   limitation. Matches how the previous professional manager
 *   behaved.
 *
 * NO DOM OUTSIDE THE CONTAINER:
 *   The manager writes only into the container it was given. It
 *   never reaches into document.body, never assumes the shape of
 *   the modal it is embedded in, and never removes itself. The
 *   caller owns the modal shell.
 *
 * DEPENDENCIES:
 *   - window.DomUtils             (MANDATORY)
 *   - window.NotificationSystem   (MANDATORY)
 *   - window.CalendarConstants    (MANDATORY — period bounds)
 *
 * USAGE (Teams tab):
 *   var modal = Modal.createModal('member-manager-modal');
 *   var content = document.createElement('div');
 *   content.className = 'modal-content wide';
 *   modal.appendChild(content);
 *   Modal.modalSetup(modal, onModalClose);
 *   Modal.showModal(modal);
 *   MemberManager.open(content, {
 *       teamId: teamId,
 *       period: period,
 *       adapter: TeamsMemberAdapter,
 *       onClose: function() { Modal.closeModal(modal); refreshUI(); }
 *   });
 */

(function() {
    'use strict';

    if (window.__memberManagerLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var DomUtils = window.DomUtils;
    var NotificationSystem = window.NotificationSystem;
    var CalendarConstants = window.CalendarConstants;

    var _missing = [];
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
            '[MemberManager] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__memberManagerLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    // Period bounds. The manager accepts both week-typed and year-
    // typed periods; adapters do not need to signal which. The
    // min/max are only used by the click-to-edit validators.
    var MIN_PERIOD = 1;
    var MAX_PERIOD = Math.max(CalendarConstants.MAX_WEEK || 52, 9999);

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(v) {
        return typeof v === 'string' && v.trim() !== '';
    }

    function escapeHtml(v) { return DomUtils.escapeHtml(v); }
    function escapeAttr(v) { return DomUtils.escapeAttribute(v); }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    function parsePeriodStrict(raw, allowBlank) {
        if (raw === undefined || raw === null) {
            return allowBlank ? { ok: true, value: '' } : { ok: false };
        }
        var str = String(raw).trim();
        if (str === '') {
            return allowBlank ? { ok: true, value: '' } : { ok: false };
        }
        if (!/^\d+$/.test(str)) {
            return { ok: false };
        }
        var n = Number(str);
        if (!Number.isInteger(n) || n < MIN_PERIOD || n > MAX_PERIOD) {
            return { ok: false };
        }
        return { ok: true, value: String(n) };
    }

    // ============================================================
    // PUBLIC ENTRY
    // ============================================================

    /**
     * Open the manager into a container.
     *
     * @param {HTMLElement} container
     * @param {object} config
     * @returns {object} { refresh, close, isOpen }
     */
    function open(container, config) {
        if (!container || typeof container !== 'object') {
            console.warn('[MemberManager] container is required.');
            return null;
        }
        if (!config || typeof config !== 'object') {
            console.warn('[MemberManager] config is required.');
            return null;
        }
        if (!isNonEmptyString(config.teamId)) {
            console.warn('[MemberManager] config.teamId is required.');
            return null;
        }
        if (!config.adapter || typeof config.adapter !== 'object') {
            console.warn('[MemberManager] config.adapter is required.');
            return null;
        }

        var adapter = config.adapter;
        var teamId = String(config.teamId);
        var period = config.period;
        var onClose = (typeof config.onClose === 'function')
            ? config.onClose
            : function() {};

        // ---- State ----
        var disposed = false;
        var clickHandler = null;
        var blurHandler = null;
        var keydownHandler = null;
        var currentVM = null;

        // Role edits by characterId. This is the "dirty" role set.
        var dirtyRoles = Object.create(null);

        // Period edits by `${charId}::${joinPeriod}::${field}` →
        // canonical string value. This is the "dirty" period set.
        var dirtyPeriods = Object.create(null);

        // --------------------------------------------------------
        // Fetch / render
        // --------------------------------------------------------

        function fetchVM() {
            return adapter.fetchVM(teamId, period);
        }

        function render() {
            if (disposed || !container.parentNode) {
                return;
            }

            var vm;
            try {
                vm = fetchVM();
            } catch (e) {
                console.warn(
                    '[MemberManager] fetchVM threw:', e
                );
                container.innerHTML = renderNotFound();
                bindEvents();
                return;
            }

            currentVM = vm;

            if (!vm) {
                container.innerHTML = renderNotFound();
                bindEvents();
                return;
            }

            container.innerHTML = renderBody(vm);
            bindEvents();
        }

        function renderNotFound() {
            return (
                '<div class="modal-body">' +
                    '<p class="empty-state small">' +
                        'Team not found.' +
                    '</p>' +
                '</div>'
            );
        }

        // --------------------------------------------------------
        // Top-level body
        // --------------------------------------------------------

        function renderBody(vm) {
            var html = '';

            html += '<div class="modal-header">';
            html += '<h3>Manage Members \u2014 ' +
                        escapeHtml(vm.teamName || 'Team') +
                    '</h3>';
            html += '<button type="button" ' +
                        'class="close-modal" ' +
                        'data-action="mm-close">&times;</button>';
            html += '</div>';

            html += '<div class="modal-body">';

            html += renderAddRow(vm);

            html += renderList(vm);

            html += renderFooter();

            html += '</div>';
            return html;
        }

        // --------------------------------------------------------
        // Add member row
        // --------------------------------------------------------

        function renderAddRow(vm) {
            var candidates = Array.isArray(vm.candidates)
                ? vm.candidates
                : [];

            var html = '';
            html += '<div class="member-form">';

            html += '<select class="member-form-select">';
            html += '<option value="">Select character...</option>';
            for (var i = 0; i < candidates.length; i++) {
                var c = candidates[i];
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
                        'placeholder="Role">';
            html += '<input type="number" class="member-form-join" ' +
                        'placeholder="Join" min="' + MIN_PERIOD + '">';
            html += '<input type="number" class="member-form-leave" ' +
                        'placeholder="Leave" min="' + MIN_PERIOD + '">';
            html += '<button type="button" ' +
                        'class="small primary member-form-add" ' +
                        'data-action="mm-add">Add Member</button>';

            html += '</div>';
            return html;
        }

        // --------------------------------------------------------
        // Members list
        // --------------------------------------------------------

        function renderList(vm) {
            var members = Array.isArray(vm.members) ? vm.members : [];
            var formerMembers = Array.isArray(vm.formerMembers)
                ? vm.formerMembers
                : [];

            var html = '';

            if (members.length === 0 && formerMembers.length === 0) {
                html += '<p class="empty-state small member-manager-empty">' +
                            'No members in this team.' +
                        '</p>';
                return html;
            }

            html += '<div class="member-manager-list">';

            for (var i = 0; i < members.length; i++) {
                html += renderMember(members[i], false);
            }

            if (formerMembers.length > 0) {
                html += '<div class="member-manager-former-header">' +
                            'Former Members' +
                        '</div>';
                for (var j = 0; j < formerMembers.length; j++) {
                    html += renderMember(formerMembers[j], true);
                }
            }

            html += '</div>';
            return html;
        }

        /**
         * Render one member as one row per stint.
         *
         * Every row for the same member carries the same role input
         * value (per-member role). Editing any of them updates the
         * in-memory dirtyRoles and re-renders all rows for that
         * member on the next render.
         */
        function renderMember(member, isFormer) {
            if (!member || !member.characterId) { return ''; }

            var intervals = Array.isArray(member.intervals)
                ? member.intervals
                : [];

            // Role value: prefer the dirty value, fall back to VM.
            var charId = String(member.characterId);
            var roleValue = Object.prototype.hasOwnProperty
                .call(dirtyRoles, charId)
                ? dirtyRoles[charId]
                : (member.role || '');

            var html = '';

            if (intervals.length === 0) {
                html += renderMemberPlaceholderRow(member, isFormer, roleValue);
                return html;
            }

            for (var i = 0; i < intervals.length; i++) {
                html += renderStintRow(
                    member,
                    intervals[i],
                    i === 0,
                    isFormer,
                    roleValue
                );
            }

            return html;
        }

        function renderMemberPlaceholderRow(member, isFormer, roleValue) {
            var charIdAttr = escapeAttr(member.characterId);
            var memberIdAttr = escapeAttr(member.memberId || '');

            var rowClass = 'member-stint-row member-stint-row-placeholder';
            if (isFormer) {
                rowClass += ' is-former';
            }

            var html = '';
            html += '<div class="' + rowClass + '" ' +
                        'data-character-id="' + charIdAttr + '" ' +
                        'data-member-id="' + memberIdAttr + '" ' +
                        'data-join-period="">';

            html += '<span class="member-stint-name">' +
                        escapeHtml(member.name || 'Unknown') +
                    '</span>';

            html += renderInlineRoleInput(charIdAttr, roleValue, true);

            html += '<span class="member-stint-bounds-placeholder">' +
                        'No stints recorded.' +
                    '</span>';

            html += '<span class="member-stint-actions">';
            html += '<button type="button" ' +
                        'class="small danger member-stint-remove" ' +
                        'data-action="mm-remove-member" ' +
                        'data-character-id="' + charIdAttr + '" ' +
                        'data-member-id="' + memberIdAttr + '">' +
                        '\u2715' +
                    '</button>';
            html += '</span>';

            html += '</div>';
            return html;
        }

        function renderStintRow(member, interval, isFirst, isFormer, roleValue) {
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

            // Effective value = dirty if present, else the VM's.
            var effectiveJoin = readEffective(
                member.characterId, joinStr, 'join', joinStr
            );
            var effectiveLeave = readEffective(
                member.characterId, joinStr, 'leave', leaveStr
            );

            var rowClass = 'member-stint-row';
            if (isFormer) { rowClass += ' is-former'; }
            if (!isFirst) { rowClass += ' is-continuation'; }

            var html = '';
            html += '<div class="' + rowClass + '" ' +
                        'data-character-id="' + charIdAttr + '" ' +
                        'data-member-id="' + memberIdAttr + '" ' +
                        'data-join-period="' + escapeAttr(joinStr) + '" ' +
                        'data-original-join="' + escapeAttr(joinStr) + '" ' +
                        'data-original-leave="' + escapeAttr(leaveStr) + '">';

            // ---- Name + role ----
            if (isFirst) {
                html += '<span class="member-stint-name">' +
                            escapeHtml(member.name || 'Unknown') +
                        '</span>';
                html += renderInlineRoleInput(charIdAttr, roleValue, false);
                if (member.deceased === true) {
                    html += '<span class="member-stint-deceased" ' +
                                'title="Deceased">\u2020</span>';
                }
            } else {
                html += '<span class="member-stint-name ' +
                            'member-stint-continuation">\u21b3</span>';
            }

            // ---- Join / Leave ----
            html += '<span class="member-stint-bounds">';

            html += '<span class="member-join" ' +
                        'data-field="join" ' +
                        'data-value="' + escapeAttr(effectiveJoin) + '" ' +
                        'title="Click to edit Join">' +
                        'Join: ' +
                        (effectiveJoin !== ''
                            ? escapeHtml(effectiveJoin)
                            : '\u2014') +
                    '</span>';

            html += '<span class="member-leave" ' +
                        'data-field="leave" ' +
                        'data-value="' + escapeAttr(effectiveLeave) + '" ' +
                        'title="Click to edit Leave">' +
                        'Leave: ' +
                        (effectiveLeave !== ''
                            ? escapeHtml(effectiveLeave)
                            : '\u2014') +
                    '</span>';

            html += '</span>';

            // ---- Actions ----
            html += '<span class="member-stint-actions">';

            if (isFormer) {
                html += '<button type="button" ' +
                            'class="small secondary member-stint-rejoin" ' +
                            'data-action="mm-rejoin" ' +
                            'data-character-id="' + charIdAttr + '" ' +
                            'data-member-id="' + memberIdAttr + '" ' +
                            'data-join-period="' + escapeAttr(joinStr) + '" ' +
                            'title="Clear the leave so the stint becomes ' +
                                'open-ended again">' +
                            'Rejoin' +
                        '</button>';
            }

            html += '<button type="button" ' +
                        'class="small danger member-stint-remove" ' +
                        'data-action="mm-remove-stint" ' +
                        'data-character-id="' + charIdAttr + '" ' +
                        'data-member-id="' + memberIdAttr + '" ' +
                        'data-join-period="' + escapeAttr(joinStr) + '" ' +
                        'title="Remove this stint">' +
                        '\u2715' +
                    '</button>';

            html += '</span>';

            html += '</div>';
            return html;
        }

        function renderInlineRoleInput(charIdAttr, roleValue, disabled) {
            var html = '';
            html += '<input type="text" ' +
                        'class="member-stint-role" ' +
                        'data-role="mm-role-input" ' +
                        'data-character-id="' + charIdAttr + '" ' +
                        'value="' + escapeAttr(roleValue || '') + '" ' +
                        'placeholder="Role"' +
                        (disabled ? ' disabled' : '') + '>';
            return html;
        }

        /**
         * Read the effective value for a period field, preferring a
         * dirty value when one exists.
         */
        function readEffective(charId, joinPeriod, field, vmValue) {
            var key = dirtyKey(charId, joinPeriod, field);
            if (Object.prototype.hasOwnProperty.call(dirtyPeriods, key)) {
                return dirtyPeriods[key];
            }
            return vmValue;
        }

        function dirtyKey(charId, joinPeriod, field) {
            return String(charId) + '::' +
                   String(joinPeriod || '') + '::' +
                   String(field);
        }

        // --------------------------------------------------------
        // Footer
        // --------------------------------------------------------

        function renderFooter() {
            var html = '';
            html += '<div class="form-actions member-manager-footer">';
            html += '<button type="button" class="secondary" ' +
                        'data-action="mm-revert">Revert</button>';
            html += '<button type="button" class="primary" ' +
                        'data-action="mm-save">Save</button>';
            html += '<button type="button" class="secondary" ' +
                        'data-action="mm-close">Close</button>';
            html += '</div>';
            return html;
        }

        // --------------------------------------------------------
        // Event binding
        // --------------------------------------------------------

        function bindEvents() {
            if (clickHandler) {
                container.removeEventListener('click', clickHandler);
            }
            if (blurHandler) {
                container.removeEventListener('blur', blurHandler, true);
            }
            if (keydownHandler) {
                container.removeEventListener('keydown', keydownHandler);
            }

            clickHandler = function(e) {
                handleClick(e);
            };
            blurHandler = function(e) {
                handleBlur(e);
            };
            keydownHandler = function(e) {
                handleKeydown(e);
            };

            container.addEventListener('click', clickHandler);
            container.addEventListener('blur', blurHandler, true);
            container.addEventListener('keydown', keydownHandler);
        }

        function handleClick(e) {
            var target = e.target;

            // ---- Click on a Join or Leave span → edit in place ----
            var boundSpan = target.closest
                ? target.closest('.member-join, .member-leave')
                : null;
            if (boundSpan &&
                boundSpan.dataset &&
                boundSpan.dataset.field) {
                e.preventDefault();
                openInlineEditor(boundSpan);
                return;
            }

            // ---- Click on an action button ----
            var actionEl = target.closest
                ? target.closest('[data-action]')
                : null;
            if (!actionEl || !actionEl.dataset) { return; }

            var action = actionEl.dataset.action;
            switch (action) {
                case 'mm-close':
                    e.preventDefault();
                    close();
                    return;
                case 'mm-save':
                    e.preventDefault();
                    handleSave();
                    return;
                case 'mm-revert':
                    e.preventDefault();
                    handleRevert();
                    return;
                case 'mm-add':
                    e.preventDefault();
                    handleAdd();
                    return;
                case 'mm-rejoin':
                    e.preventDefault();
                    handleRejoin(actionEl);
                    return;
                case 'mm-remove-stint':
                    e.preventDefault();
                    handleRemoveStint(actionEl);
                    return;
                case 'mm-remove-member':
                    e.preventDefault();
                    handleRemoveMember(actionEl);
                    return;
                default:
                    return;
            }
        }

        function handleBlur(e) {
            var target = e.target;
            if (!target) { return; }

            // ---- Inline period input losing focus → commit ----
            if (target.classList &&
                target.classList.contains('member-inline-input')) {
                commitInlineEditor(target);
            }
        }

        function handleKeydown(e) {
            var target = e.target;
            if (!target) { return; }

            // ---- Enter → commit. Escape → cancel. ----
            if (target.classList &&
                target.classList.contains('member-inline-input')) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    commitInlineEditor(target);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelInlineEditor(target);
                }
            }
        }

        // --------------------------------------------------------
        // Inline period editor
        // --------------------------------------------------------

        function openInlineEditor(span) {
            // Only one inline editor at a time.
            var existing = container.querySelector('.member-inline-input');
            if (existing) {
                commitInlineEditor(existing);
            }

            var field = span.dataset.field;
            var value = span.dataset.value || '';
            var row = span.closest('.member-stint-row');
            if (!row) { return; }

            var charId = row.dataset.characterId || '';
            var joinPeriod = row.dataset.joinPeriod || '';

            var input = document.createElement('input');
            input.type = 'number';
            input.className = 'member-inline-input';
            input.min = String(MIN_PERIOD);
            input.value = value;
            input.dataset.characterId = charId;
            input.dataset.joinPeriod = joinPeriod;
            input.dataset.field = field;
            input.dataset.originalValue = value;

            span.textContent = '';
            span.appendChild(input);
            span.classList.add('member-join-editing');

            // Focus and select.
            setTimeout(function() {
                try {
                    input.focus();
                    input.select();
                } catch (e) {}
            }, 0);
        }

        function commitInlineEditor(input) {
            if (!input || !input.parentNode) { return; }

            var raw = input.value;
            var field = input.dataset.field;
            var charId = input.dataset.characterId || '';
            var joinPeriod = input.dataset.joinPeriod || '';
            var originalValue = input.dataset.originalValue || '';
            var span = input.closest('.member-join, .member-leave');
            if (!span) { return; }

            var parsed = parsePeriodStrict(raw, true);
            if (!parsed.ok) {
                notify(
                    'Period must be blank or a positive integer.',
                    'error'
                );
                input.value = originalValue;
                // Re-render just this span.
                restoreSpanDisplay(span, field, originalValue);
                return;
            }

            var newValue = parsed.value;

            // Validate order when both bounds are present.
            var row = input.closest('.member-stint-row');
            if (row) {
                var joinSpan = row.querySelector('.member-join');
                var leaveSpan = row.querySelector('.member-leave');
                var currentJoin = joinSpan
                    ? (joinSpan.dataset.value || '')
                    : '';
                var currentLeave = leaveSpan
                    ? (leaveSpan.dataset.value || '')
                    : '';

                var checkJoin = (field === 'join') ? newValue : currentJoin;
                var checkLeave = (field === 'leave') ? newValue : currentLeave;

                if (checkJoin !== '' && checkLeave !== '') {
                    var jn = parseInt(checkJoin, 10);
                    var lv = parseInt(checkLeave, 10);
                    if (!isNaN(jn) && !isNaN(lv) && lv < jn) {
                        notify(
                            'Leave cannot be before Join (' + lv +
                            ' < ' + jn + ').',
                            'error'
                        );
                        input.value = originalValue;
                        restoreSpanDisplay(span, field, originalValue);
                        return;
                    }
                }
            }

            // Record the dirty value.
            var key = dirtyKey(charId, joinPeriod, field);
            if (newValue === originalValue) {
                // Reverted to the original. Clear any previous dirty.
                delete dirtyPeriods[key];
            } else {
                dirtyPeriods[key] = newValue;
            }

            span.dataset.value = newValue;
            restoreSpanDisplay(span, field, newValue);
        }

        function cancelInlineEditor(input) {
            if (!input || !input.parentNode) { return; }
            var span = input.closest('.member-join, .member-leave');
            if (!span) { return; }
            var field = input.dataset.field;
            var originalValue = input.dataset.originalValue || '';
            restoreSpanDisplay(span, field, originalValue);
        }

        function restoreSpanDisplay(span, field, value) {
            span.textContent = '';
            span.classList.remove('member-join-editing');
            var label = (field === 'join') ? 'Join: ' : 'Leave: ';
            var display = (value === '') ? '\u2014' : value;
            span.appendChild(document.createTextNode(label));
            span.appendChild(document.createTextNode(display));
        }

        // --------------------------------------------------------
        // Role edits (per member)
        // --------------------------------------------------------

        function commitRoleChange(input) {
            var charId = input.dataset.characterId || '';
            if (charId === '') { return; }
            var value = input.value;
            if (value === '') {
                delete dirtyRoles[charId];
            } else {
                dirtyRoles[charId] = value;
            }
        }

        // --------------------------------------------------------
        // Actions
        // --------------------------------------------------------

        function handleAdd() {
            var select = container.querySelector('.member-form-select');
            var roleInput = container.querySelector('.member-form-role');
            var joinInput = container.querySelector('.member-form-join');
            var leaveInput = container.querySelector('.member-form-leave');

            var charId = select ? select.value : '';
            if (!charId) {
                notify('Select a character to add.', 'error');
                return;
            }

            var role = roleInput ? roleInput.value.trim() : '';

            var joinParsed = parsePeriodStrict(
                joinInput ? joinInput.value : '', false
            );
            if (!joinParsed.ok) {
                notify('Join is required (positive integer).', 'error');
                return;
            }

            var leaveParsed = parsePeriodStrict(
                leaveInput ? leaveInput.value : '', true
            );
            if (!leaveParsed.ok) {
                notify(
                    'Leave must be blank or a positive integer.',
                    'error'
                );
                return;
            }

            if (leaveParsed.value !== '' &&
                parseInt(leaveParsed.value, 10) <
                parseInt(joinParsed.value, 10)) {
                notify('Leave cannot be before Join.', 'error');
                return;
            }

            adapter.addMember(teamId, period, {
                charId: charId,
                role: role,
                join: joinParsed.value,
                leave: leaveParsed.value
            }).then(function(result) {
                if (result && result.success) {
                    render();
                } else if (result && result.message) {
                    notify(result.message, 'error');
                }
            }).catch(function(err) {
                console.warn('[MemberManager] addMember failed:', err);
                notify('Failed to add member.', 'error');
            });
        }

        function handleRejoin(btn) {
            var charId = btn.dataset.characterId;
            var joinPeriod = btn.dataset.joinPeriod || '';
            var memberId = btn.dataset.memberId || '';

            if (!charId) { return; }

            var identifier = buildIdentifier(
                charId, memberId, joinPeriod
            );

            adapter.rejoinStint(teamId, period, identifier)
                .then(function(result) {
                    if (result && result.success) {
                        // Clear any dirty Leave for this row; the
                        // rejoin has just overwritten it server-side.
                        delete dirtyPeriods[dirtyKey(
                            charId, joinPeriod, 'leave'
                        )];
                        render();
                    } else if (result && result.message) {
                        notify(result.message, 'error');
                    }
                })
                .catch(function(err) {
                    console.warn('[MemberManager] rejoinStint failed:', err);
                    notify('Failed to rejoin.', 'error');
                });
        }

        function handleRemoveStint(btn) {
            var charId = btn.dataset.characterId;
            var joinPeriod = btn.dataset.joinPeriod || '';
            var memberId = btn.dataset.memberId || '';

            if (!charId) { return; }

            // Determine whether this is the member's last stint. If
            // so, warn the user that removing it removes the member.
            var member = findMemberVM(charId);
            var stintCount = member && Array.isArray(member.intervals)
                ? member.intervals.length
                : 0;

            var message = (stintCount <= 1)
                ? 'Remove this stint? It is the member\'s only stint, ' +
                  'so the member will be removed from the team.'
                : 'Remove this stint?';

            if (!confirm(message)) { return; }

            var identifier = buildIdentifier(
                charId, memberId, joinPeriod
            );

            adapter.removeStint(teamId, period, identifier)
                .then(function(result) {
                    if (result && result.success) {
                        clearDirtyForStint(charId, joinPeriod);
                        render();
                    } else if (result && result.message) {
                        notify(result.message, 'error');
                    }
                })
                .catch(function(err) {
                    console.warn('[MemberManager] removeStint failed:', err);
                    notify('Failed to remove stint.', 'error');
                });
        }

        function handleRemoveMember(btn) {
            var charId = btn.dataset.characterId;
            if (!charId) { return; }

            if (!confirm(
                'Remove this member entirely (all stints)?'
            )) {
                return;
            }

            adapter.removeMember(teamId, period, charId)
                .then(function(result) {
                    if (result && result.success) {
                        clearAllDirtyForChar(charId);
                        render();
                    } else if (result && result.message) {
                        notify(result.message, 'error');
                    }
                })
                .catch(function(err) {
                    console.warn('[MemberManager] removeMember failed:', err);
                    notify('Failed to remove member.', 'error');
                });
        }

        function handleSave() {
            // Commit any in-progress role inputs (blur may not have
            // fired if the user clicked Save directly).
            var roleInputs = container.querySelectorAll(
                '[data-role="mm-role-input"]'
            );
            for (var r = 0; r < roleInputs.length; r++) {
                var roleInput = roleInputs[r];
                if (roleInput.dataset.characterId) {
                    var charId = roleInput.dataset.characterId;
                    var value = roleInput.value;
                    var member = findMemberVM(charId);
                    var originalRole = member ? (member.role || '') : '';
                    if (value === originalRole) {
                        delete dirtyRoles[charId];
                    } else {
                        dirtyRoles[charId] = value;
                    }
                }
            }

            // Commit any in-progress period input.
            var openInput = container.querySelector('.member-inline-input');
            if (openInput) {
                commitInlineEditor(openInput);
            }

            // Build the change list from the dirty sets.
            var changes = [];
            var changeIndex = Object.create(null);

            function ensureChange(charId, joinPeriod) {
                var key = String(charId) + '::' + String(joinPeriod || '');
                if (!changeIndex[key]) {
                    changeIndex[key] = {
                        characterId: charId,
                        joinPeriod: joinPeriod,
                        role: undefined,
                        join: undefined,
                        leave: undefined
                    };
                    changes.push(changeIndex[key]);
                }
                return changeIndex[key];
            }

            // Roles.
            var roleKeys = Object.keys(dirtyRoles);
            for (var i = 0; i < roleKeys.length; i++) {
                var rc = roleKeys[i];
                // Find the member's "primary" join to attach the
                // role to. The adapter routes role changes
                // member-scoped, so any non-empty join works.
                var primaryJoin = findPrimaryJoinForChar(rc);
                var entry = ensureChange(rc, primaryJoin);
                entry.role = dirtyRoles[rc];
            }

            // Periods.
            var periodKeys = Object.keys(dirtyPeriods);
            for (var j = 0; j < periodKeys.length; j++) {
                var pk = periodKeys[j];
                var parts = pk.split('::');
                var charIdP = parts[0];
                var joinP = parts[1];
                var field = parts[2];
                var entryP = ensureChange(charIdP, joinP);
                if (field === 'join') {
                    entryP.join = dirtyPeriods[pk];
                } else if (field === 'leave') {
                    entryP.leave = dirtyPeriods[pk];
                }
            }

            if (changes.length === 0) {
                notify('No changes to save.', 'info');
                return;
            }

            adapter.updateMembers(teamId, period, changes)
                .then(function(result) {
                    if (result && result.success) {
                        dirtyRoles = Object.create(null);
                        dirtyPeriods = Object.create(null);
                        render();
                    } else if (result && result.message) {
                        notify(result.message, 'error');
                    }
                })
                .catch(function(err) {
                    console.warn('[MemberManager] updateMembers failed:', err);
                    notify('Failed to save changes.', 'error');
                });
        }

        function handleRevert() {
            dirtyRoles = Object.create(null);
            dirtyPeriods = Object.create(null);
            render();
        }

        // --------------------------------------------------------
        // Small lookups on the current VM
        // --------------------------------------------------------

        function findMemberVM(charId) {
            if (!currentVM) { return null; }
            var target = String(charId);

            var m = currentVM.members || [];
            for (var i = 0; i < m.length; i++) {
                if (String(m[i].characterId) === target) {
                    return m[i];
                }
            }

            var f = currentVM.formerMembers || [];
            for (var j = 0; j < f.length; j++) {
                if (String(f[j].characterId) === target) {
                    return f[j];
                }
            }
            return null;
        }

        function findPrimaryJoinForChar(charId) {
            var member = findMemberVM(charId);
            if (!member || !Array.isArray(member.intervals) ||
                member.intervals.length === 0) {
                return '';
            }
            var iv = member.intervals[0];
            return (iv.joinPeriod === undefined || iv.joinPeriod === null)
                ? ''
                : String(iv.joinPeriod);
        }

        function buildIdentifier(charId, memberId, joinPeriod) {
            if (joinPeriod !== '') {
                return { characterId: charId, joinPeriod: joinPeriod };
            }
            if (memberId !== '') {
                return memberId;
            }
            return { characterId: charId, joinPeriod: '' };
        }

        function clearDirtyForStint(charId, joinPeriod) {
            delete dirtyPeriods[dirtyKey(charId, joinPeriod, 'join')];
            delete dirtyPeriods[dirtyKey(charId, joinPeriod, 'leave')];
        }

        function clearAllDirtyForChar(charId) {
            var keys = Object.keys(dirtyPeriods);
            for (var i = 0; i < keys.length; i++) {
                if (keys[i].indexOf(String(charId) + '::') === 0) {
                    delete dirtyPeriods[keys[i]];
                }
            }
            delete dirtyRoles[String(charId)];
        }

        // --------------------------------------------------------
        // Lifecycle
        // --------------------------------------------------------

        function close() {
            if (disposed) { return; }
            disposed = true;

            if (clickHandler) {
                container.removeEventListener('click', clickHandler);
            }
            if (blurHandler) {
                container.removeEventListener('blur', blurHandler, true);
            }
            if (keydownHandler) {
                container.removeEventListener('keydown', keydownHandler);
            }

            clickHandler = null;
            blurHandler = null;
            keydownHandler = null;

            try { onClose(); } catch (e) {
                console.warn('[MemberManager] onClose threw:', e);
            }
        }

        function isOpen() {
            return !disposed && !!container.parentNode;
        }

        // ---- Kickoff ----
        render();

        return {
            refresh: render,
            close: close,
            isOpen: isOpen
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MemberManager = Object.freeze({
        open: open
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.MemberManager;
        var missing = [];

        if (typeof exports.open !== 'function') {
            missing.push('open');
        }

        if (missing.length > 0) {
            console.warn(
                '[MemberManager] Verification - some exports may be ' +
                'missing:', missing.join(', ')
            );
        }
    })();

})();