/**
 * modules/teams/team-kill-modal.js - Kill Team Modal
 *
 * Path: js/modules/teams/team-kill-modal.js
 *
 * WHAT THIS OWNS:
 *   - The Kill Team modal, its member list, its year picker, its
 *     cause-of-death input, and its confirm action.
 *   - The per-character mutation that marks each member deceased.
 *   - The post-kill check that deprecates the team when every
 *     member died in the same year.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Team reads. TeamQueries owns them.
 *   - Team writes. TeamCore owns them.
 *   - Character writes. CharacterCRUD owns them.
 *   - Team naming. TeamNaming owns it.
 *
 * THE MUTATION PER CHARACTER:
 *   This module calls CharacterCRUD.save with a FULL DTO,
 *   reconstructing every user-authored field from the stored
 *   record. CharacterCRUD.save REPLACES the record with the
 *   normalised DTO, so a partial DTO would blank every field
 *   that is not present.
 *
 *   The auto-managed fields (classIds, parentIds, eliminations,
 *   eliminatedWeeks, disciplineIds, mode, createdAt, id) are
 *   preserved by CharacterCRUD.updateExistingCharacter, so the
 *   DTO does not carry them.
 *
 *   The death cascade (endStintsForCharacter, endRelationships)
 *   fires inside CharacterCRUD.save's transaction. This module
 *   does not call it directly.
 *
 * THE DEPRECATION RULE:
 *   After every member has been marked deceased, this module
 *   checks whether ALL of them share the same death year. "All"
 *   means every character who was an ACTIVE member at the chosen
 *   year, before the kill.
 *
 *   If they all share the year, the team's status is set to
 *   'deprecated' via TeamCore.updateTeam. If not, the team is
 *   left alone.
 *
 *   A member who has no birthYear is still counted; the check is
 *   over deathYear, not over age.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.TeamQueries
 *   - window.TeamCore
 *   - window.CharacterQueries
 *   - window.CharacterCRUD
 *   - window.Modal
 *   - window.NotificationSystem
 */

