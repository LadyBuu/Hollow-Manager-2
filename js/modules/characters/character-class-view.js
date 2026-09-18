/**
 * modules/characters/character-class-view.js - Character Class View
 * Renders the Academic tab for the character form
 * Path: js/modules/characters/character-class-view.js
 *
 * This module is responsible for:
 *   - The entire Academic tab layout for the character form
 *   - The class dropdown (add to class)
 *   - Class tags with role labels (Trainee / Instructor)
 *   - Academic team memberships (historical)
 *   - Enrolled disciplines per class (Phase 4 model)
 *   - The grades table (discipline / class / week / score)
 *   - The elimination status banner (year-scoped)
 *   - Tournament eliminations list
 *   - Standalone eliminations list (with remove button)
 *   - Populating the character list's class filter dropdown
 *
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no persistence
 *   - Uses AcademyClasses for class data
 *   - Uses AcademyGrades.getStudentClassGrades for the grades table
 *   - Uses AcademyEnrolments.getStudentDisciplines for enrollment
 *   - Uses AcademyDisciplines for discipline names
 *   - Uses TeamQueries for team lookups
 *   - Uses CharacterQueries for character data
 *   - Uses EliminationQueries for elimination reads
 *   - Uses TournamentQueries for tournament name resolution
 *   - Uses CalendarValidation for week parsing
 *   - Uses DomUtils for safe DOM operations
 *   - All user-controlled content uses textContent
 *   - No event binding here (delegated to CharacterEvents)
 *
 * REFRESH CONTRACT:
 *   - renderAcademicTab(char, container) is the SINGLE rendering entry
 *     point for the Academic tab. Callers (character-form.js on form
 *     render, character-events.js on refresh) MUST use this function
 *     and MUST NOT call the individual section renderers directly.
 *   - The section renderers (renderAddClassSection, renderClassesSection,
 *     renderAcademicTeamsSection, renderEnrollmentSection,
 *     renderGradesSection, renderEliminationStatusSection,
 *     renderTournamentEliminationsSection,
 *     renderStandaloneEliminationsSection) are implementation details.
 *     They are exported for testing only.
 *
 * ELIMINATION OWNERSHIP:
 *   Reads route through EliminationQueries. Writes route through
 *   AcademyEliminations (addStandalone) and
 *   TournamentEliminationCascade (all tournament-driven paths).
 *   This module is a renderer; it does not own any elimination data.
 *
 *   The standalone eliminations list emits a click action
 *   (`data-action="remove-standalone-elim"`) with
 *   `data-elimination-id`. CharacterEvents handles the click and calls
 *   AcademyEliminations.removeStandalone. This module does not bind
 *   listeners.
 *
 * CLASS FILTER CONTRACT:
 *   - populateClassFilter() populates #char-class-filter (the class
 *     filter in the character list sidebar). It is idempotent and
 *     preserves the current selection if the selected class still
 *     exists.
 *   - Called by characters/index.js on mount.
 *
 * ENROLLMENT MODEL (Phase 4):
 *   - Enrollment is CLASS-SCOPED. Source of truth is
 *     AcademyEnrolments.getStudentDisciplines(charId, classId).
 *   - character.disciplineIds is dead and is NOT read here.
 *
 * ROLE LABELS:
 *   - A character is an "Instructor" for a class when
 *     class.instructorId === char.id.
 *   - Otherwise the character is a "Trainee" for that class.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.AcademyClasses
 *   - window.AcademyGrades
 *   - window.AcademyEnrolments
 *   - window.AcademyDisciplines
 *   - window.CharacterQueries
 *   - window.DomUtils
 *   - window.TeamQueries
 *
 * DEPENDENCIES (LAZY):
 *   - window.EliminationQueries      (elimination reads)
 *   - window.TournamentQueries       (tournament name resolution)
 *   - window.CalendarValidation      (week parsing)
 *   - window.DisciplineQueries       (fallback discipline name lookup)
 */

