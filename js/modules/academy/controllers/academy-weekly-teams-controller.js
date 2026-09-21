/**
 * modules/academy/controllers/academy-weekly-teams-controller.js
 * Academy Weekly Teams Controller
 *
 * Path: js/modules/academy/controllers/academy-weekly-teams-controller.js
 *
 * The Weekly Teams feature controller. Owns the Weekly Teams view:
 * its render, its event handlers, and its modal lifecycle.
 *
 * WHAT THIS OWNS:
 *   - Rendering the Weekly Teams view into the shell's content host.
 *   - Handling clicks, changes, inputs, and keydowns routed by the
 *     shell for events that occur inside the host.
 *   - Opening, closing, and wiring the Create/Edit Team modal.
 *   - Opening the shared member manager (via the Academy adapter).
 *   - Opening the Auto-Distribute modal and running the
 *     distribution.
 *   - Clear Rosters.
 *   - Orphan-team assignment.
 *   - Team selection toggling (delegates back to the shell).
 *   - Class selection (delegates back to the shell).
 *   - Member-row click navigation to People.
 *
 * WHAT THIS DOES NOT OWN:
 *   - The content host. The shell provides it.
 *   - The class and team selection ids. The shell owns them.
 *   - The week. The shell owns it.
 *   - Re-rendering the shell. When a mutation succeeds, the
 *     controller calls context.onChange().
 *   - Weekly Teams domain reads. The aggregator produces the VM.
 *   - Weekly Teams domain mutations. AcademyWeeklyTeams,
 *     TeamCore, and the shared member manager own those.
 *
 * MEMBER MANAGER (BUG-E13):
 *   The member manager is the SHARED manager
 *   (window.MemberManager), wired through
 *   window.MemberAdapterAcademy. It's identical to the manager
 *   used by the Teams tab; only the adapter differs.
 *
 *   This controller's job is:
 *     1. Create the modal shell on demand.
 *     2. Append a .modal-content.
 *     3. Modal.modalSetup + Modal.showModal.
 *     4. MemberManager.open(contentEl, { teamId, period, adapter, onClose }).
 *
 *   The modal shell is created OUTSIDE the controller's content
 *   host, so a host re-render cannot destroy it.
 *
 * MODAL ESCAPE (this revision):
 *   openModalShell now passes an explicit onClose to Modal.modalSetup.
 *   Before this revision, Modal.modalSetup(modal) was called with no
 *   second argument, which meant Escape-key and click-outside closed
 *   the modal through Modal.closeModal directly, bypassing the
 *   controller's closeTrackedModal helper. The modal still closed
 *   correctly, but the controller's _openModal field retained a
 *   reference to the now-detached modal element until the next
 *   modal replaced it.
 *
 *   The fix routes every close path — close button, submit success,
 *   click-outside, Escape — through closeTrackedModal, so the
 *   controller's _openModal tracking stays in sync with the actual
 *   modal lifecycle.
 *
 * DEPENDENCY DIRECTION:
 *   Shell → registry → this controller.
 *   This controller never references window.AcademyView.
 *
 * RENDER SIGNATURE:
 *   render(host, context)
 *
 *   host    — the HTMLElement the shell allocates.
 *   context — {
 *               week: number,
 *               selectedClassId: string|null,
 *               selectedTeamId: string|null,
 *               onChange: function(),
 *               onSelectTeam: function(teamId|null),
 *               onSelectClass: function(classId|null),
 *               onOpenCharacterInPeople: function(charId)
 *             }
 *
 * DEPENDENCIES:
 *   - window.AcademyUI
 *   - window.AcademyAggregator
 *   - window.AcademyWeeklyTeams
 *   - window.AcademyWeeklyTeamsView
 *   - window.AcademyWeeklyTeamsOperations (lazy)
 *   - window.MemberManager                  (shared manager)
 *   - window.MemberAdapterAcademy           (academy adapter)
 *   - window.TeamCore
 *   - window.TeamQueries
 *   - window.TeamConstants
 *   - window.CharacterQueries
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.DomUtils
 *   - window.CalendarConstants
 */

