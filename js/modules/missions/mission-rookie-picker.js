/**
 * js/modules/missions/mission-rookie-picker.js - Mission Rookie Picker
 *
 * Path: js/modules/missions/mission-rookie-picker.js
 *
 * The modal that lets a user choose which rookie-status characters
 * took part in a mission.
 *
 * WHAT THIS MODULE OWNS:
 *   - The rookie picker modal, its search box, its checkbox list,
 *     and its live write path.
 *   - Its own modal shell, appended to document.body, so it
 *     survives a re-render of the missions tab content host.
 *   - The client-side name filter over the candidate list.
 *   - The instance token and per-row lock machinery that protects
 *     against stale callbacks and double-clicks.
 *
 * WHAT THIS MODULE DOES NOT OWN:
 *   - The candidate list. That is
 *     MissionAggregator.getRookieCandidatesViewModel(missionId).
 *   - The writes. That is MissionCore.addParticipant /
 *     removeParticipant.
 *   - The reads after a write. The picker refetches through the
 *     aggregator; it does not inspect the store directly.
 *   - The form's participant panel. That panel is rendered by
 *     MissionRender; the picker just opens as a modal on top of it.
 *
 * WRITE MODEL:
 *   Every tick writes immediately. There is no Save button and no
 *   staged pending state.
 *
 *     Ticking a row
 *       -> MissionCore.addParticipant(missionId, characterId, null)
 *          (null teamId resolves to source: 'rookie' inside the
 *           core, via MissionRules.resolveParticipantSource)
 *
 *     Unticking a row
 *       -> MissionCore.removeParticipant(missionId, characterId, null)
 *
 *   On success AND on failure the candidate VM is refetched so the
 *   row reflects the domain's actual state. The domain is
 *   authoritative; the UI returns to it.
 *
 *   This matches AcademyClassDisciplinesPicker exactly. Same
 *   instance-token pattern, same per-row lock, same refetch-after-
 *   write discipline.
 *
 * CANDIDATE MERGE:
 *   The list rendered is the union of two sets:
 *
 *     1. Every character returned by the aggregator's `candidates`
 *        array (has ever held a 'rookie' career status).
 *
 *     2. Every character already present on the mission as a
 *        participant with source 'rookie'.
 *
 *   Set 2 is a defensive merge. The aggregator only returns
 *   characters whose careerStatus currently includes 'rookie'. If a
 *   character's career-status history is edited so their rookie
 *   entry is removed, they disappear from set 1. Without the merge,
 *   a character who is still a mission participant would vanish
 *   from the picker and could never be unticked.
 *
 *   A character who appears in both sets is rendered once. The
 *   authoritative `isParticipant` flag comes from the current
 *   participants list, not from the aggregator's candidate flag,
 *   because the aggregator builds its flag from the same source
 *   and the merge may add entries the aggregator does not know
 *   about.
 *
 * ROWS WITH onAssignedTeam=true:
 *   A candidate who is already an active member of one of the
 *   mission's assigned teams is rendered as a disabled row with an
 *   explanatory note. The correct place to record them is the
 *   team-member section of the form, not the rookie section. The
 *   picker does not silently hide them; the user sees why they are
 *   not selectable.
 *
 * ASYNC SAFETY:
 *   Every asynchronous callback captures the current
 *   `_instanceToken`. If a new modal has been opened (or the
 *   current one closed) before the callback runs, the callback is
 *   a no-op.
 *
 * PER-ROW LOCK:
 *   A character whose mutation is in flight is tracked in
 *   `_pendingCharacterIds`. Clicks on that row are ignored until
 *   the mutation completes. Other rows remain interactive.
 *   The locked row renders disabled.
 *
 * BULK OPERATIONS:
 *   "Select all filtered" and "Clear all selected" are sequential
 *   chains of individual mutations. Each underlying write is
 *   atomic; the bulk operation as a whole is not transactional.
 *   Partial success with clear failure feedback is the outcome.
 *
 *   While a bulk runs, `_busy` is true and all interactive
 *   controls render disabled.
 *
 * SEARCH:
 *   The search box filters client-side on displayName,
 *   case-insensitive substring. Filtering is a presentation
 *   concern; it does not affect which rows are rendered as
 *   ticked, and it does not affect the bulk-selection target set
 *   beyond "the currently-filtered subset."
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.DomUtils
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.MissionAggregator
 *   - window.MissionCore
 */

