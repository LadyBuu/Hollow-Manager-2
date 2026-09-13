/**
 * modules/academy/academy-class-detail.js - Academy Class Detail Panel
 * Right-panel renderer for the Academy People view (no character selected)
 *
 * Path: js/modules/academy/academy-class-detail.js
 *
 * This module is responsible for:
 *   - Rendering the class summary header
 *   - Rendering the class roster (character list, clickable)
 *   - Rendering the class's academic teams summary
 *   - Rendering the class's ranking summary
 *   - Rendering an empty state when no class is selected
 *
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no domain logic
 *   - Receives a view model from AcademyAggregator.getClassViewModel
 *   - Does NOT fetch data. Does NOT call AcademyQueries.
 *   - Does NOT bind events. Buttons emit data-* and are handled
 *     by AcademyView's delegated container listeners.
 *   - Uses DomUtils for escaping.
 *   - Returns an HTML string.
 *
 * NAME COLLISION:
 *   window.ClassDetail is a potential future name for a non-Academy
 *   class module. This module exposes itself as
 *   window.AcademyClassDetail. A legacy alias on window.ClassDetail
 *   is also set for backwards compatibility during the transition.
 *   academy-view.js looks up AcademyClassDetail first.
 *
 * INTERFACE:
 *   AcademyClassDetail.renderHTML(classVM) -> string
 *
 *   classVM is the shape returned by
 *   AcademyAggregator.getClassViewModel(classId, options).
 *   Required fields:
 *     id, name, status
 *   Optional fields:
 *     year, description, instructorId, instructorName,
 *     students[], studentCount, traineeCount, instructorCount,
 *     teams[], teamCount, rankings[], rankingCount, rankingWeek,
 *     week
 *
 *   If classVM is null or missing id, an empty state is rendered.
 *   If optional fields are missing, that section renders an
 *   "unavailable" placeholder rather than crashing.
 *
 * EVENTS EMITTED (via data-* attributes, for AcademyView to bind):
 *   - .academy-class-detail [data-class-id]
 *   - .academy-student-row [data-character-id]
 *   - .academy-team-row [data-team-id]
 *   - [data-action="add-character"] with [data-class-id]
 *   - [data-action="edit-class"] with [data-class-id]
 *   - [data-action="delete-class"] with [data-class-id]
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
 *
 * USAGE:
 *   var html = AcademyClassDetail.renderHTML(classVM);
 *   container.innerHTML = html;
 */

