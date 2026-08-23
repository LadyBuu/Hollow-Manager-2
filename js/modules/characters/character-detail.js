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

    function openCharacterDetail(charId) {
        var char = window.getCharacterById(charId);
        if (!char) {
            alert('Character not found.');
            return;
        }

        state.characterId = charId;

        var modal = document.getElementById('character-detail-modal');
        if (!modal) {
            createCharacterDetailModal();
            modal = document.getElementById('character-detail-modal');
        }

        renderCharacterDetail(char);
        modal.classList.remove('hidden');
    }

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

    function switchDetailTab(tab) {
        var modal = document.getElementById('character-detail-modal');
        if (!modal) return;

        modal.querySelectorAll('.detail-tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        modal.querySelectorAll('.detail-tab-panel').forEach(function(panel) {
            var panelId = panel.id.replace('detail-', '');
            panel.style.display = panelId === tab ? 'block' : 'none';
            panel.classList.toggle('active', panelId === tab);
        });

        state.activeTab = tab;

        var char = window.getCharacterById(state.characterId);
        if (char) {
            renderDetailTab(tab, char);
        }
    }

    function renderCharacterDetail(char) {
        var name = window.getDisplayName(char);
        document.getElementById('detail-character-name').textContent = name;

        renderDetailTab('name', char);
        renderDetailTab('physical', char);
        renderDetailTab('personality', char);
        renderDetailTab('career', char);
        renderDetailTab('academic', char);
        renderDetailTab('stats', char);
        renderDetailTab('social', char);
        renderDetailTab('notes', char);
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
        html += '<div class="detail-row"><span class="label">Display Name:</span> <span style="font-weight:600;font-size:1.1rem;color:var(--accent);">' + window.getDisplayName(char) + '</span></div>';
        html += '<div class="detail-row"><span class="label">First Name:</span> <span>' + (char.firstName || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Middle Name:</span> <span>' + (char.middleName || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Last Name:</span> <span>' + (char.lastName || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Nickname:</span> <span>' + (char.nickname || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Alias:</span> <span>' + (char.alias || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Previous Names:</span> <span>' + ((char.previousNames || []).join(', ') || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Display Format:</span> <span>' + (formatLabels[nameFormat] || 'First + Last') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Age:</span> <span>' + window.getCharacterAge(char) + '</span></div>';
        html += '<div class="detail-row"><span class="label">Year of Birth:</span> <span>' + (char.birthYear || '-') + '</span></div>';

        if (char.deceased) {
            html += '<div class="detail-row"><span class="label">Deceased:</span> <span style="color:var(--danger);font-weight:600;">Yes</span></div>';
            html += '<div class="detail-row"><span class="label">Year of Death:</span> <span>' + (char.deathYear || '-') + '</span></div>';
            html += '<div class="detail-row"><span class="label">Death Age:</span> <span>' + (char.deathAge || '-') + '</span></div>';
            html += '<div class="detail-row"><span class="label">Cause of Death:</span> <span>' + (char.deathCause || '-') + '</span></div>';
        }

        html += '</div>';
        return html;
    }

    function renderPhysicalTab(char) {
        var html = '<div class="detail-section">';
        html += '<div class="detail-row"><span class="label">Gender:</span> <span>' + (char.gender || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Eye Color:</span> <span>' + (char.eyes || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Hair Color:</span> <span>' + (char.hair || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Skin Color/Tone:</span> <span>' + (char.skin || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Height:</span> <span>' + (char.height || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Weight:</span> <span>' + (char.weight || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Build:</span> <span>' + (char.build || '-') + '</span></div>';
        html += '<div class="detail-row" style="flex-direction:column;align-items:flex-start;gap:4px;"><span class="label">Appearance Notes:</span><span style="padding:4px 0;">' + (char.appearanceNotes || '-') + '</span></div>';
        html += '</div>';
        return html;
    }

    function renderPersonalityTab(char) {
        var personality = char.personality || {};
        var html = '<div class="detail-section">';
        html += '<div class="detail-row"><span class="label">Traits:</span> <span>' + (personality.traits || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Ideals:</span> <span>' + (personality.ideals || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Bonds:</span> <span>' + (personality.bonds || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Flaws:</span> <span>' + (personality.flaws || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Alignment:</span> <span>' + (personality.alignment || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Likes:</span> <span>' + (personality.likes || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Dislikes:</span> <span>' + (personality.dislikes || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Habits:</span> <span>' + (personality.habits || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Fears:</span> <span>' + (personality.fears || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Goals:</span> <span>' + (personality.goals || '-') + '</span></div>';
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
                html += '<span style="font-weight:600;">' + status.status.charAt(0).toUpperCase() + status.status.slice(1) + '</span>';
                html += ' <span style="color:var(--text-dim);font-size:0.8rem;">(' + period + ')</span>';
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
                html += '<span><strong>' + team.name + '</strong> <span style="color:var(--text-dim);font-size:0.8rem;">(' + period + ')</span></span>';
                if (member && member.role) html += ' <span style="color:var(--text-dim);font-size:0.7rem;">[' + member.role + ']</span>';
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
                html += '<span><strong>' + m.title + '</strong> <span style="color:' + statusColor + ';font-size:0.7rem;">' + (m.status || 'active') + '</span></span>';
                if (m.location) html += ' <span style="color:var(--text-dim);font-size:0.7rem;">(' + m.location + ')</span>';
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
                html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--accent);margin-bottom:4px;">';
                html += '<span><strong>' + team.name + '</strong> <span style="color:var(--text-dim);font-size:0.8rem;">(Wk ' + period + ')</span></span>';
                if (member && member.role) html += ' <span style="color:var(--text-dim);font-size:0.7rem;">[' + member.role + ']</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No academic teams</p>';
        }

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
                html += '<span><strong>' + team.name + '</strong> <span style="color:var(--text-dim);font-size:0.8rem;">(' + period + ')</span></span>';
                if (member && member.role) html += ' <span style="color:var(--text-dim);font-size:0.7rem;">[' + member.role + ']</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No temporary teams</p>';
        }

        html += '<h4 style="color:var(--info);font-size:0.85rem;margin-bottom:8px;margin-top:12px;">Classes & Grades</h4>';
        var curriculum = data.curriculum || {};
        var grades = curriculum.grades && curriculum.grades[char.id] ? curriculum.grades[char.id] : {};
        var classCount = 0;
        for (var week in grades) {
            for (var discId in grades[week]) {
                classCount++;
            }
        }

        if (classCount > 0) {
            html += '<p style="font-size:0.8rem;color:var(--text-dim);">Total classes taken: <strong>' + classCount + '</strong></p>';
            html += '<div style="max-height:150px;overflow-y:auto;font-size:0.75rem;">';
            for (var week in grades) {
                for (var discId in grades[week]) {
                    var disc = window.getDiscipline(discId);
                    var score = grades[week][discId];
                    html += '<div style="padding:2px 8px;background:var(--bg);border-radius:3px;margin-bottom:2px;display:flex;justify-content:space-between;">';
                    html += '<span>' + (disc ? disc.name : 'Unknown') + ' (Wk ' + week + ')</span>';
                    html += '<span style="color:var(--accent);font-weight:600;">' + score + '%</span>';
                    html += '</div>';
                }
            }
            html += '</div>';
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No grades recorded</p>';
        }

        html += '<h4 style="color:var(--danger);font-size:0.85rem;margin-bottom:8px;margin-top:12px;">Eliminations</h4>';
        if (char.eliminations && char.eliminations.length > 0) {
            char.eliminations.forEach(function(elim) {
                var tournName = 'Standalone';
                if (elim.tournamentId && data.tournaments) {
                    var tourn = data.tournaments.find(function(t) { return String(t.id) === String(elim.tournamentId); });
                    if (tourn) tournName = tourn.name;
                }
                var type = elim.standalone ? 'Standalone' : 'Tournament';
                html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--danger);margin-bottom:4px;">';
                html += '<span><strong>' + tournName + '</strong> <span style="color:var(--text-dim);font-size:0.7rem;">[' + type + ']</span></span>';
                html += ' <span style="color:var(--text-dim);font-size:0.7rem;">Week ' + elim.week + '</span>';
                if (elim.reason) html += ' <span style="font-size:0.7rem;">- ' + elim.reason + '</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No eliminations</p>';
        }

        html += '</div>';
        return html;
    }

    function renderStatsTab(char) {
        var stats = window.getCharacterStats(char);
        var suggestedClass = window.suggestClass(stats);
        var magic = window.getCharacterMagic(char);
        var magicClass = window.suggestMagicClass(char);
        var moves = getSpecialMoves(char);

        var html = '<div class="detail-section">';

        html += '<h4 style="color:var(--accent);font-size:0.85rem;margin-bottom:8px;">Physical Stats</h4>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;">';
        var statLabels = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };
        for (var key in stats) {
            var val = stats[key] || 10;
            var mod = Math.floor((val - 10) / 2);
            var modClass = mod > 0 ? 'positive' : (mod < 0 ? 'negative' : 'zero');
            html += '<div style="background:var(--bg);padding:6px 10px;border-radius:4px;border:1px solid var(--border-soft);text-align:center;">';
            html += '<div style="font-size:0.6rem;color:var(--text-dim);">' + statLabels[key] + '</div>';
            html += '<div style="font-size:1.2rem;font-weight:700;color:var(--accent);">' + val + '</div>';
            html += '<div class="stat-modifier ' + modClass + '">' + (mod >= 0 ? '+' : '') + mod + '</div>';
            html += '</div>';
        }
        html += '</div>';

        html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">';
        html += '<span style="font-size:0.75rem;color:var(--text-dim);">Physical Class:</span>';
        html += '<span style="font-weight:600;color:var(--accent);">' + (suggestedClass ? suggestedClass.icon + ' ' + suggestedClass.label : '—') + '</span>';
        html += '</div>';

        html += '<h4 style="color:var(--info);font-size:0.85rem;margin-bottom:8px;margin-top:12px;">Magic Stats</h4>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr 1fr;gap:4px;margin-bottom:12px;">';
        var magicTypes = {
            earth: 'Earth', water: 'Water', fire: 'Fire', air: 'Air', metal: 'Metal', wood: 'Wood',
            blood: 'Blood', bone: 'Bone', mind: 'Mind', morphic: 'Morphic', life: 'Life', death: 'Death',
            space: 'Space', time: 'Time', dimension: 'Dimension', void: 'Void', reality: 'Reality', transference: 'Transference'
        };
        for (var key in magicTypes) {
            var val = magic[key] || 0;
            var color = val >= 9 ? 'var(--danger)' : (val >= 7 ? 'var(--warning)' : (val >= 5 ? 'var(--accent)' : (val >= 3 ? 'var(--info)' : 'var(--text-dim)')));
            html += '<div style="background:var(--bg);padding:2px 4px;border-radius:3px;border:1px solid var(--border-soft);text-align:center;">';
            html += '<div style="font-size:0.45rem;color:var(--text-dim);">' + magicTypes[key] + '</div>';
            html += '<div style="font-size:0.85rem;font-weight:700;color:' + color + ';">' + val + '</div>';
            html += '</div>';
        }
        html += '</div>';

        var magicPower = window.calculateMagicPower(char);
        var magicPowerDisplay = window.getMagicPowerDisplay(char);
        html += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">';
        html += '<span style="font-size:0.75rem;color:var(--text-dim);">Magic Class:</span>';
        html += '<span style="font-weight:600;color:var(--info);">' + (magicClass ? magicClass.name : '—') + '</span>';
        html += '</div>';
        html += '<div style="font-size:0.75rem;color:var(--text-dim);">Magic Power: <span style="font-weight:600;color:var(--info);">' + magicPowerDisplay + ' (' + magicPower + '/180)</span></div>';

        html += '<h4 style="color:var(--accent);font-size:0.85rem;margin-bottom:8px;margin-top:12px;">Special Moves</h4>';

        html += '<div style="margin-bottom:8px;">';
        html += '<span style="font-size:0.75rem;color:var(--accent);font-weight:600;">Physical:</span>';
        if (moves.physical && moves.physical.length > 0) {
            html += '<div style="margin-top:4px;">';
            moves.physical.forEach(function(m) {
                html += '<div style="padding:2px 8px;background:var(--bg);border-radius:3px;margin-bottom:2px;border-left:2px solid var(--accent);">';
                html += '<span style="font-weight:600;font-size:0.75rem;">' + m.name + '</span>';
                if (m.description) html += ' <span style="color:var(--text-dim);font-size:0.7rem;">- ' + m.description + '</span>';
                html += '</div>';
            });
            html += '</div>';
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No physical moves</p>';
        }
        html += '</div>';

        html += '<div>';
        html += '<span style="font-size:0.75rem;color:var(--info);font-weight:600;">Magical:</span>';
        if (moves.magical && moves.magical.length > 0) {
            html += '<div style="margin-top:4px;">';
            moves.magical.forEach(function(m) {
                html += '<div style="padding:2px 8px;background:var(--bg);border-radius:3px;margin-bottom:2px;border-left:2px solid var(--info);">';
                html += '<span style="font-weight:600;font-size:0.75rem;">' + m.name + '</span>';
                if (m.description) html += ' <span style="color:var(--text-dim);font-size:0.7rem;">- ' + m.description + '</span>';
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
                var typeColor = getRelationshipTypeColor(rel.typeId);
                var period = '';
                if (rel.startYear && rel.endYear) {
                    period = rel.startYear + ' \u2192 ' + rel.endYear;
                } else if (rel.startYear) {
                    period = 'From ' + rel.startYear;
                }
                var clarification = rel.clarification ? ' (' + rel.clarification + ')' : '';

                html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + typeColor + ';">';
                html += '<span><strong>' + otherName + '</strong> <span style="color:' + typeColor + ';font-size:0.8rem;">' + typeLabel + clarification + '</span></span>';
                if (period) html += ' <span style="color:var(--text-dim);font-size:0.7rem;">' + period + '</span>';
                if (rel.notes) html += ' <span style="color:var(--text-dim);font-size:0.7rem;">📝</span>';
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
        html += '<p style="white-space:pre-wrap;margin:0;">' + (char.notes || 'No notes') + '</p>';
        html += '</div>';
        html += '</div>';
        return html;
    }

    function closeCharacterDetail() {
        var modal = document.getElementById('character-detail-modal');
        if (modal) modal.classList.add('hidden');
        state.characterId = null;
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

    function getSpecialMoves(char) {
        if (!char) return { physical: [], magical: [] };
        if (!char.specialMoves) {
            char.specialMoves = { physical: [], magical: [] };
        }
        if (!char.specialMoves.physical) char.specialMoves.physical = [];
        if (!char.specialMoves.magical) char.specialMoves.magical = [];
        return char.specialMoves;
    }

    // Expose functions globally
    window.openCharacterDetail = openCharacterDetail;
    window.closeCharacterDetail = closeCharacterDetail;
    window.switchDetailTab = switchDetailTab;
    window.renderCharacterDetail = renderCharacterDetail;
    window.getSpecialMoves = getSpecialMoves;

})();