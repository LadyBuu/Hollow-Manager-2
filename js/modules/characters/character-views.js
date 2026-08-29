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
 *   - All user-controlled data must be escaped with escapeHtml()
 *   - User-controlled text is inserted using safe DOM APIs/textContent
 *   - No inline event handlers - events bound in character-events.js
 *   - Safe CSS color validation for relationship types
 *   - Grades are sorted chronologically
 *   - Missions show their assigned team
 *   - Orphaned relationships are clearly identified
 * 
 * DEPENDENCIES:
 *   - window.getCharacterById (from core-utils.js)
 *   - window.getDisplayName (from core-utils.js)
 *   - window.getClassDisplayName (from core-utils.js)
 *   - window.getDiscipline (from core-utils.js)
 *   - window.getTeamName (from core-utils.js)
 *   - window.data (global state)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterViewsLoaded) {
        return;
    }
    window.__characterViewsLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var required = [
            'getCharacterById',
            'getDisplayName',
            'getClassDisplayName',
            'getDiscipline',
            'getTeamName'
        ];

        var missing = [];
        required.forEach(function(name) {
            if (typeof window[name] !== 'function') {
                missing.push(name);
            }
        });

        if (missing.length > 0) {
            console.warn('CharacterViews: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // HTML ESCAPING - Prevents XSS
    // ============================================================

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
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
        var color = getRelationshipTypeColor(typeId);

        if (!color || typeof color !== 'string') {
            return '#7f8c8d';
        }

        // Only allow whitelisted colors
        if (ALLOWED_COLORS[color]) {
            return color;
        }

        return '#7f8c8d';
    }

    // ============================================================
    // RELATIONSHIP TYPE HELPERS
    // ============================================================

    function getRelationshipTypeLabel(typeId) {
        var data = window.data || {};
        if (!data.social || !data.social.relationshipTypes) return typeId || 'Other';
        var type = data.social.relationshipTypes.find(function(t) {
            return t && String(t.id) === String(typeId);
        });
        return type ? type.label : typeId || 'Other';
    }

    function getRelationshipTypeColor(typeId) {
        var data = window.data || {};
        if (!data.social || !data.social.relationshipTypes) return '#7f8c8d';
        var type = data.social.relationshipTypes.find(function(t) {
            return t && String(t.id) === String(typeId);
        });
        return type ? type.color : '#7f8c8d';
    }

    // ============================================================
    // TEAM QUERY HELPER
    // ============================================================

    function getTeamsByTypeAndCharacter(types, charId) {
        if (!Array.isArray(types)) {
            types = [types];
        }
        var data = window.data || {};
        if (!data.teams) return [];

        return data.teams.filter(function(t) {
            if (!t || typeof t !== 'object') return false;
            if (t.status === 'deleted') return false;
            if (types.indexOf(t.type) === -1) return false;
            if (!t.members || !Array.isArray(t.members)) return false;
            return t.members.some(function(m) {
                return m && String(m.characterId) === String(charId);
            });
        }).sort(function(a, b) {
            var aMember = a.members.find(function(m) {
                return m && String(m.characterId) === String(charId);
            });
            var bMember = b.members.find(function(m) {
                return m && String(m.characterId) === String(charId);
            });
            var aJoin = parseInt(aMember ? aMember.joinPeriod : 0) || 0;
            var bJoin = parseInt(bMember ? bMember.joinPeriod : 0) || 0;
            return aJoin - bJoin;
        });
    }

    // ============================================================
    // SCHEDULE COUNT
    // ============================================================

    function getScheduleCount(charId) {
        var data = window.data || {};
        if (!data.curriculum || !data.curriculum.schedules) return 0;
        var schedule = data.curriculum.schedules[charId];
        if (!schedule) return 0;

        var count = 0;
        for (var week in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, week)) continue;
            var weekData = schedule[week];
            if (!weekData || typeof weekData !== 'object') continue;
            for (var day in weekData) {
                if (!Object.prototype.hasOwnProperty.call(weekData, day)) continue;
                var dayData = weekData[day];
                if (!dayData || typeof dayData !== 'object') continue;
                for (var hour in dayData) {
                    if (!Object.prototype.hasOwnProperty.call(dayData, hour)) continue;
                    if (dayData[hour]) count++;
                }
            }
        }
        return count;
    }

    // ============================================================
    // ACADEMIC VIEW
    // ============================================================

    function renderAcademic(char) {
        var container = document.getElementById('academic-view');
        if (!container) return;

        var data = window.data || {};
        var html = '';

        // Academic Teams
        html += '<h4 style="color:var(--accent);font-size:0.8rem;margin:8px 0 4px 0;">Academic Teams</h4>';
        var acadTeams = getTeamsByTypeAndCharacter('academic', char.id);

        if (acadTeams.length > 0) {
            acadTeams.forEach(function(team) {
                var member = team.members.find(function(m) {
                    return m && String(m.characterId) === String(char.id);
                });
                var joinPeriod = member ? member.joinPeriod : '';
                var leavePeriod = member ? member.leavePeriod : '';
                var periodDisplay = formatMembershipPeriod(joinPeriod, leavePeriod, 'Wk ');
                var classDisplay = team.classId ? ' [' + escapeHtml(typeof window.getClassDisplayName === 'function' ? window.getClassDisplayName(team.classId) : 'Unknown') + ']' : '';
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--accent);margin-bottom:3px;font-size:0.75rem;">';
                html += '<strong>' + escapeHtml(team.name) + '</strong>' + classDisplay + ' <span style="color:var(--text-dim);font-size:0.7rem;">(' + escapeHtml(periodDisplay) + ')</span>';
                if (member && member.role) html += ' <span style="color:var(--text-dim);font-size:0.65rem;">[' + escapeHtml(member.role) + ']</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No academic teams</p>';
        }

        // Grades - sorted chronologically
        html += '<h4 style="color:var(--info);font-size:0.8rem;margin:8px 0 4px 0;">Grades</h4>';
        var curriculum = data.curriculum || {};
        var grades = curriculum.grades && curriculum.grades[char.id] ? curriculum.grades[char.id] : {};
        var classCount = 0;

        for (var week in grades) {
            if (!Object.prototype.hasOwnProperty.call(grades, week)) continue;
            for (var discId in grades[week]) {
                if (!Object.prototype.hasOwnProperty.call(grades[week], discId)) continue;
                classCount++;
            }
        }

        if (classCount > 0) {
            html += '<div style="max-height:100px;overflow-y:auto;font-size:0.7rem;">';
            // Sort weeks chronologically
            var weeks = Object.keys(grades).sort(function(a, b) {
                return parseInt(a) - parseInt(b);
            });
            weeks.forEach(function(week) {
                if (!Object.prototype.hasOwnProperty.call(grades, week)) return;
                // Sort disciplines alphabetically
                var discIds = Object.keys(grades[week]).sort();
                discIds.forEach(function(discId) {
                    if (!Object.prototype.hasOwnProperty.call(grades[week], discId)) return;
                    var disc = typeof window.getDiscipline === 'function' ? window.getDiscipline(discId) : null;
                    var score = grades[week][discId];
                    var discName = disc ? disc.name : 'Unknown';
                    html += '<div style="padding:2px 8px;background:var(--bg);border-radius:3px;margin-bottom:2px;display:flex;justify-content:space-between;">';
                    html += '<span>' + escapeHtml(discName) + ' (Wk ' + escapeHtml(week) + ')</span>';
                    html += '<span style="color:var(--accent);font-weight:600;">' + escapeHtml(score) + '%</span>';
                    html += '</div>';
                });
            });
            html += '</div>';
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No grades recorded</p>';
        }

        container.innerHTML = html;
    }

    // ============================================================
    // PROFESSIONAL VIEW
    // ============================================================

    function renderProfessional(char) {
        var container = document.getElementById('professional-view');
        if (!container) return;

        var data = window.data || {};
        var html = '';

        // Professional Teams
        html += '<h4 style="color:var(--info);font-size:0.8rem;margin:8px 0 4px 0;">Professional Teams</h4>';
        var profTeams = getTeamsByTypeAndCharacter('professional', char.id);

        if (profTeams.length > 0) {
            profTeams.forEach(function(team) {
                var member = team.members.find(function(m) {
                    return m && String(m.characterId) === String(char.id);
                });
                var joinPeriod = member ? member.joinPeriod : '';
                var leavePeriod = member ? member.leavePeriod : '';
                var periodDisplay = formatMembershipPeriod(joinPeriod, leavePeriod);
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--info);margin-bottom:3px;font-size:0.75rem;">';
                html += '<strong>' + escapeHtml(team.name) + '</strong> <span style="color:var(--text-dim);font-size:0.7rem;">(' + escapeHtml(periodDisplay) + ')</span>';
                if (member && member.role) html += ' <span style="color:var(--text-dim);font-size:0.65rem;">[' + escapeHtml(member.role) + ']</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No professional teams</p>';
        }

        // Temporary Teams
        html += '<h4 style="color:var(--warning);font-size:0.8rem;margin:8px 0 4px 0;">Temporary Teams</h4>';
        var tempTeams = getTeamsByTypeAndCharacter(['temporary', 'internship'], char.id);

        if (tempTeams.length > 0) {
            tempTeams.forEach(function(team) {
                var member = team.members.find(function(m) {
                    return m && String(m.characterId) === String(char.id);
                });
                var joinPeriod = member ? member.joinPeriod : '';
                var leavePeriod = member ? member.leavePeriod : '';
                var periodDisplay = formatMembershipPeriod(joinPeriod, leavePeriod);
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--warning);margin-bottom:3px;font-size:0.75rem;">';
                html += '<strong>' + escapeHtml(team.name) + '</strong> <span style="color:var(--text-dim);font-size:0.7rem;">(' + escapeHtml(periodDisplay) + ')</span>';
                if (member && member.role) html += ' <span style="color:var(--text-dim);font-size:0.65rem;">[' + escapeHtml(member.role) + ']</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No temporary teams</p>';
        }

        // Civilian Teams
        html += '<h4 style="color:var(--text-dim);font-size:0.8rem;margin:8px 0 4px 0;">Civilian Teams</h4>';
        var civTeams = getTeamsByTypeAndCharacter('civilian', char.id);

        if (civTeams.length > 0) {
            civTeams.forEach(function(team) {
                var member = team.members.find(function(m) {
                    return m && String(m.characterId) === String(char.id);
                });
                var joinPeriod = member ? member.joinPeriod : '';
                var leavePeriod = member ? member.leavePeriod : '';
                var periodDisplay = formatMembershipPeriod(joinPeriod, leavePeriod);
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--text-dim);margin-bottom:3px;font-size:0.75rem;">';
                html += '<strong>' + escapeHtml(team.name) + '</strong> <span style="color:var(--text-dim);font-size:0.7rem;">(' + escapeHtml(periodDisplay) + ')</span>';
                if (member && member.role) html += ' <span style="color:var(--text-dim);font-size:0.65rem;">[' + escapeHtml(member.role) + ']</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No civilian teams</p>';
        }

        // Missions - with team name
        html += '<h4 style="color:var(--warning);font-size:0.8rem;margin:8px 0 4px 0;">Missions</h4>';
        var missions = data.missions ? data.missions.filter(function(m) {
            if (!m || typeof m !== 'object') return false;
            if (!m.assignedTeamId) return false;
            return data.teams && data.teams.some(function(t) {
                if (!t || typeof t !== 'object') return false;
                return String(t.id) === String(m.assignedTeamId) &&
                       t.members && t.members.some(function(mem) {
                           return mem && String(mem.characterId) === String(char.id);
                       });
            });
        }) : [];

        if (missions.length > 0) {
            missions.forEach(function(m) {
                var statusColor = m.status === 'completed' ? 'var(--accent)' :
                                 m.status === 'cancelled' ? 'var(--danger)' : 'var(--warning)';
                var teamName = typeof window.getTeamName === 'function' 
                    ? window.getTeamName(m.assignedTeamId) 
                    : 'Unknown Team';
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + statusColor + ';margin-bottom:3px;font-size:0.75rem;">';
                html += '<strong>' + escapeHtml(m.title) + '</strong> ';
                html += '<span style="color:var(--text-dim);font-size:0.65rem;">[' + escapeHtml(teamName) + ']</span> ';
                html += '<span style="color:' + statusColor + ';font-size:0.65rem;">' + escapeHtml(m.status || 'active') + '</span>';
                if (m.location) html += ' <span style="color:var(--text-dim);font-size:0.65rem;">(' + escapeHtml(m.location) + ')</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No missions assigned</p>';
        }

        container.innerHTML = html;
    }

    // ============================================================
    // SOCIAL VIEW
    // ============================================================

    function renderSocial(char) {
        var container = document.getElementById('social-view');
        if (!container) return;

        var data = window.data || {};
        var rels = data.social && data.social.relationships ?
            data.social.relationships.filter(function(r) {
                return r && (String(r.character1) === String(char.id) ||
                           String(r.character2) === String(char.id));
            }) : [];

        if (rels.length === 0) {
            container.innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">No social connections</p>';
            return;
        }

        var html = '';
        rels.forEach(function(rel) {
            var otherId = String(rel.character1) === String(char.id) ? rel.character2 : rel.character1;
            var other = typeof window.getCharacterById === 'function' ? window.getCharacterById(otherId) : null;
            
            // Clearly identify orphaned relationships
            var otherName = other ? (typeof window.getDisplayName === 'function' ? window.getDisplayName(other) : 'Unknown') : 'Unknown Character';
            if (!other) {
                otherName = '⚠ Unknown Character (ID: ' + escapeHtml(otherId) + ')';
            }
            
            var typeLabel = getRelationshipTypeLabel(rel.typeId);
            var typeColor = getSafeRelationshipColor(rel.typeId);
            
            // Format period
            var period = '';
            if (rel.startYear && rel.endYear) {
                period = rel.startYear + ' → ' + rel.endYear;
            } else if (rel.startYear) {
                period = 'From ' + rel.startYear;
            }
            
            var clarification = rel.clarification ? ' (' + escapeHtml(rel.clarification) + ')' : '';
            var notes = rel.notes ? ' 📝' : '';

            html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + typeColor + ';margin-bottom:3px;font-size:0.75rem;">';
            html += '<span><strong>' + escapeHtml(otherName) + '</strong> <span style="color:' + typeColor + ';">' + escapeHtml(typeLabel) + clarification + '</span>' + notes + '</span>';
            html += '<span style="font-size:0.65rem;color:var(--text-dim);">' + escapeHtml(period) + '</span>';
            html += '</div>';
        });
        container.innerHTML = html;
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
        if (leaveStr) return prefix + leaveStr;
        return prefix + '?';
    }

    // ============================================================
    // CAREER STATUS HELPERS - DOM-BASED FOR SAFETY
    // ============================================================

    function addCareerStatusEntry(container, status, startYear, endYear) {
        if (!container) return;

        var entry = document.createElement('div');
        entry.className = 'career-status-entry';

        // Create select with DOM API
        var select = document.createElement('select');
        select.className = 'career-status-select';
        var statusOptions = [
            { value: '', label: 'Select status...' },
            { value: 'civilian', label: 'Civilian' },
            { value: 'trainee', label: 'Trainee' },
            { value: 'rookie', label: 'Rookie' },
            { value: 'junior', label: 'Junior' },
            { value: 'senior', label: 'Senior' },
            { value: 'instructor', label: 'Instructor' },
            { value: 'support', label: 'Support' }
        ];
        statusOptions.forEach(function(opt) {
            var option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            if (status && status === opt.value) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        // Create input fields
        var startInput = document.createElement('input');
        startInput.type = 'number';
        startInput.className = 'career-start-year';
        startInput.placeholder = 'Start Year';
        if (startYear !== undefined && startYear !== null && startYear !== '') {
            startInput.value = startYear;
        }

        var endInput = document.createElement('input');
        endInput.type = 'number';
        endInput.className = 'career-end-year';
        endInput.placeholder = 'End Year';
        if (endYear !== undefined && endYear !== null && endYear !== '') {
            endInput.value = endYear;
        }

        // Create remove button
        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'small danger remove-status';
        removeBtn.textContent = '✕';

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
                            <option value="">Select status...</option>
                            <option value="civilian">Civilian</option>
                            <option value="trainee">Trainee</option>
                            <option value="rookie">Rookie</option>
                            <option value="junior">Junior</option>
                            <option value="senior">Senior</option>
                            <option value="instructor">Instructor</option>
                            <option value="support">Support</option>
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

        // Query helpers
        getTeamsByTypeAndCharacter: getTeamsByTypeAndCharacter,
        getRelationshipTypeLabel: getRelationshipTypeLabel,
        getRelationshipTypeColor: getRelationshipTypeColor,
        getScheduleCount: getScheduleCount,

        // HTML generators
        getAcademicTabHTML: getAcademicTabHTML,
        getProfessionalTabHTML: getProfessionalTabHTML,
        getSocialTabHTML: getSocialTabHTML
    };

})();
