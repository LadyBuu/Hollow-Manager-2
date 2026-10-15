/**
 * modules/characters/filler-manager-modal.js - Filler Manager
 * Maintenance UI for flagging characters as filler.
 *
 * Path: js/modules/characters/filler-manager-modal.js
 *
 * WHAT THIS MODULE DOES:
 *   - Opens a modal listing every character with a checkbox.
 *   - Pre-checks anyone already flagged char.isFiller === true.
 *   - Provides "Select all candidates" (heuristic-driven) and
 *     "Clear all" buttons.
 *   - On Apply, calls CharacterCRUD.setFillerFlag(ids, value) for
 *     the newly-checked and newly-unchecked sets.
 *
 * WHAT THIS MODULE DOES NOT DO:
 *   - It does not mutate window.data directly.
 *   - It does not perform the strip. That is CharacterCRUD's job,
 *     driven by the flag.
 *   - It does not decide the heuristic. That lives in
 *     CharacterStrip.isFillerCandidate.
 *
 * AUTHORED-CONTENT CHECK:
 *   Flagging a character as filler here runs the same
 *   CharacterStrip.hasAuthoredContent check that CharacterCRUD's
 *   save path runs. A character with authored content is skipped
 *   and reported, rather than silently flagged and stripped.
 *
 *   The two paths (this modal's bulk flag and CharacterCRUD's
 *   save) must agree on what "filler" means. This module enforces
 *   the check at the modal layer. CharacterCRUD.setFillerFlag is
 *   expected to enforce it too when called from other callers; if
 *   it does not, this modal is the only place the check runs. See
 *   the character-crud.js batch for the matching enforcement.
 *
 * MODAL LIFECYCLE:
 *   Close and outside-click handling are delegated to
 *   Modal.modalSetup. Escape now works. Drag-release guard
 *   applies.
 *
 * LOAD ORDER:
 *   This module loads cleanly regardless of script order. All
 *   dependencies are resolved at call time. A missing dependency
 *   produces a clear error the first time openModal is called.
 *
 * DEPENDENCIES (LAZY):
 *   - window.CharacterQueries
 *   - window.CharacterCRUD
 *   - window.CharacterStrip
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.DomUtils (for escaping; fallback otherwise)
 */

