/**
 * modules/academy/academy-weekly-teams-members.js - Academy Weekly Teams Member Manager
 * Week-scoped member management for the Academy Weekly Teams view.
 *
 * Path: js/modules/academy/academy-weekly-teams-members.js
 *
 * RESPONSIBILITIES:
 *   - Provide a container-based member manager for a specific
 *     (class, team) pair, viewed at a specific week
 *   - Read the candidate pool from the class roster
 *   - Write membership via AcademyWeeklyTeams (ranged model)
 *   - Re-render in place after each mutation
 *   - Invoke the caller's onChange callback so an outer view can
 *     refresh
 *
 * DROP-OUT vs DELETE RECORD:
 *   - Drop Out: endMembership(classId, teamId, charId, effectiveWeek)
 *     The member's active window becomes [startWeek, effectiveWeek - 1].
 *     History survives. This is the ordinary "remove from team" action.
 *
 *   - Delete Record: removeMemberRecord(classId, teamId, charId)
 *     Hard-deletes the membership entry as if it never existed.
 *     Used for administrative cleanup.
 *
 *   The UI exposes both. Drop Out is the default action. Delete
 *   Record is behind a confirmation and is not the common path.
 *
 * NOT RESPONSIBILITIES:
 *   - Persistent Team entity membership. This module does NOT call
 *     TeamCore.addMember. It does NOT touch team.members. The
 *     persistent roster and the week-scoped assignment map are
 *     DIFFERENT stores with DIFFERENT semantics.
 *   - Domain validation. AcademyWeeklyTeams validates.
 *   - Persistence. MutationPipeline (used by AcademyWeeklyTeams)
 *     owns it.
 *
 * MODAL CONTRACT:
 *   The caller owns the modal shell. This module renders into a
 *   container the caller supplies (typically a .modal-content).
 *
 * CLOSE SEMANTICS:
 *   The container's Close buttons invoke the caller-supplied
 *   options.onClose. This module has no module-level state; two
 *   managers open concurrently do not interfere.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.AcademyAggregator
 *   - window.AcademyWeeklyTeams
 *   - window.AcademyClasses
 *   - window.CharacterQueries
 *   - window.DomUtils
 *   - window.NotificationSystem
 *
 * DEPENDENCIES (OPTIONAL):
 *   - window.EliminationQueries
 */

