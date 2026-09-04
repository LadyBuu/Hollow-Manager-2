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
 *   - Team mutations -> TeamCore.createTeam() / TeamCore.updateTeam() / TeamCore.deleteTeam()
 *   - Member mutations -> TeamCore.addMember() / TeamCore.removeMember() / TeamCore.updateMember()
 *   - Ranking mutations -> TeamCore.addRanking() / TeamCore.removeRanking()
 * 
 * PERSISTENCE:
 *   - This module does NOT call saveData() directly.
 *   - Callers (team-manager.js) are responsible for persistence.
 *   - TeamCore mutations update window.data immediately.
 * 
 * ELIGIBILITY BOUNDARY:
 *   - TeamMembers is the SINGLE AUTHORITY for eligibility status.
 *   - This module consumes TeamMembers.getEligibilityStatus() and does not
 *     re-implement eligibility rules.
 * 
 * DEPENDENCIES:
 *   Required:
 *     - window.TeamCore
 *     - window.TeamQueries
 *     - window.TeamMembers
 *     - window.TeamRankings
 *     - window.CharacterQueries
 *     - window.ClassesQueries
 *     - window.NotificationSystem
 *     - window.CALENDAR_CONSTANTS
 *     - window.ValidationUtils
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__teamModalsLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK - NO FALLBACKS
    // ============================================================

    if (!window.TeamCore) {
        return;
    }
    if (!window.TeamQueries) {
        return;
    }
    if (!window.TeamMembers) {
        return;
    }
    if (!window.TeamRankings) {
        return;
    }
    if (!window.CharacterQueries) {
        return;
    }
    if (!window.ClassesQueries) {
        return;
    }
    if (!window.NotificationSystem) {
        return;
    }
    if (!window.CALENDAR_CONSTANTS) {
        return;
    }
    if (!window.ValidationUtils) {
        return;
    }

    window.__teamModalsLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var TeamCore = window.TeamCore;
    var TeamQueries = window.TeamQueries;
    var TeamMembers = window.TeamMembers;
    var TeamRankings = window.TeamRankings;
    var CharacterQueries = window.CharacterQueries;
    var ClassesQueries = window.ClassesQueries;
    var NotificationSystem = window.NotificationSystem;
    var CALENDAR = window.CALENDAR_CONSTANTS;
    var ValidationUtils = window.ValidationUtils;

    // ============================================================
    // CONSTANTS - Use type-safe defaults from CALENDAR
    // ============================================================

    var MIN_WEEK = CALENDAR.MIN_WEEK;
    var MAX_WEEK = CALENDAR.MAX_WEEK;
    var MIN_YEAR = CALENDAR.MIN_YEAR;
    var MAX_YEAR = CALENDAR.MAX_YEAR;

    // ============================================================
    // NOTIFICATION - Uses NotificationSystem
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // PERIOD PARSING - Delegate to ValidationUtils
    // ============================================================

    function parseNumericPeriod(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var str = String(value).trim();
        if (!/^\d+$/.test(str)) {
            return null;
        }
        var parsed = Number(str);
        return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
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
            return data.currentWeek || 1;
        }
        return data.currentYear || MIN_YEAR;
    }

    // ============================================================
    // UI REFRESH HELPERS
    // ============================================================

    function refreshMemberList(teamId) {
        var team = TeamCore.getTeam(teamId);
        if (!team) {
            return;
        }

        var container = document.getElementById('members-list');
        if (!container) {
            return;
        }

        var currentPeriod = getCurrentPeriod(team.type);
        // TODO: Use TeamMemberViews.renderList when available
        // For now, delegate to TeamMembers
        var membersHtml = TeamMembers.renderList ? TeamMembers.renderList(team, currentPeriod) : '';
        container.innerHTML = membersHtml;
    }

    function refreshRankingList(teamId) {
        var team = TeamCore.getTeam(teamId);
        if (!team) {
            return;
        }

        var listEl = document.getElementById('ranking-list');
        if (listEl) {
            listEl.innerHTML = TeamRankings.renderList(team);
        }
    }

    function refreshAllMemberUI(teamId) {
        refreshMemberList(teamId);
        if (typeof window.refreshTeamList === 'function') {
            window.refreshTeamList();
        }
    }

    function refreshAllRankingUI(teamId) {
        refreshRankingList(teamId);
        if (typeof window.refreshTeamList === 'function') {
            window.refreshTeamList();
        }
    }

    // ============================================================
    // TEAM FORM MODAL
    // ============================================================

    function showTeamForm(editId) {
        var modal = document.getElementById('team-form-modal');
        if (!modal) {
            return;
        }

        var title = document.getElementById('team-form-title');
        var form = document.getElementById('team-form-inner');

        modal.classList.remove('hidden');

        populateClassSelector();
        populateMissionSelector();

        if (editId) {
            title.textContent = 'Edit Team';
            var team = TeamCore.getTeam(editId);
            if (team) {
                setFieldValue('team-name', team.name);
                setFieldValue('team-type', team.type || 'academic');
                setFieldValue('team-start', team.startPeriod);
                setFieldValue('team-end', team.endPeriod);

                var rankingInput = document.getElementById('team-ranking');
                if (rankingInput) {
                    var currentRank = TeamQueries.getTeamCurrentRank(team);
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

                if (form) {
                    form.dataset.editId = editId;
                }

                var container = document.getElementById('name-history-container');
                if (container) {
                    container.innerHTML = '';
                    if (team.nameHistory && team.nameHistory.length > 0) {
                        for (var i = 0; i < team.nameHistory.length; i++) {
                            var entry = team.nameHistory[i];
                            addNameHistoryEntry(container, entry.name, entry.startPeriod, entry.endPeriod);
                        }
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

                var rankingInput2 = document.getElementById('team-ranking');
                if (rankingInput2) {
                    rankingInput2.value = '';
                    rankingInput2.disabled = true;
                }

                delete form.dataset.editId;
            }

            var container2 = document.getElementById('name-history-container');
            if (container2) {
                container2.innerHTML = '';
                addNameHistoryEntry(container2);
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
        if (modal) {
            modal.classList.add('hidden');
        }
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
        if (!select) {
            return;
        }

        var classes = ClassesQueries.getClasses();
        var currentValue = select.value;
        select.innerHTML = '<option value="">Unassigned</option>';
        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.name;
            select.appendChild(option);
        }
        if (currentValue) {
            select.value = currentValue;
        }
    }

    function populateMissionSelector() {
        var select = document.getElementById('team-mission');
        if (!select) {
            return;
        }

        var data = window.data || {};
        var missions = data.missions || [];
        select.innerHTML = '<option value="">None</option>';

        var sortedMissions = missions.slice().sort(function(a, b) {
            if (a.status === 'active' && b.status !== 'active') {
                return -1;
            }
            if (a.status !== 'active' && b.status === 'active') {
                return 1;
            }
            var titleA = String(a.title || '');
            var titleB = String(b.title || '');
            return titleA.localeCompare(titleB);
        });

        for (var i = 0; i < sortedMissions.length; i++) {
            var mission = sortedMissions[i];
            if (mission.status !== 'cancelled') {
                var option = document.createElement('option');
                option.value = mission.id;
                var title = String(mission.title || 'Untitled');
                option.textContent = title + (mission.status === 'completed' ? ' (completed)' : '');
                select.appendChild(option);
            }
        }
    }

    function toggleAcademicFields(type) {
        var fields = document.getElementById('academic-team-fields');
        if (fields) {
            fields.style.display = (type === 'academic') ? 'block' : 'none';
        }
    }

    function toggleMissionField(type) {
        var field = document.getElementById('temporary-mission-field');
        if (field) {
            field.style.display = (type === 'temporary' || type === 'professional') ? 'block' : 'none';
        }
    }

    function updatePeriodLabels() {
        var typeSelect = document.getElementById('team-type');
        if (!typeSelect) {
            return;
        }

        var type = typeSelect.value;
        var startLabel = document.getElementById('team-start-label');
        var endLabel = document.getElementById('team-end-label');
        var startInput = document.getElementById('team-start');
        var endInput = document.getElementById('team-end');

        if (type === 'academic') {
            if (startLabel) {
                startLabel.textContent = 'Start Week (' + MIN_WEEK + '-' + MAX_WEEK + ')';
            }
            if (endLabel) {
                endLabel.textContent = 'End Week (optional)';
            }
            if (startInput) {
                startInput.placeholder = 'Week (e.g., 1)';
            }
            if (endInput) {
                endInput.placeholder = 'Week (e.g., ' + MAX_WEEK + ')';
            }
        } else {
            if (startLabel) {
                startLabel.textContent = 'Start Period (' + MIN_YEAR + '-' + MAX_YEAR + ')';
            }
            if (endLabel) {
                endLabel.textContent = 'End Period (optional)';
            }
            if (startInput) {
                startInput.placeholder = 'Year (e.g., ' + MIN_YEAR + ')';
            }
            if (endInput) {
                endInput.placeholder = 'Year (e.g., ' + MAX_YEAR + ')';
            }
        }

        toggleAcademicFields(type);
        toggleMissionField(type);
    }

    function addNameHistoryEntry(container, name, start, end) {
        if (!container) {
            return;
        }

        var entry = document.createElement('div');
        entry.className = 'name-history-entry';
        entry.style.cssText = 'display:flex;gap:6px;margin-bottom:4px;flex-wrap:wrap;align-items:center;';

        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'name-history-name';
        nameInput.placeholder = 'Team Name';
        nameInput.value = name || '';
        nameInput.style.cssText = 'flex:1;min-width:80px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;';

        var startInput = document.createElement('input');
        startInput.type = 'text';
        startInput.className = 'name-history-start';
        startInput.placeholder = 'Start';
        startInput.value = start || '';
        startInput.style.cssText = 'flex:1;min-width:60px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;';

        var endInput = document.createElement('input');
        endInput.type = 'text';
        endInput.className = 'name-history-end';
        endInput.placeholder = 'End';
        endInput.value = end || '';
        endInput.style.cssText = 'flex:1;min-width:60px;padding:4px 6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;';

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'small danger remove-name';
        removeBtn.style.cssText = 'padding:2px 6px;font-size:0.6rem;';
        removeBtn.textContent = 'x';

        entry.appendChild(nameInput);
        entry.appendChild(startInput);
        entry.appendChild(endInput);
        entry.appendChild(removeBtn);

        container.appendChild(entry);

        removeBtn.onclick = function() {
            if (container.children.length > 1) {
                entry.remove();
            } else {
                showNotification('You need at least one name entry.', 'error');
            }
        };
    }

    // ============================================================
    // POPULATE CHARACTER SELECT - Uses TeamMembers for eligibility
    // ============================================================

    function populateCharacterSelect(select, team, currentPeriod) {
        if (!select || !team) {
            return;
        }

        select.innerHTML = '<option value="">Select character...</option>';

        var candidates = TeamMembers.getCandidateCharactersAtPeriod(team.type, currentPeriod);

        for (var i = 0; i < candidates.length; i++) {
            var character = candidates[i];
            if (!character || typeof character !== 'object') {
                continue;
            }

            var eligibility = TeamMembers.getEligibilityStatus(
                team,
                character,
                currentPeriod
            );

            var option = document.createElement('option');
            option.value = character.id;

            var displayName = CharacterQueries.getDisplayName(character);
            var currentStatus = CharacterQueries.getCurrentStatus(character);

            var label = displayName + ' [' + currentStatus + ']';
            if (eligibility === 'in-team') {
                label += ' (In Team)';
                option.disabled = true;
            } else if (eligibility === 'in-other-team') {
                label += ' (In Other Team)';
                option.disabled = true;
            } else if (eligibility === 'deceased') {
                label += ' (Deceased)';
                option.disabled = true;
            } else if (eligibility === 'eliminated') {
                label += ' (Eliminated)';
                option.disabled = true;
            } else if (eligibility === 'future-member') {
                label += ' (Future Member)';
                option.disabled = true;
            } else if (eligibility === 'former-member') {
                label += ' (Former Member)';
                option.disabled = true;
            } else if (eligibility === 'unknown') {
                label += ' (Unknown)';
                option.disabled = true;
            }

            option.textContent = label;
            select.appendChild(option);
        }
    }

    function populateMemberCharacterSelect(teamId) {
        var select = document.getElementById('member-character');
        if (!select) {
            return;
        }

        var team = TeamCore.getTeam(teamId);
        if (!team) {
            return;
        }

        var currentPeriod = getCurrentPeriod(team.type);
        populateCharacterSelect(select, team, currentPeriod);
    }

    // ============================================================
    // MEMBER MODAL
    // ============================================================

    function showMemberModal(teamId) {
        var modal = document.getElementById('member-modal');
        if (!modal) {
            return;
        }

        var team = TeamCore.getTeam(teamId);
        if (!team) {
            return;
        }

        var currentPeriod = getCurrentPeriod(team.type);

        var titleEl = document.getElementById('modal-team-name');
        if (titleEl) {
            titleEl.textContent = team.name + ' - Members (Full History)';
        }

        populateMemberCharacterSelect(teamId);

        var roleInput = document.getElementById('member-role');
        if (roleInput) {
            roleInput.value = '';
        }

        var joinInput = document.getElementById('member-join');
        if (joinInput) {
            joinInput.value = '';
        }

        var leaveInput = document.getElementById('member-leave');
        if (leaveInput) {
            leaveInput.value = '';
        }

        var membersContainer = document.getElementById('members-list');
        if (membersContainer) {
            // TODO: Use TeamMemberViews.renderList when available
            var membersHtml = TeamMembers.renderList ? TeamMembers.renderList(team, currentPeriod) : '';
            membersContainer.innerHTML = membersHtml;
        }

        modal.dataset.teamId = teamId;
        modal.classList.remove('hidden');

        attachMemberEvents(teamId);
    }

    function closeMemberModal() {
        var modal = document.getElementById('member-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    // ============================================================
    // MEMBER MODAL EVENTS
    // ============================================================

    function attachMemberEvents(teamId) {
        var container = document.getElementById('members-list');
        if (!container) {
            return;
        }

        container.removeEventListener('click', handleMemberClick);
        container.addEventListener('click', handleMemberClick);
        container.dataset.teamId = teamId;
    }

    function handleMemberClick(e) {
        var target = e.target.closest('button');
        if (!target) {
            return;
        }

        var container = document.getElementById('members-list');
        var teamId = container ? container.dataset.teamId : null;
        if (!teamId) {
            return;
        }

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
                var result = TeamCore.removeMember(teamId, charId);
                if (result) {
                    refreshAllMemberUI(teamId);
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
        if (!modal) {
            return;
        }

        var team = TeamCore.getTeam(teamId);
        if (!team || !team.members) {
            showNotification('Team not found.', 'error');
            return;
        }

        var member = null;
        for (var i = 0; i < team.members.length; i++) {
            var m = team.members[i];
            if (m && String(m.characterId) === String(charId)) {
                member = m;
                break;
            }
        }

        if (!member) {
            showNotification('Member not found.', 'error');
            return;
        }

        var character = CharacterQueries.getCharacterById(member.characterId);
        var name = character ? CharacterQueries.getDisplayName(character) : 'Unknown';

        var nameEl = document.getElementById('edit-member-name');
        if (nameEl) {
            nameEl.textContent = name;
        }

        var roleEl = document.getElementById('edit-member-role');
        if (roleEl) {
            roleEl.value = member.role || '';
        }

        var joinEl = document.getElementById('edit-member-join');
        if (joinEl) {
            joinEl.value = member.joinPeriod || '';
        }

        var leaveEl = document.getElementById('edit-member-leave');
        if (leaveEl) {
            leaveEl.value = member.leavePeriod || '';
        }

        modal.dataset.teamId = teamId;
        modal.dataset.characterId = charId;
        modal.classList.remove('hidden');
    }

    function closeEditMemberModal() {
        var modal = document.getElementById('edit-member-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    // ============================================================
    // HANDLE ADD MEMBER - Action handler
    // ============================================================

    function handleAddMember() {
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

        var result = TeamCore.addMember(teamId, {
            characterId: charId,
            role: role,
            joinPeriod: joinPeriod,
            leavePeriod: leavePeriod
        });

        if (!result) {
            showNotification('Failed to add member. The character may already be in this team.', 'error');
            return;
        }

        if (charSelect) {
            charSelect.value = '';
        }
        if (roleInput) {
            roleInput.value = '';
        }
        if (joinInput) {
            joinInput.value = '';
        }
        if (leaveInput) {
            leaveInput.value = '';
        }

        refreshAllMemberUI(teamId);
        showNotification('Member added successfully!', 'success');
    }

    // ============================================================
    // HANDLE SAVE EDIT MEMBER - Action handler
    // ============================================================

    function handleSaveEditMember(e) {
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

        var result = TeamCore.updateMember(teamId, charId, {
            role: role,
            joinPeriod: joinPeriod,
            leavePeriod: leavePeriod
        });

        if (!result) {
            showNotification('Failed to update member.', 'error');
            return;
        }

        modal.classList.add('hidden');

        refreshAllMemberUI(teamId);
        showNotification('Member updated successfully!', 'success');
    }

    // ============================================================
    // RANKING MODAL - Uses TeamRankings for all ranking operations
    // ============================================================

    function showRankingModal(teamId) {
        var modal = document.getElementById('ranking-modal');
        if (!modal) {
            return;
        }

        var team = TeamCore.getTeam(teamId);
        if (!team) {
            return;
        }

        var titleEl = document.getElementById('ranking-modal-title');
        if (titleEl) {
            titleEl.textContent = team.name + ' - Ranking History';
        }

        var periodInput = document.getElementById('ranking-period');
        if (periodInput) {
            if (team.type === 'academic') {
                periodInput.placeholder = 'Week (e.g., 1)';
            } else {
                periodInput.placeholder = 'Year (e.g., ' + (window.data ? window.data.currentYear || MIN_YEAR : MIN_YEAR) + ')';
            }
            periodInput.value = '';
        }

        var rankInput = document.getElementById('ranking-rank');
        if (rankInput) {
            rankInput.value = '';
        }

        modal.dataset.teamId = teamId;

        var listEl = document.getElementById('ranking-list');
        if (listEl) {
            listEl.innerHTML = TeamRankings.renderList(team);
        }

        modal.classList.remove('hidden');

        attachRankingEvents(teamId);
    }

    function closeRankingModal() {
        var modal = document.getElementById('ranking-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    // ============================================================
    // RANKING MODAL EVENTS
    // ============================================================

    function attachRankingEvents(teamId) {
        var container = document.getElementById('ranking-list');
        if (!container) {
            return;
        }

        container.removeEventListener('click', handleRankingClick);
        container.addEventListener('click', handleRankingClick);
        container.dataset.teamId = teamId;
    }

    function handleRankingClick(e) {
        var target = e.target.closest('button');
        if (!target) {
            return;
        }

        var container = document.getElementById('ranking-list');
        var teamId = container ? container.dataset.teamId : null;
        if (!teamId) {
            return;
        }

        if (target.classList.contains('remove-ranking')) {
            e.stopPropagation();
            var period = target.dataset.period;
            if (period && confirm('Remove this ranking entry?')) {
                var result = TeamCore.removeRanking(teamId, period);
                if (result) {
                    refreshAllRankingUI(teamId);
                } else {
                    showNotification('Failed to remove ranking.', 'error');
                }
            }
        }
    }

    // ============================================================
    // HANDLE ADD RANKING - Action handler
    // ============================================================

    function handleAddRanking(e) {
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

        var team = TeamCore.getTeam(teamId);
        if (!team) {
            showNotification('Team not found.', 'error');
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

        var result = TeamCore.addRanking(teamId, period, rank);
        if (!result) {
            showNotification('Failed to add ranking.', 'error');
            return;
        }

        if (periodInput) {
            periodInput.value = '';
        }
        if (rankInput) {
            rankInput.value = '';
        }

        refreshAllRankingUI(teamId);
        showNotification('Ranking added successfully!', 'success');
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

        // Action handlers
        handleAddRanking: handleAddRanking,
        handleAddMember: handleAddMember,
        handleSaveEditMember: handleSaveEditMember,

        // Helpers
        populateMemberCharacterSelect: populateMemberCharacterSelect,
        populateClassSelector: populateClassSelector,
        populateMissionSelector: populateMissionSelector,
        toggleAcademicFields: toggleAcademicFields,
        toggleMissionField: toggleMissionField,
        updatePeriodLabels: updatePeriodLabels,
        addNameHistoryEntry: addNameHistoryEntry,

        // UI refresh helpers
        refreshMemberList: refreshMemberList,
        refreshRankingList: refreshRankingList,
        refreshAllMemberUI: refreshAllMemberUI,
        refreshAllRankingUI: refreshAllRankingUI
    };

})();