(function() {
    'use strict';

    if (window.__characterClassViewLoaded) {
        return;
    }
    window.__characterClassViewLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var AcademyClasses = window.AcademyClasses;
    var AcademyGrades = window.AcademyGrades;
    var AcademyEnrolments = window.AcademyEnrolments;
    var AcademyDisciplines = window.AcademyDisciplines;
    var CharacterQueries = window.CharacterQueries;
    var DomUtils = window.DomUtils;
    var TeamQueries = window.TeamQueries;

    // ============================================================
    // LAZY DEPENDENCY ACCESSORS
    // ============================================================

    function getEliminationQueries() {
        return window.EliminationQueries || null;
    }

    function getTournamentQueries() {
        return window.TournamentQueries || null;
    }

    function getCalendarValidation() {
        return window.CalendarValidation || null;
    }

    function getDisciplineQueries() {
        return window.DisciplineQueries || null;
    }

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademyClasses || typeof AcademyClasses.getClasses !== 'function') {
            missing.push('AcademyClasses.getClasses');
        }
        if (!AcademyClasses || typeof AcademyClasses.getCharacterClasses !== 'function') {
            missing.push('AcademyClasses.getCharacterClasses');
        }

        if (!AcademyGrades || typeof AcademyGrades.getStudentClassGrades !== 'function') {
            missing.push('AcademyGrades.getStudentClassGrades');
        }

        if (!AcademyEnrolments || typeof AcademyEnrolments.getStudentDisciplines !== 'function') {
            missing.push('AcademyEnrolments.getStudentDisciplines');
        }

        if (!AcademyDisciplines || typeof AcademyDisciplines.getDiscipline !== 'function') {
            missing.push('AcademyDisciplines.getDiscipline');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }

        if (!DomUtils || typeof DomUtils.createElement !== 'function') {
            missing.push('DomUtils.createElement');
        }

        // TeamQueries, EliminationQueries, TournamentQueries, and
        // CalendarValidation are used but degrade gracefully. They
        // are not required for the module to load.

        if (missing.length > 0) {
            throw new Error('[CharacterClassView] Missing dependencies: ' + missing.join(', '));
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HELPERS
    // ============================================================

    function getNormalisedClassIds(char) {
        if (!char) {
            return [];
        }
        if (!Array.isArray(char.classIds)) {
            return [];
        }

        var seen = {};
        var result = [];
        for (var i = 0; i < char.classIds.length; i++) {
            var id = char.classIds[i];
            if (id === undefined || id === null || id === '') {
                continue;
            }
            var key = String(id);
            if (seen[key]) {
                continue;
            }
            seen[key] = true;
            result.push(id);
        }
        return result;
    }

    function getClassById(classId) {
        if (!classId || !AcademyClasses) {
            return null;
        }
        return AcademyClasses.getClass(classId);
    }

    function getClassDisplayName(classId) {
        if (!classId || !AcademyClasses) {
            return 'Unknown Class';
        }
        if (typeof AcademyClasses.getDisplayName === 'function') {
            return AcademyClasses.getDisplayName(classId) || 'Unknown Class';
        }
        var cls = getClassById(classId);
        return cls ? (cls.name || 'Unnamed Class') : 'Unknown Class';
    }

    function getClassRoleLabel(cls, charId) {
        if (!cls || !charId) {
            return 'Trainee';
        }
        if (cls.instructorId && String(cls.instructorId) === String(charId)) {
            return 'Instructor';
        }
        return 'Trainee';
    }

    function formatPeriod(join, leave, prefix) {
        prefix = prefix || '';
        var joinStr = (join !== undefined && join !== null && join !== '') ? String(join) : '';
        var leaveStr = (leave !== undefined && leave !== null && leave !== '') ? String(leave) : '';

        if (joinStr && leaveStr) { return prefix + joinStr + ' \u2192 ' + prefix + leaveStr; }
        if (joinStr) { return prefix + joinStr + ' \u2192 Present'; }
        if (leaveStr) { return 'Until ' + prefix + leaveStr; }
        return '';
    }

    function getDisciplineName(disciplineId) {
        if (!disciplineId) { return 'Unknown'; }

        if (AcademyDisciplines && typeof AcademyDisciplines.getDiscipline === 'function') {
            var d = AcademyDisciplines.getDiscipline(disciplineId);
            if (d && d.name) { return d.name; }
        }

        var DQ = getDisciplineQueries();
        if (DQ && typeof DQ.getDiscipline === 'function') {
            var d2 = DQ.getDiscipline(disciplineId);
            if (d2 && d2.name) { return d2.name; }
        }

        return 'Unknown';
    }

    /**
     * Get the numeric percentage of a grade record.
     * Grades are stored as score + maxScore. Percentage is derived.
     * Prefers the derived `percentage` field when present (from
     * AcademyGrades.decorateGrade); otherwise computes it here.
     */
    function getGradePercentage(grade) {
        if (!grade) { return null; }
        if (typeof grade.percentage === 'number' && isFinite(grade.percentage)) {
            return grade.percentage;
        }
        var score = Number(grade.score);
        var max = Number(grade.maxScore);
        if (isFinite(score) && isFinite(max) && max > 0) {
            return Math.round((score / max) * 100);
        }
        return null;
    }

    /**
     * Resolve a tournament ID to its display name.
     *
     * Uses TournamentQueries.getTournament. Returns
     * 'Unknown Tournament' when the ID is missing, the query module is
     * unavailable, or the tournament does not exist.
     */
    function getTournamentName(tournamentId) {
        if (!tournamentId) {
            return 'Unknown Tournament';
        }

        var TQ = getTournamentQueries();
        if (!TQ || typeof TQ.getTournament !== 'function') {
            return 'Unknown Tournament';
        }

        var tourn = null;
        try {
            tourn = TQ.getTournament(tournamentId);
        } catch (e) {
            console.warn(
                '[CharacterClassView] getTournament failed:',
                tournamentId,
                e
            );
            return 'Unknown Tournament';
        }

        if (tourn) {
            return tourn.name || 'Unknown Tournament';
        }

        return 'Unknown Tournament';
    }

    // ============================================================
    // SHAPE FILTERS
    // ============================================================
    //
    // These are LOCAL predicates on the eliminations array. They
    // split records by shape (standalone vs tournament). They do not
    // consult EliminationQueries; the query module answers semantic
    // questions like "is this character eliminated as of year Y."

    function getTournamentEliminations(char) {
        if (!char || !Array.isArray(char.eliminations)) {
            return [];
        }
        var result = [];
        for (var i = 0; i < char.eliminations.length; i++) {
            var e = char.eliminations[i];
            if (e && !e.standalone) {
                result.push(e);
            }
        }
        return result;
    }

    function getStandaloneEliminations(char) {
        if (!char || !Array.isArray(char.eliminations)) {
            return [];
        }
        var result = [];
        for (var i = 0; i < char.eliminations.length; i++) {
            var e = char.eliminations[i];
            if (e && e.standalone) {
                result.push(e);
            }
        }
        return result;
    }

    // ============================================================
    // CLASS FILTER (character list sidebar)
    // ============================================================

    /**
     * Populate #char-class-filter with all classes.
     *
     * Idempotent: safe to call multiple times. Preserves the current
     * selection if the selected class still exists. Falls back to
     * 'all' if the selected class has disappeared.
     */
    function populateClassFilter() {
        var select = document.getElementById('char-class-filter');
        if (!select) {
            return;
        }

        var previousValue = select.value || 'all';

        var allClasses = [];
        if (AcademyClasses && typeof AcademyClasses.getClasses === 'function') {
            allClasses = AcademyClasses.getClasses() || [];
        }

        var sorted = allClasses.slice().sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        select.textContent = '';

        var allOption = document.createElement('option');
        allOption.value = 'all';
        allOption.textContent = 'All Classes';
        select.appendChild(allOption);

        for (var i = 0; i < sorted.length; i++) {
            var cls = sorted[i];
            if (!cls || !cls.id) {
                continue;
            }
            var option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.name || 'Unnamed Class';
            select.appendChild(option);
        }

        var stillExists = false;
        for (var j = 0; j < select.options.length; j++) {
            if (select.options[j].value === previousValue) {
                stillExists = true;
                break;
            }
        }
        select.value = stillExists ? previousValue : 'all';
    }

    // ============================================================
    // ACADEMIC TAB — Combined render
    // ============================================================

    /**
     * Render the entire Academic tab for a character.
     *
     * @param {object} char - Character object (or null)
     * @param {HTMLElement} container - Container element
     */
    function renderAcademicTab(char, container) {
        if (!container) {
            container = document.getElementById('academic-class-view');
        }
        if (!container) {
            return;
        }

        container.textContent = '';

        if (!char) {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText = 'padding:8px;font-size:0.8rem;';
            empty.textContent = 'Select a character to view academic data.';
            container.appendChild(empty);
            return;
        }

        container.appendChild(renderAddClassSection(char));
        container.appendChild(renderClassesSection(char));
        container.appendChild(renderEliminationStatusSection(char));
        container.appendChild(renderAcademicTeamsSection(char));
        container.appendChild(renderEnrollmentSection(char));
        container.appendChild(renderGradesSection(char));
        container.appendChild(renderTournamentEliminationsSection(char));
        container.appendChild(renderStandaloneEliminationsSection(char));
    }

    // ============================================================
    // SECTION 1 — Add to class dropdown
    // ============================================================

    function renderAddClassSection(char) {
        var section = document.createElement('div');
        section.className = 'academic-section academic-add-class';
        section.style.cssText = 'margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border-soft);';

        var label = document.createElement('label');
        label.style.cssText = 'font-size:0.75rem;color:var(--accent);font-weight:600;display:block;margin-bottom:6px;';
        label.textContent = 'Add to Class';
        section.appendChild(label);

        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:6px;align-items:center;';

        var select = document.createElement('select');
        select.id = 'academic-class-select';
        select.style.cssText = 'flex:1;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;';

        var placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select a class...';
        select.appendChild(placeholder);

        var allClasses = [];
        if (AcademyClasses && typeof AcademyClasses.getClasses === 'function') {
            allClasses = AcademyClasses.getClasses() || [];
        }

        var existingIds = getNormalisedClassIds(char);
        var existingSet = {};
        for (var e = 0; e < existingIds.length; e++) {
            existingSet[String(existingIds[e])] = true;
        }

        var available = allClasses.filter(function(cls) {
            return cls && cls.id && !existingSet[String(cls.id)];
        });

        available.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        available.forEach(function(cls) {
            var option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.name || 'Unnamed Class';
            select.appendChild(option);
        });

        if (available.length === 0) {
            var noOptions = document.createElement('option');
            noOptions.value = '';
            noOptions.disabled = true;
            noOptions.textContent = 'No more classes available';
            select.appendChild(noOptions);
            select.disabled = true;
        }

        row.appendChild(select);

        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.id = 'academic-class-add-btn';
        addBtn.className = 'primary small';
        addBtn.textContent = '+ Add';
        addBtn.style.cssText = 'padding:6px 12px;font-size:0.75rem;';
        if (available.length === 0) {
            addBtn.disabled = true;
        }
        row.appendChild(addBtn);

        section.appendChild(row);
        return section;
    }

    // ============================================================
    // SECTION 2 — Classes with role labels
    // ============================================================

    function renderClassesSection(char) {
        var section = document.createElement('div');
        section.className = 'academic-section academic-classes';
        section.style.cssText = 'margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border-soft);';

        var heading = document.createElement('div');
        heading.style.cssText = 'font-size:0.75rem;color:var(--accent);font-weight:600;margin-bottom:6px;';
        heading.textContent = 'Classes';
        section.appendChild(heading);

        var classIds = getNormalisedClassIds(char);

        if (classIds.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText = 'padding:4px;font-size:0.7rem;color:var(--text-dim);';
            empty.textContent = 'Not part of any class.';
            section.appendChild(empty);
            return section;
        }

        var tagContainer = document.createElement('div');
        tagContainer.id = 'class-tag-container';
        tagContainer.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';

        classIds.forEach(function(classId) {
            var cls = getClassById(classId);
            if (!cls) {
                var orphan = document.createElement('span');
                orphan.className = 'class-tag class-tag-orphan';
                orphan.dataset.classId = classId;
                orphan.style.cssText = 'background:var(--danger-soft, #5c2a2a);padding:2px 8px;border-radius:10px;font-size:0.7rem;border:1px solid var(--danger);display:inline-flex;align-items:center;gap:4px;color:var(--danger);';
                orphan.textContent = 'Unknown class (' + classId + ')';

                var orphanBtn = document.createElement('button');
                orphanBtn.className = 'remove-class-tag';
                orphanBtn.dataset.id = classId;
                orphanBtn.textContent = '\u2715';
                orphanBtn.style.cssText = 'background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.5rem;padding:0 2px;';
                orphanBtn.setAttribute('aria-label', 'Remove orphaned class reference');
                orphan.appendChild(orphanBtn);

                tagContainer.appendChild(orphan);
                return;
            }

            var roleLabel = getClassRoleLabel(cls, char.id);
            var tag = document.createElement('span');
            tag.className = 'class-tag';
            tag.style.cssText = 'background:var(--accent-soft);padding:2px 8px;border-radius:10px;font-size:0.7rem;border:1px solid var(--accent);display:inline-flex;align-items:center;gap:4px;';
            tag.dataset.classId = cls.id;

            var nameSpan = document.createElement('span');
            nameSpan.textContent = cls.name;
            tag.appendChild(nameSpan);

            var roleSpan = document.createElement('span');
            roleSpan.style.cssText = 'color:var(--text-dim);font-size:0.6rem;font-style:italic;';
            roleSpan.textContent = '(' + roleLabel + ')';
            tag.appendChild(roleSpan);

            var removeBtn = document.createElement('button');
            removeBtn.className = 'remove-class-tag';
            removeBtn.dataset.id = cls.id;
            removeBtn.textContent = '\u2715';
            removeBtn.style.cssText = 'background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.5rem;padding:0 2px;';
            removeBtn.setAttribute('aria-label', 'Remove ' + cls.name);
            tag.appendChild(removeBtn);

            tagContainer.appendChild(tag);
        });

        section.appendChild(tagContainer);
        return section;
    }

    // ============================================================
    // SECTION 3 — Elimination status banner
    // ============================================================
    //
    // Year-scoped. The banner is the most important fact about the
    // character's academic record: whether they have been knocked out
    // of the competitive exam sequence, and as of which year.

    function renderEliminationStatusSection(char) {
        var section = document.createElement('div');
        section.className = 'academic-section academic-elimination-status';
        section.style.cssText = 'margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border-soft);';

        var EQ = getEliminationQueries();
        if (!EQ || typeof EQ.isCharacterEliminatedByYear !== 'function') {
            return section;
        }

        var yearNum = resolveCurrentYear();

        var eliminated = false;
        try {
            eliminated = EQ.isCharacterEliminatedByYear(char, yearNum) === true;
        } catch (e) {
            console.warn(
                '[CharacterClassView] isCharacterEliminatedByYear threw:', e
            );
            eliminated = false;
        }

        var elimYear = null;
        if (typeof EQ.getEliminationYear === 'function') {
            try { elimYear = EQ.getEliminationYear(char); }
            catch (e) { elimYear = null; }
        }

        var elimWeek = null;
        if (typeof EQ.getEliminationWeek === 'function') {
            try { elimWeek = EQ.getEliminationWeek(char); }
            catch (e) { elimWeek = null; }
        }

        var reason = 'Unknown';
        if (typeof EQ.getEliminationReason === 'function') {
            try { reason = EQ.getEliminationReason(char) || 'Unknown'; }
            catch (e) { reason = 'Unknown'; }
        }

        var banner = document.createElement('div');
        banner.className = 'academic-elimination-banner';
        banner.style.cssText =
            'padding:8px 12px;background:var(--bg);border-radius:4px;' +
            'border-left:4px solid ' +
            (eliminated ? 'var(--danger)' : 'var(--accent)') +
            ';font-size:0.8rem;display:flex;align-items:center;gap:8px;' +
            'flex-wrap:wrap;';

        if (eliminated) {
            var icon = document.createElement('span');
            icon.textContent = '\u26a0';
            icon.style.cssText = 'color:var(--danger);font-size:1rem;';
            banner.appendChild(icon);

            var headline = 'Eliminated';
            if (elimYear !== null && elimYear === yearNum && elimWeek !== null) {
                headline = 'Eliminated in Week ' + elimWeek +
                    ' of Year ' + elimYear;
            } else if (elimYear !== null) {
                headline = 'Eliminated in Year ' + elimYear;
            }

            var headlineEl = document.createElement('span');
            headlineEl.style.cssText =
                'font-weight:600;color:var(--danger);';
            headlineEl.textContent = headline;
            banner.appendChild(headlineEl);

            if (reason && reason !== 'Unknown') {
                var reasonEl = document.createElement('span');
                reasonEl.style.cssText =
                    'color:var(--text-dim);font-size:0.7rem;';
                reasonEl.textContent = ' - ' + reason;
                banner.appendChild(reasonEl);
            }
        } else {
            var okIcon = document.createElement('span');
            okIcon.textContent = '\u2713';
            okIcon.style.cssText = 'color:var(--accent);font-size:1rem;';
            banner.appendChild(okIcon);

            var okText = document.createElement('span');
            okText.style.cssText =
                'font-weight:600;color:var(--accent);';
            okText.textContent = 'Not eliminated';
            banner.appendChild(okText);

            var yearEl = document.createElement('span');
            yearEl.style.cssText =
                'color:var(--text-dim);font-size:0.7rem;';
            yearEl.textContent = '(as of year ' + yearNum + ')';
            banner.appendChild(yearEl);
        }

        section.appendChild(banner);
        return section;
    }

    function resolveCurrentYear() {
        var data = window.data || {};
        if (typeof data.currentYear === 'number' &&
            isFinite(data.currentYear) &&
            data.currentYear > 0) {
            return Math.floor(data.currentYear);
        }
        return new Date().getFullYear();
    }

    // ============================================================
    // SECTION 4 — Academic teams
    // ============================================================

    function renderAcademicTeamsSection(char) {
        var section = document.createElement('div');
        section.className = 'academic-section academic-teams';
        section.style.cssText = 'margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border-soft);';

        var heading = document.createElement('div');
        heading.style.cssText = 'font-size:0.75rem;color:var(--accent);font-weight:600;margin-bottom:6px;';
        heading.textContent = 'Academic Teams';
        section.appendChild(heading);

        var memberships = getAcademicTeamMemberships(char);
        if (memberships.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText = 'padding:4px;font-size:0.7rem;color:var(--text-dim);';
            empty.textContent = 'Not a member of any academic team.';
            section.appendChild(empty);
            return section;
        }

        var list = document.createElement('div');
        list.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

        memberships.forEach(function(m) {
            var row = document.createElement('div');
            row.style.cssText = 'padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--accent);font-size:0.75rem;display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;';

            var nameSpan = document.createElement('span');
            nameSpan.style.cssText = 'font-weight:600;';
            nameSpan.textContent = m.teamName || 'Unnamed Team';
            row.appendChild(nameSpan);

            if (m.className) {
                var classSpan = document.createElement('span');
                classSpan.style.cssText = 'color:var(--text-dim);font-size:0.65rem;';
                classSpan.textContent = '[' + m.className + ']';
                row.appendChild(classSpan);
            }

            if (m.periodDisplay) {
                var periodSpan = document.createElement('span');
                periodSpan.style.cssText = 'color:var(--text-dim);font-size:0.65rem;';
                periodSpan.textContent = m.periodDisplay;
                row.appendChild(periodSpan);
            }

            if (m.role && m.role !== 'Member') {
                var roleSpan = document.createElement('span');
                roleSpan.style.cssText = 'color:var(--info);font-size:0.65rem;font-style:italic;';
                roleSpan.textContent = '(' + m.role + ')';
                row.appendChild(roleSpan);
            }

            list.appendChild(row);
        });

        section.appendChild(list);
        return section;
    }

    function getAcademicTeamMemberships(char) {
        if (!char || !char.id) {
            return [];
        }

        if (!TeamQueries || typeof TeamQueries.getTeamsForCharacter !== 'function') {
            return [];
        }

        var allTeams = TeamQueries.getTeamsForCharacter(char.id) || [];
        var memberships = [];

        allTeams.forEach(function(team) {
            if (!team || team.type !== 'academic') {
                return;
            }

            var member = null;
            if (typeof TeamQueries.getCharacterTeamMembership === 'function') {
                member = TeamQueries.getCharacterTeamMembership(team.id, char.id);
            } else if (Array.isArray(team.members)) {
                for (var i = 0; i < team.members.length; i++) {
                    var m = team.members[i];
                    if (m && String(m.characterId) === String(char.id)) {
                        member = m;
                        break;
                    }
                }
            }

            var className = '';
            if (team.classId) {
                className = getClassDisplayName(team.classId);
                if (className === 'Unknown Class') {
                    className = '';
                }
            }

            var joinPeriod = member ? member.joinPeriod : '';
            var leavePeriod = member ? member.leavePeriod : '';
            var role = member ? (member.role || 'Member') : 'Member';

            memberships.push({
                teamId: team.id,
                teamName: team.name || 'Unnamed Team',
                className: className,
                role: role,
                joinPeriod: joinPeriod,
                leavePeriod: leavePeriod,
                periodDisplay: formatPeriod(joinPeriod, leavePeriod, 'Wk ')
            });
        });

        memberships.sort(function(a, b) {
            return (a.teamName || '').localeCompare(b.teamName || '');
        });

        return memberships;
    }

    // ============================================================
    // SECTION 5 — Enrollment (class-scoped)
    // ============================================================

    function renderEnrollmentSection(char) {
        var section = document.createElement('div');
        section.className = 'academic-section academic-enrollment';
        section.style.cssText = 'margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border-soft);';

        var heading = document.createElement('div');
        heading.style.cssText = 'font-size:0.75rem;color:var(--accent);font-weight:600;margin-bottom:6px;';
        heading.textContent = 'Enrollment';
        section.appendChild(heading);

        var classIds = getNormalisedClassIds(char);
        if (classIds.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText = 'padding:4px;font-size:0.7rem;color:var(--text-dim);';
            empty.textContent = 'Not enrolled in any class.';
            section.appendChild(empty);
            return section;
        }

        var anySectionRendered = false;

        classIds.forEach(function(classId) {
            var cls = getClassById(classId);
            if (!cls) { return; }

            var disciplineIds = [];
            if (AcademyEnrolments && typeof AcademyEnrolments.getStudentDisciplines === 'function') {
                disciplineIds = AcademyEnrolments.getStudentDisciplines(char.id, classId) || [];
            }

            anySectionRendered = true;

            var classBlock = document.createElement('div');
            classBlock.style.cssText = 'margin-bottom:8px;';

            var classNameEl = document.createElement('div');
            classNameEl.style.cssText = 'font-size:0.7rem;color:var(--text-dim);margin-bottom:4px;';
            classNameEl.textContent = cls.name || 'Unnamed Class';
            classBlock.appendChild(classNameEl);

            if (disciplineIds.length === 0) {
                var noneEl = document.createElement('p');
                noneEl.className = 'empty-state';
                noneEl.style.cssText = 'padding:2px 4px;font-size:0.65rem;color:var(--text-dim);';
                noneEl.textContent = 'Not enrolled in any disciplines.';
                classBlock.appendChild(noneEl);
                section.appendChild(classBlock);
                return;
            }

            var rows = [];
            for (var i = 0; i < disciplineIds.length; i++) {
                var did = disciplineIds[i];
                rows.push({ id: did, name: getDisciplineName(did) });
            }
            rows.sort(function(a, b) {
                return (a.name || '').localeCompare(b.name || '');
            });

            var list = document.createElement('div');
            list.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';

            rows.forEach(function(row) {
                var chip = document.createElement('span');
                chip.className = 'enrollment-chip';
                chip.dataset.disciplineId = row.id;
                chip.style.cssText = 'background:var(--panel-alt);padding:2px 8px;border-radius:10px;font-size:0.65rem;border:1px solid var(--border-soft);';
                chip.textContent = row.name;
                list.appendChild(chip);
            });

            classBlock.appendChild(list);
            section.appendChild(classBlock);
        });

        if (!anySectionRendered) {
            var noClasses = document.createElement('p');
            noClasses.className = 'empty-state';
            noClasses.style.cssText = 'padding:4px;font-size:0.7rem;color:var(--text-dim);';
            noClasses.textContent = 'No matching classes.';
            section.appendChild(noClasses);
        }

        return section;
    }

    // ============================================================
    // SECTION 6 — Grades table (class-scoped)
    // ============================================================

    function renderGradesSection(char) {
        var section = document.createElement('div');
        section.className = 'academic-section academic-grades';

        var heading = document.createElement('div');
        heading.style.cssText = 'font-size:0.75rem;color:var(--accent);font-weight:600;margin-bottom:6px;';
        heading.textContent = 'Classes Taken & Grades';
        section.appendChild(heading);

        var classIds = getNormalisedClassIds(char);
        var allGrades = [];

        for (var c = 0; c < classIds.length; c++) {
            var classId = classIds[c];
            var gradesForClass = [];
            if (AcademyGrades && typeof AcademyGrades.getStudentClassGrades === 'function') {
                gradesForClass = AcademyGrades.getStudentClassGrades(char.id, classId) || [];
            }

            for (var g = 0; g < gradesForClass.length; g++) {
                allGrades.push({
                    grade: gradesForClass[g],
                    classId: classId
                });
            }
        }

        if (allGrades.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText = 'padding:4px;font-size:0.7rem;color:var(--text-dim);';
            empty.textContent = 'No grades recorded.';
            section.appendChild(empty);
            return section;
        }

        allGrades.sort(function(a, b) {
            var wa = parseInt(a.grade.week, 10) || 0;
            var wb = parseInt(b.grade.week, 10) || 0;
            if (wa !== wb) { return wa - wb; }
            return (a.grade.disciplineId || '').localeCompare(b.grade.disciplineId || '');
        });

        var table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;font-size:0.7rem;';

        var thead = document.createElement('thead');
        var headRow = document.createElement('tr');
        headRow.style.cssText = 'border-bottom:1px solid var(--border);';

        ['Discipline', 'Class', 'Week', 'Score'].forEach(function(labelText) {
            var th = document.createElement('th');
            th.style.cssText = 'text-align:left;padding:3px 6px;font-size:0.65rem;color:var(--text-dim);font-weight:600;';
            th.textContent = labelText;
            headRow.appendChild(th);
        });

        thead.appendChild(headRow);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');

        allGrades.forEach(function(entry) {
            var g = entry.grade;

            var tr = document.createElement('tr');
            tr.style.cssText = 'border-bottom:1px solid var(--border-soft);';

            var disciplineTd = document.createElement('td');
            disciplineTd.style.cssText = 'padding:3px 6px;';
            disciplineTd.textContent = getDisciplineName(g.disciplineId);
            tr.appendChild(disciplineTd);

            var classTd = document.createElement('td');
            classTd.style.cssText = 'padding:3px 6px;color:var(--text-dim);';
            classTd.textContent = getClassDisplayName(entry.classId) || '\u2014';
            tr.appendChild(classTd);

            var weekTd = document.createElement('td');
            weekTd.style.cssText = 'padding:3px 6px;color:var(--text-dim);';
            weekTd.textContent = g.week !== undefined && g.week !== null ? String(g.week) : '\u2014';
            tr.appendChild(weekTd);

            var scoreTd = document.createElement('td');
            var pct = getGradePercentage(g);
            if (pct === null) {
                scoreTd.style.cssText = 'padding:3px 6px;color:var(--text-dim);';
                scoreTd.textContent = '\u2014';
            } else {
                scoreTd.style.cssText = 'padding:3px 6px;font-weight:600;color:var(--text);';
                scoreTd.textContent = pct + '%';
            }
            tr.appendChild(scoreTd);

            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        section.appendChild(table);

        var summary = computeGradeSummary(allGrades);
        if (summary.count > 0) {
            var summaryEl = document.createElement('p');
            summaryEl.style.cssText = 'margin-top:8px;font-size:0.7rem;color:var(--text-dim);';
            summaryEl.textContent = 'Average across ' + summary.count + ' grade' + (summary.count === 1 ? '' : 's') + ': ' + summary.average + '%';
            section.appendChild(summaryEl);
        }

        return section;
    }

    function computeGradeSummary(gradeEntries) {
        if (!Array.isArray(gradeEntries) || gradeEntries.length === 0) {
            return { count: 0, average: 0 };
        }

        var total = 0;
        var count = 0;
        for (var i = 0; i < gradeEntries.length; i++) {
            var g = gradeEntries[i].grade;
            var pct = getGradePercentage(g);
            if (pct !== null) {
                total += pct;
                count++;
            }
        }

        return {
            count: count,
            average: count > 0 ? Math.round((total / count) * 10) / 10 : 0
        };
    }

    // ============================================================
    // SECTION 7 — Tournament eliminations
    // ============================================================

    function renderTournamentEliminationsSection(char) {
        var section = document.createElement('div');
        section.className = 'academic-section academic-eliminations-tournament';
        section.style.cssText =
            'margin-top:16px;padding-top:12px;' +
            'border-top:1px solid var(--border-soft);';

        var heading = document.createElement('div');
        heading.style.cssText =
            'font-size:0.75rem;color:var(--danger);' +
            'font-weight:600;margin-bottom:6px;';
        heading.textContent = 'Tournament Eliminations';
        section.appendChild(heading);

        var tournamentElims = getTournamentEliminations(char);

        if (tournamentElims.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText =
                'padding:4px;font-size:0.7rem;color:var(--text-dim);';
            empty.textContent = 'No tournament eliminations recorded.';
            section.appendChild(empty);
            return section;
        }

        var list = document.createElement('div');
        list.style.cssText = 'display:flex;flex-direction:column;gap:3px;';

        tournamentElims.forEach(function(elim) {
            var tournName = getTournamentName(elim.tournamentId);

            var row = document.createElement('div');
            row.className = 'tournament-elimination-entry';
            row.style.cssText =
                'display:flex;justify-content:space-between;' +
                'align-items:center;padding:4px 8px;' +
                'background:var(--danger-soft);border-radius:4px;' +
                'border-left:3px solid var(--danger);font-size:0.72rem;';

            var left = document.createElement('span');
            left.style.cssText = 'display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;';

            var nameEl = document.createElement('strong');
            nameEl.textContent = tournName;
            left.appendChild(nameEl);

            var details = [];
            if (elim.year) { details.push('Year ' + elim.year); }
            if (elim.week) { details.push('Week ' + elim.week); }
            if (details.length > 0) {
                var detailsEl = document.createElement('span');
                detailsEl.style.cssText =
                    'color:var(--text-dim);font-size:0.65rem;';
                detailsEl.textContent = '(' + details.join(', ') + ')';
                left.appendChild(detailsEl);
            }

            if (elim.reason) {
                var reasonEl = document.createElement('span');
                reasonEl.style.cssText =
                    'color:var(--text-dim);font-size:0.65rem;';
                reasonEl.textContent = ' - ' + elim.reason;
                left.appendChild(reasonEl);
            }

            row.appendChild(left);
            list.appendChild(row);
        });

        section.appendChild(list);
        return section;
    }

    // ============================================================
    // SECTION 8 — Standalone eliminations
    // ============================================================

    function renderStandaloneEliminationsSection(char) {
        var section = document.createElement('div');
        section.className = 'academic-section academic-eliminations-standalone';
        section.style.cssText =
            'margin-top:8px;padding-top:12px;' +
            'border-top:1px solid var(--border-soft);';

        var heading = document.createElement('div');
        heading.style.cssText =
            'font-size:0.75rem;color:var(--warning);' +
            'font-weight:600;margin-bottom:6px;';
        heading.textContent = 'Standalone Eliminations';
        section.appendChild(heading);

        var standaloneItems = getStandaloneEliminations(char);

        if (standaloneItems.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText =
                'padding:4px;font-size:0.7rem;color:var(--text-dim);';
            empty.textContent = 'No standalone eliminations recorded.';
            section.appendChild(empty);
            return section;
        }

        var list = document.createElement('div');
        list.style.cssText = 'display:flex;flex-direction:column;gap:3px;';

        standaloneItems.forEach(function(elim) {
            var row = document.createElement('div');
            row.className = 'standalone-elimination-entry';
            row.dataset.eliminationId = elim.id || '';
            row.style.cssText =
                'display:flex;justify-content:space-between;' +
                'align-items:center;padding:4px 8px;' +
                'background:var(--warning-soft);border-radius:4px;' +
                'border-left:3px solid var(--warning);font-size:0.72rem;';

            var left = document.createElement('span');
            left.style.cssText =
                'display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;';

            var details = [];
            if (elim.year) { details.push('Year ' + elim.year); }
            if (elim.week) { details.push('Week ' + elim.week); }
            if (details.length > 0) {
                var detailsEl = document.createElement('span');
                detailsEl.textContent = details.join(', ');
                left.appendChild(detailsEl);
            }

            if (elim.reason) {
                var reasonEl = document.createElement('span');
                reasonEl.style.cssText =
                    'color:var(--text-dim);font-size:0.65rem;';
                reasonEl.textContent = ' - ' + elim.reason;
                left.appendChild(reasonEl);
            }

            var standaloneLabel = document.createElement('span');
            standaloneLabel.style.cssText =
                'color:var(--warning);font-size:0.6rem;margin-left:4px;';
            standaloneLabel.textContent = '[Standalone]';
            left.appendChild(standaloneLabel);

            var removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'remove-standalone-elim small danger';
            removeBtn.style.cssText =
                'background:none;border:none;color:var(--danger);' +
                'cursor:pointer;font-size:0.65rem;padding:0 4px;';
            removeBtn.dataset.action = 'remove-standalone-elim';
            removeBtn.dataset.eliminationId = elim.id || '';
            removeBtn.dataset.characterId = char.id || '';
            removeBtn.textContent = '\u2715';
            removeBtn.setAttribute('aria-label', 'Remove elimination');

            row.appendChild(left);
            row.appendChild(removeBtn);
            list.appendChild(row);
        });

        section.appendChild(list);
        return section;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterClassView = {
        // Primary entry point for the Academic tab
        renderAcademicTab: renderAcademicTab,

        // Character list class filter
        populateClassFilter: populateClassFilter,

        // Individual sections (exposed for testing only — callers
        // should use renderAcademicTab)
        renderAddClassSection: renderAddClassSection,
        renderClassesSection: renderClassesSection,
        renderEliminationStatusSection: renderEliminationStatusSection,
        renderAcademicTeamsSection: renderAcademicTeamsSection,
        renderEnrollmentSection: renderEnrollmentSection,
        renderGradesSection: renderGradesSection,
        renderTournamentEliminationsSection:
            renderTournamentEliminationsSection,
        renderStandaloneEliminationsSection:
            renderStandaloneEliminationsSection,

        // Helpers (exposed for testing only)
        getAcademicTeamMemberships: getAcademicTeamMemberships,
        getClassRoleLabel: getClassRoleLabel,
        getNormalisedClassIds: getNormalisedClassIds
    };

})();
