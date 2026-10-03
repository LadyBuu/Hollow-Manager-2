/**
 * js/modules/characters/character-bulk-create.js - Bulk Character Create
 * Modal for creating several characters at once.
 *
 * Path: js/modules/characters/character-bulk-create.js
 *
 * WHAT THIS OWNS:
 *   - The bulk-create modal shell.
 *   - The row table: one row per character to create.
 *   - Row add/remove.
 *   - Collecting the table into a list of DTOs.
 *   - Sequential CharacterCRUD.save() calls, one per row.
 *   - Per-row result reporting.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Character record shape. CharacterCRUD.normaliseCharacterData
 *     owns it.
 *   - Persistence. CharacterCRUD.save owns it.
 *   - Validation. CharacterCRUD.validateCharacter owns it.
 *   - Rendering the character list. CharacterList owns it.
 *
 * COLUMNS:
 *   First        required, string
 *   Last         required, string
 *   Birth Year   optional, positive integer
 *   Gender       optional, string
 *   Nickname     optional, string
 *
 *   Every created record is marked isFiller: true so the default
 *   Hide Filler filter keeps it out of the main character list
 *   until the user unticks it.
 *
 * EXECUTION MODEL:
 *   Sequential. One CharacterCRUD.save() per row, awaited in
 *   order. Each save is its own pipeline transaction. A failed
 *   row does NOT abort the batch; it is recorded and the next
 *   row is attempted. At the end, the modal reports:
 *
 *     created:  N
 *     failed:   M
 *     details:  [ { rowIndex, message } ]
 *
 *   This is deliberately not all-or-nothing: bulk entry is high
 *   volume and low stakes, and a single malformed row should not
 *   discard the rest.
 *
 * WHY NOT batchAddCharacters:
 *   CharacterCRUD does not currently expose a batch mutation.
 *   Adding one would duplicate normalisation, validation, and
 *   the filler-strip logic. Looping save() is the correct
 *   composition.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CharacterCRUD
 *   - window.CharacterQueries
 *   - window.Modal
 *   - window.DomUtils
 *   - window.NotificationSystem
 *
 * DEPENDENCIES (LAZY, at close time):
 *   - window.CharacterList  (refresh after a successful batch)
 */

