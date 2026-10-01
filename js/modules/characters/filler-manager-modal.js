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
 * DEPENDENCIES (MANDATORY):
 *   - window.CharacterQueries
 *   - window.CharacterCRUD
 *   - window.CharacterStrip
 *   - window.Modal
 *   - window.NotificationSystem
 */

(function() {
    'use strict';

    if (window.__fillerManagerModalLoaded) {
        return;
    }
    window.__fillerManagerModalLoaded = true;

    var CharacterQueries = window.CharacterQueries;
    var CharacterCRUD = window.CharacterCRUD;
    var CharacterStrip = window.CharacterStrip;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;

    function checkDependencies() {
        var missing = [];
        if (!CharacterQueries ||
            typeof CharacterQueries.getCharacters !== 'function') {
            missing.push('CharacterQueries.getCharacters');
        }
        if (!CharacterQueries ||
            typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }
        if (!CharacterCRUD ||
            typeof CharacterCRUD.setFillerFlag !== 'function') {
            missing.push('CharacterCRUD.setFillerFlag');
        }
        if (!CharacterStrip ||
            typeof CharacterStrip.isFillerCandidate !== 'function') {
            missing.push('CharacterStrip.isFillerCandidate');
        }
        if (!Modal || typeof Modal.createModal !== 'function') {
            missing.push('Modal.createModal');
        }
        if (!NotificationSystem ||
            typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }
        if (missing.length > 0) {
            throw new Error(
                '[FillerManagerModal] Missing mandatory ' +
                'dependencies: ' + missing.join(', ')
            );
        }
    }

    checkDependencies();

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
        if (value === undefined || value === null) { return ''; }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getCharacters() {
        return CharacterQueries.getCharacters() || [];
    }

    // ============================================================
    // OPEN
    // ============================================================

    function openModal() {
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

        var modal = Modal.createModal('filler-manager-modal');
        if (!modal) {
            NotificationSystem.notify(
                'Could not open filler manager.',
                'error'
            );
            return;
        }
        modal.id = 'filler-manager-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content wide';
        modal.appendChild(contentEl);

        _modal = modal;

        Modal.modalSetup(modal, function() {
            closeModal();
        });
        Modal.showModal(modal);

        render(modal, contentEl);
        bind(modal, contentEl);
    }

    function closeModal() {
        if (_modal) {
            try { Modal.closeModal(_modal); } catch (e) {}
        }
        _modal = null;
    }

    // ============================================================
    // RENDER
    // ============================================================

    function render(modal, contentEl) {
        var chars = getCharacters();

        // Sort: candidates first (checked or heuristic), then
        // alphabetical. This puts the actionable rows at the top.
        var sorted = chars.slice().sort(function(a, b) {
            var aChecked = _checkedIds[String(a.id)] === true;
            var bChecked = _checkedIds[String(b.id)] === true;
            if (aChecked !== bChecked) {
                return aChecked ? -1 : 1;
            }
            var aName = CharacterQueries.getDisplayName(a) || '';
            var bName = CharacterQueries.getDisplayName(b) || '';
            return aName.localeCompare(bName);
        });

        var totalCount = sorted.length;
        var checkedCount = Object.keys(_checkedIds).length;
        var heuristicCount = 0;
        for (var h = 0; h < sorted.length; h++) {
            if (CharacterStrip.isFillerCandidate(sorted[h])) {
                heuristicCount++;
            }
        }

        var html = '';

        html += '<div class="modal-header">';
        html += '<h3 id="filler-manager-title">' +
                    'Manage Filler Characters' +
                '</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'id="close-filler-manager">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += '<p class="field-hint filler-manager-hint">' +
                    'Flag characters as filler to strip their empty ' +
                    'fields on save. Flagged characters keep their ' +
                    'name, career, class, teams, eliminations, and ' +
                    'parent links. Unchecking does not restore ' +
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
            var name = CharacterQueries.getDisplayName(c) || 'Unknown';
            var isCandidate = CharacterStrip.isFillerCandidate(c);

            var rowClass = 'filler-manager-row';
            if (checked) { rowClass += ' is-checked'; }
            if (isCandidate) { rowClass += ' is-candidate'; }

            html += '<label class="' + rowClass + '" ' +
                        'data-character-id="' + escapeHtml(cid) + '">';
            html += '<input type="checkbox" class="filler-row-check" ' +
                        'data-id="' + escapeHtml(cid) + '"' +
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
        var closeBtn = contentEl.querySelector(
            '#close-filler-manager'
        );
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

        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeModal();
            }
        });
    }

    function handleSelectCandidates(contentEl) {
        var chars = getCharacters();
        for (var i = 0; i < chars.length; i++) {
            var c = chars[i];
            if (!c || !c.id) { continue; }
            if (CharacterStrip.isFillerCandidate(c)) {
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
        var toFlag = [];
        var toUnflag = [];

        var allIds = Object.create(null);
        var k;
        for (k in _checkedIds) {
            if (Object.prototype.hasOwnProperty.call(_checkedIds, k)) {
                allIds[k] = true;
            }
        }
        for (k in _initialCheckedIds) {
            if (Object.prototype.hasOwnProperty.call(
                _initialCheckedIds, k
            )) {
                allIds[k] = true;
            }
        }

        var idList = Object.keys(allIds);
        for (var i = 0; i < idList.length; i++) {
            var id = idList[i];
            var nowChecked = _checkedIds[id] === true;
            var wasChecked = _initialCheckedIds[id] === true;
            if (nowChecked && !wasChecked) {
                toFlag.push(id);
            } else if (!nowChecked && wasChecked) {
                toUnflag.push(id);
            }
        }

        if (toFlag.length === 0 && toUnflag.length === 0) {
            NotificationSystem.notify('No changes to apply.', 'info');
            closeModal();
            return;
        }

        // Flag first (strip), then unflag. Order matters only
        // stylistically: they touch disjoint ids.
        var chain = Promise.resolve();

        if (toFlag.length > 0) {
            chain = chain.then(function() {
                return CharacterCRUD.setFillerFlag(toFlag, true);
            });
        }
        if (toUnflag.length > 0) {
            chain = chain.then(function() {
                return CharacterCRUD.setFillerFlag(toUnflag, false);
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
            NotificationSystem.notify(
                'Filler update: ' + parts.join(', ') + '.',
                'success'
            );
            closeModal();
        }).catch(function(err) {
            console.warn(
                '[FillerManagerModal] apply failed:', err
            );
            NotificationSystem.notify(
                'Failed to update filler flags.',
                'error'
            );
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.FillerManagerModal = Object.freeze({
        openModal: openModal,
        closeModal: closeModal
    });

})();
