/**
 * js/modules/teams/team-manager.js - Team Manager Main
 * Orchestrates all team management functionality
 * Path: js/modules/teams/team-manager.js
 */

(function() {
    'use strict';

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

    // Expose state globally for other modules
    window.teamState = teamState;

    // ============================================================
    // MAIN RENDER FUNCTION
    // ============================================================

    function renderTeamManager(container) {
        console.log('renderTeamManager called');

        if (!container) {
            container = document.getElementById('tab-teams');
        }
        if (!container) {
            console.error('Teams container not found');
            return;
        }

        if (!window.data) {
            console.warn('No data available for teams');
            container.innerHTML = '<p class="empty-state">Loading data...</p>';
            return;
        }

        if (!window.data.teams) {
            window.data.teams = [];
        }
        if (!window.data.classes) {
            window.data.classes = [];
        }

        // Only render if container is empty or we're forcing a refresh
        if (!container.dataset.initialized || container.dataset.forceRefresh) {
            container.innerHTML = window.TeamRender.renderContainer(teamState.currentTab);
            container.dataset.initialized = 'true';
            delete container.dataset.forceRefresh;
        }

        renderTeamTab(teamState.currentTab);
        initTeamManagerEvents();
    }

    // ============================================================
    // TAB RENDERING
    // ============================================================

    function renderTeamTab(tab) {
        var container = document.getElementById(tab + '-content');
        if (!container) {
            console.warn('Container not found for tab:', tab);
            return;
        }

        var filter = teamState.filters[tab] || window.TeamFilters.getDefaultFilter(tab);
        var filteredTeams = window.TeamFilters.filterTeams(tab, filter);

        var data = window.data || {};
        var filterPeriod = tab === 'academic' 
            ? (filter.filterWeek || 1) 
            : (data.currentYear || new Date().getFullYear());

        // Build filter HTML
        var classes = window.getClasses();
        var filterHtml = window.TeamFilters.buildFilterHTML(tab, filter, classes);

        // Build teams list
        var teamsHtml = window.TeamRender.renderList(
            filteredTeams, 
            tab, 
            filterPeriod, 
            teamState.expandedTeamId
        );

        container.innerHTML = filterHtml + teamsHtml;

        // Attach events after DOM update
        setTimeout(function() {
            attachFilterEvents(tab);
            attachTeamActionEvents(tab);
        }, 50);
    }

    // ============================================================
    // EVENT ATTACHMENT
    // ============================================================

    function attachFilterEvents(tab) {
        var container = document.getElementById(tab + '-content');
        if (!container) return;

        var applyBtn = container.querySelector('#apply-filter-btn');
        if (applyBtn) {
            applyBtn.addEventListener('click', function() {
                if (tab === 'academic') {
                    var week = parseInt(container.querySelector('#team-filter-week').value);
                    var classFilter = container.querySelector('#team-class-filter') 
                        ? container.querySelector('#team-class-filter').value 
                        : 'all';
                    if (!isNaN(week) && week > 0 && week <= 52) {
                        teamState.filters.academic.filterWeek = week;
                        teamState.filters.academic.filterClass = classFilter;
                        renderTeamTab(tab);
                    } else {
                        alert('Please enter a valid week (1-52).');
                    }
                } else if (tab === 'professional' || tab === 'temporary') {
                    var year = container.querySelector('#team-filter-year').value;
                    if (year === '' || !isNaN(parseInt(year))) {
                        teamState.filters[tab].filterYear = year;
                        renderTeamTab(tab);
                    } else {
                        alert('Please enter a valid year.');
                    }
                }
            });
        }

        var classFilter = container.querySelector('#team-class-filter');
        if (classFilter) {
            classFilter.addEventListener('change', function() {
                if (tab === 'academic') {
                    teamState.filters.academic.filterClass = this.value;
                    renderTeamTab(tab);
                }
            });
        }

        var inactiveCheck = container.querySelector('#' + tab + '-show-inactive');
        if (inactiveCheck) {
            inactiveCheck.addEventListener('change', function() {
                teamState.filters[tab].filterStatus = this.checked ? 'inactive' : 'active';
                renderTeamTab(tab);
            });
        }
    }

    function attachTeamActionEvents(tab) {
        var container = document.getElementById(tab + '-content');
        if (!container) return;

        container.querySelectorAll('.toggle-members, .manage-members, .manage-rankings, .edit-team, .delete-team').forEach(function(btn) {
            var newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);

            newBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                var id = this.dataset.id;
                if (!id) return;

                if (this.classList.contains('toggle-members')) {
                    teamState.expandedTeamId = (teamState.expandedTeamId === id) ? null : id;
                    renderTeamTab(tab);
                } else if (this.classList.contains('manage-members')) {
                    window.TeamModals.showMemberModal(id, tab);
                } else if (this.classList.contains('manage-rankings')) {
                    window.TeamModals.showRankingModal(id, tab);
                } else if (this.classList.contains('edit-team')) {
                    window.TeamModals.showTeamForm(id, tab);
                } else if (this.classList.contains('delete-team')) {
                    if (confirm('Delete this team permanently?')) {
                        window.TeamCore.deleteTeam(id);
                        renderTeamTab(tab);
                        if (typeof window.updateDashboardStats === 'function') {
                            window.updateDashboardStats();
                        }
                    }
                }
            });
        });
    }

    // ============================================================
    // TEAM FORM SAVE HANDLER
    // ============================================================

    function saveTeam(e) {
        e.preventDefault();
        var form = e.target;
        var editId = form.dataset.editId;
        var tab = form.dataset.tab || 'academic';

        // Collect name history
        var nameHistory = [];
        document.querySelectorAll('.name-history-entry').forEach(function(entry) {
            var nameInput = entry.querySelector('.name-history-name');
            var startInput = entry.querySelector('.name-history-start');
            var endInput = entry.querySelector('.name-history-end');
            if (nameInput.value.trim()) {
                nameHistory.push({
                    name: nameInput.value.trim(),
                    startPeriod: startInput.value || '',
                    endPeriod: endInput.value || ''
                });
            }
        });

        var teamData = {
            name: document.getElementById('team-name').value.trim(),
            type: document.getElementById('team-type').value,
            startPeriod: document.getElementById('team-start').value || '',
            endPeriod: document.getElementById('team-end').value || '',
            currentRank: document.getElementById('team-ranking').value || '',
            status: document.getElementById('team-status').value || 'active',
            nameHistory: nameHistory,
            temporaryMission: document.getElementById('team-mission').value || null,
            classId: document.getElementById('team-class').value || null,
            teamNumber: document.getElementById('team-number').value.trim() || ''
        };

        if (teamData.type !== 'academic') {
            teamData.classId = null;
            teamData.teamNumber = '';
        }

        if (!teamData.name) {
            alert('Team name is required.');
            return;
        }
        if (!teamData.type) {
            alert('Team type is required.');
            return;
        }

        var result;
        if (editId) {
            result = window.TeamCore.updateTeam(editId, teamData);
        } else {
            result = window.TeamCore.createTeam(teamData);
        }

        if (result) {
            window.TeamModals.closeTeamForm();
            renderTeamTab(tab);
            if (typeof window.updateDashboardStats === 'function') {
                window.updateDashboardStats();
            }
        }
    }

    // ============================================================
    // ADD MEMBER HANDLER
    // ============================================================

    function addMember() {
        var modal = document.getElementById('member-modal');
        var teamId = modal.dataset.teamId;
        var tab = modal.dataset.tab || 'academic';
        if (!teamId) return;

        var charId = document.getElementById('member-character').value;
        var role = document.getElementById('member-role').value.trim();
        var joinPeriod = document.getElementById('member-join').value;
        var leavePeriod = document.getElementById('member-leave').value;

        if (!charId) {
            alert('Please select a character.');
            return;
        }

        var team = window.TeamCore.getTeam(teamId);
        if (!team) return;

        if (team.members && team.members.some(function(m) { return String(m.characterId) === String(charId); })) {
            alert('This character is already in the team.');
            return;
        }

        var result = window.TeamMembers.addMember(teamId, charId, role || 'Member', joinPeriod || '', leavePeriod || '');
        if (result) {
            window.TeamModals.showMemberModal(teamId, tab);
            renderTeamTab(tab);
        }
    }

    // ============================================================
    // SAVE EDIT MEMBER HANDLER
    // ============================================================

    function saveEditMember(e) {
        e.preventDefault();
        var modal = document.getElementById('edit-member-modal');
        var teamId = modal.dataset.teamId;
        var index = parseInt(modal.dataset.index);
        var tab = modal.dataset.tab || 'academic';

        var team = window.TeamCore.getTeam(teamId);
        if (!team || !team.members || !team.members[index]) return;

        var member = team.members[index];
        var charId = member.characterId;

        var updates = {
            role: document.getElementById('edit-member-role').value.trim() || 'Member',
            joinPeriod: document.getElementById('edit-member-join').value || '',
            leavePeriod: document.getElementById('edit-member-leave').value || ''
        };

        var result = window.TeamMembers.updateMember(teamId, charId, updates);
        if (result) {
            window.TeamModals.closeEditMemberModal();
            window.TeamModals.showMemberModal(teamId, tab);
            renderTeamTab(tab);
        }
    }

    // ============================================================
    // ADD RANKING HANDLER
    // ============================================================

    function addRanking() {
        var modal = document.getElementById('ranking-modal');
        var teamId = modal.dataset.teamId;
        var tab = modal.dataset.tab || 'academic';
        if (!teamId) return;

        var period = document.getElementById('ranking-week').value;
        var rank = document.getElementById('ranking-rank').value;

        if (!period) {
            alert('Please enter a period.');
            return;
        }
        if (!rank) {
            alert('Please enter a rank.');
            return;
        }

        var result = window.TeamRankings.addRanking(teamId, period, rank);
        if (result) {
            window.TeamModals.showRankingModal(teamId, tab);
            renderTeamTab(tab);
            document.getElementById('ranking-week').value = '';
            document.getElementById('ranking-rank').value = '';
        }
    }

    // ============================================================
    // INIT EVENT BINDING
    // ============================================================

    function initTeamManagerEvents() {
        // Tab switching
        var tabNav = document.getElementById('team-tab-nav');
        if (tabNav) {
            tabNav.addEventListener('click', function(e) {
                var btn = e.target.closest('.tab-btn');
                if (!btn) return;

                var tab = btn.dataset.tab;
                teamState.currentTab = tab;

                document.querySelectorAll('#team-tab-nav .tab-btn').forEach(function(b) {
                    b.classList.remove('active');
                });
                btn.classList.add('active');

                document.querySelectorAll('#team-tab-content .tab-panel').forEach(function(p) {
                    p.style.display = 'none';
                    p.classList.remove('active');
                });

                var panel = document.getElementById('tab-' + tab);
                if (panel) {
                    panel.style.display = 'block';
                    panel.classList.add('active');
                }

                renderTeamTab(tab);
            });
        }

        // Add team button
        var addBtn = document.getElementById('add-team-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() {
                window.TeamModals.showTeamForm(null, teamState.currentTab || 'academic');
            });
        }

        // Form modals
        var form = document.getElementById('team-form-inner');
        if (form) {
            form.addEventListener('submit', saveTeam);
        }

        var closeFormBtn = document.getElementById('close-team-form');
        if (closeFormBtn) {
            closeFormBtn.addEventListener('click', window.TeamModals.closeTeamForm);
        }

        var cancelFormBtn = document.getElementById('cancel-team-form');
        if (cancelFormBtn) {
            cancelFormBtn.addEventListener('click', window.TeamModals.closeTeamForm);
        }

        var formModal = document.getElementById('team-form-modal');
        if (formModal) {
            formModal.addEventListener('click', function(e) {
                if (e.target === this) window.TeamModals.closeTeamForm();
            });
        }

        // Type select change
        var typeSelect = document.getElementById('team-type');
        if (typeSelect) {
            typeSelect.addEventListener('change', window.TeamModals.updatePeriodLabels);
        }

        // Add name history
        var addNameBtn = document.getElementById('add-name-history-btn');
        if (addNameBtn) {
            addNameBtn.addEventListener('click', function() {
                var container = document.getElementById('name-history-container');
                window.TeamModals.addNameHistoryEntry(container);
            });
        }

        // Member modal
        var memberClose = document.querySelector('#member-modal .close-modal');
        if (memberClose) {
            memberClose.addEventListener('click', window.TeamModals.closeMemberModal);
        }

        var memberBg = document.getElementById('member-modal');
        if (memberBg) {
            memberBg.addEventListener('click', function(e) {
                if (e.target === this) window.TeamModals.closeMemberModal();
            });
        }

        var addMemberBtn = document.getElementById('add-member-btn');
        if (addMemberBtn) {
            addMemberBtn.addEventListener('click', addMember);
        }

        // Edit member
        var editClose = document.querySelector('#edit-member-modal .close-modal');
        if (editClose) {
            editClose.addEventListener('click', window.TeamModals.closeEditMemberModal);
        }

        var editBg = document.getElementById('edit-member-modal');
        if (editBg) {
            editBg.addEventListener('click', function(e) {
                if (e.target === this) window.TeamModals.closeEditMemberModal();
            });
        }

        var cancelEdit = document.getElementById('cancel-edit-member');
        if (cancelEdit) {
            cancelEdit.addEventListener('click', window.TeamModals.closeEditMemberModal);
        }

        var editForm = document.getElementById('edit-member-form');
        if (editForm) {
            editForm.addEventListener('submit', saveEditMember);
        }

        // Ranking modal
        var rankClose = document.querySelector('#ranking-modal .close-modal');
        if (rankClose) {
            rankClose.addEventListener('click', window.TeamModals.closeRankingModal);
        }

        var rankBg = document.getElementById('ranking-modal');
        if (rankBg) {
            rankBg.addEventListener('click', function(e) {
                if (e.target === this) window.TeamModals.closeRankingModal();
            });
        }

        var addRankBtn = document.getElementById('add-ranking-btn');
        if (addRankBtn) {
            addRankBtn.addEventListener('click', addRanking);
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
                container.dataset.forceRefresh = 'true';
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

    // Expose functions
    window.renderTeamManager = renderTeamManager;
    window.renderTeamTab = renderTeamTab;


})();