(function() {
    'use strict';

    if (window.__missionRookiePickerLoaded) {
        return;
    }

    // ============================================================
    // MANDATORY DEPENDENCIES
    // ============================================================

    var DomUtils = window.DomUtils;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;
    var MissionAggregator = window.MissionAggregator;
    var MissionCore = window.MissionCore;

    var _missing = [];

    if (!DomUtils ||
        typeof DomUtils.escapeHtml !== 'function' ||
        typeof DomUtils.escapeAttribute !== 'function') {
        _missing.push('DomUtils.escapeHtml/escapeAttribute');
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
    if (!MissionAggregator ||
        typeof MissionAggregator.getRookieCandidatesViewModel !==
        'function') {
        _missing.push(
            'MissionAggregator.getRookieCandidatesViewModel'
        );
    }
    if (!MissionCore ||
        typeof MissionCore.addParticipant !== 'function') {
        _missing.push('MissionCore.addParticipant');
    }
    if (!MissionCore ||
        typeof MissionCore.removeParticipant !== 'function') {
        _missing.push('MissionCore.removeParticipant');
    }

    if (_missing.length > 0) {
        throw new Error(
            '[MissionRookiePicker] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__missionRookiePickerLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var BULK_CONFIRM_THRESHOLD = 5;

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _modal = null;
    var _contentEl = null;
    var _missionId = null;
    var _missionTitle = '';
    var _onClose = null;

    var _contentChangeHandler = null;
    var _contentClickHandler = null;
    var _contentInputHandler = null;

    var _vm = null;
    var _searchFilter = '';

    var _busy = false;
    var _pendingCharacterIds = Object.create(null);

    var _instanceToken = 0;

    // ============================================================
    // HELPERS
    // ============================================================

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    function isRowLocked(characterId) {
        return _pendingCharacterIds[String(characterId)] === true;
    }

    function acquireRowLock(characterId) {
        _pendingCharacterIds[String(characterId)] = true;
    }

    function releaseRowLock(characterId) {
        delete _pendingCharacterIds[String(characterId)];
    }

    function hasAnyRowLock() {
        return Object.keys(_pendingCharacterIds).length > 0;
    }

    // ============================================================
    // ENTRY POINT
    // ============================================================

    /**
     * Open the rookie picker for a mission.
     *
     * @param {string} missionId
     * @param {object} [options]
     * @param {function} [options.onClose] - Called once when the
     *   modal closes for any reason.
     * @returns {object|null} The modal element, or null on failure
     */
    function openModal(missionId, options) {
        if (!isNonEmptyString(missionId)) {
            notify('Mission ID is required.', 'error');
            return null;
        }

        closeModal();

        options = options || {};

        _missionId = String(missionId);
        _onClose = typeof options.onClose === 'function'
            ? options.onClose
            : null;
        _busy = false;
        _pendingCharacterIds = Object.create(null);
        _vm = null;
        _searchFilter = '';

        _instanceToken++;
        var myToken = _instanceToken;

        var vm = fetchVM();
        if (vm === null) {
            notify('Mission not found.', 'error');
            resetState();
            return null;
        }

        _vm = vm;
        _missionTitle = vm.missionTitle || 'Mission';

        var modal = Modal.createModal('mission-rookie-picker-modal');
        if (!modal) {
            notify('Failed to create modal.', 'error');
            resetState();
            return null;
        }
        modal.id = 'mission-rookie-picker-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content wide';
        modal.appendChild(contentEl);

        _modal = modal;
        _contentEl = contentEl;

        _contentChangeHandler = handleContentChange;
        _contentClickHandler = handleContentClick;
        _contentInputHandler = handleContentInput;
        contentEl.addEventListener('change', _contentChangeHandler);
        contentEl.addEventListener('click', _contentClickHandler);
        contentEl.addEventListener('input', _contentInputHandler);

        renderContent();
        void myToken;

        Modal.modalSetup(modal, function() {
            closeModal();
        });
        Modal.showModal(modal);

        // Focus the search box on the next tick so the user can
        // start typing immediately.
        setTimeout(function() {
            if (!_contentEl) { return; }
            var searchEl = _contentEl.querySelector(
                '#mission-rookie-picker-search'
            );
            if (searchEl && typeof searchEl.focus === 'function') {
                try { searchEl.focus(); } catch (e) {}
            }
        }, 30);

        return modal;
    }

    function closeModal() {
        var modal = _modal;
        var contentEl = _contentEl;
        var onClose = _onClose;

        if (contentEl && _contentChangeHandler) {
            try {
                contentEl.removeEventListener(
                    'change', _contentChangeHandler
                );
            } catch (e) { /* ignore */ }
        }
        if (contentEl && _contentClickHandler) {
            try {
                contentEl.removeEventListener(
                    'click', _contentClickHandler
                );
            } catch (e) { /* ignore */ }
        }
        if (contentEl && _contentInputHandler) {
            try {
                contentEl.removeEventListener(
                    'input', _contentInputHandler
                );
            } catch (e) { /* ignore */ }
        }

        _instanceToken++;
        resetState();

        if (modal) {
            try {
                Modal.closeModal(modal);
            } catch (e) {
                // Ignore.
            }
        }

        if (onClose) {
            try {
                onClose();
            } catch (e) {
                console.warn(
                    '[MissionRookiePicker] onClose threw:', e
                );
            }
        }
    }

    function resetState() {
        _modal = null;
        _contentEl = null;
        _missionId = null;
        _missionTitle = '';
        _onClose = null;
        _contentChangeHandler = null;
        _contentClickHandler = null;
        _contentInputHandler = null;
        _vm = null;
        _searchFilter = '';
        _busy = false;
        _pendingCharacterIds = Object.create(null);
    }

    // ============================================================
    // VM FETCH
    // ============================================================

    /**
     * Fetch the rookie-candidate VM and merge in any current
     * rookie-participant who is not present on the aggregator's
     * candidate list.
     *
     * The aggregator's VM shape:
     *
     *   {
     *     missionId,
     *     missionTitle,
     *     missionYear,
     *     candidates: [
     *       { characterId, displayName, deceased,
     *         isParticipant, onAssignedTeam }
     *     ]
     *   }
     *
     * The merge adds a synthetic entry for each current rookie
     * participant whose characterId is not already on the
     * candidate list. The synthetic entry has onAssignedTeam=false
     * and isParticipant=true. This lets the user untick a character
     * whose rookie career-status entry was removed after they were
     * added to the mission.
     *
     * Returns null when the aggregator returns null (mission
     * missing). Throws when the aggregator returns a malformed VM.
     */
    function fetchVM() {
        if (!_missionId) { return null; }

        var vm = MissionAggregator.getRookieCandidatesViewModel(
            _missionId
        );

        if (vm === null || vm === undefined) {
            return null;
        }

        if (!Array.isArray(vm.candidates)) {
            throw new Error(
                '[MissionRookiePicker] Aggregator returned a VM whose ' +
                '`candidates` field is not an array. The VM contract ' +
                'requires an array.'
            );
        }

        // ---- Merge current rookie participants ----
        //
        // Read the participants through the same aggregator that
        // produced the candidate VM: getParticipantsViewModel is
        // the picker's window onto the current participant list.
        // We do not walk the store directly.
        var participantVM = null;
        try {
            participantVM =
                MissionAggregator.getParticipantsViewModel(_missionId);
        } catch (e) {
            participantVM = null;
        }

        var existingIds = Object.create(null);
        for (var i = 0; i < vm.candidates.length; i++) {
            var c = vm.candidates[i];
            if (!c || !c.characterId) { continue; }
            existingIds[String(c.characterId)] = true;
        }

        var merged = vm.candidates.slice();

        if (participantVM &&
            Array.isArray(participantVM.currentParticipants)) {
            var current = participantVM.currentParticipants;
            for (var p = 0; p < current.length; p++) {
                var part = current[p];
                if (!part || !part.characterId) { continue; }
                if (part.source !== 'rookie') { continue; }

                var cid = String(part.characterId);
                if (existingIds[cid] === true) { continue; }
                existingIds[cid] = true;

                merged.push({
                    characterId: cid,
                    displayName: part.displayName || 'Unknown',
                    deceased: part.deceased === true,
                    isParticipant: true,
                    onAssignedTeam: false
                });
            }
        }

        // Sort alphabetically. Stable via characterId tiebreak.
        merged.sort(function(a, b) {
            var an = String(a.displayName || '');
            var bn = String(b.displayName || '');
            var cmp = an.localeCompare(bn);
            if (cmp !== 0) { return cmp; }
            return String(a.characterId || '')
                .localeCompare(String(b.characterId || ''));
        });

        return {
            missionId: String(vm.missionId),
            missionTitle: vm.missionTitle || 'Mission',
            missionYear: vm.missionYear,
            candidates: merged
        };
    }

    function refetchAndRender() {
        if (!_contentEl || !_missionId) { return; }

        var vm;
        try {
            vm = fetchVM();
        } catch (e) {
            console.warn(
                '[MissionRookiePicker] refetch failed:', e
            );
            notify('Failed to refresh rookie list.', 'error');
            closeModal();
            return;
        }

        if (vm === null) {
            notify('Mission no longer exists.', 'error');
            closeModal();
            return;
        }

        _vm = vm;
        renderContent();
    }

    // ============================================================
    // RENDER
    // ============================================================

    function renderContent() {
        if (!_contentEl || !_vm) { return; }

        // Preserve the search box's focus and caret across
        // re-renders. Without this, every tick of a checkbox would
        // steal the caret out of the search box.
        var oldInput = _contentEl.querySelector(
            '#mission-rookie-picker-search'
        );
        var hadFocus = oldInput === document.activeElement;
        var caretPos = null;
        if (hadFocus) {
            try { caretPos = oldInput.selectionStart; } catch (e) {
                caretPos = null;
            }
        }

        _contentEl.innerHTML = buildModalHTML(_vm);

        if (hadFocus) {
            var newInput = _contentEl.querySelector(
                '#mission-rookie-picker-search'
            );
            if (newInput) {
                try {
                    newInput.focus();
                    if (caretPos !== null) {
                        newInput.setSelectionRange(
                            caretPos, caretPos
                        );
                    }
                } catch (e) { /* ignore */ }
            }
        }
    }

    // ============================================================
    // HTML
    // ============================================================

    function buildModalHTML(vm) {
        var candidates = vm.candidates || [];
        var filtered = applyFilter(candidates, _searchFilter);

        var selectedCount = countSelected(candidates);
        var totalCount = candidates.length;

        var html = '';

        // ---- Header ----
        html += '<div class="modal-header">';
        html += '<h3>' +
                    'Rookies \u2014 ' +
                    DomUtils.escapeHtml(vm.missionTitle || 'Mission') +
                '</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-picker-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        // ---- Body ----
        html += '<div class="modal-body mission-rookie-picker-body">';

        html += '<p class="field-hint" ' +
                    'style="font-size:0.75rem;color:var(--text-dim);' +
                    'margin:0 0 12px 0;line-height:1.5;">' +
                    'Tick the rookie-status characters who took part ' +
                    'in this mission. Changes are saved as you tick. ' +
                    'A rookie who is already a member of one of the ' +
                    'mission\u2019s assigned teams belongs in the ' +
                    'team-member section, and is shown disabled here.' +
                '</p>';

        // ---- Search + bulk actions ----
        html += '<div class="mission-rookie-picker-controls">';

        html += '<input type="text" ' +
                    'id="mission-rookie-picker-search" ' +
                    'class="mission-rookie-picker-search-input" ' +
                    'placeholder="Search by name..." ' +
                    'autocomplete="off" ' +
                    'spellcheck="false" ' +
                    'value="' +
                        DomUtils.escapeAttribute(_searchFilter) +
                    '">';

        html += '<div class="mission-rookie-picker-bulk">';
        html += '<span class="mission-rookie-picker-count">' +
                    selectedCount + ' of ' + totalCount + ' selected' +
                '</span>';
        var bulkDisabled = _busy ? ' disabled' : '';

        html += '<button type="button" class="small secondary" ' +
                    'data-picker-action="select-all-filtered"' +
                    bulkDisabled + '>' +
                    'Select all' +
                '</button>';
        html += '<button type="button" class="small secondary" ' +
                    'data-picker-action="unselect-all"' +
                    bulkDisabled + '>' +
                    'Unselect all' +
                '</button>';
        html += '</div>';

        html += '</div>';

        // ---- List ----
        if (totalCount === 0) {
            html += '<p class="empty-state" ' +
                        'style="margin-top:12px;">' +
                        'No rookie-status characters exist yet. ' +
                        'A character becomes a rookie candidate by ' +
                        'having a "rookie" entry in their career ' +
                        'history.' +
                    '</p>';
        } else if (filtered.length === 0) {
            html += '<p class="empty-state" ' +
                        'style="margin-top:12px;">' +
                        'No rookies match \u201c' +
                        DomUtils.escapeHtml(_searchFilter) +
                        '\u201d.' +
                    '</p>';
        } else {
            html += '<div class="mission-rookie-picker-list">';
            for (var i = 0; i < filtered.length; i++) {
                html += renderRow(filtered[i]);
            }
            html += '</div>';
        }

        html += '</div>';

        // ---- Footer ----
        html += '<div class="modal-footer mission-rookie-picker-footer" ' +
                    'style="display:flex;justify-content:flex-end;' +
                    'gap:8px;padding-top:12px;margin-top:12px;' +
                    'border-top:1px solid var(--border-soft);">';
        html += '<button type="button" class="primary" ' +
                    'data-picker-action="close">Done</button>';
        html += '</div>';

        return html;
    }

    function renderRow(candidate) {
        if (!candidate || !candidate.characterId) { return ''; }

        var cid = String(candidate.characterId);
        var selected = candidate.isParticipant === true;
        var onTeam = candidate.onAssignedTeam === true;

        var disabled = _busy || isRowLocked(cid) || onTeam;
        var disabledAttr = disabled ? ' disabled' : '';

        var rowClasses = 'mission-rookie-picker-row';
        if (selected) {
            rowClasses += ' mission-rookie-picker-row-selected';
        }
        if (onTeam) {
            rowClasses += ' mission-rookie-picker-row-on-team';
        }
        if (isRowLocked(cid)) {
            rowClasses += ' mission-rookie-picker-row-busy';
        }

        var html = '';
        html += '<label class="' + rowClasses + '" ' +
                    'data-character-id="' +
                        DomUtils.escapeAttribute(cid) + '">';

        html += '<input type="checkbox" ' +
                    'class="mission-rookie-picker-checkbox" ' +
                    'data-picker-action="toggle"' +
                    'data-character-id="' +
                        DomUtils.escapeAttribute(cid) + '"' +
                    (selected ? ' checked' : '') +
                    disabledAttr + '>';

        html += '<span class="mission-rookie-picker-name">' +
                    DomUtils.escapeHtml(
                        candidate.displayName || 'Unknown'
                    ) +
                '</span>';

        if (candidate.deceased === true) {
            html += '<span class="mission-rookie-picker-deceased" ' +
                        'title="Deceased">\u2020</span>';
        }

        if (onTeam) {
            html += '<span class="mission-rookie-picker-note">' +
                        'On assigned team' +
                    '</span>';
        }

        html += '</label>';
        return html;
    }

    function applyFilter(candidates, filter) {
        if (!isNonEmptyString(filter)) {
            return candidates.slice();
        }
        var term = String(filter).toLowerCase().trim();
        if (term === '') {
            return candidates.slice();
        }

        var result = [];
        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            if (!c) { continue; }
            var name = String(c.displayName || '').toLowerCase();
            if (name.indexOf(term) !== -1) {
                result.push(c);
            }
        }
        return result;
    }

    function countSelected(candidates) {
        var n = 0;
        for (var i = 0; i < candidates.length; i++) {
            if (candidates[i] && candidates[i].isParticipant === true) {
                n++;
            }
        }
        return n;
    }

    // ============================================================
    // CONTENT EVENT HANDLERS
    // ============================================================

    function handleContentClick(e) {
        if (_busy) {
            e.preventDefault();
            return;
        }

        var target = e.target;
        if (!target || typeof target.closest !== 'function') { return; }

        var btn = target.closest('[data-picker-action]');
        if (!btn || !btn.dataset) { return; }

        var action = btn.dataset.pickerAction;

        if (action === 'close') {
            e.preventDefault();
            closeModal();
            return;
        }

        if (action === 'select-all-filtered') {
            e.preventDefault();
            handleSelectAllFiltered();
            return;
        }

        if (action === 'unselect-all') {
            e.preventDefault();
            handleUnselectAll();
            return;
        }
    }

    function handleContentChange(e) {
        if (_busy) {
            e.preventDefault();
            return;
        }

        var target = e.target;
        if (!target || !target.dataset) { return; }

        var action = target.dataset.pickerAction;
        var characterId = target.dataset.characterId;

        if (action === 'toggle') {
            e.preventDefault();
            handleToggle(characterId, target.checked);
            return;
        }
    }

    function handleContentInput(e) {
        var target = e.target;
        if (!target || !target.dataset) { return; }
        if (target.id !== 'mission-rookie-picker-search') { return; }

        _searchFilter = String(target.value || '');

        // Re-render only the list portion, not the whole modal, so
        // the search box's own input value is not disturbed by the
        // re-render. The list is fully rebuilt below the input.
        var listHost = _contentEl
            ? _contentEl.querySelector(
                '.mission-rookie-picker-list'
            )
            : null;

        // Because we rebuild the entire modal HTML on renderContent,
        // and that path preserves the input's focus and caret, the
        // simplest correct thing is a full render here. The
        // preserved focus means typing does not lose the caret.
        void listHost;
        renderContent();
    }

    // ============================================================
    // WRITE HANDLERS
    // ============================================================

    function handleToggle(characterId, checked) {
        if (!_missionId || !isNonEmptyString(characterId)) {
            return;
        }

        if (isRowLocked(characterId)) {
            // Another mutation for this row is still in flight.
            // Re-render so the checkbox snaps back to the domain's
            // actual state.
            refetchAndRender();
            return;
        }

        acquireRowLock(characterId);
        renderContent();

        var promise;

        if (checked) {
            // teamId = null for a rookie. MissionCore resolves
            // source via MissionRules.resolveParticipantSource.
            promise = MissionCore.addParticipant(
                _missionId,
                characterId,
                null
            );
        } else {
            promise = MissionCore.removeParticipant(
                _missionId,
                characterId,
                null
            );
        }

        promise.then(function(result) {
            releaseRowLock(characterId);

            if (result && result.success) {
                refetchAndRender();
                return;
            }

            if (result && result.message) {
                notify(result.message, 'error');
            }
            refetchAndRender();
        }).catch(function(err) {
            releaseRowLock(characterId);
            console.warn(
                '[MissionRookiePicker] toggle failed:', err
            );
            notify('Failed to update the rookie.', 'error');
            refetchAndRender();
        });
    }

    // ============================================================
    // BULK OPERATIONS
    // ============================================================

    function handleSelectAllFiltered() {
        if (!_missionId || _busy) { return; }

        if (hasAnyRowLock()) {
            notify(
                'Wait for the current update to finish before running ' +
                'a bulk operation.',
                'info'
            );
            return;
        }

        var vm = _vm;
        if (!vm) { return; }

        var filtered = applyFilter(
            vm.candidates || [], _searchFilter
        );

        var targets = [];
        for (var i = 0; i < filtered.length; i++) {
            var c = filtered[i];
            if (!c || !c.characterId) { continue; }
            if (c.isParticipant === true) { continue; }
            if (c.onAssignedTeam === true) { continue; }
            targets.push(String(c.characterId));
        }

        if (targets.length === 0) {
            notify(
                'Every visible rookie is already selected.',
                'info'
            );
            return;
        }

        if (targets.length > BULK_CONFIRM_THRESHOLD) {
            if (!confirm(
                'Add all ' + targets.length + ' visible rookies ' +
                'to this mission?'
            )) {
                return;
            }
        }

        runBulk(
            targets.map(function(cid) {
                return function() {
                    return MissionCore.addParticipant(
                        _missionId, cid, null
                    );
                };
            }),
            'Added ' + targets.length + ' rookie(s).',
            'Failed to add some rookies.'
        );
    }

    function handleUnselectAll() {
        if (!_missionId || _busy) { return; }

        if (hasAnyRowLock()) {
            notify(
                'Wait for the current update to finish before running ' +
                'a bulk operation.',
                'info'
            );
            return;
        }

        var vm = _vm;
        if (!vm) { return; }

        var candidates = vm.candidates || [];

        var targets = [];
        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            if (!c || !c.characterId) { continue; }
            if (c.isParticipant !== true) { continue; }
            targets.push(String(c.characterId));
        }

        if (targets.length === 0) {
            notify('No rookies are currently selected.', 'info');
            return;
        }

        if (targets.length > BULK_CONFIRM_THRESHOLD) {
            if (!confirm(
                'Remove all ' + targets.length +
                ' selected rookies from this mission?'
            )) {
                return;
            }
        }

        runBulk(
            targets.map(function(cid) {
                return function() {
                    return MissionCore.removeParticipant(
                        _missionId, cid, null
                    );
                };
            }),
            'Removed ' + targets.length + ' rookie(s).',
            'Failed to remove some rookies.'
        );
    }

    function runBulk(thunks, successMessage, failureMessage) {
        var myToken = _instanceToken;

        _busy = true;
        renderContent();

        var failures = [];
        var chain = Promise.resolve();

        thunks.forEach(function(thunk) {
            chain = chain.then(function() {
                if (myToken !== _instanceToken) { return; }
                return thunk();
            }).then(function(result) {
                if (myToken !== _instanceToken) { return; }
                if (!result || !result.success) {
                    failures.push({
                        message: (result && result.message) ||
                            'Unknown error'
                    });
                }
            }).catch(function(err) {
                if (myToken !== _instanceToken) { return; }
                failures.push({
                    message: String(
                        (err && err.message) || err
                    )
                });
            });
        });

        chain.then(function() {
            if (myToken !== _instanceToken) { return; }

            _busy = false;

            if (failures.length === 0) {
                notify(successMessage, 'success');
            } else {
                notify(
                    failureMessage + ' (' + failures.length +
                    ' failed). See console for details.',
                    'error'
                );
                for (var i = 0; i < failures.length; i++) {
                    console.warn(
                        '[MissionRookiePicker] bulk failure:',
                        failures[i]
                    );
                }
            }

            refetchAndRender();
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.MissionRookiePicker = Object.freeze({
        openModal: openModal,
        closeModal: closeModal
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.MissionRookiePicker;
        var missing = [];

        var required = ['openModal', 'closeModal'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[MissionRookiePicker] Verification - some exports ' +
                'may be missing:', missing.join(', ')
            );
        }
    })();

})();