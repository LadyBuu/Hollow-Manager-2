/**
 * js/modules/characters/character-detail.js - Character Detail View
 * Tabbed interface for viewing all character information
 * Path: js/modules/characters/character-detail.js
 * 
 * This module is responsible for:
 *   - Displaying character details in a modal
 *   - Tabbed navigation between detail sections
 *   - Pure read-only rendering (no mutations)
 *   - HTML escaping for XSS prevention
 *   - Safe CSS color validation for relationship types
 */

(function() {
    'use strict';

    var state = {
        characterId: null,
        activeTab: 'name'
    };

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
        
        // Only allow valid CSS colors
        if (/^#[0-9a-fA-F]{3,8}$/.test(color)) {
            return color;
        }
        
        if (/^rgba?\(\s*[\d\s.,%]+\)$/.test(color)) {
            return color;
        }
        
        // Known CSS color names (basic safety)
        var safeColors = ['black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 
                          'purple', 'pink', 'brown', 'gray', 'grey', 'silver', 'gold',
                          'aqua', 'azure', 'beige', 'bisque', 'blanchedalmond', 'burlywood',
                          'chocolate', 'coral', 'cornflowerblue', 'crimson', 'darkblue',
                          'darkcyan', 'darkgoldenrod', 'darkgray', 'darkgreen', 'darkkhaki',
                          'darkmagenta', 'darkolivegreen', 'darkorange', 'darkorchid',
                          'darkred', 'darksalmon', 'darkseagreen', 'darkslateblue',
                          'darkslategray', 'darkturquoise', 'darkviolet', 'deeppink',
                          'deepskyblue', 'dimgray', 'dodgerblue', 'firebrick', 'floralwhite',
                          'forestgreen', 'gainsboro', 'ghostwhite', 'goldenrod', 'greenyellow',
                          'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki',
                          'lavender', 'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue',
                          'lightcoral', 'lightcyan', 'lightgoldenrodyellow', 'lightgray',
                          'lightgreen', 'lightpink', 'lightsalmon', 'lightseagreen',
                          'lightskyblue', 'lightslategray', 'lightsteelblue', 'lightyellow',
                          'lime', 'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine',
                          'mediumblue', 'mediumorchid', 'mediumpurple', 'mediumseagreen',
                          'mediumslateblue', 'mediumspringgreen', 'mediumturquoise',
                          'mediumvioletred', 'midnightblue', 'mintcream', 'mistyrose',
                          'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab',
                          'orange', 'orangered', 'orchid', 'palegoldenrod', 'palegreen',
                          'paleturquoise', 'palevioletred', 'papayawhip', 'peachpuff',
                          'peru', 'plum', 'powderblue', 'rosybrown', 'royalblue', 'saddlebrown',
                          'salmon', 'sandybrown', 'seagreen', 'seashell', 'sienna', 'skyblue',
                          'slateblue', 'slategray', 'snow', 'springgreen', 'steelblue', 'tan',
                          'teal', 'thistle', 'tomato', 'turquoise', 'violet', 'wheat',
                          'whitesmoke', 'yellowgreen'];
        
        if (safeColors.indexOf(color.toLowerCase()) !== -1) {
            return color;
        }
        
        return '#7f8c8d'; // Default safe color
    }

    // ============================================================
    // OPEN / CLOSE
    // ============================================================

    function openCharacterDetail(charId) {
        var char = window.getCharacterById(charId);
        if (!char) {
            alert('Character not found.');
            return;
        }

        // Reset state when opening
        state.characterId = charId;
        state.activeTab = 'name';

        var modal = document.getElementById('character-detail-modal');
        if (!modal) {
            createCharacterDetailModal();
            modal = document.getElementById('character-detail-modal');
        }

        renderCharacterDetail(char);
        modal.classList.remove('hidden');
    }

    function closeCharacterDetail() {
        var modal = document.getElementById('character-detail-modal');
        if (modal) modal.classList.add('hidden');
        state.characterId = null;
    }

    // ============================================================
    // MODAL CREATION
    // ============================================================

    function createCharacterDetailModal() {
        var modal = document.createElement('div');
        modal.id = 'character-detail-modal';
        modal.className = 'modal hidden';
        modal.innerHTML = `
            <div class="modal-content wide">
                <div class="modal-header">
                    <h3 id="detail-character-name">Character</h3>
                    <button class="close-modal" id="close-character-detail">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="detail-tabs">
                        <button class="detail-tab-btn active" data-tab="name">Name</button>
                        <button class="detail-tab-btn" data-tab="physical">Physical</button>
                        <button class="detail-tab-btn" data-tab="personality">Personality</button>
                        <button class="detail-tab-btn" data-tab="career">Career</button>
                        <button class="detail-tab-btn" data-tab="academic">Academic</button>
                        <button class="detail-tab-btn" data-tab="stats">Stats</button>
                        <button class="detail-tab-btn" data-tab="social">Social</button>
                        <button class="detail-tab-btn" data-tab="notes">Notes</button>
                    </div>
                    <div id="detail-tab-content">
                        <div id="detail-name" class="detail-tab-panel active"></div>
                        <div id="detail-physical" class="detail-tab-panel" style="display:none;"></div>
                        <div id="detail-personality" class="detail-tab-panel" style="display:none;"></div>
                        <div id="detail-career" class="detail-tab-panel" style="display:none;"></div>
                        <div id="detail-academic" class="detail-tab-panel" style="display:none;"></div>
                        <div id="detail-stats" class="detail-tab-panel" style="display:none;"></div>
                        <div id="detail-social" class="detail-tab-panel" style="display:none;"></div>
                        <div id="detail-notes" class="detail-tab-panel" style="display:none;"></div>
                    </div>
                    <div class="form-actions">
                        <button id="edit-character-from-detail" class="primary">Edit Character</button>
                        <button id="close-character-detail-btn" class="secondary">Close</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('close-character-detail').addEventListener('click', closeCharacterDetail);
        document.getElementById('close-character-detail-btn').addEventListener('click', closeCharacterDetail);

        modal.addEventListener('click', function(e) {
            if (e.target === this) closeCharacterDetail();
        });

        modal.querySelectorAll('.detail-tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var tab = this.dataset.tab;
                switchDetailTab(tab);
            });
        });

        document.getElementById('edit-character-from-detail').addEventListener('click', function() {
            var id = state.characterId;
            if (id) {
                closeCharacterDetail();
                if (typeof window.showCharacterForm === 'function') {
                    window.showCharacterForm(id);
                }
            }
        });
    }

    // ============================================================
    // TAB SWITCHING
    // ============================================================

    function switchDetailTab(tab) {
        var modal = document.getElementById('character-detail-modal');
        if (!modal) return;

        state.activeTab = tab;

        modal.querySelectorAll('.detail-tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        modal.querySelectorAll('.detail-tab-panel').forEach(function(panel) {
            var panelId = panel.id.replace('detail-', '');
            panel.style.display = panelId === tab ? 'block' : 'none';
            panel.classList.toggle('active', panelId === tab);
        });

        var char = window.getCharacterById(state.characterId);
        if (char) {
            renderDetailTab(tab, char);
        }
    }

    // ============================================================
    // RENDER DETAIL
    // ============================================================

    function renderCharacterDetail(char) {
        var name = window.getDisplayName(char);
        var nameEl = document.getElementById('detail-character-name');
        if (nameEl) nameEl.textContent = name;

        // Render only the active tab
        renderDetailTab(state.activeTab, char);
    }

    function renderDetailTab(tab, char) {
        var container = document.getElementById('detail-' + tab);
        if (!container) return;

        var html = '';

        switch(tab) {
            case 'name':
                html = renderNameTab(char);
                break;
            case 'physical':
                html = renderPhysicalTab(char);
                break;
            case 'personality':
                html = renderPersonalityTab(char);
                break;
            case 'career':
                html = renderCareerTab(char);
                break;
            case 'academic':
                html = renderAcademicTab(char);
                break;
            case 'stats':
                html = renderStatsTab(char);
                break;
            case 'social':
                html = renderSocialTab(char);
                break;
            case 'notes':
                html = renderNotesTab(char);
                break;
        }

        container.innerHTML = html;
    }

    // ============================================================
    // TAB RENDERERS - WITH HTML ESCAPING
    // ============================================================

    function renderNameTab(char) {
        var nameFormat = char.nameFormat || 'firstlast';
        var formatLabels = {
            'firstlast': 'First + Last',
            'lastfirst': 'Last, First',
            'nicklast': 'Nickname + Last',
            'firstnick': 'First "Nickname"',
            'alias': 'Alias'
        };

        var html = '<div class="detail-section">';
        html += '<div class="detail-row"><span class="label">Display Name:</span> <span style="font-weight:600;font-size:1.1rem;color:var(--accent);">' + escapeHtml(window.getDisplayName(char)) + '</span></div>';
        html += '<div class="detail-row"><span class="label">First Name:</span> <span>' + escapeHtml(char.firstName || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Middle Name:</span> <span>' + escapeHtml(char.middleName || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Last Name:</span> <span>' + escapeHtml(char.lastName || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Nickname:</span> <span>' + escapeHtml(char.nickname || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Alias:</span> <span>' + escapeHtml(char.alias || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Previous Names:</span> <span>' + escapeHtml((char.previousNames || []).join(', ') || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Display Format:</span> <span>' + escapeHtml(formatLabels[nameFormat] || 'First + Last') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Age:</span> <span>' + escapeHtml(window.getCharacterAge(char)) + '</span></div>';
        html += '<div class="detail-row"><span class="label">Year of Birth:</span> <span>' + escapeHtml(char.birthYear || '-') + '</span></div>';

        if (char.deceased) {
            html += '<div class="detail-row"><span class="label">Deceased:</span> <span style="color:var(--danger);font-weight:600;">Yes</span></div>';
            html += '<div class="detail-row"><span class="label">Year of Death:</span> <span>' + escapeHtml(char.deathYear || '-') + '</span></div>';
            html += '<div class="detail-row"><span class="label">Death Age:</span> <span>' + escapeHtml(char.deathAge || '-') + '</span></div>';
            html += '<div class="detail-row"><span class="label">Cause of Death:</span> <span>' + escapeHtml(char.deathCause || '-') + '</span></div>';
        }

        html += '</div>';
        return html;
    }

    function renderPhysicalTab(char) {
        var html = '<div class="detail-section">';
        html += '<div class="detail-row"><span class="label">Gender:</span> <span>' + escapeHtml(char.gender || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Eye Color:</span> <span>' + escapeHtml(char.eyes || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Hair Color:</span> <span>' + escapeHtml(char.hair || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Skin Color/Tone:</span> <span>' + escapeHtml(char.skin || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Height:</span> <span>' + escapeHtml(char.height || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Weight:</span> <span>' + escapeHtml(char.weight || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Build:</span> <span>' + escapeHtml(char.build || '-') + '</span></div>';
        html += '<div class="detail-row" style="flex-direction:column;align-items:flex-start;gap:4px;"><span class="label">Appearance Notes:</span><span style="padding:4px 0;">' + escapeHtml(char.appearanceNotes || '-') + '</span></div>';
        html += '</div>';
        return html;
    }

    function renderPersonalityTab(char) {
        var personality = char.personality || {};
        var html = '<div class="detail-section">';
        html += '<div class="detail-row"><span class="label">Traits:</span> <span>' + escapeHtml(personality.traits || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Ideals:</span> <span>' + escapeHtml(personality.ideals || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Bonds:</span> <span>' + escapeHtml(personality.bonds || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Flaws:</span> <span>' + escapeHtml(personality.flaws || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Alignment:</span> <span>' + escapeHtml(personality.alignment || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Likes:</span> <span>' + escapeHtml(personality.likes || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Dislikes:</span> <span>' + escapeHtml(personality.dislikes || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Habits:</span> <span>' + escapeHtml(personality.habits || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Fears:</span> <span>' + escapeHtml(personality.fears || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Goals:</span> <span>' + escapeHtml(personality.goals || '-') + '</span></div>';
        html += '</div>';
        return html;
    }

    function renderCareerTab(char) {
        var data = window.data || {};
        var html = '<div class="detail-section">';
        
        // Career Status History
        html += '<h4 style="color:var(--accent);font-size:0.85rem;margin-bottom:8px;">Career Status History</h4>';

        if (char.careerStatus && char.careerStatus.length > 0) {
            html += '<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:12px;">';
            char.careerStatus.forEach(function(status) {
                var period = status.startYear;
                if (status.endYear) period += ' \u2192 ' + status.endYear;
                else period += ' \u2192 Present';
                var statusName = status.status || 'Unknown';
                var displayName = statusName.charAt(0).toUpperCase() + statusName.slice(1);
                html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--accent);">';
                html += '<span style="font-weight:600;">' + escapeHtml(displayName) + '</span>';
                html += ' <span style="color:var(--text-dim);font-size:0.8rem;">(' + escapeHtml(period) + ')</span>';
                html += '</div>';
            });
            html += '</div>';
        } else {
            html += '<p class="empty-state" style="padding:8px;font-size:0.8rem;">No career history</p>';
        }

        // Professional Teams
        html += '<h4 style="color:var(--info);font-size:0.85rem;margin-bottom:8px;margin-top:12px;">Professional Teams</h4>';
        var profTeams = data.teams ? data.teams.filter(function(t) {
            if (t.type !== 'professional') return false;
            if (t.status === 'deleted') return false;
            return t.members && t.members.some(function(m) { return String(m.characterId) === String(char.id); });
        }) : [];

        if (profTeams.length > 0) {
            profTeams.forEach(function(team) {
                var member = team.members.find(function(m) { return String(m.characterId) === String(char.id); });
                var period = member ? (member.joinPeriod || '?') : '?';
                if (member && member.leavePeriod) period += ' \u2192 ' + member.leavePeriod;
                html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--info);margin-bottom:4px;">';
                html += '<span><strong>' + escapeHtml(team.name) + '</strong> <span style="color:var(--text-dim);font-size:0.8rem;">(' + escapeHtml(period) + ')</span></span>';
                if (member && member.role) html += ' <span style="color:var(--text-dim);font-size:0.7rem;">[' + escapeHtml(member.role) + ']</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No professional teams</p>';
        }

        // Temporary Teams
        html += '<h4 style="color:var(--warning);font-size:0.85rem;margin-bottom:8px;margin-top:12px;">Temporary Teams</h4>';
        var tempTeams = data.teams ? data.teams.filter(function(t) {
            if (t.type !== 'temporary' && t.type !== 'internship') return false;
            if (t.status === 'deleted') return false;
            return t.members && t.members.some(function(m) { return String(m.characterId) === String(char.id); });
        }) : [];

        if (tempTeams.length > 0) {
            tempTeams.forEach(function(team) {
                var member = team.members.find(function(m) { return String(m.characterId) === String(char.id); });
                var period = member ? (member.joinPeriod || '?') : '?';
                if (member && member.leavePeriod) period += ' \u2192 ' + member.leavePeriod;
                html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--warning);margin-bottom:4px;">';
                html += '<span><strong>' + escapeHtml(team.name) + '</strong> <span style="color:var(--text-dim);font-size:0.8rem;">(' + escapeHtml(period) + ')</span></span>';
                if (member && member.role) html += ' <span style="color:var(--text-dim);font-size:0.7rem;">[' + escapeHtml(member.role) + ']</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No temporary teams</p>';
        }

        // Civilian Teams
        html += '<h4 style="color:var(--text-dim);font-size:0.85rem;margin-bottom:8px;margin-top:12px;">Civilian Teams</h4>';
        var civTeams = data.teams ? data.teams.filter(function(t) {
            if (t.type !== 'civilian') return false;
            if (t.status === 'deleted') return false;
            return t.members && t.members.some(function(m) { return String(m.characterId) === String(char.id); });
        }) : [];

        if (civTeams.length > 0) {
            civTeams.forEach(function(team) {
                var member = team.members.find(function(m) { return String(m.characterId) === String(char.id); });
                var period = member ? (member.joinPeriod || '?') : '?';
                if (member && member.leavePeriod) period += ' \u2192 ' + member.leavePeriod;
                html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--text-dim);margin-bottom:4px;">';
                html += '<span><strong>' + escapeHtml(team.name) + '</strong> <span style="color:var(--text-dim);font-size:0.8rem;">(' + escapeHtml(period) + ')</span></span>';
                if (member && member.role) html += ' <span style="color:var(--text-dim);font-size:0.7rem;">[' + escapeHtml(member.role) + ']</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No civilian teams</p>';
        }

        // Missions
        html += '<h4 style="color:var(--warning);font-size:0.85rem;margin-bottom:8px;margin-top:12px;">Missions</h4>';
        var missions = data.missions ? data.missions.filter(function(m) {
            return m.assignedTeamId && data.teams && data.teams.some(function(t) {
                return String(t.id) === String(m.assignedTeamId) &&
                       t.members && t.members.some(function(mem) { return String(mem.characterId) === String(char.id); });
            });
        }) : [];

        if (missions.length > 0) {
            missions.forEach(function(m) {
                var statusColor = m.status === 'completed' ? 'var(--accent)' : 
                                 m.status === 'cancelled' ? 'var(--danger)' : 'var(--warning)';
                html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + statusColor + ';margin-bottom:4px;">';
                html += '<span><strong>' + escapeHtml(m.title) + '</strong> <span style="color:' + statusColor + ';font-size:0.7rem;">' + escapeHtml(m.status || 'active') + '</span></span>';
                if (m.location) html += ' <span style="color:var(--text-dim);font-size:0.7rem;">(' + escapeHtml(m.location) + ')</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No missions assigned</p>';
        }

        html += '</div>';
        return html;
    }

    function renderAcademicTab(char) {
        var data = window.data || {};
        var html = '<div class="detail-section">';

        // Academic Teams
        html += '<h4 style="color:var(--accent);font-size:0.85rem;margin-bottom:8px;">Academic Teams</h4>';
        var acadTeams = data.teams ? data.teams.filter(function(t) {
            if (t.type !== 'academic') return false;
            if (t.status === 'deleted') return false;
            return t.members && t.members.some(function(m) { return String(m.characterId) === String(char.id); });
        }) : [];

        if (acadTeams.length > 0) {
            acadTeams.forEach(function(team) {
                var member = team.members.find(function(m) { return String(m.characterId) === String(char.id); });
                var period = member ? (member.joinPeriod || '?') : '?';
                if (member && member.leavePeriod) period += ' \u2192 ' + member.leavePeriod;
                var classDisplay = team.classId ? ' [' + escapeHtml(window.getClassDisplayName(team.classId)) + ']' : '';
                html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--accent);margin-bottom:4px;">';
                html += '<span><strong>' + escapeHtml(team.name) + '</strong>' + classDisplay + ' <span style="color:var(--text-dim);font-size:0.8rem;">(Wk ' + escapeHtml(period) + ')</span></span>';
                if (member && member.role) html += ' <span style="color:var(--text-dim);font-size:0.7rem;">[' + escapeHtml(member.role) + ']</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No academic teams</p>';
        }

        // Grades
        html += '<h4 style="color:var(--info);font-size:0.85rem;margin-bottom:8px;margin-top:12px;">Grades</h4>';
        var curriculum = data.curriculum || {};
        var grades = curriculum.grades && curriculum.grades[char.id] ? curriculum.grades[char.id] : {};
        var classCount = 0;
        for (var week in grades) {
            for (var discId in grades[week]) {
                classCount++;
            }
        }

        if (classCount > 0) {
            html += '<div style="max-height:120px;overflow-y:auto;font-size:0.75rem;">';
            for (var week in grades) {
                for (var discId in grades[week]) {
                    var disc = window.getDiscipline(discId);
                    var score = grades[week][discId];
                    var discName = disc ? disc.name : 'Unknown';
                    html += '<div style="padding:3px 8px;background:var(--bg);border-radius:3px;margin-bottom:2px;display:flex;justify-content:space-between;">';
                    html += '<span>' + escapeHtml(discName) + ' (Wk ' + escapeHtml(week) + ')</span>';
                    html += '<span style="color:var(--accent);font-weight:600;">' + escapeHtml(score) + '%</span>';
                    html += '</div>';
                }
            }
            html += '</div>';
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No grades recorded</p>';
        }

        // Tournament Eliminations
        html += '<h4 style="color:var(--danger);font-size:0.85rem;margin-bottom:8px;margin-top:12px;">Tournament Eliminations</h4>';
        var tournElims = [];
        if (char.eliminations) {
            tournElims = char.eliminations.filter(function(e) { return !e.standalone; });
        }

        if (tournElims.length > 0) {
            tournElims.forEach(function(elim) {
                var tournName = 'Unknown Tournament';
                if (elim.tournamentId && data.tournaments) {
                    var tourn = data.tournaments.find(function(t) { 
                        return String(t.id) === String(elim.tournamentId); 
                    });
                    if (tourn) tournName = tourn.name;
                }
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--danger);margin-bottom:3px;">';
                html += '<span style="font-size:0.75rem;"><strong>' + escapeHtml(tournName) + '</strong> - Week ' + escapeHtml(elim.week) + (elim.reason ? ' (' + escapeHtml(elim.reason) + ')' : '') + '</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No tournament eliminations</p>';
        }

        // Standalone Eliminations
        html += '<h4 style="color:var(--warning);font-size:0.85rem;margin-bottom:8px;margin-top:12px;">Standalone Eliminations</h4>';
        var standaloneElims = [];
        if (char.eliminations) {
            standaloneElims = char.eliminations.filter(function(e) { return e.standalone; });
        }

        if (standaloneElims.length > 0) {
            standaloneElims.forEach(function(elim) {
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--warning);margin-bottom:3px;">';
                html += '<span style="font-size:0.75rem;">Week ' + escapeHtml(elim.week) + (elim.reason ? ' - ' + escapeHtml(elim.reason) : '') + '</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No standalone eliminations</p>';
        }

        // Schedule Summary
        html += '<h4 style="color:var(--warning);font-size:0.85rem;margin-bottom:8px;margin-top:12px;">Schedule Summary</h4>';
        var scheduleCount = getScheduleCount(char.id);
        if (scheduleCount > 0) {
            html += '<p style="font-size:0.75rem;color:var(--text-dim);">Total classes scheduled: <strong>' + scheduleCount + '</strong></p>';
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No schedule recorded</p>';
        }

        html += '</div>';
        return html;
    }

    function renderStatsTab(char) {
        var stats = window.getCharacterStats(char);
        var suggestedClass = window.suggestClass(stats);
        var magic = window.getCharacterMagic(char);
        var magicClass = window.suggestMagicClass(char);
        var moves = getCharacterSpecialMoves(char);

        var html = '<div class="detail-section">';

        // Physical Stats
        html += '<h4 style="color:var(--accent);font-size:0.85rem;margin-bottom:8px;">Physical Stats</h4>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;">';
        var statLabels = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };
        for (var key in stats) {
            var val = stats[key] || 10;
            var mod = Math.floor((val - 10) / 2);
            html += '<div style="background:var(--bg);padding:6px 10px;border-radius:4px;border:1px solid var(--border-soft);text-align:center;">';
            html += '<div style="font-size:0.6rem;color:var(--text-dim);">' + escapeHtml(statLabels[key]) + '</div>';
            html += '<div style="font-size:1.2rem;font-weight:700;color:var(--accent);">' + escapeHtml(val) + '</div>';
            html += '<div class="stat-modifier" style="font-size:0.65rem;color:' + (mod > 0 ? 'var(--accent)' : mod < 0 ? 'var(--danger)' : 'var(--text-dim)') + ';">' + (mod >= 0 ? '+' : '') + mod + '</div>';
            html += '</div>';
        }
        html += '</div>';

        // Class Suggestion
        html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">';
        html += '<span style="font-size:0.75rem;color:var(--text-dim);">Physical Class:</span>';
        if (suggestedClass) {
            html += '<span style="font-weight:600;color:var(--accent);">' + escapeHtml((suggestedClass.icon || '') + ' ' + suggestedClass.label) + '</span>';
        } else {
            html += '<span style="font-weight:600;color:var(--text-dim);">—</span>';
        }
        html += '</div>';

        // Magic Stats
        html += '<h4 style="color:var(--info);font-size:0.85rem;margin-bottom:8px;margin-top:12px;">Magic Stats</h4>';
        html += '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin-bottom:12px;">';
        var magicTypes = {
            earth: 'Earth', water: 'Water', fire: 'Fire', air: 'Air', metal: 'Metal', wood: 'Wood',
            blood: 'Blood', bone: 'Bone', mind: 'Mind', morphic: 'Morphic', life: 'Life', death: 'Death',
            space: 'Space', time: 'Time', dimension: 'Dimension', void: 'Void', reality: 'Reality', transference: 'Transference'
        };
        for (var key in magicTypes) {
            var val = magic[key] || 0;
            var color = val >= 9 ? 'var(--danger)' : (val >= 7 ? 'var(--warning)' : (val >= 5 ? 'var(--accent)' : (val >= 3 ? 'var(--info)' : 'var(--text-dim)')));
            html += '<div style="background:var(--bg);padding:2px 4px;border-radius:3px;border:1px solid var(--border-soft);text-align:center;">';
            html += '<div style="font-size:0.45rem;color:var(--text-dim);">' + escapeHtml(magicTypes[key]) + '</div>';
            html += '<div style="font-size:0.85rem;font-weight:700;color:' + color + ';">' + escapeHtml(val) + '</div>';
            html += '</div>';
        }
        html += '</div>';

        // Magic Class
        html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">';
        html += '<span style="font-size:0.75rem;color:var(--text-dim);">Magic Class:</span>';
        if (magicClass) {
            html += '<span style="font-weight:600;color:var(--info);">' + escapeHtml(magicClass.name) + '</span>';
        } else {
            html += '<span style="font-weight:600;color:var(--text-dim);">—</span>';
        }
        html += '</div>';

        // Magic Power
        var magicPower = window.calculateMagicPower(char);
        var magicPowerDisplay = window.getMagicPowerDisplay(char);
        html += '<div style="font-size:0.75rem;color:var(--text-dim);">Magic Power: <span style="font-weight:600;color:var(--info);">' + escapeHtml(magicPowerDisplay) + ' (' + escapeHtml(magicPower) + '/180)</span></div>';

        // Special Moves
        html += '<h4 style="color:var(--accent);font-size:0.85rem;margin-bottom:8px;margin-top:12px;">Special Moves</h4>';

        // Physical Moves
        html += '<div style="margin-bottom:8px;">';
        html += '<span style="font-size:0.75rem;color:var(--accent);font-weight:600;">Physical:</span>';
        if (moves.physical && moves.physical.length > 0) {
            html += '<div style="margin-top:4px;">';
            moves.physical.forEach(function(m) {
                html += '<div style="padding:2px 8px;background:var(--bg);border-radius:3px;margin-bottom:2px;border-left:2px solid var(--accent);">';
                html += '<span style="font-weight:600;font-size:0.75rem;">' + escapeHtml(m.name) + '</span>';
                if (m.description) html += ' <span style="color:var(--text-dim);font-size:0.7rem;">- ' + escapeHtml(m.description) + '</span>';
                html += '</div>';
            });
            html += '</div>';
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No physical moves</p>';
        }
        html += '</div>';

        // Magical Moves
        html += '<div>';
        html += '<span style="font-size:0.75rem;color:var(--info);font-weight:600;">Magical:</span>';
        if (moves.magical && moves.magical.length > 0) {
            html += '<div style="margin-top:4px;">';
            moves.magical.forEach(function(m) {
                html += '<div style="padding:2px 8px;background:var(--bg);border-radius:3px;margin-bottom:2px;border-left:2px solid var(--info);">';
                html += '<span style="font-weight:600;font-size:0.75rem;">' + escapeHtml(m.name) + '</span>';
                if (m.description) html += ' <span style="color:var(--text-dim);font-size:0.7rem;">- ' + escapeHtml(m.description) + '</span>';
                html += '</div>';
            });
            html += '</div>';
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No magical moves</p>';
        }
        html += '</div>';

        html += '</div>';
        return html;
    }

    function renderSocialTab(char) {
        var data = window.data || {};
        var html = '<div class="detail-section">';
        html += '<h4 style="color:var(--accent);font-size:0.85rem;margin-bottom:8px;">Social Connections</h4>';

        var rels = [];
        if (data.social && data.social.relationships) {
            rels = data.social.relationships.filter(function(r) {
                return String(r.character1) === String(char.id) || String(r.character2) === String(char.id);
            });
        }

        if (rels.length === 0) {
            html += '<p class="empty-state" style="padding:8px;font-size:0.8rem;">No social connections</p>';
        } else {
            html += '<div style="display:flex;flex-direction:column;gap:4px;">';
            rels.forEach(function(rel) {
                var otherId = String(rel.character1) === String(char.id) ? rel.character2 : rel.character1;
                var other = window.getCharacterById(otherId);
                var otherName = other ? window.getDisplayName(other) : 'Unknown';
                var typeLabel = getRelationshipTypeLabel(rel.typeId);
                var typeColor = getSafeRelationshipColor(rel.typeId);
                var period = '';
                if (rel.startYear && rel.endYear) {
                    period = rel.startYear + ' \u2192 ' + rel.endYear;
                } else if (rel.startYear) {
                    period = 'From ' + rel.startYear;
                }
                var clarification = rel.clarification ? ' (' + rel.clarification + ')' : '';
                var notes = rel.notes ? ' 📝' : '';

                html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + typeColor + ';">';
                html += '<span><strong>' + escapeHtml(otherName) + '</strong> <span style="color:' + typeColor + ';font-size:0.8rem;">' + escapeHtml(typeLabel) + escapeHtml(clarification) + '</span></span>';
                if (period) html += ' <span style="color:var(--text-dim);font-size:0.7rem;">' + escapeHtml(period) + '</span>';
                if (notes) html += ' <span style="color:var(--text-dim);font-size:0.7rem;">' + notes + '</span>';
                html += '</div>';
            });
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    function renderNotesTab(char) {
        var html = '<div class="detail-section">';
        html += '<div style="background:var(--bg);padding:12px;border-radius:6px;border:1px solid var(--border-soft);min-height:100px;">';
        html += '<p style="white-space:pre-wrap;margin:0;">' + escapeHtml(char.notes || 'No notes') + '</p>';
        html += '</div>';
        html += '</div>';
        return html;
    }

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    function getScheduleCount(charId) {
        var data = window.data || {};
        if (!data.curriculum || !data.curriculum.schedules) return 0;
        var schedule = data.curriculum.schedules[charId];
        if (!schedule) return 0;
        
        var count = 0;
        for (var week in schedule) {
            for (var day in schedule[week]) {
                for (var hour in schedule[week][day]) {
                    if (schedule[week][day][hour]) count++;
                }
            }
        }
        return count;
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

    // ============================================================
    // PURE SPECIAL MOVES - NO MUTATION
    // ============================================================

    function getCharacterSpecialMoves(char) {
        if (!char || !char.specialMoves) {
            return {
                physical: [],
                magical: []
            };
        }

        return {
            physical: Array.isArray(char.specialMoves.physical)
                ? char.specialMoves.physical
                : [],
            magical: Array.isArray(char.specialMoves.magical)
                ? char.specialMoves.magical
                : []
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.openCharacterDetail = openCharacterDetail;
    window.closeCharacterDetail = closeCharacterDetail;
    window.switchDetailTab = switchDetailTab;
    window.renderCharacterDetail = renderCharacterDetail;
    window.getCharacterSpecialMoves = getCharacterSpecialMoves;

})();
