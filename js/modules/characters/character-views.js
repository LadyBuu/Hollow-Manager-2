/**
 * js/modules/characters/character-views.js - Character Views
 * Renders academic, professional, and social views for a character
 * Path: js/modules/characters/character-views.js
 * 
 * This module is responsible for:
 *   - Rendering academic view (teams, grades, eliminations)
 *   - Rendering professional view (teams, missions)
 *   - Rendering social view (relationships)
 *   - Career status entry creation (DOM-based)
 * 
 * IMPORTANT:
 *   - All user-controlled data is inserted using DOM APIs (textContent)
 *   - No inline event handlers - events bound in character-events.js
 *   - Safe CSS color validation for relationship types
 *   - NO DIRECT window.data ACCESS - all data via query modules
 *   - USES CharacterQueries for character data and display names
 *   - USES AcademyQueries for class display names
 *   - USES TeamQueries for team queries
 *   - USES DisciplineQueries for discipline names
 *   - USES GradeQueries for grade data
 *   - USES MissionQueries for mission data
 *   - USES SocialQueries for social data
 *   - USES EliminationQueries for elimination status
 * 
 * DEPENDENCIES (ALL MANDATORY):
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.AcademyQueries (from academy-queries.js)
 *   - window.TeamQueries (from team-queries.js)
 *   - window.DisciplineQueries (from discipline-queries.js)
 *   - window.GradeQueries (from grade-queries.js)
 *   - window.MissionQueries (from mission-queries.js)
 *   - window.SocialQueries (from social-queries.js)
 *   - window.EliminationQueries (from elimination-queries.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.CharacterConstants (from character-constants.js)
 */

