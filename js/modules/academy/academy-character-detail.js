/**
 * modules/academy/academy-character-detail.js - Academy Character Detail Panel
 * Right-panel renderer for the Academy People view (character selected)
 *
 * Path: js/modules/academy/academy-character-detail.js
 *
 * This module is responsible for:
 *   - Rendering the character summary header (name, role badge, status)
 *   - Rendering a mode toggle (Student / Instructor)
 *   - Rendering a tab bar that changes with the mode
 *   - Rendering tab panels:
 *       Student mode:    Main | Disciplines | Grades | Schedule | Teams
 *       Instructor mode: Main | Disciplines | Schedule | Auto-Groups
 *   - Rendering an elimination warning banner when applicable
 *   - Rendering a Drop Out button on the Main tab (student mode only)
 *   - Mounting the inline grades editor into the Grades tab
 *   - Rendering an empty state when no character is selected
 *
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no domain logic
 *   - Receives a character OBJECT (not a view model).
 *   - Uses CharacterQueries, AcademyQueries, EliminationQueries directly.
 *   - Does NOT bind events. Buttons emit data-* and are handled by
 *     AcademyView's delegated container listeners.
 *   - Uses DomUtils for escaping.
 *   - Returns an HTML string.
 *
 * NAME COLLISION:
 *   window.CharacterDetail is already used by the modal in
 *   js/modules/characters/character-detail.js. This module exposes
 *   itself as window.AcademyCharacterDetail.
 *
 * MODE SEMANTICS:
 *   - The panel has two modes: 'student' and 'instructor'.
 *   - The mode is chosen by the caller (AcademyView reads it from
 *     AcademyUI.getCharacterMode) and passed in via options.mode.
 *   - Default when omitted: 'student'.
 *   - The mode is a display toggle. It does NOT mutate the character.
 *
 * TAB SEMANTICS:
 *   - The active tab is chosen by the caller (AcademyView keeps a
 *     module-scoped _activeCharacterTab and passes it via options.tab).
 *   - Default when omitted: 'main'.
 *   - The renderer does not remember state between calls.
 *
 * ELIMINATION WEEK SEMANTICS:
 *   - getEliminationWeek(charId) returns the earliest week the character
 *     was eliminated, considering both explicit elimination records and
 *     the death timeline.
 *   - If it returns null, the character has no elimination on record.
 *   - Warning banner logic:
 *       week > eliminationWeek  → RED    "Eliminated in week N"
 *       week === eliminationWeek → YELLOW "Eliminated this week"
 *       week < eliminationWeek  → no banner
 *
 * INTERFACE:
 *   AcademyCharacterDetail.renderHTML(char, classVM, options) -> string
 *   AcademyCharacterDetail.mountGradesEditor(charId, classVM, options)
 *
 * DEPENDENCIES:
 *   - window.DomUtils (MANDATORY)
 *   - window.CharacterQueries (MANDATORY)
 *   - window.AcademyQueries (MANDATORY)
 *   - window.DisciplineQueries (MANDATORY)
 *   - window.CalendarConstants (MANDATORY)
 *   - window.AcademyGroups (LAZY - optional)
 *   - window.TeamQueries (LAZY - optional)
 *   - window.EliminationQueries (LAZY - optional)
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

    // ============================================================
    // TAB DEFINITIONS
    // ============================================================

    var STUDENT_TABS = [
        { id: 'main',        label: 'Main' },
        { id: 'disciplines', label: 'Disciplines' },
        { id: 'grades',      label: 'Grades' },
        { id: 'schedule',    label: 'Schedule' },
        { id: 'teams',       label: 'Teams' }
    ];

    var INSTRUCTOR_TABS = [
        { id: 'main',        label: 'Main' },
        { id: 'disciplines', label: 'Disciplines' },
        { id: 'schedule',    label: 'Schedule' },
        { id: 'autoGroups',  label: 'Auto-Groups' }
    ];

    var VALID_TABS = {
        main: true,
        disciplines: true,
        grades: true,
        schedule: true,
        teams: true,
        autoGroups: true
    };

    function getTabsForMode(mode) {
        return mode === 'instructor' ? INSTRUCTOR_TABS : STUDENT_TABS;
    }

    function isValidTabForMode(tabId, mode) {
        if (!VALID_TABS[tabId]) { return false; }
        var tabs = getTabsForMode(mode);
        for (var i = 0; i < tabs.length; i++) {
            if (tabs[i].id === tabId) { return true; }
        }
        return false;
    }

    // ============================================================
    // ELIMINATION LOOKUP
    // ============================================================

    function getCharacterEliminationWeek(char) {
        if (!char || !char.id) {
            return null;
        }
        var EQ = window.EliminationQueries;
        if (!EQ || typeof EQ.getEliminationWeek !== 'function') {
            return null;
        }
        try {
            var week = EQ.getEliminationWeek(char);
            if (typeof week !== 'number' || !isFinite(week)) {
                return null;
            }
            return week;
        } catch (e) {
            console.warn('[AcademyCharacterDetail] getEliminationWeek failed:', e);
            return null;
        }
    }

    function getCharacterEliminationReason(char) {
        if (!char || !char.id) {
            return '';
        }
        var EQ = window.EliminationQueries;
        if (!EQ || typeof EQ.getEliminationReason !== 'function') {
            return '';
        }
        try {
            var reason = EQ.getEliminationReason(char);
            return isNonEmptyString(reason) ? reason : '';
        } catch (e) {
            return '';
        }
    }

    function isCharacterEliminated(char, week) {
        if (!char) { return false; }
        var EQ = window.EliminationQueries;
        if (EQ && typeof EQ.isCharacterEliminatedByWeek === 'function') {
            try {
                return EQ.isCharacterEliminatedByWeek(char, week) === true;
            } catch (e) {
                return false;
            }
        }
        // Fallback: check the eliminations array directly.
        if (!Array.isArray(char.eliminations)) { return false; }
        var weekNum = parseInt(week, 10);
        if (isNaN(weekNum)) { return false; }
        for (var i = 0; i < char.eliminations.length; i++) {
            var w = parseInt(char.eliminations[i].week, 10);
            if (!isNaN(w) && w <= weekNum) {
                return true;
            }
        }
        return false;
    }

    // ============================================================
    // ELIMINATION WARNING BANNER
    // ============================================================

    function renderEliminationWarning(char, week) {
        var eliminationWeek = getCharacterEliminationWeek(char);
        if (eliminationWeek === null) {
            return '';
        }

        var displayedWeek = parseInt(week, 10);
        if (isNaN(displayedWeek)) {
            return '';
        }

        if (displayedWeek < eliminationWeek) {
            return '';
        }

        var reason = getCharacterEliminationReason(char);
        var reasonSuffix = reason && reason !== 'Unknown'
            ? ' \u2014 ' + escapeHtml(reason)
            : '';

        if (displayedWeek === eliminationWeek) {
            return (
                '<div class="academy-character-detail-warning academy-warning-elimination-now">' +
                    '<span class="academy-warning-icon">\u26a0</span>' +
                    '<span class="academy-warning-text">' +
                        'Eliminated this week (Week ' + escapeHtml(String(eliminationWeek)) + ')' +
                        reasonSuffix +
                    '</span>' +
                '</div>'
            );
        }

        return (
            '<div class="academy-character-detail-warning academy-warning-eliminated">' +
                '<span class="academy-warning-icon">\u26a0</span>' +
                '<span class="academy-warning-text">' +
                    'Eliminated in Week ' + escapeHtml(String(eliminationWeek)) +
                    reasonSuffix +
                '</span>' +
            '</div>'
        );
    }

    // ============================================================
    // RENDER - Top-level
    // ============================================================

    /**
     * Render the character detail panel.
     *
     * @param {object|null} char - Character object
     * @param {object|null} classVM - Class view model (for role determination)
     * @param {object} [options] - { week, mode, tab }
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
        var mode = (options.mode === 'instructor') ? 'instructor' : 'student';
        var tab = options.tab || 'main';

        if (!isValidTabForMode(tab, mode)) {
            tab = 'main';
        }

        var role = getRoleForCharInClass(char, classVM);

        var html = '';
        html += '<div class="academy-character-detail" ' +
                    'data-character-id="' + escapeAttribute(char.id) + '" ' +
                    'data-mode="' + escapeAttribute(mode) + '">';
        html += renderHeader(char, role, mode);
        html += renderEliminationWarning(char, week);
        html += renderTabBar(mode, tab);
        html += '<div class="academy-character-tab-body">';

        switch (tab) {
            case 'main':
                html += renderMainTab(char, classVM, role, week, mode);
                break;
            case 'disciplines':
                html += renderDisciplinesTab(char, mode, week);
                break;
            case 'grades':
                html += renderGradesTab(char, week);
                break;
            case 'schedule':
                html += renderScheduleTab(char, week);
                break;
            case 'teams':
                html += renderTeamsTab(char, week);
                break;
            case 'autoGroups':
                html += renderAutoGroupsTab(char, week);
                break;
            default:
                html += renderMainTab(char, classVM, role, week, mode);
        }

        html += '</div>';
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

    function renderHeader(char, role, mode) {
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

        // Mode toggle
        html += renderModeToggle(mode);

        // Actions
        html += '<div class="academy-character-detail-actions">';
        html += '<button type="button" class="small primary" ' +
                    'data-action="view-full-character" ' +
                    'data-character-id="' + escapeAttribute(char.id) + '">' +
                    'View Full Profile' +
                '</button>';
        html += '</div>';

        html += '</div>';

        return html;
    }

    function renderModeToggle(mode) {
        var isInstructor = mode === 'instructor';

        var html = '';
        html += '<div class="academy-character-mode-toggle">';
        html += '<label class="academy-mode-checkbox-label">';
        html += '<input type="checkbox" id="academy-character-mode-checkbox" ' +
                    'class="academy-character-mode-checkbox"' +
                    (isInstructor ? ' checked' : '') + '>';
        html += '<span class="academy-mode-checkbox-text">Instructor mode</span>';
        html += '</label>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // TAB BAR
    // ============================================================

    function renderTabBar(mode, activeTab) {
        var tabs = getTabsForMode(mode);

        var html = '';
        html += '<div class="academy-character-tabs">';

        for (var i = 0; i < tabs.length; i++) {
            var t = tabs[i];
            var isActive = t.id === activeTab;
            html += '<button type="button" ' +
                        'class="academy-character-tab-btn' +
                            (isActive ? ' active' : '') + '" ' +
                        'data-tab="' + escapeAttribute(t.id) + '">' +
                        escapeHtml(t.label) +
                    '</button>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // MAIN TAB
    // ============================================================

    function renderMainTab(char, classVM, role, week, mode) {
        var html = '';

        // Class chips
        html += renderClassChips(char);

        // Drop Out button (student mode only)
        if (mode === 'student') {
            html += renderDropOutSection(char, week);
        }

        // Notes / summary
        if (isNonEmptyString(char.notes)) {
            html += '<div class="academy-character-detail-section">';
            html += '<div class="academy-character-detail-section-header">';
            html += '<h4 class="academy-character-detail-section-title">Notes</h4>';
            html += '</div>';
            html += '<p class="academy-character-notes">' + escapeHtml(char.notes) + '</p>';
            html += '</div>';
        }

        return html;
    }

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

    function renderDropOutSection(char, week) {
        var isEliminated = isCharacterEliminated(char, week);

        var html = '';
        html += '<div class="academy-character-detail-section academy-character-dropout-section">';
        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">Enrollment</h4>';
        html += '</div>';

        if (isEliminated) {
            var elimWeek = getCharacterEliminationWeek(char);
            var elimReason = getCharacterEliminationReason(char);
            html += '<div class="academy-dropout-status academy-dropout-status-eliminated">';
            html += '<span class="academy-dropout-status-label">Eliminated</span>';
            if (elimWeek !== null) {
                html += '<span class="academy-dropout-status-detail">Week ' +
                            escapeHtml(String(elimWeek)) +
                        '</span>';
            }
            if (isNonEmptyString(elimReason) && elimReason !== 'Unknown') {
                html += '<span class="academy-dropout-status-detail">' +
                            escapeHtml(elimReason) +
                        '</span>';
            }
            html += '</div>';
        } else {
            html += '<div class="academy-dropout-controls">';
            html += '<button type="button" class="small danger academy-dropout-btn" ' +
                        'data-action="drop-out-character" ' +
                        'data-character-id="' + escapeAttribute(char.id) + '">' +
                        'Drop Out' +
                    '</button>';
            html += '<span class="academy-dropout-hint">' +
                        'Marks this character as eliminated. They remain on the class roster.' +
                    '</span>';
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // DISCIPLINES TAB
    // ============================================================

    function renderDisciplinesTab(char, mode, week) {
        if (mode === 'instructor') {
            return renderInstructorDisciplinesTab(char, week);
        }
        return renderStudentDisciplinesTab(char, week);
    }

    function renderStudentDisciplinesTab(char, week) {
        var html = '';
        html += '<div class="academy-character-detail-section academy-character-disciplines">';

        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">Disciplines</h4>';
        html += '<button type="button" class="small primary" ' +
                    'data-action="enroll-discipline" ' +
                    'data-character-id="' + escapeAttribute(char.id) + '">' +
                    '+ Enroll' +
                '</button>';
        html += '</div>';

        var disciplineIds = (CharacterQueries && typeof CharacterQueries.getCharacterDisciplines === 'function')
            ? CharacterQueries.getCharacterDisciplines(char)
            : (Array.isArray(char.disciplineIds) ? char.disciplineIds.slice() : []);

        if (disciplineIds.length === 0) {
            html += '<p class="empty-state small">Not enrolled in any disciplines.</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="academy-character-discipline-list">';

        // Sort by discipline name.
        var rows = [];
        for (var i = 0; i < disciplineIds.length; i++) {
            var did = disciplineIds[i];
            var name = getDisciplineName(did);
            rows.push({ id: did, name: name });
        }
        rows.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        for (var r = 0; r < rows.length; r++) {
            var row = rows[r];
            html += '<div class="academy-character-discipline-row" ' +
                        'data-discipline-id="' + escapeAttribute(row.id) + '">';
            html += '<span class="academy-character-discipline-name">' +
                        escapeHtml(row.name) +
                    '</span>';
            html += '<button type="button" class="small danger" ' +
                        'data-action="leave-discipline" ' +
                        'data-character-id="' + escapeAttribute(char.id) + '" ' +
                        'data-discipline-id="' + escapeAttribute(row.id) + '">' +
                        'Leave' +
                    '</button>';
            html += '</div>';
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    function renderInstructorDisciplinesTab(char, week) {
        var html = '';
        html += '<div class="academy-character-detail-section academy-character-instructor-disciplines">';

        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">Disciplines I Teach</h4>';
        html += '</div>';

        // Get groups where this char is the instructor.
        var AG = window.AcademyGroups;
        if (!AG || typeof AG.getGroupsByInstructor !== 'function') {
            html += '<p class="empty-state small">Auto-groups module not available.</p>';
            html += '</div>';
            return html;
        }

        var groupsMap = AG.getGroupsByInstructor(char.id) || {};
        var groups = [];
        Object.keys(groupsMap).forEach(function(key) {
            var g = groupsMap[key];
            if (g) {
                groups.push({ key: key, group: g });
            }
        });

        if (groups.length === 0) {
            html += '<p class="empty-state small">Not assigned to teach any disciplines.</p>';
            html += '</div>';
            return html;
        }

        // One row per discipline. If the instructor teaches the same
        // discipline in multiple groups (different classes), show the
        // discipline once with a hint of how many groups they have for it.
        var byDiscipline = {};
        for (var i = 0; i < groups.length; i++) {
            var g = groups[i].group;
            var did = g.disciplineId;
            if (!did) { continue; }
            if (!byDiscipline[did]) {
                byDiscipline[did] = { id: did, groupCount: 0 };
            }
            byDiscipline[did].groupCount++;
        }

        var rows = [];
        Object.keys(byDiscipline).forEach(function(did) {
            rows.push({
                id: did,
                name: getDisciplineName(did),
                groupCount: byDiscipline[did].groupCount
            });
        });
        rows.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        html += '<div class="academy-character-discipline-list">';

        for (var r = 0; r < rows.length; r++) {
            var row = rows[r];
            html += '<div class="academy-character-discipline-row academy-instructor-discipline-row" ' +
                        'data-discipline-id="' + escapeAttribute(row.id) + '">';
            html += '<span class="academy-character-discipline-name">' +
                        escapeHtml(row.name) +
                    '</span>';
            html += '<span class="academy-character-discipline-meta">' +
                        row.groupCount + ' group' + (row.groupCount === 1 ? '' : 's') +
                    '</span>';
            html += '</div>';
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // GRADES TAB
    // ============================================================

    function renderGradesTab(char, week) {
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

        html += '<div id="academy-grades-editor-host" ' +
                    'class="academy-grades-editor-host"></div>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // SCHEDULE TAB (placeholder)
    // ============================================================

    function renderScheduleTab(char, week) {
        var html = '';
        html += '<div class="academy-character-detail-section academy-character-schedule">';
        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">Schedule</h4>';
        html += '<span class="academy-character-detail-section-subtitle">' +
                    'Week ' + escapeHtml(String(week)) +
                '</span>';
        html += '</div>';
        html += '<p class="empty-state small">Schedule view is coming soon.</p>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // TEAMS TAB
    // ============================================================

    function renderTeamsTab(char, week) {
        var TeamQueries = window.TeamQueries;
        if (!TeamQueries || typeof TeamQueries.getTeamsForCharacter !== 'function') {
            return (
                '<div class="academy-character-detail-section">' +
                    '<p class="empty-state small">Team data not available.</p>' +
                '</div>'
            );
        }

        var teams = TeamQueries.getTeamsForCharacter(char.id, week) || [];
        if (teams.length === 0) {
            return (
                '<div class="academy-character-detail-section academy-character-teams">' +
                    '<div class="academy-character-detail-section-header">' +
                        '<h4 class="academy-character-detail-section-title">Teams</h4>' +
                        '<span class="academy-character-detail-section-count">0</span>' +
                    '</div>' +
                    '<p class="empty-state small">Not a member of any teams.</p>' +
                '</div>'
            );
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
    // AUTO-GROUPS TAB (instructor mode)
    // ============================================================

    function renderAutoGroupsTab(char, week) {
        var AG = window.AcademyGroups;
        if (!AG || typeof AG.getGroupsByInstructor !== 'function') {
            return (
                '<div class="academy-character-detail-section">' +
                    '<p class="empty-state small">Auto-groups module not available.</p>' +
                '</div>'
            );
        }

        var groupsMap = AG.getGroupsByInstructor(char.id) || {};
        var groups = [];
        Object.keys(groupsMap).forEach(function(key) {
            var g = groupsMap[key];
            if (g) {
                groups.push({ key: key, group: g });
            }
        });

        if (groups.length === 0) {
            return (
                '<div class="academy-character-detail-section academy-character-auto-groups">' +
                    '<div class="academy-character-detail-section-header">' +
                        '<h4 class="academy-character-detail-section-title">Auto-Groups</h4>' +
                        '<span class="academy-character-detail-section-count">0</span>' +
                    '</div>' +
                    '<p class="empty-state small">Not managing any groups.</p>' +
                '</div>'
            );
        }

        // Sort groups by discipline name.
        groups.sort(function(a, b) {
            var na = getDisciplineName(a.group.disciplineId);
            var nb = getDisciplineName(b.group.disciplineId);
            return (na || '').localeCompare(nb || '');
        });

        var html = '';
        html += '<div class="academy-character-detail-section academy-character-auto-groups">';

        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">Auto-Groups</h4>';
        html += '<span class="academy-character-detail-section-count">' + groups.length + '</span>';
        html += '</div>';

        for (var i = 0; i < groups.length; i++) {
            html += renderInstructorGroupBlock(char, groups[i].key, groups[i].group, week);
        }

        html += '</div>';
        return html;
    }

    function renderInstructorGroupBlock(char, groupKey, group, week) {
        var disciplineName = getDisciplineName(group.disciplineId);
        var students = Array.isArray(group.students) ? group.students : [];

        var html = '';
        html += '<div class="academy-instructor-group" ' +
                    'data-group-key="' + escapeAttribute(groupKey) + '">';

        // Header
        html += '<div class="academy-instructor-group-header">';
        html += '<span class="academy-instructor-group-name">' +
                    escapeHtml(disciplineName) +
                '</span>';
        html += '<span class="academy-instructor-group-count">' +
                    students.length + ' student' + (students.length === 1 ? '' : 's') +
                '</span>';
        html += '<button type="button" class="small primary" ' +
                    'data-action="add-group-student" ' +
                    'data-instructor-id="' + escapeAttribute(char.id) + '" ' +
                    'data-group-key="' + escapeAttribute(groupKey) + '">' +
                    '+ Add Student' +
                '</button>';
        html += '</div>';

        // Roster
        if (students.length === 0) {
            html += '<p class="empty-state small academy-instructor-group-empty">' +
                        'No students in this group yet.' +
                    '</p>';
        } else {
            html += '<div class="academy-instructor-group-roster">';
            for (var i = 0; i < students.length; i++) {
                var sid = students[i];
                var studentName = 'Unknown';
                var studentStatus = '';
                if (CharacterQueries && typeof CharacterQueries.getCharacterById === 'function') {
                    var s = CharacterQueries.getCharacterById(sid);
                    if (s) {
                        studentName = CharacterQueries.getDisplayName(s);
                        studentStatus = CharacterQueries.getCurrentStatus(s);
                    }
                }

                html += '<div class="academy-instructor-group-roster-row" ' +
                            'data-character-id="' + escapeAttribute(sid) + '">';
                html += '<span class="academy-instructor-group-roster-name">' +
                            escapeHtml(studentName) +
                        '</span>';
                if (isNonEmptyString(studentStatus)) {
                    html += '<span class="academy-instructor-group-roster-status">' +
                                escapeHtml(studentStatus) +
                            '</span>';
                }
                html += '<button type="button" class="small danger" ' +
                            'data-action="remove-group-student" ' +
                            'data-group-key="' + escapeAttribute(groupKey) + '" ' +
                            'data-character-id="' + escapeAttribute(sid) + '">' +
                            'Remove' +
                        '</button>';
                html += '</div>';
            }
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // GRADES EDITOR MOUNTING
    // ============================================================

    /**
     * Mount the inline grades editor for a character.
     * Called by AcademyView after the detail panel is inserted into
     * the DOM. Only does anything when the Grades tab is active.
     *
     * @param {string} charId - Character ID
     * @param {object|null} classVM - Class view model (for context)
     * @param {object} options - { week, tab }
     */
    function mountGradesEditor(charId, classVM, options) {
        options = options || {};
        var tab = options.tab || 'main';

        // Only mount when the Grades tab is active.
        if (tab !== 'grades') {
            return;
        }

        var GE = window.AcademyGradesEditor;
        if (!GE || typeof GE.mount !== 'function') {
            return;
        }

        var host = document.getElementById('academy-grades-editor-host');
        if (!host) {
            return;
        }

        var week = options.week || 1;
        var classId = classVM && classVM.id ? classVM.id : null;

        GE.mount(host, charId, classId, week);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyCharacterDetail = {
        renderHTML: renderHTML,
        mountGradesEditor: mountGradesEditor
    };

})();
