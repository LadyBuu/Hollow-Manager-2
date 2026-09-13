/**
 * modules/academy/academy-character-detail.js - Academy Character Detail Panel
 * Right-panel renderer for the Academy People view (character selected)
 *
 * Path: js/modules/academy/academy-character-detail.js
 *
 * This module is responsible for:
 *   - Rendering the character summary header (name, role badge, status)
 *   - Rendering the character's class membership chips
 *   - Rendering the character's academic stats for the selected week
 *   - Rendering the character's grades (this week + recent)
 *   - Rendering the character's team memberships
 *   - Rendering the character's ranking snapshot
 *   - Rendering an empty state when no character is selected
 *
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no domain logic
 *   - Receives a character OBJECT (not a view model). The
 *     aggregator's getCharacterDetail is NOT used here; it pulls
 *     cross-domain data that isn't all relevant to the Academy
 *     panel. Instead, this module uses CharacterQueries and
 *     AcademyQueries directly for the pieces it needs.
 *   - Does NOT bind events. Buttons emit data-* and are handled
 *     by AcademyEvents (or a future AcademyDetailEvents).
 *   - Uses DomUtils for escaping.
 *   - Returns an HTML string.
 *
 * NAME COLLISION:
 *   window.CharacterDetail is already used by
 *   js/modules/characters/character-detail.js (the modal).
 *   This module exposes itself as window.AcademyCharacterDetail.
 *   academy-view.js must look it up by that name.
 *
 * INTERFACE:
 *   AcademyCharacterDetail.renderHTML(char, classVM, options) -> string
 *
 *   char     - character object from CharacterQueries.getCharacterById
 *   classVM  - the same class view model ClassDetail renders.
 *              Used to determine the character's role within the
 *              currently selected class (trainee vs instructor).
 *   options  - { week: number }  (defaults to current week)
 *
 *   If char is null, an empty state is rendered.
 *   If classVM is null, the role badge is omitted.
 *
 * EVENTS EMITTED (via data-* attributes, for the shell to bind):
 *   - .academy-character-detail [data-character-id]
 *   - .academy-grade-row [data-grade-id]
 *   - .academy-character-team-row [data-team-id]
 *   - [data-action="edit-character"] with [data-character-id]
 *   - [data-action="view-full-character"] with [data-character-id]
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
 *   - window.CharacterQueries (MANDATORY)
 *   - window.AcademyQueries (MANDATORY)
 *   - window.DisciplineQueries (MANDATORY)
 *   - window.CalendarConstants (MANDATORY)
 *
 * USAGE:
 *   var html = AcademyCharacterDetail.renderHTML(char, classVM, { week: 5 });
 *   container.innerHTML = html;
 */

