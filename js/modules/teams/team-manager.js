/**
 * js/modules/teams/team-manager.js - Team Manager
 * Handles team UI rendering and user interaction
 * Path: js/modules/teams/team-manager.js
 * 
 * This module is responsible for:
 *   - Rendering the team manager UI
 *   - Displaying team lists with filtering
 *   - Team CRUD operations (delegates to TeamCore)
 *   - Member management (delegates to TeamCore)
 *   - Ranking management (delegates to TeamCore)
 *   - Modal management for members and rankings
 * 
 * IMPORTANT: This module does NOT mutate window.data directly.
 * All domain data mutations are delegated to TeamCore.
 * UI state (teamState, form state, DOM state) is managed here.
 * All user-controlled data is escaped to prevent XSS.
 * 
 * RENDERING PHILOSOPHY:
 *   - UI refresh happens IMMEDIATELY after mutation, before persistence
 *   - This ensures the UI reflects the authoritative in-memory state
 *   - Persistence success/failure is reported separately
 * 
 * PERSISTENCE NOTE:
 *   - Mutations are applied to window.data via TeamCore immediately
 *   - saveData() is then called to persist
 *   - If saveData() fails, the in-memory mutation has already occurred
 *   - This is intentional: memory is authoritative, persistence is best-effort
 *   - Users are notified of persistence failures but the UI already shows the change
 *   - Modals close immediately after successful mutation, before persistence completes
 * 
 * DEPENDENCIES:
 *   Required:
 *     - window.TeamCore
 *     - window.TeamFilters
 *   Optional:
 *     - window.TeamRankings (for ranking display)
 *     - window.TeamMembers (for member status)
 *     - window.getClasses
 *     - window.getDisplayName
 *     - window.getCharacterById
 *     - window.getCurrentStatus
 *     - window.updateDashboardStats
 *     - window.saveData
 *     - window.showToast
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__teamManagerLoaded) {
        return;
    }
    window.__teamManagerLoaded = true;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    if (!window.TeamCore) {
        console.error('TeamManager: TeamCore is required but not loaded.');
        return;
    }

    if (!window.TeamFilters) {
        console.error('TeamManager: TeamFilters is required but not loaded.');
        return;
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
    // STATE
    // ============================================================

    var teamState = {
        currentTab: 'academic',
        expandedTeamId: null,
        filters: {
            academic: { filterWeek: 1, filterStatus: 'active', filterClass: 'all' },
            professional: { filterYear: '', filterStatus: 'active' },
            temporary: { filterYear: '', filterStatus: 'active' },
            civilian: { filterStatus: 'active' }
        }
    };

    // ============================================================
    // NOTIFICATION
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';

        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }

        if (typeof window.setSession === 'function') {
            window.setSession('toast', {
                message: message,
                type: type,
                timestamp: Date.now()
            });
            if (typeof window.renderToast === 'function') {
                window.renderToast();
            }
            return;
        }

        // Only use alert for errors and confirmations
        if (type === 'error' || type === 'confirm') {
            alert(message);
        }
    }

    // ============================================================
    // PERSISTENCE HELPER - Centralises save boilerplate
    // ============================================================

    function persistMutation(options) {
        options = options || {};
        var successMessage = options.successMessage || 'Operation completed successfully.';
        var errorMessage = options.errorMessage || 'Failed to save changes to persistent storage. Your in-memory changes have been applied but may be lost if you refresh.';
        var onSuccess = options.onSuccess || null;
        var onError = options.onError || null;

        if (typeof window.saveData !== 'function') {
            console.error('Persistence unavailable.');
            if (onError) onError();
            showNotification('Changes were applied in memory, but persistent storage is unavailable.', 'error');
            return;
        }

        window.saveData()
            .then(function() {
                if (onSuccess) onSuccess();
                if (successMessage) showNotification(successMessage, 'success');
            })
            .catch(function(err) {
                console.error('Persistence error:', err);
                if (onError) onError();
                showNotification(errorMessage, 'error');
            });
    }

    // ============================================================
    // SAFE HELPERS
    // ============================================================

    function refreshTeamList() {
        var container = document.getElementById('tab-teams');
        if (container) {
            renderTeamListOnly(container);
        }
    }

    function refreshTeamStats() {
        var container = document.getElementById('tab-teams');
        if (!container) return;

        var allTeams = Array.isArray(window.data.teams)
            ? window.data.teams
            : [];

        var visibleTeams = allTeams.filter(function(t) {
            return t && t.status !== 'deleted';
        });

        var allAcad = visibleTeams.filter(function(t) {
            return t.type === 'academic';
        }).length;
        var allProf = visibleTeams.filter(function(t) {
            return t.type === 'professional' || t.type === 'internship';
        }).length;
        var allTemp = visibleTeams.filter(function(t) {
            return t.type === 'temporary';
        }).length;
        var allCiv = visibleTeams.filter(function(t) {
            return t.type === 'civilian';
        }).length;

        // Update tab button labels
        var tabButtons = container.querySelectorAll('.tab-btn');
        tabButtons.forEach(function(btn) {
            var tab = btn.dataset.tab;
            var count = 0;
            if (tab === 'all') {
                count = visibleTeams.length;
            } else if (tab === 'academic') {
                count = allAcad;
            } else if (tab === 'professional') {
                count = allProf;
            } else if (tab === 'temporary') {
                count = allTemp;
            } else if (tab === 'civilian') {
                count = allCiv;
            }
            // Update the label text - preserve the icon/name part
            var label = btn.textContent.replace(/\(\d+\)$/, '').trim();
            btn.textContent = label + ' (' + count + ')';
        });

        // Update stat cards
        var statCards = container.querySelectorAll('.stat-card .stat-number');
        // There are 4 stat cards in order: Academic, Professional, Temporary, Civilian
        var counts = [allAcad, allProf, allTemp, allCiv];
        statCards.forEach(function(el, index) {
            if (index < counts.length) {
                el.textContent = counts[index];
            }
        });
    }

    function safeUpdateDashboardStats() {
        if (typeof window.updateDashboardStats === 'function') {
            window.updateDashboardStats();
        }
    }

    function getTeam(teamId) {
        return window.TeamCore.getTeam(teamId);
    }

    function getCurrentPeriodForType(teamType) {
        if (teamType === 'academic') {
            return teamState.filters.academic.filterWeek || 1;
        }
        var data = window.data || {};
        return data.currentYear || new Date().getFullYear();
    }

    // ============================================================
    // RENDER TEAM MANAGER - Full rebuild (initial render)
    // ============================================================

    function renderTeamManager(container) {
        if (!container) {
            container = document.getElementById('tab-teams');
        }
        if (!container) return;

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading data...</p>';
            return;
        }

        renderFullManager(container);
        initTeamManagerEvents(container);
    }

    // ============================================================
    // RENDER FULL MANAGER - Initial render only
    // ============================================================

    function renderFullManager(container) {
        // Read-only access to data - no mutation
        var allTeams = Array.isArray(window.data.teams)
            ? window.data.teams
            : [];

        // Exclude deleted teams from counts (they are hidden from UI)
        var visibleTeams = allTeams.filter(function(t) {
            return t && t.status !== 'deleted';
        });

        // Count visible teams by type
        var allAcad = visibleTeams.filter(function(t) {
            return t.type === 'academic';
        }).length;
        var allProf = visibleTeams.filter(function(t) {
            return t.type === 'professional' || t.type === 'internship';
        }).length;
        var allTemp = visibleTeams.filter(function(t) {
            return t.type === 'temporary';
        }).length;
        var allCiv = visibleTeams.filter(function(t) {
            return t.type === 'civilian';
        }).length;

        var html = '';

        // Header
        html += '<div class="page-header">';
        html += '<h2>Team Manager</h2>';
        html += '<button id="add-team-btn" class="primary">+ Add Team</button>';
        html += '</div>';

        // Stats
        html += '<div class="stats-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;">';
        html += '<div class="stat-card" style="background:var(--panel);padding:10px;border-radius:var(--radius);border:1px solid var(--border);text-align:center;"><h3 style="font-size:0.65rem;color:var(--text-dim);text-transform:uppercase;margin:0;">Academic</h3><p class="stat-number" style="font-size:1.3rem;font-weight:700;color:var(--accent);margin:2px 0;">' + allAcad + '</p></div>';
        html += '<div class="stat-card" style="background:var(--panel);padding:10px;border-radius:var(--radius);border:1px solid var(--border);text-align:center;"><h3 style="font-size:0.65rem;color:var(--text-dim);text-transform:uppercase;margin:0;">Professional</h3><p class="stat-number" style="font-size:1.3rem;font-weight:700;color:var(--info);margin:2px 0;">' + allProf + '</p></div>';
        html += '<div class="stat-card" style="background:var(--panel);padding:10px;border-radius:var(--radius);border:1px solid var(--border);text-align:center;"><h3 style="font-size:0.65rem;color:var(--text-dim);text-transform:uppercase;margin:0;">Temporary</h3><p class="stat-number" style="font-size:1.3rem;font-weight:700;color:var(--warning);margin:2px 0;">' + allTemp + '</p></div>';
        html += '<div class="stat-card" style="background:var(--panel);padding:10px;border-radius:var(--radius);border:1px solid var(--border);text-align:center;"><h3 style="font-size:0.65rem;color:var(--text-dim);text-transform:uppercase;margin:0;">Civilian</h3><p class="stat-number" style="font-size:1.3rem;font-weight:700;color:var(--text-dim);margin:2px 0;">' + allCiv + '</p></div>';
        html += '</div>';

        // Tab buttons
        html += '<div class="tab-nav" style="display:flex;gap:4px;border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:12px;flex-wrap:wrap;">';
        html += '<button class="tab-btn ' + (teamState.currentTab === 'all' ? 'active' : '') + '" data-tab="all" style="background:transparent;border:none;border-bottom:2px solid ' + (teamState.currentTab === 'all' ? 'var(--accent)' : 'transparent') + ';color:' + (teamState.currentTab === 'all' ? 'var(--accent)' : 'var(--text-dim)') + ';padding:6px 12px;cursor:pointer;font-size:0.75rem;">All Teams (' + visibleTeams.length + ')</button>';
        html += '<button class="tab-btn ' + (teamState.currentTab === 'academic' ? 'active' : '') + '" data-tab="academic" style="background:transparent;border:none;border-bottom:2px solid ' + (teamState.currentTab === 'academic' ? 'var(--accent)' : 'transparent') + ';color:' + (teamState.currentTab === 'academic' ? 'var(--accent)' : 'var(--text-dim)') + ';padding:6px 12px;cursor:pointer;font-size:0.75rem;">Academic (' + allAcad + ')</button>';
        html += '<button class="tab-btn ' + (teamState.currentTab === 'professional' ? 'active' : '') + '" data-tab="professional" style="background:transparent;border:none;border-bottom:2px solid ' + (teamState.currentTab === 'professional' ? 'var(--accent)' : 'transparent') + ';color:' + (teamState.currentTab === 'professional' ? 'var(--accent)' : 'var(--text-dim)') + ';padding:6px 12px;cursor:pointer;font-size:0.75rem;">Professional (' + allProf + ')</button>';
        html += '<button class="tab-btn ' + (teamState.currentTab === 'temporary' ? 'active' : '') + '" data-tab="temporary" style="background:transparent;border:none;border-bottom:2px solid ' + (teamState.currentTab === 'temporary' ? 'var(--accent)' : 'transparent') + ';color:' + (teamState.currentTab === 'temporary' ? 'var(--accent)' : 'var(--text-dim)') + ';padding:6px 12px;cursor:pointer;font-size:0.75rem;">Temporary (' + allTemp + ')</button>';
        html += '<button class="tab-btn ' + (teamState.currentTab === 'civilian' ? 'active' : '') + '" data-tab="civilian" style="background:transparent;border:none;border-bottom:2px solid ' + (teamState.currentTab === 'civilian' ? 'var(--accent)' : 'transparent') + ';color:' + (teamState.currentTab === 'civilian' ? 'var(--accent)' : 'var(--text-dim)') + ';padding:6px 12px;cursor:pointer;font-size:0.75rem;">Civilian (' + allCiv + ')</button>';
        html += '</div>';

        // Filter section
        html += '<div id="filter-container" style="margin-bottom:12px;">';
        html += buildFilterHTML(teamState.currentTab);
        html += '</div>';

        // Team list container
        html += '<div id="team-list-container"></div>';

        // Modals (hidden by default)
        html += getModalsHTML();

        container.innerHTML = html;

        // Render teams for current tab using TeamFilters
        var filteredTeams = getFilteredTeamsForTab(teamState.currentTab);
        renderTeamList(filteredTeams, container);
    }

    // ============================================================
    // BUILD FILTER HTML - Uses TeamFilters
    // ============================================================

    function buildFilterHTML(tab) {
        var filter = teamState.filters[tab] || teamState.filters.academic;
        var classes = typeof window.getClasses === 'function' ? window.getClasses() : [];

        if (tab === 'all') {
            return '<div class="filter-section"><span style="font-size:0.75rem;color:var(--text-dim);">All teams shown</span></div>';
        }

        if (tab === 'academic' || tab === 'professional' || tab === 'temporary' || tab === 'civilian') {
            return window.TeamFilters.buildFilterHTML(tab, filter, classes);
        }

        return '';
    }

    // ============================================================
    // GET FILTERED TEAMS - Uses TeamFilters
    // ============================================================

    function getFilteredTeamsForTab(tab) {
        if (tab === 'all') {
            var allTeams = window.data && Array.isArray(window.data.teams) ? window.data.teams : [];
            return allTeams.filter(function(t) {
                return t && t.status !== 'deleted';
            });
        }

        var filter = teamState.filters[tab] || teamState.filters.academic;
        return window.TeamFilters.filterTeams(tab, filter);
    }

    // ============================================================
    // RENDER TEAM LIST ONLY - For updates after mutations
    // ============================================================

    function renderTeamListOnly(container) {
        if (!container) {
            container = document.getElementById('tab-teams');
        }
        if (!container) return;

        if (!window.data) return;

        var filteredTeams = getFilteredTeamsForTab(teamState.currentTab);

        var listContainer = container.querySelector('#team-list-container');
        if (!listContainer) return;

        // Only rebuild the list, not the entire manager
        var tempContainer = document.createElement('div');
        renderTeamList(filteredTeams, tempContainer);
        listContainer.innerHTML = tempContainer.innerHTML;
    }

    // ============================================================
    // TEAM LIST RENDERING
    // ============================================================

    function renderTeamList(teams, container) {
        var listContainer = container.querySelector('#team-list-container');
        if (!listContainer) {
            listContainer = container;
        }

        if (teams.length === 0) {
            listContainer.innerHTML = '<p class="empty-state" style="padding:20px;">No teams found.</p>';
            return;
        }

        var html = '';
        // Header matches actual row data: Team Name | Period | Rank | Active | Actions
        html += '<div class="list-header team-header" style="display:grid;grid-template-columns:1.2fr 0.8fr 0.6fr 0.6fr 1fr;gap:8px;padding:8px 12px;background:var(--panel-alt);border-radius:6px 6px 0 0;border:1px solid var(--border);border-bottom:none;font-weight:600;font-size:0.7rem;color:var(--text-dim);">';
        html += '<span>Team Name</span>';
        html += '<span>Period</span>';
        html += '<span>Rank</span>';
        html += '<span>Active</span>';
        html += '<span>Actions</span>';
        html += '</div>';

        teams.forEach(function(team) {
            if (!team || typeof team !== 'object') return;

            var periodDisplay = window.TeamCore.getPeriodDisplay(team);

            // Use team.type for period calculation, not the tab
            var period = getCurrentPeriodForType(team.type);
            var activeMembers = window.TeamCore.getActiveMembers(team, period);
            // Show active member count, not total historical
            var memberCount = activeMembers.length;

            var isExpanded = (teamState.expandedTeamId === team.id);
            var isInactive = team.status === 'deprecated' || team.status === 'inactive';
            var inactiveClass = isInactive ? 'inactive' : '';

            var rankDisplay = '-';
            if (window.TeamRankings && typeof window.TeamRankings.getCurrentRank === 'function') {
                rankDisplay = window.TeamRankings.getCurrentRank(team) || '-';
            } else if (team.currentRank) {
                rankDisplay = team.currentRank;
            }

            var classDisplay = '';
            if (team.type === 'academic' && team.classId) {
                var className = window.getClassDisplayName ? window.getClassDisplayName(team.classId) : null;
                if (className && className !== 'Unassigned') {
                    classDisplay = ' <span class="team-class">[' + escapeHtml(className) + ']</span>';
                }
            }

            // Team row
            html += '<div class="list-item team-item ' + inactiveClass + '" data-id="' + escapeHtml(team.id) + '" style="display:grid;grid-template-columns:1.2fr 0.8fr 0.6fr 0.6fr 1fr;">';
            html += '<span><strong>' + escapeHtml(team.name) + '</strong>' + classDisplay;
            if (isInactive) {
                html += ' <span class="team-status-inactive">(Inactive)</span>';
            }
            html += '</span>';
            html += '<span class="team-period">' + escapeHtml(periodDisplay) + '</span>';
            html += '<span class="team-rank">' + escapeHtml(rankDisplay) + '</span>';
            html += '<span class="team-member-count">' + memberCount + '</span>';
            html += '<span class="actions">' +
                '<button class="small toggle-members" data-id="' + escapeHtml(team.id) + '">' + (isExpanded ? '▾' : '▸') + '</button>' +
                '<button class="small manage-members" data-id="' + escapeHtml(team.id) + '">Members</button>' +
                '<button class="small manage-rankings" data-id="' + escapeHtml(team.id) + '">Rankings</button>' +
                '<button class="small edit-team" data-id="' + escapeHtml(team.id) + '">Edit</button>' +
                '<button class="small danger delete-team" data-id="' + escapeHtml(team.id) + '">Delete</button>' +
                '</span>';
            html += '</div>';

            if (isExpanded) {
                html += renderExpandedMembers(team, period);
            }
        });

        listContainer.innerHTML = html;
    }

    // ============================================================
    // RENDER EXPANDED MEMBERS
    // ============================================================

    function renderExpandedMembers(team, filterPeriod) {
        if (!team || typeof team !== 'object') return '';

        var periodNum = parseInt(filterPeriod, 10) || 1;
        var activeMembers = window.TeamCore.getActiveMembers(team, periodNum);
        var periodLabel = team.type === 'academic' ? 'Week' : 'Period';
        var labelText = team.type === 'academic'
            ? 'Active Members at Week ' + escapeHtml(String(periodNum)) + ':'
            : 'Active Members in ' + escapeHtml(String(periodNum)) + ':';

        var html = '<div class="team-members-expanded" data-team-id="' + escapeHtml(team.id) + '">';

        if (activeMembers.length > 0) {
            html += '<div class="members-expanded-header">' + labelText + '</div>';
            activeMembers.forEach(function(member) {
                if (!member || typeof member !== 'object') return;

                var char = window.getCharacterById ? window.getCharacterById(member.characterId) : null;
                var name = char ? (window.getDisplayName ? window.getDisplayName(char) : 'Unknown') : 'Unknown';
                var age = char ? (window.getCharacterAge ? window.getCharacterAge(char) : '-') : '-';
                var deadMarker = char && char.deceased ? ' ✝' : '';

                // Use TeamMembers for status if available
                var status = 'active';
                var statusInfo = { label: 'Active', color: 'var(--accent)' };
                if (window.TeamMembers && typeof window.TeamMembers.getStatusAtPeriod === 'function') {
                    status = window.TeamMembers.getStatusAtPeriod(member, periodNum, team.type);
                    statusInfo = window.TeamCore.getMemberStatusInfo(status);
                }

                // Status label is internal, but escape it anyway for safety
                var escapedStatusLabel = escapeHtml(statusInfo.label);

                html += '<div class="member-entry" style="border-left:3px solid ' + statusInfo.color + ';padding-left:8px;">';
                html += '<span>' + escapeHtml(name) + deadMarker + ' <span class="role">(' + escapeHtml(member.role || 'Member') + ')</span></span>';
                html += '<span style="color:var(--text-dim);font-size:0.75rem;">Age: ' + escapeHtml(age) + ' | Joined: ' + escapeHtml(member.joinPeriod || '?') + (member.leavePeriod ? ' → ' + escapeHtml(member.leavePeriod) : '') + ' | <span style="color:' + statusInfo.color + ';">' + escapedStatusLabel + '</span></span>';
                html += '</div>';
            });
        } else {
            html += '<div class="member-entry empty">No active members this ' + periodLabel.toLowerCase() + '</div>';
        }

        html += '</div>';
        return html;
    }

    // ============================================================
    // MODALS HTML
    // ============================================================

    function getModalsHTML() {
        return `
            <!-- Team Form Modal -->
            <div id="team-form-modal" class="modal hidden">
                <div class="modal-content" style="max-width:600px;">
                    <div class="modal-header">
                        <h3 id="team-form-title">Add Team</h3>
                        <button class="close-modal" id="close-team-form">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="team-form-inner">
                            <div class="form-grid">
                                <div class="form-group full-width">
                                    <label>Team Name *</label>
                                    <input type="text" id="team-name" required>
                                </div>
                                <div class="form-group">
                                    <label>Team Type *</label>
                                    <select id="team-type" required>
                                        <option value="academic">Academic</option>
                                        <option value="professional">Professional</option>
                                        <option value="temporary">Temporary</option>
                                        <option value="civilian">Civilian</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label id="team-start-label">Start Period</label>
                                    <input type="text" id="team-start" placeholder="Week or Year">
                                </div>
                                <div class="form-group">
                                    <label id="team-end-label">End Period (optional)</label>
                                    <input type="text" id="team-end" placeholder="Week or Year">
                                </div>
                                <div class="form-group">
                                    <label>Current Ranking</label>
                                    <input type="text" id="team-ranking" readonly disabled>
                                    <span style="font-size:0.55rem;color:var(--text-dim);">(Read-only; use Rankings tab to modify)</span>
                                </div>
                                <div class="form-group">
                                    <label>Status</label>
                                    <select id="team-status">
                                        <option value="active">Active</option>
                                        <option value="inactive">Inactive</option>
                                        <option value="deprecated">Deprecated</option>
                                    </select>
                                </div>
                                <div id="academic-team-fields" style="display:none;grid-column:1/-1;">
                                    <div class="form-group">
                                        <label>Class</label>
                                        <select id="team-class" style="width:100%;padding:8px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                            <option value="">Unassigned</option>
                                        </select>
                                    </div>
                                    <div class="form-group">
                                        <label>Team Number (optional)</label>
                                        <input type="text" id="team-number" placeholder="e.g., A, B, 1, 2...">
                                    </div>
                                </div>
                                <div class="form-group full-width" id="associated-mission-field" style="display:none;">
                                    <label>Associated Mission</label>
                                    <select id="team-mission">
                                        <option value="">None</option>
                                    </select>
                                </div>
                                <div class="form-group full-width">
                                    <label>Name History</label>
                                    <div id="name-history-container">
                                        <div class="name-history-entry" style="display:flex;gap:6px;margin-bottom:4px;flex-wrap:wrap;align-items:center;">
                                            <input type="text" class="name-history-name" placeholder="Team Name" style="flex:1;min-width:80px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">
                                            <input type="text" class="name-history-start" placeholder="Start" style="flex:1;min-width:60px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">
                                            <input type="text" class="name-history-end" placeholder="End" style="flex:1;min-width:60px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">
                                            <button type="button" class="small danger remove-name" style="padding:2px 6px;font-size:0.6rem;">✕</button>
                                        </div>
                                    </div>
                                    <button type="button" id="add-name-history-btn" class="small" style="margin-top:8px;">+ Add Name Period</button>
                                </div>
                            </div>
                            <div class="form-actions">
                                <button type="button" id="cancel-team-form" class="secondary">Cancel</button>
                                <button type="submit" id="save-team-btn" class="primary">Save Team</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <!-- Member Modal -->
            <div id="member-modal" class="modal hidden">
                <div class="modal-content" style="max-width:800px;">
                    <div class="modal-header">
                        <h3 id="modal-team-name">Team Members</h3>
                        <button class="close-modal">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="member-form" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center;">
                            <select id="member-character" style="flex:1;min-width:150px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                <option value="">Select character...</option>
                            </select>
                            <input type="text" id="member-role" placeholder="Role" style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                            <input type="text" id="member-join" placeholder="Join" style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                            <input type="text" id="member-leave" placeholder="Leave" style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                            <button id="add-member-btn" class="primary small">Add Member</button>
                        </div>
                        <div id="members-list">
                            <p class="empty-state">No members in this team</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Edit Member Modal -->
            <div id="edit-member-modal" class="modal hidden">
                <div class="modal-content small">
                    <div class="modal-header">
                        <h3>Edit Member</h3>
                        <button class="close-modal">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="edit-member-form">
                            <div class="form-group">
                                <label>Character</label>
                                <p id="edit-member-name" style="margin:4px 0 12px 0;font-weight:600;"></p>
                            </div>
                            <div class="form-group">
                                <label>Role</label>
                                <input type="text" id="edit-member-role">
                            </div>
                            <div class="form-group">
                                <label>Join</label>
                                <input type="text" id="edit-member-join">
                            </div>
                            <div class="form-group">
                                <label>Leave</label>
                                <input type="text" id="edit-member-leave">
                            </div>
                            <div class="form-actions">
                                <button type="button" id="cancel-edit-member" class="secondary">Cancel</button>
                                <button type="submit" id="save-edit-member" class="primary">Save Changes</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>

            <!-- Ranking Modal -->
            <div id="ranking-modal" class="modal hidden">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3 id="ranking-modal-title">Ranking History</h3>
                        <button class="close-modal">&times;</button>
                    </div>
                    <div class="modal-body">
                        <form id="ranking-form-inner">
                            <div class="ranking-form" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center;">
                                <input type="text" id="ranking-period" placeholder="Period" style="flex:1;min-width:100px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                <input type="number" id="ranking-rank" placeholder="Rank" min="1" style="flex:1;min-width:80px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                                <button type="button" id="add-ranking-btn" class="primary small">Add Ranking</button>
                            </div>
                        </form>
                        <div id="ranking-list">
                            <p class="empty-state">No ranking history</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // TEAM FORM HANDLING
    // ============================================================

    function showTeamForm(editId) {
        var modal = document.getElementById('team-form-modal');
        if (!modal) return;

        var title = document.getElementById('team-form-title');
        var form = document.getElementById('team-form-inner');

        modal.classList.remove('hidden');

        populateClassSelector();
        populateMissionSelector();

        var nameContainer = document.getElementById('name-history-container');

        if (editId) {
            title.textContent = 'Edit Team';
            var team = getTeam(editId);
            if (team) {
                document.getElementById('team-name').value = team.name || '';
                document.getElementById('team-type').value = team.type || 'academic';
                document.getElementById('team-start').value = team.startPeriod || '';
                document.getElementById('team-end').value = team.endPeriod || '';
                // Ranking field is DISPLAY ONLY - disabled by HTML
                var rankingInput = document.getElementById('team-ranking');
                if (rankingInput) {
                    var currentRank = window.TeamRankings && typeof window.TeamRankings.getCurrentRank === 'function'
                        ? window.TeamRankings.getCurrentRank(team)
                        : team.currentRank || '';
                    rankingInput.value = currentRank;
                }
                document.getElementById('team-status').value = team.status || 'active';
                if (team.temporaryMission) {
                    var missionSelect = document.getElementById('team-mission');
                    if (missionSelect) missionSelect.value = team.temporaryMission;
                }
                if (team.type === 'academic') {
                    var classSelect = document.getElementById('team-class');
                    if (classSelect && team.classId) {
                        classSelect.value = team.classId;
                    }
                    var numberInput = document.getElementById('team-number');
                    if (numberInput) numberInput.value = team.teamNumber || '';
                }
                if (form) form.dataset.editId = editId;

                if (nameContainer) {
                    nameContainer.innerHTML = '';
                    if (team.nameHistory && team.nameHistory.length > 0) {
                        team.nameHistory.forEach(function(entry) {
                            addNameHistoryEntry(nameContainer, entry.name, entry.startPeriod, entry.endPeriod);
                        });
                    } else {
                        addNameHistoryEntry(nameContainer);
                    }
                }
            }
        } else {
            title.textContent = 'Add Team';
            if (form) {
                form.reset();
                document.getElementById('team-type').value = 'academic';
                document.getElementById('team-status').value = 'active';
                var rankingInput = document.getElementById('team-ranking');
                if (rankingInput) rankingInput.value = '';
                delete form.dataset.editId;
            }

            if (nameContainer) {
                nameContainer.innerHTML = '';
                addNameHistoryEntry(nameContainer);
            }
        }

        updatePeriodLabels();
        var typeSelect = document.getElementById('team-type');
        if (typeSelect) {
            toggleAcademicFields(typeSelect.value);
            toggleMissionField(typeSelect.value);
        }
    }

    function collectNameHistory() {
        var entries = document.querySelectorAll('.name-history-entry');
        var history = [];

        entries.forEach(function(entry) {
            var name = entry.querySelector('.name-history-name');
            var start = entry.querySelector('.name-history-start');
            var end = entry.querySelector('.name-history-end');

            if (name && name.value.trim()) {
                history.push({
                    name: name.value.trim(),
                    startPeriod: start ? start.value.trim() : '',
                    endPeriod: end ? end.value.trim() : ''
                });
            }
        });

        return history;
    }

    function addNameHistoryEntry(container, name, start, end) {
        if (!container) return;
        var entry = document.createElement('div');
        entry.className = 'name-history-entry';
        entry.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;flex-wrap:wrap;align-items:center;';
        entry.innerHTML = `
            <input type="text" class="name-history-name" placeholder="Team Name" value="${escapeHtml(name || '')}" style="flex:1;min-width:80px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">
            <input type="text" class="name-history-start" placeholder="Start" value="${escapeHtml(start || '')}" style="flex:1;min-width:60px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">
            <input type="text" class="name-history-end" placeholder="End" value="${escapeHtml(end || '')}" style="flex:1;min-width:60px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;">
            <button type="button" class="small danger remove-name" style="padding:2px 6px;font-size:0.6rem;">✕</button>
        `;
        container.appendChild(entry);
        entry.querySelector('.remove-name').onclick = function() {
            if (container.children.length > 1) entry.remove();
            else showNotification('You need at least one name entry.', 'error');
        };
    }

    function saveTeam(e) {
        e.preventDefault();
        var form = e.target;
        var editId = form.dataset.editId;

        var type = document.getElementById('team-type').value;

        // Current rank is read-only; ignore the input value
        var teamData = {
            name: document.getElementById('team-name').value.trim(),
            type: type,
            startPeriod: document.getElementById('team-start').value || '',
            endPeriod: document.getElementById('team-end').value || '',
            status: document.getElementById('team-status').value || 'active',
            // Only include academic-specific fields if team is academic
            classId: type === 'academic'
                ? (document.getElementById('team-class').value || null)
                : null,
            teamNumber: type === 'academic'
                ? (document.getElementById('team-number').value.trim() || '')
                : '',
            // Only include mission field if team is temporary or professional
            temporaryMission: (type === 'temporary' || type === 'professional')
                ? (document.getElementById('team-mission').value || null)
                : null,
            nameHistory: collectNameHistory()
        };

        if (!teamData.name) {
            showNotification('Team name is required.', 'error');
            return;
        }

        var result;
        if (editId) {
            result = window.TeamCore.updateTeam(editId, teamData);
            if (!result) {
                showNotification('Failed to update team.', 'error');
                return;
            }
        } else {
            result = window.TeamCore.createTeam(teamData);
            if (!result) {
                showNotification('Failed to create team.', 'error');
                return;
            }
        }

        // Close modal immediately (mutation succeeded)
        var modal = document.getElementById('team-form-modal');
        if (modal) {
            modal.classList.add('hidden');
        }

        // Refresh UI immediately to reflect in-memory change
        refreshTeamList();
        refreshTeamStats();
        safeUpdateDashboardStats();

        // Then persist (with no UI dependency)
        persistMutation({
            successMessage: editId ? 'Team updated successfully!' : 'Team created successfully!',
            errorMessage: 'Failed to save team changes to persistent storage. Your changes have been applied in memory.',
        });
    }

    function deleteTeam(id) {
        var team = getTeam(id);
        if (!team) {
            showNotification('Team not found.', 'error');
            return;
        }

        // Confirm before mutation
        if (!confirm('Delete "' + team.name + '"? The team will be removed from the manager.')) {
            return;
        }

        // MUTATE: Actually delete the team
        var result = window.TeamCore.deleteTeam(id);

        if (!result) {
            showNotification('Failed to delete team.', 'error');
            return;
        }

        // Refresh UI immediately to reflect in-memory change
        if (teamState.expandedTeamId === id) {
            teamState.expandedTeamId = null;
        }
        refreshTeamList();
        refreshTeamStats();
        safeUpdateDashboardStats();

        // Then persist
        persistMutation({
            successMessage: 'Team deleted successfully!',
            errorMessage: 'Failed to save team deletion to persistent storage. The team has been removed from memory.',
            onSuccess: function() {
                refreshTeamList();
                refreshTeamStats();
                safeUpdateDashboardStats();
            }
        });
    }

    // ============================================================
    // MEMBER MANAGEMENT
    // ============================================================

    function openMemberModal(teamId) {
        var modal = document.getElementById('member-modal');
        if (!modal) return;

        var team = getTeam(teamId);
        if (!team) return;

        document.getElementById('modal-team-name').textContent = team.name + ' - Members';

        populateMemberCharacterSelect(teamId);

        document.getElementById('member-role').value = '';
        document.getElementById('member-join').value = '';
        document.getElementById('member-leave').value = '';

        renderMembers(team);
        modal.dataset.teamId = teamId;
        modal.classList.remove('hidden');
    }

    function populateMemberCharacterSelect(teamId) {
        var select = document.getElementById('member-character');
        if (!select) return;

        var team = getTeam(teamId);
        if (!team) return;

        select.innerHTML = '<option value="">Select character...</option>';
        var chars = window.data ? window.data.characters || [] : [];
        var currentMemberIds = (team.members || []).map(function(m) { return m.characterId; });

        chars.forEach(function(char) {
            var isInTeam = currentMemberIds.some(function(id) { return String(id) === String(char.id); });
            var option = document.createElement('option');
            option.value = char.id;
            var displayName = window.getDisplayName ? window.getDisplayName(char) : char.firstName || 'Unknown';
            option.textContent = displayName + ' [' + (window.getCurrentStatus ? window.getCurrentStatus(char) : '') + ']';
            if (isInTeam) {
                option.style.color = 'var(--accent)';
                option.textContent += ' ✓ In Team';
                option.disabled = true;
            }
            select.appendChild(option);
        });
    }

    function renderMembers(team) {
        var container = document.getElementById('members-list');
        if (!container) return;

        if (!team.members || team.members.length === 0) {
            container.innerHTML = '<p class="empty-state">No members in this team</p>';
            return;
        }

        var html = '';
        var period = getCurrentPeriodForType(team.type);

        team.members.forEach(function(member, index) {
            var char = window.getCharacterById ? window.getCharacterById(member.characterId) : null;
            var name = char ? (window.getDisplayName ? window.getDisplayName(char) : 'Unknown') : 'Unknown';
            var deadMarker = char && char.deceased ? ' ✝' : '';

            var status = 'unknown';
            if (window.TeamMembers && typeof window.TeamMembers.getStatusAtPeriod === 'function') {
                status = window.TeamMembers.getStatusAtPeriod(member, period, team.type);
            }
            var statusInfo = window.TeamCore.getMemberStatusInfo(status);
            var escapedStatusLabel = escapeHtml(statusInfo.label);

            html += '<div class="member-entry" style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-bottom:1px solid var(--border-soft);border-left:3px solid ' + statusInfo.color + ';padding-left:8px;">';
            html += '<span><strong>' + escapeHtml(name) + '</strong>' + deadMarker + ' <span class="role" style="color:var(--text-dim);font-size:0.75rem;">' + escapeHtml(member.role || 'Member') + '</span></span>';
            html += '<span style="color:var(--text-dim);font-size:0.7rem;">Joined: ' + escapeHtml(member.joinPeriod || '?') + (member.leavePeriod ? ' → ' + escapeHtml(member.leavePeriod) : '') + '</span>';
            html += '<span style="color:' + statusInfo.color + ';font-size:0.65rem;font-weight:600;">' + escapedStatusLabel + '</span>';
            html += '<div class="member-actions" style="display:flex;gap:4px;">';
            html += '<button class="small edit-member" data-index="' + index + '" style="padding:2px 8px;font-size:0.65rem;">Edit</button>';
            html += '<button class="small danger remove-member" data-char="' + escapeHtml(member.characterId) + '" style="padding:2px 8px;font-size:0.65rem;">Remove</button>';
            html += '</div>';
            html += '</div>';
        });
        container.innerHTML = html;

        var modal = document.getElementById('member-modal');
        var teamId = modal.dataset.teamId;

        container.querySelectorAll('.edit-member').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var index = parseInt(this.dataset.index, 10);
                if (!isNaN(index)) {
                    openEditMemberModal(teamId, index);
                }
            });
        });

        container.querySelectorAll('.remove-member').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                removeMember(teamId, this.dataset.char);
            });
        });
    }

    function addMember() {
        var modal = document.getElementById('member-modal');
        var teamId = modal.dataset.teamId;
        if (!teamId) return;

        var charId = document.getElementById('member-character').value;
        var role = document.getElementById('member-role').value.trim();
        var joinPeriod = document.getElementById('member-join').value;
        var leavePeriod = document.getElementById('member-leave').value;

        if (!charId) {
            showNotification('Please select a character.', 'error');
            return;
        }

        var result = window.TeamCore.addMember(teamId, {
            characterId: charId,
            role: role,
            joinPeriod: joinPeriod,
            leavePeriod: leavePeriod
        });

        if (!result) {
            showNotification('Failed to add member. The character may already be in this team.', 'error');
            return;
        }

        // Refresh UI immediately to reflect in-memory change
        var updatedTeam = getTeam(teamId);
        if (updatedTeam) {
            renderMembers(updatedTeam);
        }
        refreshTeamList();
        refreshTeamStats();

        // Clear form fields
        document.getElementById('member-character').value = '';
        document.getElementById('member-role').value = '';
        document.getElementById('member-join').value = '';
        document.getElementById('member-leave').value = '';
        populateMemberCharacterSelect(teamId);

        // Then persist
        persistMutation({
            successMessage: 'Member added successfully!',
            errorMessage: 'Failed to save member addition to persistent storage. The member has been added in memory.',
        });
    }

    function removeMember(teamId, charId) {
        var result = window.TeamCore.removeMember(teamId, charId);
        if (!result) {
            showNotification('Failed to remove member.', 'error');
            return;
        }

        // Refresh UI immediately to reflect in-memory change
        var updatedTeam = getTeam(teamId);
        if (updatedTeam) {
            renderMembers(updatedTeam);
        }
        refreshTeamList();
        refreshTeamStats();

        // Then persist
        persistMutation({
            successMessage: 'Member removed successfully!',
            errorMessage: 'Failed to save member removal to persistent storage. The member has been removed from memory.',
        });
    }

    function openEditMemberModal(teamId, index) {
        var team = getTeam(teamId);
        if (!team || !team.members || !team.members[index]) {
            showNotification('Member not found.', 'error');
            return;
        }

        var member = team.members[index];
        var char = window.getCharacterById ? window.getCharacterById(member.characterId) : null;
        var name = char ? (window.getDisplayName ? window.getDisplayName(char) : 'Unknown') : 'Unknown';

        document.getElementById('edit-member-name').textContent = name;
        document.getElementById('edit-member-role').value = member.role || '';
        document.getElementById('edit-member-join').value = member.joinPeriod || '';
        document.getElementById('edit-member-leave').value = member.leavePeriod || '';

        var modal = document.getElementById('edit-member-modal');
        modal.dataset.teamId = teamId;
        modal.dataset.index = index;
        modal.classList.remove('hidden');
    }

    function saveEditMember(e) {
        e.preventDefault();
        var modal = document.getElementById('edit-member-modal');
        var teamId = modal.dataset.teamId;
        var index = parseInt(modal.dataset.index, 10);

        var team = getTeam(teamId);
        if (!team || !team.members || !team.members[index]) {
            showNotification('Member not found.', 'error');
            return;
        }

        var member = team.members[index];

        var result = window.TeamCore.updateMember(teamId, member.characterId, {
            role: document.getElementById('edit-member-role').value.trim(),
            joinPeriod: document.getElementById('edit-member-join').value,
            leavePeriod: document.getElementById('edit-member-leave').value
        });

        if (!result) {
            showNotification('Failed to update member.', 'error');
            return;
        }

        // Refresh UI immediately to reflect in-memory change
        var updatedTeam = getTeam(teamId);
        if (updatedTeam) {
            renderMembers(updatedTeam);
        }
        refreshTeamList();
        refreshTeamStats();

        // Close modal immediately
        document.getElementById('edit-member-modal').classList.add('hidden');

        // Then persist
        persistMutation({
            successMessage: 'Member updated successfully!',
            errorMessage: 'Failed to save member update to persistent storage. The member has been updated in memory.',
        });
    }

    // ============================================================
    // RANKING MANAGEMENT
    // ============================================================

    function openRankingModal(teamId) {
        var team = getTeam(teamId);
        if (!team) return;

        var modal = document.getElementById('ranking-modal');
        if (!modal) return;

        document.getElementById('ranking-modal-title').textContent = team.name + ' - Ranking History';
        document.getElementById('ranking-period').value = '';
        document.getElementById('ranking-rank').value = '';

        modal.dataset.teamId = teamId;
        renderRankings(team);
        modal.classList.remove('hidden');
    }

    function renderRankings(team) {
        var container = document.getElementById('ranking-list');
        if (!container) return;

        var rankings = window.TeamRankings && typeof window.TeamRankings.getSortedHistory === 'function'
            ? window.TeamRankings.getSortedHistory(team)
            : team.rankingHistory || [];

        if (rankings.length === 0) {
            container.innerHTML = '<p class="empty-state">No ranking history</p>';
            return;
        }

        var html = '';
        rankings.forEach(function(entry) {
            html += '<div class="ranking-entry" style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-bottom:1px solid var(--border-soft);">';
            html += '<span><strong>#' + escapeHtml(entry.rank) + '</strong> - ' + escapeHtml(entry.period) + '</span>';
            html += '<button class="small danger remove-ranking" data-period="' + escapeHtml(entry.period) + '" style="padding:2px 8px;font-size:0.65rem;">Remove</button>';
            html += '</div>';
        });
        container.innerHTML = html;

        var modal = document.getElementById('ranking-modal');
        var teamId = modal.dataset.teamId;

        container.querySelectorAll('.remove-ranking').forEach(function(btn) {
            btn.addEventListener('click', function() {
                removeRanking(teamId, this.dataset.period);
            });
        });
    }

    function addRanking(e) {
        // Prevent form submission if inside a form
        if (e && e.preventDefault) {
            e.preventDefault();
        }

        var modal = document.getElementById('ranking-modal');
        var teamId = modal.dataset.teamId;
        if (!teamId) return;

        var period = document.getElementById('ranking-period').value;
        var rankInput = document.getElementById('ranking-rank');
        var rank = parseInt(rankInput ? rankInput.value : '', 10);

        if (!period) {
            showNotification('Please enter a period.', 'error');
            return;
        }

        if (!Number.isInteger(rank) || rank < 1) {
            showNotification('Please enter a valid rank (positive integer).', 'error');
            return;
        }

        var result = window.TeamCore.addRanking(teamId, period, rank);
        if (!result) {
            showNotification('Failed to add ranking.', 'error');
            return;
        }

        // Refresh UI immediately to reflect in-memory change
        var updatedTeam = getTeam(teamId);
        if (updatedTeam) {
            renderRankings(updatedTeam);
        }
        refreshTeamList();
        refreshTeamStats();

        // Clear form fields
        document.getElementById('ranking-period').value = '';
        if (rankInput) rankInput.value = '';

        // Then persist
        persistMutation({
            successMessage: 'Ranking added successfully!',
            errorMessage: 'Failed to save ranking to persistent storage. The ranking has been added in memory.',
        });
    }

    function removeRanking(teamId, period) {
        var result = window.TeamCore.removeRanking(teamId, period);
        if (!result) {
            showNotification('Failed to remove ranking.', 'error');
            return;
        }

        // Refresh UI immediately to reflect in-memory change
        var updatedTeam = getTeam(teamId);
        if (updatedTeam) {
            renderRankings(updatedTeam);
        }
        refreshTeamList();
        refreshTeamStats();

        // Then persist
        persistMutation({
            successMessage: 'Ranking removed successfully!',
            errorMessage: 'Failed to save ranking removal to persistent storage. The ranking has been removed from memory.',
        });
    }

    // ============================================================
    // UI HELPERS
    // ============================================================

    function populateClassSelector() {
        var select = document.getElementById('team-class');
        if (!select) return;

        var classes = window.getClasses ? window.getClasses() : [];
        var currentValue = select.value;
        select.innerHTML = '<option value="">Unassigned</option>';
        classes.forEach(function(cls) {
            var option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.name;
            select.appendChild(option);
        });
        if (currentValue) select.value = currentValue;
    }

    function populateMissionSelector() {
        var select = document.getElementById('team-mission');
        if (!select) return;

        var data = window.data || {};
        var missions = data.missions || [];
        select.innerHTML = '<option value="">None</option>';
        missions.forEach(function(mission) {
            if (mission.status !== 'cancelled') {
                var option = document.createElement('option');
                option.value = mission.id;
                option.textContent = mission.title + (mission.status === 'completed' ? ' (completed)' : '');
                select.appendChild(option);
            }
        });
    }

    function toggleAcademicFields(type) {
        var fields = document.getElementById('academic-team-fields');
        if (fields) {
            fields.style.display = (type === 'academic') ? 'block' : 'none';
        }
    }

    function toggleMissionField(type) {
        var field = document.getElementById('associated-mission-field');
        if (field) {
            field.style.display = (type === 'temporary' || type === 'professional') ? 'block' : 'none';
        }
    }

    function updatePeriodLabels() {
        var typeSelect = document.getElementById('team-type');
        if (!typeSelect) return;

        var type = typeSelect.value;
        var startLabel = document.getElementById('team-start-label');
        var endLabel = document.getElementById('team-end-label');
        var startInput = document.getElementById('team-start');
        var endInput = document.getElementById('team-end');

        if (type === 'academic') {
            if (startLabel) startLabel.textContent = 'Start Week';
            if (endLabel) endLabel.textContent = 'End Week (optional)';
            if (startInput) startInput.placeholder = 'Week (e.g., 1)';
            if (endInput) endInput.placeholder = 'Week (e.g., 52)';
        } else {
            if (startLabel) startLabel.textContent = 'Start Period';
            if (endLabel) endLabel.textContent = 'End Period (optional)';
            if (startInput) startInput.placeholder = 'Year or date';
            if (endInput) endInput.placeholder = 'Year or date';
        }

        toggleAcademicFields(type);
        toggleMissionField(type);
    }

    // ============================================================
    // EVENT INITIALIZATION - Using event delegation where possible
    // ============================================================

    function initTeamManagerEvents(container) {
        // Tab switching
        var tabNav = container.querySelector('.tab-nav');
        if (tabNav) {
            tabNav.addEventListener('click', function(e) {
                var btn = e.target.closest('.tab-btn');
                if (!btn) return;

                var tab = btn.dataset.tab;
                teamState.currentTab = tab;

                // Update tab buttons
                tabNav.querySelectorAll('.tab-btn').forEach(function(b) {
                    b.classList.remove('active');
                    b.style.color = 'var(--text-dim)';
                    b.style.borderBottomColor = 'transparent';
                });
                btn.classList.add('active');
                btn.style.color = 'var(--accent)';
                btn.style.borderBottomColor = 'var(--accent)';

                // Update filter section
                var filterContainer = document.getElementById('filter-container');
                if (filterContainer) {
                    filterContainer.innerHTML = buildFilterHTML(tab);
                    // Re-bind filter apply button if present
                    var applyBtn = filterContainer.querySelector('#apply-filter-btn');
                    if (applyBtn) {
                        applyBtn.addEventListener('click', function() {
                            applyFilters(tab);
                        });
                    }
                    var inactiveCheck = filterContainer.querySelector('#academic-show-inactive, #professional-show-inactive');
                    if (inactiveCheck) {
                        inactiveCheck.addEventListener('change', function() {
                            applyFilters(tab);
                        });
                    }
                }

                // Update team list
                refreshTeamList();
                refreshTeamStats();
            });
        }

        // Add team button
        var addBtn = container.querySelector('#add-team-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() {
                showTeamForm(null);
            });
        }

        // Team list actions - using event delegation
        var listContainer = container.querySelector('#team-list-container');
        if (listContainer) {
            listContainer.addEventListener('click', function(e) {
                var button = e.target.closest('button');
                if (!button) return;

                var teamId = button.dataset.id;
                if (!teamId && button.closest('.list-item')) {
                    teamId = button.closest('.list-item').dataset.id;
                }

                // Toggle members
                if (button.classList.contains('toggle-members')) {
                    var id = button.dataset.id;
                    if (teamState.expandedTeamId === id) {
                        teamState.expandedTeamId = null;
                    } else {
                        teamState.expandedTeamId = id;
                    }
                    refreshTeamList();
                    refreshTeamStats();
                    return;
                }

                // Manage members
                if (button.classList.contains('manage-members')) {
                    openMemberModal(button.dataset.id);
                    return;
                }

                // Manage rankings
                if (button.classList.contains('manage-rankings')) {
                    openRankingModal(button.dataset.id);
                    return;
                }

                // Edit team
                if (button.classList.contains('edit-team')) {
                    showTeamForm(button.dataset.id);
                    return;
                }

                // Delete team
                if (button.classList.contains('delete-team')) {
                    deleteTeam(button.dataset.id);
                    return;
                }
            });
        }

        // Form modals
        var closeFormBtn = document.getElementById('close-team-form');
        if (closeFormBtn) {
            closeFormBtn.addEventListener('click', function() {
                document.getElementById('team-form-modal').classList.add('hidden');
            });
        }

        var cancelFormBtn = document.getElementById('cancel-team-form');
        if (cancelFormBtn) {
            cancelFormBtn.addEventListener('click', function() {
                document.getElementById('team-form-modal').classList.add('hidden');
            });
        }

        var formModal = document.getElementById('team-form-modal');
        if (formModal) {
            formModal.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                }
            });
        }

        var form = document.getElementById('team-form-inner');
        if (form) {
            form.addEventListener('submit', saveTeam);
        }

        // Type select change
        var typeSelect = document.getElementById('team-type');
        if (typeSelect) {
            typeSelect.addEventListener('change', function() {
                updatePeriodLabels();
            });
        }

        // Add name history
        var addNameBtn = document.getElementById('add-name-history-btn');
        if (addNameBtn) {
            addNameBtn.addEventListener('click', function() {
                var container = document.getElementById('name-history-container');
                if (container) {
                    addNameHistoryEntry(container);
                }
            });
        }

        // Member modal
        var addMemberBtn = document.getElementById('add-member-btn');
        if (addMemberBtn) {
            addMemberBtn.addEventListener('click', addMember);
        }

        var memberClose = document.querySelector('#member-modal .close-modal');
        if (memberClose) {
            memberClose.addEventListener('click', function() {
                document.getElementById('member-modal').classList.add('hidden');
            });
        }

        var memberBg = document.getElementById('member-modal');
        if (memberBg) {
            memberBg.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                }
            });
        }

        // Edit member
        var editClose = document.querySelector('#edit-member-modal .close-modal');
        if (editClose) {
            editClose.addEventListener('click', function() {
                document.getElementById('edit-member-modal').classList.add('hidden');
            });
        }

        var editBg = document.getElementById('edit-member-modal');
        if (editBg) {
            editBg.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                }
            });
        }

        var cancelEdit = document.getElementById('cancel-edit-member');
        if (cancelEdit) {
            cancelEdit.addEventListener('click', function() {
                document.getElementById('edit-member-modal').classList.add('hidden');
            });
        }

        var editForm = document.getElementById('edit-member-form');
        if (editForm) {
            editForm.addEventListener('submit', saveEditMember);
        }

        // Ranking modal
        var addRankBtn = document.getElementById('add-ranking-btn');
        if (addRankBtn) {
            // Remove any existing listener and attach new one
            addRankBtn.removeEventListener('click', addRanking);
            addRankBtn.addEventListener('click', addRanking);
        }

        var rankClose = document.querySelector('#ranking-modal .close-modal');
        if (rankClose) {
            rankClose.addEventListener('click', function() {
                document.getElementById('ranking-modal').classList.add('hidden');
            });
        }

        var rankBg = document.getElementById('ranking-modal');
        if (rankBg) {
            rankBg.addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.add('hidden');
                }
            });
        }

        // Filter apply button (initial)
        var applyBtn = document.getElementById('apply-filter-btn');
        if (applyBtn) {
            applyBtn.addEventListener('click', function() {
                applyFilters(teamState.currentTab);
            });
        }

        // Filter inactive checkboxes
        var inactiveChecks = container.querySelectorAll('#academic-show-inactive, #professional-show-inactive');
        inactiveChecks.forEach(function(check) {
            check.addEventListener('change', function() {
                applyFilters(teamState.currentTab);
            });
        });
    }

    // ============================================================
    // APPLY FILTERS
    // ============================================================

    function applyFilters(tab) {
        var filter = teamState.filters[tab] || teamState.filters.academic;

        if (tab === 'academic') {
            var weekInput = document.getElementById('team-filter-week');
            var classFilter = document.getElementById('team-class-filter');
            var inactiveCheck = document.getElementById('academic-show-inactive');

            if (weekInput) {
                var week = parseInt(weekInput.value, 10);
                if (!isNaN(week) && week >= 1 && week <= 52) {
                    filter.filterWeek = week;
                }
            }
            if (classFilter) {
                filter.filterClass = classFilter.value;
            }
            if (inactiveCheck) {
                filter.filterStatus = inactiveCheck.checked ? 'inactive' : 'active';
            }
        } else if (tab === 'professional') {
            var yearInput = document.getElementById('team-filter-year');
            var profInactiveCheck = document.getElementById('professional-show-inactive');

            if (yearInput) {
                var year = parseInt(yearInput.value, 10);
                if (!isNaN(year) && year >= 1900) {
                    filter.filterYear = year;
                } else {
                    filter.filterYear = '';
                }
            }
            if (profInactiveCheck) {
                filter.filterStatus = profInactiveCheck.checked ? 'inactive' : 'active';
            }
        } else if (tab === 'temporary') {
            var tempYearInput = document.getElementById('team-filter-year');

            if (tempYearInput) {
                var year = parseInt(tempYearInput.value, 10);
                if (!isNaN(year) && year >= 1900) {
                    filter.filterYear = year;
                } else {
                    filter.filterYear = '';
                }
            }
        }

        refreshTeamList();
        refreshTeamStats();
    }

    // ============================================================
    // REGISTER WITH TABMANAGER
    // ============================================================

    if (typeof window.TabManager !== 'undefined') {
        window.TabManager.register('teams', renderTeamManager);
    }

    document.addEventListener('dataReady', function() {
        var container = document.getElementById('tab-teams');
        if (container && container.style.display !== 'none') {
            renderTeamManager(container);
        }
    });

    document.addEventListener('tabChanged', function(e) {
        if (e.detail && e.detail.tab === 'teams') {
            var container = document.getElementById('tab-teams');
            if (container) {
                renderTeamManager(container);
            }
        }
    });

    if (window.data) {
        setTimeout(function() {
            var container = document.getElementById('tab-teams');
            if (container && container.style.display !== 'none') {
                renderTeamManager(container);
            }
        }, 100);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.renderTeamManager = renderTeamManager;
    window.refreshTeamList = refreshTeamList;
    window.refreshTeamStats = refreshTeamStats;
    window.teamState = teamState;

})();
