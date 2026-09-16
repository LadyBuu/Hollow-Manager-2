/**
 * modules/academy/academy-weekly-teams-members.js - Academy Weekly Teams Member Manager
 * Week-scoped member management for the Academy Weekly Teams view.
 *
 * Path: js/modules/academy/academy-weekly-teams-members.js
 *
 * RESPONSIBILITIES:
 *   - Provide a container-based member manager for a specific
 *     (class, week, team) triple
 *   - Read the candidate pool from the class roster
 *   - Write membership to academy.weeklyTeams via AcademyWeeklyTeams
 *   - Re-render in place after each mutation
 *   - Invoke the caller's onChange callback so an outer view can
 *     refresh (sidebar member counters, for example)
 *
 * NOT RESPONSIBILITIES:
 *   - Persistent Team entity membership. This module does NOT call
 *     TeamCore.addMember. It does NOT touch team.members. The
 *     persistent roster and the week-scoped assignment map are
 *     DIFFERENT stores with DIFFERENT semantics. See Option 1 in
 *     the design notes.
 *   - Domain validation. AcademyWeeklyTeams.setWeeklyTeams validates.
 *   - Persistence. MutationPipeline (used by AcademyWeeklyTeams) owns it.
 *
 * CANDIDATE POOL:
 *   The pool is derived from the class roster
 *   (AcademyAggregator.getClassStudentsViewModel). It includes:
 *     - Students regardless of current career status.
 *       A "senior" is a student, not an instructor.
 *     - Deceased characters. Historical record-keeping requires
 *       being able to add a character who has since died to a team
 *       for a week they were alive.
 *     - Support staff. They are neither students nor instructors;
 *       if they're on the class roster, they're eligible.
 *
 *   The pool excludes:
 *     - The class's assigned instructor. The class record's
 *       instructorId is the only authoritative signal that a
 *       character teaches this class. Career status alone is not.
 *     - Characters already in this team at this week.
 *     - Characters already assigned to another academic team in the
 *       same class at the same week.
 *     - Characters eliminated at or before this week.
 *
 * ELIMINATION SEMANTICS:
 *   A character is eliminated-at-week if EliminationQueries says so.
 *   EliminationQueries.isCharacterEliminatedByWeek accepts an ID.
 *   This module passes IDs. No CharacterQueries round-trip.
 *
 * WRITE CONTRACT:
 *   Every mutation rewrites the full weekly assignment map for the
 *   (class, week) pair in one call to AcademyWeeklyTeams.setWeeklyTeams.
 *   That call re-normalizes and re-enforces the single-team-per-
 *   character invariant. A stale read cannot produce an invalid write.
 *
 * MODAL CONTRACT:
 *   The caller owns the modal shell. This module renders into a
 *   container the caller supplies (typically a .modal-content). It
 *   does not call Modal.createModal; it only manipulates what's
 *   inside the provided container.
 *
 * CLOSE SEMANTICS:
 *   The container's Close buttons invoke the caller-supplied
 *   options.onClose. This module has no module-level state; two
 *   managers open concurrently do not interfere.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.AcademyAggregator      (getClassStudentsViewModel)
 *   - window.AcademyWeeklyTeams     (weekly assignment map)
 *   - window.AcademyClasses         (class entity, instructorId)
 *   - window.CharacterQueries       (display names, status labels)
 *   - window.DomUtils               (escaping)
 *   - window.NotificationSystem     (notifications)
 *
 * DEPENDENCIES (OPTIONAL):
 *   - window.EliminationQueries     (eliminated-at-week filter)
 *     When absent, elimination filtering is skipped.
 */

