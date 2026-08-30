/**
 * js/modules/teams/team-modals.js - Team Modal Dialogs
 * Path: js/modules/teams/team-modals.js
 * 
 * This module is responsible for:
 *   - Opening/closing modal dialogs
 *   - Populating modal UI (team form, member modal, ranking modal)
 *   - Wiring modal-specific event handlers
 *   - Delegating domain operations to TeamCore, TeamMembers, TeamRankings
 * 
 * IMPORTANT: This module does NOT own data mutations or eligibility logic.
 * All domain operations are delegated to TeamCore.
 * All status/eligibility logic is delegated to TeamMembers.
 * All ranking logic is delegated to TeamRankings.
 * 
 * MUTATION DELEGATION:
 *   - Team mutations → TeamCore.createTeam() / TeamCore.updateTeam() / TeamCore.deleteTeam()
 *   - Member mutations → TeamCore.addMember() / TeamCore.removeMember() / TeamCore.updateMember()
 *   - Ranking mutations → TeamCore.addRanking() / TeamCore.removeRanking()
 * 
 * PERSISTENCE:
 *   - This module does NOT call saveData() directly.
 *   - Callers (team-manager.js) are responsible for persistence.
 *   - TeamCore mutations update window.data immediately.
 * 
 * DEPENDENCIES:
 *   Required:
 *     - window.TeamCore
 *     - window.TeamMembers
 *     - window.TeamRankings
 *   Optional (fallbacks provided):
 *     - window.getClasses
 *     - window.getDisplayName
 *     - window.getCharacterById
 *     - window.getCurrentStatus
 *     - window.NotificationSystem (from notification.js)
 *     - window.CALENDAR_CONSTANTS (from constants.js)
 *     - window.DomUtils (from dom-utils.js)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    // IMPORTANT: Check dependency BEFORE marking as loaded
    if (window.__teamModalsLoaded) {
        return;
    }

    if (!window.TeamCore) {
        console.error('TeamModals: TeamCore is required but not loaded.');
        return;
    }

    if (!window.TeamMembers) {
        console.error('TeamModals: TeamMembers is required but not loaded.');
        return;
    }

    if (!window.TeamRankings) {
        console.error('TeamModals: TeamRankings is required but not loaded.');
        return;
    }

    window.__teamModalsLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var CALENDAR = window.CALENDAR_CONSTANTS || {};
    var MIN_WEEK = CALENDAR.MIN_WEEK || 1;
    var MAX_WEEK = CALENDAR.MAX_WEEK || 52;
    var MIN_YEAR = CALENDAR.MIN_YEAR || 1900;
    var MAX_YEAR = CALENDAR.MAX_YEAR || 2100;

    // ============================================================
    // HTML ESCAPING - Use DomUtils when available
    // ============================================================

    function escapeHtml(value) {
        if (window.DomUtils && typeof window.DomUtils.escapeHtml === 'function') {
            return window.DomUtils.escapeHtml(value);
        }
        // Fallback
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // NOTIFICATION - Use NotificationSystem when available
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';

        if (window.NotificationSystem && typeof window.NotificationSystem.notify === 'function') {
            window.NotificationSystem.notify(message, type);
            return;
        }

        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }

        // Fallback to alert for errors
        if (type === 'error') {
            alert('Error: ' + message);
        } else {
            alert(message);
        }
    }

    // ============================================================
    // STATE HELPERS
    // ============================================================

    function getCurrentPeriod(teamType) {
        var data = window.data || {};
        if (teamType === 'academic') {
            if (window.teamState && window.teamState.filters && window.teamState.filters.academic) {
                return window.teamState.filters.academic.filterWeek || 1;
            }
            return 1;
        }
        return data.currentYear || new Date().getFullYear();
    }

    // ============================================================
    // TEAM FORM MODAL
    // ============================================================

    function showTeamForm(editId) {
        var modal = document.getElementById('team-form-modal');
        if (!modal) {
            console.warn('TeamModals: team-form-modal not found.');
            return;
        }

        var title = document.getElementById('team-form-title');
        var form = document.getElementById('team-form-inner');

        modal.classList.remove('hidden');

        populateClassSelector();
        populateMissionSelector();

        if (editId) {
            title.textContent = 'Edit Team';
            var team = window.TeamCore.getTeam(editId);
            if (team) {
                // Null-safe field population
                setFieldValue('team-name', team.name);
                setFieldValue('team-type', team.type || 'academic');
                setFieldValue('team-start', team.startPeriod);
                setFieldValue('team-end', team.endPeriod);

                // Ranking field is DISPLAY ONLY - disabled by JS
                var rankingInput = document.getElementById('team-ranking');
                if (rankingInput) {
                    var currentRank = window.TeamRankings.getCurrentRank(team);
                    rankingInput.value = currentRank || '';
                    rankingInput.disabled = true;
                }

                setFieldValue('team-status', team.status || 'active');

                var missionSelect = document.getElementById('team-mission');
                if (missionSelect && team.temporaryMission) {
                    missionSelect.value = team.temporaryMission;
                }

                if (team.type === 'academic') {
                    var classSelect = document.getElementById('team-class');
                    if (classSelect && team.classId) {
                        classSelect.value = team.classId;
                    }
                    setFieldValue('team-number', team.teamNumber);
                }

                if (form) form.dataset.editId = editId;

                var container = document.getElementById('name-history-container');
                if (container) {
                    container.innerHTML = '';
                    if (team.nameHistory && team.nameHistory.length > 0) {
                        team.nameHistory.forEach(function(entry) {
                            addNameHistoryEntry(container, entry.name, entry.startPeriod, entry.endPeriod);
                        });
                    } else {
                        addNameHistoryEntry(container);
                    }
                }
            }
        } else {
            title.textContent = 'Add Team';
            if (form) {
                form.reset();
                setFieldValue('team-type', 'academic');
                setFieldValue('team-status', 'active');

                var rankingInput = document.getElementById('team-ranking');
                if (rankingInput) {
                    rankingInput.value = '';
                    rankingInput.disabled = true;
                }

                delete form.dataset.editId;
            }

            var container = document.getElementById('name-history-container');
            if (container) {
                container.innerHTML = '';
                addNameHistoryEntry(container);
            }
        }

        updatePeriodLabels();
        var typeSelect = document.getElementById('team-type');
        if (typeSelect) {
            toggleAcademicFields(typeSelect.value);
            toggleMissionField(typeSelect.value);
        }
    }

    function closeTeamForm() {
        var modal = document.getElementById('team-form-modal');
        if (modal) modal.classList.add('hidden');
    }

    // ============================================================
    // TEAM FORM HELPERS
    // ============================================================

    function setFieldValue(id, value) {
        var el = document.getElementById(id);
        if (el) {
            el.value = value !== undefined && value !== null ? String(value) : '';
        }
    }

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
        var sortedMissions = missions.slice().sort(function(a, b) {
            if (a.status === 'active' && b.status !== 'active') return -1;
            if (a.status !== 'active' && b.status === 'active') return 1;
            var titleA = String(a.title || '');
            var titleB = String(b.title || '');
            return titleA.localeCompare(titleB);
        });
        sortedMissions.forEach(function(mission) {
            if (mission.status !== 'cancelled') {
                var option = document.createElement('option');
                option.value = mission.id;
                var title = String(mission.title || 'Untitled');
                option.textContent = title + (mission.status === 'completed' ? ' (completed)' : '');
                select.appendChild(option);
            }
        });
    }

    function toggleAcademicFields(type) {
        var fields = document.getElementById('academic-team-fields');
        if (fields) {
            fields.classList.toggle('hidden', type !== 'academic');
            fields.style.display = (type === 'academic') ? 'block' : 'none';
        }
    }

    function toggleMissionField(type) {
        var field = document.getElementById('temporary-mission-field');
        if (field) {
            field.classList.toggle('hidden', type !== 'temporary' && type !== 'professional');
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
            if (startLabel) startLabel.textContent = 'Start Week (' + MIN_WEEK + '-' + MAX_WEEK + ')';
            if (endLabel) endLabel.textContent = 'End Week (optional)';
            if (startInput) startInput.placeholder = 'Week (e.g., 1)';
            if (endInput) endInput.placeholder = 'Week (e.g., ' + MAX_WEEK + ')';
        } else {
            if (startLabel) startLabel.textContent = 'Start Period (' + MIN_YEAR + '-' + MAX_YEAR + ')';
            if (endLabel) endLabel.textContent = 'End Period (optional)';
            if (startInput) startInput.placeholder = 'Year (e.g., ' + MIN_YEAR + ')';
            if (endInput) endInput.placeholder = 'Year (e.g., ' + MAX_YEAR + ')';
        }

        toggleAcademicFields(type);
        toggleMissionField(type);
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

    // ============================================================
    // MEMBER MODAL - Delegates all eligibility logic to TeamMembers
    // ============================================================

    function showMemberModal(teamId) {
        var modal = document.getElementById('member-modal');
        if (!modal) return;

        var team = window.TeamCore.getTeam(teamId);
        if (!team) return;

        var currentPeriod = getCurrentPeriod(team.type);
        var periodLabel = team.type === 'academic' ? 'Week' : 'Year';

        var titleEl = document.getElementById('modal-team-name');
        if (titleEl) titleEl.textContent = team.name + ' - Members (Full History)';

        var select = document.getElementById('member-character');
        if (select) {
            select.innerHTML = '<option value="">Select character...</option>';

            // Get candidates for the current period (period-aware)
            var candidates = window.TeamMembers.getCandidateCharactersAtPeriod(team.type, currentPeriod);

            candidates.forEach(function(char) {
                if (!char || typeof char !== 'object') return;
                var charId = char.id;

                // Use TeamMembers for all eligibility/status logic
                var eligibility = window.TeamMembers.getEligibilityStatus(
                    team,
                    char,
                    currentPeriod
                );

                var option = document.createElement('option');
                option.value = char.id;

                var displayName = window.getDisplayName ? window.getDisplayName(char) : 'Unknown';
                var currentStatus = window.getCurrentStatus ? window.getCurrentStatus(char) : '';
                option.textContent = displayName + ' [' + currentStatus + '] ' + eligibility.label;

                if (eligibility.style) {
                    option.style.cssText = eligibility.style;
                }

                if (eligibility.disabled) {
                    option.disabled = true;
                }

                select.appendChild(option);
            });
        }

        // Null-safe field clearing
        var roleInput = document.getElementById('member-role');
        if (roleInput) roleInput.value = '';

        var joinInput = document.getElementById('member-join');
        if (joinInput) joinInput.value = '';

        var leaveInput = document.getElementById('member-leave');
        if (leaveInput) leaveInput.value = '';

        var membersContainer = document.getElementById('members-list');
        if (membersContainer) {
            membersContainer.innerHTML = window.TeamMembers.renderList(team, currentPeriod);
        }

        modal.dataset.teamId = teamId;
        modal.classList.remove('hidden');

        attachMemberEvents(teamId);
    }

    function closeMemberModal() {
        var modal = document.getElementById('member-modal');
        if (modal) modal.classList.add('hidden');
    }

    // ============================================================
    // MEMBER MODAL EVENTS
    // ============================================================

    function attachMemberEvents(teamId) {
        var container = document.getElementById('members-list');
        if (!container) return;

        container.removeEventListener('click', handleMemberClick);
        container.addEventListener('click', handleMemberClick);
        container.dataset.teamId = teamId;
    }

    function handleMemberClick(e) {
        var target = e.target.closest('button');
        if (!target) return;

        var container = document.getElementById('members-list');
        var teamId = container ? container.dataset.teamId : null;
        if (!teamId) return;

        if (target.classList.contains('edit-member')) {
            e.stopPropagation();
            var charId = target.dataset.characterId;
            if (charId) {
                showEditMemberModal(teamId, charId);
            }
            return;
        }

        if (target.classList.contains('remove-member')) {
            e.stopPropagation();
            var charId = target.dataset.characterId;
            if (charId && confirm('Remove this member from the team?')) {
                var result = window.TeamCore.removeMember(teamId, charId);
                if (result) {
                    if (typeof window.refreshTeamList === 'function') {
                        window.refreshTeamList();
                    }
                    showMemberModal(teamId);
                } else {
                    showNotification('Failed to remove member.', 'error');
                }
            }
            return;
        }
    }

    // ============================================================
    // EDIT MEMBER MODAL - Uses characterId instead of array index
    // ============================================================

    function showEditMemberModal(teamId, charId) {
        var modal = document.getElementById('edit-member-modal');
        if (!modal) return;

        var team = window.TeamCore.getTeam(teamId);
        if (!team || !team.members) {
            showNotification('Team not found.', 'error');
            return;
        }

        // Find member by characterId (stable identifier)
        var member = team.members.find(function(m) {
            return m && String(m.characterId) === String(charId);
        });

        if (!member) {
            showNotification('Member not found.', 'error');
            return;
        }

        var char = window.getCharacterById ? window.getCharacterById(member.characterId) : null;
        var name = char ? (window.getDisplayName ? window.getDisplayName(char) : 'Unknown') : 'Unknown';

        var nameEl = document.getElementById('edit-member-name');
        if (nameEl) nameEl.textContent = name;

        var roleEl = document.getElementById('edit-member-role');
        if (roleEl) roleEl.value = member.role || '';

        var joinEl = document.getElementById('edit-member-join');
        if (joinEl) joinEl.value = member.joinPeriod || '';

        var leaveEl = document.getElementById('edit-member-leave');
        if (leaveEl) leaveEl.value = member.leavePeriod || '';

        modal.dataset.teamId = teamId;
        modal.dataset.characterId = charId;
        modal.classList.remove('hidden');
    }

    function closeEditMemberModal() {
        var modal = document.getElementById('edit-member-modal');
        if (modal) modal.classList.add('hidden');
    }

    // ============================================================
    // RANKING MODAL - Uses TeamRankings for all ranking operations
    // ============================================================

    function showRankingModal(teamId) {
        var modal = document.getElementById('ranking-modal');
        if (!modal) return;

        var team = window.TeamCore.getTeam(teamId);
        if (!team) return;

        var periodLabel = team.type === 'academic' ? 'Week' : 'Year';
        var titleEl = document.getElementById('ranking-modal-title');
        if (titleEl) titleEl.textContent = team.name + ' - Ranking History';

        var periodInput = document.getElementById('ranking-period');
        if (periodInput) {
            // Set appropriate placeholder based on team type
            if (team.type === 'academic') {
                periodInput.placeholder = 'Week (e.g., 1)';
            } else {
                periodInput.placeholder = 'Year (e.g., ' + new Date().getFullYear() + ')';
            }
            periodInput.value = '';
        }

        var rankInput = document.getElementById('ranking-rank');
        if (rankInput) rankInput.value = '';

        modal.dataset.teamId = teamId;

        var listEl = document.getElementById('ranking-list');
        if (listEl) {
            listEl.innerHTML = window.TeamRankings.renderList(team);
        }

        modal.classList.remove('hidden');

        attachRankingEvents(teamId);
    }

    function closeRankingModal() {
        var modal = document.getElementById('ranking-modal');
        if (modal) modal.classList.add('hidden');
    }

    // ============================================================
    // RANKING MODAL EVENTS
    // ============================================================

    function attachRankingEvents(teamId) {
        var container = document.getElementById('ranking-list');
        if (!container) return;

        container.removeEventListener('click', handleRankingClick);
        container.addEventListener('click', handleRankingClick);
        container.dataset.teamId = teamId;
    }

    function handleRankingClick(e) {
        var target = e.target.closest('button');
        if (!target) return;

        var container = document.getElementById('ranking-list');
        var teamId = container ? container.dataset.teamId : null;
        if (!teamId) return;

        if (target.classList.contains('remove-ranking')) {
            e.stopPropagation();
            var period = target.dataset.period;
            if (period && confirm('Remove this ranking entry?')) {
                var result = window.TeamCore.removeRanking(teamId, period);
                if (result) {
                    if (typeof window.refreshTeamList === 'function') {
                        window.refreshTeamList();
                    }
                    showRankingModal(teamId);
                } else {
                    showNotification('Failed to remove ranking.', 'error');
                }
            }
        }
    }

    // ============================================================
    // ADD RANKING HANDLER
    // ============================================================

    function addRanking(e) {
        if (e && e.preventDefault) {
            e.preventDefault();
        }

        var modal = document.getElementById('ranking-modal');
        if (!modal) {
            showNotification('Ranking modal not found.', 'error');
            return;
        }

        var teamId = modal.dataset.teamId;
        if (!teamId) {
            showNotification('No team selected.', 'error');
            return;
        }

        var periodInput = document.getElementById('ranking-period');
        var rankInput = document.getElementById('ranking-rank');

        var period = periodInput ? periodInput.value.trim() : '';
        var rank = rankInput ? parseInt(rankInput.value, 10) : null;

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

        // Clear form fields
        if (periodInput) periodInput.value = '';
        if (rankInput) rankInput.value = '';

        // Refresh UI
        var team = window.TeamCore.getTeam(teamId);
        if (team) {
            var listEl = document.getElementById('ranking-list');
            if (listEl) {
                listEl.innerHTML = window.TeamRankings.renderList(team);
            }
        }

        if (typeof window.refreshTeamList === 'function') {
            window.refreshTeamList();
        }

        showNotification('Ranking added successfully!', 'success');
    }

    // ============================================================
    // ADD MEMBER HANDLER
    // ============================================================

    function addMember() {
        var modal = document.getElementById('member-modal');
        if (!modal) {
            showNotification('Member modal not found.', 'error');
            return;
        }

        var teamId = modal.dataset.teamId;
        if (!teamId) {
            showNotification('No team selected.', 'error');
            return;
        }

        var charSelect = document.getElementById('member-character');
        var roleInput = document.getElementById('member-role');
        var joinInput = document.getElementById('member-join');
        var leaveInput = document.getElementById('member-leave');

        var charId = charSelect ? charSelect.value : '';
        var role = roleInput ? roleInput.value.trim() : '';
        var joinPeriod = joinInput ? joinInput.value : '';
        var leavePeriod = leaveInput ? leaveInput.value : '';

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

        // Refresh UI
        var team = window.TeamCore.getTeam(teamId);
        if (team) {
            var membersContainer = document.getElementById('members-list');
            if (membersContainer) {
                var currentPeriod = getCurrentPeriod(team.type);
                membersContainer.innerHTML = window.TeamMembers.renderList(team, currentPeriod);
            }
        }

        // Clear form fields
        if (charSelect) charSelect.value = '';
        if (roleInput) roleInput.value = '';
        if (joinInput) joinInput.value = '';
        if (leaveInput) leaveInput.value = '';

        // Refresh character select
        populateMemberCharacterSelect(teamId);

        if (typeof window.refreshTeamList === 'function') {
            window.refreshTeamList();
        }

        showNotification('Member added successfully!', 'success');
    }

    // ============================================================
    // SAVE EDIT MEMBER HANDLER
    // ============================================================

    function saveEditMember(e) {
        e.preventDefault();

        var modal = document.getElementById('edit-member-modal');
        if (!modal) {
            showNotification('Edit member modal not found.', 'error');
            return;
        }

        var teamId = modal.dataset.teamId;
        var charId = modal.dataset.characterId;

        if (!teamId || !charId) {
            showNotification('No member selected.', 'error');
            return;
        }

        var roleInput = document.getElementById('edit-member-role');
        var joinInput = document.getElementById('edit-member-join');
        var leaveInput = document.getElementById('edit-member-leave');

        var role = roleInput ? roleInput.value.trim() : '';
        var joinPeriod = joinInput ? joinInput.value : '';
        var leavePeriod = leaveInput ? leaveInput.value : '';

        var result = window.TeamCore.updateMember(teamId, charId, {
            role: role,
            joinPeriod: joinPeriod,
            leavePeriod: leavePeriod
        });

        if (!result) {
            showNotification('Failed to update member.', 'error');
            return;
        }

        // Refresh UI
        var team = window.TeamCore.getTeam(teamId);
        if (team) {
            var membersContainer = document.getElementById('members-list');
            if (membersContainer) {
                var currentPeriod = getCurrentPeriod(team.type);
                membersContainer.innerHTML = window.TeamMembers.renderList(team, currentPeriod);
            }
        }

        // Close modal
        modal.classList.add('hidden');

        if (typeof window.refreshTeamList === 'function') {
            window.refreshTeamList();
        }

        showNotification('Member updated successfully!', 'success');
    }

    // ============================================================
    // POPULATE MEMBER CHARACTER SELECT
    // ============================================================

    function populateMemberCharacterSelect(teamId) {
        var select = document.getElementById('member-character');
        if (!select) return;

        var team = window.TeamCore.getTeam(teamId);
        if (!team) return;

        var currentPeriod = getCurrentPeriod(team.type);

        select.innerHTML = '<option value="">Select character...</option>';

        // Use period-aware candidate selection
        var candidates = window.TeamMembers.getCandidateCharactersAtPeriod(team.type, currentPeriod);

        var currentMemberIds = (team.members || []).map(function(m) {
            return m ? String(m.characterId) : null;
        }).filter(function(id) { return id; });

        candidates.forEach(function(char) {
            if (!char || typeof char !== 'object') return;

            var isInTeam = currentMemberIds.some(function(id) {
                return String(id) === String(char.id);
            });

            var eligibility = window.TeamMembers.getEligibilityStatus(
                team,
                char,
                currentPeriod
            );

            var option = document.createElement('option');
            option.value = char.id;

            var displayName = window.getDisplayName ? window.getDisplayName(char) : 'Unknown';
            var currentStatus = window.getCurrentStatus ? window.getCurrentStatus(char) : '';
            option.textContent = displayName + ' [' + currentStatus + '] ' + eligibility.label;

            if (eligibility.style) {
                option.style.cssText = eligibility.style;
            }

            if (eligibility.disabled || isInTeam) {
                option.disabled = true;
                if (isInTeam) {
                    option.textContent += ' ✓ In Team';
                }
            }

            select.appendChild(option);
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamModals = {
        // Team form
        showTeamForm: showTeamForm,
        closeTeamForm: closeTeamForm,

        // Member modal
        showMemberModal: showMemberModal,
        closeMemberModal: closeMemberModal,

        // Edit member modal
        showEditMemberModal: showEditMemberModal,
        closeEditMemberModal: closeEditMemberModal,

        // Ranking modal
        showRankingModal: showRankingModal,
        closeRankingModal: closeRankingModal,

        // Add handlers
        addRanking: addRanking,
        addMember: addMember,
        saveEditMember: saveEditMember,

        // Helpers (exposed for team-manager.js)
        populateMemberCharacterSelect: populateMemberCharacterSelect,
        populateClassSelector: populateClassSelector,
        populateMissionSelector: populateMissionSelector,
        toggleAcademicFields: toggleAcademicFields,
        toggleMissionField: toggleMissionField,
        updatePeriodLabels: updatePeriodLabels,
        addNameHistoryEntry: addNameHistoryEntry
    };

})();
