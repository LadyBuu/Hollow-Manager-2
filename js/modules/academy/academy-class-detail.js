/**
 * modules/academy/academy-class-detail.js - Academy Class Detail Panel
 * Right-panel renderer for the Academy People view (no character selected).
 *
 * Path: js/modules/academy/academy-class-detail.js
 *
 * RESPONSIBILITIES:
 *   - Render the class summary header
 *   - Render the class description (when present)
 *   - Render the class action buttons (Add Character, Disciplines,
 *     Export Schedule, Export Graduates, Export Characters, Edit,
 *     Delete)
 *   - Render an empty state when no class is selected
 *
 * NOT RESPONSIBLE FOR:
 *   - The class roster. That is the People sidebar's concern.
 *   - The class's academic teams. That is the Weekly Teams view.
 *   - The class's rankings. That is the Rankings view.
 *   - The class-disciplines picker. The button on the header emits
 *     data-action="edit-class-disciplines"; the People controller
 *     routes it to AcademyClassDisciplinesPicker.
 *   - The class schedule export. The button emits
 *     data-action="class-export-schedule"; the People controller
 *     routes it to ScheduleExport.exportClassScheduleText.
 *   - The class roster exports. The buttons emit
 *     data-action="class-export-graduates" and
 *     data-action="class-export-characters"; the People controller
 *     routes both to ClassRosterExport.
 *   - The class's instructors. Prior to v29 the panel rendered an
 *     "Instructor:" line sourced from `class.instructorId`. That
 *     field was retired; instructors are now per-discipline
 *     enrolments. The panel does not replace the line with a
 *     derived list.
 *
 * ROLE VOCABULARY:
 *   'student' | 'instructor'. There is no 'trainee'.
 *
 * ACTION NAMING:
 *   Every action element uses a prefix that the AcademyView dispatcher
 *   routes deterministically:
 *     edit-class-add-character   → handleEditDispatcher → openAddCharacterToClass
 *     edit-class-disciplines     → handleEditDispatcher → openDisciplinesPicker
 *     class-export-schedule      → handleExportClassSchedule
 *                                  (People controller, ScheduleExport)
 *     class-export-graduates     → handleExportClassGraduates
 *                                  (People controller, ClassRosterExport)
 *     class-export-characters    → handleExportClassCharacters
 *                                  (People controller, ClassRosterExport)
 *     edit-class                 → handleEditDispatcher → openClassForm
 *     delete-class               → handleDeleteDispatcher → openClassDelete
 *
 * IMPORTANT:
 *   - RENDER ONLY. No mutations. No domain reads. No state.
 *   - Receives a view model from AcademyAggregator.getClassViewModel.
 *   - Does NOT fetch data.
 *   - Does NOT bind events. Action buttons emit data-* and are
 *     handled by AcademyView's delegated container listeners.
 *   - Uses DomUtils for escaping.
 *   - Returns an HTML string.
 *
 * VIEW MODEL SHAPE (from AcademyAggregator.getClassViewModel):
 *   {
 *     id:              string,
 *     name:            string,
 *     status:          'active' | 'archived' | 'graduated',
 *     year:            number | null,
 *     description:     string,
 *     studentCount:    number,   // derived roster size (instructor excluded)
 *     createdAt:       string
 *   }
 *
 *   The VM does NOT carry instructorId or instructorName. A class does
 *   not have a singular instructor.
 *
 *   studentCount is always present on the VM. When the aggregator
 *   is older and the field is absent, the renderer falls back to
 *   omitting the count rather than inventing a zero.
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
 */

