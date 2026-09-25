/**
 * modules/academy/academy-group-management-modal.js
 * Academy Group Management Modal
 *
 * Path: js/modules/academy/academy-group-management-modal.js
 *
 * The modal that lets a user rename and renumber the teaching groups
 * of a discipline within a class.
 *
 * WHAT THIS MODULE OWNS:
 *   - The modal shell and its content.
 *   - Per-group rename (writes through AcademyTeachingGroups.setGroupCustomName).
 *   - Per-instructor renumber (writes through
 *     AcademyTeachingGroups.renumberTeachingGroups).
 *   - The "Renumber all instructors" bulk operation.
 *   - A live preview of what each group's display name will be
 *     after a rename, so the user sees the effect before blur.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - Group records         (AcademyTeachingGroups)
 *   - Group display names   (resolved here for preview only, using
 *                            the same rule the aggregator uses)
 *   - The sessions panel    (AcademyDisciplineSessionsPanel)
 *   - The discipline view   (AcademyDisciplineView)
 *   - The controller        (AcademyDisciplineController)
 *
 * SCOPE:
 *   A class and a discipline. Every instructor who has groups for
 *   that (class, discipline) pair appears in the modal, sorted by
 *   display name, with their groups under them.
 *
 *   Renumber operates per-instructor, because the group-number
 *   sequence is keyed by (classId, disciplineId, instructorId).
 *   Renumbering instructor A does not affect instructor B's
 *   numbers.
 *
 *   The "Renumber all instructors" button loops the per-instructor
 *   operation across every instructor present, in instructor-name
 *   order. It is not a single transaction; each instructor's
 *   renumber is its own pipeline call. A failure on one instructor
 *   is reported and the loop continues. See PARTIAL SUCCESS below.
 *
 * DISPLAY NAME RULE:
 *   A group's display name is:
 *     customName when set
 *     otherwise `${discipline.name} ${letterFromNumber(groupNumber)}`
 *
 *   The modal shows the resolved display name next to the rename
 *   input, so the user sees what the group will be called. When
 *   customName is set, the resolved name IS the custom name. When
 *   the input is cleared, the resolved name falls back to the
 *   auto-generated form.
 *
 *   The letter rule (1 → A, 2 → B, ..., 27 → AA) matches
 *   AcademyCalendarAggregator's letterFromNumber exactly. It is
 *   duplicated here rather than imported because the aggregator
 *   does not export it, and pulling it in would mean depending on
 *   the aggregator from a modal, which is not a dependency this
 *   modal should carry.
 *
 *   If you later export letterFromNumber from a shared module, the
 *   local copy here can be deleted.
 *
 * RENAME SEMANTICS:
 *   The rename input is a text field per group. On blur (or on
 *   Enter), the field's value is trimmed and compared to the
 *   current customName. If unchanged, nothing happens. If changed,
 *   setGroupCustomName is called. An empty value clears customName
 *   (the group reverts to the auto-generated name).
 *
 *   The input is NOT required. Clearing it is a valid operation.
 *
 *   While a rename is in flight, the field for that group is
 *   disabled and shows a subtle busy state. Other groups remain
 *   interactive.
 *
 * RENUMBER SEMANTICS:
 *   The "Renumber" button on an instructor's heading triggers
 *   renumberTeachingGroups for that (class, discipline, instructor)
 *   triple. On success, the whole modal refetches and re-renders.
 *
 *   The button is disabled while a renumber is in flight for that
 *   instructor. Other instructors remain interactive.
 *
 * PARTIAL SUCCESS:
 *   "Renumber all instructors" runs a sequential chain. Every
 *   instructor's renumber is a separate pipeline call. Failures are
 *   collected and reported at the end; successes are kept. This
 *   matches the pattern used by the candidate picker's bulk add.
 *
 *   While the bulk is running, `_bulkBusy` is true and all
 *   interactive controls in the modal render disabled.
 *
 * ASYNC SAFETY:
 *   Every asynchronous callback captures the current `_sessionToken`.
 *   A new modal opened (or the current one closed) before the
 *   callback runs makes the callback a no-op.
 *
 * MODAL SHAPE:
 *   Header: "Manage Groups — {disciplineName}"
 *   Body:
 *     Per instructor:
 *       - a heading: instructor name + group count + "Renumber"
 *         button
 *       - a list of group rows:
 *           groupNumber badge
 *           rename input (customName)
 *           resolved display name preview
 *           member count (read-only)
 *           session count (read-only)
 *     Empty state: no groups for this discipline in this class.
 *   Footer:
 *     - "Renumber all instructors" (primary; disabled when fewer
 *       than two instructors have groups, or when any operation is
 *       in flight)
 *     - "Close"
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.AcademyTeachingGroups
 *   - window.AcademyTeachingSessions
 *   - window.AcademyDisciplines
 *   - window.AcademyClasses
 *   - window.CharacterQueries
 */