(function() {
    'use strict';

    if (window.__academyWeeklyTeamsControllerLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var AcademyUI = window.AcademyUI;
    var AcademyAggregator = window.AcademyAggregator;
    var AcademyWeeklyTeams = window.AcademyWeeklyTeams;
    var View = window.AcademyWeeklyTeamsView;
    var MemberManager = window.MemberManager;
    var MemberAdapterAcademy = window.MemberAdapterAcademy;
    var TeamCore = window.TeamCore;
    var TeamQueries = window.TeamQueries;
    var TeamConstants = window.TeamConstants;
    var CharacterQueries = window.CharacterQueries;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;
    var CalendarConstants = window.CalendarConstants;

    var _missing = [];

    if (!AcademyUI || typeof AcademyUI.getDisplayWeek !== 'function') {
        _missing.push('AcademyUI.getDisplayWeek');
    }
    if (!AcademyAggregator ||
        typeof AcademyAggregator.getWeeklyTeamsViewModel !== 'function' ||
        typeof AcademyAggregator.getClassListViewModel !== 'function' ||
        typeof AcademyAggregator.getClassStudentsViewModel !== 'function') {
        _missing.push('AcademyAggregator weekly-teams VMs');
    }
    if (!AcademyWeeklyTeams ||
        typeof AcademyWeeklyTeams.clearAllMembershipsForClass !== 'function' ||
        typeof AcademyWeeklyTeams.assignTeamToClass !== 'function' ||
        typeof AcademyWeeklyTeams.ensureWindow !== 'function' ||
        typeof AcademyWeeklyTeams.setWindow !== 'function' ||
        typeof AcademyWeeklyTeams.clearClassWindows !== 'function') {
        _missing.push('AcademyWeeklyTeams API');
    }
    if (!View ||
        typeof View.renderHTML !== 'function' ||
        typeof View.buildTeamModalHTML !== 'function' ||
        typeof View.buildAutoDistributeModalHTML !== 'function' ||
        typeof View.collectTeamForm !== 'function' ||
        typeof View.collectAutoDistributeForm !== 'function') {
        _missing.push('AcademyWeeklyTeamsView API');
    }
    if (!MemberManager || typeof MemberManager.open !== 'function') {
        _missing.push('MemberManager.open');
    }
    if (!MemberAdapterAcademy ||
        typeof MemberAdapterAcademy.fetchVM !== 'function' ||
        typeof MemberAdapterAcademy.addMember !== 'function' ||
        typeof MemberAdapterAcademy.updateMembers !== 'function' ||
        typeof MemberAdapterAcademy.removeStint !== 'function' ||
        typeof MemberAdapterAcademy.rejoinStint !== 'function' ||
        typeof MemberAdapterAcademy.removeMember !== 'function') {
        _missing.push('MemberAdapterAcademy API');
    }
    if (!TeamCore ||
        typeof TeamCore.createTeam !== 'function' ||
        typeof TeamCore.updateTeam !== 'function' ||
        typeof TeamCore.deleteTeam !== 'function' ||
        typeof TeamCore.configure !== 'function') {
        _missing.push('TeamCore API');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getTeamById !== 'function' ||
        typeof TeamQueries.getTeamsByClass !== 'function' ||
        typeof TeamQueries.getActiveTeamMembers !== 'function' ||
        typeof TeamQueries.isTeamActiveAtPeriod !== 'function') {
        _missing.push('TeamQueries API');
    }
    if (!TeamConstants ||
        typeof TeamConstants.normalizeTeamType !== 'function') {
        _missing.push('TeamConstants.normalizeTeamType');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!Modal ||
        typeof Modal.createModal !== 'function' ||
        typeof Modal.showModal !== 'function' ||
        typeof Modal.closeModal !== 'function' ||
        typeof Modal.modalSetup !== 'function') {
        _missing.push('Modal API');
    }
    if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }
    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        _missing.push('DomUtils.escapeHtml/escapeAttribute');
    }
    if (!CalendarConstants ||
        typeof CalendarConstants.MIN_WEEK !== 'number' ||
        typeof CalendarConstants.MAX_WEEK !== 'number') {
        _missing.push('CalendarConstants.MIN_WEEK/MAX_WEEK');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyWeeklyTeamsController] Missing mandatory ' +
            'dependencies: ' + _missing.join(', ')
        );
    }

    window.__academyWeeklyTeamsControllerLoaded = true;

    // ============================================================
    // LAZY ACCESSOR
    // ============================================================

    function getOperations() {
        return window.AcademyWeeklyTeamsOperations || null;
    }

    // ============================================================
    // SMALL HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    // ============================================================
    // MODULE STATE
    // ============================================================
    //
    // The only things this controller holds across calls are the
    // most recent render context and the currently open modals
    // (so unmount can close them). Everything else is derived
    // from the context and the aggregator on each render.

    var _renderContext = null;
    var _openModal = null;
    var _openMemberManagerModal = null;
    var _teamCoreConfigured = false;

    // ============================================================
    // TEAM CORE CONFIGURATION (idempotent)
    // ============================================================

    function ensureTeamCoreConfigured() {
        if (_teamCoreConfigured) { return true; }

        if (!TeamCore || typeof TeamCore.configure !== 'function') {
            return false;
        }
        if (!CharacterQueries ||
            typeof CharacterQueries.getCharacterById !== 'function') {
            return false;
        }

        var provider = {
            exists: function(appData, id) {
                if (!appData || !Array.isArray(appData.characters)) {
                    return false;
                }
                if (id === null || id === undefined || id === '') {
                    return false;
                }
                var target = String(id);
                for (var i = 0; i < appData.characters.length; i++) {
                    var c = appData.characters[i];
                    if (c && String(c.id) === target) {
                        return true;
                    }
                }
                return false;
            }
        };

        try {
            var result = TeamCore.configure({ characterProvider: provider });
            if (result === false) {
                console.warn(
                    '[AcademyWeeklyTeamsController] ' +
                    'TeamCore.configure returned false.'
                );
                return false;
            }
            _teamCoreConfigured = true;
            return true;
        } catch (e) {
            console.warn(
                '[AcademyWeeklyTeamsController] TeamCore.configure threw:',
                e
            );
            return false;
        }
    }

    // ============================================================
    // CONTEXT NORMALISATION
    // ============================================================

    function normaliseContext(rawContext) {
        var ctx = rawContext && typeof rawContext === 'object'
            ? rawContext
            : {};

        var week = typeof ctx.week === 'number' && isFinite(ctx.week)
            ? ctx.week
            : AcademyUI.getDisplayWeek();

        var selectedClassId = isNonEmptyString(ctx.selectedClassId)
            ? String(ctx.selectedClassId)
            : null;

        var selectedTeamId = isNonEmptyString(ctx.selectedTeamId)
            ? String(ctx.selectedTeamId)
            : null;

        var onChange = typeof ctx.onChange === 'function'
            ? ctx.onChange
            : function() {};

        var onSelectTeam = typeof ctx.onSelectTeam === 'function'
            ? ctx.onSelectTeam
            : function() {};

        var onSelectClass = typeof ctx.onSelectClass === 'function'
            ? ctx.onSelectClass
            : function() {};

        var onOpenCharacterInPeople =
            typeof ctx.onOpenCharacterInPeople === 'function'
                ? ctx.onOpenCharacterInPeople
                : function() {};

        return {
            week: week,
            selectedClassId: selectedClassId,
            selectedTeamId: selectedTeamId,
            onChange: onChange,
            onSelectTeam: onSelectTeam,
            onSelectClass: onSelectClass,
            onOpenCharacterInPeople: onOpenCharacterInPeople
        };
    }

    // ============================================================
    // RENDER
    // ============================================================

    function render(host, rawContext) {
        if (!host || typeof host !== 'object') {
            return;
        }

        var ctx = normaliseContext(rawContext);

        var vm;
        try {
            vm = AcademyAggregator.getWeeklyTeamsViewModel(
                ctx.selectedClassId,
                ctx.week,
                ctx.selectedTeamId
            );
        } catch (e) {
            console.warn(
                '[AcademyWeeklyTeamsController] ' +
                'getWeeklyTeamsViewModel threw:', e
            );
            host.innerHTML =
                '<div class="academy-body">' +
                    '<p class="empty-state">' +
                        'Failed to load weekly teams.' +
                    '</p>' +
                '</div>';
            return;
        }

        var resolvedClassId = isNonEmptyString(vm.classId)
            ? String(vm.classId)
            : null;
        var resolvedTeamId = isNonEmptyString(vm.selectedTeamId)
            ? String(vm.selectedTeamId)
            : null;

        _renderContext = {
            week: ctx.week,
            classId: resolvedClassId,
            teamId: resolvedTeamId,
            onChange: ctx.onChange,
            onSelectTeam: ctx.onSelectTeam,
            onSelectClass: ctx.onSelectClass,
            onOpenCharacterInPeople: ctx.onOpenCharacterInPeople
        };

        host.innerHTML = View.renderHTML(vm);
    }

    function getRenderContext() {
        if (_renderContext) { return _renderContext; }
        return normaliseContext(null);
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    function handleClick(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') {
            return;
        }

        // ---- Team row selection: toggle selected team ----
        var teamRow = target.closest('.academy-weekly-team-row');
        if (teamRow && teamRow.dataset && teamRow.dataset.teamId) {
            e.preventDefault();
            handleTeamRowClick(teamRow.dataset.teamId);
            return;
        }

        // ---- Member row: open the character in People view ----
        var memberRow = target.closest('.academy-weekly-team-member-row');
        if (memberRow && memberRow.dataset && memberRow.dataset.characterId) {
            e.preventDefault();
            var ctx = getRenderContext();
            ctx.onOpenCharacterInPeople(memberRow.dataset.characterId);
            return;
        }

        // ---- Delegated action dispatch ----
        var actionEl = target.closest('[data-action]');
        if (!actionEl || !actionEl.dataset) { return; }

        var action = actionEl.dataset.action;
        if (!isNonEmptyString(action)) { return; }

        switch (action) {
            case 'weekly-teams-create-team':
                e.preventDefault();
                openTeamForm(null);
                return;
            case 'weekly-teams-edit-team':
                e.preventDefault();
                if (actionEl.dataset.teamId) {
                    openTeamForm(actionEl.dataset.teamId);
                }
                return;
            case 'weekly-teams-delete-team':
                e.preventDefault();
                if (actionEl.dataset.teamId) {
                    handleTeamDelete(actionEl.dataset.teamId);
                }
                return;
            case 'weekly-teams-auto-distribute':
                e.preventDefault();
                openAutoDistributeModal();
                return;
            case 'weekly-teams-manage-members':
                e.preventDefault();
                if (actionEl.dataset.teamId) {
                    openMembersModal(actionEl.dataset.teamId);
                }
                return;
            case 'weekly-teams-clear-rosters':
                e.preventDefault();
                handleClearRosters();
                return;
            case 'weekly-teams-toggle-orphans':
                e.preventDefault();
                handleToggleOrphans(actionEl);
                return;
            case 'weekly-teams-assign-orphan-team':
                e.preventDefault();
                handleAssignOrphan(actionEl);
                return;
            default:
                return;
        }
    }

    function handleChange(e) {
        var target = e.target;
        if (!target || !target.id) { return; }

        var ctx = getRenderContext();

        if (target.id === 'academy-weekly-teams-class-select') {
            var classId = target.value || null;
            ctx.onSelectClass(classId);
            return;
        }

        if (target.id === 'academy-weekly-teams-week-input') {
            var accepted = AcademyUI.setDisplayWeek(target.value);
            if (accepted) {
                ctx.onChange();
            }
            return;
        }
    }

    function handleInput(e) {
        // The Weekly Teams view has no text inputs that need live
        // handling. Reserved for future use.
    }

    function handleKeydown(e) {
        var target = e.target;
        if (!target || e.key !== 'Enter') { return; }

        if (target.id === 'academy-weekly-teams-week-input') {
            e.preventDefault();
            var accepted = AcademyUI.setDisplayWeek(target.value);
            if (accepted) {
                var ctx = getRenderContext();
                ctx.onChange();
            }
        }
    }

    // ============================================================
    // TEAM SELECTION
    // ============================================================

    function handleTeamRowClick(teamId) {
        var ctx = getRenderContext();
        var current = ctx.teamId;
        var next = (current && String(current) === String(teamId))
            ? null
            : String(teamId);
        ctx.onSelectTeam(next);
    }

    // ============================================================
    // CREATE / EDIT TEAM MODAL
    // ============================================================

    function openTeamForm(teamId) {
        if (!ensureTeamCoreConfigured()) {
            notify(
                'Character module not available. Cannot save team.',
                'error'
            );
            return;
        }

        var ctx = getRenderContext();
        var classId = ctx.classId;

        if (!isNonEmptyString(classId)) {
            notify('Select a class first.', 'error');
            return;
        }

        var isEdit = !!teamId;
        var team = null;

        if (isEdit) {
            team = TeamQueries.getTeamById(teamId);
            if (!team) {
                notify('Team not found.', 'error');
                return;
            }
        }

        var week = ctx.week;
        var effectiveClassId = team ? team.classId : classId;
        var className = resolveClassName(effectiveClassId);

        var html = View.buildTeamModalHTML({
            team: team,
            classId: effectiveClassId,
            className: className,
            week: week
        });

        openModalShell('academy-weekly-team-modal', html, function(modal, close) {
            var form = modal.querySelector('#weekly-teams-team-form');
            if (!form) { return; }

            form.addEventListener('submit', function(ev) {
                ev.preventDefault();

                var payload = View.collectTeamForm(form);
                if (!payload || !payload.name) {
                    notify('Team name is required.', 'error');
                    return;
                }

                if (isEdit && team) {
                    submitEditTeam(team, payload, week, close);
                } else {
                    submitCreateTeam(
                        effectiveClassId, payload, week, close
                    );
                }
            });
        });
    }

    function submitCreateTeam(classId, payload, week, close) {
        TeamCore.createTeam({
            name: payload.name,
            type: 'academic',
            classId: classId,
            startPeriod: payload.startPeriod || String(week),
            endPeriod: payload.endPeriod || '',
            teamNumber: payload.teamNumber || '',
            status: 'active'
        }).then(function(result) {
            if (!result || !result.success) {
                return;
            }

            var createdId = extractCreatedTeamId(result);
            if (!createdId) {
                close();
                var ctx = getRenderContext();
                ctx.onChange();
                return;
            }

            var createStart = payload.startPeriod || String(week);
            var createEnd = payload.endPeriod || null;

            var windowPromise;
            if (typeof AcademyWeeklyTeams.setWindow === 'function') {
                windowPromise = AcademyWeeklyTeams.setWindow(
                    classId, createdId, createStart, createEnd
                );
            } else if (typeof AcademyWeeklyTeams.ensureWindow === 'function') {
                windowPromise = AcademyWeeklyTeams.ensureWindow(
                    classId, createdId, week
                );
            } else {
                windowPromise = Promise.resolve();
            }

            windowPromise.then(function() {
                close();
                var ctx = getRenderContext();
                ctx.onChange();
            }).catch(function(err) {
                console.warn(
                    '[AcademyWeeklyTeamsController] setWindow for new ' +
                    'team failed:', err
                );
                close();
                var ctx = getRenderContext();
                ctx.onChange();
            });
        }).catch(function(err) {
            console.warn(
                '[AcademyWeeklyTeamsController] createTeam failed:', err
            );
            notify('Failed to save team.', 'error');
        });
    }

    function submitEditTeam(team, payload, week, close) {
        TeamCore.updateTeam(team.id, {
            name: payload.name,
            teamNumber: payload.teamNumber || '',
            startPeriod: payload.startPeriod || String(week),
            endPeriod: payload.endPeriod || ''
        }).then(function(result) {
            if (!result || !result.success) {
                return;
            }

            var editClassId = team.classId ||
                getRenderContext().classId;
            var editStart = payload.startPeriod ||
                team.startPeriod ||
                String(week);
            var editEnd = payload.endPeriod || null;

            var windowPromise;
            if (typeof AcademyWeeklyTeams.setWindow === 'function') {
                windowPromise = AcademyWeeklyTeams.setWindow(
                    editClassId, team.id, editStart, editEnd
                );
            } else {
                windowPromise = Promise.resolve();
            }

            windowPromise.then(function() {
                close();
                var ctx = getRenderContext();
                ctx.onChange();
            }).catch(function(err) {
                console.warn(
                    '[AcademyWeeklyTeamsController] setWindow for ' +
                    'edited team failed:', err
                );
                close();
                var ctx = getRenderContext();
                ctx.onChange();
            });
        }).catch(function(err) {
            console.warn(
                '[AcademyWeeklyTeamsController] updateTeam failed:', err
            );
            notify('Failed to save team.', 'error');
        });
    }

    function extractCreatedTeamId(result) {
        if (!result || !result.data) { return null; }
        if (result.data.id) { return String(result.data.id); }
        if (result.data.team && result.data.team.id) {
            return String(result.data.team.id);
        }
        return null;
    }

    function resolveClassName(classId) {
        if (!isNonEmptyString(classId)) { return 'Unnamed Class'; }
        var classes = AcademyAggregator.getClassListViewModel() || [];
        for (var i = 0; i < classes.length; i++) {
            if (String(classes[i].id) === String(classId)) {
                return classes[i].name || 'Unnamed Class';
            }
        }
        return 'Unnamed Class';
    }

    // ============================================================
    // DELETE TEAM
    // ============================================================

    function handleTeamDelete(teamId) {
        if (!isNonEmptyString(teamId)) { return; }

        var name = 'this team';
        var team = TeamQueries.getTeamById(teamId);
        if (team && team.name) {
            name = '"' + team.name + '"';
        }

        if (!confirm('Delete ' + name + '?')) {
            return;
        }

        TeamCore.deleteTeam(teamId).then(function(result) {
            if (result && result.success) {
                var ctx = getRenderContext();
                if (ctx.teamId &&
                    String(ctx.teamId) === String(teamId)) {
                    ctx.onSelectTeam(null);
                } else {
                    ctx.onChange();
                }
            }
        }).catch(function(err) {
            console.warn(
                '[AcademyWeeklyTeamsController] deleteTeam failed:', err
            );
            notify('Failed to delete team.', 'error');
        });
    }

    // ============================================================
    // MANAGE MEMBERS (shared manager)
    // ============================================================
    //
    // Opens the shared MemberManager with the Academy adapter.
    //
    // The manager is identical to the one used by the Teams tab.
    // Only the adapter differs: it resolves the class ID from the
    // team, routes mutations to AcademyWeeklyTeams, and drops role
    // changes (no role mutation on the academic side).
    //
    // MODAL LIFECYCLE:
    //   - Shell created on demand here.
    //   - Appended to document.body by Modal.showModal.
    //   - Not in the controller's content host, so a re-render of
    //     the Weekly Teams view cannot destroy it.
    //   - On close, the manager calls onClose, which closes the
    //     shell and fires context.onChange so the view behind
    //     updates.

    function openMembersModal(teamId) {
        if (!isNonEmptyString(teamId)) { return; }

        var ctx = getRenderContext();
        var week = ctx.week;

        if (typeof week !== 'number' || !isFinite(week)) {
            notify('Cannot determine the current week.', 'error');
            return;
        }

        // Close any prior instance.
        if (_openMemberManagerModal) {
            try {
                Modal.closeModal(_openMemberManagerModal);
            } catch (e) {
                // Ignore.
            }
            _openMemberManagerModal = null;
        }

        var modal = Modal.createModal('academy-weekly-team-members-modal');
        if (!modal) {
            notify('Could not open the member manager.', 'error');
            return;
        }
        modal.id = 'academy-weekly-team-members-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content wide';
        modal.appendChild(contentEl);

        _openMemberManagerModal = modal;

        Modal.modalSetup(modal, function() {
            closeMembersModal();
        });
        Modal.showModal(modal);

        MemberManager.open(contentEl, {
            teamId: String(teamId),
            period: week,
            adapter: MemberAdapterAcademy,
            onClose: function() {
                closeMembersModal();
            }
        });
    }

    function closeMembersModal() {
        var modal = _openMemberManagerModal;
        _openMemberManagerModal = null;

        if (modal) {
            try {
                Modal.closeModal(modal);
            } catch (e) {
                // Ignore.
            }
        }

        var ctx = getRenderContext();
        ctx.onChange();
    }

    // ============================================================
    // AUTO-DISTRIBUTE MODAL
    // ============================================================

    function openAutoDistributeModal() {
        if (!ensureTeamCoreConfigured()) {
            notify(
                'Character module not available. Cannot auto-distribute.',
                'error'
            );
            return;
        }

        var ctx = getRenderContext();
        var classId = ctx.classId;
        var week = ctx.week;

        if (!isNonEmptyString(classId)) {
            notify('Select a class first.', 'error');
            return;
        }

        var className = resolveClassName(classId);

        var rawRoster = AcademyAggregator.getClassStudentsViewModel(
            classId,
            week
        ) || [];
        var eligibleCount = 0;
        for (var i = 0; i < rawRoster.length; i++) {
            var s = rawRoster[i];
            if (!s) { continue; }
            if (s.deceased === true) { continue; }
            if (s.eliminated === true) { continue; }
            eligibleCount++;
        }

        var html = View.buildAutoDistributeModalHTML({
            classId: classId,
            className: className,
            week: week,
            eligibleCount: eligibleCount,
            canDistribute: eligibleCount >= 2
        });

        openModalShell(
            'academy-weekly-team-auto-distribute-modal',
            html,
            function(modal, close) {
                var form = modal.querySelector(
                    '#weekly-teams-auto-distribute-form'
                );
                if (!form) { return; }

                form.addEventListener('submit', function(ev) {
                    ev.preventDefault();

                    var payload = View.collectAutoDistributeForm(form);
                    if (!payload) {
                        notify(
                            'Could not read distribution settings.',
                            'error'
                        );
                        return;
                    }

                    var groupSize = parseInt(payload.groupSize, 10);
                    if (isNaN(groupSize) || groupSize < 2) {
                        notify(
                            'Group size must be at least 2.', 'error'
                        );
                        return;
                    }

                    runAutoDistribute({
                        classId: classId,
                        className: className,
                        week: week,
                        groupSize: groupSize,
                        namePrefix: payload.namePrefix,
                        clearExisting: payload.clearExisting === true
                    }).then(function(result) {
                        if (result && result.success) {
                            close();
                            var c = getRenderContext();
                            c.onChange();
                        }
                    }).catch(function(err) {
                        console.warn(
                            '[AcademyWeeklyTeamsController] ' +
                            'Auto-Distribute failed:', err
                        );
                        notify('Auto-Distribute failed.', 'error');
                    });
                });
            }
        );
    }

    // ============================================================
    // AUTO-DISTRIBUTE — OPERATION
    // ============================================================
    //
    // Extracted into academy-weekly-teams-operations.js. This
    // controller reads the operations module lazily and falls back
    // to an inline implementation when it is absent.

    function runAutoDistribute(ctx) {
        var Operations = getOperations();
        if (Operations && typeof Operations.runAutoDistribute === 'function') {
            var deps = {
                AcademyAggregator: AcademyAggregator,
                AcademyWeeklyTeams: AcademyWeeklyTeams,
                TeamCore: TeamCore,
                TeamQueries: TeamQueries,
                TeamConstants: TeamConstants,
                NotificationSystem: NotificationSystem
            };
            return Operations.runAutoDistribute(ctx, deps);
        }

        // Fallback: the extracted module is not loaded.
        notify(
            'Auto-Distribute module is not available.', 'error'
        );
        return Promise.resolve({
            success: false,
            message: 'Auto-Distribute module is not available.'
        });
    }

    // ============================================================
    // CLEAR ROSTERS
    // ============================================================

    function handleClearRosters() {
        var ctx = getRenderContext();
        var classId = ctx.classId;
        var week = ctx.week;

        if (!isNonEmptyString(classId)) {
            notify('Select a class first.', 'error');
            return;
        }

        if (typeof AcademyWeeklyTeams.clearAllMembershipsForClass !== 'function') {
            notify('Weekly Teams module not available.', 'error');
            return;
        }

        var rosters = {};
        if (typeof AcademyWeeklyTeams.getWeeklyTeams === 'function') {
            rosters = AcademyWeeklyTeams.getWeeklyTeams(
                classId, week
            ) || {};
        }

        var teamsActiveCount = 0;
        var membersActiveCount = 0;
        var teamIds = Object.keys(rosters);
        for (var i = 0; i < teamIds.length; i++) {
            teamsActiveCount++;
            var memberIds = rosters[teamIds[i]] || [];
            membersActiveCount += memberIds.length;
        }

        if (membersActiveCount === 0) {
            notify('No team members to clear for this week.', 'info');
            return;
        }

        var message =
            'Remove all ' + membersActiveCount +
            ' active team member' +
            (membersActiveCount === 1 ? '' : 's') +
            ' across ' + teamsActiveCount +
            ' team' + (teamsActiveCount === 1 ? '' : 's') +
            ' for week ' + week + '?\n\n' +
            'The teams themselves are NOT deleted. They stay scheduled ' +
            'and empty. Memberships that do not cover this week ' +
            '(past leaves, future joins) are kept.\n\n' +
            'This cannot be undone.';

        if (!confirm(message)) {
            return;
        }

        AcademyWeeklyTeams.clearAllMembershipsForClass(classId, week)
            .then(function(result) {
                if (result && result.success) {
                    var c = getRenderContext();
                    c.onChange();
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyWeeklyTeamsController] ' +
                    'clearAllMembershipsForClass failed:', err
                );
            });
    }

    // ============================================================
    // ORPHAN TEAMS
    // ============================================================

    function handleToggleOrphans(buttonEl) {
        var section = buttonEl.closest(
            '.academy-weekly-teams-orphan-section'
        );
        if (!section) { return; }

        var list = section.querySelector('.academy-orphan-list');
        if (!list) { return; }

        var icon = section.querySelector('.academy-orphan-toggle-icon');
        var expanded = section.getAttribute('data-expanded') === 'true';

        if (expanded) {
            list.style.display = 'none';
            section.setAttribute('data-expanded', 'false');
            if (icon) { icon.textContent = '\u25b8'; }
        } else {
            list.style.display = '';
            section.setAttribute('data-expanded', 'true');
            if (icon) { icon.textContent = '\u25be'; }
        }
    }

    function handleAssignOrphan(buttonEl) {
        var teamId = buttonEl.dataset ? buttonEl.dataset.teamId : null;
        if (!isNonEmptyString(teamId)) {
            notify('Team ID missing.', 'error');
            return;
        }

        var row = buttonEl.closest('.academy-orphan-row');
        if (!row) { return; }

        var select = row.querySelector('.academy-orphan-class-select');
        var classId = select ? select.value : '';

        if (!isNonEmptyString(classId)) {
            notify('Select a class to assign this team to.', 'error');
            return;
        }

        AcademyWeeklyTeams.assignTeamToClass(classId, teamId)
            .then(function(result) {
                if (result && result.success) {
                    var ctx = getRenderContext();
                    ctx.onChange();
                }
            })
            .catch(function(err) {
                console.warn(
                    '[AcademyWeeklyTeamsController] ' +
                    'assignTeamToClass failed:', err
                );
            });
    }

    // ============================================================
    // MODAL PLUMBING
    // ============================================================

    /**
     * Open a modal shell with the given content, wire it through
     * the controller's own close function, and invoke the caller's
     * bind callback.
     *
     * ESCAPE / CLICK-OUTSIDE:
     *   Modal.modalSetup is called with an explicit onClose that
     *   routes through closeTrackedModal. This keeps the
     *   controller's _openModal field in sync with the modal's
     *   actual lifecycle, no matter which path closes it: the
     *   close button, a successful submit, a click outside the
     *   modal, or the Escape key.
     *
     *   Before this revision, Modal.modalSetup(modal) was called
     *   with no second argument. That still closed the modal on
     *   Escape and click-outside (Modal called its own
     *   closeModal), but it bypassed closeTrackedModal, leaving
     *   _openModal pointing at a detached element until the next
     *   open replaced it.
     */
    function openModalShell(className, contentHTML, onBind) {
        var modal = Modal.createModal(className);
        if (!modal) {
            notify('Failed to create modal.', 'error');
            return null;
        }

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        contentEl.innerHTML = contentHTML || '';
        modal.appendChild(contentEl);

        Modal.modalSetup(modal, function() {
            closeTrackedModal(modal);
        });
        Modal.showModal(modal);

        trackOpenModal(modal);

        var close = function() {
            closeTrackedModal(modal);
        };

        if (typeof onBind === 'function') {
            onBind(modal, close);
        }

        return modal;
    }

    function trackOpenModal(modal) {
        if (_openModal && _openModal !== modal) {
            try {
                Modal.closeModal(_openModal);
            } catch (e) {
                // Ignore.
            }
        }
        _openModal = modal;
    }

    function closeTrackedModal(modal) {
        if (_openModal === modal) {
            _openModal = null;
        }
        if (modal) {
            try {
                Modal.closeModal(modal);
            } catch (e) {
                // Ignore.
            }
        }
    }

    // ============================================================
    // UNMOUNT
    // ============================================================

    function unmount() {
        if (_openModal) {
            try {
                Modal.closeModal(_openModal);
            } catch (e) {
                // Ignore.
            }
            _openModal = null;
        }

        if (_openMemberManagerModal) {
            try {
                Modal.closeModal(_openMemberManagerModal);
            } catch (e) {
                // Ignore.
            }
            _openMemberManagerModal = null;
        }

        _renderContext = null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyWeeklyTeamsController = Object.freeze({
        render: render,
        handleClick: handleClick,
        handleChange: handleChange,
        handleInput: handleInput,
        handleKeydown: handleKeydown,
        unmount: unmount
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.AcademyWeeklyTeamsController;
        var missing = [];

        var required = [
            'render',
            'handleClick',
            'handleChange',
            'handleInput',
            'handleKeydown',
            'unmount'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[AcademyWeeklyTeamsController] Verification - some ' +
                'exports may be missing:', missing.join(', ')
            );
        }
    })();

})();