(function() {
    'use strict';

    if (window.__academyClassDetailLoaded) {
        return;
    }

    var DomUtils = window.DomUtils;

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        throw new Error(
            '[AcademyClassDetail] Missing mandatory dependency: ' +
            'DomUtils.escapeHtml / DomUtils.escapeAttribute'
        );
    }

    window.__academyClassDetailLoaded = true;

    // ============================================================
    // ESCAPING HELPERS
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

    function isPositiveNumber(value) {
        return typeof value === 'number' && isFinite(value) && value > 0;
    }

    function isNonNegativeNumber(value) {
        return typeof value === 'number' && isFinite(value) && value >= 0;
    }

    function getStatusBadgeClass(status) {
        switch (status) {
            case 'active':    return 'class-status-badge class-status-active';
            case 'archived':  return 'class-status-badge class-status-archived';
            case 'graduated': return 'class-status-badge class-status-graduated';
            default:          return 'class-status-badge class-status-unknown';
        }
    }

    function getStatusLabel(status) {
        if (!isNonEmptyString(status)) {
            return 'Unknown';
        }
        return status.charAt(0).toUpperCase() + status.slice(1);
    }

    // ============================================================
    // PUBLIC ENTRY POINT
    // ============================================================

    function renderHTML(classVM) {
        if (!classVM || !classVM.id) {
            return renderEmptyState();
        }

        var html = '';
        html += '<div class="academy-class-detail" ' +
                    'data-class-id="' + escapeAttribute(classVM.id) + '">';
        html += renderHeader(classVM);
        html += renderDescription(classVM);
        html += '</div>';

        return html;
    }

    // ============================================================
    // EMPTY STATE
    // ============================================================

    function renderEmptyState() {
        return (
            '<div class="academy-detail-empty">' +
                '<p class="empty-state small">' +
                    'Select a class to view its details.' +
                '</p>' +
            '</div>'
        );
    }

    // ============================================================
    // HEADER
    // ============================================================

    function renderHeader(classVM) {
        var html = '';

        html += '<div class="academy-class-detail-header">';

        // Title row
        html += '<div class="academy-class-detail-title-row">';
        html += '<h3 class="academy-class-detail-title">' +
                    escapeHtml(classVM.name || 'Unnamed Class') +
                '</h3>';
        html += '<span class="' + getStatusBadgeClass(classVM.status) + '">' +
                    escapeHtml(getStatusLabel(classVM.status)) +
                '</span>';
        html += '</div>';

        // Meta row: year + student count.
        //
        // The instructor line that used to live here was removed in
        // v29. A class does not have a singular instructor; its
        // instructors are per-discipline enrolments, edited from the
        // instructor's own Disciplines tab.
        html += '<div class="academy-class-detail-meta">';

        if (isPositiveNumber(classVM.year)) {
            html += '<span class="academy-class-detail-meta-item">' +
                        '<span class="meta-label">Year:</span> ' +
                        escapeHtml(String(classVM.year)) +
                    '</span>';
        }

        // Student count. Rendered only when the VM carries a valid
        // count. An older aggregator that doesn't populate the field
        // yields no count line, which is truthful.
        if (isNonNegativeNumber(classVM.studentCount)) {
            var count = classVM.studentCount;
            var countLabel = count === 1 ? 'Student' : 'Students';
            html += '<span class="academy-class-detail-meta-item academy-class-detail-student-count">' +
                        '<span class="meta-label">' + countLabel + ':</span> ' +
                        escapeHtml(String(count)) +
                    '</span>';
        }

        html += '</div>';

        // Actions
        html += '<div class="academy-class-detail-actions">';
        html += '<button type="button" class="small primary" ' +
                    'data-action="edit-class-add-character" ' +
                    'data-class-id="' + escapeAttribute(classVM.id) + '">' +
                    '+ Add Character' +
                '</button>';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="edit-class-disciplines" ' +
                    'data-class-id="' + escapeAttribute(classVM.id) + '">' +
                    'Disciplines' +
                '</button>';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="class-export-schedule" ' +
                    'data-class-id="' + escapeAttribute(classVM.id) + '">' +
                    'Export Schedule' +
                '</button>';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="class-export-graduates" ' +
                    'data-class-id="' + escapeAttribute(classVM.id) + '">' +
                    'Export Graduates' +
                '</button>';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="class-export-characters" ' +
                    'data-class-id="' + escapeAttribute(classVM.id) + '">' +
                    'Export Characters' +
                '</button>';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="edit-class" ' +
                    'data-class-id="' + escapeAttribute(classVM.id) + '">' +
                    'Edit Class' +
                '</button>';
        html += '<button type="button" class="small danger" ' +
                    'data-action="delete-class" ' +
                    'data-class-id="' + escapeAttribute(classVM.id) + '">' +
                    'Delete Class' +
                '</button>';
        html += '</div>';

        html += '</div>';

        return html;
    }

    // ============================================================
    // DESCRIPTION
    // ============================================================

    function renderDescription(classVM) {
        if (!isNonEmptyString(classVM.description)) {
            return '';
        }

        return (
            '<div class="academy-class-detail-description">' +
                '<p>' + escapeHtml(classVM.description) + '</p>' +
            '</div>'
        );
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyClassDetail = Object.freeze({
        renderHTML: renderHTML
    });

})();