(function() {
    'use strict';

    if (window.__characterViewsLoaded) {
        return;
    }
    window.__characterViewsLoaded = true;

    var CharacterQueries = window.CharacterQueries;
    var AcademyQueries = window.AcademyQueries;
    var TeamQueries = window.TeamQueries;
    var DisciplineQueries = window.DisciplineQueries;
    var GradeQueries = window.GradeQueries;
    var MissionQueries = window.MissionQueries;
    var SocialQueries = window.SocialQueries;
    var EliminationQueries = window.EliminationQueries;
    var DomUtils = window.DomUtils;
    var CharacterConstants = window.CharacterConstants;

    function checkDependencies() {
        var missing = [];

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (!AcademyQueries || typeof AcademyQueries.getClassDisplayName !== 'function') {
            missing.push('AcademyQueries.getClassDisplayName');
        }

        if (!TeamQueries || typeof TeamQueries.getTeamsForCharacter !== 'function') {
            missing.push('TeamQueries.getTeamsForCharacter');
        }
        if (!TeamQueries || typeof TeamQueries.getTeamName !== 'function') {
            missing.push('TeamQueries.getTeamName');
        }
        if (!TeamQueries || typeof TeamQueries.getCharacterTeamMembership !== 'function') {
            missing.push('TeamQueries.getCharacterTeamMembership');
        }

        if (!DisciplineQueries || typeof DisciplineQueries.getDiscipline !== 'function') {
            missing.push('DisciplineQueries.getDiscipline');
        }

        if (!GradeQueries || typeof GradeQueries.getCharacterGrades !== 'function') {
            missing.push('GradeQueries.getCharacterGrades');
        }

        if (!MissionQueries || typeof MissionQueries.getMissionsForCharacter !== 'function') {
            missing.push('MissionQueries.getMissionsForCharacter');
        }

        if (!SocialQueries || typeof SocialQueries.getCharacterRelationships !== 'function') {
            missing.push('SocialQueries.getCharacterRelationships');
        }
        if (!SocialQueries || typeof SocialQueries.getRelationshipTypeColor !== 'function') {
            missing.push('SocialQueries.getRelationshipTypeColor');
        }
        if (!SocialQueries || typeof SocialQueries.getRelationshipTypeLabel !== 'function') {
            missing.push('SocialQueries.getRelationshipTypeLabel');
        }

        if (!EliminationQueries || typeof EliminationQueries.isCharacterEliminated !== 'function') {
            missing.push('EliminationQueries.isCharacterEliminated');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (missing.length > 0) {
            throw new Error('CharacterViews: Missing required dependencies: ' + missing.join(', '));
        }

        return true;
    }

    checkDependencies();

    var CAREER_STATUS_OPTIONS = CharacterConstants ? CharacterConstants.CAREER_STATUS_OPTIONS : [
        { value: '', label: 'Select status...' },
        { value: 'civilian', label: 'Civilian' },
        { value: 'trainee', label: 'Trainee' },
        { value: 'rookie', label: 'Rookie' },
        { value: 'junior', label: 'Junior' },
        { value: 'senior', label: 'Senior' },
        { value: 'instructor', label: 'Instructor' },
        { value: 'support', label: 'Support' }
    ];

    var ALLOWED_COLORS = {
        '#8cbb3a': true,
        '#c9a24b': true,
        '#c1453c': true,
        '#4a9bc7': true,
        '#9b59b6': true,
        '#e67e22': true,
        '#27ae60': true,
        '#7f8c8d': true
    };

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function getSafeRelationshipColor(typeId) {
        var color = SocialQueries.getRelationshipTypeColor(typeId);

        if (!color || typeof color !== 'string') {
            return '#7f8c8d';
        }

        var normalized = color.toLowerCase();
        if (ALLOWED_COLORS[normalized]) {
            return normalized;
        }

        return '#7f8c8d';
    }

    function getRelationshipTypeLabel(typeId) {
        return SocialQueries.getRelationshipTypeLabel(typeId) || 'Other';
    }

    function formatMembershipPeriod(join, leave, prefix) {
        prefix = prefix || '';
        var joinStr = (join !== undefined && join !== null && join !== '') ? String(join) : '';
        var leaveStr = (leave !== undefined && leave !== null && leave !== '') ? String(leave) : '';

        if (joinStr && leaveStr) return prefix + joinStr + ' -> ' + prefix + leaveStr;
        if (joinStr) return prefix + joinStr + ' -> Present';
        if (leaveStr) return 'Until ' + prefix + leaveStr;
        return prefix + '?';
    }

    function formatGradeValue(score) {
        var num = Number(score);
        if (Number.isFinite(num) && num >= 0 && num <= 100) {
            return Math.round(num) + '%';
        }
        return 'Invalid';
    }

    function renderAcademic(char) {
        var container = document.getElementById('academic-view');
        if (!container) return;

        container.textContent = '';

        var heading = document.createElement('h4');
        heading.style.cssText = 'color:var(--accent);font-size:0.8rem;margin:8px 0 4px 0;';
        heading.textContent = 'Academic Teams';
        container.appendChild(heading);

        var acadTeams = TeamQueries.getTeamsForCharacter(char.id, ['academic']);

        if (acadTeams.length > 0) {
            acadTeams.forEach(function(team) {
                var member = TeamQueries.getCharacterTeamMembership(team.id, char.id);
                var joinPeriod = member ? member.joinPeriod : '';
                var leavePeriod = member ? member.leavePeriod : '';
                var periodDisplay = formatMembershipPeriod(joinPeriod, leavePeriod, 'Wk ');
                var classDisplay = '';
                if (team.classId) {
                    var className = AcademyQueries.getClassDisplayName(team.classId);
                    classDisplay = ' [' + className + ']';
                }

                var div = document.createElement('div');
                div.style.cssText = 'padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--accent);margin-bottom:3px;font-size:0.75rem;';

                var strong = document.createElement('strong');
                strong.textContent = team.name;
                div.appendChild(strong);

                if (classDisplay) {
                    var classSpan = document.createElement('span');
                    classSpan.textContent = classDisplay;
                    div.appendChild(classSpan);
                }

                var periodSpan = document.createElement('span');
                periodSpan.style.cssText = 'color:var(--text-dim);font-size:0.7rem;';
                periodSpan.textContent = ' (' + periodDisplay + ')';
                div.appendChild(periodSpan);

                if (member && member.role) {
                    var roleSpan = document.createElement('span');
                    roleSpan.style.cssText = 'color:var(--text-dim);font-size:0.65rem;';
                    roleSpan.textContent = ' [' + member.role + ']';
                    div.appendChild(roleSpan);
                }

                container.appendChild(div);
            });
        } else {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText = 'padding:4px;font-size:0.7rem;';
            empty.textContent = 'No academic teams';
            container.appendChild(empty);
        }

        var gradeHeading = document.createElement('h4');
        gradeHeading.style.cssText = 'color:var(--info);font-size:0.8rem;margin:8px 0 4px 0;';
        gradeHeading.textContent = 'Grades';
        container.appendChild(gradeHeading);

        var grades = GradeQueries.getCharacterGrades(char.id) || [];

        if (grades.length > 0) {
            grades.sort(function(a, b) {
                return parseInt(a.week, 10) - parseInt(b.week, 10);
            });

            var gradeContainer = document.createElement('div');
            gradeContainer.style.cssText = 'max-height:100px;overflow-y:auto;font-size:0.7rem;';

            grades.forEach(function(g) {
                var formattedScore = formatGradeValue(g.score);
                var discipline = DisciplineQueries.getDiscipline(g.disciplineId);
                var disciplineName = discipline ? discipline.name : 'Unknown';

                var gradeDiv = document.createElement('div');
                gradeDiv.style.cssText = 'padding:2px 8px;background:var(--bg);border-radius:3px;margin-bottom:2px;display:flex;justify-content:space-between;';

                var nameSpan = document.createElement('span');
                nameSpan.textContent = disciplineName + ' (Wk ' + g.week + ')';
                gradeDiv.appendChild(nameSpan);

                var scoreSpan = document.createElement('span');
                scoreSpan.style.cssText = 'color:var(--accent);font-weight:600;';
                scoreSpan.textContent = formattedScore;
                gradeDiv.appendChild(scoreSpan);

                gradeContainer.appendChild(gradeDiv);
            });

            container.appendChild(gradeContainer);
        } else {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText = 'padding:4px;font-size:0.7rem;';
            empty.textContent = 'No grades recorded';
            container.appendChild(empty);
        }

        var elimHeading = document.createElement('h4');
        elimHeading.style.cssText = 'color:var(--danger);font-size:0.8rem;margin:8px 0 4px 0;';
        elimHeading.textContent = 'Elimination Status';
        container.appendChild(elimHeading);

        var currentWeek = getCurrentWeek();
        var isEliminated = EliminationQueries.isCharacterEliminated(char.id, currentWeek);

        var elimDiv = document.createElement('div');
        elimDiv.style.cssText = 'padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + (isEliminated ? 'var(--danger)' : 'var(--accent)') + ';font-size:0.75rem;';
        elimDiv.textContent = isEliminated ? '\u26a0 This character is eliminated' : '\u2713 Not eliminated';
        container.appendChild(elimDiv);
    }

    function renderProfessional(char) {
        var container = document.getElementById('professional-view');
        if (!container) return;

        container.textContent = '';

        var heading = document.createElement('h4');
        heading.style.cssText = 'color:var(--info);font-size:0.8rem;margin:8px 0 4px 0;';
        heading.textContent = 'Professional Teams';
        container.appendChild(heading);

        var profTeams = TeamQueries.getTeamsForCharacter(char.id, ['professional']);

        if (profTeams.length > 0) {
            profTeams.forEach(function(team) {
                var member = TeamQueries.getCharacterTeamMembership(team.id, char.id);
                var joinPeriod = member ? member.joinPeriod : '';
                var leavePeriod = member ? member.leavePeriod : '';
                var periodDisplay = formatMembershipPeriod(joinPeriod, leavePeriod);

                var div = document.createElement('div');
                div.style.cssText = 'padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--info);margin-bottom:3px;font-size:0.75rem;';

                var strong = document.createElement('strong');
                strong.textContent = team.name;
                div.appendChild(strong);

                var periodSpan = document.createElement('span');
                periodSpan.style.cssText = 'color:var(--text-dim);font-size:0.7rem;';
                periodSpan.textContent = ' (' + periodDisplay + ')';
                div.appendChild(periodSpan);

                if (member && member.role) {
                    var roleSpan = document.createElement('span');
                    roleSpan.style.cssText = 'color:var(--text-dim);font-size:0.65rem;';
                    roleSpan.textContent = ' [' + member.role + ']';
                    div.appendChild(roleSpan);
                }

                container.appendChild(div);
            });
        } else {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText = 'padding:4px;font-size:0.7rem;';
            empty.textContent = 'No professional teams';
            container.appendChild(empty);
        }

        var tempHeading = document.createElement('h4');
        tempHeading.style.cssText = 'color:var(--warning);font-size:0.8rem;margin:8px 0 4px 0;';
        tempHeading.textContent = 'Temporary Teams';
        container.appendChild(tempHeading);

        var tempTeams = TeamQueries.getTeamsForCharacter(char.id, ['temporary']);

        if (tempTeams.length > 0) {
            tempTeams.forEach(function(team) {
                var member = TeamQueries.getCharacterTeamMembership(team.id, char.id);
                var joinPeriod = member ? member.joinPeriod : '';
                var leavePeriod = member ? member.leavePeriod : '';
                var periodDisplay = formatMembershipPeriod(joinPeriod, leavePeriod);

                var div = document.createElement('div');
                div.style.cssText = 'padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--warning);margin-bottom:3px;font-size:0.75rem;';

                var strong = document.createElement('strong');
                strong.textContent = team.name;
                div.appendChild(strong);

                var periodSpan = document.createElement('span');
                periodSpan.style.cssText = 'color:var(--text-dim);font-size:0.7rem;';
                periodSpan.textContent = ' (' + periodDisplay + ')';
                div.appendChild(periodSpan);

                if (member && member.role) {
                    var roleSpan = document.createElement('span');
                    roleSpan.style.cssText = 'color:var(--text-dim);font-size:0.65rem;';
                    roleSpan.textContent = ' [' + member.role + ']';
                    div.appendChild(roleSpan);
                }

                container.appendChild(div);
            });
        } else {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText = 'padding:4px;font-size:0.7rem;';
            empty.textContent = 'No temporary teams';
            container.appendChild(empty);
        }

        var civHeading = document.createElement('h4');
        civHeading.style.cssText = 'color:var(--text-dim);font-size:0.8rem;margin:8px 0 4px 0;';
        civHeading.textContent = 'Civilian Teams';
        container.appendChild(civHeading);

        var civTeams = TeamQueries.getTeamsForCharacter(char.id, ['civilian']);

        if (civTeams.length > 0) {
            civTeams.forEach(function(team) {
                var member = TeamQueries.getCharacterTeamMembership(team.id, char.id);
                var joinPeriod = member ? member.joinPeriod : '';
                var leavePeriod = member ? member.leavePeriod : '';
                var periodDisplay = formatMembershipPeriod(joinPeriod, leavePeriod);

                var div = document.createElement('div');
                div.style.cssText = 'padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--text-dim);margin-bottom:3px;font-size:0.75rem;';

                var strong = document.createElement('strong');
                strong.textContent = team.name;
                div.appendChild(strong);

                var periodSpan = document.createElement('span');
                periodSpan.style.cssText = 'color:var(--text-dim);font-size:0.7rem;';
                periodSpan.textContent = ' (' + periodDisplay + ')';
                div.appendChild(periodSpan);

                if (member && member.role) {
                    var roleSpan = document.createElement('span');
                    roleSpan.style.cssText = 'color:var(--text-dim);font-size:0.65rem;';
                    roleSpan.textContent = ' [' + member.role + ']';
                    div.appendChild(roleSpan);
                }

                container.appendChild(div);
            });
        } else {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText = 'padding:4px;font-size:0.7rem;';
            empty.textContent = 'No civilian teams';
            container.appendChild(empty);
        }

        var missionHeading = document.createElement('h4');
        missionHeading.style.cssText = 'color:var(--warning);font-size:0.8rem;margin:8px 0 4px 0;';
        missionHeading.textContent = 'Missions';
        container.appendChild(missionHeading);

        var missions = MissionQueries.getMissionsForCharacter(char.id) || [];

        if (missions.length > 0) {
            missions.forEach(function(m) {
                var statusColor = m.status === 'completed' ? 'var(--accent)' :
                                 m.status === 'cancelled' ? 'var(--danger)' : 'var(--warning)';
                var teamName = TeamQueries.getTeamName(m.assignedTeamId) || 'Unknown Team';

                var div = document.createElement('div');
                div.style.cssText = 'padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + statusColor + ';margin-bottom:3px;font-size:0.75rem;';

                var strong = document.createElement('strong');
                strong.textContent = m.title || 'Untitled';
                div.appendChild(strong);

                var teamSpan = document.createElement('span');
                teamSpan.style.cssText = 'color:var(--text-dim);font-size:0.65rem;';
                teamSpan.textContent = ' [' + (teamName || 'Unknown Team') + '] ';
                div.appendChild(teamSpan);

                var statusSpan = document.createElement('span');
                statusSpan.style.cssText = 'color:' + statusColor + ';font-size:0.65rem;';
                statusSpan.textContent = m.status || 'active';
                div.appendChild(statusSpan);

                if (m.location) {
                    var locSpan = document.createElement('span');
                    locSpan.style.cssText = 'color:var(--text-dim);font-size:0.65rem;';
                    locSpan.textContent = ' (' + m.location + ')';
                    div.appendChild(locSpan);
                }

                container.appendChild(div);
            });
        } else {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText = 'padding:4px;font-size:0.7rem;';
            empty.textContent = 'No missions assigned';
            container.appendChild(empty);
        }
    }

    function renderSocial(char) {
        var container = document.getElementById('social-view');
        if (!container) return;

        container.textContent = '';

        var relationships = SocialQueries.getCharacterRelationships(char.id) || [];

        if (relationships.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.style.cssText = 'padding:8px;font-size:0.8rem;';
            empty.textContent = 'No social connections';
            container.appendChild(empty);
            return;
        }

        relationships.forEach(function(rel) {
            var otherId = String(rel.character1) === String(char.id) ? rel.character2 : rel.character1;
            var other = CharacterQueries.getCharacterById(otherId);
            var otherName = other ? CharacterQueries.getDisplayName(other) : '\u26a0 Unknown Character';

            var typeLabel = getRelationshipTypeLabel(rel.typeId);
            var typeColor = getSafeRelationshipColor(rel.typeId);

            var period = '';
            if (rel.startYear && rel.endYear) {
                period = rel.startYear + ' -> ' + rel.endYear;
            } else if (rel.startYear) {
                period = 'From ' + rel.startYear;
            }

            var clarification = rel.clarification ? ' (' + rel.clarification + ')' : '';
            var notes = rel.notes ? ' \uD83D\uDCDD' : '';

            var div = document.createElement('div');
            div.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + typeColor + ';margin-bottom:3px;font-size:0.75rem;';

            var leftSpan = document.createElement('span');
            var strong = document.createElement('strong');
            strong.textContent = otherName;
            leftSpan.appendChild(strong);

            var typeSpan = document.createElement('span');
            typeSpan.style.cssText = 'color:' + typeColor + ';';
            typeSpan.textContent = ' ' + typeLabel + clarification;
            leftSpan.appendChild(typeSpan);

            if (notes) {
                var notesSpan = document.createElement('span');
                notesSpan.textContent = notes;
                leftSpan.appendChild(notesSpan);
            }

            div.appendChild(leftSpan);

            var rightSpan = document.createElement('span');
            rightSpan.style.cssText = 'font-size:0.65rem;color:var(--text-dim);';
            rightSpan.textContent = period;
            div.appendChild(rightSpan);

            container.appendChild(div);
        });
    }

    function addCareerStatusEntry(container, status, startYear, endYear) {
        if (!container) return;

        var entry = document.createElement('div');
        entry.className = 'career-status-entry';
        entry.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;flex-wrap:wrap;align-items:center;';

        var select = document.createElement('select');
        select.className = 'career-status-select';
        select.style.cssText = 'flex:1;min-width:100px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 6px;font-size:0.7rem;';

        CAREER_STATUS_OPTIONS.forEach(function(opt) {
            var option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            if (status && status === opt.value) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        var startInput = document.createElement('input');
        startInput.type = 'number';
        startInput.className = 'career-start-year';
        startInput.placeholder = 'Start Year';
        startInput.style.cssText = 'flex:1;min-width:60px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 6px;font-size:0.7rem;';
        if (startYear !== undefined && startYear !== null && startYear !== '') {
            startInput.value = startYear;
        }

        var endInput = document.createElement('input');
        endInput.type = 'number';
        endInput.className = 'career-end-year';
        endInput.placeholder = 'End Year';
        endInput.style.cssText = 'flex:1;min-width:60px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 6px;font-size:0.7rem;';
        if (endYear !== undefined && endYear !== null && endYear !== '') {
            endInput.value = endYear;
        }

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'small danger remove-status';
        removeBtn.textContent = '\u2715';
        removeBtn.style.cssText = 'padding:2px 6px;font-size:0.6rem;';

        entry.appendChild(select);
        entry.appendChild(startInput);
        entry.appendChild(endInput);
        entry.appendChild(removeBtn);
        container.appendChild(entry);
    }

    function getCurrentWeek() {
        if (window.data && typeof window.data.currentWeek === 'number') {
            return window.data.currentWeek;
        }
        return 1;
    }

    function getAcademicTabHTML() {
        return `
            <div id="academic-view" style="padding:4px 0;">
                <p class="empty-state" style="padding:8px;font-size:0.8rem;">Loading academic data...</p>
            </div>
            <div class="form-group full-width section-divider">
                <label class="section-label">Class Management</label>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:4px;">
                    <select id="academic-class-select" style="flex:1;min-width:150px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                        <option value="">Select a class...</option>
                    </select>
                    <button type="button" id="add-to-class-btn" class="primary small">Add to Class</button>
                    <button type="button" id="remove-from-class-btn" class="danger small">Remove from Class</button>
                </div>
                <div id="character-classes-display" style="margin-top:8px;padding:8px;background:var(--bg);border-radius:4px;border:1px solid var(--border-soft);">
                    <span style="color:var(--text-dim);font-size:0.7rem;">Current Classes: <span id="current-classes-list">None</span></span>
                </div>
            </div>
            <div class="form-group full-width section-divider">
                <label>Tournament Eliminations</label>
                <div id="tournament-eliminations-view"><p class="empty-state" style="padding:6px;font-size:0.75rem;">None</p></div>
            </div>
            <div class="form-group full-width section-divider">
                <label class="section-label warning-label">Standalone Elimination</label>
                <div class="elimination-controls">
                    <label>Week:</label>
                    <input type="number" id="standalone-elim-week" min="1" max="52" value="1" />
                    <label>Reason:</label>
                    <input type="text" id="standalone-elim-reason" placeholder="e.g., Dropped out" />
                    <button type="button" id="add-standalone-elim-btn" class="small warning-btn">Apply</button>
                </div>
                <div id="standalone-eliminations-container"><p class="empty-state" style="padding:6px;font-size:0.75rem;">None</p></div>
            </div>
        `;
    }

    function getProfessionalTabHTML() {
        return `
            <div class="form-group full-width">
                <label>Career Status History</label>
                <div id="career-status-container">
                    <div class="career-status-entry">
                        <select class="career-status-select">
                            ${CAREER_STATUS_OPTIONS.map(function(opt) {
                                return '<option value="' + opt.value + '">' + opt.label + '</option>';
                            }).join('')}
                        </select>
                        <input type="number" class="career-start-year" placeholder="Start Year" />
                        <input type="number" class="career-end-year" placeholder="End Year" />
                        <button type="button" class="small danger remove-status">\u2715</button>
                    </div>
                </div>
                <button type="button" id="add-status-btn" class="small">+ Add Status</button>
            </div>
            <div class="form-group full-width">
                <label>Specialty/Discipline</label>
                <input type="text" id="char-specialty" />
            </div>
            <div id="professional-view" style="padding:4px 0;">
                <p class="empty-state" style="padding:8px;font-size:0.8rem;">Loading professional data...</p>
            </div>
        `;
    }

    function getSocialTabHTML() {
        return `
            <div id="social-view">
                <p class="empty-state" style="padding:8px;font-size:0.8rem;">Loading social connections...</p>
            </div>
            <div class="form-actions" style="margin-top:8px;">
                <button type="button" id="add-social-relation-btn" class="primary small">+ Add Connection</button>
            </div>
        `;
    }

    window.CharacterViews = {
        renderAcademic: renderAcademic,
        renderProfessional: renderProfessional,
        renderSocial: renderSocial,

        addCareerStatusEntry: addCareerStatusEntry,

        getRelationshipTypeLabel: getRelationshipTypeLabel,
        getRelationshipTypeColor: getSafeRelationshipColor,

        getAcademicTabHTML: getAcademicTabHTML,
        getProfessionalTabHTML: getProfessionalTabHTML,
        getSocialTabHTML: getSocialTabHTML
    }; 

})();