(function() {
    'use strict';

    if (window.__teamKillModalLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var TeamQueries = window.TeamQueries;
    var TeamCore = window.TeamCore;
    var CharacterQueries = window.CharacterQueries;
    var CharacterCRUD = window.CharacterCRUD;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;

    var _missing = [];

    if (!TeamQueries ||
        typeof TeamQueries.getTeamById !== 'function') {
        _missing.push('TeamQueries.getTeamById');
    }
    if (!TeamQueries ||
        typeof TeamQueries.getActiveTeamMembers !== 'function') {
        _missing.push('TeamQueries.getActiveTeamMembers');
    }
    if (!TeamCore ||
        typeof TeamCore.updateTeam !== 'function') {
        _missing.push('TeamCore.updateTeam');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!CharacterCRUD ||
        typeof CharacterCRUD.save !== 'function') {
        _missing.push('CharacterCRUD.save');
    }
    if (!Modal ||
        typeof Modal.createModal !== 'function' ||
        typeof Modal.showModal !== 'function' ||
        typeof Modal.closeModal !== 'function' ||
        typeof Modal.modalSetup !== 'function') {
        _missing.push('Modal API');
    }
    if (!NotificationSystem ||
        typeof NotificationSystem.notify !== 'function') {
        _missing.push('NotificationSystem.notify');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[TeamKillModal] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__teamKillModalLoaded = true;

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _modal = null;
    var _contentEl = null;
    var _teamId = null;
    var _clickHandler = null;
    var _inputHandler = null;
    var _busy = false;

    // ============================================================
    // HELPERS
    // ============================================================

    function escapeHtml(value) {
        if (window.DomUtils &&
            typeof window.DomUtils.escapeHtml === 'function') {
            return window.DomUtils.escapeHtml(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttribute(value) {
        if (window.DomUtils &&
            typeof window.DomUtils.escapeAttribute === 'function') {
            return window.DomUtils.escapeAttribute(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    function getApplicationYear() {
        if (window.data &&
            typeof window.data.currentYear === 'number' &&
            isFinite(window.data.currentYear) &&
            window.data.currentYear > 0) {
            return Math.floor(window.data.currentYear);
        }
        return new Date().getFullYear();
    }

    function parseYear(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var n = parseInt(String(value).trim(), 10);
        if (isNaN(n) || n < 1) { return null; }
        return n;
    }

    function parseBirthYear(char) {
        if (!char || char.birthYear === undefined ||
            char.birthYear === null ||
            char.birthYear === '') {
            return null;
        }
        var n = parseInt(String(char.birthYear).trim(), 10);
        if (isNaN(n) || n < 1) { return null; }
        return n;
    }

    // ============================================================
    // BUILD DTO
    // ============================================================
    //
    // Reconstruct a saveable DTO from a stored character record.
    // Every user-authored field is carried over. Auto-managed
    // fields (classIds, parentIds, eliminations, etc.) are NOT
    // included; CharacterCRUD preserves them.

    function buildDeathDto(char, year, cause) {
        var deathAge = '';
        var birthYear = parseBirthYear(char);
        if (birthYear !== null) {
            deathAge = String(year - birthYear);
        }

        return {
            _editId: String(char.id),

            firstName:   char.firstName || '',
            middleName:  char.middleName || '',
            lastName:    char.lastName || '',
            nickname:    char.nickname || '',
            alias:       char.alias || '',
            previousNames: Array.isArray(char.previousNames)
                ? char.previousNames.slice()
                : [],
            displayParts: char.displayParts
                ? Object.assign({}, char.displayParts)
                : undefined,

            isFiller: char.isFiller === true,

            birthYear: char.birthYear || '',
            gender: char.gender || '',
            attraction: char.attraction || '',

            deceased: true,
            deathYear: String(year),
            deathAge: deathAge,
            deathCause: cause || 'Killed in action',
            deathWeek: '',

            eyes: char.eyes || '',
            hair: char.hair || '',
            skin: char.skin || '',
            height: char.height || '',
            weight: char.weight || '',
            build: char.build || '',
            appearanceNotes: char.appearanceNotes || '',

            specialty: char.specialty || '',
            careerStatus: Array.isArray(char.careerStatus)
                ? char.careerStatus.slice()
                : [],

            stats: char.stats
                ? Object.assign({}, char.stats)
                : undefined,
            magic: char.magic
                ? Object.assign({}, char.magic)
                : undefined,

            hp: char.hp || 0,
            mp: char.mp || 0,

            weapons: Array.isArray(char.weapons)
                ? char.weapons.map(function(w) {
                    return Object.assign({}, w);
                })
                : [],
            combatNotes: char.combatNotes || '',

            notes: char.notes || '',

            personality: char.personality
                ? Object.assign({}, char.personality)
                : {},

            specialMoves: char.specialMoves
                ? {
                    physical: Array.isArray(
                        char.specialMoves.physical
                    )
                        ? char.specialMoves.physical.map(
                            function(m) {
                                return Object.assign({}, m);
                            })
                        : [],
                    magical: Array.isArray(
                        char.specialMoves.magical
                    )
                        ? char.specialMoves.magical.map(
                            function(m) {
                                return Object.assign({}, m);
                            })
                        : []
                }
                : undefined
        };
    }

    // ============================================================
    // MUTATION
    // ============================================================

    /**
     * Mark a single character deceased in the given year.
     * Returns { ok, characterId, name, error? }.
     */
    function killOneCharacter(charId, year, cause) {
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            return Promise.resolve({
                ok: false,
                characterId: charId,
                name: 'Unknown',
                error: 'Character not found.'
            });
        }

        var name = CharacterQueries.getDisplayName(char) || 'Unknown';
        var dto = buildDeathDto(char, year, cause);

        return CharacterCRUD.save(dto).then(function(result) {
            if (result && result.success) {
                return {
                    ok: true,
                    characterId: charId,
                    name: name
                };
            }
            return {
                ok: false,
                characterId: charId,
                name: name,
                error: (result && result.message) ||
                    'Save failed.'
            };
        }).catch(function(err) {
            return {
                ok: false,
                characterId: charId,
                name: name,
                error: err && err.message
                    ? err.message
                    : String(err)
            };
        });
    }

    /**
     * Kill every member of a team in the given year, then check
     * whether the team should be deprecated.
     *
     * @param {string} teamId
     * @param {number} year
     * @param {string} cause
     * @returns {Promise<{killed, failed, deprecated}>}
     */
    function killAllMembers(teamId, year, cause) {
        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            return Promise.resolve({
                killed: 0,
                failed: 1,
                deprecated: false,
                error: 'Team not found.'
            });
        }

        var membersAtYear = TeamQueries.getActiveTeamMembers(
            team, year
        );

        if (membersAtYear.length === 0) {
            return Promise.resolve({
                killed: 0,
                failed: 0,
                deprecated: false,
                error: 'No active members at year ' + year + '.'
            });
        }

        // Snapshot the member IDs before the kills run, so the
        // post-kill deprecation check sees who was there.
        var targetIds = [];
        for (var i = 0; i < membersAtYear.length; i++) {
            var m = membersAtYear[i];
            if (m && m.characterId) {
                targetIds.push(String(m.characterId));
            }
        }

        var killed = 0;
        var failed = 0;
        var failures = [];

        var chain = Promise.resolve();

        targetIds.forEach(function(charId) {
            chain = chain.then(function() {
                return killOneCharacter(charId, year, cause)
                    .then(function(result) {
                        if (result.ok) {
                            killed++;
                        } else {
                            failed++;
                            failures.push({
                                characterId: charId,
                                name: result.name,
                                error: result.error
                            });
                        }
                    });
            });
        });

        return chain.then(function() {
            // Post-kill check: are all of them deceased in the
            // same year?
            var allSameYear = true;
            var firstYear = null;

            for (var j = 0; j < targetIds.length; j++) {
                var c = CharacterQueries.getCharacterById(
                    targetIds[j]
                );
                if (!c) {
                    allSameYear = false;
                    break;
                }
                if (c.deceased !== true) {
                    allSameYear = false;
                    break;
                }
                var dYear = parseYear(c.deathYear);
                if (dYear === null) {
                    allSameYear = false;
                    break;
                }
                if (firstYear === null) {
                    firstYear = dYear;
                } else if (dYear !== firstYear) {
                    allSameYear = false;
                    break;
                }
            }

            var deprecated = false;

            if (allSameYear && firstYear !== null &&
                targetIds.length > 0) {
                return TeamCore.updateTeam(teamId, {
                    status: 'deprecated'
                }).then(function(result) {
                    if (result && result.success) {
                        deprecated = true;
                    }
                    return {
                        killed: killed,
                        failed: failed,
                        deprecated: deprecated,
                        failures: failures,
                        year: firstYear
                    };
                }).catch(function(err) {
                    console.warn(
                        '[TeamKillModal] deprecation update failed:',
                        err
                    );
                    return {
                        killed: killed,
                        failed: failed,
                        deprecated: false,
                        failures: failures,
                        year: firstYear
                    };
                });
            }

            return {
                killed: killed,
                failed: failed,
                deprecated: false,
                failures: failures,
                year: firstYear
            };
        });
    }

    // ============================================================
    // MODAL HTML
    // ============================================================

    function buildMemberListHTML(members, year) {
        if (members.length === 0) {
            return '<p class="empty-state" style="padding:6px;' +
                'font-size:0.75rem;">' +
                'No active members at year ' + year + '.' +
                '</p>';
        }

        var html = '';
        html += '<div class="team-kill-members">';

        for (var i = 0; i < members.length; i++) {
            var m = members[i];
            var char = CharacterQueries.getCharacterById(
                m.characterId
            );
            var name = char
                ? (CharacterQueries.getDisplayName(char) || 'Unknown')
                : 'Unknown';

            var ageDisplay = '';
            var birthYear = parseBirthYear(char);
            if (birthYear !== null) {
                var age = year - birthYear;
                ageDisplay = ' <span style="color:var(--text-dim);' +
                    'font-size:0.7rem;">(age ' + age + ')</span>';
            }

            html += '<div class="team-kill-member-row">' +
                '<span class="team-kill-member-name">' +
                    escapeHtml(name) + ageDisplay +
                '</span>' +
                '</div>';
        }

        html += '</div>';
        return html;
    }

    function buildModalHTML(team, members, year) {
        var teamName = team.name || 'Unnamed Team';
        var memberCount = members.length;

        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Kill Team \u2014 ' +
                    escapeHtml(teamName) +
                '</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-kill-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += '<p class="field-hint" ' +
                    'style="font-size:0.75rem;color:var(--text-dim);' +
                    'margin:0 0 10px 0;line-height:1.45;">' +
                    'Marks every member who was active in the ' +
                    'selected year as deceased in that year. ' +
                    'Relationships and open professional stints ' +
                    'close at the same year through the existing ' +
                    'death cascade.' +
                '</p>';

        html += '<div class="form-group" style="margin-bottom:10px;">';
        html += '<label for="kill-year" ' +
                    'style="font-size:0.7rem;color:var(--text-dim);' +
                    'display:block;margin-bottom:4px;">' +
                    'Year of Death' +
                '</label>';
        html += '<input type="number" id="kill-year" min="1" ' +
                    'value="' + escapeAttribute(String(year)) + '" ' +
                    'style="width:100%;padding:6px 8px;' +
                    'background:var(--bg);border:1px solid var(--border);' +
                    'color:var(--text);border-radius:4px;' +
                    'font-size:0.8rem;">';
        html += '</div>';

        html += '<div class="form-group" style="margin-bottom:10px;">';
        html += '<label for="kill-cause" ' +
                    'style="font-size:0.7rem;color:var(--text-dim);' +
                    'display:block;margin-bottom:4px;">' +
                    'Cause of Death (optional)' +
                '</label>';
        html += '<input type="text" id="kill-cause" ' +
                    'placeholder="Killed in action" ' +
                    'style="width:100%;padding:6px 8px;' +
                    'background:var(--bg);border:1px solid var(--border);' +
                    'color:var(--text);border-radius:4px;' +
                    'font-size:0.8rem;">';
        html += '</div>';

        html += '<div class="form-group" style="margin-bottom:10px;">';
        html += '<label style="font-size:0.7rem;' +
                    'color:var(--text-dim);display:block;' +
                    'margin-bottom:4px;">' +
                    'Members to be killed (' + memberCount + ')' +
                '</label>';
        html += '<div id="kill-member-list" ' +
                    'style="padding:8px 10px;background:var(--panel-alt);' +
                    'border:1px solid var(--border-soft);' +
                    'border-radius:6px;max-height:220px;' +
                    'overflow-y:auto;">';
        html += buildMemberListHTML(members, year);
        html += '</div>';
        html += '</div>';

        html += '<div id="kill-warning" ' +
                    'style="margin-top:8px;padding:8px 10px;' +
                    'background:var(--warning-soft);' +
                    'border-left:3px solid var(--warning);' +
                    'border-radius:4px;font-size:0.72rem;' +
                    'line-height:1.45;color:var(--text);">';
        html += '<strong style="color:var(--warning);">' +
                    '\u26a0 Warning:</strong> ' +
                'This cannot be undone through the UI. You can ' +
                'un-tick <em>deceased</em> on each character ' +
                'afterward, but the closed stints and ended ' +
                'relationships will not be restored.';
        html += '</div>';

        html += '</div>';

        html += '<div class="form-actions" ' +
                    'style="display:flex;gap:8px;' +
                    'justify-content:flex-end;' +
                    'margin-top:12px;padding-top:12px;' +
                    'border-top:1px solid var(--border-soft);">';
        html += '<button type="button" class="secondary" ' +
                    'data-kill-action="close">Cancel</button>';
        html += '<button type="button" class="danger" ' +
                    'data-kill-action="confirm">' +
                    'Kill ' + memberCount + ' Member' +
                    (memberCount === 1 ? '' : 's') +
                '</button>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // MODAL RENDER
    // ============================================================

    function refreshModalBody() {
        if (!_contentEl || !_teamId) { return; }

        var yearEl = _contentEl.querySelector('#kill-year');
        var year = yearEl ? parseYear(yearEl.value) : null;
        if (year === null) {
            year = getApplicationYear();
        }

        var team = TeamQueries.getTeamById(_teamId);
        if (!team) { return; }

        var membersAtYear = TeamQueries.getActiveTeamMembers(
            team, year
        );

        // Update member list.
        var listEl = _contentEl.querySelector('#kill-member-list');
        if (listEl) {
            listEl.innerHTML = buildMemberListHTML(
                membersAtYear, year
            );
        }

        // Update the member count in the label.
        var labelEls = _contentEl.querySelectorAll(
            '.form-group label'
        );
        for (var i = 0; i < labelEls.length; i++) {
            var text = labelEls[i].textContent || '';
            if (text.indexOf('Members to be killed') !== -1) {
                labelEls[i].textContent =
                    'Members to be killed (' +
                    membersAtYear.length + ')';
                break;
            }
        }

        // Update the confirm button count.
        var confirmBtn = _contentEl.querySelector(
            '[data-kill-action="confirm"]'
        );
        if (confirmBtn) {
            confirmBtn.textContent =
                'Kill ' + membersAtYear.length + ' Member' +
                (membersAtYear.length === 1 ? '' : 's');
            confirmBtn.disabled = membersAtYear.length === 0;
        }
    }

    // ============================================================
    // OPEN / CLOSE
    // ============================================================

    function openModal(teamId) {
        if (!teamId) {
            notify('No team selected.', 'error');
            return null;
        }

        var team = TeamQueries.getTeamById(teamId);
        if (!team) {
            notify('Team not found.', 'error');
            return null;
        }

        closeModal();

        _teamId = String(teamId);
        _busy = false;

        var startYear = parseYear(team.startPeriod) ||
            getApplicationYear();

        var shell = Modal.createModal('team-kill-modal');
        if (!shell) {
            notify('Could not open kill modal.', 'error');
            _teamId = null;
            return null;
        }
        shell.id = 'team-kill-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content';
        shell.appendChild(contentEl);

        _modal = shell;
        _contentEl = contentEl;

        var membersAtYear = TeamQueries.getActiveTeamMembers(
            team, startYear
        );

        contentEl.innerHTML = buildModalHTML(
            team, membersAtYear, startYear
        );

        _clickHandler = handleClick;
        _inputHandler = handleInput;

        contentEl.addEventListener('click', _clickHandler);
        contentEl.addEventListener('input', _inputHandler);
        contentEl.addEventListener('change', _inputHandler);

        Modal.modalSetup(shell, function() {
            closeModal();
        });
        Modal.showModal(shell);

        return shell;
    }

    function closeModal() {
        var modal = _modal;
        var contentEl = _contentEl;

        if (contentEl && _clickHandler) {
            try {
                contentEl.removeEventListener(
                    'click', _clickHandler
                );
            } catch (e) {}
        }
        if (contentEl && _inputHandler) {
            try {
                contentEl.removeEventListener(
                    'input', _inputHandler
                );
            } catch (e) {}
            try {
                contentEl.removeEventListener(
                    'change', _inputHandler
                );
            } catch (e) {}
        }

        _modal = null;
        _contentEl = null;
        _teamId = null;
        _clickHandler = null;
        _inputHandler = null;
        _busy = false;

        if (modal) {
            try { Modal.closeModal(modal); } catch (e) {}
        }
    }

    function handleClick(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') {
            return;
        }

        var actionEl = target.closest('[data-kill-action]');
        if (!actionEl || !actionEl.dataset) { return; }

        var action = actionEl.dataset.killAction;

        if (action === 'close') {
            e.preventDefault();
            if (_busy) { return; }
            closeModal();
            return;
        }

        if (action === 'confirm') {
            e.preventDefault();
            if (_busy) { return; }
            handleConfirm();
            return;
        }
    }

    function handleInput(e) {
        var target = e.target;
        if (!target) { return; }
        if (target.id === 'kill-year') {
            refreshModalBody();
        }
    }

    // ============================================================
    // CONFIRM
    // ============================================================

    function handleConfirm() {
        if (!_teamId || !_contentEl) { return; }

        var yearEl = _contentEl.querySelector('#kill-year');
        var causeEl = _contentEl.querySelector('#kill-cause');

        var year = yearEl ? parseYear(yearEl.value) : null;
        if (year === null) {
            notify('Enter a valid year.', 'error');
            return;
        }

        var cause = causeEl
            ? String(causeEl.value || '').trim()
            : '';

        var team = TeamQueries.getTeamById(_teamId);
        if (!team) {
            notify('Team not found.', 'error');
            return;
        }

        var membersAtYear = TeamQueries.getActiveTeamMembers(
            team, year
        );
        if (membersAtYear.length === 0) {
            notify(
                'No active members at year ' + year + '.',
                'error'
            );
            return;
        }

        if (!confirm(
            'Kill ' + membersAtYear.length + ' member' +
            (membersAtYear.length === 1 ? '' : 's') +
            ' of "' + (team.name || 'this team') +
            '" in year ' + year + '? This cannot be undone ' +
            'through the UI.'
        )) {
            return;
        }

        _busy = true;
        setBusy(true);

        var teamId = _teamId;
        var teamName = team.name || 'Team';

        killAllMembers(teamId, year, cause)
            .then(function(result) {
                _busy = false;

                if (result.error && result.killed === 0) {
                    notify(result.error, 'error');
                    setBusy(false);
                    return;
                }

                var parts = [];
                if (result.killed > 0) {
                    parts.push('killed ' + result.killed);
                }
                if (result.failed > 0) {
                    parts.push('failed ' + result.failed);
                }
                if (result.deprecated) {
                    parts.push('team deprecated');
                }

                var message = teamName + ': ' +
                    (parts.length > 0
                        ? parts.join(', ')
                        : 'no changes') + '.';

                notify(
                    message,
                    result.failed > 0 ? 'warning' : 'success'
                );

                if (Array.isArray(result.failures) &&
                    result.failures.length > 0) {
                    for (var i = 0; i < result.failures.length; i++) {
                        var f = result.failures[i];
                        console.warn(
                            '[TeamKillModal] Failed on ' +
                            f.name + ' (' + f.characterId + '): ' +
                            f.error
                        );
                    }
                }

                closeModal();

                // Ask TeamEvents to refresh the list.
                var TE = window.TeamEvents;
                if (TE && typeof TE.refreshUI === 'function') {
                    try { TE.refreshUI(); } catch (e) {}
                }
            })
            .catch(function(err) {
                _busy = false;
                setBusy(false);
                console.warn(
                    '[TeamKillModal] killAllMembers threw:', err
                );
                notify(
                    'Failed to kill team: ' +
                    (err && err.message ? err.message : String(err)),
                    'error'
                );
            });
    }

    function setBusy(busy) {
        if (!_contentEl) { return; }

        var confirmBtn = _contentEl.querySelector(
            '[data-kill-action="confirm"]'
        );
        if (confirmBtn) {
            confirmBtn.disabled = busy;
            if (busy) {
                confirmBtn.textContent = 'Killing...';
            }
        }

        var closeBtns = _contentEl.querySelectorAll(
            '[data-kill-action="close"]'
        );
        for (var i = 0; i < closeBtns.length; i++) {
            closeBtns[i].disabled = busy;
        }

        var inputs = _contentEl.querySelectorAll('input');
        for (var j = 0; j < inputs.length; j++) {
            inputs[j].disabled = busy;
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.TeamKillModal = Object.freeze({
        openModal: openModal,
        closeModal: closeModal,

        // Exposed for tests
        killAllMembers: killAllMembers,
        killOneCharacter: killOneCharacter,
        buildDeathDto: buildDeathDto
    });

})();
