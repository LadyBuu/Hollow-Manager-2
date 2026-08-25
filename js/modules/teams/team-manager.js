/**
 * js/modules/teams/team-manager.js - Team Manager
 * Path: js/modules/teams/team-manager.js
 */

(function() {
    'use strict';

    var teamState = {
        currentTab: 'academic',
        expandedTeamId: null
    };

    window.teamState = teamState;

    function renderTeamManager(container) {
        if (!container) {
            container = document.getElementById('tab-teams');
        }
        if (!container) return;

        if (!window.data) {
            container.innerHTML = '<p class="empty-state">Loading data...</p>';
            return;
        }

        if (!window.data.teams) {
            window.data.teams = [];
        }

        // Render directly into the tab container
        renderDirect(container);
        initTeamManagerEvents(container);
    }

    function renderDirect(container) {
        var allTeams = window.data.teams || [];
        
        var academicTeams = allTeams.filter(function(t) { return t.type === 'academic'; });
        var professionalTeams = allTeams.filter(function(t) { return t.type === 'professional'; });
        var temporaryTeams = allTeams.filter(function(t) { return t.type === 'temporary' || t.type === 'internship'; });
        var civilianTeams = allTeams.filter(function(t) { return t.type === 'civilian'; });

        var html = '';
        
        // Header
        html += '<div class="page-header">';
        html += '<h2>Team Manager</h2>';
        html += '<button id="add-team-btn" class="primary">+ Add Team</button>';
        html += '</div>';

        // Stats
        html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;">';
        html += '<div style="background:var(--panel);padding:8px;border-radius:6px;border:1px solid var(--border);text-align:center;"><span style="color:var(--text-dim);font-size:0.7rem;">Academic</span><br><strong style="font-size:1.2rem;color:var(--accent);">' + academicTeams.length + '</strong></div>';
        html += '<div style="background:var(--panel);padding:8px;border-radius:6px;border:1px solid var(--border);text-align:center;"><span style="color:var(--text-dim);font-size:0.7rem;">Professional</span><br><strong style="font-size:1.2rem;color:var(--info);">' + professionalTeams.length + '</strong></div>';
        html += '<div style="background:var(--panel);padding:8px;border-radius:6px;border:1px solid var(--border);text-align:center;"><span style="color:var(--text-dim);font-size:0.7rem;">Temporary</span><br><strong style="font-size:1.2rem;color:var(--warning);">' + temporaryTeams.length + '</strong></div>';
        html += '<div style="background:var(--panel);padding:8px;border-radius:6px;border:1px solid var(--border);text-align:center;"><span style="color:var(--text-dim);font-size:0.7rem;">Civilian</span><br><strong style="font-size:1.2rem;color:var(--text-dim);">' + civilianTeams.length + '</strong></div>';
        html += '</div>';

        // Tab buttons
        html += '<div class="tab-nav" style="display:flex;gap:4px;border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:12px;">';
        html += '<button class="tab-btn active" data-tab="all" style="padding:6px 12px;background:transparent;border:none;border-bottom:2px solid var(--accent);color:var(--accent);cursor:pointer;">All Teams (' + allTeams.length + ')</button>';
        html += '<button class="tab-btn" data-tab="academic" style="padding:6px 12px;background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);cursor:pointer;">Academic (' + academicTeams.length + ')</button>';
        html += '<button class="tab-btn" data-tab="professional" style="padding:6px 12px;background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);cursor:pointer;">Professional (' + professionalTeams.length + ')</button>';
        html += '<button class="tab-btn" data-tab="temporary" style="padding:6px 12px;background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);cursor:pointer;">Temporary (' + temporaryTeams.length + ')</button>';
        html += '<button class="tab-btn" data-tab="civilian" style="padding:6px 12px;background:transparent;border:none;border-bottom:2px solid transparent;color:var(--text-dim);cursor:pointer;">Civilian (' + civilianTeams.length + ')</button>';
        html += '</div>';

        // Team list container
        html += '<div id="team-list-container"></div>';

        container.innerHTML = html;

        // Render all teams initially
        renderTeamList(allTeams, container);
    }

    function renderTeamList(teams, container) {
        var listContainer = container.querySelector('#team-list-container');
        if (!listContainer) return;

        if (teams.length === 0) {
            listContainer.innerHTML = '<p class="empty-state" style="padding:20px;">No teams found.</p>';
            return;
        }

        var html = '';
        html += '<div class="list-header team-header" style="display:grid;grid-template-columns:1.2fr 0.8fr 0.6fr 0.6fr 1fr;gap:8px;padding:8px 12px;background:var(--panel-alt);border-radius:6px 6px 0 0;border:1px solid var(--border);border-bottom:none;font-weight:600;font-size:0.7rem;color:var(--text-dim);">';
        html += '<span>Team Name</span>';
        html += '<span>Type</span>';
        html += '<span>Period</span>';
        html += '<span>Status</span>';
        html += '<span>Members</span>';
        html += '</div>';

        teams.forEach(function(team) {
            var memberCount = team.members ? team.members.length : 0;
            var typeLabel = team.type || 'unknown';
            var periodDisplay = team.startPeriod || '-';
            if (team.endPeriod) periodDisplay += ' → ' + team.endPeriod;
            var statusColor = team.status === 'active' ? 'var(--accent)' : 'var(--text-dim)';
            var isInactive = team.status === 'deprecated' || team.status === 'inactive';
            var style = isInactive ? 'opacity:0.6;background:var(--panel-alt);' : '';

            html += '<div class="list-item" style="display:grid;grid-template-columns:1.2fr 0.8fr 0.6fr 0.6fr 1fr;gap:8px;padding:8px 12px;background:var(--panel);border:1px solid var(--border);border-top:none;' + style + '">';
            html += '<span><strong>' + team.name + '</strong></span>';
            html += '<span style="font-size:0.75rem;">' + typeLabel + '</span>';
            html += '<span style="font-size:0.75rem;">' + periodDisplay + '</span>';
            html += '<span style="font-size:0.75rem;color:' + statusColor + ';">' + (team.status || 'active') + '</span>';
            html += '<span style="font-size:0.75rem;">' + memberCount + '</span>';
            html += '</div>';
        });

        listContainer.innerHTML = html;
    }

    function initTeamManagerEvents(container) {
        // Tab switching
        var tabNav = container.querySelector('.tab-nav');
        if (tabNav) {
            tabNav.addEventListener('click', function(e) {
                var btn = e.target.closest('.tab-btn');
                if (!btn) return;

                var tab = btn.dataset.tab;
                var allTeams = window.data.teams || [];
                var filteredTeams = [];

                if (tab === 'all') {
                    filteredTeams = allTeams;
                } else if (tab === 'academic') {
                    filteredTeams = allTeams.filter(function(t) { return t.type === 'academic'; });
                } else if (tab === 'professional') {
                    filteredTeams = allTeams.filter(function(t) { return t.type === 'professional'; });
                } else if (tab === 'temporary') {
                    filteredTeams = allTeams.filter(function(t) { return t.type === 'temporary' || t.type === 'internship'; });
                } else if (tab === 'civilian') {
                    filteredTeams = allTeams.filter(function(t) { return t.type === 'civilian'; });
                }

                // Update tab buttons
                tabNav.querySelectorAll('.tab-btn').forEach(function(b) {
                    b.classList.remove('active');
                    b.style.color = 'var(--text-dim)';
                    b.style.borderBottomColor = 'transparent';
                });
                btn.classList.add('active');
                btn.style.color = 'var(--accent)';
                btn.style.borderBottomColor = 'var(--accent)';

                renderTeamList(filteredTeams, container);
            });
        }

        // Add team button
        var addBtn = container.querySelector('#add-team-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() {
                showTeamForm(container);
            });
        }
    }

    function showTeamForm(container) {
        // Simple form for now
        var name = prompt('Enter team name:');
        if (!name) return;

        var type = prompt('Enter team type (academic, professional, temporary, civilian):', 'academic');
        if (!type) return;

        var data = window.data || {};
        if (!data.teams) data.teams = [];

        var newTeam = {
            id: window.generateId('team'),
            name: name,
            type: type,
            startPeriod: '',
            endPeriod: '',
            currentRank: '',
            status: 'active',
            classId: null,
            teamNumber: '',
            temporaryMission: null,
            members: [],
            rankingHistory: [],
            createdAt: new Date().toISOString()
        };
        data.teams.push(newTeam);

        if (typeof window.saveData === 'function') {
            window.saveData().catch(function(err) { /* ignore */ });
        }

        // Re-render
        if (container) {
            renderDirect(container);
            initTeamManagerEvents(container);
        }
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

    window.renderTeamManager = renderTeamManager;

})();