(function() {
    'use strict';

    if (window.__fillerManagerModalLoaded) {
        return;
    }
    window.__fillerManagerModalLoaded = true;

    // ============================================================
    // DEPENDENCY ACCESS - LAZY
    // ============================================================

    function getCharacterQueries() { return window.CharacterQueries || null; }
    function getCharacterCRUD() { return window.CharacterCRUD || null; }
    function getCharacterStrip() { return window.CharacterStrip || null; }
    function getModal() { return window.Modal || null; }
    function getNotificationSystem() { return window.NotificationSystem || null; }
    function getDomUtils() { return window.DomUtils || null; }

    // ============================================================
    // DEPENDENCY CHECK - at open time
    // ============================================================

    function checkDependencies() {
        var missing = [];

        var CQ = getCharacterQueries();
        if (!CQ || typeof CQ.getCharacters !== 'function') {
            missing.push('CharacterQueries.getCharacters');
        }
        if (!CQ || typeof CQ.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        var CRUD = getCharacterCRUD();
        if (!CRUD || typeof CRUD.setFillerFlag !== 'function') {
            missing.push('CharacterCRUD.setFillerFlag');
        }

        var Strip = getCharacterStrip();
        if (!Strip || typeof Strip.isFillerCandidate !== 'function') {
            missing.push('CharacterStrip.isFillerCandidate');
        }
        if (!Strip || typeof Strip.hasAuthoredContent !== 'function') {
            missing.push('CharacterStrip.hasAuthoredContent');
        }

        var M = getModal();
        if (!M ||
            typeof M.createModal !== 'function' ||
            typeof M.showModal !== 'function' ||
            typeof M.closeModal !== 'function' ||
            typeof M.modalSetup !== 'function') {
            missing.push('Modal API');
        }

        var NS = getNotificationSystem();
        if (!NS || typeof NS.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (missing.length > 0) {
            var msg = '[FillerManagerModal] Missing mandatory ' +
                'dependencies: ' + missing.join(', ');
            console.error(msg);
            throw new Error(msg);
        }

        return true;
    }

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _modal = null;
    var _checkedIds = Object.create(null);
    var _initialCheckedIds = Object.create(null);

    // ============================================================
    // HELPERS
    // ============================================================

    function escapeHtml(value) {
        var DU = getDomUtils();
        if (DU && typeof DU.escapeHtml === 'function') {
            return DU.escapeHtml(value);
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
        var DU = getDomUtils();
        if (DU && typeof DU.escapeAttribute === 'function') {
            return DU.escapeAttribute(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function notify(message, type) {
        var NS = getNotificationSystem();
        if (NS && typeof NS.notify === 'function') {
            NS.notify(message, type || 'info');
        }
    }

    function getCharacters() {
        var CQ = getCharacterQueries();
        if (!CQ || typeof CQ.getCharacters !== 'function') { return []; }
        var chars = CQ.getCharacters();
        if (!Array.isArray(chars)) { return []; }
        // Return a slice so callers cannot mutate the live store.
        return chars.slice();
    }

    function hasOwnKey(obj, key) {
        return Object.prototype.hasOwnProperty.call(obj, key);
    }

    // ============================================================
    // OPEN
    // ============================================================

    function openModal() {
        try {
            checkDependencies();
        } catch (e) {
            notify('Filler manager is not available.', 'error');
            return;
        }

        closeModal();

        _checkedIds = Object.create(null);
        _initialCheckedIds = Object.create(null);

        var chars = getCharacters();
        for (var i = 0; i < chars.length; i++) {
            var c = chars[i];
            if (!c || !c.id) { continue; }
            if (c.isFiller === true) {
                _checkedIds[String(c.id)] = true;
                _initialCheckedIds[String(c.id)] = true;
            }
        }

        var M = getModal();
        var modal = M.createModal('filler-manager-modal');
        if (!modal) {
            notify('Could not open filler manager.', 'error');
            return;
        }
        modal.id = 'filler-manager-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content wide';
        modal.appendChild(contentEl);

        _modal = modal;

        M.modalSetup(modal, function() {
            closeModal();
        });
        M.showModal(modal);

        render(modal, contentEl);
        bind(modal, contentEl);
    }

    function closeModal() {
        var modal = _modal;

        _modal = null;

        if (modal) {
            try {
                var M = getModal();
                if (M && typeof M.closeModal === 'function') {
                    M.closeModal(modal);
                }
            } catch (e) {
                // Ignore.
            }
        }
    }

    // ============================================================
    // RENDER
    // ============================================================

    function render(modal, contentEl) {
        var CQ = getCharacterQueries();
        var Strip = getCharacterStrip();
        var chars = getCharacters();

        // Sort: candidates first (checked or heuristic), then
        // alphabetical. Puts the actionable rows at the top.
        var sorted = chars.slice().sort(function(a, b) {
            var aChecked = _checkedIds[String(a.id)] === true;
            var bChecked = _checkedIds[String(b.id)] === true;
            if (aChecked !== bChecked) {
                return aChecked ? -1 : 1;
            }
            var aName = CQ.getDisplayName(a) || '';
            var bName = CQ.getDisplayName(b) || '';
            return aName.localeCompare(bName);
        });

        var totalCount = sorted.length;
        var checkedCount = Object.keys(_checkedIds).length;
        var heuristicCount = 0;
        for (var h = 0; h < sorted.length; h++) {
            if (Strip.isFillerCandidate(sorted[h])) {
                heuristicCount++;
            }
        }

        var html = '';

        html += '<div class="modal-header">';
        html += '<h3 id="filler-manager-title">' +
                    'Manage Filler Characters' +
                '</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'id="close-filler-manager" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += '<p class="field-hint filler-manager-hint">' +
                    'Flag characters as filler to strip their empty ' +
                    'fields on save. Flagged characters keep their ' +
                    'name, career, class, teams, eliminations, and ' +
                    'parent links. Characters with authored content ' +
                    '(stats, magic, personality, notes, or HP/MP) are ' +
                    'skipped by this tool and must be flagged from ' +
                    'their own record. Unchecking does not restore ' +
                    'stripped fields; the next edit re-populates ' +
                    'them.' +
                '</p>';

        html += '<div class="filler-manager-toolbar">';
        html += '<button type="button" id="filler-select-candidates" ' +
                    'class="small secondary">' +
                    'Select all candidates (' + heuristicCount + ')' +
                '</button>';
        html += '<button type="button" id="filler-clear-all" ' +
                    'class="small secondary">Clear all</button>';
        html += '<span class="filler-manager-count">' +
                    'Selected: <strong id="filler-selected-count">' +
                        checkedCount +
                    '</strong> / ' + totalCount +
                '</span>';
        html += '</div>';

        html += '<div class="filler-manager-list" ' +
                    'id="filler-manager-list">';

        for (var i = 0; i < sorted.length; i++) {
            var c = sorted[i];
            if (!c || !c.id) { continue; }
            var cid = String(c.id);
            var checked = _checkedIds[cid] === true;
            var name = CQ.getDisplayName(c) || 'Unknown';
            var isCandidate = Strip.isFillerCandidate(c);

            var rowClass = 'filler-manager-row';
            if (checked) { rowClass += ' is-checked'; }
            if (isCandidate) { rowClass += ' is-candidate'; }

            html += '<label class="' + rowClass + '" ' +
                        'data-character-id="' + escapeAttribute(cid) + '">';
            html += '<input type="checkbox" class="filler-row-check" ' +
                        'data-id="' + escapeAttribute(cid) + '"' +
                        (checked ? ' checked' : '') + '>';
            html += '<span class="filler-manager-name">' +
                        escapeHtml(name) +
                    '</span>';
            if (isCandidate) {
                html += '<span class="filler-manager-badge" ' +
                            'title="No authored content: stats, ' +
                            'personality, and notes are all empty or ' +
                            'default.">Candidate</span>';
            }
            html += '</label>';
        }

        html += '</div>';   // .filler-manager-list

        html += '<div class="form-actions">';
        html += '<button type="button" id="filler-cancel" ' +
                    'class="secondary">Cancel</button>';
        html += '<button type="button" id="filler-apply" ' +
                    'class="primary">Apply</button>';
        html += '</div>';

        html += '</div>';   // .modal-body

        contentEl.innerHTML = html;
    }

    // ============================================================
    // BIND
    // ============================================================

    function bind(modal, contentEl) {
        var closeBtn = contentEl.querySelector('#close-filler-manager');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                closeModal();
            });
        }

        var cancelBtn = contentEl.querySelector('#filler-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function() {
                closeModal();
            });
        }

        var applyBtn = contentEl.querySelector('#filler-apply');
        if (applyBtn) {
            applyBtn.addEventListener('click', function() {
                handleApply();
            });
        }

        var selectCandidates = contentEl.querySelector(
            '#filler-select-candidates'
        );
        if (selectCandidates) {
            selectCandidates.addEventListener('click', function() {
                handleSelectCandidates(contentEl);
            });
        }

        var clearAll = contentEl.querySelector('#filler-clear-all');
        if (clearAll) {
            clearAll.addEventListener('click', function() {
                handleClearAll(contentEl);
            });
        }

        contentEl.addEventListener('change', function(e) {
            var target = e.target;
            if (!target || !target.classList) { return; }
            if (!target.classList.contains('filler-row-check')) {
                return;
            }
            var id = target.dataset ? target.dataset.id : null;
            if (!id) { return; }
            if (target.checked) {
                _checkedIds[id] = true;
            } else {
                delete _checkedIds[id];
            }
            updateCounts(contentEl);
        });
    }

    function handleSelectCandidates(contentEl) {
        var Strip = getCharacterStrip();
        var chars = getCharacters();
        for (var i = 0; i < chars.length; i++) {
            var c = chars[i];
            if (!c || !c.id) { continue; }
            if (Strip.isFillerCandidate(c)) {
                _checkedIds[String(c.id)] = true;
            }
        }
        syncCheckboxesFromState(contentEl);
    }

    function handleClearAll(contentEl) {
        _checkedIds = Object.create(null);
        syncCheckboxesFromState(contentEl);
    }

    function syncCheckboxesFromState(contentEl) {
        var boxes = contentEl.querySelectorAll('.filler-row-check');
        for (var i = 0; i < boxes.length; i++) {
            var box = boxes[i];
            var id = box.dataset ? box.dataset.id : null;
            if (!id) { continue; }
            box.checked = _checkedIds[id] === true;

            var row = box.closest
                ? box.closest('.filler-manager-row')
                : null;
            if (row) {
                if (box.checked) {
                    row.classList.add('is-checked');
                } else {
                    row.classList.remove('is-checked');
                }
            }
        }
        updateCounts(contentEl);
    }

    function updateCounts(contentEl) {
        var countEl = contentEl.querySelector(
            '#filler-selected-count'
        );
        if (countEl) {
            countEl.textContent = String(
                Object.keys(_checkedIds).length
            );
        }
    }

    // ============================================================
    // APPLY
    // ============================================================

    function handleApply() {
        var Strip = getCharacterStrip();
        var CRUD = getCharacterCRUD();

        // Collect the union of currently-checked and
        // initially-checked IDs. Only IDs that changed state
        // between open and apply are acted on.
        var allIds = Object.create(null);
        var k;

        var checkedKeys = Object.keys(_checkedIds);
        for (k = 0; k < checkedKeys.length; k++) {
            allIds[checkedKeys[k]] = true;
        }

        var initialKeys = Object.keys(_initialCheckedIds);
        for (k = 0; k < initialKeys.length; k++) {
            allIds[initialKeys[k]] = true;
        }

        var toFlag = [];
        var toUnflag = [];
        var skippedForAuthoredContent = [];

        var idList = Object.keys(allIds);
        for (var i = 0; i < idList.length; i++) {
            var id = idList[i];
            var nowChecked = _checkedIds[id] === true;
            var wasChecked = _initialCheckedIds[id] === true;

            if (nowChecked && !wasChecked) {
                // Flagging as filler. Enforce the authored-content
                // check that CharacterCRUD.save performs on the
                // save path. A character with authored content is
                // skipped and reported, not silently flagged.
                var char = findCharacterById(id);
                if (char && Strip.hasAuthoredContent(char)) {
                    skippedForAuthoredContent.push(id);
                } else {
                    toFlag.push(id);
                }
            } else if (!nowChecked && wasChecked) {
                toUnflag.push(id);
            }
        }

        if (toFlag.length === 0 &&
            toUnflag.length === 0 &&
            skippedForAuthoredContent.length === 0) {
            notify('No changes to apply.', 'info');
            closeModal();
            return;
        }

        if (toFlag.length === 0 &&
            toUnflag.length === 0 &&
            skippedForAuthoredContent.length > 0) {
            notify(
                'No characters flagged: ' +
                skippedForAuthoredContent.length +
                ' selected character' +
                (skippedForAuthoredContent.length === 1 ? '' : 's') +
                ' has authored content. Flag those from their own ' +
                'record.',
                'warning'
            );
            closeModal();
            return;
        }

        // Flag first (strip), then unflag.
        var chain = Promise.resolve();

        if (toFlag.length > 0) {
            chain = chain.then(function() {
                return CRUD.setFillerFlag(toFlag, true);
            });
        }
        if (toUnflag.length > 0) {
            chain = chain.then(function() {
                return CRUD.setFillerFlag(toUnflag, false);
            });
        }

        chain.then(function() {
            var parts = [];
            if (toFlag.length > 0) {
                parts.push('flagged ' + toFlag.length);
            }
            if (toUnflag.length > 0) {
                parts.push('unflagged ' + toUnflag.length);
            }
            if (skippedForAuthoredContent.length > 0) {
                parts.push(
                    'skipped ' + skippedForAuthoredContent.length +
                    ' (authored content)'
                );
            }
            notify(
                'Filler update: ' + parts.join(', ') + '.',
                skippedForAuthoredContent.length > 0
                    ? 'warning'
                    : 'success'
            );
            closeModal();
        }).catch(function(err) {
            console.warn(
                '[FillerManagerModal] apply failed:', err
            );
            notify(
                'Failed to update filler flags.',
                'error'
            );
        });
    }

    function findCharacterById(id) {
        var CQ = getCharacterQueries();
        if (!CQ || typeof CQ.getCharacterById !== 'function') {
            return null;
        }
        return CQ.getCharacterById(id);
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.FillerManagerModal = Object.freeze({
        openModal: openModal,
        closeModal: closeModal
    });

})();
