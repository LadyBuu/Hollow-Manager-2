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
 *   - Rendering the three performance scores on the Main tab
 *   - Mounting the inline grades editor into the Grades tab
 *   - Rendering an empty state when no character is selected
 *
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no domain logic
 *   - Receives a character OBJECT and a class VM from the caller.
 *   - Uses CharacterQueries, AcademyClasses, AcademyGrades,
 *     AcademyDisciplines, AcademyEnrolments, AcademyPerformance,
 *     AcademySocialScore, AcademyGroups (read aliases),
 *     EliminationQueries, TeamQueries.
 *   - Does NOT use AcademyQueries. That facade was reduced to a
 *     class-only surface and this module no longer depends on it.
 *   - Does NOT bind events. Buttons emit data-* and are handled by
 *     AcademyView's delegated container listeners.
 *   - Uses DomUtils for escaping (mandatory, no fallbacks).
 *   - Returns an HTML string.
 *
 * NAME COLLISION:
 *   window.CharacterDetail is already used by the modal in
 *   js/modules/characters/character-detail.js. This module exposes
 *   itself as window.AcademyCharacterDetail.
 *
 * ENROLLMENT MODEL (Phase 4):
 *   - The Disciplines tab (STUDENT MODE) reads enrollment from
 *     AcademyEnrolments. Enrollment is CLASS-SCOPED:
 *     getStudentDisciplines(charId, classId).
 *   - The classId is provided via options.classId by AcademyView.
 *   - When options.classId is absent, the Disciplines tab renders an
 *     empty state asking the user to select a class.
 *   - character.disciplineIds is NOT read.
 *
 * INSTRUCTOR DISCIPLINES MODEL:
 *   - The Disciplines tab (INSTRUCTOR MODE) reads from
 *     AcademyDisciplines.getDisciplinesByInstructor(instructorId),
 *     which reads `discipline.instructorIds[]`. This is what the
 *     discipline editor writes.
 *   - The Auto-Groups tab reads from AcademyGroups, which reads
 *     autoGroups. Auto-groups are a distinct concept: the instructor's
 *     grouped students for a discipline.
 *   - Both tabs are shown in instructor mode and describe complementary
 *     relationships:
 *       Disciplines = what the instructor is assigned to teach
 *       Auto-Groups = which student groups they run
 *   - Reading disciplines from auto-groups would be wrong: assignment
 *     is not the same as grouping, and an assigned instructor with no
 *     group would appear to have no disciplines.
 *
 * GRADE-VIEW MODEL:
 *   - Grades are CLASS-SCOPED. The Grades tab shows only the grades
 *     for the currently selected class via
 *     AcademyGrades.getStudentClassGrades(charId, classId).
 *   - When options.classId is absent, the Grades tab renders the
 *     same empty state as the Disciplines tab.
 *
 * PERFORMANCE MODEL (Phase 3):
 *   - Academic average comes from AcademyPerformance.
 *   - Social score comes from AcademySocialScore.
 *   - Overall score comes from AcademyPerformance.calculateOverallScore,
 *     which blends academic and social using academy.settings.ranking.
 *   - All three are display-only. This module does not compute them.
 *
 * MODE SEMANTICS:
 *   - The panel has two modes: 'student' and 'instructor'.
 *   - The mode is chosen by the caller (AcademyView reads it from
 *     AcademyUI.getCharacterMode and passes it via options.mode).
 *   - Default when omitted: 'student'.
 *   - The mode is a DISPLAY toggle. It does NOT mutate the character.
 *   - The role BADGE follows the mode, not the class roster. When the
 *     user flips the toggle to instructor, the badge reads "Instructor"
 *     even if the class roster would say otherwise. This matches the
 *     user's mental model of "I am viewing this character as an
 *     instructor right now". The class roster remains authoritative
 *     for the People list and any other class-scoped projection.
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
 *   - window.DomUtils              (MANDATORY)
 *   - window.CharacterQueries      (MANDATORY)
 *   - window.AcademyClasses        (MANDATORY)
 *   - window.AcademyGrades         (MANDATORY)
 *   - window.AcademyEnrolments     (LAZY)
 *   - window.AcademyDisciplines    (MANDATORY)
 *   - window.AcademyPerformance    (LAZY)
 *   - window.AcademySocialScore    (LAZY)
 *   - window.AcademyGroups         (LAZY, for auto-group reads)
 *   - window.TeamQueries           (LAZY)
 *   - window.EliminationQueries    (LAZY)
 *   - window.CalendarConstants     (MANDATORY)
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
    var AcademyClasses = window.AcademyClasses;
    var AcademyGrades = window.AcademyGrades;
    var AcademyDisciplines = window.AcademyDisciplines;
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

        if (!AcademyClasses || typeof AcademyClasses.getCharacterClasses !== 'function') {
            missing.push('AcademyClasses.getCharacterClasses');
        }
        if (!AcademyClasses || typeof AcademyClasses.getDisplayName !== 'function') {
            missing.push('AcademyClasses.getDisplayName');
        }

        if (!AcademyGrades || typeof AcademyGrades.getStudentClassGrades !== 'function') {
            missing.push('AcademyGrades.getStudentClassGrades');
        }
        if (!AcademyGrades || typeof AcademyGrades.calculateSummary !== 'function') {
            missing.push('AcademyGrades.calculateSummary');
        }

        if (!AcademyDisciplines || typeof AcademyDisciplines.getDiscipline !== 'function') {
            missing.push('AcademyDisciplines.getDiscipline');
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
    // LAZY ACCESSORS
    // ============================================================

    function getAcademyEnrolments() { return window.AcademyEnrolments || null; }
    function getAcademyPerformance() { return window.AcademyPerformance || null; }
    function getAcademySocialScore() { return window.AcademySocialScore || null; }
    function getAcademyGroups() { return window.AcademyGroups || null; }

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

    function isFiniteNumber(value) {
        return typeof value === 'number' && isFinite(value);
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
        var discipline = AcademyDisciplines.getDiscipline(disciplineId);
        return discipline && discipline.name ? discipline.name : 'Unknown';
    }

    function getClassDisplayName(classId) {
        if (!isNonEmptyString(classId)) {
            return 'Unknown Class';
        }
        return AcademyClasses.getDisplayName(classId) || 'Unknown Class';
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
        var classId = options.classId ? String(options.classId) : null;

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
                html += renderMainTab(char, classVM, role, week, mode, classId);
                break;
            case 'disciplines':
                html += renderDisciplinesTab(char, mode, week, classId);
                break;
            case 'grades':
                html += renderGradesTab(char, week, classId);
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
                html += renderMainTab(char, classVM, role, week, mode, classId);
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
    //
    // The role BADGE follows the MODE, not the class-derived role.
    //
    // Rationale: the mode toggle is the user's assertion about how
    // they want to view this character. When they flip it to
    // Instructor, they are explicitly saying "treat this character
    // as an instructor for this panel". The badge should match that
    // assertion. The class roster (classVM.students[].role) remains
    // authoritative for the People list and for any other
    // class-scoped projection; the badge here is a display element
    // scoped to this panel.
    //
    // The `role` parameter is retained because the caller computes it
    // and we may want to display it elsewhere later (e.g. as a
    // secondary hint when the class role disagrees with the mode).

    function renderHeader(char, role, mode) {
        var displayName = CharacterQueries.getDisplayName(char);
        var status = CharacterQueries.getCurrentStatus(char);

        // Badge follows the mode, not the class role.
        var displayRole = mode === 'instructor' ? 'instructor' : 'trainee';

        var html = '';
        html += '<div class="academy-character-detail-header">';

        html += '<div class="academy-character-detail-title-row">';
        html += '<h3 class="academy-character-detail-title">' + escapeHtml(displayName) + '</h3>';
        html += '<span class="' + getRoleBadgeClass(displayRole) + '">' +
                    escapeHtml(getRoleLabel(displayRole)) +
                '</span>';
        html += '</div>';

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

        html += renderModeToggle(mode);

        html += '</div>';

        return html;
    }

    function renderModeToggle(mode) {
        var isInstructor = mode === 'instructor';

        var html = '';
        html += '<div class="academy-character-mode-toggle">';
        html += '<label class="academy-mode-checkbox-label" for="academy-character-mode-checkbox">';
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

    function renderMainTab(char, classVM, role, week, mode, classId) {
        var html = '';

        // Class chips.
        html += renderClassChips(char);

        // Performance scores (student mode only).
        if (mode === 'student' && classId) {
            html += renderPerformanceScores(char, classId, week);
        }

        // Drop Out button (student mode only).
        if (mode === 'student') {
            html += renderDropOutSection(char, week);
        }

        // Notes.
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
        var classes = AcademyClasses.getCharacterClasses(char);
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
    // PERFORMANCE SCORES (Phase 5)
    // ============================================================

    function renderPerformanceScores(char, classId, week) {
        var academic = null;
        var social = null;
        var overall = null;

        // ---- Academic ----
        var AP = getAcademyPerformance();
        if (AP && typeof AP.calculateAcademicAverage === 'function') {
            try {
                var academicResult = AP.calculateAcademicAverage(char.id, classId, week);
                if (academicResult && typeof academicResult.average === 'number') {
                    academic = academicResult.average;
                }
            } catch (e) {
                console.warn('[AcademyCharacterDetail] calculateAcademicAverage failed:', e);
            }
        }

        // ---- Social ----
        var ASS = getAcademySocialScore();
        if (ASS && typeof ASS.getSocialScore === 'function') {
            try {
                var socialResult = ASS.getSocialScore(char.id, classId, week);
                if (typeof socialResult === 'number' && isFinite(socialResult)) {
                    social = socialResult;
                }
            } catch (e) {
                console.warn('[AcademyCharacterDetail] getSocialScore failed:', e);
            }
        }

        // ---- Overall ----
        if (AP && typeof AP.calculateOverallScore === 'function') {
            try {
                var overallResult = AP.calculateOverallScore(char.id, classId, week);
                if (typeof overallResult === 'number' && isFinite(overallResult)) {
                    overall = overallResult;
                }
            } catch (e) {
                console.warn('[AcademyCharacterDetail] calculateOverallScore failed:', e);
            }
        }

        var html = '';
        html += '<div class="academy-character-detail-section academy-character-scores">';
        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">Performance</h4>';
        html += '<span class="academy-character-detail-section-subtitle">' +
                    'Week ' + escapeHtml(String(week)) +
                '</span>';
        html += '</div>';

        html += '<div class="academy-score-grid">';

        html += renderScoreCard(
            'Academic Average',
            academic,
            'academic-average'
        );

        html += renderScoreCard(
            'Social Score',
            social,
            'social-score',
            {
                action: 'edit-social-score',
                characterId: char.id,
                label: 'Edit'
            }
        );

        html += renderScoreCard(
            'Overall',
            overall,
            'overall-score'
        );

        html += '</div>';
        html += '</div>';

        return html;
    }

    function renderScoreCard(label, value, kind, action) {
        var hasValue = typeof value === 'number' && isFinite(value);
        var display = hasValue ? String(Math.round(value * 10) / 10) : '\u2014';
        var valueClass = 'academy-score-value academy-score-value-' + kind;
        if (!hasValue) {
            valueClass += ' academy-score-value-empty';
        }

        var html = '';
        html += '<div class="academy-score-card academy-score-card-' + kind + '">';
        html += '<div class="academy-score-label">' + escapeHtml(label) + '</div>';
        html += '<div class="' + valueClass + '">' + escapeHtml(display) + '</div>';

        if (action && action.action) {
            html += '<div class="academy-score-actions">';
            html += '<button type="button" class="small secondary" ' +
                        'data-action="' + escapeAttribute(action.action) + '" ' +
                        (action.characterId
                            ? 'data-character-id="' + escapeAttribute(action.characterId) + '" '
                            : '') +
                        '>' +
                        escapeHtml(action.label || 'Edit') +
                    '</button>';
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // DROP OUT SECTION
    // ============================================================

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

    function renderDisciplinesTab(char, mode, week, classId) {
        if (mode === 'instructor') {
            return renderInstructorDisciplinesTab(char, week);
        }
        return renderStudentDisciplinesTab(char, week, classId);
    }

    function renderStudentDisciplinesTab(char, week, classId) {
        var html = '';
        html += '<div class="academy-character-detail-section academy-character-disciplines">';

        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">Disciplines</h4>';

        if (classId) {
            html += '<button type="button" class="small primary" ' +
                        'data-action="enroll-discipline" ' +
                        'data-character-id="' + escapeAttribute(char.id) + '">' +
                        '+ Enroll' +
                    '</button>';
        }
        html += '</div>';

        if (!classId) {
            html += '<p class="empty-state small">' +
                        'Select a class to view this student\'s enrollment.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        var AE = getAcademyEnrolments();
        if (!AE || typeof AE.getStudentDisciplines !== 'function') {
            html += '<p class="empty-state small">' +
                        'Enrollment module not available.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        var disciplineIds = AE.getStudentDisciplines(char.id, classId) || [];

        if (disciplineIds.length === 0) {
            html += '<p class="empty-state small">' +
                        'Not enrolled in any disciplines for this class.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        html += '<div class="academy-character-discipline-list">';

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

    /**
     * Instructor Disciplines tab.
     *
     * Reads the instructor's ASSIGNED disciplines from
     * AcademyDisciplines.getDisciplinesByInstructor(instructorId),
     * which reads `discipline.instructorIds[]`. That is the
     * canonical assignment relationship, written by the discipline
     * editor.
     *
     * This is NOT the same as the Auto-Groups tab. Auto-groups are
     * the instructor's grouped students, read separately from
     * AcademyGroups. A discipline assignment and an auto-group are
     * independent facts:
     *   - An instructor can be assigned to a discipline without
     *     having created any group yet.
     *   - An auto-group can outlive a discipline assignment if the
     *     discipline editor is changed.
     *
     * Reading disciplines from auto-groups would hide instructors
     * who are assigned but not yet grouping, which is exactly what
     * the previous implementation did.
     */
    function renderInstructorDisciplinesTab(char, week) {
        var html = '';
        html += '<div class="academy-character-detail-section academy-character-instructor-disciplines">';

        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">Disciplines I Teach</h4>';
        html += '</div>';

        if (!AcademyDisciplines || typeof AcademyDisciplines.getDisciplinesByInstructor !== 'function') {
            html += '<p class="empty-state small">' +
                        'Discipline module not available.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        var disciplines = AcademyDisciplines.getDisciplinesByInstructor(char.id) || [];

        if (disciplines.length === 0) {
            html += '<p class="empty-state small">' +
                        'Not assigned to teach any disciplines.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        // Sort alphabetically for stable output.
        disciplines = disciplines.slice().sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        html += '<div class="academy-character-discipline-list">';

        for (var i = 0; i < disciplines.length; i++) {
            var d = disciplines[i];
            if (!d || !d.id) { continue; }

            html += '<div class="academy-character-discipline-row academy-instructor-discipline-row" ' +
                        'data-discipline-id="' + escapeAttribute(d.id) + '">';
            html += '<span class="academy-character-discipline-name">' +
                        escapeHtml(d.name || 'Unnamed Discipline') +
                    '</span>';

            // Show the discipline type as a small meta hint.
            if (isNonEmptyString(d.type)) {
                html += '<span class="academy-character-discipline-meta">' +
                            escapeHtml(d.type) +
                        '</span>';
            }

            html += '</div>';
        }

        html += '</div>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // GRADES TAB
    // ============================================================
    //
    // Grades are CLASS-SCOPED. The tab shows only the currently
    // selected class's grades via AcademyGrades.getStudentClassGrades.
    //
    // When classId is absent, the tab renders the same empty state as
    // the Disciplines tab. The grades editor is only mountable when
    // both the character and a class are selected.

    function renderGradesTab(char, week, classId) {
        var html = '';
        html += '<div class="academy-character-detail-section academy-character-grades">';

        html += '<div class="academy-character-detail-section-header">';
        html += '<h4 class="academy-character-detail-section-title">Grades</h4>';

        if (!classId) {
            html += '</div>';
            html += '<p class="empty-state small">' +
                        'Select a class to view this student\'s grades.' +
                    '</p>';
            html += '</div>';
            return html;
        }

        var grades = AcademyGrades.getStudentClassGrades(char.id, classId) || [];
        var summary = AcademyGrades.calculateSummary(grades);

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
    //
    // Auto-groups are the instructor's grouped students, per
    // discipline. This is a DIFFERENT relationship from discipline
    // assignment (see renderInstructorDisciplinesTab). An instructor
    // may be assigned to a discipline without having created any
    // groups yet, and may have groups that were created before the
    // discipline assignment was changed.

    function renderAutoGroupsTab(char, week) {
        var AG = getAcademyGroups();
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
     * @param {object} options - { week, tab, classId }
     */
    function mountGradesEditor(charId, classVM, options) {
        options = options || {};
        var tab = options.tab || 'main';

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
        var classId = options.classId
            ? String(options.classId)
            : (classVM && classVM.id ? classVM.id : null);

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