(function() {
    'use strict';

    if (window.__academyClassDetailLoaded) {
        return;
    }
    window.__academyClassDetailLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var DomUtils = window.DomUtils;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }
        if (!DomUtils || typeof DomUtils.escapeAttribute !== 'function') {
            missing.push('DomUtils.escapeAttribute');
        }

        if (missing.length > 0) {
            console.warn('[AcademyClassDetail] Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // ESCAPING HELPERS
    // ============================================================

    function escapeHtml(value) {
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
        }
        if (value === undefined || value === null) {
            return '';
        }
        return String(value);
    }

    function escapeAttribute(value) {
        if (DomUtils && typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        if (value === undefined || value === null) {
            return '';
        }
        return String(value);
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isPositiveNumber(value) {
        return typeof value === 'number' && isFinite(value) && value > 0;
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

    function getRoleBadgeClass(role) {
        return role === 'instructor'
            ? 'academy-role-badge academy-role-instructor'
            : 'academy-role-badge academy-role-trainee';
    }

    function getRoleLabel(role) {
        return role === 'instructor' ? 'Instructor' : 'Trainee';
    }

    // ============================================================
    // RENDER - Top-level
    // ============================================================

    /**
     * Render the class detail panel.
     *
     * @param {object|null} classVM - View model from AcademyAggregator
     * @returns {string} HTML string
     */
    function renderHTML(classVM) {
        if (!checkDependencies()) {
            return (
                '<div class="academy-detail-empty">' +
                    '<p class="empty-state small">Class detail dependencies not loaded.</p>' +
                '</div>'
            );
        }

        if (!classVM || !classVM.id) {
            return renderEmptyState();
        }

        var html = '';
        html += '<div class="academy-class-detail" data-class-id="' + escapeAttribute(classVM.id) + '">';
        html += renderHeader(classVM);
        html += renderDescription(classVM);
        html += renderRoster(classVM);
        html += renderTeams(classVM);
        html += renderRankings(classVM);
        html += '</div>';

        return html;
    }

    // ============================================================
    // EMPTY STATE
    // ============================================================

    function renderEmptyState() {
        return (
            '<div class="academy-detail-empty">' +
                '<p class="empty-state small">Select a class to view its details.</p>' +
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
        html += '<h3 class="academy-class-detail-title">' + escapeHtml(classVM.name || 'Unnamed Class') + '</h3>';
        html += '<span class="' + getStatusBadgeClass(classVM.status) + '">' +
                    escapeHtml(getStatusLabel(classVM.status)) +
                '</span>';
        html += '</div>';

        // Meta row
        html += '<div class="academy-class-detail-meta">';

        if (isPositiveNumber(classVM.year)) {
            html += '<span class="academy-class-detail-meta-item">' +
                        '<span class="meta-label">Year:</span> ' +
                        escapeHtml(String(classVM.year)) +
                    '</span>';
        }

        if (classVM.instructorId && isNonEmptyString(classVM.instructorName)) {
            html += '<span class="academy-class-detail-meta-item">' +
                        '<span class="meta-label">Instructor:</span> ' +
                        escapeHtml(classVM.instructorName) +
                    '</span>';
        } else {
            html += '<span class="academy-class-detail-meta-item academy-meta-muted">' +
                        '<span class="meta-label">Instructor:</span> Not assigned' +
                    '</span>';
        }

        if (typeof classVM.studentCount === 'number') {
            html += '<span class="academy-class-detail-meta-item">' +
                        '<span class="meta-label">Students:</span> ' +
                        escapeHtml(String(classVM.studentCount)) +
                    '</span>';
        }

        if (typeof classVM.teamCount === 'number') {
            html += '<span class="academy-class-detail-meta-item">' +
                        '<span class="meta-label">Teams:</span> ' +
                        escapeHtml(String(classVM.teamCount)) +
                    '</span>';
        }

        html += '</div>';

        // Actions — emitted as data-* for AcademyView to handle.
        // AcademyView currently stubs these as no-ops; Session E wires
        // them to real modals.
        html += '<div class="academy-class-detail-actions">';
        html += '<button type="button" class="small primary" ' +
                    'data-action="add-character" ' +
                    'data-class-id="' + escapeAttribute(classVM.id) + '">' +
                    '+ Add Character' +
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
    // ROSTER
    // ============================================================

    function renderRoster(classVM) {
        var html = '';

        html += '<div class="academy-class-detail-section academy-class-detail-roster">';

        var count = typeof classVM.studentCount === 'number' ? classVM.studentCount : 0;
        html += '<div class="academy-class-detail-section-header">';
        html += '<h4 class="academy-class-detail-section-title">Roster</h4>';
        html += '<span class="academy-class-detail-section-count">' + count + '</span>';
        html += '</div>';

        if (!Array.isArray(classVM.students)) {
            html += '<p class="empty-state small">Roster data is not available.</p>';
            html += '</div>';
            return html;
        }

        if (classVM.students.length === 0) {
            html += '<p class="empty-state small">No students are enrolled in this class.</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="academy-roster-list">';

        for (var i = 0; i < classVM.students.length; i++) {
            var student = classVM.students[i];
            if (!student || !student.id) {
                continue;
            }
            html += renderStudentRow(student);
        }

        html += '</div>';
        html += '</div>';

        return html;
    }

    function renderStudentRow(student) {
        var role = student.role || 'trainee';
        var roleBadgeClass = getRoleBadgeClass(role);
        var roleLabel = getRoleLabel(role);

        var rowClass = 'academy-student-row';
        if (student.deceased) {
            rowClass += ' academy-student-row-deceased';
        }
        if (role === 'instructor') {
            rowClass += ' academy-student-row-instructor';
        }

        var html = '';
        html += '<div class="' + rowClass + '" ' +
                    'data-character-id="' + escapeAttribute(student.id) + '" ' +
                    'role="button" tabindex="0">';

        html += '<div class="academy-student-row-main">';
        html += '<span class="academy-student-row-name">' + escapeHtml(student.name || 'Unknown') + '</span>';
        html += '<span class="' + roleBadgeClass + '">' + escapeHtml(roleLabel) + '</span>';
        html += '</div>';

        // Secondary line: status + age + deceased
        var secondaryParts = [];

        if (isNonEmptyString(student.status)) {
            secondaryParts.push(escapeHtml(student.status));
        }
        if (isNonEmptyString(student.age)) {
            secondaryParts.push(escapeHtml(student.age));
        }
        if (student.deceased) {
            secondaryParts.push('<span class="academy-student-row-deceased-badge">Deceased</span>');
        }

        if (secondaryParts.length > 0) {
            html += '<div class="academy-student-row-secondary">';
            html += secondaryParts.join(' &middot; ');
            html += '</div>';
        }

        html += '</div>';

        return html;
    }

    // ============================================================
    // TEAMS
    // ============================================================

    function renderTeams(classVM) {
        if (!Array.isArray(classVM.teams)) {
            return '';
        }

        var html = '';
        html += '<div class="academy-class-detail-section academy-class-detail-teams">';

        html += '<div class="academy-class-detail-section-header">';
        html += '<h4 class="academy-class-detail-section-title">Academic Teams</h4>';
        html += '<span class="academy-class-detail-section-count">' + classVM.teams.length + '</span>';
        html += '</div>';

        if (classVM.teams.length === 0) {
            html += '<p class="empty-state small">No teams have been created for this class.</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="academy-team-list">';

        for (var i = 0; i < classVM.teams.length; i++) {
            var team = classVM.teams[i];
            if (!team || !team.id) {
                continue;
            }
            html += renderTeamRow(team);
        }

        html += '</div>';
        html += '</div>';

        return html;
    }

    function renderTeamRow(team) {
        var html = '';
        html += '<div class="academy-team-row" data-team-id="' + escapeAttribute(team.id) + '">';

        html += '<div class="academy-team-row-main">';
        html += '<span class="academy-team-row-name">' + escapeHtml(team.name || 'Unnamed Team') + '</span>';
        html += '<span class="academy-team-row-member-count">' +
                    (typeof team.memberCount === 'number' ? team.memberCount : 0) +
                    ' members' +
                '</span>';
        html += '</div>';

        if (isNonEmptyString(team.periodDisplay)) {
            html += '<div class="academy-team-row-secondary">' + escapeHtml(team.periodDisplay) + '</div>';
        }

        html += '</div>';

        return html;
    }

    // ============================================================
    // RANKINGS
    // ============================================================

    function renderRankings(classVM) {
        if (!Array.isArray(classVM.rankings)) {
            return '';
        }

        var html = '';
        html += '<div class="academy-class-detail-section academy-class-detail-rankings">';

        html += '<div class="academy-class-detail-section-header">';
        html += '<h4 class="academy-class-detail-section-title">Rankings</h4>';

        if (typeof classVM.rankingWeek === 'number') {
            html += '<span class="academy-class-detail-section-subtitle">Week ' +
                        escapeHtml(String(classVM.rankingWeek)) +
                    '</span>';
        }

        html += '</div>';

        if (classVM.rankings.length === 0) {
            html += '<p class="empty-state small">No rankings recorded for this week.</p>';
            html += '</div>';
            return html;
        }

        html += '<table class="academy-ranking-table">';
        html += '<thead>';
        html += '<tr>';
        html += '<th class="rank-col">Rank</th>';
        html += '<th class="name-col">Student</th>';
        html += '<th class="avg-col">Average</th>';
        html += '<th class="count-col">Grades</th>';
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';

        for (var i = 0; i < classVM.rankings.length; i++) {
            var entry = classVM.rankings[i];
            if (!entry) {
                continue;
            }
            html += renderRankingRow(entry);
        }

        html += '</tbody>';
        html += '</table>';
        html += '</div>';

        return html;
    }

    function renderRankingRow(entry) {
        var html = '';
        html += '<tr class="academy-ranking-row" ' +
                    'data-character-id="' + escapeAttribute(entry.studentId || '') + '">';

        html += '<td class="rank-col">#' + escapeHtml(String(entry.rank || '?')) + '</td>';
        html += '<td class="name-col">' + escapeHtml(entry.studentName || 'Unknown') + '</td>';
        html += '<td class="avg-col">' +
                    (typeof entry.average === 'number' ? escapeHtml(String(entry.average)) : '\u2014') +
                '</td>';
        html += '<td class="count-col">' +
                    (typeof entry.gradeCount === 'number' ? entry.gradeCount : 0) +
                '</td>';

        html += '</tr>';
        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    // EXPOSED AS AcademyClassDetail to match AcademyCharacterDetail and
    // avoid collision with any future non-Academy ClassDetail module.
    window.AcademyClassDetail = {
        renderHTML: renderHTML
    };

    // Legacy alias — remove once academy-view.js is the only consumer.
    window.ClassDetail = window.AcademyClassDetail;

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyClassDetail;
        var missing = [];

        var required = ['renderHTML'];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[AcademyClassDetail] Verification - some exports may be missing:', missing.join(', '));
        }
    })();

})();