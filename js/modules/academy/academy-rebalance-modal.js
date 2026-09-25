/**
 * modules/academy/academy-rebalance-modal.js
 * Academy Rebalance Modal
 *
 * Path: js/modules/academy/academy-rebalance-modal.js
 *
 * The modal that lets a user run a rebalance plan for a discipline
 * and apply it.
 *
 * WHAT THIS MODULE OWNS:
 *   - The modal shell and its content.
 *   - The form: target size, instructor filter, rebalance scope.
 *   - Reading the aggregator's rebalance-input VM.
 *   - Running AcademyBalanceSuggestions.suggest with that input.
 *   - Rendering the result: summary, before/after table,
 *     unplaceable list.
 *   - Calling AcademySchedule.applyRebalancePlan on Apply.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - The algorithm         (AcademyBalanceSuggestions)
 *   - The input VM          (AcademyAggregator.getRebalanceInputViewModel)
 *   - The apply mutation    (AcademySchedule.applyRebalancePlan)
 *   - Group records         (AcademyTeachingGroups)
 *   - Session records       (AcademyTeachingSessions)
 *   - The discipline view   (AcademyDisciplineView)
 *   - The controller        (AcademyDisciplineController)
 *
 * FLOW:
 *   On open, the modal builds the input VM once. It does NOT run
 *   the algorithm until the user clicks "Run." Every subsequent
 *   Run re-uses the cached VM (the underlying data has not
 *   changed since the modal opened).
 *
 *   The form is ALWAYS visible at the top. The result section is
 *   BELOW it and is REPLACED on every Run. This is a "stateless
 *   form with a replaceable result" model, not a wizard.
 *
 * SCOPE:
 *   The scope selector is one of:
 *     'all'      — rebalance every group of the discipline, using
 *                  the whole enrolled student pool. Default.
 *     'local'    — rebalance only the groups of a specific
 *                  instructor, using only the students currently
 *                  active in those groups.
 *
 *   When scope is 'local', an instructor must be selected. The
 *   selector is disabled until an instructor is chosen.
 *
 *   When the instructor filter is not "All instructors," the
 *   result summary carries a "N students change instructor"
 *   count, so a cross-instructor move is visible before Apply.
 *
 * TARGET SIZE:
 *   The target size input defaults to a computed value: the
 *   total eligible student count divided by the number of groups
 *   the plan will consider, rounded to the nearest integer, with
 *   a floor of 2 (a group of 1 is not a group; a group of 0 is
 *   not useful as a target). The user can override it.
 *
 *   The default recomputes when the instructor filter changes,
 *   because the group count changes. Once the user types in the
 *   field, the value is treated as user-supplied and is not
 *   recomputed.
 *
 *   "Eligible" here means: every student in the input VM's
 *   students array. The input VM excludes instructors and
 *   respects excludedStudentIds; see the aggregator's header.
 *
 * UNAVAILABLE OCCUPANCIES:
 *   The input VM carries `unavailableStudentCount`. When it is
 *   above zero, the modal renders a warning above the form:
 *   "N students have no schedule data for this week; the plan
 *   treats them as having no commitments." The user can still
 *   run, but they are told.
 *
 *   This matters: if the projector failed for a student, the
 *   algorithm cannot detect that student's collisions. Presenting
 *   that as a silent fact would be dishonest.
 *
 * APPLY:
 *   On Apply, calls:
 *
 *     AcademySchedule.applyRebalancePlan(classId, disciplineId,
 *       week, plan)
 *
 *   On success, closes the modal and calls onClose. The caller
 *   refreshes the grid.
 *
 *   On failure, notifies and keeps the modal open.
 *
 *   Apply is disabled unless:
 *     - a plan exists
 *     - plan.ok is true
 *     - the plan's summary.unplaceableCount is zero OR the user
 *       has confirmed the partial apply
 *     - no apply is in flight
 *
 *   A partial plan (some students unplaceable) is applied only
 *   after a confirm() naming how many students remain unplaced.
 *
 * ASYNC SAFETY:
 *   Every asynchronous callback captures the current
 *   `_sessionToken`. A new modal opened (or the current one
 *   closed) before the callback runs makes the callback a no-op.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.AcademyAggregator
 *   - window.AcademyBalanceSuggestions
 *   - window.AcademySchedule
 *   - window.CharacterQueries
 */