(function() {
    'use strict';

    if (window.__academyGroupManagementModalLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var DomUtils = window.DomUtils;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;
    var AcademyTeachingGroups = window.AcademyTeachingGroups;
    var AcademyTeachingSessions = window.AcademyTeachingSessions;
    var AcademyDisciplines = window.AcademyDisciplines;
    var AcademyClasses = window.AcademyClasses;
    var CharacterQueries = window.CharacterQueries;

    var _missing = [];

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        _missing.push('DomUtils.escapeHtml/escapeAttribute');
    }
    if (!Modal ||
        typeof Modal.createModal !== 'function' ||
        typeof Modal.showModal !== 'function' ||
        typeof Modal.closeModal !== 'function' ||
        typeof Modal.modalSetup !== 'function') {
        _missing.push('Modal API');
    }
    if (!NotificationSystem ||
        typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }
    if (!AcademyTeachingGroups ||
        typeof AcademyTeachingGroups.getGroupsForDiscipline !== 'function' ||
        typeof AcademyTeachingGroups.setGroupCustomName !== 'function' ||
        typeof AcademyTeachingGroups.renumberTeachingGroups !== 'function') {
        _missing.push('AcademyTeachingGroups API');
    }
    if (!AcademyTeachingSessions ||
        typeof AcademyTeachingSessions.getSessionsForGroup !== 'function') {
        _missing.push('AcademyTeachingSessions.getSessionsForGroup');
    }
    if (!AcademyDisciplines ||
        typeof AcademyDisciplines.getDiscipline !== 'function') {
        _missing.push('AcademyDisciplines.getDiscipline');
    }
    if (!AcademyClasses ||
        typeof AcademyClasses.getClass !== 'function') {
        _missing.push('AcademyClasses.getClass');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function' ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries API');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyGroupManagementModal] Missing mandatory ' +
            'dependencies: ' + _missing.join(', ')
        );
    }

    window.__academyGroupManagementModalLoaded = true;

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _modal = null;
    var _contentEl = null;
    var _context = null;
    var _onClose = null;

    var _contentClickHandler = null;
    var _contentChangeHandler = null;
    var _contentKeydownHandler = null;
    var _contentBlurHandler = null;

    var _sessionToken = 0;

    // Busy flags.
    //   _bulkBusy  — the "Renumber all instructors" chain is running
    //   _busyGroupIds  — Set-like object of groupIds whose rename is
    //                    in flight
    //   _busyInstructorIds — Set-like object of instructorIds whose
    //                        renumber is in flight
    var _bulkBusy = false;
    var _busyGroupIds = Object.create(null);
    var _busyInstructorIds = Object.create(null);

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    function isBusy() {
        if (_bulkBusy) { return true; }
        if (Object.keys(_busyGroupIds).length > 0) { return true; }
        if (Object.keys(_busyInstructorIds).length > 0) { return true; }
        return false;
    }

    /**
     * Letter for a group number: 1 → A, 26 → Z, 27 → AA, ...
     *
     * Matches AcademyCalendarAggregator's letterFromNumber. Kept
     * local so this modal does not depend on the aggregator. See
     * the file header.
     */
    function letterFromNumber(n) {
        var num = parseInt(n, 10);
        if (isNaN(num) || num < 1) {
            return '';
        }
        var result = '';
        while (num > 0) {
            var rem = (num - 1) % 26;
            result = String.fromCharCode(65 + rem) + result;
            num = Math.floor((num - 1) / 26);
        }
        return result;
    }

    function getCharacterName(charId) {
        if (!isNonEmptyString(charId)) { return 'Unknown'; }
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) { return 'Unknown'; }
        return CharacterQueries.getDisplayName(char) || 'Unknown';
    }

    function resolveDisplayName(group, disciplineName) {
        if (!group) { return 'Unnamed Group'; }

        if (isNonEmptyString(group.customName)) {
            return String(group.customName).trim();
        }

        var base = isNonEmptyString(disciplineName)
            ? disciplineName
            : 'Group';

        var num = (typeof group.groupNumber === 'number' &&
                   isFinite(group.groupNumber) &&
                   group.groupNumber > 0)
            ? Math.floor(group.groupNumber)
            : 0;

        var letter = letterFromNumber(num);
        if (letter !== '') {
            return base + ' ' + letter;
        }
        return base;
    }

    // ============================================================
    // VIEW MODEL
    // ============================================================
    //
    // Groups are fetched for the (class, discipline) pair, then
    // bucketed by instructorId. Every instructor with at least one
    // group appears.
    //
    // Within an instructor, groups are sorted by (groupNumber,
    // createdAt, id). Malformed group numbers sort last. Same rule
    // the renumber operation uses, so the modal's display order
    // matches the order renumber will produce.

    function buildViewModel() {
        if (!_context) { return null; }

        var discipline = AcademyDisciplines.getDiscipline(
            _context.disciplineId
        );
        if (!discipline) { return null; }

        var disciplineName = isNonEmptyString(discipline.name)
            ? discipline.name
            : 'Unnamed Discipline';

        var rawGroups = [];
        try {
            rawGroups = AcademyTeachingGroups.getGroupsForDiscipline(
                _context.classId,
                _context.disciplineId
            ) || [];
        } catch (e) {
            console.warn(
                '[AcademyGroupManagementModal] ' +
                'getGroupsForDiscipline threw:', e
            );
            rawGroups = [];
        }

        if (!Array.isArray(rawGroups)) { rawGroups = []; }

        // Bucket by instructor.
        var byInstructor = Object.create(null);
        var instructorOrder = [];

        for (var i = 0; i < rawGroups.length; i++) {
            var g = rawGroups[i];
            if (!g || !g.id) { continue; }
            var instructorId = isNonEmptyString(g.instructorId)
                ? String(g.instructorId)
                : '__unassigned__';
            if (!byInstructor[instructorId]) {
                byInstructor[instructorId] = [];
                instructorOrder.push(instructorId);
            }
            byInstructor[instructorId].push(g);
        }

        var instructorVMs = [];

        for (var k = 0; k < instructorOrder.length; k++) {
            var iid = instructorOrder[k];
            var groups = byInstructor[iid];

            groups.sort(function(a, b) {
                var aNum = (typeof a.groupNumber === 'number' &&
                            isFinite(a.groupNumber) &&
                            a.groupNumber > 0)
                    ? a.groupNumber
                    : null;
                var bNum = (typeof b.groupNumber === 'number' &&
                            isFinite(b.groupNumber) &&
                            b.groupNumber > 0)
                    ? b.groupNumber
                    : null;

                if (aNum !== null && bNum !== null && aNum !== bNum) {
                    return aNum - bNum;
                }
                if (aNum !== null && bNum === null) { return -1; }
                if (aNum === null && bNum !== null) { return 1; }

                var aCreated = isNonEmptyString(a.createdAt)
                    ? a.createdAt : '';
                var bCreated = isNonEmptyString(b.createdAt)
                    ? b.createdAt : '';
                if (aCreated !== bCreated) {
                    return aCreated < bCreated ? -1 : 1;
                }
                return String(a.id).localeCompare(String(b.id));
            });

            var groupVMs = [];
            for (var j = 0; j < groups.length; j++) {
                var group = groups[j];
                var memberCount = Array.isArray(group.members)
                    ? group.members.length
                    : 0;

                var sessionCount = 0;
                try {
                    var sessions = AcademyTeachingSessions
                        .getSessionsForGroup(group.id);
                    if (Array.isArray(sessions)) {
                        sessionCount = sessions.length;
                    }
                } catch (e) {
                    sessionCount = 0;
                }

                groupVMs.push({
                    groupId: String(group.id),
                    groupNumber: (typeof group.groupNumber === 'number' &&
                                  isFinite(group.groupNumber))
                        ? group.groupNumber
                        : null,
                    customName: isNonEmptyString(group.customName)
                        ? String(group.customName)
                        : '',
                    displayName: resolveDisplayName(group, disciplineName),
                    memberCount: memberCount,
                    sessionCount: sessionCount,
                    busy: _busyGroupIds[String(group.id)] === true
                });
            }

            var instructorName = (iid === '__unassigned__')
                ? 'Unassigned'
                : getCharacterName(iid);

            instructorVMs.push({
                instructorId: iid,
                instructorName: instructorName,
                groupCount: groupVMs.length,
                groups: groupVMs,
                busy: _busyInstructorIds[iid] === true,
                // "Renumber" is only available for real instructors.
                // The __unassigned__ bucket has no sequence to reset.
                canRenumber: iid !== '__unassigned__'
            });
        }

        instructorVMs.sort(function(a, b) {
            if (a.instructorId === '__unassigned__') { return 1; }
            if (b.instructorId === '__unassigned__') { return -1; }
            return a.instructorName.localeCompare(b.instructorName);
        });

        var totalGroups = 0;
        for (var t = 0; t < instructorVMs.length; t++) {
            totalGroups += instructorVMs[t].groupCount;
        }

        return {
            classId: _context.classId,
            disciplineId: _context.disciplineId,
            disciplineName: disciplineName,
            instructors: instructorVMs,
            instructorCount: instructorVMs.length,
            totalGroups: totalGroups,
            bulkBusy: _bulkBusy,
            canRenumberAll: instructorVMs.length >= 2
        };
    }

    // ============================================================
    // ENTRY POINT
    // ============================================================

    /**
     * Open the group management modal.
     *
     * @param {object} options
     * @param {string} options.classId        Required.
     * @param {string} options.disciplineId   Required.
     * @param {function} [options.onClose]    Called once when the
     *                                        modal closes.
     * @returns {object|null} The modal element, or null on failure.
     */
    function openModal(options) {
        if (!options || typeof options !== 'object') {
            notify('Invalid group management request.', 'error');
            return null;
        }

        if (!isNonEmptyString(options.classId)) {
            notify('Class ID is required.', 'error');
            return null;
        }
        if (!isNonEmptyString(options.disciplineId)) {
            notify('Discipline ID is required.', 'error');
            return null;
        }

        var cls = AcademyClasses.getClass(options.classId);
        if (!cls) {
            notify('Class not found.', 'error');
            return null;
        }

        var discipline = AcademyDisciplines.getDiscipline(
            options.disciplineId
        );
        if (!discipline) {
            notify('Discipline not found.', 'error');
            return null;
        }

        closeModal();

        _context = {
            classId: String(options.classId),
            disciplineId: String(options.disciplineId)
        };
        _onClose = typeof options.onClose === 'function'
            ? options.onClose
            : null;

        _bulkBusy = false;
        _busyGroupIds = Object.create(null);
        _busyInstructorIds = Object.create(null);

        _sessionToken++;
        var myToken = _sessionToken;

        var shell = Modal.createModal(
            'academy-group-management-modal'
        );
        if (!shell) {
            notify('Failed to create modal.', 'error');
            resetState();
            return null;
        }
        shell.id = 'academy-group-management-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        shell.appendChild(contentEl);

        _modal = shell;
        _contentEl = contentEl;

        _contentClickHandler = function(e) {
            handleContentClick(e, myToken);
        };
        _contentChangeHandler = function(e) {
            // Change events for the rename inputs are handled on
            // blur and keydown; the change event is a no-op here.
            // Kept as a no-op handler for symmetry; can be removed
            // if you prefer.
        };
        _contentKeydownHandler = function(e) {
            handleContentKeydown(e, myToken);
        };
        _contentBlurHandler = function(e) {
            handleContentBlur(e, myToken);
        };

        contentEl.addEventListener('click', _contentClickHandler);
        contentEl.addEventListener('change', _contentChangeHandler);
        contentEl.addEventListener('keydown', _contentKeydownHandler, true);
        contentEl.addEventListener('blur', _contentBlurHandler, true);

        renderContent();

        Modal.modalSetup(shell, function() {
            closeModal();
        });
        Modal.showModal(shell);

        return shell;
    }

    function closeModal() {
        var modal = _modal;
        var contentEl = _contentEl;
        var onClose = _onClose;

        if (contentEl && _contentClickHandler) {
            try {
                contentEl.removeEventListener(
                    'click', _contentClickHandler
                );
            } catch (e) { /* ignore */ }
        }
        if (contentEl && _contentChangeHandler) {
            try {
                contentEl.removeEventListener(
                    'change', _contentChangeHandler
                );
            } catch (e) { /* ignore */ }
        }
        if (contentEl && _contentKeydownHandler) {
            try {
                contentEl.removeEventListener(
                    'keydown', _contentKeydownHandler, true
                );
            } catch (e) { /* ignore */ }
        }
        if (contentEl && _contentBlurHandler) {
            try {
                contentEl.removeEventListener(
                    'blur', _contentBlurHandler, true
                );
            } catch (e) { /* ignore */ }
        }

        _sessionToken++;

        resetState();

        if (modal) {
            try {
                Modal.closeModal(modal);
            } catch (e) {
                // Ignore.
            }
        }

        if (onClose) {
            try {
                onClose();
            } catch (e) {
                console.warn(
                    '[AcademyGroupManagementModal] onClose threw:', e
                );
            }
        }
    }

    function resetState() {
        _modal = null;
        _contentEl = null;
        _context = null;
        _onClose = null;
        _contentClickHandler = null;
        _contentChangeHandler = null;
        _contentKeydownHandler = null;
        _contentBlurHandler = null;
        _bulkBusy = false;
        _busyGroupIds = Object.create(null);
        _busyInstructorIds = Object.create(null);
    }

    // ============================================================
    // RENDER
    // ============================================================

    function renderContent() {
        if (!_contentEl) { return; }
        var vm = buildViewModel();
        if (!vm) { return; }
        _contentEl.innerHTML = buildModalHTML(vm);
    }

    function buildModalHTML(vm) {
        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Manage Groups \u2014 ' +
                    escapeHtml(vm.disciplineName) +
                '</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-group-mgmt-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body academy-group-management-body">';

        if (vm.totalGroups === 0) {
            html += '<p class="empty-state small">' +
                        'No teaching groups exist for this discipline ' +
                        'in this class yet.' +
                    '</p>';
        } else {
            html += '<p class="academy-group-management-summary">' +
                        vm.totalGroups + ' group' +
                        (vm.totalGroups === 1 ? '' : 's') +
                        ' across ' +
                        vm.instructorCount + ' instructor' +
                        (vm.instructorCount === 1 ? '' : 's') +
                        '.' +
                    '</p>';

            for (var i = 0; i < vm.instructors.length; i++) {
                html += renderInstructorSection(
                    vm.instructors[i], vm.bulkBusy
                );
            }
        }

        html += '</div>';

        html += renderFooter(vm);

        return html;
    }

    function renderInstructorSection(instructor, bulkBusy) {
        var html = '';

        html += '<div class="academy-group-management-instructor" ' +
                    'data-instructor-id="' +
                        escapeAttribute(instructor.instructorId) + '">';

        // ---- Header ----
        html += '<div class="academy-group-management-instructor-header">';
        html += '<h4 class="academy-group-management-instructor-name">' +
                    escapeHtml(instructor.instructorName) +
                '</h4>';
        html += '<span class="academy-group-management-instructor-count">' +
                    instructor.groupCount + ' group' +
                    (instructor.groupCount === 1 ? '' : 's') +
                '</span>';

        if (instructor.canRenumber) {
            var renumberDisabled = (bulkBusy || instructor.busy)
                ? ' disabled'
                : '';
            var renumberLabel = instructor.busy
                ? 'Renumbering\u2026'
                : 'Renumber';
            html += '<button type="button" ' +
                        'class="small secondary ' +
                        'academy-group-management-renumber-btn" ' +
                        'data-group-mgmt-action="renumber-instructor" ' +
                        'data-instructor-id="' +
                            escapeAttribute(instructor.instructorId) + '"' +
                        renumberDisabled + '>' +
                        escapeHtml(renumberLabel) +
                    '</button>';
        }

        html += '</div>';

        // ---- Group rows ----
        html += '<div class="academy-group-management-group-list">';

        for (var i = 0; i < instructor.groups.length; i++) {
            html += renderGroupRow(
                instructor.groups[i],
                bulkBusy || instructor.busy
            );
        }

        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderGroupRow(group, instructorBusy) {
        var rowDisabled = group.busy || instructorBusy;
        var inputDisabled = rowDisabled ? ' disabled' : '';

        var numLabel = (group.groupNumber !== null)
            ? String(group.groupNumber)
            : '\u2014';

        var html = '';
        html += '<div class="academy-group-management-group-row" ' +
                    'data-group-id="' + escapeAttribute(group.groupId) + '">';

        // ---- Number badge ----
        html += '<span class="academy-group-management-number-badge">' +
                    escapeHtml(numLabel) +
                '</span>';

        // ---- Rename input ----
        html += '<input type="text" ' +
                    'class="academy-group-management-name-input" ' +
                    'data-group-id="' + escapeAttribute(group.groupId) + '" ' +
                    'value="' + escapeAttribute(group.customName) + '" ' +
                    'placeholder="' +
                        escapeAttribute(group.displayName) + '"' +
                    inputDisabled + '>';

        // ---- Resolved display preview ----
        html += '<span class="academy-group-management-display-preview" ' +
                    'data-group-id="' + escapeAttribute(group.groupId) + '">' +
                    escapeHtml(group.displayName) +
                '</span>';

        // ---- Meta ----
        html += '<span class="academy-group-management-meta">' +
                    group.memberCount + ' member' +
                    (group.memberCount === 1 ? '' : 's') +
                    ' \u00b7 ' +
                    group.sessionCount + ' session' +
                    (group.sessionCount === 1 ? '' : 's') +
                '</span>';

        html += '</div>';
        return html;
    }

    function renderFooter(vm) {
        var bulkDisabled = (vm.bulkBusy || isBusy()) ? ' disabled' : '';
        var canRenumberAll = vm.canRenumberAll;
        var renumberAllDisabled = (!canRenumberAll || vm.bulkBusy ||
            isBusy()) ? ' disabled' : '';

        var html = '';
        html += '<div class="modal-footer ' +
                    'academy-group-management-footer">';

        if (canRenumberAll) {
            html += '<button type="button" class="primary" ' +
                        'data-group-mgmt-action="renumber-all"' +
                        renumberAllDisabled + '>';
            html += vm.bulkBusy
                ? 'Renumbering\u2026'
                : 'Renumber All Instructors';
            html += '</button>';
        }

        html += '<button type="button" class="secondary" ' +
                    'data-group-mgmt-action="close"' +
                    bulkDisabled + '>' +
                    'Close' +
                '</button>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    function handleContentClick(e, myToken) {
        if (myToken !== _sessionToken) { return; }

        var target = e.target;
        if (!target || typeof target.closest !== 'function') {
            return;
        }

        var btn = target.closest('[data-group-mgmt-action]');
        if (!btn || !btn.dataset) { return; }

        var action = btn.dataset.groupMgmtAction;

        if (action === 'close') {
            e.preventDefault();
            if (isBusy()) {
                // Refuse to close mid-operation. A partial rename
                // or a partial renumber should not be interrupted by
                // a stray click on Close; the user can wait one
                // second.
                notify(
                    'Wait for the current operation to finish.',
                    'info'
                );
                return;
            }
            closeModal();
            return;
        }

        if (action === 'renumber-instructor') {
            e.preventDefault();
            handleRenumberInstructor(
                btn.dataset.instructorId, myToken
            );
            return;
        }

        if (action === 'renumber-all') {
            e.preventDefault();
            handleRenumberAll(myToken);
            return;
        }
    }

    function handleContentKeydown(e, myToken) {
        if (myToken !== _sessionToken) { return; }

        var target = e.target;
        if (!target || !target.classList) { return; }
        if (!target.classList.contains(
            'academy-group-management-name-input'
        )) {
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            commitRename(target, myToken);
            // Blur the input so the visual focus ring clears and
            // the user sees the committed state.
            if (typeof target.blur === 'function') {
                target.blur();
            }
            return;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            // Revert the input to its stored value.
            var groupId = target.dataset ? target.dataset.groupId : null;
            if (groupId && _contentEl) {
                var vm = buildViewModel();
                if (vm) {
                    var stored = findGroupVM(vm, groupId);
                    if (stored) {
                        target.value = stored.customName;
                    }
                }
            }
            if (typeof target.blur === 'function') {
                target.blur();
            }
            return;
        }
    }

    function handleContentBlur(e, myToken) {
        if (myToken !== _sessionToken) { return; }

        var target = e.target;
        if (!target || !target.classList) { return; }
        if (!target.classList.contains(
            'academy-group-management-name-input'
        )) {
            return;
        }

        commitRename(target, myToken);
    }

    function findGroupVM(vm, groupId) {
        for (var i = 0; i < vm.instructors.length; i++) {
            var groups = vm.instructors[i].groups;
            for (var j = 0; j < groups.length; j++) {
                if (groups[j].groupId === String(groupId)) {
                    return groups[j];
                }
            }
        }
        return null;
    }

    // ============================================================
    // RENAME
    // ============================================================
    //
    // On blur or Enter, compare the input's value to the group's
    // stored customName. If unchanged, no-op. Otherwise, call
    // setGroupCustomName.
    //
    // While the rename is in flight, the group's ID is added to
    // _busyGroupIds and the modal re-renders with that row disabled.
    //
    // On success, refetch and re-render. On failure, notify and
    // revert the input (via the refetch).

    function commitRename(inputEl, myToken) {
        if (!_context) { return; }
        if (!inputEl || !inputEl.dataset) { return; }

        var groupId = inputEl.dataset.groupId;
        if (!isNonEmptyString(groupId)) { return; }

        // If the group is busy (from a previous commit that has not
        // finished), do nothing — the second commit would race the
        // first.
        if (_busyGroupIds[String(groupId)] === true) { return; }

        // If a bulk is running, ignore. The whole modal is disabled
        // anyway, but a programmatic commit could still fire.
        if (_bulkBusy) { return; }

        // Read the current stored customName.
        var vm = buildViewModel();
        if (!vm) { return; }
        var storedVM = findGroupVM(vm, groupId);
        if (!storedVM) { return; }

        var inputValue = (typeof inputEl.value === 'string')
            ? inputEl.value.trim()
            : '';

        if (inputValue === storedVM.customName) {
            // No change. Return without a mutation. Do not notify.
            return;
        }

        // Mark busy and re-render. The re-render disables the field
        // but keeps the typed value visible via the input's current
        // value attribute... which the re-render overwrites. So we
        // stash the pending value and restore it in the render.
        var pending = inputValue;

        _busyGroupIds[String(groupId)] = true;
        renderContent();
        restorePendingInputValue(String(groupId), pending);

        var targetGroup = String(groupId);
        var targetValue = pending === '' ? null : pending;

        AcademyTeachingGroups.setGroupCustomName(
            targetGroup, targetValue
        ).then(function(result) {
            if (myToken !== _sessionToken) { return; }
            delete _busyGroupIds[targetGroup];

            if (result && result.success) {
                renderContent();
                return;
            }

            if (result && result.message) {
                notify(result.message, 'error');
            } else {
                notify('Failed to rename the group.', 'error');
            }
            renderContent();
        }).catch(function(err) {
            if (myToken !== _sessionToken) { return; }
            delete _busyGroupIds[targetGroup];
            console.warn(
                '[AcademyGroupManagementModal] ' +
                'setGroupCustomName threw:', err
            );
            notify('Failed to rename the group.', 'error');
            renderContent();
        });
    }

    /**
     * After a re-render, the input is rebuilt from the VM's
     * customName, which is the OLD value (the pipeline has not yet
     * committed). This helper restores the user's typed value so
     * the input does not visually snap back mid-operation.
     */
    function restorePendingInputValue(groupId, value) {
        if (!_contentEl || typeof _contentEl.querySelector !== 'function') {
            return;
        }
        var input = _contentEl.querySelector(
            '.academy-group-management-name-input' +
            '[data-group-id="' + cssEscapeLocal(groupId) + '"]'
        );
        if (input) {
            input.value = value;
        }
    }

    // ============================================================
    // RENUMBER — SINGLE INSTRUCTOR
    // ============================================================

    function handleRenumberInstructor(instructorId, myToken) {
        if (!_context) { return; }
        if (!isNonEmptyString(instructorId)) { return; }
        if (_bulkBusy) { return; }
        if (_busyInstructorIds[instructorId] === true) { return; }

        _busyInstructorIds[instructorId] = true;
        renderContent();

        AcademyTeachingGroups.renumberTeachingGroups(
            _context.classId,
            _context.disciplineId,
            instructorId
        ).then(function(result) {
            if (myToken !== _sessionToken) { return; }
            delete _busyInstructorIds[instructorId];

            if (result && result.success) {
                renderContent();
                return;
            }

            if (result && result.message) {
                notify(result.message, 'error');
            } else {
                notify('Failed to renumber groups.', 'error');
            }
            renderContent();
        }).catch(function(err) {
            if (myToken !== _sessionToken) { return; }
            delete _busyInstructorIds[instructorId];
            console.warn(
                '[AcademyGroupManagementModal] ' +
                'renumberTeachingGroups threw:', err
            );
            notify('Failed to renumber groups.', 'error');
            renderContent();
        });
    }

    // ============================================================
    // RENUMBER — ALL INSTRUCTORS
    // ============================================================
    //
    // Sequential chain. Each instructor's renumber is its own
    // pipeline transaction. Failures are collected; successes are
    // kept. This matches the pattern used by the candidate picker's
    // bulk add.

    function handleRenumberAll(myToken) {
        if (!_context) { return; }
        if (_bulkBusy) { return; }
        if (isBusy()) { return; }

        var vm = buildViewModel();
        if (!vm) { return; }

        // Only real instructors. Skip the __unassigned__ bucket.
        var instructorIds = [];
        for (var i = 0; i < vm.instructors.length; i++) {
            var inst = vm.instructors[i];
            if (!inst.canRenumber) { continue; }
            instructorIds.push(inst.instructorId);
        }

        if (instructorIds.length === 0) {
            notify('No instructors to renumber.', 'info');
            return;
        }

        _bulkBusy = true;
        renderContent();

        var classId = _context.classId;
        var disciplineId = _context.disciplineId;

        var succeeded = 0;
        var failures = [];
        var chain = Promise.resolve();

        instructorIds.forEach(function(instructorId) {
            chain = chain.then(function() {
                return AcademyTeachingGroups.renumberTeachingGroups(
                    classId, disciplineId, instructorId
                ).then(function(result) {
                    if (result && result.success) {
                        succeeded++;
                    } else {
                        failures.push({
                            instructorId: instructorId,
                            message: (result && result.message) ||
                                'Unknown error'
                        });
                    }
                }).catch(function(err) {
                    failures.push({
                        instructorId: instructorId,
                        message: String(
                            (err && err.message) || err
                        )
                    });
                });
            });
        });

        chain.then(function() {
            if (myToken !== _sessionToken) { return; }
            _bulkBusy = false;

            var total = succeeded + failures.length;

            if (failures.length === 0) {
                notify(
                    'Renumbered ' + succeeded + ' instructor' +
                    (succeeded === 1 ? '' : 's') + '.',
                    'success'
                );
            } else if (succeeded === 0) {
                notify(
                    'Could not renumber any of the ' + total +
                    ' instructors. See console for details.',
                    'error'
                );
            } else {
                notify(
                    'Renumbered ' + succeeded + ' of ' + total +
                    ' instructors. Some failed. See console for ' +
                    'details.',
                    'warning'
                );
            }

            for (var f = 0; f < failures.length; f++) {
                console.warn(
                    '[AcademyGroupManagementModal] renumber failure:',
                    failures[f]
                );
            }

            renderContent();
        });
    }

    // ============================================================
    // UTILITY
    // ============================================================

    function cssEscapeLocal(value) {
        if (typeof CSS !== 'undefined' &&
            typeof CSS.escape === 'function') {
            return CSS.escape(String(value));
        }
        return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyGroupManagementModal = Object.freeze({
        openModal: openModal,
        closeModal: closeModal
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyGroupManagementModal;
        var missing = [];

        var required = ['openModal', 'closeModal'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        try {
            if (letterFromNumber(1) !== 'A') {
                missing.push('letterFromNumber(1) !== A');
            }
            if (letterFromNumber(26) !== 'Z') {
                missing.push('letterFromNumber(26) !== Z');
            }
            if (letterFromNumber(27) !== 'AA') {
                missing.push('letterFromNumber(27) !== AA');
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyGroupManagementModal] Verification - some ' +
                'exports may be missing:', missing.join(', ')
            );
        }
    })();

})();
