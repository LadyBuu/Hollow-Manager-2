/**
 * modules/academy/academy-enrollment-modal.js
 * Academy Enrollment Modal
 *
 * Path: js/modules/academy/academy-enrollment-modal.js
 *
 * Modal for enrolling a character in one or more of a class's
 * offerings.
 *
 * WHAT THIS MODULE OWNS:
 *   The modal that lets a user say which disciplines a character
 *   is enrolled in for a class. The modal is opened from the
 *   character detail panel's "Enroll Discipline" button (student
 *   mode) or the instructor Disciplines tab's "+ Assign to teach"
 *   button (instructor mode).
 *
 *   Modal lifecycle:
 *     - Creates its own .modal shell, appended to document.body.
 *     - Reads its candidate list from
 *       AcademyClassDisciplinesQueries (the class's offerings) and
 *       AcademyDisciplines (names, start weeks), filtered against
 *       the character's existing enrolments via
 *       AcademyEnrolments.getStudentDisciplineIds.
 *     - Writes through AcademyEnrolments.enrol only.
 *     - Closes on Close button, backdrop click, Escape.
 *
 * WEEK SEMANTICS (this revision):
 *   Enrollment is a YEAR-LEVEL decision. The picker shows EVERY
 *   discipline the class offers, regardless of the display week.
 *   Switching the display week does NOT change the picker.
 *
 *   Each enrolment's startWeek is CLIPPED to the discipline's own
 *   startWeek:
 *
 *     enrolmentStartWeek = max(displayWeek, discipline.startWeek)
 *
 *   This keeps the enrolment interval honest: it never claims to
 *   cover weeks the discipline does not run. A discipline that
 *   starts in week 5, enrolled while the display week is 1, gets
 *   an enrolment whose startWeek is 5. AcademyEnrolments.isEnrolledInWeek
 *   returns true only from week 5 onward, matching the discipline's
 *   own window.
 *
 *   The matching READ side (isEnrolledInWeek) is unchanged; it
 *   already required the enrolment interval to contain the week.
 *   Clipping the startWeek on write is what makes the two agree.
 *
 *   This is the opposite treatment from the schedule-assign modal
 *   (academy-schedule-assign-modal.js), which IS week-scoped: a
 *   student cannot be scheduled into a slot for a discipline that
 *   does not run that week. Enrollment is a fact about the year;
 *   scheduling is a fact about the week.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - The enrolment store          (AcademyEnrolments)
 *   - The class-discipline markers (AcademyClassDisciplinesQueries
 *                                   for reads;
 *                                   AcademyClassDisciplines is the
 *                                   mutation module and is NOT a
 *                                   dependency of this file. This
 *                                   modal never writes markers.)
 *   - The discipline entities      (AcademyDisciplines)
 *   - The character record         (CharacterQueries)
 *   - The instructor-of-record for a student in a discipline.
 *     That relationship is a TEACHING-GROUP assignment, edited
 *     from the scheduling UI, not from this modal. See the
 *     DEFERRED-SCHEDULING section of the pinboard.
 *   - The character's mode. The modal is mode-agnostic. It writes
 *     an enrolment; whether the character is a student or an
 *     instructor is expressed by the character record and
 *     interpreted by the Academy UI. The modal does not branch on
 *     mode and does not know what mode means.
 *
 * PRESENTATION OVERRIDE (title):
 *   The modal accepts an optional `title` option. When supplied,
 *   the header reads "<title> — <charName>". When absent, the
 *   header reads "Enroll <charName> in a Discipline". This lets
 *   the instructor flow say "Assign to teach a discipline —
 *   Professor Jane" without teaching the modal what an
 *   instructor is.
 *
 *   The title is purely presentation. It does not affect the
 *   options list, the write path, or the bulk actions.
 *
 * MULTI-SELECT:
 *   The user can check several disciplines and enrol in all of
 *   them in one action. Each enrolment is an individual mutation
 *   via AcademyEnrolments.enrol, sequenced.
 *
 * ALL-MANDATORY BULK:
 *   A single "Enrol in all mandatory" button enrols the character
 *   in every discipline that is currently offered by the class
 *   with a per-class marker whose `mandatory` flag is true, and
 *   that the character is not yet enrolled in. The bulk respects
 *   the same startWeek-clipping rule as individual enrolments.
 *
 * PARTIAL SUCCESS:
 *   Individual enrolments that fail do not roll back the ones
 *   that succeeded. After the sequence completes, the modal
 *   reports a per-row failure summary and refetches its state.
 *   This matches the picker's bulk-operation contract.
 *
 * OFFERING WINDOW:
 *   An offering's window is the DISCIPLINE's window
 *   (startWeek / endWeek on the discipline entity). The marker has
 *   no window. The picker shows every offering, and each row's
 *   enrolment uses the discipline's startWeek as the floor for the
 *   enrolment's startWeek. This is the v27 marker-only semantics.
 *
 * START WEEK CLIPPING:
 *   The enrolment's startWeek is max(displayWeek, discipline.startWeek).
 *   A discipline without a valid startWeek (malformed record) is
 *   rejected for that row; the modal does not invent a value.
 *
 * CLASS-DISCIPLINE READS:
 *   The class-discipline marker store has two modules: a mutation
 *   module (AcademyClassDisciplines) and a read module
 *   (AcademyClassDisciplinesQueries). This modal reads through
 *   the read module. It never calls the mutation module; it does
 *   not create or remove markers, and it has no business reaching
 *   for a writer to answer a read question.
 *
 *   The three reads the modal performs are:
 *     - getClassDisciplinesForClass   (offering list)
 *     - getClassDiscipline            (per-class mandatory flag)
 *     - isActiveInWeek                (NOT USED for filtering in
 *                                      this revision; the marker's
 *                                      discipline window is read
 *                                      via AcademyDisciplines, not
 *                                      via the query. The query
 *                                      method remains available to
 *                                      other callers.)
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.AcademyUI
 *   - window.AcademyClassDisciplinesQueries
 *   - window.AcademyEnrolments
 *   - window.AcademyDisciplines
 *   - window.CharacterQueries
 *
 * USAGE:
 *   // Student enrollment
 *   AcademyEnrollmentModal.openModal(charId, {
 *       classId: 'class_123',
 *       week: 5,
 *       onClose: function() {
 *           // re-render the character detail panel
 *       }
 *   });
 *
 *   // Instructor assignment (presentation-only override)
 *   AcademyEnrollmentModal.openModal(charId, {
 *       classId: 'class_123',
 *       week: 5,
 *       title: 'Assign to teach a discipline',
 *       onClose: function() {
 *           // re-render the character detail panel
 *       }
 *   });
 */

