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
 *   The check runs at Apply time, against live state. The check
 *   the CRUD runs is the authoritative one; the one here is a
 *   pre-filter that keeps the modal from offering a row the user
 *   cannot act on. If a character gains authored content between
 *   the modal opening and Apply, the CRUD's check (which runs on
 *   the same snapshot) will catch it. See the note below.
 *
 *   THIS MODAL IS THE ONLY PLACE THE AUTHORED-CONTENT CHECK RUNS
 *   BEFORE A BULK FLAG. CharacterCRUD.setFillerFlag does NOT
 *   re-check; it strips when told to. A caller that reaches
 *   setFillerFlag directly (not through this modal) can strip a
 *   character that has authored content. Adding the check to
 *   setFillerFlag is the correct fix, and belongs in
 *   character-crud.js. Until then this modal is the sole
 *   enforcement point for bulk flagging, and the report below is
 *   how the user learns what was skipped.
 *
 * FLAG/UNFLAG ARE NOT ATOMIC:
 *   The Apply step runs flag-then-unflag as two separate
 *   CharacterCRUD.setFillerFlag calls. Each call is its own
 *   pipeline transaction. If the first succeeds and the second
 *   fails, the first is committed. The modal reports that as a
 *   partial success and does not close silently; the user sees
 *   "flagged N, unflag failed: ..." and can retry the unflag by
 *   reopening the modal.
 *
 *   Making the pair atomic requires a batch API in
 *   CharacterCRUD. That is a domain-layer change, not a UI-layer
 *   one; the modal deliberately does not attempt to emulate
 *   atomicity with retries or rollbacks, because a rollback of a
 *   committed pipeline transaction is not something this layer
 *   can do safely.
 *
 * MODAL LIFECYCLE:
 *   Close and outside-click handling are delegated to
 *   Modal.modalSetup. Escape works. Drag-release guard applies.
 *
 *   Render runs BEFORE show. The modal shell is created, the
 *   content is written into it, and THEN it is shown. This
 *   avoids the frame of empty modal that a show-then-render
 *   sequence produces, and it makes the focus-trapping query in
 *   modal.js see the populated body on its first focus pass.
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
        if (!CQ || typeof CQ.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
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
    var _contentEl = null;

    // The set of ids currently ticked. Keyed by string id.
    var _checkedIds = Object.create(null);

    // The set of ids that were ticked when the modal opened. Used
    // to compute the diff at Apply time: only ids whose state
    // changed are acted on.
    var _initialCheckedIds = Object.create(null);

    // The last-computed candidate set. Populated on every render,
    // so Select-all-candidates and the "N candidates" hint use
    // the same determination and the check runs exactly once per
    // character per render.
    var _candidateIds = Object.create(null);
    var _candidateCount = 0;

    // A per-row click handler and a change handler, both bound to
    // contentEl in `bind`. Held here so `closeModal` can remove
    // them cleanly.
    var _contentClickHandler = null;
    var _contentChangeHandler = null;

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
        return chars.slice();
    }

    function countTrue(obj) {
        var n = 0;
        var keys = Object.keys(obj);
        for (var i = 0; i < keys.length; i++) {
            if (obj[keys[i]] === true) { n++; }
        }
        return n;
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
        _candidateIds = Object.create(null);
        _candidateCount = 0;

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
        _contentEl = contentEl;

        M.modalSetup(modal, function() {
            closeModal();
        });

        // Render BEFORE show. The modal shell exists but is
        // hidden; we populate its content, then show it. This is
        // the fix for the "modal appears empty for a frame"
        // problem, and it makes the focus-trap's first query see
        // the fully-populated body.
        render(modal, contentEl);
        bind(modal, contentEl);

        M.showModal(modal);
    }

    function closeModal() {
        var modal = _modal;
        var contentEl = _contentEl;

        if (contentEl && _contentClickHandler) {
            try {
                contentEl.removeEventListener(
                    'click', _contentClickHandler
                );
            } catch (e) { /* ignore */ }
        }
        if (contentEl && _contentChangeHandler) {
            try {
                contentEl.removeEventListener(
                    'change', _contentChangeHandler
                );
            } catch (e) { /* ignore */ }
        }

        _modal = null;
        _contentEl = null;
        _contentClickHandler = null;
        _contentChangeHandler = null;

        // Retain the checked/candidate state only for the
        // duration of a modal session. Clearing here means a
        // subsequent open starts fresh.
        _checkedIds = Object.create(null);
        _initialCheckedIds = Object.create(null);
        _candidateIds = Object.create(null);
        _candidateCount = 0;

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

        // ---- Rebuild the candidate set exactly once. ----
        //
        // The previous version ran isFillerCandidate twice per
        // character (once to count, once to render). Both
        // determinations must agree, and both must agree with the
        // Select-all-candidates action. Caching the set here
        // guarantees that.
        _candidateIds = Object.create(null);
        _candidateCount = 0;

        var candidateNameById = Object.create(null);
        var nameById = Object.create(null);

        for (var c = 0; c < chars.length; c++) {
            var cc = chars[c];
            if (!cc || !cc.id) { continue; }
            var cid = String(cc.id);
            nameById[cid] = CQ.getDisplayName(cc) || 'Unknown';
            if (Strip.isFillerCandidate(cc)) {
                _candidateIds[cid] = true;
                _candidateCount++;
                candidateNameById[cid] = nameById[cid];
            }
        }

        // ---- Sort: checked first, then candidates, then the
        //      rest, alphabetically within each tier. ----
        //
        // "Checked first" means the rows whose isFiller is
        // currently true, at open. Ticking a row during this
        // session does NOT reorder it. That is intentional:
        // reordering on tick would move the row out from under
        // the user's cursor.
        var sorted = chars.slice().sort(function(a, b) {
            if (!a || !b || !a.id || !b.id) { return 0; }
            var aId = String(a.id);
            var bId = String(b.id);
            var aChecked = _checkedIds[aId] === true;
            var bChecked = _checkedIds[bId] === true;
            if (aChecked !== bChecked) {
                return aChecked ? -1 : 1;
            }
            var aCand = _candidateIds[aId] === true;
            var bCand = _candidateIds[bId] === true;
            if (aCand !== bCand) {
                return aCand ? -1 : 1;
            }
            var aName = nameById[aId] || '';
            var bName = nameById[bId] || '';
            return aName.localeCompare(bName);
        });

        var totalCount = sorted.length;
        var checkedCount = countTrue(_checkedIds);

        // ---- Prune the checked set against live characters. ----
        //
        // A character deleted since the modal opened should not
        // be counted or acted on. The count and the render both
        // read the pruned set. Pruning is idempotent.
        var liveIds = Object.create(null);
        for (var li = 0; li < chars.length; li++) {
            var lc = chars[li];
            if (lc && lc.id) {
                liveIds[String(lc.id)] = true;
            }
        }
        var checkedKeys = Object.keys(_checkedIds);
        for (var ck = 0; ck < checkedKeys.length; ck++) {
            if (!liveIds[checkedKeys[ck]]) {
                delete _checkedIds[checkedKeys[ck]];
            }
        }
        var initialKeys = Object.keys(_initialCheckedIds);
        for (var ik = 0; ik < initialKeys.length; ik++) {
            if (!liveIds[initialKeys[ik]]) {
                delete _initialCheckedIds[initialKeys[ik]];
            }
        }
        checkedCount = countTrue(_checkedIds);

        // ---- Build the HTML. ----
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
                    'Flagging marks a character as filler. On save ' +
                    'the record is stripped to its meaningful ' +
                    'fields; its name, career, class, teams, ' +
                    'eliminations, and parent links are kept. ' +
                    'Characters with any authored content \u2014 ' +
                    'stats, magic, personality, weapons, moves, ' +
                    'bio fields, HP, or MP \u2014 are skipped by ' +
                    'this tool and must be flagged from their own ' +
                    'record. Unflagging clears the flag only; ' +
                    'fields that were stripped in a previous save ' +
                    'are not restored.' +
                '</p>';

        html += '<div class="filler-manager-toolbar">';
        html += '<button type="button" id="filler-select-candidates" ' +
                    'class="small secondary">' +
                    'Select all candidates (' + _candidateCount + ')' +
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
            var row = sorted[i];
            if (!row || !row.id) { continue; }
            var rowId = String(row.id);
            var isChecked = _checkedIds[rowId] === true;
            var rowName = nameById[rowId] || 'Unknown';
            var isCandidate = _candidateIds[rowId] === true;

            var rowClass = 'filler-manager-row';
            if (isChecked) { rowClass += ' is-checked'; }
            if (isCandidate) { rowClass += ' is-candidate'; }

            html += '<label class="' + rowClass + '" ' +
                        'data-character-id="' +
                            escapeAttribute(rowId) + '">';
            html += '<input type="checkbox" class="filler-row-check" ' +
                        'data-id="' + escapeAttribute(rowId) + '"' +
                        (isChecked ? ' checked' : '') + '>';
            html += '<span class="filler-manager-name">' +
                        escapeHtml(rowName) +
                    '</span>';
            if (isCandidate) {
                html += '<span class="filler-manager-badge" ' +
                            'title="No authored content. Can be ' +
                            'flagged as filler.">Candidate</span>';
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
        _contentClickHandler = function(e) {
            handleContentClick(e, contentEl);
        };
        _contentChangeHandler = function(e) {
            handleContentChange(e, contentEl);
        };

        contentEl.addEventListener('click', _contentClickHandler);
        contentEl.addEventListener('change', _contentChangeHandler);
    }

    function handleContentClick(e, contentEl) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') { return; }

        var btn = target.closest('button');
        if (!btn || !btn.id) { return; }

        if (btn.id === 'close-filler-manager' ||
            btn.id === 'filler-cancel') {
            e.preventDefault();
            closeModal();
            return;
        }

        if (btn.id === 'filler-apply') {
            e.preventDefault();
            handleApply();
            return;
        }

        if (btn.id === 'filler-select-candidates') {
            e.preventDefault();
            handleSelectCandidates(contentEl);
            return;
        }

        if (btn.id === 'filler-clear-all') {
            e.preventDefault();
            handleClearAll(contentEl);
            return;
        }
    }

    function handleContentChange(e, contentEl) {
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
    }

    function handleSelectCandidates(contentEl) {
        // The candidate set was computed at render time. Using
        // that set here (rather than re-running the heuristic)
        // guarantees agreement between the badge, the count, and
        // this action.
        var keys = Object.keys(_candidateIds);
        for (var i = 0; i < keys.length; i++) {
            _checkedIds[keys[i]] = true;
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
            countEl.textContent = String(countTrue(_checkedIds));
        }
    }

    // ============================================================
    // APPLY
    // ============================================================

    /**
     * The Apply step.
     *
     * Ids are partitioned into three groups:
     *
     *   toFlag       newly checked, no authored content
     *   toUnflag     newly unchecked
     *   toSkip       newly checked, but has authored content
     *
     * The authored-content check is the same one CharacterCRUD.save
     * runs. See the AUTHORED-CONTENT CHECK note in the header for
     * why this modal is currently the only enforcement point for
     * a bulk flag.
     *
     * Each group runs as its own CharacterCRUD.setFillerFlag call.
     * Both calls are awaited; both results are checked. A failed
     * step is reported, and the modal does NOT close on a partial
     * failure.
     */
    function handleApply() {
        var Strip = getCharacterStrip();
        var CRUD = getCharacterCRUD();

        // ---- Collect the union of currently-checked and
        //      initially-checked ids. ----
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
        var missingCharacterIds = [];

        var idList = Object.keys(allIds);
        for (var i = 0; i < idList.length; i++) {
            var id = idList[i];
            var nowChecked = _checkedIds[id] === true;
            var wasChecked = _initialCheckedIds[id] === true;

            if (nowChecked && !wasChecked) {
                var char = findCharacterById(id);
                if (!char) {
                    // Character was deleted between open and
                    // Apply. Nothing to do; report it.
                    missingCharacterIds.push(id);
                    continue;
                }
                if (Strip.hasAuthoredContent(char)) {
                    skippedForAuthoredContent.push(id);
                } else {
                    toFlag.push(id);
                }
            } else if (!nowChecked && wasChecked) {
                // Unflag path. No authored-content check: the
                // character is currently flagged, and the CRUD
                // will clear the flag without stripping.
                toUnflag.push(id);
            }
        }

        // ---- Nothing to do? ----
        if (toFlag.length === 0 &&
            toUnflag.length === 0 &&
            skippedForAuthoredContent.length === 0 &&
            missingCharacterIds.length === 0) {
            notify('No changes to apply.', 'info');
            closeModal();
            return;
        }

        // ---- Everything to do was skipped? ----
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

        // ---- Flag first, then unflag. Both results checked. ----
        var flaggedCount = 0;
        var unflaggedCount = 0;
        var flagFailed = false;
        var flagFailureMessage = '';
        var unflagFailed = false;
        var unflagFailureMessage = '';

        var chain = Promise.resolve();

        if (toFlag.length > 0) {
            chain = chain.then(function() {
                return CRUD.setFillerFlag(toFlag, true)
                    .then(function(result) {
                        if (result && result.success) {
                            flaggedCount = toFlag.length;
                            return;
                        }
                        flagFailed = true;
                        flagFailureMessage =
                            (result && result.message) ||
                            'Unknown error.';
                    })
                    .catch(function(err) {
                        flagFailed = true;
                        flagFailureMessage =
                            (err && err.message)
                                ? err.message
                                : String(err);
                    });
            });
        }

        chain = chain.then(function() {
            // If the flag step failed, do not run unflag. The
            // two steps are not atomic, and running the second
            // on top of a failed first would make the final
            // state harder to reason about. Report and stop.
            if (flagFailed) { return; }
            if (toUnflag.length === 0) { return; }

            return CRUD.setFillerFlag(toUnflag, false)
                .then(function(result) {
                    if (result && result.success) {
                        unflaggedCount = toUnflag.length;
                        return;
                    }
                    unflagFailed = true;
                    unflagFailureMessage =
                        (result && result.message) ||
                        'Unknown error.';
                })
                .catch(function(err) {
                    unflagFailed = true;
                    unflagFailureMessage =
                        (err && err.message)
                            ? err.message
                            : String(err);
                });
        });

        chain.then(function() {
            var anyFailure = flagFailed || unflagFailed;

            // ---- Build the report. ----
            var parts = [];

            if (flaggedCount > 0) {
                parts.push('flagged ' + flaggedCount);
            }
            if (unflaggedCount > 0) {
                parts.push('unflagged ' + unflaggedCount);
            }
            if (skippedForAuthoredContent.length > 0) {
                parts.push(
                    'skipped ' + skippedForAuthoredContent.length +
                    ' (authored content)'
                );
            }
            if (missingCharacterIds.length > 0) {
                parts.push(
                    'skipped ' + missingCharacterIds.length +
                    ' (character no longer exists)'
                );
            }
            if (flagFailed) {
                parts.push(
                    'flag failed: ' + flagFailureMessage
                );
            }
            if (unflagFailed) {
                parts.push(
                    'unflag failed: ' + unflagFailureMessage
                );
            }

            var message = 'Filler update: ' +
                (parts.length > 0
                    ? parts.join(', ')
                    : 'no changes') + '.';

            // ---- Report detail to the console when there is a
            //      skip or a failure the user might want to act
            //      on. The toast carries the headline. ----
            if (skippedForAuthoredContent.length > 0) {
                console.warn(
                    '[FillerManagerModal] Skipped (authored ' +
                    'content): ' +
                    describeIds(skippedForAuthoredContent)
                );
            }
            if (missingCharacterIds.length > 0) {
                console.warn(
                    '[FillerManagerModal] Skipped (missing ' +
                    'character): ' +
                    describeIds(missingCharacterIds)
                );
            }
            if (flagFailed) {
                console.warn(
                    '[FillerManagerModal] Flag step failed:',
                    flagFailureMessage
                );
            }
            if (unflagFailed) {
                console.warn(
                    '[FillerManagerModal] Unflag step failed:',
                    unflagFailureMessage
                );
            }

            var toastType = anyFailure
                ? 'error'
                : (skippedForAuthoredContent.length > 0 ||
                   missingCharacterIds.length > 0)
                    ? 'warning'
                    : 'success';

            notify(message, toastType);

            // ---- Close only on a clean apply. ----
            //
            // A failure leaves the modal open so the user can
            // retry the failed step (the diff logic keeps the
            // state consistent: only the flag succeeded, so the
            // retry sees the same toUnflag set). A warning-only
            // apply closes, matching the previous behaviour for
            // the "nothing to flag" path.
            if (!anyFailure) {
                closeModal();
            }
        }).catch(function(err) {
            console.warn(
                '[FillerManagerModal] apply chain threw:', err
            );
            notify(
                'Filler update failed: ' +
                (err && err.message ? err.message : String(err)),
                'error'
            );
            // Leave the modal open so the user can retry.
        });
    }

    /**
     * Format a list of ids for a console line. Ids are not
     * human-friendly, so each one is resolved to a display name
     * when possible. Falls back to the id itself.
     */
    function describeIds(ids) {
        var CQ = getCharacterQueries();
        var out = [];
        for (var i = 0; i < ids.length; i++) {
            var char = CQ && typeof CQ.getCharacterById === 'function'
                ? CQ.getCharacterById(ids[i])
                : null;
            if (char && typeof CQ.getDisplayName === 'function') {
                out.push(CQ.getDisplayName(char) + ' (' +
                    ids[i] + ')');
            } else {
                out.push(ids[i]);
            }
        }
        return out.join(', ');
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
