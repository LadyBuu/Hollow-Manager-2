/**
 * js/modules/characters/character-views.js - Character Views
 * Renders academic, professional, and social views for a character
 * Path: js/modules/characters/character-views.js
 * 
 * IMPORTANT: All user-controlled data must be escaped with escapeHtml()
 * before being inserted into innerHTML. This prevents XSS attacks.
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterViewsLoaded) {
        return;
    }
    window.__characterViewsLoaded = true;

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
    // SAFE CSS COLOR VALIDATION
    // ============================================================

    function getSafeRelationshipColor(typeId) {
        var color = getRelationshipTypeColor(typeId);
        
        // Standard CSS hex colors: 3, 4, 6, or 8 hex digits
        if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) {
            return color;
        }
        
        // Allow rgb/rgba values
        if (/^rgba?\(\s*[\d\s.,%]+\)$/i.test(color)) {
            return color;
        }
        
        // Common safe CSS colors used in the app
        var safeColors = {
            '#8cbb3a': true,  // familiar
            '#c9a24b': true,  // professional
            '#c1453c': true,  // romantic
            '#4a9bc7': true,  // friendship
            '#9b59b6': true,  // mentor
            '#e67e22': true,  // rivalry
            '#27ae60': true,  // alliance
            '#7f8c8d': true   // other
        };
        
        if (safeColors[color]) {
            return color;
        }
        
        return '#7f8c8d'; // Default safe color
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
                    return String(m.characterId) === String(char.id); 
                });
                var period = member ? (member.joinPeriod || '?') : '?';
                if (member && member.leavePeriod) period += ' → ' + member.leavePeriod;
                var classDisplay = team.classId ? ' [' + escapeHtml(window.getClassDisplayName(team.classId)) + ']' : '';
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--accent);margin-bottom:3px;font-size:0.75rem;">';
                html += '<strong>' + escapeHtml(team.name) + '</strong>' + classDisplay + ' <span style="color:var(--text-dim);font-size:0.7rem;">(Wk ' + escapeHtml(period) + ')</span>';
                if (member && member.role) html += ' <span style="color:var(--text-dim);font-size:0.65rem;">[' + escapeHtml(member.role) + ']</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No academic teams</p>';
        }

        // Grades - with defensive own-property protection
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
            for (var week in grades) {
                if (!Object.prototype.hasOwnProperty.call(grades, week)) continue;
                for (var discId in grades[week]) {
                    if (!Object.prototype.hasOwnProperty.call(grades[week], discId)) continue;
                    var disc = window.getDiscipline(discId);
                    var score = grades[week][discId];
                    var discName = disc ? disc.name : 'Unknown';
                    html += '<div style="padding:2px 8px;background:var(--bg);border-radius:3px;margin-bottom:2px;display:flex;justify-content:space-between;">';
                    html += '<span>' + escapeHtml(discName) + ' (Wk ' + escapeHtml(week) + ')</span>';
                    html += '<span style="color:var(--accent);font-weight:600;">' + escapeHtml(score) + '%</span>';
                    html += '</div>';
                }
            }
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
                    return String(m.characterId) === String(char.id); 
                });
                var period = member ? (member.joinPeriod || '?') : '?';
                if (member && member.leavePeriod) period += ' → ' + member.leavePeriod;
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--info);margin-bottom:3px;font-size:0.75rem;">';
                html += '<strong>' + escapeHtml(team.name) + '</strong> <span style="color:var(--text-dim);font-size:0.7rem;">(' + escapeHtml(period) + ')</span>';
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
                    return String(m.characterId) === String(char.id); 
                });
                var period = member ? (member.joinPeriod || '?') : '?';
                if (member && member.leavePeriod) period += ' → ' + member.leavePeriod;
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--warning);margin-bottom:3px;font-size:0.75rem;">';
                html += '<strong>' + escapeHtml(team.name) + '</strong> <span style="color:var(--text-dim);font-size:0.7rem;">(' + escapeHtml(period) + ')</span>';
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
                    return String(m.characterId) === String(char.id); 
                });
                var period = member ? (member.joinPeriod || '?') : '?';
                if (member && member.leavePeriod) period += ' → ' + member.leavePeriod;
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--text-dim);margin-bottom:3px;font-size:0.75rem;">';
                html += '<strong>' + escapeHtml(team.name) + '</strong> <span style="color:var(--text-dim);font-size:0.7rem;">(' + escapeHtml(period) + ')</span>';
                if (member && member.role) html += ' <span style="color:var(--text-dim);font-size:0.65rem;">[' + escapeHtml(member.role) + ']</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.7rem;">No civilian teams</p>';
        }

        // Missions
        html += '<h4 style="color:var(--warning);font-size:0.8rem;margin:8px 0 4px 0;">Missions</h4>';
        var missions = data.missions ? data.missions.filter(function(m) {
            return m.assignedTeamId && data.teams && data.teams.some(function(t) {
                return String(t.id) === String(m.assignedTeamId) &&
                       t.members && t.members.some(function(mem) { 
                           return String(mem.characterId) === String(char.id); 
                       });
            });
        }) : [];

        if (missions.length > 0) {
            missions.forEach(function(m) {
                var statusColor = m.status === 'completed' ? 'var(--accent)' : 
                                 m.status === 'cancelled' ? 'var(--danger)' : 'var(--warning)';
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + statusColor + ';margin-bottom:3px;font-size:0.75rem;">';
                html += '<strong>' + escapeHtml(m.title) + '</strong> <span style="color:' + statusColor + ';font-size:0.65rem;">' + escapeHtml(m.status || 'active') + '</span>';
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
                return String(r.character1) === String(char.id) || 
                       String(r.character2) === String(char.id);
            }) : [];

        if (rels.length === 0) {
            container.innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">No social connections</p>';
            return;
        }

        var html = '';
        rels.forEach(function(rel) {
            var otherId = String(rel.character1) === String(char.id) ? rel.character2 : rel.character1;
            var other = window.getCharacterById(otherId);
            var otherName = other ? window.getDisplayName(other) : 'Unknown';
            var typeLabel = getRelationshipTypeLabel(rel.typeId);
            var typeColor = getSafeRelationshipColor(rel.typeId);
            var period = '';
            if (rel.startYear && rel.endYear) {
                period = rel.startYear + ' → ' + rel.endYear;
            } else if (rel.startYear) {
                period = 'From ' + rel.startYear;
            }
            // Escape the value, then build the string
            var clarification = rel.clarification 
                ? ' (' + escapeHtml(rel.clarification) + ')' 
                : '';

            html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + typeColor + ';margin-bottom:3px;font-size:0.75rem;">';
            html += '<span><strong>' + escapeHtml(otherName) + '</strong> <span style="color:' + typeColor + ';">' + escapeHtml(typeLabel) + clarification + '</span></span>';
            html += '<span style="font-size:0.65rem;color:var(--text-dim);">' + escapeHtml(period) + '</span>';
            html += '</div>';
        });
        container.innerHTML = html;
    }

    // ============================================================
    // CAREER STATUS HELPERS
    // ============================================================

    function addCareerStatusEntry(container, status, startYear, endYear) {
        var entry = document.createElement('div');
        entry.className = 'career-status-entry';
        entry.innerHTML = `
            <select class="career-status-select">
                <option value="">Select status...</option>
                <option value="civilian" ${status === 'civilian' ? 'selected' : ''}>Civilian</option>
                <option value="trainee" ${status === 'trainee' ? 'selected' : ''}>Trainee</option>
                <option value="rookie" ${status === 'rookie' ? 'selected' : ''}>Rookie</option>
                <option value="junior" ${status === 'junior' ? 'selected' : ''}>Junior</option>
                <option value="senior" ${status === 'senior' ? 'selected' : ''}>Senior</option>
                <option value="instructor" ${status === 'instructor' ? 'selected' : ''}>Instructor</option>
                <option value="support" ${status === 'support' ? 'selected' : ''}>Support</option>
            </select>
            <input type="number" class="career-start-year" placeholder="Start Year" value="${escapeHtml(startYear || '')}">
            <input type="number" class="career-end-year" placeholder="End Year" value="${escapeHtml(endYear || '')}">
            <button type="button" class="small danger remove-status">✕</button>
        `;
        container.appendChild(entry);
        entry.querySelector('.remove-status').onclick = function() {
            if (container.children.length > 1) {
                entry.remove();
            } else {
                alert('You need at least one status entry.');
            }
        };
    }

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    function getTeamsByTypeAndCharacter(types, charId) {
        if (!Array.isArray(types)) {
            types = [types];
        }
        var data = window.data || {};
        if (!data.teams) return [];
        
        return data.teams.filter(function(t) {
            if (t.status === 'deleted') return false;
            if (types.indexOf(t.type) === -1) return false;
            return t.members && t.members.some(function(m) { 
                return String(m.characterId) === String(charId); 
            });
        }).sort(function(a, b) {
            var aMember = a.members.find(function(m) { 
                return String(m.characterId) === String(charId); 
            });
            var bMember = b.members.find(function(m) { 
                return String(m.characterId) === String(charId); 
            });
            var aJoin = parseInt(aMember ? aMember.joinPeriod : 0) || 0;
            var bJoin = parseInt(bMember ? bMember.joinPeriod : 0) || 0;
            return aJoin - bJoin;
        });
    }

    function getRelationshipTypeLabel(typeId) {
        var data = window.data || {};
        if (!data.social || !data.social.relationshipTypes) return typeId || 'Other';
        var type = data.social.relationshipTypes.find(function(t) { return t.id === typeId; });
        return type ? type.label : typeId || 'Other';
    }

    function getRelationshipTypeColor(typeId) {
        var data = window.data || {};
        if (!data.social || !data.social.relationshipTypes) return '#7f8c8d';
        var type = data.social.relationshipTypes.find(function(t) { return t.id === typeId; });
        return type ? type.color : '#7f8c8d';
    }

    function getScheduleCount(charId) {
        var data = window.data || {};
        if (!data.curriculum || !data.curriculum.schedules) return 0;
        var schedule = data.curriculum.schedules[charId];
        if (!schedule) return 0;
        
        var count = 0;
        for (var week in schedule) {
            if (!Object.prototype.hasOwnProperty.call(schedule, week)) continue;
            for (var day in schedule[week]) {
                if (!Object.prototype.hasOwnProperty.call(schedule[week], day)) continue;
                for (var hour in schedule[week][day]) {
                    if (!Object.prototype.hasOwnProperty.call(schedule[week][day], hour)) continue;
                    if (schedule[week][day][hour]) count++;
                }
            }
        }
        return count;
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
                    <button id="add-to-class-btn" class="primary small">Add to Class</button>
                    <button id="remove-from-class-btn" class="danger small">Remove from Class</button>
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
        renderAcademic: renderAcademic,
        renderProfessional: renderProfessional,
        renderSocial: renderSocial,
        addCareerStatusEntry: addCareerStatusEntry,
        getTeamsByTypeAndCharacter: getTeamsByTypeAndCharacter,
        getRelationshipTypeLabel: getRelationshipTypeLabel,
        getRelationshipTypeColor: getRelationshipTypeColor,
        getScheduleCount: getScheduleCount,
        getAcademicTabHTML: getAcademicTabHTML,
        getProfessionalTabHTML: getProfessionalTabHTML,
        getSocialTabHTML: getSocialTabHTML
    };

})();