(function() {
    'use strict';

    if (window.__academyWeeklyTeamsMembersLoaded) {
        return;
    }

    // ============================================================
    // DIAGNOSTIC FLAG
    // ============================================================
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
        typeof AcademyWeeklyTeams.addMember !== 'function' ||
        typeof AcademyWeeklyTeams.endMembership !== 'function' ||
        typeof AcademyWeeklyTeams.removeMemberRecord !== 'function' ||
        typeof AcademyWeeklyTeams.getActiveMembers !== 'function') {
        _missing.push('AcademyWeeklyTeams (ranged API)');
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

    diag('Module loaded (ranged API).');
    diag('  AcademyWeeklyTeams.addMember:', typeof AcademyWeeklyTeams.addMember);
    diag('  AcademyWeeklyTeams.endMembership:', typeof AcademyWeeklyTeams.endMembership);
    diag('  AcademyWeeklyTeams.removeMemberRecord:', typeof AcademyWeeklyTeams.removeMemberRecord);
    diag('  AcademyWeeklyTeams.getActiveMembers:', typeof AcademyWeeklyTeams.getActiveMembers);

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

    function buildCandidatePool(classId, week, teamId) {
        diag('buildCandidatePool CALLED', { classId, week, teamId });

        if (!isNonEmptyString(classId) || !isNonEmptyString(teamId)) {
            return [];
        }

        var roster = AcademyAggregator.getClassStudentsViewModel(classId) || [];
        diag('  roster size:', roster.length);
        if (roster.length === 0) {
            return [];
        }

        var cls = AcademyClasses.getClass(classId);
        var instructorId = cls && cls.instructorId
            ? String(cls.instructorId)
            : null;

        var currentMembers = AcademyWeeklyTeams.getActiveMembers(
            classId, teamId, week
        );
        diag('  current members at week', week, ':', currentMembers);

        var currentSet = Object.create(null);
        for (var i = 0; i < currentMembers.length; i++) {
            currentSet[String(currentMembers[i])] = true;
        }

        // Assigned elsewhere = active in any other team this week.
        var assignments = AcademyWeeklyTeams.getWeeklyTeams(classId, week);
        var assignedElsewhere = Object.create(null);
        var teamIds = Object.keys(assignments);
        for (var t = 0; t < teamIds.length; t++) {
            if (String(teamIds[t]) === String(teamId)) {
                continue;
            }
            var members = assignments[teamIds[t]];
            if (!Array.isArray(members)) { continue; }
            for (var m = 0; m < members.length; m++) {
                assignedElsewhere[String(members[m])] = true;
            }
        }

        var EQ = getEliminationQueries();
        var canCheckElimination = EQ &&
            typeof EQ.isCharacterEliminatedByWeek === 'function';

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

        return pool;
    }

    /**
     * Build the current member view models for rendering.
     * Uses getActiveMembers so only week-active members appear.
     */
    function buildCurrentMemberViewModels(classId, week, teamId) {
        diag('buildCurrentMemberViewModels CALLED', { classId, week, teamId });

        var memberIds = AcademyWeeklyTeams.getActiveMembers(classId, teamId, week);
        diag('  active member ids:', memberIds);

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

        html += '<p class="field-hint">' +
                    'Membership is week-scoped and range-based. ' +
                    'Adding a member records their start from the ' +
                    'displayed week. Dropping out ends their ' +
                    'membership from the displayed week onward.' +
                '</p>';

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
            html += '<button type="button" ' +
                        'class="small primary awtm-member-add-btn">Add</button>';
            html += '</div>';

            html += '<p class="field-hint">' +
                        'Adds the character starting from week ' +
                        escapeHtml(String(vm.week)) + '.' +
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
                    'class="small danger awtm-member-dropout-btn" ' +
                    'data-character-id="' +
                        escapeAttr(member.characterId) + '" ' +
                    'title="Drop out: end membership from this week onward">' +
                    'Drop Out' +
                '</button>';

        html += '<button type="button" ' +
                    'class="small danger awtm-member-delete-btn" ' +
                    'data-character-id="' +
                        escapeAttr(member.characterId) + '" ' +
                    'title="Delete record: remove all history">' +
                    '\u2715' +
                '</button>';

        html += '</div>';
        return html;
    }

    // ============================================================
    // PUBLIC ENTRY POINT
    // ============================================================

    function openMemberManager(container, classId, week, teamId, options) {
        diag('openMemberManager CALLED', { classId, week, teamId });

        if (!container || !isNonEmptyString(classId) || !isNonEmptyString(teamId)) {
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
            if (disposed || !container.parentNode) {
                return;
            }

            var teamName = isNonEmptyString(options.teamName)
                ? options.teamName
                : 'Team';

            var members = buildCurrentMemberViewModels(classId, weekNum, teamId);
            var candidates = buildCandidatePool(classId, weekNum, teamId);

            var vm = {
                teamName: teamName,
                week: weekNum,
                members: members,
                candidates: candidates
            };

            container.innerHTML = renderManagerBody(vm);
            bindEvents(container, vm);
        }

        function bindEvents(rootEl, vm) {
            // Close buttons.
            var closeBtns = rootEl.querySelectorAll('.awtm-close-btn');
            for (var i = 0; i < closeBtns.length; i++) {
                closeBtns[i].addEventListener('click', function() {
                    invokeOnClose();
                });
            }

            // Drop Out buttons: end membership from this week onward.
            var dropOutBtns = rootEl.querySelectorAll('.awtm-member-dropout-btn');
            for (var d = 0; d < dropOutBtns.length; d++) {
                (function(btn) {
                    btn.addEventListener('click', function() {
                        var charId = btn.dataset.characterId;
                        if (!charId) { return; }
                        if (!confirm(
                            'Drop this member out from week ' + weekNum +
                            ' onward? Their earlier membership is preserved.'
                        )) {
                            return;
                        }

                        AcademyWeeklyTeams.endMembership(
                            classId, teamId, charId, weekNum
                        )
                        .then(function(result) {
                            if (result && result.success) {
                                render();
                                invokeOnChange();
                            }
                        })
                        .catch(function(err) {
                            console.warn(
                                '[AcademyWeeklyTeamsMembers] endMembership failed:',
                                err
                            );
                            notify('Could not drop out member.', 'error');
                        });
                    });
                })(dropOutBtns[d]);
            }

            // Delete Record buttons: hard delete, no history.
            var deleteBtns = rootEl.querySelectorAll('.awtm-member-delete-btn');
            for (var r = 0; r < deleteBtns.length; r++) {
                (function(btn) {
                    btn.addEventListener('click', function() {
                        var charId = btn.dataset.characterId;
                        if (!charId) { return; }
                        if (!confirm(
                            'Permanently delete this membership record? ' +
                            'This removes all history for this member in ' +
                            'this team and cannot be undone.'
                        )) {
                            return;
                        }

                        AcademyWeeklyTeams.removeMemberRecord(
                            classId, teamId, charId
                        )
                        .then(function(result) {
                            if (result && result.success) {
                                render();
                                invokeOnChange();
                            }
                        })
                        .catch(function(err) {
                            console.warn(
                                '[AcademyWeeklyTeamsMembers] removeMemberRecord failed:',
                                err
                            );
                            notify('Could not delete membership record.', 'error');
                        });
                    });
                })(deleteBtns[r]);
            }

            // Add button.
            var addBtn = rootEl.querySelector('.awtm-member-add-btn');
            if (addBtn) {
                addBtn.addEventListener('click', function() {
                    var select = rootEl.querySelector('.awtm-member-select');
                    var charId = select ? select.value : '';

                    if (!charId) {
                        notify('Select a character to add.', 'error');
                        return;
                    }

                    AcademyWeeklyTeams.addMember(
                        classId, teamId, charId, weekNum
                    )
                    .then(function(result) {
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
        buildCurrentMemberViewModels: buildCurrentMemberViewModels
    };

})();