(function() {
    'use strict';

    if (window.__academyEnrollmentModalLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var DomUtils = window.DomUtils;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;
    var AcademyUI = window.AcademyUI;
    var AcademyClassDisciplinesQueries =
        window.AcademyClassDisciplinesQueries;
    var AcademyEnrolments = window.AcademyEnrolments;
    var AcademyDisciplines = window.AcademyDisciplines;
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
    if (!AcademyUI || typeof AcademyUI.getDisplayWeek !== 'function') {
        _missing.push('AcademyUI.getDisplayWeek');
    }
    if (!AcademyClassDisciplinesQueries ||
        typeof AcademyClassDisciplinesQueries.getClassDisciplinesForClass !== 'function' ||
        typeof AcademyClassDisciplinesQueries.getClassDiscipline !== 'function') {
        _missing.push('AcademyClassDisciplinesQueries API');
    }
    if (!AcademyEnrolments ||
        typeof AcademyEnrolments.enrol !== 'function' ||
        typeof AcademyEnrolments.getStudentDisciplineIds !== 'function') {
        _missing.push('AcademyEnrolments API');
    }
    if (!AcademyDisciplines ||
        typeof AcademyDisciplines.getDiscipline !== 'function') {
        _missing.push('AcademyDisciplines.getDiscipline');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function' ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries API');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyEnrollmentModal] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyEnrollmentModalLoaded = true;

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _modal = null;
    var _contentEl = null;
    var _charId = null;
    var _classId = null;
    var _week = null;
    var _title = null;
    var _onClose = null;

    var _contentChangeHandler = null;
    var _contentClickHandler = null;

    // True while a bulk enrolment is running. Clicks that would
    // issue new mutations are ignored during the run; interactive
    // controls render disabled.
    var _busy = false;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isFiniteInteger(value) {
        return typeof value === 'number' &&
            isFinite(value) &&
            Number.isInteger(value) &&
            value > 0;
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    /**
     * Compute the enrolment's startWeek for a discipline.
     *
     *   effectiveStart = max(displayWeek, discipline.startWeek)
     *
     * A discipline without a valid startWeek is rejected by the
     * caller. This helper assumes the discipline's startWeek has
     * already been validated as a positive integer.
     */
    function computeEnrolmentStartWeek(displayWeek, disciplineStartWeek) {
        if (!isFiniteInteger(disciplineStartWeek)) {
            return displayWeek;
        }
        if (!isFiniteInteger(displayWeek)) {
            return disciplineStartWeek;
        }
        return Math.max(displayWeek, disciplineStartWeek);
    }

    // ============================================================
    // ENTRY POINT
    // ============================================================

    /**
     * Open the enrollment modal for a character in a class.
     *
     * @param {string} charId
     * @param {object} options
     * @param {string} options.classId     - required
     * @param {number} [options.week]      - display week; defaults
     *                                       to AcademyUI's current
     *                                       display week. Used as
     *                                       the floor for each
     *                                       enrolment's startWeek.
     * @param {string} [options.title]     - optional header title.
     *                                       When present, the header
     *                                       reads "<title> — <name>".
     *                                       When absent, the header
     *                                       reads "Enroll <name> in a
     *                                       Discipline". Purely
     *                                       presentational.
     * @param {function} [options.onClose] - called once, when the
     *                                       modal closes for any
     *                                       reason.
     * @returns {object|null} the modal element, or null on failure
     */
    function openModal(charId, options) {
        if (!isNonEmptyString(charId)) {
            notify('Character ID is required.', 'error');
            return null;
        }

        options = options || {};

        if (!isNonEmptyString(options.classId)) {
            notify('Class ID is required.', 'error');
            return null;
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            notify('Character not found.', 'error');
            return null;
        }

        var week = (typeof options.week === 'number' && isFinite(options.week))
            ? options.week
            : AcademyUI.getDisplayWeek();

        closeModal();

        _charId = String(charId);
        _classId = String(options.classId);
        _week = week;
        _title = isNonEmptyString(options.title)
            ? String(options.title)
            : null;
        _onClose = typeof options.onClose === 'function'
            ? options.onClose
            : null;
        _busy = false;

        var vm = buildViewModel();
        if (!vm) {
            notify('Could not build enrollment view.', 'error');
            resetState();
            return null;
        }

        var modal = Modal.createModal('academy-enrollment-modal');
        if (!modal) {
            notify('Failed to create modal.', 'error');
            resetState();
            return null;
        }
        modal.id = 'academy-enrollment-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content wide';
        modal.appendChild(contentEl);

        _modal = modal;
        _contentEl = contentEl;

        _contentChangeHandler = handleContentChange;
        _contentClickHandler = handleContentClick;
        contentEl.addEventListener('change', _contentChangeHandler);
        contentEl.addEventListener('click', _contentClickHandler);

        renderContent(vm);

        Modal.modalSetup(modal, function() {
            closeModal();
        });
        Modal.showModal(modal);

        return modal;
    }

    function closeModal() {
        var modal = _modal;
        var contentEl = _contentEl;
        var onClose = _onClose;

        if (contentEl && _contentChangeHandler) {
            try {
                contentEl.removeEventListener(
                    'change', _contentChangeHandler
                );
            } catch (e) { /* ignore */ }
        }
        if (contentEl && _contentClickHandler) {
            try {
                contentEl.removeEventListener(
                    'click', _contentClickHandler
                );
            } catch (e) { /* ignore */ }
        }

        _modal = null;
        _contentEl = null;
        _charId = null;
        _classId = null;
        _week = null;
        _title = null;
        _onClose = null;
        _contentChangeHandler = null;
        _contentClickHandler = null;
        _busy = false;

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
                    '[AcademyEnrollmentModal] onClose threw:', e
                );
            }
        }
    }

    function resetState() {
        _modal = null;
        _contentEl = null;
        _charId = null;
        _classId = null;
        _week = null;
        _title = null;
        _onClose = null;
        _contentChangeHandler = null;
        _contentClickHandler = null;
        _busy = false;
    }

    // ============================================================
    // VIEW MODEL
    // ============================================================
    //
    // Every offering the class has is listed, regardless of the
    // display week. Each row carries the discipline's startWeek so
    // the write path can clip the enrolment's startWeek to it.
    //
    // A discipline with a malformed startWeek is skipped: the
    // modal cannot compute a valid enrolment window for it, and
    // inventing one would silently lie about when the enrolment
    // begins.

    function buildViewModel() {
        if (!_charId || !_classId) {
            return null;
        }

        var char = CharacterQueries.getCharacterById(_charId);
        if (!char) {
            return null;
        }

        var charName = CharacterQueries.getDisplayName(char);

        var enrolledIds = [];
        try {
            enrolledIds = AcademyEnrolments.getStudentDisciplineIds(
                _charId, _classId
            ) || [];
        } catch (e) {
            enrolledIds = [];
        }

        var enrolledSet = Object.create(null);
        for (var e = 0; e < enrolledIds.length; e++) {
            enrolledSet[String(enrolledIds[e])] = true;
        }

        var offerings = [];
        try {
            offerings = AcademyClassDisciplinesQueries
                .getClassDisciplinesForClass(_classId) || [];
        } catch (e) {
            offerings = [];
        }

        var rows = [];

        for (var o = 0; o < offerings.length; o++) {
            var rec = offerings[o];
            if (!rec || !rec.disciplineId) { continue; }

            var disc = AcademyDisciplines.getDiscipline(rec.disciplineId);
            if (!disc) { continue; }

            // A discipline without a valid startWeek is skipped.
            // The enrolment window depends on it, and the modal
            // does not invent a value.
            var disciplineStartWeek = parseInt(disc.startWeek, 10);
            if (isNaN(disciplineStartWeek) || disciplineStartWeek < 1) {
                console.warn(
                    '[AcademyEnrollmentModal] Skipping discipline ' +
                    rec.disciplineId + ': no valid startWeek.'
                );
                continue;
            }

            var disciplineId = String(rec.disciplineId);

            var marker = AcademyClassDisciplinesQueries.getClassDiscipline(
                _classId, disciplineId
            );
            var mandatory = marker && marker.mandatory === true;

            rows.push({
                id: disciplineId,
                name: disc.name || 'Unnamed Discipline',
                mandatory: mandatory,
                enrolled: enrolledSet[disciplineId] === true,
                startWeek: disciplineStartWeek
            });
        }

        // Sort: already-enrolled rows at the bottom; mandatory
        // above optional; then alphabetically.
        rows.sort(function(a, b) {
            if (a.enrolled !== b.enrolled) {
                return a.enrolled ? 1 : -1;
            }
            if (a.mandatory !== b.mandatory) {
                return a.mandatory ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        var eligibleRows = [];
        for (var r = 0; r < rows.length; r++) {
            if (!rows[r].enrolled) {
                eligibleRows.push(rows[r]);
            }
        }

        var mandatoryCount = 0;
        for (var m = 0; m < eligibleRows.length; m++) {
            if (eligibleRows[m].mandatory) {
                mandatoryCount++;
            }
        }

        return {
            charId: _charId,
            charName: charName,
            classId: _classId,
            week: _week,
            title: _title,
            rows: rows,
            eligibleRows: eligibleRows,
            mandatoryCount: mandatoryCount
        };
    }

    // ============================================================
    // RENDER
    // ============================================================

    function renderContent(vm) {
        if (!_contentEl || !vm) { return; }
        _contentEl.innerHTML = buildModalHTML(vm);
    }

    function refetchAndRender() {
        if (!_contentEl || !_charId || !_classId) { return; }

        var vm = buildViewModel();
        if (!vm) {
            notify('Failed to refresh enrollment view.', 'error');
            closeModal();
            return;
        }

        renderContent(vm);
    }

    function buildModalHTML(vm) {
        var rows = vm.rows;
        var total = rows.length;
        var eligibleCount = vm.eligibleRows.length;
        var mandatoryCount = vm.mandatoryCount;

        var html = '';

        // ---- Header ----
        var charNameEscaped = DomUtils.escapeHtml(vm.charName);
        var heading;
        if (isNonEmptyString(vm.title)) {
            heading = DomUtils.escapeHtml(vm.title) +
                ' \u2014 ' + charNameEscaped;
        } else {
            heading = 'Enroll ' + charNameEscaped + ' in a Discipline';
        }

        html += '<div class="modal-header">';
        html += '<h3>' + heading + '</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-enroll-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        // ---- Body ----
        html += '<div class="modal-body">';

        if (total === 0) {
            html += '<p class="empty-state">' +
                        'This class does not offer any disciplines ' +
                        'with a valid start week.' +
                    '</p>';
        } else if (eligibleCount === 0) {
            html += '<p class="empty-state">' +
                        DomUtils.escapeHtml(vm.charName) +
                        ' is already enrolled in every discipline ' +
                        'offered by this class.' +
                    '</p>';
        } else {
            html += '<p class="academy-enroll-summary">' +
                        'Offerings for this class: ' +
                        '<strong>' + total + '</strong> ' +
                        '&middot; Available to enroll: ' +
                        '<strong>' + eligibleCount + '</strong>' +
                    '</p>';

            html += '<p class="academy-enroll-note">' +
                        'Enrollment is a year-level decision. ' +
                        'Every discipline the class offers is listed, ' +
                        'regardless of the display week.' +
                    '</p>';

            html += '<div class="academy-enroll-list">';
            for (var i = 0; i < rows.length; i++) {
                html += renderDisciplineRow(rows[i]);
            }
            html += '</div>';
        }

        html += '</div>';

        // ---- Footer ----
        html += '<div class="modal-footer academy-enroll-footer">';

        html += '<button type="button" class="small secondary" ' +
                    'data-enroll-action="enroll-mandatory"' +
                    (mandatoryCount === 0 || _busy ? ' disabled' : '') +
                    '>' +
                    'Enroll in All Mandatory (' + mandatoryCount + ')' +
                '</button>';

        html += '<span class="academy-enroll-footer-spacer"></span>';

        html += '<button type="button" class="secondary" ' +
                    'data-enroll-action="close">Close</button>';

        html += '<button type="button" class="primary" ' +
                    'data-enroll-action="enroll-selected"' +
                    (eligibleCount === 0 || _busy ? ' disabled' : '') +
                    '>' +
                    'Enroll in Selected' +
                '</button>';

        html += '</div>';

        return html;
    }

    function renderDisciplineRow(row) {
        var rowClass = 'academy-enroll-row';
        if (row.enrolled) {
            rowClass += ' academy-enroll-row-enrolled';
        }
        if (row.mandatory) {
            rowClass += ' academy-enroll-row-mandatory';
        }

        var html = '';

        html += '<div class="' + rowClass + '" ' +
                    'data-discipline-id="' +
                        DomUtils.escapeAttribute(row.id) + '">';

        html += '<label class="academy-enroll-checkbox-label">';

        if (row.enrolled) {
            // Already enrolled: no checkbox, show a state badge
            // instead. Clicking cannot unenroll from this modal;
            // unenrollment is the Leave action on the character
            // detail panel.
            html += '<span class="academy-enroll-enrolled-badge" ' +
                        'title="Already enrolled">' +
                        '\u2713' +
                    '</span>';
        } else {
            html += '<input type="checkbox" ' +
                        'class="academy-enroll-checkbox" ' +
                        'data-enroll-action="toggle-discipline" ' +
                        'data-discipline-id="' +
                            DomUtils.escapeAttribute(row.id) + '"' +
                        (_busy ? ' disabled' : '') +
                        '>';
        }

        html += '<span class="academy-enroll-discipline-name">' +
                    DomUtils.escapeHtml(row.name) +
                '</span>';

        html += '</label>';

        if (row.mandatory) {
            html += '<span class="academy-enroll-badge-mandatory">' +
                        'Mandatory' +
                    '</span>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    function handleContentClick(e) {
        if (_busy) {
            e.preventDefault();
            return;
        }

        var target = e.target;
        if (!target || typeof target.closest !== 'function') { return; }

        var btn = target.closest('[data-enroll-action]');
        if (!btn || !btn.dataset) { return; }

        var action = btn.dataset.enrollAction;

        if (action === 'close') {
            e.preventDefault();
            closeModal();
            return;
        }

        if (action === 'enroll-selected') {
            e.preventDefault();
            handleEnrollSelected();
            return;
        }

        if (action === 'enroll-mandatory') {
            e.preventDefault();
            handleEnrollMandatory();
            return;
        }
    }

    function handleContentChange(e) {
        // No per-checkbox change handler in this pass. The "Enroll
        // in Selected" button reads the current checkbox state at
        // click time. Wiring a change listener would be extra
        // bookkeeping for no behavioural difference.
    }

    // ============================================================
    // WRITE HANDLERS
    // ============================================================

    function getSelectedDisciplineIds() {
        if (!_contentEl) { return []; }

        var checks = _contentEl.querySelectorAll(
            '.academy-enroll-checkbox:checked'
        );
        var ids = [];
        for (var i = 0; i < checks.length; i++) {
            var id = checks[i].dataset
                ? checks[i].dataset.disciplineId
                : null;
            if (isNonEmptyString(id)) {
                ids.push(String(id));
            }
        }
        return ids;
    }

    function handleEnrollSelected() {
        var ids = getSelectedDisciplineIds();

        if (ids.length === 0) {
            notify('Select at least one discipline.', 'info');
            return;
        }

        runBulkEnrolment(ids, 'Enrolled in selected discipline(s).');
    }

    function handleEnrollMandatory() {
        if (!_classId || !_charId) { return; }

        var vm = buildViewModel();
        if (!vm) {
            notify('Failed to refresh enrollment view.', 'error');
            return;
        }

        var ids = [];
        for (var i = 0; i < vm.eligibleRows.length; i++) {
            var row = vm.eligibleRows[i];
            if (row.mandatory && !row.enrolled) {
                ids.push(row.id);
            }
        }

        if (ids.length === 0) {
            notify('No mandatory disciplines left to enroll.', 'info');
            return;
        }

        runBulkEnrolment(ids, 'Enrolled in all mandatory disciplines.');
    }

    /**
     * Run a list of enrolments sequentially.
     *
     * Each enrolment is an individual AcademyEnrolments.enrol call,
     * which is a single MutationPipeline transaction. Failures are
     * collected. On completion:
     *   - If no failures: success toast.
     *   - If some failures: honest per-row failure summary, and the
     *     modal is refetched so it reflects whatever succeeded.
     *
     * Each row's startWeek is clipped to the discipline's own
     * startWeek:
     *
     *   enrolmentStart = max(displayWeek, discipline.startWeek)
     *
     * The clip is applied here, at the write boundary, so the
     * enrolment interval never claims to cover weeks the
     * discipline does not run. AcademyEnrolments.enrol stores
     * whatever startWeek it is given; the modal is responsible for
     * giving it an honest value.
     *
     * While the chain runs, `_busy` is true and the rendered modal
     * shows disabled controls. `renderContent` is not called until
     * the chain completes, so the DOM stays stable during the run.
     */
    function runBulkEnrolment(ids, successMessage) {
        if (!_charId || !_classId || ids.length === 0) { return; }

        // Resolve each id to a discipline's startWeek so we can
        // clip. A discipline that has gone missing between render
        // and submit is recorded as a failure; the modal does not
        // invent a value.
        var plans = [];
        for (var p = 0; p < ids.length; p++) {
            var disciplineId = ids[p];
            var disc = null;
            try {
                disc = AcademyDisciplines.getDiscipline(disciplineId);
            } catch (e) {
                disc = null;
            }

            if (!disc) {
                plans.push({
                    disciplineId: disciplineId,
                    startWeek: null,
                    error: 'Discipline no longer exists.'
                });
                continue;
            }

            var disciplineStartWeek = parseInt(disc.startWeek, 10);
            if (isNaN(disciplineStartWeek) || disciplineStartWeek < 1) {
                plans.push({
                    disciplineId: disciplineId,
                    startWeek: null,
                    error: 'Discipline has no valid start week.'
                });
                continue;
            }

            plans.push({
                disciplineId: disciplineId,
                startWeek: computeEnrolmentStartWeek(
                    _week, disciplineStartWeek
                ),
                error: null
            });
        }

        _busy = true;

        // Re-render with disabled controls. This does not refetch
        // the VM; it just reuses the last-built one.
        var currentVM = buildViewModel();
        if (currentVM) {
            renderContent(currentVM);
        }

        var failures = [];
        var succeeded = 0;
        var chain = Promise.resolve();

        plans.forEach(function(plan) {
            chain = chain.then(function() {
                if (plan.error !== null) {
                    failures.push({
                        disciplineId: plan.disciplineId,
                        message: plan.error
                    });
                    return;
                }

                return AcademyEnrolments.enrol(
                    _charId,
                    _classId,
                    plan.disciplineId,
                    plan.startWeek
                ).then(function(result) {
                    if (result && result.success) {
                        succeeded++;
                    } else {
                        failures.push({
                            disciplineId: plan.disciplineId,
                            message: (result && result.message) ||
                                'Unknown error'
                        });
                    }
                }).catch(function(err) {
                    failures.push({
                        disciplineId: plan.disciplineId,
                        message: String(err && err.message || err)
                    });
                });
            });
        });

        chain.then(function() {
            _busy = false;

            if (failures.length === 0) {
                notify(successMessage, 'success');
            } else if (succeeded === 0) {
                notify(
                    'Enrolment failed for all ' + failures.length +
                    ' selected discipline(s). See console for details.',
                    'error'
                );
            } else {
                notify(
                    'Enrolled in ' + succeeded + ' of ' +
                    (succeeded + failures.length) +
                    ' discipline(s). Some failed. See console for details.',
                    'warning'
                );
            }

            for (var i = 0; i < failures.length; i++) {
                console.warn(
                    '[AcademyEnrollmentModal] enrolment failed:',
                    failures[i]
                );
            }

            refetchAndRender();
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyEnrollmentModal = Object.freeze({
        openModal: openModal,
        closeModal: closeModal
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyEnrollmentModal;
        var missing = [];

        var required = ['openModal', 'closeModal'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyEnrollmentModal] Verification - some ' +
                'exports may be missing:', missing.join(', ')
            );
        }
    })();

})();