(function() {
    'use strict';

    if (window.__academyRebalanceModalLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var DomUtils = window.DomUtils;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;
    var AcademyAggregator = window.AcademyAggregator;
    var AcademyBalanceSuggestions = window.AcademyBalanceSuggestions;
    var AcademySchedule = window.AcademySchedule;
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
    if (!AcademyAggregator ||
        typeof AcademyAggregator.getRebalanceInputViewModel !== 'function') {
        _missing.push('AcademyAggregator.getRebalanceInputViewModel');
    }
    if (!AcademyBalanceSuggestions ||
        typeof AcademyBalanceSuggestions.suggest !== 'function') {
        _missing.push('AcademyBalanceSuggestions.suggest');
    }
    if (!AcademySchedule ||
        typeof AcademySchedule.applyRebalancePlan !== 'function') {
        _missing.push('AcademySchedule.applyRebalancePlan');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function' ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries API');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyRebalanceModal] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyRebalanceModalLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MIN_TARGET_SIZE = 2;
    var MAX_TARGET_SIZE = 100;

    var SCOPE_ALL = 'all';
    var SCOPE_LOCAL = 'local';

    var VALID_SCOPES = [SCOPE_ALL, SCOPE_LOCAL];

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _modal = null;
    var _contentEl = null;
    var _context = null;
    var _onClose = null;

    var _contentClickHandler = null;
    var _contentChangeHandler = null;
    var _contentInputHandler = null;

    var _sessionToken = 0;

    // The input VM, built on open. Cached for the modal's lifetime.
    // The underlying data does not change while the modal is open.
    var _inputVM = null;

    // Form state.
    //   targetSize        integer >= MIN_TARGET_SIZE
    //   targetSizeTouched boolean; true once the user edits the
    //                     field. When false, the default recomputes
    //                     on instructor-filter change.
    //   instructorId      '' for all, or a specific instructor
    //   scope             'all' | 'local'
    var _form = {
        targetSize: 0,
        targetSizeTouched: false,
        instructorId: '',
        scope: SCOPE_ALL
    };

    // The current plan, or null when no Run has succeeded.
    var _plan = null;

    // An error string when the last Run failed to produce a plan.
    var _planError = null;

    // Apply in flight.
    var _busy = false;

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
        return _busy === true;
    }

    // ============================================================
    // DERIVED STATE
    // ============================================================
    //
    // Helpers that read the input VM and the current form to
    // produce values the renderer needs.

    /**
     * The list of distinct instructors that own at least one group
     * in the input VM. Each entry is { id, name }. Sorted by name.
     */
    function getInstructorsFromVM() {
        if (!_inputVM || !Array.isArray(_inputVM.groups)) { return []; }

        var seen = Object.create(null);
        var result = [];

        for (var i = 0; i < _inputVM.groups.length; i++) {
            var g = _inputVM.groups[i];
            if (!g || !isNonEmptyString(g.instructorId)) { continue; }
            var id = String(g.instructorId);
            if (seen[id]) { continue; }
            seen[id] = true;
            result.push({
                id: id,
                name: isNonEmptyString(g.instructorName)
                    ? g.instructorName
                    : id
            });
        }

        result.sort(function(a, b) {
            return a.name.localeCompare(b.name);
        });

        return result;
    }

    /**
     * The groups the current form will consider.
     *
     * scope 'all': every group in the input VM.
     * scope 'local': only the groups whose instructorId matches
     *                _form.instructorId.
     *
     * When scope is 'local' and _form.instructorId is '', returns
     * [].
     */
    function getGroupsForCurrentScope() {
        if (!_inputVM || !Array.isArray(_inputVM.groups)) { return []; }

        if (_form.scope === SCOPE_LOCAL) {
            if (!isNonEmptyString(_form.instructorId)) { return []; }
            var target = String(_form.instructorId);
            var result = [];
            for (var i = 0; i < _inputVM.groups.length; i++) {
                var g = _inputVM.groups[i];
                if (g && String(g.instructorId) === target) {
                    result.push(g);
                }
            }
            return result;
        }

        return _inputVM.groups.slice();
    }

    /**
     * The students the current form will consider.
     *
     * scope 'all': every student in the input VM.
     * scope 'local': only the students who are currently active
     *                in a group that belongs to the selected
     *                instructor.
     *
     * When scope is 'local' and _form.instructorId is '', returns
     * [].
     */
    function getStudentsForCurrentScope() {
        if (!_inputVM || !Array.isArray(_inputVM.students)) { return []; }

        if (_form.scope !== SCOPE_LOCAL) {
            return _inputVM.students.slice();
        }

        if (!isNonEmptyString(_form.instructorId)) { return []; }

        var targetInstructor = String(_form.instructorId);

        // Build the set of group IDs owned by this instructor.
        var instructorGroupIds = Object.create(null);
        if (Array.isArray(_inputVM.groups)) {
            for (var gi = 0; gi < _inputVM.groups.length; gi++) {
                var grp = _inputVM.groups[gi];
                if (!grp) { continue; }
                if (String(grp.instructorId) === targetInstructor) {
                    instructorGroupIds[String(grp.groupId)] = true;
                }
            }
        }

        var result = [];
        for (var si = 0; si < _inputVM.students.length; si++) {
            var s = _inputVM.students[si];
            if (!s) { continue; }
            if (s.currentGroupId === null ||
                s.currentGroupId === undefined ||
                s.currentGroupId === '') {
                continue;
            }
            if (instructorGroupIds[String(s.currentGroupId)] === true) {
                result.push(s);
            }
        }

        return result;
    }

    /**
     * Compute the default target size for the current scope.
     *
     * Rounds the ratio of eligible students to groups. Floors at
     * MIN_TARGET_SIZE. When either side is zero, returns
     * MIN_TARGET_SIZE.
     */
    function computeDefaultTargetSize() {
        var groups = getGroupsForCurrentScope();
        var students = getStudentsForCurrentScope();

        var groupCount = groups.length;
        var studentCount = students.length;

        if (groupCount <= 0 || studentCount <= 0) {
            return MIN_TARGET_SIZE;
        }

        var raw = Math.round(studentCount / groupCount);
        if (raw < MIN_TARGET_SIZE) { return MIN_TARGET_SIZE; }
        if (raw > MAX_TARGET_SIZE) { return MAX_TARGET_SIZE; }
        return raw;
    }

    /**
     * Return the students in `_inputVM.students` whose
     * `currentGroupId` belongs to an instructor different from
     * `_form.instructorId`, given the current scope.
     *
     * Used only to compute "students who will change instructor."
     */
    function countCrossInstructorMovesForPlan(plan) {
        if (!plan || !Array.isArray(plan.assignments)) { return 0; }
        if (!_inputVM || !Array.isArray(_inputVM.students)) { return 0; }

        // When the instructor filter is All, cross-instructor
        // moves are not a meaningful concept: every group is in
        // scope. Return 0 and skip.
        if (_form.scope !== SCOPE_LOCAL ||
            !isNonEmptyString(_form.instructorId)) {
            return 0;
        }

        // Build a lookup: groupId -> instructorId, from the VM.
        var groupInstructorById = Object.create(null);
        if (Array.isArray(_inputVM.groups)) {
            for (var gi = 0; gi < _inputVM.groups.length; gi++) {
                var grp = _inputVM.groups[gi];
                if (!grp) { continue; }
                groupInstructorById[String(grp.groupId)] =
                    isNonEmptyString(grp.instructorId)
                        ? String(grp.instructorId)
                        : null;
            }
        }

        // Build a lookup: studentId -> currentGroupId.
        var studentCurrentGroup = Object.create(null);
        for (var si = 0; si < _inputVM.students.length; si++) {
            var s = _inputVM.students[si];
            if (!s) { continue; }
            studentCurrentGroup[String(s.id)] =
                isNonEmptyString(s.currentGroupId)
                    ? String(s.currentGroupId)
                    : null;
        }

        var targetInstructor = String(_form.instructorId);
        var count = 0;

        for (var ai = 0; ai < plan.assignments.length; ai++) {
            var a = plan.assignments[ai];
            if (!a || !Array.isArray(a.proposedMemberIds)) { continue; }

            var proposedGroupId = String(a.groupId);
            var proposedInstructorId =
                groupInstructorById[proposedGroupId] || null;

            for (var mi = 0; mi < a.proposedMemberIds.length; mi++) {
                var memberId = String(a.proposedMemberIds[mi]);
                var currentGroupId =
                    studentCurrentGroup[memberId] || null;

                if (currentGroupId === null) { continue; }

                var currentInstructorId =
                    groupInstructorById[currentGroupId] || null;

                if (currentInstructorId !== proposedInstructorId) {
                    count++;
                }
            }
        }

        void targetInstructor;
        return count;
    }

    // ============================================================
    // ENTRY POINT
    // ============================================================

    /**
     * Open the rebalance modal.
     *
     * @param {object} options
     * @param {string} options.classId        Required.
     * @param {string} options.disciplineId   Required.
     * @param {number} options.week           Required.
     * @param {function} [options.onClose]    Called once when the
     *                                        modal closes.
     * @returns {object|null} The modal element, or null on failure.
     */
    function openModal(options) {
        if (!options || typeof options !== 'object') {
            notify('Invalid rebalance request.', 'error');
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

        var week = parseInt(options.week, 10);
        if (isNaN(week)) {
            notify('Valid week is required.', 'error');
            return null;
        }

        // Build the input VM before opening. If it cannot be built,
        // refuse to open. A modal with no data is worse than a
        // clear error.
        var inputVM = null;
        try {
            inputVM = AcademyAggregator.getRebalanceInputViewModel(
                options.classId,
                options.disciplineId,
                week,
                {}
            );
        } catch (e) {
            console.warn(
                '[AcademyRebalanceModal] ' +
                'getRebalanceInputViewModel threw:', e
            );
            notify(
                'Could not load rebalance data. Check the console.',
                'error'
            );
            return null;
        }

        if (!inputVM) {
            notify(
                'Could not load rebalance data for this discipline.',
                'error'
            );
            return null;
        }

        if (inputVM.groupCount === 0) {
            notify(
                'No teaching groups exist for this discipline. ' +
                'Create groups first.',
                'info'
            );
            return null;
        }

        if (inputVM.studentCount === 0) {
            notify(
                'No students are enrolled in this discipline for ' +
                'this class.',
                'info'
            );
            return null;
        }

        closeModal();

        _context = {
            classId: String(options.classId),
            disciplineId: String(options.disciplineId),
            week: week
        };
        _onClose = typeof options.onClose === 'function'
            ? options.onClose
            : null;

        _inputVM = inputVM;

        _form = {
            targetSize: 0,
            targetSizeTouched: false,
            instructorId: '',
            scope: SCOPE_ALL
        };
        _form.targetSize = computeDefaultTargetSize();

        _plan = null;
        _planError = null;
        _busy = false;

        _sessionToken++;
        var myToken = _sessionToken;

        var shell = Modal.createModal('academy-rebalance-modal');
        if (!shell) {
            notify('Failed to create modal.', 'error');
            resetState();
            return null;
        }
        shell.id = 'academy-rebalance-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content wide';
        shell.appendChild(contentEl);

        _modal = shell;
        _contentEl = contentEl;

        _contentClickHandler = function(e) {
            handleContentClick(e, myToken);
        };
        _contentChangeHandler = function(e) {
            handleContentChange(e, myToken);
        };
        _contentInputHandler = function(e) {
            handleContentInput(e, myToken);
        };

        contentEl.addEventListener('click', _contentClickHandler);
        contentEl.addEventListener('change', _contentChangeHandler);
        contentEl.addEventListener('input', _contentInputHandler);

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
        if (contentEl && _contentInputHandler) {
            try {
                contentEl.removeEventListener(
                    'input', _contentInputHandler
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
                    '[AcademyRebalanceModal] onClose threw:', e
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
        _contentInputHandler = null;
        _inputVM = null;
        _form = {
            targetSize: 0,
            targetSizeTouched: false,
            instructorId: '',
            scope: SCOPE_ALL
        };
        _plan = null;
        _planError = null;
        _busy = false;
    }

    // ============================================================
    // RENDER
    // ============================================================

    function renderContent() {
        if (!_contentEl || !_inputVM) { return; }
        _contentEl.innerHTML = buildModalHTML();
    }

    function buildModalHTML() {
        var html = '';

        // ---- Header ----
        html += '<div class="modal-header">';
        html += '<h3>Rebalance Groups \u2014 ' +
                    escapeHtml(_inputVM.disciplineName) +
                '</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-rebalance-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        // ---- Body ----
        html += '<div class="modal-body academy-rebalance-body">';

        html += renderUnavailableWarning();

        html += renderForm();

        if (_planError !== null) {
            html += renderPlanError();
        } else if (_plan !== null) {
            html += renderResult(_plan);
        } else {
            html += renderEmptyResult();
        }

        html += '</div>';

        // ---- Footer ----
        html += renderFooter();

        return html;
    }

    // ============================================================
    // FORM
    // ============================================================

    function renderForm() {
        var instructors = getInstructorsFromVM();
        var scopedGroups = getGroupsForCurrentScope();
        var scopedStudents = getStudentsForCurrentScope();

        var html = '';
        html += '<div class="academy-rebalance-form">';

        // ---- Row 1: instructor filter + scope ----

        html += '<div class="academy-rebalance-form-row">';

        // Instructor
        html += '<div class="academy-rebalance-field">';
        html += '<label class="academy-rebalance-label" ' +
                    'for="academy-rebalance-instructor">' +
                    'Instructor' +
                '</label>';
        html += '<select id="academy-rebalance-instructor" ' +
                    'class="academy-rebalance-instructor"' +
                    (isBusy() ? ' disabled' : '') + '>';
        html += '<option value="">All instructors</option>';
        for (var i = 0; i < instructors.length; i++) {
            var inst = instructors[i];
            var selected = String(inst.id) ===
                String(_form.instructorId) ? ' selected' : '';
            html += '<option value="' + escapeAttribute(inst.id) + '"' +
                        selected + '>' +
                        escapeHtml(inst.name) +
                    '</option>';
        }
        html += '</select>';
        html += '</div>';

        // Scope
        var scopeDisabled = !isNonEmptyString(_form.instructorId) ||
            isBusy();

        html += '<div class="academy-rebalance-field">';
        html += '<label class="academy-rebalance-label">' +
                    'Rebalance using' +
                '</label>';
        html += '<div class="academy-rebalance-scope-options">';

        html += '<label class="academy-rebalance-radio-label">';
        html += '<input type="radio" name="academy-rebalance-scope" ' +
                    'class="academy-rebalance-scope" ' +
                    'value="' + SCOPE_ALL + '"' +
                    (_form.scope === SCOPE_ALL ? ' checked' : '') +
                    (isBusy() ? ' disabled' : '') + '>';
        html += '<span>All students</span>';
        html += '</label>';

        html += '<label class="academy-rebalance-radio-label">';
        html += '<input type="radio" name="academy-rebalance-scope" ' +
                    'class="academy-rebalance-scope" ' +
                    'value="' + SCOPE_LOCAL + '"' +
                    (_form.scope === SCOPE_LOCAL ? ' checked' : '') +
                    (scopeDisabled ? ' disabled' : '') + '>';
        html += '<span>Only this instructor\'s students</span>';
        html += '</label>';

        html += '</div>';
        html += '<p class="field-hint">' +
                    '"Only this instructor\'s students" requires an ' +
                    'instructor filter.' +
                '</p>';
        html += '</div>';

        html += '</div>';

        // ---- Row 2: target size + Run ----

        html += '<div class="academy-rebalance-form-row">';

        html += '<div class="academy-rebalance-field">';
        html += '<label class="academy-rebalance-label" ' +
                    'for="academy-rebalance-target">' +
                    'Target size per group' +
                '</label>';
        html += '<input type="number" ' +
                    'id="academy-rebalance-target" ' +
                    'class="academy-rebalance-target" ' +
                    'min="' + MIN_TARGET_SIZE + '" ' +
                    'max="' + MAX_TARGET_SIZE + '" ' +
                    'value="' + escapeAttribute(
                        String(_form.targetSize)
                    ) + '"' +
                    (isBusy() ? ' disabled' : '') + '>';
        html += '</div>';

        html += '<div class="academy-rebalance-field ' +
                    'academy-rebalance-field-actions">';
        html += '<button type="button" class="primary" ' +
                    'data-rebalance-action="run"' +
                    (isBusy() ? ' disabled' : '') + '>' +
                    'Run' +
                '</button>';
        html += '</div>';

        html += '</div>';

        // ---- Context line ----

        var groupCount = scopedGroups.length;
        var studentCount = scopedStudents.length;

        html += '<p class="academy-rebalance-context">';
        html += 'Will consider <strong>' + studentCount +
                    '</strong> student' +
                    (studentCount === 1 ? '' : 's') +
                    ' across <strong>' + groupCount +
                    '</strong> group' +
                    (groupCount === 1 ? '' : 's') + '.';
        html += '</p>';

        html += '</div>';
        return html;
    }

    function renderUnavailableWarning() {
        if (!_inputVM) { return ''; }
        var n = _inputVM.unavailableStudentCount;
        if (typeof n !== 'number' || n <= 0) { return ''; }

        var html = '';
        html += '<div class="academy-rebalance-warning">';
        html += '<span class="academy-rebalance-warning-icon">' +
                    '\u26a0' +
                '</span>';
        html += '<span class="academy-rebalance-warning-text">' +
                    n + ' student' + (n === 1 ? '' : 's') +
                    ' have no schedule data for this week. The plan ' +
                    'treats them as having no commitments.' +
                '</span>';
        html += '</div>';
        return html;
    }

    function renderEmptyResult() {
        return (
            '<div class="academy-rebalance-empty">' +
                '<p class="empty-state small">' +
                    'Click <strong>Run</strong> to compute a plan. ' +
                    'Nothing is changed until you click Apply.' +
                '</p>' +
            '</div>'
        );
    }

    function renderPlanError() {
        return (
            '<div class="academy-rebalance-error">' +
                '<p>' + escapeHtml(_planError) + '</p>' +
            '</div>'
        );
    }

    // ============================================================
    // RESULT
    // ============================================================

    function renderResult(plan) {
        if (!plan || plan.ok !== true) { return renderPlanError(); }

        var html = '';

        html += renderResultSummary(plan);
        html += renderBeforeAfterTable(plan);

        if (plan.unplaceable && plan.unplaceable.length > 0) {
            html += renderUnplaceableSection(plan);
        }

        return html;
    }

    function renderResultSummary(plan) {
        var summary = plan.summary;
        var crossInstructorMoves =
            countCrossInstructorMovesForPlan(plan);

        var html = '';
        html += '<div class="academy-rebalance-summary">';

        html += '<div class="academy-rebalance-summary-line">';
        html += '<span class="academy-rebalance-summary-item">' +
                    '<strong>' + summary.placedCount + '</strong> ' +
                    'placed' +
                '</span>';

        if (summary.unplaceableCount > 0) {
            html += '<span class="academy-rebalance-summary-item ' +
                        'academy-rebalance-summary-warning">' +
                        '<strong>' + summary.unplaceableCount +
                        '</strong> unplaceable' +
                    '</span>';
        }

        html += '<span class="academy-rebalance-summary-item">' +
                    'Deviation from target: ' +
                    '<strong>' + summary.sumSquaredDeviation +
                    '</strong> (squared)' +
                '</span>';

        html += '<span class="academy-rebalance-summary-item">' +
                    'Group sizes: ' +
                    summary.minGroupSize + ' to ' +
                    summary.maxGroupSize +
                '</span>';

        html += '</div>';

        if (crossInstructorMoves > 0) {
            html += '<div class="academy-rebalance-summary-cross">' +
                        crossInstructorMoves + ' student' +
                        (crossInstructorMoves === 1 ? '' : 's') +
                        ' change instructor.' +
                    '</div>';
        }

        html += '</div>';
        return html;
    }

    function renderBeforeAfterTable(plan) {
        // Build a map from groupId to the "before" state (from the
        // input VM) and from groupId to the "after" state (from
        // the plan).
        var beforeById = Object.create(null);
        if (_inputVM && Array.isArray(_inputVM.groups)) {
            for (var i = 0; i < _inputVM.groups.length; i++) {
                var g = _inputVM.groups[i];
                if (!g) { continue; }
                beforeById[String(g.groupId)] = {
                    displayName: g.displayName,
                    instructorName: g.instructorName,
                    memberCount: g.memberCount
                };
            }
        }

        var rows = [];

        for (var ai = 0; ai < plan.assignments.length; ai++) {
            var a = plan.assignments[ai];
            if (!a) { continue; }
            var gid = String(a.groupId);
            var before = beforeById[gid] || null;
            if (!before) { continue; }

            rows.push({
                groupId: gid,
                displayName: before.displayName,
                instructorName: before.instructorName,
                before: before.memberCount,
                after: a.proposedSize,
                delta: a.proposedSize - before.memberCount
            });
        }

        rows.sort(function(a, b) {
            return a.displayName.localeCompare(b.displayName);
        });

        var html = '';
        html += '<div class="academy-rebalance-table-wrapper">';
        html += '<table class="academy-rebalance-table">';
        html += '<thead>';
        html += '<tr>';
        html += '<th>Group</th>';
        html += '<th>Instructor</th>';
        html += '<th class="num">Before</th>';
        html += '<th class="num">After</th>';
        html += '<th class="num">Change</th>';
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';

        for (var ri = 0; ri < rows.length; ri++) {
            var r = rows[ri];
            var deltaClass = 'num';
            var deltaText = '';
            if (r.delta > 0) {
                deltaClass += ' academy-rebalance-delta-positive';
                deltaText = '+' + r.delta;
            } else if (r.delta < 0) {
                deltaClass += ' academy-rebalance-delta-negative';
                deltaText = String(r.delta);
            } else {
                deltaText = '0';
            }

            html += '<tr>';
            html += '<td>' + escapeHtml(r.displayName) + '</td>';
            html += '<td>' +
                        escapeHtml(
                            isNonEmptyString(r.instructorName)
                                ? r.instructorName
                                : '\u2014'
                        ) +
                    '</td>';
            html += '<td class="num">' + r.before + '</td>';
            html += '<td class="num">' + r.after + '</td>';
            html += '<td class="' + deltaClass + '">' +
                        escapeHtml(deltaText) +
                    '</td>';
            html += '</tr>';
        }

        html += '</tbody>';
        html += '</table>';
        html += '</div>';

        return html;
    }

    function renderUnplaceableSection(plan) {
        var count = plan.unplaceable.length;

        var html = '';
        html += '<div class="academy-rebalance-unplaceable">';

        html += '<button type="button" ' +
                    'class="academy-rebalance-unplaceable-toggle" ' +
                    'data-rebalance-action="toggle-unplaceable">';
        html += '<span class="academy-rebalance-unplaceable-caret">' +
                    '\u25b8' +
                '</span>';
        html += '<span class="academy-rebalance-unplaceable-title">' +
                    count + ' student' +
                    (count === 1 ? '' : 's') +
                    ' could not be placed' +
                '</span>';
        html += '</button>';

        html += '<div class="academy-rebalance-unplaceable-body" ' +
                    'style="display:none;">';
        html += '<ul class="academy-rebalance-unplaceable-list">';

        for (var i = 0; i < plan.unplaceable.length; i++) {
            var u = plan.unplaceable[i];
            if (!u) { continue; }
            var name = getStudentName(String(u.studentId));
            html += '<li>' +
                        escapeHtml(name) +
                        ' <span class="academy-rebalance-unplaceable-reason">' +
                            escapeHtml(describeUnplaceableReason(u.reason)) +
                        '</span>' +
                    '</li>';
        }

        html += '</ul>';
        html += '</div>';
        html += '</div>';
        return html;
    }

    function describeUnplaceableReason(reason) {
        if (reason === 'no-non-colliding-group') {
            return 'Every group has a session that conflicts with ' +
                'their schedule.';
        }
        return reason || 'Unknown reason.';
    }

    function getStudentName(studentId) {
        if (!isNonEmptyString(studentId)) { return 'Unknown'; }

        // Try the input VM first; it already has the name.
        if (_inputVM && Array.isArray(_inputVM.students)) {
            for (var i = 0; i < _inputVM.students.length; i++) {
                var s = _inputVM.students[i];
                if (s && String(s.id) === studentId) {
                    return s.name || 'Unknown';
                }
            }
        }

        // Fall back to CharacterQueries.
        var char = CharacterQueries.getCharacterById(studentId);
        if (char) {
            return CharacterQueries.getDisplayName(char) || 'Unknown';
        }

        return 'Unknown';
    }

    // ============================================================
    // FOOTER
    // ============================================================

    function renderFooter() {
        var applyDisabled = true;
        var applyLabel = 'Apply';

        if (_plan !== null && _plan.ok === true && !isBusy()) {
            applyDisabled = false;
        }
        if (isBusy()) {
            applyLabel = 'Applying\u2026';
        }

        var html = '';
        html += '<div class="modal-footer academy-rebalance-footer">';

        html += '<button type="button" class="secondary" ' +
                    'data-rebalance-action="close"' +
                    (isBusy() ? ' disabled' : '') + '>' +
                    'Cancel' +
                '</button>';

        html += '<button type="button" class="primary" ' +
                    'data-rebalance-action="apply"' +
                    (applyDisabled ? ' disabled' : '') + '>' +
                    escapeHtml(applyLabel) +
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

        var actionEl = target.closest('[data-rebalance-action]');
        if (!actionEl || !actionEl.dataset) { return; }

        var action = actionEl.dataset.rebalanceAction;

        if (action === 'close') {
            e.preventDefault();
            if (isBusy()) {
                notify('Wait for the apply to finish.', 'info');
                return;
            }
            closeModal();
            return;
        }

        if (action === 'run') {
            e.preventDefault();
            handleRun(myToken);
            return;
        }

        if (action === 'apply') {
            e.preventDefault();
            handleApply(myToken);
            return;
        }

        if (action === 'toggle-unplaceable') {
            e.preventDefault();
            handleToggleUnplaceable(actionEl);
            return;
        }
    }

    function handleContentChange(e, myToken) {
        if (myToken !== _sessionToken) { return; }
        if (isBusy()) { return; }

        var target = e.target;
        if (!target) { return; }

        if (target.classList &&
            target.classList.contains(
                'academy-rebalance-instructor'
            )) {
            _form.instructorId = target.value || '';

            // When the instructor filter changes, the scope
            // selector's availability may change. If local scope
            // is selected but the instructor was cleared, drop
            // back to 'all'.
            if (_form.scope === SCOPE_LOCAL &&
                !isNonEmptyString(_form.instructorId)) {
                _form.scope = SCOPE_ALL;
            }

            // Recompute the default target size if the user has
            // not touched the field.
            if (!_form.targetSizeTouched) {
                _form.targetSize = computeDefaultTargetSize();
            }

            // Any change invalidates the current plan.
            _plan = null;
            _planError = null;

            renderContent();
            return;
        }

        if (target.classList &&
            target.classList.contains('academy-rebalance-scope')) {
            var value = target.value;
            if (VALID_SCOPES.indexOf(value) === -1) { return; }

            _form.scope = value;

            if (!_form.targetSizeTouched) {
                _form.targetSize = computeDefaultTargetSize();
            }

            _plan = null;
            _planError = null;

            renderContent();
            return;
        }
    }

    function handleContentInput(e, myToken) {
        if (myToken !== _sessionToken) { return; }
        if (isBusy()) { return; }

        var target = e.target;
        if (!target) { return; }

        if (target.classList &&
            target.classList.contains('academy-rebalance-target')) {
            _form.targetSizeTouched = true;

            var parsed = parseInt(target.value, 10);
            if (!isNaN(parsed)) {
                _form.targetSize = parsed;
            }
            // Do not re-render on input; that would steal focus.
            // The value is read at Run time.
            return;
        }
    }

    function handleToggleUnplaceable(buttonEl) {
        if (!buttonEl || typeof buttonEl.closest !== 'function') {
            return;
        }

        var block = buttonEl.closest('.academy-rebalance-unplaceable');
        if (!block) { return; }

        var body = block.querySelector(
            '.academy-rebalance-unplaceable-body'
        );
        if (!body) { return; }

        var visible = body.style.display !== 'none';
        body.style.display = visible ? 'none' : 'block';

        var caret = buttonEl.querySelector(
            '.academy-rebalance-unplaceable-caret'
        );
        if (caret) {
            caret.textContent = visible ? '\u25b8' : '\u25be';
        }
    }

    // ============================================================
    // RUN
    // ============================================================

    function handleRun(myToken) {
        if (!_context || !_inputVM) { return; }
        if (isBusy()) { return; }

        // Read the target size fresh, in case the user typed and
        // did not blur.
        if (_contentEl && typeof _contentEl.querySelector === 'function') {
            var targetInput = _contentEl.querySelector(
                '.academy-rebalance-target'
            );
            if (targetInput) {
                var parsed = parseInt(targetInput.value, 10);
                if (!isNaN(parsed)) {
                    _form.targetSize = parsed;
                }
            }
        }

        // Validate the target size.
        var targetSize = _form.targetSize;
        if (typeof targetSize !== 'number' ||
            !isFinite(targetSize) ||
            !Number.isInteger(targetSize) ||
            targetSize < MIN_TARGET_SIZE ||
            targetSize > MAX_TARGET_SIZE) {
            _plan = null;
            _planError =
                'Target size must be an integer between ' +
                MIN_TARGET_SIZE + ' and ' + MAX_TARGET_SIZE + '.';
            renderContent();
            return;
        }

        var scopedGroups = getGroupsForCurrentScope();
        var scopedStudents = getStudentsForCurrentScope();

        if (scopedGroups.length === 0) {
            _plan = null;
            _planError = 'No groups match the current filter.';
            renderContent();
            return;
        }

        if (scopedStudents.length === 0) {
            _plan = null;
            _planError = 'No students match the current filter.';
            renderContent();
            return;
        }

        // Build the algorithm's input.
        //
        // When the instructor filter is set, restrict the groups to
        // that instructor's groups. When the scope is 'local',
        // restrict the students too.
        //
        // The algorithm itself reads only `students` and `groups`.
        // The presentation metadata (name, instructorName) is
        // ignored by the algorithm.

        var students = [];
        for (var si = 0; si < scopedStudents.length; si++) {
            var s = scopedStudents[si];
            if (!s) { continue; }
            students.push({
                id: s.id,
                occupied: Array.isArray(s.occupied) ? s.occupied : []
            });
        }

        var groups = [];
        for (var gi = 0; gi < scopedGroups.length; gi++) {
            var g = scopedGroups[gi];
            if (!g) { continue; }
            groups.push({
                groupId: g.groupId,
                sessions: Array.isArray(g.sessions) ? g.sessions : []
            });
        }

        var plan = null;
        try {
            plan = AcademyBalanceSuggestions.suggest({
                students: students,
                groups: groups,
                targetSize: targetSize
            });
        } catch (e) {
            console.warn(
                '[AcademyRebalanceModal] suggest threw:', e
            );
            _plan = null;
            _planError =
                'The algorithm failed to produce a plan. ' +
                'See the console for details.';
            renderContent();
            return;
        }

        if (!plan || plan.ok !== true) {
            _plan = null;
            _planError = (plan && plan.reason)
                ? plan.reason
                : 'The algorithm could not produce a plan.';
            renderContent();
            return;
        }

        _plan = plan;
        _planError = null;
        renderContent();

        void myToken;
    }

    // ============================================================
    // APPLY
    // ============================================================

    function handleApply(myToken) {
        if (!_context || !_plan) { return; }
        if (isBusy()) { return; }

        if (_plan.ok !== true) {
            notify('The plan is not applicable.', 'error');
            return;
        }

        var unplaceableCount = (_plan.summary &&
            typeof _plan.summary.unplaceableCount === 'number')
            ? _plan.summary.unplaceableCount
            : 0;

        if (unplaceableCount > 0) {
            var msg = unplaceableCount + ' student' +
                (unplaceableCount === 1 ? '' : 's') +
                ' could not be placed and will not be assigned to ' +
                'any group by this plan. They remain where they are.\n\n' +
                'Apply the partial plan anyway?';
            if (!confirm(msg)) {
                return;
            }
        }

        _busy = true;
        renderContent();

        AcademySchedule.applyRebalancePlan(
            _context.classId,
            _context.disciplineId,
            _context.week,
            _plan
        ).then(function(result) {
            if (myToken !== _sessionToken) { return; }
            _busy = false;

            if (result && result.success) {
                notify('Rebalance applied.', 'success');
                closeModal();
                return;
            }

            var failMsg = (result && result.message)
                ? result.message
                : 'Failed to apply the rebalance plan.';
            notify(failMsg, 'error');
            renderContent();
        }).catch(function(err) {
            if (myToken !== _sessionToken) { return; }
            _busy = false;
            console.warn(
                '[AcademyRebalanceModal] ' +
                'applyRebalancePlan threw:', err
            );
            notify(
                'Failed to apply the rebalance plan.',
                'error'
            );
            renderContent();
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyRebalanceModal = Object.freeze({
        openModal: openModal,
        closeModal: closeModal
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyRebalanceModal;
        var missing = [];

        var required = ['openModal', 'closeModal'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyRebalanceModal] Verification - some exports ' +
                'may be missing:', missing.join(', ')
            );
        }
    })();

})();
