/**
 * modules/characters/character-class-view.js - Character Class View
 * Renders the Academic tab for the character form
 * Path: js/modules/characters/character-class-view.js
 *
 * This module is responsible for:
 *   - Rendering the class dropdown (add to class)
 *   - Rendering class tags with role labels (Trainee / Instructor)
 *   - Rendering academic team memberships (historical)
 *   - Rendering the grades table (discipline / class / week / score)
 *   - The combined Academic tab layout
 *
 * IMPORTANT:
 *   - RENDER ONLY - no mutations, no persistence
 *   - Uses AcademyQueries for class, grade, and team data
 *   - Uses TeamQueries for team lookups
 *   - Uses CharacterQueries for character data
 *   - Uses DisciplineQueries for discipline names
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
 *     renderAcademicTeamsSection, renderGradesSection) are implementation
 *     details. They are exported for testing only.
 *
 * ROLE LABELS:
 *   - A character is an "Instructor" for a class when
 *     class.instructorId === char.id.
 *   - Otherwise the character is a "Trainee" for that class.
 *   - This is derived from class data, not from career status.
 *
 * DEPENDENCIES:
 *   - window.AcademyQueries (from academy-queries.js) - MANDATORY
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 *   - window.DisciplineQueries (from discipline-queries.js) - MANDATORY
 *   - window.TeamQueries (from team-queries.js) - MANDATORY
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

    var AcademyQueries = window.AcademyQueries;
    var CharacterQueries = window.CharacterQueries;
    var DomUtils = window.DomUtils;
    var DisciplineQueries = window.DisciplineQueries;
    var TeamQueries = window.TeamQueries;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!AcademyQueries || typeof AcademyQueries.getClasses !== 'function') {
            missing.push('AcademyQueries.getClasses');
        }
        if (!AcademyQueries || typeof AcademyQueries.getCharacterClasses !== 'function') {
            missing.push('AcademyQueries.getCharacterClasses');
        }
        if (!AcademyQueries || typeof AcademyQueries.getStudentGrades !== 'function') {
            missing.push('AcademyQueries.getStudentGrades');
        }

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }

        if (!DomUtils || typeof DomUtils.createElement !== 'function') {
            missing.push('DomUtils.createElement');
        }

        // DisciplineQueries and TeamQueries are used but not strictly
        // required for the module to load; the render functions degrade
        // gracefully if they are missing.

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
        if (!classId || !AcademyQueries) {
            return null;
        }
        return AcademyQueries.getClass(classId);
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
        container.appendChild(renderAcademicTeamsSection(char));
        container.appendChild(renderGradesSection(char));
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

        var allClasses = AcademyQueries.getClasses() || [];
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
    // SECTION 3 — Academic teams
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

    /**
     * Get all academic team memberships for a character.
     *
     * @param {object} char - Character object
     * @returns {array} Array of { teamId, teamName, className, role, joinPeriod, leavePeriod, periodDisplay }
     */
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
            if (team.classId && AcademyQueries) {
                className = AcademyQueries.getClassDisplayName(team.classId) || '';
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
    // SECTION 4 — Grades table
    // ============================================================

    function renderGradesSection(char) {
        var section = document.createElement('div');
        section.className = 'academic-section academic-grades';

        var heading = document.createElement('div');
        heading.style.cssText = 'font-size:0.75rem;color:var(--accent);font-weight:600;margin-bottom:6px;';
        heading.textContent = 'Classes Taken & Grades';
        section.appendChild(heading);

        var grades = AcademyQueries.getStudentGrades(char.id) || [];

        if (grades.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText = 'padding:4px;font-size:0.7rem;color:var(--text-dim);';
            empty.textContent = 'No grades recorded.';
            section.appendChild(empty);
            return section;
        }

        grades.sort(function(a, b) {
            var wa = parseInt(a.week, 10) || 0;
            var wb = parseInt(b.week, 10) || 0;
            if (wa !== wb) {
                return wa - wb;
            }
            return (a.disciplineId || '').localeCompare(b.disciplineId || '');
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

        grades.forEach(function(g) {
            var tr = document.createElement('tr');
            tr.style.cssText = 'border-bottom:1px solid var(--border-soft);';

            var disciplineName = 'Unknown';
            if (DisciplineQueries && typeof DisciplineQueries.getDiscipline === 'function') {
                var d = DisciplineQueries.getDiscipline(g.disciplineId);
                if (d && d.name) {
                    disciplineName = d.name;
                }
            }

            var disciplineTd = document.createElement('td');
            disciplineTd.style.cssText = 'padding:3px 6px;';
            disciplineTd.textContent = disciplineName;
            tr.appendChild(disciplineTd);

            var classTd = document.createElement('td');
            classTd.style.cssText = 'padding:3px 6px;color:var(--text-dim);';
            classTd.textContent = g.classId ? (AcademyQueries.getClassDisplayName(g.classId) || '\u2014') : '\u2014';
            tr.appendChild(classTd);

            var weekTd = document.createElement('td');
            weekTd.style.cssText = 'padding:3px 6px;color:var(--text-dim);';
            weekTd.textContent = g.week !== undefined && g.week !== null ? String(g.week) : '\u2014';
            tr.appendChild(weekTd);

            var scoreTd = document.createElement('td');
            var pct = (typeof g.percentage === 'number') ? g.percentage : null;
            if (pct === null && typeof g.score === 'number' && typeof g.maxScore === 'number' && g.maxScore > 0) {
                pct = Math.round((g.score / g.maxScore) * 100);
            }
            if (pct === null) {
                scoreTd.style.cssText = 'padding:3px 6px;color:var(--text-dim);';
                scoreTd.textContent = '\u2014';
            } else {
                var passing = pct >= 70;
                scoreTd.style.cssText = 'padding:3px 6px;font-weight:600;color:' + (passing ? 'var(--accent)' : 'var(--danger)') + ';';
                scoreTd.textContent = pct + '%';
            }
            tr.appendChild(scoreTd);

            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        section.appendChild(table);

        var summary = computeGradeSummary(grades);
        if (summary.count > 0) {
            var summaryEl = document.createElement('p');
            summaryEl.style.cssText = 'margin-top:8px;font-size:0.7rem;color:var(--text-dim);';
            summaryEl.textContent = 'Average across ' + summary.count + ' grade' + (summary.count === 1 ? '' : 's') + ': ' + summary.average + '%';
            section.appendChild(summaryEl);
        }

        return section;
    }

    function computeGradeSummary(grades) {
        if (!Array.isArray(grades) || grades.length === 0) {
            return { count: 0, average: 0 };
        }

        var total = 0;
        var count = 0;
        for (var i = 0; i < grades.length; i++) {
            var g = grades[i];
            var pct = null;
            if (typeof g.percentage === 'number') {
                pct = g.percentage;
            } else if (typeof g.score === 'number' && typeof g.maxScore === 'number' && g.maxScore > 0) {
                pct = Math.round((g.score / g.maxScore) * 100);
            }
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
    // EXPOSE
    // ============================================================

    window.CharacterClassView = {
        // Primary entry point for the Academic tab
        renderAcademicTab: renderAcademicTab,

        // Individual sections (exposed for testing only — callers
        // should use renderAcademicTab)
        renderAddClassSection: renderAddClassSection,
        renderClassesSection: renderClassesSection,
        renderAcademicTeamsSection: renderAcademicTeamsSection,
        renderGradesSection: renderGradesSection,

        // Helpers (exposed for testing only)
        getAcademicTeamMemberships: getAcademicTeamMemberships,
        getClassRoleLabel: getClassRoleLabel,
        getNormalisedClassIds: getNormalisedClassIds
    };

})();