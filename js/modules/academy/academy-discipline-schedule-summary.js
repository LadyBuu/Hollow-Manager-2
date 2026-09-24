/**
 * modules/academy/academy-discipline-schedule-summary.js
 * Academy Discipline Schedule Summary
 *
 * Path: js/modules/academy/academy-discipline-schedule-summary.js
 *
 * Pure renderer for the enrollment summary panel that sits below
 * the discipline schedule grid.
 *
 * RENDER ONLY. No mutations, no domain reads, no state. Receives a
 * VM from
 * AcademyCalendarAggregator.getDisciplineScheduleSummaryViewModel
 * and returns an HTML string.
 *
 * VM CONTRACT (STRICT):
 *   The renderer trusts the VM. Every field it reads is guaranteed
 *   by the aggregator's contract. A malformed VM is an aggregator
 *   bug and must surface as a thrown error, not as a summary panel
 *   that quietly claims fewer students than exist.
 *
 *   {
 *     classId:          string,
 *     className:        string,
 *     disciplineId:     string,
 *     disciplineName:   string,
 *     week:             number,
 *
 *     enrolledCount:    integer >= 0,
 *     assignedCount:    integer >= 0,
 *     unassignedCount:  integer >= 0,
 *     eliminatedCount:  integer >= 0,
 *
 *     assigned:   [ rowVM, ... ],   // guaranteed array
 *     unassigned: [ rowVM, ... ]    // guaranteed array
 *   }
 *
 *   rowVM:
 *   {
 *     id:                string,
 *     name:              string,
 *     status:            string,
 *     eliminated:        boolean,
 *     eliminationWeek:   number | null
 *   }
 *
 *   INVARIANT: enrolledCount === assignedCount + unassignedCount.
 *   The renderer asserts this. A mismatch is an aggregator bug.
 *
 * PANEL SHAPE:
 *   A single disclosure. The header shows the three counts. The
 *   body lists the unassigned students. Eliminated students appear
 *   in the unassigned list with an "Eliminated" marker on their
 *   row; they are counted in unassignedCount and enrolledCount.
 *
 *   Collapsed by default. The disclosure pattern matches the
 *   orphan-teams section in academy-weekly-teams-view.js: a button
 *   header with a caret, and a body that is display:none until the
 *   toggle action fires.
 *
 *   When unassignedCount is zero, the disclosure is replaced with a
 *   single "Every enrolled student has a group." line. No toggle,
 *   nothing to expand.
 *
 *   When enrolledCount is zero, a single "No students are enrolled"
 *   line is rendered instead.
 *
 * EVENTS EMITTED:
 *   [data-action="discipline-summary-toggle"]  (click)
 *
 *   The toggle handler lives in the discipline controller
 *   (academy-discipline-controller.js), which flips the block's
 *   data-expanded attribute, the caret glyph, and the body's
 *   display. This module only emits the marker.
 *
 * ACCESSIBILITY:
 *   The toggle is a <button> with aria-expanded and aria-controls.
 *   The body carries a matching id. Both are required so that
 *   assistive technology can associate the toggle with the region
 *   it expands.
 *
 *   The id is composed from the discipline ID so that a page with
 *   multiple summaries (rare today, possible later) does not
 *   produce duplicate ids. The discipline ID is HTML-attribute-
 *   escaped before being embedded.
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
 */

