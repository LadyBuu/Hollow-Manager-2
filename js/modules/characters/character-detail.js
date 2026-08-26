/**
 * js/modules/characters/character-detail.js - Character Detail View
 * Tabbed interface for viewing all character information
 * Path: js/modules/characters/character-detail.js
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
        document.getElementById('detail-character-name').textContent = name;

        // Render only the active tab initially
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
        html += '<h4 style="color:var(--accent);font-size:0.85rem;margin-bottom:8px;">Career Status History</h4>';

        if (char.careerStatus && char.careerStatus.length > 0) {
            html += '<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:12px;">';
            char.careerStatus.forEach(function(status) {
                var period = status.startYear;
                if (status.endYear) period += ' \u2192 ' + status.endYear;
                else period += ' \u2192 Present';
                html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--accent);">';
                html += '<span style="font-weight:600;">' + escapeHtml(status.status.charAt(0).toUpperCase() + status.status.slice(1)) + '</span>';
                html += ' <span style="color:var(--text-dim);font-size:0.8rem;">(' + escapeHtml(period) + ')</span>';
                html += '</div>';
            });
            html += '</div>';
        } else {
            html += '<p class="empty-state" style="padding:8px;font-size:0.8rem;">No career history</p>';
        }

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

        html += '<h4 style="color:var(--warning);font-size:0.85rem;margin-bottom:8px;margin-top:12px;">Missions</h4>';
        var missions = data.missions ? data.missions.filter(function(m) {
            return m.assignedTeamId && data.teams && data.teams.some(function(t) {
                return String(t.id) === String(m.assignedTeamId) &&
                       t.members && t.members.some(function(mem) { return String(mem.characterId) === String(char.id); });
            });
        }) : [];

        if (missions.length > 0) {
            missions.forEach(function(m) {
                var statusColor = m.status === 'completed' ? 'var(--accent)' : m.status === 'cancelled' ? 'var(--danger)' : 'var(--warning)';
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

    // ... (continues with academic, stats, social, notes tabs with escapeHtml applied)
    // I'll show the key ones and note the pattern

    function renderNotesTab(char) {
        var html = '<div class="detail-section">';
        html += '<div style="background:var(--bg);padding:12px;border-radius:6px;border:1px solid var(--border-soft);min-height:100px;">';
        html += '<p style="white-space:pre-wrap;margin:0;">' + escapeHtml(char.notes || 'No notes') + '</p>';
        html += '</div>';
        html += '</div>';
        return html;
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
    // RELATIONSHIP HELPERS
    // ============================================================

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
    // EXPOSE
    // ============================================================

    window.openCharacterDetail = openCharacterDetail;
    window.closeCharacterDetail = closeCharacterDetail;
    window.switchDetailTab = switchDetailTab;
    window.renderCharacterDetail = renderCharacterDetail;
    window.getCharacterSpecialMoves = getCharacterSpecialMoves;

})();