(function() {
    'use strict';

    if (window.__academyWeeklyTeamsMembersLoaded) {
        return;
    }

    // ============================================================
    // DIAGNOSTIC FLAG
    // ============================================================
    // Set to true to emit tracing logs. Set to false in production.
    var _DIAGNOSTIC = true;

    function diag() {
        if (!_DIAGNOSTIC) return;
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[AWTM]');
        console.log.apply(console, args);
    }

    function diagWarn() {
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[AWTM]');
        console.warn.apply(console, args);
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var AcademyAggregator = window.AcademyAggregator;
    var AcademyWeeklyTeams = window.AcademyWeeklyTeams;
    var AcademyClasses = window.AcademyClasses;
    var CharacterQueries = window.CharacterQueries;
    var DomUtils = window.DomUtils;
    var NotificationSystem = window.NotificationSystem;

    var _missing = [];

    if (!AcademyAggregator ||
        typeof AcademyAggregator.getClassStudentsViewModel !== 'function') {
        _missing.push('AcademyAggregator.getClassStudentsViewModel');
    }
    if (!AcademyWeeklyTeams ||
        typeof AcademyWeeklyTeams.getWeeklyTeams !== 'function' ||
        typeof AcademyWeeklyTeams.setWeeklyTeams !== 'function') {
        _missing.push('AcademyWeeklyTeams.getWeeklyTeams/setWeeklyTeams');
    }
    if (!AcademyClasses ||
        typeof AcademyClasses.getClass !== 'function') {
        _missing.push('AcademyClasses.getClass');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function' ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getCharacterById/getDisplayName');
    }
    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        _missing.push('DomUtils.escapeHtml/escapeAttribute');
    }
    if (!NotificationSystem ||
        typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[AcademyWeeklyTeamsMembers] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__academyWeeklyTeamsMembersLoaded = true;

    // ============================================================
    // STARTUP DIAGNOSTIC
    // ============================================================
    // Emitted once per page load, so we know which module instance
    // is actually loaded and where its dependencies point.

    diag('Module loaded.');
    diag('  AcademyWeeklyTeams object:', AcademyWeeklyTeams);
    diag('  getWeeklyTeams fn:', AcademyWeeklyTeams.getWeeklyTeams);
    diag('  setWeeklyTeams fn:', AcademyWeeklyTeams.setWeeklyTeams);
    diag('  getTeamMembers fn:', AcademyWeeklyTeams.getTeamMembers);
    diag('  window.data present:', !!window.data);
    diag('  window.data.academy present:', !!(window.data && window.data.academy));

    // ============================================================
    // OPTIONAL DEPENDENCIES
    // ============================================================

    function getEliminationQueries() {
        return window.EliminationQueries || null;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttr(value) {
        return DomUtils.escapeAttribute(value);
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    // ============================================================
    // CANDIDATE POOL
    // ============================================================

    /**
     * Build the candidate pool for (classId, week, teamId).
     *
     * Returns an array of { id, name, statusLabel, deceased, age }.
     * Sorted alphabetically by name. Deceased candidates sort
     * alphabetically within the same list; the caller decides
     * whether to visually separate them.
     *
     * @param {string} classId
     * @param {number} week
     * @param {string} teamId
     * @returns {array}
     */
    function buildCandidatePool(classId, week, teamId) {
        diag('buildCandidatePool CALLED', { classId, week, teamId });

        if (!isNonEmptyString(classId) || !isNonEmptyString(teamId)) {
            diagWarn('buildCandidatePool: invalid classId or teamId, returning [].',
                { classId, teamId });
            return [];
        }

        // ---- 1. Class roster ----
        var roster = AcademyAggregator.getClassStudentsViewModel(classId) || [];
        diag('buildCandidatePool: roster size:', roster.length);
        if (roster.length === 0) {
            return [];
        }

        // ---- 2. Class instructor exclusion ----
        var cls = AcademyClasses.getClass(classId);
        var instructorId = cls && cls.instructorId
            ? String(cls.instructorId)
            : null;
        diag('buildCandidatePool: class instructorId:', instructorId);

        // ---- 3. Current team members ----
        var currentMembers = AcademyWeeklyTeams.getTeamMembers(classId, week, teamId);
        diag('buildCandidatePool: currentMembers for', teamId, ':', currentMembers);
        var currentSet = Object.create(null);
        for (var i = 0; i < currentMembers.length; i++) {
            currentSet[String(currentMembers[i])] = true;
        }

        // ---- 4. Assigned-elsewhere set ----
        var assignments = AcademyWeeklyTeams.getWeeklyTeams(classId, week);
        diag('buildCandidatePool: full assignments map for week', week, ':',
            JSON.stringify(assignments));

        var assignedElsewhere = Object.create(null);
        var teamIds = Object.keys(assignments);
        for (var t = 0; t < teamIds.length; t++) {
            var thisTeamId = teamIds[t];
            if (String(thisTeamId) === String(teamId)) {
                continue;
            }
            var members = assignments[thisTeamId];
            if (!Array.isArray(members)) { continue; }
            for (var m = 0; m < members.length; m++) {
                assignedElsewhere[String(members[m])] = true;
            }
        }
        diag('buildCandidatePool: assignedElsewhere keys:',
            Object.keys(assignedElsewhere));

        // ---- 5. Elimination queries ----
        var EQ = getEliminationQueries();
        var canCheckElimination = EQ &&
            typeof EQ.isCharacterEliminatedByWeek === 'function';
        diag('buildCandidatePool: canCheckElimination:', canCheckElimination);

        // ---- 6. Filter ----
        var pool = [];
        for (var r = 0; r < roster.length; r++) {
            var student = roster[r];
            if (!student || !student.id) { continue; }

            var studentId = String(student.id);

            if (instructorId !== null && studentId === instructorId) {
                continue;
            }
            if (currentSet[studentId]) {
                continue;
            }
            if (assignedElsewhere[studentId]) {
                continue;
            }

            if (canCheckElimination) {
                var eliminated = false;
                try {
                    eliminated = EQ.isCharacterEliminatedByWeek(studentId, week) === true;
                } catch (e) {
                    console.warn(
                        '[AcademyWeeklyTeamsMembers] isCharacterEliminatedByWeek threw for ' +
                        studentId + ':', e
                    );
                    eliminated = false;
                }
                if (eliminated) {
                    continue;
                }
            }

            var char = CharacterQueries.getCharacterById(studentId);
            var deceased = char && char.deceased === true;
            var age = char ? CharacterQueries.getCharacterAge(char) : '';
            var statusLabel = char
                ? CharacterQueries.getCurrentStatus(char)
                : (student.status || '');

            pool.push({
                id: studentId,
                name: student.name || (char
                    ? CharacterQueries.getDisplayName(char)
                    : 'Unknown'),
                statusLabel: statusLabel,
                deceased: deceased,
                age: age
            });
        }

        pool.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        diag('buildCandidatePool: pool size:', pool.length,
            'ids:', pool.map(function(p) { return p.id; }));

        return pool;
    }

    /**
     * Build the current-member view model for rendering.
     */
    function buildCurrentMemberViewModels(classId, week, teamId) {
        diag('buildCurrentMemberViewModels CALLED', { classId, week, teamId });

        var memberIds = AcademyWeeklyTeams.getTeamMembers(classId, week, teamId);
        diag('buildCurrentMemberViewModels: memberIds from AWT.getTeamMembers:',
            memberIds);

        var result = [];

        for (var i = 0; i < memberIds.length; i++) {
            var id = String(memberIds[i]);
            var char = CharacterQueries.getCharacterById(id);
            if (!char) {
                result.push({
                    characterId: id,
                    name: 'Unknown',
                    statusLabel: '',
                    deceased: false,
                    age: ''
                });
                continue;
            }

            result.push({
                characterId: id,
                name: CharacterQueries.getDisplayName(char),
                statusLabel: CharacterQueries.getCurrentStatus(char),
                deceased: char.deceased === true,
                age: CharacterQueries.getCharacterAge(char)
            });
        }

        result.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        diag('buildCurrentMemberViewModels: result:', result);

        return result;
    }

    // ============================================================
    // RENDER
    // ============================================================

    function renderManagerBody(vm) {
        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Manage Members \u2014 ' + escapeHtml(vm.teamName) + '</h3>';
        html += '<button type="button" ' +
                    'class="close-modal awtm-close-btn">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        // ---- Current members ----
        html += '<div class="form-group">';
        html += '<label>Current Members (' + vm.members.length + ')</label>';

        if (vm.members.length === 0) {
            html += '<p class="empty-state small">' +
                        'No members assigned to this team this week.' +
                    '</p>';
        } else {
            html += '<div class="academy-team-members-list">';
            for (var i = 0; i < vm.members.length; i++) {
                html += renderMemberRow(vm.members[i]);
            }
            html += '</div>';
        }
        html += '</div>';

        // ---- Add member ----
        html += '<div class="form-group">';
        html += '<label for="awtm-member-select">Add Member</label>';

        if (vm.candidates.length === 0) {
            html += '<p class="field-hint">' +
                        'No eligible characters available to add.' +
                    '</p>';
        } else {
            html += '<select id="awtm-member-select" class="awtm-member-select">';
            html += '<option value="">Select a character...</option>';
            for (var j = 0; j < vm.candidates.length; j++) {
                var c = vm.candidates[j];
                var label = c.name;
                var suffixParts = [];
                if (isNonEmptyString(c.statusLabel)) {
                    suffixParts.push(c.statusLabel);
                }
                if (c.deceased) {
                    suffixParts.push('Deceased');
                }
                if (suffixParts.length > 0) {
                    label += ' (' + suffixParts.join(', ') + ')';
                }
                html += '<option value="' + escapeAttr(c.id) + '">' +
                            escapeHtml(label) +
                        '</option>';
            }
            html += '</select>';

            html += '<div class="awtm-member-add-row">';
            html += '<input type="text" class="awtm-member-role" ' +
                        'placeholder="Role (optional)">';
            html += '<button type="button" ' +
                        'class="small primary awtm-member-add-btn">Add</button>';
            html += '</div>';

            html += '<p class="field-hint">' +
                        'Members added here are assigned to this team for ' +
                        'the selected week only. The persistent team roster ' +
                        'is not modified.' +
                    '</p>';
        }
        html += '</div>';

        // ---- Actions ----
        html += '<div class="form-actions">';
        html += '<button type="button" ' +
                    'class="secondary awtm-close-btn">Close</button>';
        html += '</div>';

        html += '</div>';

        return html;
    }

    function renderMemberRow(member) {
        if (!member || !member.characterId) { return ''; }

        var statusLabel = isNonEmptyString(member.statusLabel)
            ? member.statusLabel
            : '';
        var isDeceased = member.deceased === true;

        var rowClass = 'academy-team-member-row';
        if (isDeceased) {
            rowClass += ' deceased';
        }

        var html = '';
        html += '<div class="' + rowClass + '" ' +
                    'data-character-id="' +
                        escapeAttr(member.characterId) + '">';

        html += '<span class="academy-team-member-name">' +
                    escapeHtml(member.name || 'Unknown') +
                '</span>';

        if (isDeceased) {
            html += '<span class="academy-team-member-deceased-marker" ' +
                        'title="Deceased">\u2020</span>';
        }

        if (statusLabel) {
            html += '<span class="academy-team-member-status">' +
                        escapeHtml(statusLabel) +
                    '</span>';
        }

        html += '<button type="button" ' +
                    'class="small danger awtm-member-remove-btn" ' +
                    'data-character-id="' +
                        escapeAttr(member.characterId) + '">' +
                    'Remove' +
                '</button>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // MUTATIONS
    // ============================================================

    /**
     * Add a character to the team for the (class, week).
     *
     * Rewrites the full weekly assignment map. setWeeklyTeams
     * re-normalizes and re-enforces the single-team invariant.
     */
    function addMember(classId, week, teamId, charId) {
        diag('addMember CALLED', { classId, week, teamId, charId });

        var current = AcademyWeeklyTeams.getWeeklyTeams(classId, week);
        diag('addMember: current map read:', JSON.stringify(current));

        var next = deepCloneShallow(current);
        diag('addMember: shallow clone:', JSON.stringify(next));

        if (!Array.isArray(next[teamId])) {
            next[teamId] = [];
        }

        var target = String(charId);
        for (var i = 0; i < next[teamId].length; i++) {
            if (String(next[teamId][i]) === target) {
                diagWarn('addMember: character already in team (early exit).');
                return Promise.resolve({
                    success: false,
                    message: 'Character is already in this team.'
                });
            }
        }

        next[teamId].push(target);
        diag('addMember: next map to write:', JSON.stringify(next));

        var promise = AcademyWeeklyTeams.setWeeklyTeams(classId, week, next);
        diag('addMember: setWeeklyTeams returned:', promise);

        return promise.then(function(result) {
            diag('addMember: setWeeklyTeams RESOLVED:', result);

            // Read back immediately to confirm the write landed
            var afterRead = AcademyWeeklyTeams.getWeeklyTeams(classId, week);
            diag('addMember: read-back after write:', JSON.stringify(afterRead));

            var afterMembers = AcademyWeeklyTeams.getTeamMembers(classId, week, teamId);
            diag('addMember: getTeamMembers after write:', afterMembers);

            diag('addMember: window.data.academy.weeklyTeams:',
                JSON.stringify(
                    window.data &&
                    window.data.academy &&
                    window.data.academy.weeklyTeams
                ));

            return result;
        });
    }

    /**
     * Remove a character from the team for the (class, week).
     */
    function removeMember(classId, week, teamId, charId) {
        diag('removeMember CALLED', { classId, week, teamId, charId });

        var current = AcademyWeeklyTeams.getWeeklyTeams(classId, week);
        var next = deepCloneShallow(current);

        if (!Array.isArray(next[teamId])) {
            return Promise.resolve({
                success: false,
                message: 'Character is not in this team.'
            });
        }

        var target = String(charId);
        var before = next[teamId].length;
        next[teamId] = next[teamId].filter(function(id) {
            return String(id) !== target;
        });

        if (next[teamId].length === before) {
            return Promise.resolve({
                success: false,
                message: 'Character is not in this team.'
            });
        }

        return AcademyWeeklyTeams.setWeeklyTeams(classId, week, next)
            .then(function(result) {
                diag('removeMember: setWeeklyTeams RESOLVED:', result);
                return result;
            });
    }

    /**
     * Shallow clone of an assignment map. The values are arrays; we
     * copy each array so we never mutate the caller's input.
     */
    function deepCloneShallow(map) {
        var result = {};
        var keys = Object.keys(map || {});
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = map[k];
            result[k] = Array.isArray(v) ? v.slice() : [];
        }
        return result;
    }

    // ============================================================
    // PUBLIC ENTRY POINT
    // ============================================================

    /**
     * Open the member manager for a (class, week, team) triple.
     */
    function openMemberManager(container, classId, week, teamId, options) {
        diag('openMemberManager CALLED', { classId, week, teamId, options });

        if (!container || !isNonEmptyString(classId) || !isNonEmptyString(teamId)) {
            diagWarn('openMemberManager: invalid args, returning null.');
            return null;
        }

        options = options || {};
        var onClose = (typeof options.onClose === 'function')
            ? options.onClose
            : null;
        var onChange = (typeof options.onChange === 'function')
            ? options.onChange
            : null;

        var weekNum = parseInt(week, 10);
        diag('openMemberManager: parsed weekNum:', weekNum, 'from week:', week);

        if (isNaN(weekNum)) {
            container.innerHTML =
                '<div class="modal-body">' +
                    '<p class="empty-state small">' +
                        'Valid week is required.' +
                    '</p>' +
                '</div>';
            return null;
        }

        var disposed = false;

        function invokeOnClose() {
            if (typeof onClose === 'function') {
                try { onClose(); } catch (e) {
                    console.warn('[AcademyWeeklyTeamsMembers] onClose threw:', e);
                }
            }
        }

        function invokeOnChange() {
            if (typeof onChange === 'function') {
                try { onChange(); } catch (e) {
                    console.warn('[AcademyWeeklyTeamsMembers] onChange threw:', e);
                }
            }
        }

        function render() {
            diag('render CALLED. disposed:', disposed,
                'container.parentNode:', !!container.parentNode);

            if (disposed || !container.parentNode) {
                diag('render: bailing out.');
                return;
            }

            var teamName = isNonEmptyString(options.teamName)
                ? options.teamName
                : 'Team';

            var members = buildCurrentMemberViewModels(
                classId, weekNum, teamId
            );
            var candidates = buildCandidatePool(
                classId, weekNum, teamId
            );

            diag('render: members count:', members.length,
                'candidates count:', candidates.length);

            var vm = {
                teamName: teamName,
                members: members,
                candidates: candidates
            };

            container.innerHTML = renderManagerBody(vm);
            bindEvents(container, vm);
        }

        function bindEvents(rootEl, vm) {
            diag('bindEvents CALLED. add-btn present:',
                !!rootEl.querySelector('.awtm-member-add-btn'));

            // Close buttons.
            var closeBtns = rootEl.querySelectorAll('.awtm-close-btn');
            for (var i = 0; i < closeBtns.length; i++) {
                closeBtns[i].addEventListener('click', function() {
                    invokeOnClose();
                });
            }

            // Remove buttons.
            var removeBtns = rootEl.querySelectorAll('.awtm-member-remove-btn');
            for (var r = 0; r < removeBtns.length; r++) {
                (function(btn) {
                    btn.addEventListener('click', function() {
                        var charId = btn.dataset.characterId;
                        if (!charId) { return; }
                        if (!confirm('Remove this member from this team for this week?')) {
                            return;
                        }
                        removeMember(classId, weekNum, teamId, charId)
                            .then(function(result) {
                                if (result && result.success) {
                                    render();
                                    invokeOnChange();
                                }
                            })
                            .catch(function(err) {
                                console.warn(
                                    '[AcademyWeeklyTeamsMembers] removeMember failed:',
                                    err
                                );
                                notify('Could not remove member.', 'error');
                            });
                    });
                })(removeBtns[r]);
            }

            // Add button.
            var addBtn = rootEl.querySelector('.awtm-member-add-btn');
            if (addBtn) {
                addBtn.addEventListener('click', function() {
                    diag('Add button CLICKED.');

                    var select = rootEl.querySelector('.awtm-member-select');
                    var charId = select ? select.value : '';
                    diag('Add button: selected charId:', charId);

                    if (!charId) {
                        notify('Select a character to add.', 'error');
                        return;
                    }

                    addMember(classId, weekNum, teamId, charId)
                        .then(function(result) {
                            diag('addMember resolved in click handler:', result);

                            if (result && result.success) {
                                render();
                                invokeOnChange();
                            }
                        })
                        .catch(function(err) {
                            console.warn(
                                '[AcademyWeeklyTeamsMembers] addMember failed:',
                                err
                            );
                            notify('Could not add member.', 'error');
                        });
                });
            }
        }

        function close() {
            disposed = true;
            invokeOnClose();
        }

        function isOpen() {
            return !disposed && !!container.parentNode;
        }

        render();

        return {
            refresh: render,
            close: close,
            isOpen: isOpen
        };
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.AcademyWeeklyTeamsMembers = {
        openMemberManager: openMemberManager,

        // Exposed for testing / advanced callers.
        buildCandidatePool: buildCandidatePool,
        buildCurrentMemberViewModels: buildCurrentMemberViewModels,
        addMember: addMember,
        removeMember: removeMember
    };

})();
