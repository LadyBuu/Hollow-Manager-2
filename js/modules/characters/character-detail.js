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
 * 
 * SECURITY CONTRACT:
 *   Every dynamic value entering an HTML string must pass through escapeHtml(),
 *   except values originating exclusively from hard-coded internal constants.
 *   This is a strict invariant enforced throughout this module.
 * 
 * DATA VALIDATION:
 *   All array/object access is validated to prevent runtime errors from
 *   corrupted or malformed persisted data.
 * 
 * DEPENDENCIES:
 *   - window.getCharacterById (from core-utils.js)
 *   - window.getDisplayName (from core-utils.js)
 *   - window.RELATIONSHIP_CONSTANTS (from constants.js)
 *   - window.DomUtils (from dom-utils.js)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterDetailLoaded) {
        return;
    }

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
    // SAFE CSS COLOR VALIDATION - Whitelist based
    // ============================================================

    function getSafeRelationshipColor(typeId) {
        var color = getRelationshipTypeColor(typeId);
        
        if (!color || typeof color !== 'string') {
            return window.RELATIONSHIP_CONSTANTS.DEFAULT_COLOR;
        }

        // Check whitelist
        if (window.isAllowedRelationshipColor && window.isAllowedRelationshipColor(color)) {
            return color;
        }

        return window.RELATIONSHIP_CONSTANTS.DEFAULT_COLOR;
    }

    // ============================================================
    // DATA VALIDATION HELPERS
    // ============================================================

    function getArray(value, fallback) {
        return Array.isArray(value) ? value : (fallback || []);
    }

    function getObject(value, fallback) {
        return value && typeof value === 'object' && !Array.isArray(value)
            ? value
            : (fallback || {});
    }

    function getString(value, fallback) {
        return value !== undefined && value !== null ? String(value) : (fallback || '');
    }

    // ============================================================
    // RELATIONSHIP TYPE HELPERS - Single source of truth
    // ============================================================

    function getRelationshipType(typeId) {
        var data = window.data || {};
        var social = data.social || {};
        var types = Array.isArray(social.relationshipTypes) ? social.relationshipTypes : [];
        return types.find(function(t) {
            return t && String(t.id) === String(typeId);
        }) || null;
    }

    function getRelationshipTypeLabel(typeId) {
        var type = getRelationshipType(typeId);
        return type ? type.label : (typeId || 'Other');
    }

    function getRelationshipTypeColor(typeId) {
        var type = getRelationshipType(typeId);
        return type ? type.color : window.RELATIONSHIP_CONSTANTS.DEFAULT_COLOR;
    }

    // ============================================================
    // TEAM/MISSION QUERY HELPERS - Single source of truth
    // ============================================================

    function getCharacterTeamsByType(charId, types) {
        var data = window.data || {};
        var teams = Array.isArray(data.teams) ? data.teams : [];
        
        if (!Array.isArray(types)) {
            types = [types];
        }

        return teams.filter(function(team) {
            if (!team || typeof team !== 'object') return false;
            if (team.status === 'deleted') return false;
            if (types.indexOf(team.type) === -1) return false;
            if (!Array.isArray(team.members)) return false;
            return team.members.some(function(m) {
                return m && String(m.characterId) === String(charId);
            });
        });
    }

    function getCharacterMissions(charId) {
        var data = window.data || {};
        var teams = Array.isArray(data.teams) ? data.teams : [];
        var missions = Array.isArray(data.missions) ? data.missions : [];

        return missions.filter(function(m) {
            if (!m || typeof m !== 'object') return false;
            if (!m.assignedTeamId) return false;
            return teams.some(function(t) {
                if (!t || typeof t !== 'object') return false;
                if (String(t.id) !== String(m.assignedTeamId)) return false;
                if (!Array.isArray(t.members)) return false;
                return t.members.some(function(mem) {
                    return mem && String(mem.characterId) === String(charId);
                });
            });
        });
    }

    function getScheduleCount(charId) {
        var data = window.data || {};
        var curriculum = data.curriculum || {};
        var schedules = curriculum.schedules || {};
        var charSchedule = schedules[charId] || {};

        var count = 0;
        for (var week in charSchedule) {
            if (!Object.prototype.hasOwnProperty.call(charSchedule, week)) continue;
            var weekData = charSchedule[week];
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

    function getCharacterTournamentEliminations(char) {
        var data = window.data || {};
        var eliminations = Array.isArray(char.eliminations) ? char.eliminations : [];
        var tournaments = Array.isArray(data.tournaments) ? data.tournaments : [];

        return eliminations.filter(function(e) {
            return e && !e.standalone;
        }).map(function(e) {
            var tournName = 'Unknown Tournament';
            if (e.tournamentId) {
                var tourn = tournaments.find(function(t) {
                    return t && String(t.id) === String(e.tournamentId);
                });
                if (tourn) tournName = tourn.name;
            }
            return {
                tournamentName: tournName,
                week: e.week || '?',
                reason: e.reason || ''
            };
        });
    }

    function getCharacterStandaloneEliminations(char) {
        var eliminations = Array.isArray(char.eliminations) ? char.eliminations : [];
        return eliminations.filter(function(e) {
            return e && e.standalone;
        });
    }

    function getCharacterGrades(charId) {
        var data = window.data || {};
        var curriculum = data.curriculum || {};
        var grades = curriculum.grades || {};
        var charGrades = grades[charId] || {};

        var result = [];
        for (var week in charGrades) {
            if (!Object.prototype.hasOwnProperty.call(charGrades, week)) continue;
            var weekData = charGrades[week];
            if (!weekData || typeof weekData !== 'object') continue;
            for (var discId in weekData) {
                if (!Object.prototype.hasOwnProperty.call(weekData, discId)) continue;
                var score = weekData[discId];
                var disc = window.getDiscipline ? window.getDiscipline(discId) : null;
                result.push({
                    week: week,
                    disciplineId: discId,
                    disciplineName: disc ? disc.name : 'Unknown',
                    score: score
                });
            }
        }
        return result;
    }

    // ============================================================
    // PERIOD FORMATTING
    // ============================================================

    function formatPeriod(joinPeriod, leavePeriod, prefix) {
        prefix = prefix || '';
        var join = getString(joinPeriod, '?');
        var leave = getString(leavePeriod, '');

        if (!join && !leave) return prefix + '?';
        if (join && leave) return prefix + join + ' → ' + prefix + leave;
        if (join) return prefix + join + ' → Present';
        return prefix + leave;
    }

    // ============================================================
    // OPEN / CLOSE
    // ============================================================

    function openCharacterDetail(charId) {
        var char = window.getCharacterById ? window.getCharacterById(charId) : null;
        if (!char) {
            alert('Character not found.');
            return;
        }

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

        var char = window.getCharacterById ? window.getCharacterById(state.characterId) : null;
        if (char) {
            renderDetailTab(tab, char);
        }
    }

    // ============================================================
    // RENDER DETAIL
    // ============================================================

    function renderCharacterDetail(char) {
        var name = window.getDisplayName ? window.getDisplayName(char) : 'Unknown';
        var nameEl = document.getElementById('detail-character-name');
        if (nameEl) nameEl.textContent = name;

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

        var displayName = window.getDisplayName ? window.getDisplayName(char) : 'Unknown';
        var age = window.getCharacterAge ? window.getCharacterAge(char) : '-';

        var html = '<div class="detail-section">';
        html += '<div class="detail-row"><span class="label">Display Name:</span> <span style="font-weight:600;font-size:1.1rem;color:var(--accent);">' + escapeHtml(displayName) + '</span></div>';
        html += '<div class="detail-row"><span class="label">First Name:</span> <span>' + escapeHtml(char.firstName || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Middle Name:</span> <span>' + escapeHtml(char.middleName || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Last Name:</span> <span>' + escapeHtml(char.lastName || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Nickname:</span> <span>' + escapeHtml(char.nickname || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Alias:</span> <span>' + escapeHtml(char.alias || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Previous Names:</span> <span>' + escapeHtml((Array.isArray(char.previousNames) ? char.previousNames : []).join(', ') || '-') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Display Format:</span> <span>' + escapeHtml(formatLabels[nameFormat] || 'First + Last') + '</span></div>';
        html += '<div class="detail-row"><span class="label">Age:</span> <span>' + escapeHtml(age) + '</span></div>';
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
        var personality = getObject(char.personality, {});
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
        var careerStatus = Array.isArray(char.careerStatus) ? char.careerStatus : [];

        var html = '<div class="detail-section">';
        
        html += '<h4 style="color:var(--accent);font-size:0.85rem;margin-bottom:8px;">Career Status History</h4>';

        if (careerStatus.length > 0) {
            html += '<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:12px;">';
            careerStatus.forEach(function(status) {
                if (!status || typeof status !== 'object') return;
                var period = status.startYear || '?';
                if (status.endYear) {
                    period += ' → ' + status.endYear;
                } else {
                    period += ' → Present';
                }
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
        var profTeams = getCharacterTeamsByType(char.id, 'professional');
        if (profTeams.length > 0) {
            profTeams.forEach(function(team) {
                var member = Array.isArray(team.members) ? team.members.find(function(m) {
                    return m && String(m.characterId) === String(char.id);
                }) : null;
                var period = formatPeriod(member ? member.joinPeriod : null, member ? member.leavePeriod : null);
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
        var tempTeams = getCharacterTeamsByType(char.id, ['temporary', 'internship']);
        if (tempTeams.length > 0) {
            tempTeams.forEach(function(team) {
                var member = Array.isArray(team.members) ? team.members.find(function(m) {
                    return m && String(m.characterId) === String(char.id);
                }) : null;
                var period = formatPeriod(member ? member.joinPeriod : null, member ? member.leavePeriod : null);
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
        var civTeams = getCharacterTeamsByType(char.id, 'civilian');
        if (civTeams.length > 0) {
            civTeams.forEach(function(team) {
                var member = Array.isArray(team.members) ? team.members.find(function(m) {
                    return m && String(m.characterId) === String(char.id);
                }) : null;
                var period = formatPeriod(member ? member.joinPeriod : null, member ? member.leavePeriod : null);
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
        var missions = getCharacterMissions(char.id);
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
        var acadTeams = getCharacterTeamsByType(char.id, 'academic');
        if (acadTeams.length > 0) {
            acadTeams.forEach(function(team) {
                var member = Array.isArray(team.members) ? team.members.find(function(m) {
                    return m && String(m.characterId) === String(char.id);
                }) : null;
                var period = formatPeriod(member ? member.joinPeriod : null, member ? member.leavePeriod : null, 'Wk ');
                var classDisplay = team.classId ? ' [' + escapeHtml(window.getClassDisplayName ? window.getClassDisplayName(team.classId) : 'Unknown') + ']' : '';
                html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--accent);margin-bottom:4px;">';
                html += '<span><strong>' + escapeHtml(team.name) + '</strong>' + classDisplay + ' <span style="color:var(--text-dim);font-size:0.8rem;">(' + escapeHtml(period) + ')</span></span>';
                if (member && member.role) html += ' <span style="color:var(--text-dim);font-size:0.7rem;">[' + escapeHtml(member.role) + ']</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No academic teams</p>';
        }

        // Grades
        html += '<h4 style="color:var(--info);font-size:0.85rem;margin-bottom:8px;margin-top:12px;">Grades</h4>';
        var grades = getCharacterGrades(char.id);
        if (grades.length > 0) {
            html += '<div style="max-height:120px;overflow-y:auto;font-size:0.75rem;">';
            grades.forEach(function(g) {
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:3px;margin-bottom:2px;display:flex;justify-content:space-between;">';
                html += '<span>' + escapeHtml(g.disciplineName) + ' (Wk ' + escapeHtml(g.week) + ')</span>';
                html += '<span style="color:var(--accent);font-weight:600;">' + escapeHtml(g.score) + '%</span>';
                html += '</div>';
            });
            html += '</div>';
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No grades recorded</p>';
        }

        // Tournament Eliminations
        html += '<h4 style="color:var(--danger);font-size:0.85rem;margin-bottom:8px;margin-top:12px;">Tournament Eliminations</h4>';
        var tournElims = getCharacterTournamentEliminations(char);
        if (tournElims.length > 0) {
            tournElims.forEach(function(elim) {
                html += '<div style="padding:3px 8px;background:var(--bg);border-radius:4px;border-left:3px solid var(--danger);margin-bottom:3px;">';
                html += '<span style="font-size:0.75rem;"><strong>' + escapeHtml(elim.tournamentName) + '</strong> - Week ' + escapeHtml(elim.week) + (elim.reason ? ' (' + escapeHtml(elim.reason) + ')' : '') + '</span>';
                html += '</div>';
            });
        } else {
            html += '<p class="empty-state" style="padding:4px;font-size:0.75rem;">No tournament eliminations</p>';
        }

        // Standalone Eliminations
        html += '<h4 style="color:var(--warning);font-size:0.85rem;margin-bottom:8px;margin-top:12px;">Standalone Eliminations</h4>';
        var standaloneElims = getCharacterStandaloneEliminations(char);
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
        var stats = window.getCharacterStats ? window.getCharacterStats(char) : { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
        var suggestedClass = window.suggestClass ? window.suggestClass(stats) : null;
        var magic = window.getCharacterMagic ? window.getCharacterMagic(char) : {};
        var magicClass = window.suggestMagicClass ? window.suggestMagicClass(char) : null;
        var moves = window.getCharacterSpecialMoves ? window.getCharacterSpecialMoves(char) : { physical: [], magical: [] };
        var magicPower = window.calculateMagicPower ? window.calculateMagicPower(char) : 0;
        var magicPowerDisplay = window.getMagicPowerDisplay ? window.getMagicPowerDisplay(char) : '';

        var html = '<div class="detail-section">';

        // Physical Stats
        html += '<h4 style="color:var(--accent);font-size:0.85rem;margin-bottom:8px;">Physical Stats</h4>';
        html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;">';
        var statLabels = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };
        for (var key in statLabels) {
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
        html += '<div style="font-size:0.75rem;color:var(--text-dim);">Magic Power: <span style="font-weight:600;color:var(--info);">' + escapeHtml(magicPowerDisplay || magicPower + '/180') + '</span></div>';

        // Special Moves
        html += '<h4 style="color:var(--accent);font-size:0.85rem;margin-bottom:8px;margin-top:12px;">Special Moves</h4>';

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
        var social = data.social || {};
        var relationships = Array.isArray(social.relationships) ? social.relationships : [];
        var rels = relationships.filter(function(r) {
            return r && (String(r.character1) === String(char.id) || String(r.character2) === String(char.id));
        });

        var html = '<div class="detail-section">';
        html += '<h4 style="color:var(--accent);font-size:0.85rem;margin-bottom:8px;">Social Connections</h4>';

        if (rels.length === 0) {
            html += '<p class="empty-state" style="padding:8px;font-size:0.8rem;">No social connections</p>';
        } else {
            html += '<div style="display:flex;flex-direction:column;gap:4px;">';
            rels.forEach(function(rel) {
                var otherId = String(rel.character1) === String(char.id) ? rel.character2 : rel.character1;
                var other = window.getCharacterById ? window.getCharacterById(otherId) : null;
                var otherName = other ? (window.getDisplayName ? window.getDisplayName(other) : 'Unknown') : 'Unknown';
                var type = getRelationshipType(rel.typeId);
                var typeLabel = type ? type.label : (rel.typeId || 'Other');
                var typeColor = getSafeRelationshipColor(rel.typeId);
                var period = '';
                if (rel.startYear && rel.endYear) {
                    period = rel.startYear + ' → ' + rel.endYear;
                } else if (rel.startYear) {
                    period = 'From ' + rel.startYear;
                }
                var clarification = rel.clarification ? ' (' + escapeHtml(rel.clarification) + ')' : '';
                var notes = rel.notes ? ' 📝' : '';

                html += '<div style="padding:4px 8px;background:var(--bg);border-radius:4px;border-left:3px solid ' + typeColor + ';">';
                html += '<span><strong>' + escapeHtml(otherName) + '</strong> <span style="color:' + typeColor + ';font-size:0.8rem;">' + escapeHtml(typeLabel) + clarification + '</span></span>';
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
    // SPECIAL MOVES - PURE
    // ============================================================

    function getCharacterSpecialMoves(char) {
        if (!char || !char.specialMoves || typeof char.specialMoves !== 'object') {
            return { physical: [], magical: [] };
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
    // EXPOSE - Namespaced API
    // ============================================================

    window.CharacterDetail = {
        open: openCharacterDetail,
        close: closeCharacterDetail,
        switchTab: switchDetailTab,
        render: renderCharacterDetail,
        getSpecialMoves: getCharacterSpecialMoves
    };

    // Legacy compatibility
    window.openCharacterDetail = openCharacterDetail;
    window.closeCharacterDetail = closeCharacterDetail;
    window.switchDetailTab = switchDetailTab;
    window.renderCharacterDetail = renderCharacterDetail;
    window.getCharacterSpecialMoves = getCharacterSpecialMoves;

    // Mark as loaded
    window.__characterDetailLoaded = true;

})();