(function() {
    'use strict';

    if (window.__academyDisciplineScheduleSummaryLoaded) {
        return;
    }

    var DomUtils = window.DomUtils;

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        throw new Error(
            '[AcademyDisciplineScheduleSummary] Missing mandatory ' +
            'dependency: DomUtils.escapeHtml / escapeAttribute'
        );
    }

    window.__academyDisciplineScheduleSummaryLoaded = true;

    // ============================================================
    // ESCAPING
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
    }

    function isNonNegativeInteger(value) {
        return typeof value === 'number' &&
            isFinite(value) &&
            Number.isInteger(value) &&
            value >= 0;
    }

    // ============================================================
    // VM VALIDATION
    // ============================================================
    //
    // Strict. The renderer trusts the VM. A missing field is an
    // aggregator bug, not a request for a default value.

    function validateVM(viewModel) {
        if (!viewModel || typeof viewModel !== 'object') {
            throw new Error(
                '[AcademyDisciplineScheduleSummary] renderHTML requires ' +
                'a view model object.'
            );
        }

        var vm = viewModel;

        if (!isNonNegativeInteger(vm.enrolledCount)) {
            throw new Error(
                '[AcademyDisciplineScheduleSummary] VM.enrolledCount ' +
                'must be a non-negative integer.'
            );
        }
        if (!isNonNegativeInteger(vm.assignedCount)) {
            throw new Error(
                '[AcademyDisciplineScheduleSummary] VM.assignedCount ' +
                'must be a non-negative integer.'
            );
        }
        if (!isNonNegativeInteger(vm.unassignedCount)) {
            throw new Error(
                '[AcademyDisciplineScheduleSummary] VM.unassignedCount ' +
                'must be a non-negative integer.'
            );
        }
        if (!Array.isArray(vm.assigned)) {
            throw new Error(
                '[AcademyDisciplineScheduleSummary] VM.assigned must ' +
                'be an array.'
            );
        }
        if (!Array.isArray(vm.unassigned)) {
            throw new Error(
                '[AcademyDisciplineScheduleSummary] VM.unassigned must ' +
                'be an array.'
            );
        }

        // Invariant: enrolled = assigned + unassigned.
        if (vm.enrolledCount !== vm.assignedCount + vm.unassignedCount) {
            throw new Error(
                '[AcademyDisciplineScheduleSummary] VM invariant ' +
                'violated: enrolledCount (' + vm.enrolledCount +
                ') !== assignedCount (' + vm.assignedCount +
                ') + unassignedCount (' + vm.unassignedCount + '). ' +
                'This is an aggregator bug.'
            );
        }

        // Counts must agree with list lengths.
        if (vm.assignedCount !== vm.assigned.length) {
            throw new Error(
                '[AcademyDisciplineScheduleSummary] VM.assignedCount (' +
                vm.assignedCount + ') does not match the length of ' +
                'VM.assigned (' + vm.assigned.length + ').'
            );
        }
        if (vm.unassignedCount !== vm.unassigned.length) {
            throw new Error(
                '[AcademyDisciplineScheduleSummary] VM.unassignedCount (' +
                vm.unassignedCount + ') does not match the length of ' +
                'VM.unassigned (' + vm.unassigned.length + ').'
            );
        }

        return vm;
    }

    // ============================================================
    // PUBLIC ENTRY POINT
    // ============================================================

    function renderHTML(viewModel) {
        var vm = validateVM(viewModel);

        var enrolled = vm.enrolledCount;
        var assigned = vm.assignedCount;
        var unassigned = vm.unassignedCount;

        var html = '';
        html += '<div class="academy-discipline-schedule-summary" ' +
                    'data-discipline-id="' +
                        escapeAttribute(vm.disciplineId || '') + '">';

        if (enrolled === 0) {
            html += renderNoStudents();
            html += '</div>';
            return html;
        }

        if (unassigned === 0) {
            html += renderAllAssigned(enrolled, assigned);
            html += '</div>';
            return html;
        }

        html += renderDisclosure(vm, enrolled, assigned, unassigned);

        html += '</div>';
        return html;
    }

    // ============================================================
    // NO STUDENTS
    // ============================================================

    function renderNoStudents() {
        return (
            '<p class="empty-state small ' +
                    'academy-discipline-summary-empty">' +
                'No students are enrolled in this discipline for ' +
                'this class.' +
            '</p>'
        );
    }

    // ============================================================
    // ALL ASSIGNED — no disclosure needed
    // ============================================================

    function renderAllAssigned(enrolled, assigned) {
        var html = '';
        html += '<div class="academy-discipline-summary-done">';

        html += '<span class="academy-discipline-summary-done-text">';
        html += '<span class="academy-discipline-summary-count">' +
                    escapeHtml(String(enrolled)) +
                '</span> enrolled &middot; ' +
                '<span class="academy-discipline-summary-count">' +
                    escapeHtml(String(assigned)) +
                '</span> assigned';
        html += '</span>';

        html += '<span class="academy-discipline-summary-done-note">' +
                    'Every enrolled student has a group.' +
                '</span>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // DISCLOSURE
    // ============================================================

    function renderDisclosure(vm, enrolled, assigned, unassigned) {
        var disciplineName = isNonEmptyString(vm.disciplineName)
            ? vm.disciplineName
            : 'Discipline';

        // Body id includes the discipline id so multiple summaries
        // on one page do not collide. Escaped for attribute context.
        var bodyId = 'academy-discipline-summary-body-' +
            (isNonEmptyString(vm.disciplineId)
                ? vm.disciplineId
                : 'unknown');

        var html = '';

        html += '<div class="academy-discipline-summary-block" ' +
                    'data-expanded="false">';

        // ---- Toggle header ----
        html += '<button type="button" ' +
                    'class="academy-discipline-summary-toggle" ' +
                    'data-action="discipline-summary-toggle" ' +
                    'aria-expanded="false" ' +
                    'aria-controls="' +
                        escapeAttribute(bodyId) + '">';

        html += '<span class="academy-discipline-summary-caret">' +
                    '\u25b8' +
                '</span>';

        html += '<span class="academy-discipline-summary-headline">';
        html += '<span class="academy-discipline-summary-name">' +
                    escapeHtml(disciplineName) +
                '</span>';
        html += '<span class="academy-discipline-summary-sep">' +
                    ' \u2014 ' +
                '</span>';
        html += '<span class="academy-discipline-summary-count">' +
                    escapeHtml(String(enrolled)) +
                '</span>';
        html += '<span class="academy-discipline-summary-count-label">' +
                    ' enrolled' +
                '</span>';
        html += '<span class="academy-discipline-summary-sep">' +
                    ' \u00b7 ' +
                '</span>';
        html += '<span class="academy-discipline-summary-count">' +
                    escapeHtml(String(assigned)) +
                '</span>';
        html += '<span class="academy-discipline-summary-count-label">' +
                    ' assigned' +
                '</span>';
        html += '<span class="academy-discipline-summary-sep">' +
                    ' \u00b7 ' +
                '</span>';
        html += '<span class="academy-discipline-summary-count ' +
                    'academy-discipline-summary-count-unassigned">' +
                    escapeHtml(String(unassigned)) +
                '</span>';
        html += '<span class="academy-discipline-summary-count-label">' +
                    ' unassigned' +
                '</span>';
        html += '</span>';

        html += '</button>';

        // ---- Collapsible body ----
        html += '<div class="academy-discipline-summary-body" ' +
                    'id="' + escapeAttribute(bodyId) + '" ' +
                    'style="display:none;">';
        html += renderUnassignedList(vm.unassigned);
        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderUnassignedList(unassigned) {
        if (!Array.isArray(unassigned) || unassigned.length === 0) {
            return '';
        }

        var html = '';
        html += '<ul class="academy-discipline-summary-list">';

        for (var i = 0; i < unassigned.length; i++) {
            var row = unassigned[i];
            if (!row || !row.id) {
                throw new Error(
                    '[AcademyDisciplineScheduleSummary] VM.unassigned[' +
                    i + '] must be an object with an id.'
                );
            }

            var rowClass = 'academy-discipline-summary-row';
            if (row.eliminated === true) {
                rowClass += ' is-eliminated';
            }

            html += '<li class="' + rowClass + '" ' +
                        'data-character-id="' +
                            escapeAttribute(row.id) + '">';

            html += '<span class="academy-discipline-summary-row-name">' +
                        escapeHtml(row.name || 'Unknown') +
                    '</span>';

            if (isNonEmptyString(row.status)) {
                html += '<span class="academy-discipline-summary-row-status">' +
                            escapeHtml(row.status) +
                        '</span>';
            }

            if (row.eliminated === true) {
                html += '<span class="academy-discipline-summary-row-elim">' +
                            'Eliminated' +
                            (isFiniteNumber(row.eliminationWeek)
                                ? ' \u2014 Wk ' +
                                    escapeHtml(
                                        String(row.eliminationWeek)
                                    )
                                : '') +
                        '</span>';
            }

            html += '</li>';
        }

        html += '</ul>';
        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyDisciplineScheduleSummary = Object.freeze({
        renderHTML: renderHTML
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyDisciplineScheduleSummary;
        var missing = [];

        if (typeof exports.renderHTML !== 'function') {
            missing.push('renderHTML');
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyDisciplineScheduleSummary] Verification - ' +
                'some exports may be missing:', missing.join(', ')
            );
        }
    })();

})();
