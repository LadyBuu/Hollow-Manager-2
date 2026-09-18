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
 *   - Opening the Manage Members modal (delegating content to
 *     AcademyWeeklyTeamsMembers).
 *   - Opening the Auto-Distribute modal and running the
 *     distribution.
 *   - The auto-distribute algorithm itself (runAutoDistributeCore
 *     and findHighestTeamNumber). These move out of the shell in
 *     S1.2 and into a dedicated academy-weekly-teams-operations.js
 *     in S1.9. Until then they live here, because this controller
 *     is the application layer for the Weekly Teams feature.
 *   - Clear Rosters (clearAllMembershipsForClass, current week only).
 *   - Orphan-team assignment (assignTeamToClass).
 *   - Team selection toggling (delegates back to the shell via
 *     context.onSelectTeam).
 *   - Class selection (delegates back to the shell via
 *     context.onSelectClass).
 *   - Member-row click navigation (delegates back to the shell via
 *     context.onOpenCharacterInPeople, which switches to the People
 *     view with the character selected).
 *
 * WHAT THIS DOES NOT OWN:
 *   - The content host. The shell provides it.
 *   - The class and team selection ids. The shell owns them and
 *     passes them in via context on every render.
 *   - The week. The shell owns it (AcademyUI.getDisplayWeek) and
 *     passes it in via context.
 *   - Re-rendering the shell. When a mutation succeeds, the
 *     controller calls context.onChange(), which the shell wires to
 *     refreshView. The controller never calls refreshView directly;
 *     that would import the shell back into the controller, and the
 *     direction rule forbids it.
 *   - Weekly Teams domain reads. The aggregator produces the VM.
 *   - Weekly Teams domain mutations. AcademyWeeklyTeams, TeamCore,
 *     and the members manager own those.
 *
 * DEPENDENCY DIRECTION:
 *   Shell → registry → this controller.
 *   This controller never references window.AcademyView.
 *
 * RENDER SIGNATURE:
 *   render(host, context)
 *
 *   host    — the HTMLElement the shell allocates for the active
 *             controller. The controller owns everything inside it.
 *   context — {
 *               week: number,
 *               selectedClassId: string|null,
 *               selectedTeamId: string|null,
 *               onChange: function(updates?),
 *               onSelectTeam: function(teamId|null),
 *               onSelectClass: function(classId|null),
 *               onOpenCharacterInPeople: function(charId)
 *             }
 *
 *   The context argument is documented as part of this controller's
 *   contract with the shell. The controller-contract.js docblock
 *   describes render(host) only; the context argument is a
 *   controller-specific extension and is noted here.
 *
 * STATE:
 *   This controller holds NO long-lived state. Every render rebuilds
 *   the view from the context and the aggregator. The class and team
 *   selections live in the shell; the week lives in AcademyUI. The
 *   only thing the controller holds across calls is a reference to
 *   the most recently opened modal, so unmount can close it, and the
 *   most recent render context, so event handlers can use it.
 *
 * EVENT ROUTING:
 *   The controller's handle* methods receive the raw DOM event. They
 *   find their targets via dataset reads, exactly as the shell did.
 *   Action names and data attributes are unchanged from the pre-S1
 *   shell. The renderers already emit
 *   `data-action="weekly-teams-..."` attributes and the controller
 *   handles the same strings the shell's handler did. No renderer
 *   changes are needed.
 *
 * DEPENDENCIES:
 *   - window.AcademyUI
 *   - window.AcademyAggregator
 *   - window.AcademyWeeklyTeams
 *   - window.AcademyWeeklyTeamsView
 *   - window.AcademyWeeklyTeamsMembers   (lazy; only for the
 *                                         member-manager modal)
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
        typeof AcademyAggregator.getClassListViewModel !== 'function') {
        _missing.push('AcademyAggregator weekly-teams VM');
    }
    if (!AcademyWeeklyTeams ||
        typeof AcademyWeeklyTeams.clearAllMembershipsForClass !== 'function' ||
        typeof AcademyWeeklyTeams.assignTeamToClass !== 'function' ||
        typeof AcademyWeeklyTeams.addMember !== 'function' ||
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
    if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!Modal ||
        typeof Modal.createModal !== 'function' ||
        typeof Modal.showModal !== 'function' ||
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
    // OPTIONAL DEPENDENCY ACCESSOR
    // ============================================================

    function getMembersManager() {
        return window.AcademyWeeklyTeamsMembers || null;
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
    // currently open modal (so unmount can close it) and the most
    // recent render context (so event handlers can use it). Every
    // other value is derived from the context and the aggregator on
    // each render.

    var _openModal = null;
    var _renderContext = null;
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
    // MANAGE MEMBERS MODAL
    // ============================================================

    function openMembersModal(teamId) {
        if (!isNonEmptyString(teamId)) { return; }

        var MembersManager = getMembersManager();
        if (!MembersManager ||
            typeof MembersManager.openMemberManager !== 'function') {
            notify('Weekly team member manager is not available.', 'error');
            return;
        }

        var ctx = getRenderContext();
        var classId = ctx.classId;
        var week = ctx.week;

        if (!isNonEmptyString(classId)) {
            notify('Select a class first.', 'error');
            return;
        }

        var team = TeamQueries.getTeamById(teamId);
        var teamName = team && team.name ? team.name : 'Team';

        var modal = Modal.createModal('academy-weekly-team-members-modal');
        if (!modal) {
            notify('Could not open member manager.', 'error');
            return;
        }

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        modal.appendChild(contentEl);
        Modal.modalSetup(modal);
        Modal.showModal(modal);

        trackOpenModal(modal);

        var close = function() {
            closeTrackedModal(modal);
            var c = getRenderContext();
            c.onChange();
        };

        MembersManager.openMemberManager(
            contentEl,
            classId,
            week,
            teamId,
            {
                teamName: teamName,
                onClose: close,
                onChange: function() {
                    var c = getRenderContext();
                    c.onChange();
                }
            }
        );
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
    // This block carries the auto-distribute algorithm that lived in
    // academy-view.js pre-S1.2. The pinboard's S1.9 extracts it into
    // academy-weekly-teams-operations.js. Until then it lives here,
    // because the controller is the application layer for the
    // feature.

    function runAutoDistribute(ctx) {
        var groupSize = parseInt(ctx.groupSize, 10);
        if (isNaN(groupSize) || groupSize < 2) {
            notify('Group size must be at least 2.', 'error');
            return Promise.resolve({
                success: false,
                message: 'Invalid group size.'
            });
        }

        var preChain = Promise.resolve();
        if (ctx.clearExisting === true &&
            typeof AcademyWeeklyTeams.clearClassWindows === 'function') {
            preChain = AcademyWeeklyTeams.clearClassWindows(ctx.classId)
                .then(function() { return null; })
                .catch(function(err) {
                    console.warn(
                        '[AcademyWeeklyTeamsController] ' +
                        'clearClassWindows failed during Auto-Distribute:',
                        err
                    );
                    return null;
                });
        }

        return preChain.then(function() {
            return runAutoDistributeCore(ctx, groupSize);
        });
    }

    function runAutoDistributeCore(ctx, groupSize) {
        var rawRoster = AcademyAggregator.getClassStudentsViewModel(
            ctx.classId,
            ctx.week
        ) || [];

        var roster = rawRoster.filter(function(s) {
            if (!s) return false;
            if (s.deceased === true) return false;
            if (s.eliminated === true) return false;
            return true;
        });

        if (roster.length === 0) {
            notify(
                'The class has no eligible students for this week.',
                'info'
            );
            return Promise.resolve({
                success: false,
                message: 'No eligible students.'
            });
        }

        var allTeams = TeamQueries.getTeamsByClass(
            ctx.classId, 'operational'
        ) || [];
        var activeThisWeek = [];
        for (var i = 0; i < allTeams.length; i++) {
            var t = allTeams[i];
            if (!t) { continue; }
            if (TeamConstants.normalizeTeamType(t.type) !== 'academic') {
                continue;
            }
            if (!TeamQueries.isTeamActiveAtPeriod(t, ctx.week)) {
                continue;
            }
            activeThisWeek.push(t);
        }

        var assignedIds = Object.create(null);
        var teamCounts = Object.create(null);
        for (var a = 0; a < activeThisWeek.length; a++) {
            var team = activeThisWeek[a];
            var activeMembers = TeamQueries.getActiveTeamMembers(
                team, ctx.week
            );
            teamCounts[String(team.id)] = activeMembers.length;
            for (var b = 0; b < activeMembers.length; b++) {
                var m = activeMembers[b];
                if (m && m.characterId) {
                    assignedIds[String(m.characterId)] = true;
                }
            }
        }

        var unassigned = [];
        for (var r = 0; r < roster.length; r++) {
            var student = roster[r];
            if (!student || !student.id) { continue; }
            if (assignedIds[String(student.id)]) { continue; }
            unassigned.push(student);
        }
        unassigned.sort(function(a2, b2) {
            return String(a2.name || '').localeCompare(String(b2.name || ''));
        });

        if (unassigned.length === 0) {
            notify(
                'All eligible students are already assigned to a team ' +
                'this week.',
                'info'
            );
            return Promise.resolve({
                success: false,
                message: 'No unassigned students.'
            });
        }

        var rankedExisting = activeThisWeek.slice().sort(function(a2, b2) {
            var ca = teamCounts[String(a2.id)] || 0;
            var cb = teamCounts[String(b2.id)] || 0;
            if (ca !== cb) { return ca - cb; }
            return String(a2.name || '').localeCompare(String(b2.name || ''));
        });

        var namePrefix = ctx.namePrefix || 'Team ';
        var highestExistingNumber = findHighestTeamNumber(
            activeThisWeek, namePrefix
        );
        var nextNumber = highestExistingNumber + 1;

        var existingPlans = [];
        for (var e = 0; e < rankedExisting.length; e++) {
            existingPlans.push({
                type: 'existing',
                teamId: String(rankedExisting[e].id),
                teamName: rankedExisting[e].name || 'Unnamed Team',
                charIds: []
            });
        }
        var newPlans = [];

        for (var u = 0; u < unassigned.length; u++) {
            var studentId = String(unassigned[u].id);

            var bestPlan = null;
            var bestCount = Infinity;
            for (var p = 0; p < existingPlans.length; p++) {
                var plan = existingPlans[p];
                var existingCount = teamCounts[plan.teamId] || 0;
                var plannedCount = plan.charIds.length;
                var total = existingCount + plannedCount;
                if (total >= groupSize) { continue; }
                if (total < bestCount) {
                    bestCount = total;
                    bestPlan = plan;
                }
            }

            if (bestPlan) {
                bestPlan.charIds.push(studentId);
                continue;
            }

            var newName = namePrefix + nextNumber;
            nextNumber++;
            var newPlan = {
                type: 'create',
                teamName: newName,
                charIds: [studentId]
            };
            newPlans.push(newPlan);
        }

        var failed = false;
        var failureMessage = null;
        var addedToExisting = 0;
        var createdNewTeams = 0;
        var chain = Promise.resolve();

        existingPlans.forEach(function(plan) {
            if (plan.charIds.length === 0) { return; }
            plan.charIds.forEach(function(charId) {
                chain = chain.then(function() {
                    if (failed) { return; }
                    return AcademyWeeklyTeams.addMember(
                        ctx.classId,
                        plan.teamId,
                        charId,
                        ctx.week
                    ).then(function(res) {
                        if (!res || !res.success) {
                            failed = true;
                            failureMessage =
                                'Could not add a student to ' +
                                plan.teamName + ': ' +
                                (res && res.message
                                    ? res.message
                                    : 'unknown error');
                            console.warn(
                                '[AcademyWeeklyTeamsController] ' +
                                'addMember rejected:',
                                res && res.message
                            );
                            return;
                        }
                        addedToExisting++;
                    });
                });
            });
        });

        newPlans.forEach(function(plan) {
            chain = chain.then(function() {
                if (failed) { return; }
                return TeamCore.createTeam({
                    name: plan.teamName,
                    type: 'academic',
                    classId: ctx.classId,
                    startPeriod: String(ctx.week),
                    endPeriod: '',
                    status: 'active'
                }).then(function(res) {
                    if (!res || !res.success) {
                        failed = true;
                        failureMessage =
                            'Could not create team ' + plan.teamName +
                            ': ' +
                            (res && res.message
                                ? res.message
                                : 'unknown error');
                        console.warn(
                            '[AcademyWeeklyTeamsController] ' +
                            'createTeam rejected:',
                            res && res.message
                        );
                        return;
                    }

                    var newTeamId = extractCreatedTeamId(res);
                    if (!newTeamId) {
                        failed = true;
                        failureMessage =
                            'Newly-created team ' + plan.teamName +
                            ' has no id.';
                        return;
                    }

                    createdNewTeams++;

                    var windowPromise;
                    if (typeof AcademyWeeklyTeams.setWindow === 'function') {
                        windowPromise = AcademyWeeklyTeams.setWindow(
                            ctx.classId, newTeamId, ctx.week, null
                        );
                    } else {
                        windowPromise = AcademyWeeklyTeams.ensureWindow(
                            ctx.classId, newTeamId, ctx.week
                        );
                    }

                    return windowPromise.then(function() {
                        var memberChain = Promise.resolve();
                        plan.charIds.forEach(function(charId) {
                            memberChain = memberChain.then(function() {
                                if (failed) { return; }
                                return AcademyWeeklyTeams.addMember(
                                    ctx.classId,
                                    newTeamId,
                                    charId,
                                    ctx.week
                                ).then(function(inner) {
                                    if (!inner || !inner.success) {
                                        failed = true;
                                        failureMessage =
                                            'Could not add a student to ' +
                                            plan.teamName + ': ' +
                                            (inner && inner.message
                                                ? inner.message
                                                : 'unknown error');
                                        console.warn(
                                            '[AcademyWeeklyTeamsController] ' +
                                            'addMember rejected:',
                                            inner && inner.message
                                        );
                                    }
                                });
                            });
                        });
                        return memberChain;
                    });
                });
            });
        });

        return chain.then(function() {
            if (failed) {
                notify(
                    failureMessage || 'Auto-Distribute failed.',
                    'error'
                );
                return {
                    success: false,
                    message: failureMessage
                };
            }

            var existingCount = existingPlans.filter(function(en) {
                return en.charIds.length > 0;
            }).length;
            var newCount = newPlans.length;
            var totalStudents = addedToExisting;
            for (var n = 0; n < newPlans.length; n++) {
                totalStudents += newPlans[n].charIds.length;
            }

            var parts = [];
            parts.push('Placed ' + totalStudents +
                ' student' + (totalStudents === 1 ? '' : 's'));
            if (existingCount > 0) {
                parts.push('into ' + existingCount +
                    ' existing team' +
                    (existingCount === 1 ? '' : 's'));
            }
            if (newCount > 0) {
                parts.push('and ' + newCount +
                    ' new team' + (newCount === 1 ? '' : 's'));
            }
            notify(parts.join(' ') + '.', 'success');

            return {
                success: true,
                data: {
                    existingTeamsFilled: existingCount,
                    newTeamsCreated: newCount,
                    studentsPlaced: totalStudents
                }
            };
        });
    }

    function findHighestTeamNumber(teams, prefix) {
        var highest = 0;
        if (!Array.isArray(teams) || !isNonEmptyString(prefix)) {
            return highest;
        }

        for (var i = 0; i < teams.length; i++) {
            var team = teams[i];
            if (!team || !isNonEmptyString(team.name)) { continue; }
            var name = team.name;
            if (name.indexOf(prefix) !== 0) { continue; }
            var suffix = name.substring(prefix.length).trim();
            if (!/^\d+$/.test(suffix)) { continue; }
            var num = parseInt(suffix, 10);
            if (!isNaN(num) && num > highest) {
                highest = num;
            }
        }

        return highest;
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

        Modal.modalSetup(modal);
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

    function closeModal(modal) {
        if (!modal) { return; }
        if (!modal.parentNode) { return; }

        var teardownPromise;
        try {
            if (typeof Modal.closeModal === 'function') {
                teardownPromise = Modal.closeModal(modal);
            } else if (typeof Modal.hideModal === 'function') {
                teardownPromise = Modal.hideModal(modal);
            }
        } catch (e) {
            console.warn(
                '[AcademyWeeklyTeamsController] Modal teardown threw:', e
            );
            teardownPromise = null;
        }

        var finalize = function() {
            if (modal.parentNode) {
                try {
                    modal.parentNode.removeChild(modal);
                } catch (e) {
                    // Already detached.
                }
            }
        };

        if (teardownPromise && typeof teardownPromise.then === 'function') {
            teardownPromise.then(finalize).catch(function(err) {
                console.warn(
                    '[AcademyWeeklyTeamsController] Modal teardown ' +
                    'failed:', err
                );
                finalize();
            });
        } else {
            finalize();
        }
    }

    function trackOpenModal(modal) {
        if (_openModal && _openModal !== modal) {
            closeModal(_openModal);
        }
        _openModal = modal;
    }

    function closeTrackedModal(modal) {
        if (_openModal === modal) {
            _openModal = null;
        }
        closeModal(modal);
    }

    // ============================================================
    // UNMOUNT
    // ============================================================

    function unmount() {
        if (_openModal) {
            closeModal(_openModal);
            _openModal = null;
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