(function() {
    'use strict';

    if (window.__academyCharacterDetailLoaded) {
        return;
    }
    window.__academyCharacterDetailLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var DomUtils = window.DomUtils;
    var CharacterQueries = window.CharacterQueries;
    var AcademyQueries = window.AcademyQueries;
    var DisciplineQueries = window.DisciplineQueries;
    var CalendarConstants = window.CalendarConstants;

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

        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterQueries || typeof CharacterQueries.getCurrentStatus !== 'function') {
            missing.push('CharacterQueries.getCurrentStatus');
        }

        if (!AcademyQueries || typeof AcademyQueries.getStudentGrades !== 'function') {
            missing.push('AcademyQueries.getStudentGrades');
        }
        if (!AcademyQueries || typeof AcademyQueries.getCharacterClasses !== 'function') {
            missing.push('AcademyQueries.getCharacterClasses');
        }
        if (!AcademyQueries || typeof AcademyQueries.calculateGradeSummary !== 'function') {
            missing.push('AcademyQueries.calculateGradeSummary');
        }

        if (!DisciplineQueries || typeof DisciplineQueries.getDiscipline !== 'function') {
            missing.push('DisciplineQueries.getDiscipline');
        }

        if (!CalendarConstants || typeof CalendarConstants.MIN_WEEK !== 'number') {
            missing.push('CalendarConstants.MIN_WEEK');
        }

        if (missing.length > 0) {
            console.warn('[AcademyCharacterDetail] Missing dependencies:', missing.join(', '));
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
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function isPositiveNumber(value) {
        return typeof value === 'number' && isFinite(value) && value > 0;
    }

    function getCurrentWeek() {
        var data = window.data || {};
        var week = data.currentWeek;
        if (typeof week === 'number' &&
            week >= (CalendarConstants.MIN_WEEK || 1) &&
            week <= (CalendarConstants.MAX_WEEK || 52)) {
            return week;
        }
        return CalendarConstants.MIN_WEEK || 1;
    }

    function getDisciplineName(disciplineId) {
        if (!isNonEmptyString(disciplineId)) {
            return 'Unknown';
        }
        var discipline = DisciplineQueries.getDiscipline(disciplineId);
        return discipline && discipline.name ? discipline.name : 'Unknown';
    }

    function getRoleForCharInClass(char, classVM) {
        if (!char || !classVM) {
            return null;
        }
        if (classVM.instructorId &&
            String(classVM.instructorId) === String(char.id)) {
            return 'instructor';
        }
        if (Array.isArray(classVM.students)) {
            for (var i = 0; i < classVM.students.length; i++) {
                var s = classVM.students[i];
                if (s && String(s.id) === String(char.id)) {
                    return s.role || 'trainee';
                }
            }
        }
        return null;
    }

    function getRoleBadgeClass(role) {
        return role === 'instructor'
            ? 'academy-role-badge academy-role-instructor'
            : 'academy-role-badge academy-role-trainee';
    }

    function getRoleLabel(role) {
        return role === 'instructor' ? 'Instructor' : 'Trainee';
    }

    function getScoreClass(percentage) {
        if (typeof percentage !== 'number' || !isFinite(percentage)) {
            return 'academy-grade-score academy-grade-score-unknown';
        }
        if (percentage >= 90) {
            return 'academy-grade-score academy-grade-score-excellent';
        }
        if (percentage >= 80) {
            return 'academy-grade-score academy-grade-score-good';
        }
        if (percentage >= 70) {
            return 'academy-grade-score academy-grade-score-passing';
        }
        return 'academy-grade-score academy-grade-score-failing';
    }

    function getGradePercentage(grade) {
        if (!grade || typeof grade !== 'object') {
            return null;
        }
        if (typeof grade.percentage === 'number' && isFinite(grade.percentage)) {
            return grade.percentage;
        }
        if (typeof grade.score === 'number' &&
            typeof grade.maxScore === 'number' &&
            grade.maxScore > 0) {
            return Math.round((grade.score / grade.maxScore) * 100);
        }
        return null;
    }

    // ============================================================
    // RENDER - Top-level
    // ============================================================

    /**
     * Render the character detail panel.
     *
     * @param {object|null} char - Character object
     * @param {object|null} classVM - Class view model (for role determination)
     * @param {object} [options] - { week: number }
     * @returns {string} HTML string
     */
    function renderHTML(char, classVM, options) {
        if (!checkDependencies()) {
            return (
                '<div class="academy-detail-empty">' +
                    '<p class="empty-state small">Character detail dependencies not loaded.</p>' +
                '</div>'
            );
        }

        if (!char || !char.id) {
            return renderEmptyState();
        }

        options = options || {};
        var week = options.week || getCurrentWeek();
        var role = getRoleForCharInClass(char, classVM);

        var html = '';
        html += '<div class="academy-character-detail" ' +
                    'data-character-id="' + escapeAttribute(char.id) + '">';
        html += renderHeader(char, role);
        html += renderClassChips(char);
        html += renderGradesSection(char, week);
        html += renderRankingSection(char, classVM, week);
        html += renderTeamsSection(char, week);
        html += '</div>';

        return html;
    }

    // ============================================================
    // EMPTY STATE
    // ============================================================

    function renderEmptyState() {
        return (
            '<div class="academy-detail-empty">' +
                '<p class="empty-state small">Select a character to view their details.</p>' +
            '</div>'
        );
    }

    // ============================================================
    // HEADER
    // ============================================================

    function renderHeader(char, role) {
        var displayName = CharacterQueries.getDisplayName(char);
        var status = CharacterQueries.getCurrentStatus(char);

        var html = '';
        html += '<div class="academy-character-detail-header">';

        // Title row: name + role badge
        html += '<div class="academy-character-detail-title-row">';
        html += '<h3 class="academy-character-detail-title">' + escapeHtml(displayName) + '</h3>';
        if (role) {
            html += '<span class="' + getRoleBadgeClass(role) + '">' +
                        escapeHtml(getRoleLabel(role)) +
                    '</span>';
        }
        html += '</div>';

        // Meta row: status, age, deceased
        html += '<div class="academy-character-detail-meta">';

        if (isNonEmptyString(status)) {
            html += '<span class="academy-character-detail-meta-item">' +
                        '<span class="meta-label">Status:</span> ' +
                        escapeHtml(status) +
                    '</span>';
        }

        var age = CharacterQueries.getCharacterAge(char);
        if (isNonEmptyString(age) && age !== '-') {
            html += '<span class="academy-character-detail-meta-item">' +
                        '<span class="meta-label">Age:</span> ' +
                        escapeHtml(age) +
                    '</span>';
        }

        if (char.deceased) {
            html += '<span class="academy-character-detail-meta-item academy-meta-danger">' +
                        'Deceased' +
                    '</span>';
        }

        html += '</div>';

        // Actions
        html += '<div class="academy-character-detail-actions">';
        html += '<button type="button" class="small primary" ' +
                    'data-action="view-full-character" ' +
                    'data-character-id="' + escapeAttribute(char.id) + '">' +
                    'View Full Profile' +
                '</button>';
        html += '<button type="button" class="small secondary" ' +
                    'data-action="edit-character" ' +
                    'data-character-id="' + escapeAttribute(char.id) + '">' +
                    'Edit Character' +
                '</button>';
        html += '</div>';

        html += '</div>';

        return html;
    }

    // ============================================================
    // CLASS CHIPS
    // ============================================================

    function renderClassChips(char) {
        var classes = AcademyQueries.getCharacterClasses(char);
        if (!Array.isArray(classes) || classes.length === 0) {
            return '';
        }

        var html = '';
        html += '<div class="academy-character-detail-section academy-character-class-chips">';
        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">Classes</h4>';
        html += '</div>';
        html += '<div class="academy-character-chip-row">';

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || !cls.id) {
                continue;
            }
            html += '<span class="academy-character-class-chip" ' +
                        'data-class-id="' + escapeAttribute(cls.id) + '">' +
                        escapeHtml(cls.name || 'Unnamed Class') +
                    '</span>';
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // GRADES
    // ============================================================

    function renderGradesSection(char, week) {
        var allGrades = AcademyQueries.getStudentGrades(char.id) || [];
        var summary = AcademyQueries.calculateGradeSummary(allGrades);

        var html = '';
        html += '<div class="academy-character-detail-section academy-character-grades">';

        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">Grades</h4>';
        if (summary && typeof summary.count === 'number' && summary.count > 0) {
            html += '<span class="academy-character-detail-section-subtitle">' +
                        'Avg ' + escapeHtml(String(summary.average)) +
                    '</span>';
        }
        html += '</div>';

        if (allGrades.length === 0) {
            html += '<p class="empty-state small">No grades recorded.</p>';
            html += '</div>';
            return html;
        }

        // Sort by week ascending, then date
        var sorted = allGrades.slice().sort(function(a, b) {
            var wa = parseInt(a.week, 10) || 0;
            var wb = parseInt(b.week, 10) || 0;
            if (wa !== wb) { return wa - wb; }
            return String(a.date || '').localeCompare(String(b.date || ''));
        });

        // Show all grades in a scrollable table (max-height via CSS)
        html += '<div class="academy-grade-table-wrapper">';
        html += '<table class="academy-grade-table">';
        html += '<thead>';
        html += '<tr>';
        html += '<th class="week-col">Week</th>';
        html += '<th class="discipline-col">Discipline</th>';
        html += '<th class="type-col">Type</th>';
        html += '<th class="score-col">Score</th>';
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';

        for (var i = 0; i < sorted.length; i++) {
            html += renderGradeRow(sorted[i]);
        }

        html += '</tbody>';
        html += '</table>';
        html += '</div>';
        html += '</div>';

        return html;
    }

    function renderGradeRow(grade) {
        var percentage = getGradePercentage(grade);
        var percentageLabel = percentage !== null ? String(percentage) + '%' : '\u2014';
        var scoreClass = getScoreClass(percentage);

        var disciplineName = getDisciplineName(grade.disciplineId);
        var typeLabel = isNonEmptyString(grade.type) ? grade.type : 'assignment';
        var weekLabel = grade.week !== undefined && grade.week !== null
            ? String(grade.week)
            : '\u2014';

        var html = '';
        html += '<tr class="academy-grade-row" ' +
                    'data-grade-id="' + escapeAttribute(grade.id || '') + '">';

        html += '<td class="week-col">' + escapeHtml(weekLabel) + '</td>';
        html += '<td class="discipline-col">' + escapeHtml(disciplineName) + '</td>';
        html += '<td class="type-col">' + escapeHtml(typeLabel) + '</td>';
        html += '<td class="score-col">' +
                    '<span class="' + scoreClass + '">' +
                        escapeHtml(percentageLabel) +
                    '</span>' +
                '</td>';

        html += '</tr>';
        return html;
    }

    // ============================================================
    // RANKING
    // ============================================================

    function renderRankingSection(char, classVM, week) {
        if (!classVM || !classVM.id) {
            return '';
        }

        var rankings = AcademyQueries.calculateClassRanking(classVM.id, week);
        if (!Array.isArray(rankings) || rankings.length === 0) {
            return '';
        }

        var entry = null;
        for (var i = 0; i < rankings.length; i++) {
            if (String(rankings[i].studentId) === String(char.id)) {
                entry = rankings[i];
                break;
            }
        }

        if (!entry) {
            return '';
        }

        var html = '';
        html += '<div class="academy-character-detail-section academy-character-ranking">';

        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">Ranking</h4>';
        html += '<span class="academy-character-detail-section-subtitle">' +
                    'Week ' + escapeHtml(String(week)) +
                '</span>';
        html += '</div>';

        html += '<div class="academy-ranking-snapshot">';
        html += '<div class="academy-ranking-snapshot-item">';
        html += '<span class="snapshot-label">Rank</span>';
        html += '<span class="snapshot-value">#' +
                    escapeHtml(String(entry.rank || '?')) +
                '</span>';
        html += '<span class="snapshot-subtext">of ' + rankings.length + '</span>';
        html += '</div>';

        if (typeof entry.average === 'number') {
            html += '<div class="academy-ranking-snapshot-item">';
            html += '<span class="snapshot-label">Average</span>';
            html += '<span class="snapshot-value">' +
                        escapeHtml(String(entry.average)) +
                    '</span>';
            html += '</div>';
        }

        if (typeof entry.gradeCount === 'number') {
            html += '<div class="academy-ranking-snapshot-item">';
            html += '<span class="snapshot-label">Grades</span>';
            html += '<span class="snapshot-value">' +
                        escapeHtml(String(entry.gradeCount)) +
                    '</span>';
            html += '</div>';
        }

        html += '</div>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // TEAMS
    // ============================================================

    function renderTeamsSection(char, week) {
        var TeamQueries = window.TeamQueries;
        if (!TeamQueries || typeof TeamQueries.getTeamsForCharacter !== 'function') {
            return '';
        }

        var teams = TeamQueries.getTeamsForCharacter(char.id, week) || [];
        if (teams.length === 0) {
            return '';
        }

        var html = '';
        html += '<div class="academy-character-detail-section academy-character-teams">';

        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">Teams</h4>';
        html += '<span class="academy-character-detail-section-count">' + teams.length + '</span>';
        html += '</div>';

        html += '<div class="academy-character-team-list">';

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || !team.id) {
                continue;
            }

            var typeLabel = isNonEmptyString(team.type) ? team.type : 'team';

            html += '<div class="academy-character-team-row" ' +
                        'data-team-id="' + escapeAttribute(team.id) + '">';
            html += '<span class="academy-character-team-name">' +
                        escapeHtml(team.name || 'Unnamed Team') +
                    '</span>';
            html += '<span class="academy-character-team-type">' +
                        escapeHtml(typeLabel) +
                    '</span>';
            html += '</div>';
        }

        html += '</div>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyCharacterDetail = {
        renderHTML: renderHTML
    };

})();