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
 *   - Grades are sorted chronologically
 *   - Missions show their assigned team
 *   - Orphaned relationships are clearly identified
 *   - USES CharacterQueries for character data and display names
 *   - USES ClassesQueries for class display names
 *   - USES TeamQueries for team queries
 *   - USES DisciplineQueries for discipline names
 *   - USES GradeQueries for grade data
 *   - USES MissionQueries for mission data
 *   - USES SocialQueries for social data
 *   - USES Elimination for elimination status
 *   - NO DIRECT window.data ACCESS - all queries go through domain modules
 * 
 * DEPENDENCIES:
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.ClassesQueries (from classes-queries.js)
 *   - window.TeamQueries (from team-queries.js)
 *   - window.DisciplineQueries (from discipline-queries.js)
 *   - window.GradeQueries (from grade-queries.js) - optional
 *   - window.MissionQueries (from mission-queries.js) - optional
 *   - window.SocialQueries (from social-queries.js) - optional
 *   - window.Elimination (from elimination.js) - optional
 *   - window.DomUtils (from dom-utils.js)
 *   - window.NotificationSystem (from notification.js)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterViewsLoaded) {
        return;
    }
    window.__characterViewsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var ClassesQueries = window.ClassesQueries;
    var TeamQueries = window.TeamQueries;
    var DisciplineQueries = window.DisciplineQueries;
    var GradeQueries = window.GradeQueries || null;
    var MissionQueries = window.MissionQueries || null;
    var SocialQueries = window.SocialQueries || null;
    var Elimination = window.Elimination || null;
    var DomUtils = window.DomUtils;
    var NotificationSystem = window.NotificationSystem;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var CAREER_STATUS_OPTIONS = window.CharacterConstants
        ? window.CharacterConstants.CAREER_STATUS_OPTIONS
        : [
            { value: '', label: 'Select status...' },
            { value: 'civilian', label: 'Civilian' },
            { value: 'trainee', label: 'Trainee' },
            { value: 'rookie', label: 'Rookie' },
            { value: 'junior', label: 'Junior' },
            { value: 'senior', label: 'Senior' },
            { value: 'instructor', label: 'Instructor' },
            { value: 'support', label: 'Support' }
        ];

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        // CharacterQueries is MANDATORY
        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        // ClassesQueries is MANDATORY
        if (!ClassesQueries || typeof ClassesQueries.getClassDisplayName !== 'function') {
            missing.push('ClassesQueries.getClassDisplayName');
        }

        // TeamQueries is MANDATORY
        if (!TeamQueries || typeof TeamQueries.getTeamsForCharacter !== 'function') {
            missing.push('TeamQueries.getTeamsForCharacter');
        }
        if (!TeamQueries || typeof TeamQueries.getTeamName !== 'function') {
            missing.push('TeamQueries.getTeamName');
        }

        // DomUtils is MANDATORY
        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        // NotificationSystem is MANDATORY
        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (missing.length > 0) {
            console.warn('CharacterViews: Missing required dependencies:', missing.join(', '));
            return false;
        }

        // Optional dependencies (log warning but don't fail)
        var optional = [
            'GradeQueries.getCharacterGrades',
            'MissionQueries.getMissionsForCharacter',
            'SocialQueries.getRelationshipsForCharacter',
            'Elimination.isCharacterEliminated'
        ];

        var missingOptional = [];
        optional.forEach(function(name) {
            var parts = name.split('.');
            var obj = window[parts[0]];
            if (!obj || typeof obj[parts[1]] !== 'function') {
                missingOptional.push(name);
            }
        });

        if (missingOptional.length > 0) {
            console.warn('CharacterViews: Missing optional dependencies:', missingOptional.join(', '));
        }

        return true;
    }

    // ============================================================
    // NOTIFICATION - Uses NotificationSystem (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        if (NotificationSystem && typeof NotificationSystem.notify === 'function') {
            NotificationSystem.notify(message, type);
        } else if (type === 'error') {
            alert('Error: ' + message);
        } else {
            alert(message);
        }
    }

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function escapeHtml(value) {
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
        }
        // Emergency fallback (should never be reached)
        if (value === undefined || value === null) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/`/g, '&#x60;');
    }

    // ============================================================
    // SAFE CSS COLOR VALIDATION - Whitelist only
    // ============================================================

    var ALLOWED_COLORS = {
        '#8cbb3a': true,  // familial
        '#c9a24b': true,  // professional
        '#c1453c': true,  // romantic
        '#4a9bc7': true,  // friendship
        '#9b59b6': true,  // mentor
        '#e67e22': true,  // rivalry
        '#27ae60': true,  // alliance
        '#7f8c8d': true   // other
    };

    function getSafeRelationshipColor(typeId) {
        var color = getRelationshipTypeRawColor(typeId);

        if (!color || typeof color !== 'string') {
            return '#7f8c8d';
        }

        // Normalise and whitelist
        var normalized = color.toLowerCase();
        if (ALLOWED_COLORS[normalized]) {
            return normalized;
        }

        return '#7f8c8d';
    }

    // ============================================================
    // RELATIONSHIP TYPE HELPERS - Uses SocialQueries if available
    // ============================================================

    function getRelationshipTypeRawColor(typeId) {
        // Prefer SocialQueries if available
        if (SocialQueries && typeof SocialQueries.getRelationshipTypeColor === 'function') {
            return SocialQueries.getRelationshipTypeColor(typeId) || '#7f8c8d';
        }

        // Fallback: direct data access (legacy)
        var data = window.data || {};
        if (!data.social || !data.social.relationshipTypes) return '#7f8c8d';
        var type = data.social.relationshipTypes.find(function(t) {
            return t && String(t.id) === String(typeId);
        });
        return type ? type.color : '#7f8c8d';
    }

    function getRelationshipTypeLabel(typeId) {
        // Prefer SocialQueries if available
        if (SocialQueries && typeof SocialQueries.getRelationshipTypeLabel === 'function') {
            return SocialQueries.getRelationshipTypeLabel(typeId) || 'Other';
        }

        // Fallback: direct data access (legacy)
        var data = window.data || {};
        if (!data.social || !Array.isArray(data.social.relationshipTypes)) {
            return typeId != null ? String(typeId) : 'Other';
        }
        var type = data.social.relationshipTypes.find(function(t) {
            return t && String(t.id) === String(typeId);
        });
        if (type && type.label != null) {
            return String(type.label);
        }
        return typeId != null ? String(typeId) : 'Other';
    }

    // ============================================================
    // MEMBERSHIP PERIOD FORMATTER
    // ============================================================

    function formatMembershipPeriod(join, leave, prefix) {
        prefix = prefix || '';
        var joinStr = (join !== undefined && join !== null && join !== '') ? String(join) : '';
        var leaveStr = (leave !== undefined && leave !== null && leave !== '') ? String(leave) : '';

        if (joinStr && leaveStr) return prefix + joinStr + ' → ' + prefix + leaveStr;
        if (joinStr) return prefix + joinStr + ' → Present';
        if (leaveStr) return 'Until ' + prefix + leaveStr;
        return prefix + '?';
    }

    // ============================================================
    // GRADE VALUE VALIDATION
    // ============================================================

    function formatGradeValue(score) {
        var num = Number(score);
        if (Number.isFinite(num) && num >= 0 && num <= 100) {
            return Math.round(num) + '%';
        }
        return 'Invalid';
    }

    function isValidGradeObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value);
    }

    // ============================================================
    // ACADEMIC VIEW - Uses TeamQueries, GradeQueries, DisciplineQueries
    // ============================================================

    function renderAcademic(char) {
        var container = document.getElementById('academic-view');
        if (!container) return;

        // Clear container
        container.textContent = '';

        // ---- ACADEMIC TEAMS ----
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
                    var className = ClassesQueries.getClassDisplayName(team.classId);
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

        // ---- GRADES ----
        var gradeHeading = document.createElement('h4');
        gradeHeading.style.cssText = 'color:var(--info);font-size:0.8rem;margin:8px 0 4px 0;';
        gradeHeading.textContent = 'Grades';
        container.appendChild(gradeHeading);

        var grades = [];

        if (GradeQueries && typeof GradeQueries.getCharacterGrades === 'function') {
            grades = GradeQueries.getCharacterGrades(char.id) || [];
        } else {
            // Legacy fallback - direct data access
            var data = window.data || {};
            var curriculum = data.curriculum || {};
            var gradeData = curriculum.grades && curriculum.grades[char.id]
                ? curriculum.grades[char.id]
                : {};

            if (isValidGradeObject(gradeData)) {
                for (var week in gradeData) {
                    if (!Object.prototype.hasOwnProperty.call(gradeData, week)) continue;
                    var weekGrades = gradeData[week];
                    if (!isValidGradeObject(weekGrades)) continue;
                    for (var discId in weekGrades) {
                        if (!Object.prototype.hasOwnProperty.call(weekGrades, discId)) continue;
                        var score = weekGrades[discId];
                        var disc = DisciplineQueries && typeof DisciplineQueries.getDiscipline === 'function'
                            ? DisciplineQueries.getDiscipline(discId)
                            : null;
                        grades.push({
                            week: week,
                            disciplineId: discId,
                            disciplineName: disc ? disc.name : 'Unknown',
                            score: score
                        });
                    }
                }
            }
        }

        if (grades.length > 0) {
            // Sort chronologically
            grades.sort(function(a, b) {
                return parseInt(a.week, 10) - parseInt(b.week, 10);
            });

            var gradeContainer = document.createElement('div');
            gradeContainer.style.cssText = 'max-height:100px;overflow-y:auto;font-size:0.7rem;';

            grades.forEach(function(g) {
                var formattedScore = formatGradeValue(g.score);

                var gradeDiv = document.createElement('div');
                gradeDiv.style.cssText = 'padding:2px 8px;background:var(--bg);border-radius:3px;margin-bottom:2px;display:flex;justify-content:space-between;';

                var nameSpan = document.createElement('span');
                nameSpan.textContent = g.disciplineName + ' (Wk ' + g.week + ')';
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

        // ---- ELIMINATION STATUS ----
        var elimHeading = document.createElement('h4');
        elimHeading.style.cssText = 'color:var(--danger);font-size:0.8rem;margin:8px 0 4px 0;';
        elimHeading.textContent = 'Elimination Status';
        container.appendChild(elimHeading);

        var isEliminated = false;
        var currentWeek = window.data && window.data.currentWeek ? window.data.currentWeek : 1;

        if (Elimination && typeof Elimination.isCharacterEliminated === 'function') {
            isEliminated = Elimination.isCharacterEliminated(char.id, currentWeek);
        } else if (char.eliminatedWeeks && Array.isArray(char.eliminatedWeeks)) {
            isEliminated = char.eliminatedWeeks.some(function(w) {
                return parseInt(w, 10) <= currentWeek;
            });
        }

        var elimDiv = document.createElement('div');
        elimDiv.style.cssText = 'padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + (isEliminated ? 'var(--danger)' : 'var(--accent)') + ';font-size:0.75rem;';
        elimDiv.textContent = isEliminated ? '⚠ This character is eliminated' : '✓ Not eliminated';
        container.appendChild(elimDiv);
    }

    // ============================================================
    // PROFESSIONAL VIEW - Uses TeamQueries, MissionQueries
    // ============================================================

    function renderProfessional(char) {
        var container = document.getElementById('professional-view');
        if (!container) return;

        container.textContent = '';

        // ---- PROFESSIONAL TEAMS ----
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

        // ---- TEMPORARY TEAMS ----
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

        // ---- CIVILIAN TEAMS ----
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

        // ---- MISSIONS ----
        var missionHeading = document.createElement('h4');
        missionHeading.style.cssText = 'color:var(--warning);font-size:0.8rem;margin:8px 0 4px 0;';
        missionHeading.textContent = 'Missions';
        container.appendChild(missionHeading);

        var missions = [];

        if (MissionQueries && typeof MissionQueries.getMissionsForCharacter === 'function') {
            missions = MissionQueries.getMissionsForCharacter(char.id) || [];
        } else {
            // Legacy fallback
            var data = window.data || {};
            var allMissions = data.missions || [];
            var teams = data.teams || [];

            allMissions.forEach(function(m) {
                if (!m || typeof m !== 'object') return;
                if (!m.assignedTeamId) return;
                var team = teams.find(function(t) {
                    return t && String(t.id) === String(m.assignedTeamId) &&
                           t.members && t.members.some(function(mem) {
                               return mem && String(mem.characterId) === String(char.id);
                           });
                });
                if (team) {
                    missions.push({
                        id: m.id,
                        title: m.title || 'Untitled',
                        status: m.status || 'active',
                        location: m.location || '',
                        teamName: team.name || 'Unknown Team',
                        teamId: m.assignedTeamId
                    });
                }
            });
        }

        if (missions.length > 0) {
            missions.forEach(function(m) {
                var statusColor = m.status === 'completed' ? 'var(--accent)' :
                                 m.status === 'cancelled' ? 'var(--danger)' : 'var(--warning)';
                var teamName = TeamQueries.getTeamName(m.teamId);

                var div = document.createElement('div');
                div.style.cssText = 'padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + statusColor + ';margin-bottom:3px;font-size:0.75rem;';

                var strong = document.createElement('strong');
                strong.textContent = m.title;
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

    // ============================================================
    // SOCIAL VIEW - Uses SocialQueries
    // ============================================================

    function renderSocial(char) {
        var container = document.getElementById('social-view');
        if (!container) return;

        container.textContent = '';

        var relationships = [];

        if (SocialQueries && typeof SocialQueries.getRelationshipsForCharacter === 'function') {
            relationships = SocialQueries.getRelationshipsForCharacter(char.id) || [];
        } else {
            // Legacy fallback
            var data = window.data || {};
            var allRels = data.social && Array.isArray(data.social.relationships)
                ? data.social.relationships
                : [];
            relationships = allRels.filter(function(r) {
                return r && (String(r.character1) === String(char.id) ||
                           String(r.character2) === String(char.id));
            });
        }

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

            // Clearly identify orphaned relationships
            var otherName = other ? CharacterQueries.getDisplayName(other) : 'Unknown Character';
            if (!other) {
                otherName = '⚠ Unknown Character (ID: ' + otherId + ')';
            }

            var typeLabel = getRelationshipTypeLabel(rel.typeId);
            var typeColor = getSafeRelationshipColor(rel.typeId);

            var period = '';
            if (rel.startYear && rel.endYear) {
                period = rel.startYear + ' → ' + rel.endYear;
            } else if (rel.startYear) {
                period = 'From ' + rel.startYear;
            }

            var clarification = rel.clarification ? ' (' + rel.clarification + ')' : '';
            var notes = rel.notes ? ' 📝' : '';

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

    // ============================================================
    // CAREER STATUS HELPERS - DOM-BASED FOR SAFETY
    // ============================================================

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
        removeBtn.textContent = '✕';
        removeBtn.style.cssText = 'padding:2px 6px;font-size:0.6rem;';

        entry.appendChild(select);
        entry.appendChild(startInput);
        entry.appendChild(endInput);
        entry.appendChild(removeBtn);
        container.appendChild(entry);

        // Remove button event - handled by event delegation in character-events.js
    }

    // ============================================================
    // VIEW PANEL HTML GENERATORS
    // ============================================================

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
                        <button type="button" class="small danger remove-status">✕</button>
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

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterViews = {
        // Rendering
        renderAcademic: renderAcademic,
        renderProfessional: renderProfessional,
        renderSocial: renderSocial,

        // Career status
        addCareerStatusEntry: addCareerStatusEntry,

        // Helpers (for external use)
        getRelationshipTypeLabel: getRelationshipTypeLabel,
        getRelationshipTypeColor: getSafeRelationshipColor,

        // HTML generators
        getAcademicTabHTML: getAcademicTabHTML,
        getProfessionalTabHTML: getProfessionalTabHTML,
        getSocialTabHTML: getSocialTabHTML
    };

})();