(function() {
    'use strict';

    if (window.__characterBulkCreateLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCIES
    // ============================================================

    var CharacterCRUD = window.CharacterCRUD;
    var CharacterQueries = window.CharacterQueries;
    var Modal = window.Modal;
    var DomUtils = window.DomUtils;
    var NotificationSystem = window.NotificationSystem;

    var _missing = [];

    if (!CharacterCRUD ||
        typeof CharacterCRUD.save !== 'function') {
        _missing.push('CharacterCRUD.save');
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
            '[CharacterBulkCreate] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__characterBulkCreateLoaded = true;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var MODAL_ID = 'character-bulk-create-modal';
    var INITIAL_ROWS = 3;
    var MAX_ROWS = 200;

    // ============================================================
    // STATE
    // ============================================================

    var _modal = null;
    var _contentEl = null;
    var _rowsEl = null;
    var _busy = false;

    var _contentClickHandler = null;

    // ============================================================
    // HELPERS
    // ============================================================

    function notify(message, type) {
        NotificationSystem.notify(message, type || 'info');
    }

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    function escapeAttribute(value) {
        return DomUtils.escapeAttribute(value);
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function getCharacterList() {
        return window.CharacterList || null;
    }

    // ============================================================
    // OPEN / CLOSE
    // ============================================================

    function open() {
        // Already open: refocus and bail.
        if (_modal && _contentEl) {
            var first = _contentEl.querySelector(
                '.bulk-create-first'
            );
            if (first && typeof first.focus === 'function') {
                try { first.focus(); } catch (e) {}
            }
            return;
        }

        if (_modal) {
            try { Modal.closeModal(_modal); } catch (e) {}
            _modal = null;
            _contentEl = null;
            _rowsEl = null;
        }

        var modal = Modal.createModal(MODAL_ID);
        if (!modal) {
            notify('Could not open bulk create.', 'error');
            return;
        }
        modal.id = MODAL_ID;

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content wide bulk-create-content';
        modal.appendChild(contentEl);

        _modal = modal;
        _contentEl = contentEl;
        _busy = false;

        contentEl.innerHTML = buildShellHTML();
        _rowsEl = contentEl.querySelector('#bulk-create-rows');

        // Seed the initial rows.
        for (var i = 0; i < INITIAL_ROWS; i++) {
            addRow();
        }

        _contentClickHandler = handleContentClick;
        contentEl.addEventListener('click', _contentClickHandler);

        Modal.modalSetup(modal, function() {
            close();
        });
        Modal.showModal(modal);

        setTimeout(function() {
            var first = _contentEl &&
                _contentEl.querySelector('.bulk-create-first');
            if (first && typeof first.focus === 'function') {
                try { first.focus(); } catch (e) {}
            }
        }, 50);
    }

    function close() {
        if (_busy) {
            // Refuse to close mid-batch.
            return;
        }

        var modal = _modal;
        var contentEl = _contentEl;

        if (contentEl && _contentClickHandler) {
            try {
                contentEl.removeEventListener(
                    'click', _contentClickHandler
                );
            } catch (e) { /* ignore */ }
        }

        _modal = null;
        _contentEl = null;
        _rowsEl = null;
        _busy = false;
        _contentClickHandler = null;

        if (modal) {
            try { Modal.closeModal(modal); } catch (e) {}
        }
    }

    // ============================================================
    // SHELL
    // ============================================================

    function buildShellHTML() {
        var html = '';

        html += '<div class="modal-header">';
        html += '<h3>Bulk Create Characters</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-bulk-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        html += '<div class="modal-body">';

        html += '<p class="field-hint bulk-create-hint">' +
                    'Fill in the rows below. First and Last name are ' +
                    'required; the rest are optional. Every created ' +
                    'character is marked as filler, so they stay ' +
                    'hidden until you uncheck Hide Filler in the ' +
                    'character list.' +
                '</p>';

        html += '<div class="bulk-create-table-header">';
        html += '<span>First</span>';
        html += '<span>Last</span>';
        html += '<span>Birth Year</span>';
        html += '<span>Gender</span>';
        html += '<span>Nickname</span>';
        html += '<span></span>';
        html += '</div>';

        html += '<div id="bulk-create-rows" ' +
                    'class="bulk-create-rows"></div>';

        html += '<div class="bulk-create-actions">';
        html += '<button type="button" class="small secondary" ' +
                    'data-bulk-action="add-row">' +
                    '+ Add Row' +
                '</button>';
        html += '<span class="bulk-create-row-count" ' +
                    'id="bulk-create-row-count"></span>';
        html += '</div>';

        html += '</div>';

        html += '<div class="form-actions">';
        html += '<button type="button" class="secondary" ' +
                    'data-bulk-action="close">Cancel</button>';
        html += '<button type="button" class="primary" ' +
                    'data-bulk-action="create" ' +
                    'id="bulk-create-submit">' +
                    'Create All' +
                '</button>';
        html += '</div>';

        return html;
    }

    // ============================================================
    // ROWS
    // ============================================================

    function addRow(values) {
        if (!_rowsEl) { return; }

        var count = _rowsEl.querySelectorAll('.bulk-create-row').length;
        if (count >= MAX_ROWS) {
            notify('Row limit reached.', 'warning');
            return;
        }

        values = values || {};

        var row = document.createElement('div');
        row.className = 'bulk-create-row';
        row.innerHTML = buildRowHTML(values);
        _rowsEl.appendChild(row);

        updateRowCount();

        var focusTarget = row.querySelector('.bulk-create-first');
        if (focusTarget && typeof focusTarget.focus === 'function') {
            try { focusTarget.focus(); } catch (e) {}
        }
    }

    function buildRowHTML(values) {
        var first = isNonEmptyString(values.first) ? values.first : '';
        var last = isNonEmptyString(values.last) ? values.last : '';
        var birthYear = values.birthYear !== undefined &&
                        values.birthYear !== null
            ? String(values.birthYear)
            : '';
        var gender = isNonEmptyString(values.gender) ? values.gender : '';
        var nickname = isNonEmptyString(values.nickname)
            ? values.nickname
            : '';

        var html = '';

        html += '<input type="text" ' +
                    'class="bulk-create-first" ' +
                    'placeholder="First name" ' +
                    'value="' + escapeAttribute(first) + '">';

        html += '<input type="text" ' +
                    'class="bulk-create-last" ' +
                    'placeholder="Last name" ' +
                    'value="' + escapeAttribute(last) + '">';

        html += '<input type="number" ' +
                    'class="bulk-create-birth-year" ' +
                    'min="1" ' +
                    'placeholder="Year" ' +
                    'value="' + escapeAttribute(birthYear) + '">';

        html += '<input type="text" ' +
                    'class="bulk-create-gender" ' +
                    'placeholder="Gender" ' +
                    'value="' + escapeAttribute(gender) + '">';

        html += '<input type="text" ' +
                    'class="bulk-create-nickname" ' +
                    'placeholder="Nickname" ' +
                    'value="' + escapeAttribute(nickname) + '">';

        html += '<button type="button" ' +
                    'class="small danger bulk-create-remove" ' +
                    'data-bulk-action="remove-row" ' +
                    'aria-label="Remove row">' +
                    '\u2715' +
                '</button>';

        return html;
    }

    function removeRow(buttonEl) {
        if (!buttonEl) { return; }
        var row = buttonEl.closest('.bulk-create-row');
        if (!row) { return; }

        var rowsEl = _rowsEl;
        if (!rowsEl) { return; }

        var count = rowsEl.querySelectorAll('.bulk-create-row').length;
        if (count <= 1) {
            // Keep one empty row rather than emptying the table.
            var inputs = row.querySelectorAll('input');
            for (var i = 0; i < inputs.length; i++) {
                inputs[i].value = '';
            }
            return;
        }

        row.parentNode.removeChild(row);
        updateRowCount();
    }

    function updateRowCount() {
        if (!_rowsEl) { return; }
        var counter = _contentEl &&
            _contentEl.querySelector('#bulk-create-row-count');
        if (!counter) { return; }

        var count = _rowsEl.querySelectorAll('.bulk-create-row').length;
        counter.textContent =
            count + ' row' + (count === 1 ? '' : 's');
    }

    // ============================================================
    // COLLECT
    // ============================================================

    function collectRows() {
        if (!_rowsEl) {
            return { rows: [], blank: 0 };
        }

        var rowEls = _rowsEl.querySelectorAll('.bulk-create-row');
        var rows = [];
        var blank = 0;

        for (var i = 0; i < rowEls.length; i++) {
            var rowEl = rowEls[i];

            var firstEl = rowEl.querySelector('.bulk-create-first');
            var lastEl = rowEl.querySelector('.bulk-create-last');
            var birthYearEl = rowEl.querySelector(
                '.bulk-create-birth-year'
            );
            var genderEl = rowEl.querySelector('.bulk-create-gender');
            var nicknameEl = rowEl.querySelector(
                '.bulk-create-nickname'
            );

            var first = firstEl ? String(firstEl.value || '').trim() : '';
            var last = lastEl ? String(lastEl.value || '').trim() : '';
            var birthYearRaw = birthYearEl
                ? String(birthYearEl.value || '').trim()
                : '';
            var gender = genderEl
                ? String(genderEl.value || '').trim()
                : '';
            var nickname = nicknameEl
                ? String(nicknameEl.value || '').trim()
                : '';

            var isEntirelyBlank =
                first === '' &&
                last === '' &&
                birthYearRaw === '' &&
                gender === '' &&
                nickname === '';

            if (isEntirelyBlank) {
                blank++;
                continue;
            }

            rows.push({
                rowIndex: i,
                first: first,
                last: last,
                birthYear: birthYearRaw,
                gender: gender,
                nickname: nickname
            });
        }

        return { rows: rows, blank: blank };
    }

    // ============================================================
    // CREATE
    // ============================================================

    function handleCreate() {
        if (_busy) { return; }

        var collected = collectRows();
        var rows = collected.rows;

        if (rows.length === 0) {
            notify(
                'Fill in at least one row with a first and last name.',
                'error'
            );
            return;
        }

        // Per-row pre-validation of required fields. Rows with
        // missing first or last are skipped and reported.
        var valid = [];
        var skipped = [];

        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            if (!r.first || !r.last) {
                skipped.push({
                    rowIndex: r.rowIndex,
                    message: 'First and Last name are required.'
                });
                continue;
            }

            // Birth year is optional. When set, it must be a
            // positive integer. Validate here so we do not need
            // to interpret a CRUD failure for that specific case.
            if (r.birthYear !== '') {
                var yr = parseInt(r.birthYear, 10);
                if (isNaN(yr) || yr < 1) {
                    skipped.push({
                        rowIndex: r.rowIndex,
                        message: 'Birth Year must be a positive ' +
                            'integer, or blank.'
                    });
                    continue;
                }
            }

            valid.push(r);
        }

        if (valid.length === 0) {
            notify(
                'No valid rows to create. Check the highlighted ' +
                'rows.',
                'error'
            );
            reportResults({ created: 0, failed: skipped, total: rows.length });
            return;
        }

        _busy = true;
        setBusy(true);

        runBatch(valid, skipped)
            .then(function() {
                // runBatch handles its own reporting.
            })
            .catch(function(err) {
                console.warn(
                    '[CharacterBulkCreate] Batch threw:', err
                );
                notify(
                    'Bulk create failed: ' + (err.message || err),
                    'error'
                );
            })
            .then(function() {
                _busy = false;
                setBusy(false);
            });
    }

    function runBatch(valid, skipped) {
        var created = 0;
        var failed = skipped.slice(); // pre-validation skips

        var chain = Promise.resolve();

        valid.forEach(function(row) {
            chain = chain.then(function() {
                var dto = {
                    _editId: null,

                    firstName: row.first,
                    lastName: row.last,
                    middleName: '',
                    nickname: row.nickname || '',
                    alias: '',

                    gender: row.gender || '',
                    birthYear: row.birthYear || '',

                    // Mark as filler so Hide Filler hides it by
                    // default. CharacterCRUD.save runs this
                    // through normaliseCharacterData and
                    // CharacterStrip.stripEmptyFields.
                    isFiller: true,

                    // Everything else left empty; normalisation
                    // fills defaults for stats, HP, MP, etc.
                    personality: {},
                    stats: undefined,
                    magic: undefined,
                    careerStatus: [],
                    specialMoves: { physical: [], magical: [] }
                };

                return CharacterCRUD.save(dto)
                    .then(function(result) {
                        if (result && result.success) {
                            created++;
                        } else {
                            failed.push({
                                rowIndex: row.rowIndex,
                                message:
                                    (result && result.message) ||
                                    'Unknown error.'
                            });
                        }
                    })
                    .catch(function(err) {
                        failed.push({
                            rowIndex: row.rowIndex,
                            message:
                                (err && err.message) ||
                                String(err)
                        });
                    });
            });
        });

        return chain.then(function() {
            reportResults({
                created: created,
                failed: failed,
                total: valid.length + skipped.length
            });

            // Refresh the character list if it exists.
            var List = getCharacterList();
            if (List && typeof List.refresh === 'function') {
                try { List.refresh(); } catch (e) {}
            }

            // Close the modal after a batch that had any success.
            if (created > 0) {
                _busy = false;   // allow close
                close();
            }
        });
    }

    function reportResults(summary) {
        var created = summary.created || 0;
        var failed = summary.failed || [];
        var total = summary.total || 0;

        if (failed.length === 0) {
            notify(
                'Created ' + created + ' character' +
                (created === 1 ? '' : 's') + '.',
                'success'
            );
            return;
        }

        // Partial success. Report failures to the console and
        // summarise in the notification.
        console.warn(
            '[CharacterBulkCreate] ' + failed.length +
            ' row(s) failed:'
        );
        for (var i = 0; i < failed.length; i++) {
            console.warn(
                '  Row ' + (failed[i].rowIndex + 1) + ': ' +
                failed[i].message
            );
        }

        if (created === 0) {
            notify(
                'No characters created (' + failed.length +
                ' row' + (failed.length === 1 ? '' : 's') +
                ' failed). See console for details.',
                'error'
            );
            return;
        }

        notify(
            'Created ' + created + ' of ' + total +
            ' (see console for row failures).',
            'warning'
        );
    }

    // ============================================================
    // BUSY STATE
    // ============================================================

    function setBusy(isBusy) {
        if (!_contentEl) { return; }

        var inputs = _contentEl.querySelectorAll('input');
        for (var i = 0; i < inputs.length; i++) {
            inputs[i].disabled = isBusy;
        }

        var buttons = _contentEl.querySelectorAll(
            '[data-bulk-action="add-row"], ' +
            '[data-bulk-action="remove-row"], ' +
            '[data-bulk-action="close"], ' +
            '[data-bulk-action="create"]'
        );
        for (var j = 0; j < buttons.length; j++) {
            buttons[j].disabled = isBusy;
        }

        var submit = _contentEl.querySelector('#bulk-create-submit');
        if (submit) {
            submit.textContent = isBusy ? 'Creating...' : 'Create All';
        }
    }

    // ============================================================
    // EVENT HANDLING
    // ============================================================

    function handleContentClick(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') { return; }

        var actionEl = target.closest('[data-bulk-action]');
        if (!actionEl || !actionEl.dataset) { return; }

        var action = actionEl.dataset.bulkAction;

        if (action === 'close') {
            e.preventDefault();
            close();
            return;
        }

        if (action === 'add-row') {
            e.preventDefault();
            addRow();
            return;
        }

        if (action === 'remove-row') {
            e.preventDefault();
            removeRow(actionEl);
            return;
        }

        if (action === 'create') {
            e.preventDefault();
            handleCreate();
            return;
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterBulkCreate = Object.freeze({
        open: open,
        close: close,
        isOpen: function() { return _modal !== null; }
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.CharacterBulkCreate;
        var missing = [];

        var required = ['open', 'close', 'isOpen'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        try {
            if (exports.isOpen() !== false) {
                missing.push('isOpen() should be false before open()');
            }
        } catch (e) {
            missing.push('smoke test threw: ' + e.message);
        }

        if (missing.length > 0) {
            console.warn(
                '[CharacterBulkCreate] Verification failed:',
                missing.join(', ')
            );
        }
    })();

})();
