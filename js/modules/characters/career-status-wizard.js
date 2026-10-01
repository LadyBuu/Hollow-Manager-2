/**
 * js/modules/characters/career-status-wizard.js - Career Status Wizard
 *
 * Modal that generates a character's careerStatus array from a
 * start year, a route, and a duration convention.
 *
 * Path: js/modules/characters/career-status-wizard.js
 *
 * WHAT THIS MODULE OWNS:
 *   The modal and its preview. It writes nothing. It calls
 *   CharacterCRUD.applyCareerStatusTimeline(id, stages) to
 *   commit, and that is the only mutation it performs.
 *
 * ROUTES:
 *   A — Trainee → Rookie → Junior → Senior
 *   B — Trainee → Rookie → [Junior?] → Support
 *
 *   Route B is parametrised by a checkbox: when "Junior first"
 *   is checked, the timeline includes a junior stage; when
 *   unchecked, rookie is followed immediately by support.
 *
 * DURATIONS (fixed):
 *   trainee  1 year
 *   rookie   2 years
 *   junior   2 years
 *   senior   ongoing (no end)
 *   support  ongoing (no end)
 *
 * DURATION CONVENTION (user-selected):
 *   Inclusive — the next stage starts in the SAME YEAR the
 *               previous stage ends.
 *   Exclusive — the next stage starts in the YEAR AFTER the
 *               previous stage ends.
 *
 *   The convention affects ONLY the next stage's startYear.
 *   A stage's endYear is always `startYear + duration - 1`,
 *   regardless of convention.
 *
 * ALREADY-SET STAGES:
 *   When a stage the wizard would produce already exists in the
 *   character's careerStatus array, the existing stage is NOT
 *   overwritten. Its startYear becomes the anchor for the next
 *   stage, and the wizard continues from there.
 *
 *   In the preview, skipped stages are greyed out with a
 *   "(kept existing)" annotation.
 *
 * REPLACE EVERYTHING:
 *   The wizard produces a NEW array. Every stage NOT in that
 *   array is dropped when the character is saved. The preview
 *   warns about how many existing entries will be removed.
 *
 * DEATH-YEAR CLAMP:
 *   When the character has a parseable deathYear:
 *     - Ongoing stages (senior, support) end at deathYear.
 *     - Stages that would start strictly AFTER deathYear are
 *       dropped from the output.
 *     - Stages that would span deathYear are truncated at it.
 *
 *   A character with no deathYear (or a malformed one) is not
 *   clamped: ongoing stages stay ongoing.
 *
 * LIVE PREVIEW:
 *   The preview recomputes on every input change. There is no
 *   "Generate" button; the user sets inputs and sees the result
 *   immediately.
 *
 * DEPENDENCIES (MANDATORY):
 *   - window.CharacterQueries
 *   - window.CharacterCRUD
 *   - window.Modal
 *   - window.NotificationSystem
 *   - window.DomUtils  (for escaping; imported lazily)
 */

(function() {
    'use strict';

    if (window.__careerStatusWizardLoaded) {
        return;
    }

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var CharacterCRUD = window.CharacterCRUD;
    var Modal = window.Modal;
    var NotificationSystem = window.NotificationSystem;

    var _missing = [];

    if (!CharacterQueries ||
        typeof CharacterQueries.getCharacterById !== 'function') {
        _missing.push('CharacterQueries.getCharacterById');
    }
    if (!CharacterQueries ||
        typeof CharacterQueries.getDisplayName !== 'function') {
        _missing.push('CharacterQueries.getDisplayName');
    }
    if (!CharacterCRUD ||
        typeof CharacterCRUD.applyCareerStatusTimeline !== 'function') {
        _missing.push('CharacterCRUD.applyCareerStatusTimeline');
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
            '[CareerStatusWizard] Missing mandatory dependencies: ' +
            _missing.join(', ')
        );
    }

    window.__careerStatusWizardLoaded = true;

    // ============================================================
    // DURATIONS
    // ============================================================
    //
    // Fixed durations. A stage occupies `duration` consecutive
    // integer years, starting at its startYear. Ongoing stages
    // have duration null.

    var DURATIONS = {
        trainee: 1,
        rookie:  2,
        junior:  2,
        senior:  null,
        support: null
    };

    // ============================================================
    // MODULE STATE
    // ============================================================

    var _modal = null;
    var _contentEl = null;
    var _charId = null;
    var _onClose = null;

    // Live form state. Rebuilt from the DOM on every change.
    var _state = {
        startYear: 1900,
        route: 'A',            // 'A' | 'B'
        routeBJunior: true,    // meaningful only when route === 'B'
        convention: 'exclusive' // 'inclusive' | 'exclusive'
    };

    var _contentChangeHandler = null;
    var _contentClickHandler = null;
    var _contentInputHandler = null;

    // ============================================================
    // HELPERS - escaping
    // ============================================================

    function escapeHtml(value) {
        var DomUtils = window.DomUtils;
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
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
        var DomUtils = window.DomUtils;
        if (DomUtils && typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
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

    // ============================================================
    // HELPERS - character reads
    // ============================================================

    function parseYearInt(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        var n = parseInt(String(value).trim(), 10);
        if (isNaN(n) || n < 1) {
            return null;
        }
        return n;
    }

    function getExistingCareerStatus(charId) {
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) { return []; }
        if (!Array.isArray(char.careerStatus)) { return []; }
        return char.careerStatus;
    }

    function getExistingStage(charId, status) {
        var list = getExistingCareerStatus(charId);
        for (var i = 0; i < list.length; i++) {
            var entry = list[i];
            if (!entry || typeof entry !== 'object') { continue; }
            var s = String(entry.status || '').toLowerCase();
            if (s === status) {
                return entry;
            }
        }
        return null;
    }

    function getDeathYear(charId) {
        var char = CharacterQueries.getCharacterById(charId);
        if (!char) { return null; }
        return parseYearInt(char.deathYear);
    }

    // ============================================================
    // TIMELINE GENERATION
    // ============================================================
    //
    // Produces an array of result entries:
    //
    //   {
    //     status:     'trainee' | 'rookie' | ...,
    //     startYear:  integer,
    //     endYear:    integer | '',      (open-ended => '')
    //     title:      '',
    //     kept:       boolean,           (true if it's an existing
    //                                     stage the wizard is
    //                                     NOT overwriting)
    //     dropped:    boolean            (true if the death-year
    //                                     clamp removed it)
    //   }
    //
    // Also produces an `existingCount` and `finalCount` for the
    // warning block.

    function generateTimeline(charId) {
        var startYear = _state.startYear;
        var route = _state.route;
        var routeBJunior = _state.routeBJunior;
        var convention = _state.convention;

        // Build the stage plan for the chosen route.
        var plan = ['trainee', 'rookie'];
        if (route === 'A') {
            plan.push('junior');
            plan.push('senior');
        } else {
            // route === 'B'
            if (routeBJunior) {
                plan.push('junior');
            }
            plan.push('support');
        }

        var deathYear = getDeathYear(charId);
        var result = [];
        var cursor = startYear;
        var lastEndedYear = null; // for inclusive/exclusive anchor
        var anyDropped = false;

        for (var i = 0; i < plan.length; i++) {
            var status = plan[i];

            // ---- Determine the effective start for this stage. ----
            //
            // If the stage already exists, reuse the existing
            // startYear. Do NOT recompute it from the cursor. The
            // existing stage is treated as authoritative.
            //
            // Otherwise, start at the cursor. Cursor is either the
            // initial start year (for the first stage) or the
            // previous stage's end (inclusive) / end + 1
            // (exclusive).

            var existing = getExistingStage(charId, status);

            var effectiveStart;
            if (existing &&
                existing.startYear !== undefined &&
                existing.startYear !== null &&
                String(existing.startYear).trim() !== '') {
                var exStart = parseYearInt(existing.startYear);
                effectiveStart = exStart !== null ? exStart : cursor;
            } else {
                effectiveStart = cursor;
            }

            var duration = DURATIONS[status];
            var endYear = '';
            var ongoing = duration === null;

            if (!ongoing) {
                endYear = effectiveStart + duration - 1;
            }

            // ---- Death-year clamp. ----
            //
            // Rules:
            //   - If the stage's startYear is strictly AFTER
            //     deathYear, drop it.
            //   - If the stage is ongoing and deathYear exists,
            //     end it at deathYear.
            //   - If the stage spans deathYear, truncate at
            //     deathYear.
            //
            // A stage whose truncated end is before its start is
            // also dropped. (This can only happen if the stage
            // starts after deathYear, which the first rule
            // already catches; kept here as belt-and-braces.)

            var dropped = false;

            if (deathYear !== null) {
                if (effectiveStart > deathYear) {
                    dropped = true;
                } else if (ongoing) {
                    endYear = deathYear;
                } else if (endYear > deathYear) {
                    endYear = deathYear;
                }
            }

            result.push({
                status: status,
                startYear: effectiveStart,
                endYear: endYear,
                title: '',
                kept: existing !== null,
                dropped: dropped,
                ongoing: ongoing && !dropped && endYear === ''
            });

            if (dropped) {
                anyDropped = true;
                // Cursor does not advance for a dropped stage;
                // there is nothing after it that could be
                // reached anyway.
                break;
            }

            // ---- Advance the cursor for the next stage. ----
            //
            // Inclusive: next stage starts on this stage's endYear.
            // Exclusive: next stage starts the year after.
            //
            // Ongoing stages (senior, support) always terminate the
            // plan, so we never advance past them.

            if (ongoing) {
                // Nothing after an ongoing stage; stop.
                // (Plan construction never places a stage after
                // senior or support, but keep the guard for
                // clarity.)
                lastEndedYear = null;
            } else {
                lastEndedYear = endYear;
                if (convention === 'inclusive') {
                    cursor = endYear;
                } else {
                    cursor = endYear + 1;
                }
            }
        }

        // ---- Count existing stages NOT in the plan. ----
        //
        // Those are the ones that will be removed when the wizard
        // commits. Report them so the warning is accurate.

        var existingList = getExistingCareerStatus(charId);
        var planSet = Object.create(null);
        for (var p = 0; p < plan.length; p++) {
            planSet[plan[p]] = true;
        }

        var existingNotInPlan = 0;
        for (var e = 0; e < existingList.length; e++) {
            var entry = existingList[e];
            if (!entry || typeof entry !== 'object') { continue; }
            var s = String(entry.status || '').toLowerCase();
            if (!planSet[s]) {
                existingNotInPlan++;
            }
        }

        return {
            rows: result,
            existingNotInPlan: existingNotInPlan,
            anyDropped: anyDropped,
            deathYear: deathYear
        };
    }

    // ============================================================
    // STATE SYNC FROM DOM
    // ============================================================

    function readStateFromDOM() {
        if (!_contentEl) { return; }

        var startEl = _contentEl.querySelector('#csw-start-year');
        if (startEl) {
            var v = parseYearInt(startEl.value);
            if (v !== null) {
                _state.startYear = v;
            }
        }

        var routeRadios = _contentEl.querySelectorAll(
            'input[name="csw-route"]'
        );
        for (var i = 0; i < routeRadios.length; i++) {
            if (routeRadios[i].checked) {
                _state.route = routeRadios[i].value;
                break;
            }
        }

        var juniorCb = _contentEl.querySelector('#csw-routeb-junior');
        if (juniorCb) {
            _state.routeBJunior = juniorCb.checked === true;
        }

        var convRadios = _contentEl.querySelectorAll(
            'input[name="csw-convention"]'
        );
        for (var j = 0; j < convRadios.length; j++) {
            if (convRadios[j].checked) {
                _state.convention = convRadios[j].value;
                break;
            }
        }
    }

    // ============================================================
    // RENDER
    // ============================================================

    function renderContent() {
        if (!_contentEl) { return; }
        _contentEl.innerHTML = buildModalHTML();
    }

    function buildModalHTML() {
        var char = CharacterQueries.getCharacterById(_charId);
        var charName = char
            ? CharacterQueries.getDisplayName(char)
            : 'Unknown';

        var generated = generateTimeline(_charId);
        var rows = generated.rows;
        var existingNotInPlan = generated.existingNotInPlan;
        var anyDropped = generated.anyDropped;
        var deathYear = generated.deathYear;

        var html = '';

        // ---- Header ----
        html += '<div class="modal-header">';
        html += '<h3>Career Wizard \u2014 ' +
                    escapeHtml(charName) +
                '</h3>';
        html += '<button type="button" class="close-modal" ' +
                    'data-wizard-action="close" ' +
                    'aria-label="Close">&times;</button>';
        html += '</div>';

        // ---- Body ----
        html += '<div class="modal-body career-wizard-body">';

        // ---- Start year ----
        html += '<div class="form-group csw-field">';
        html += '<label for="csw-start-year">' +
                    'Start year (first year of trainee)' +
                '</label>';
        html += '<input type="number" id="csw-start-year" ' +
                    'class="csw-start-year" ' +
                    'min="1" ' +
                    'value="' +
                        escapeAttribute(String(_state.startYear)) +
                    '">';
        html += '</div>';

        // ---- Route ----
        html += '<div class="form-group csw-field">';
        html += '<label>Route</label>';

        html += '<label class="csw-radio-row">';
        html += '<input type="radio" name="csw-route" value="A"' +
                    (_state.route === 'A' ? ' checked' : '') + '>';
        html += '<span>Route A \u2014 Trainee \u2192 Rookie \u2192 ' +
                    'Junior \u2192 Senior</span>';
        html += '</label>';

        html += '<label class="csw-radio-row">';
        html += '<input type="radio" name="csw-route" value="B"' +
                    (_state.route === 'B' ? ' checked' : '') + '>';
        html += '<span>Route B \u2014 Trainee \u2192 Rookie \u2192 ' +
                    '\u2026 \u2192 Support</span>';
        html += '</label>';

        // Route B sub-option
        html += '<div class="csw-suboption"' +
                    (_state.route === 'B' ? '' : ' style="display:none;"') +
                    ' id="csw-routeb-options">';
        html += '<label class="csw-checkbox-row">';
        html += '<input type="checkbox" id="csw-routeb-junior"' +
                    (_state.routeBJunior ? ' checked' : '') + '>';
        html += '<span>Include a Junior stage before Support</span>';
        html += '</label>';
        html += '</div>';

        html += '</div>';

        // ---- Convention ----
        html += '<div class="form-group csw-field">';
        html += '<label>Next-stage timing</label>';

        html += '<label class="csw-radio-row">';
        html += '<input type="radio" name="csw-convention" ' +
                    'value="inclusive"' +
                    (_state.convention === 'inclusive'
                        ? ' checked' : '') + '>';
        html += '<span>Inclusive \u2014 next stage starts in the ' +
                    '<strong>same year</strong> the previous stage ' +
                    'ends</span>';
        html += '</label>';

        html += '<label class="csw-radio-row">';
        html += '<input type="radio" name="csw-convention" ' +
                    'value="exclusive"' +
                    (_state.convention === 'exclusive'
                        ? ' checked' : '') + '>';
        html += '<span>Exclusive \u2014 next stage starts the ' +
                    '<strong>year after</strong> the previous stage ' +
                    'ends</span>';
        html += '</label>';

        html += '</div>';

        // ---- Preview ----
        html += '<div class="csw-preview">';
        html += '<div class="csw-preview-header">Preview</div>';
        html += renderPreviewTable(rows);

        if (deathYear !== null) {
            html += '<p class="csw-note">';
            html += '\u2139 This character died in ' +
                escapeHtml(String(deathYear)) +
                '. Ongoing stages are clamped to that year, and ' +
                'stages starting after it are omitted.';
            html += '</p>';
        }

        html += '</div>';

        // ---- Warning ----
        var warningParts = [];
        if (existingNotInPlan > 0) {
            warningParts.push(
                existingNotInPlan +
                ' existing career status entr' +
                (existingNotInPlan === 1 ? 'y' : 'ies') +
                ' not covered by this wizard will be removed'
            );
        }
        if (anyDropped) {
            warningParts.push(
                'one or more stages were omitted because the ' +
                'character died before reaching them'
            );
        }

        html += '<div class="csw-warning">';
        if (warningParts.length > 0) {
            html += '<span class="csw-warning-icon">\u26a0</span>';
            html += '<span>Replacing career status. ' +
                escapeHtml(warningParts.join('. ')) +
                '.</span>';
        } else {
            html += '<span class="csw-warning-icon csw-warning-ok">' +
                        '\u2713' +
                    '</span>';
            html += '<span>Replacing career status. No existing ' +
                        'entries will be lost.</span>';
        }
        html += '</div>';

        html += '</div>';

        // ---- Footer ----
        html += '<div class="modal-footer csw-footer">';
        html += '<button type="button" class="secondary" ' +
                    'data-wizard-action="close">Cancel</button>';
        html += '<span class="csw-footer-spacer"></span>';
        html += '<button type="button" class="primary" ' +
                    'data-wizard-action="apply"' +
                    (rows.length === 0 ? ' disabled' : '') + '>' +
                    'Replace Career Status' +
                '</button>';
        html += '</div>';

        return html;
    }

    function renderPreviewTable(rows) {
        if (!rows || rows.length === 0) {
            return '<p class="empty-state csw-empty">' +
                        'No stages to generate with these settings.' +
                    '</p>';
        }

        var html = '';
        html += '<table class="csw-preview-table">';
        html += '<thead>';
        html += '<tr>';
        html += '<th>Status</th>';
        html += '<th>Start</th>';
        html += '<th>End</th>';
        html += '<th>Note</th>';
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';

        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            var rowClass = 'csw-row';
            if (r.kept) { rowClass += ' csw-row-kept'; }
            if (r.dropped) { rowClass += ' csw-row-dropped'; }

            var endDisplay;
            if (r.dropped) {
                endDisplay = '\u2014';
            } else if (r.endYear === '' || r.endYear === null ||
                       r.endYear === undefined) {
                endDisplay = '\u2014';
            } else {
                endDisplay = String(r.endYear);
            }

            var note = '';
            if (r.dropped) {
                note = 'omitted (died before start)';
            } else if (r.kept) {
                note = 'kept existing';
            } else if (r.ongoing) {
                note = 'ongoing';
            }

            html += '<tr class="' + rowClass + '">';
            html += '<td>' + escapeHtml(r.status) + '</td>';
            html += '<td>' + escapeHtml(String(r.startYear)) + '</td>';
            html += '<td>' + escapeHtml(endDisplay) + '</td>';
            html += '<td class="csw-note-cell">' + escapeHtml(note) +
                    '</td>';
            html += '</tr>';
        }

        html += '</tbody>';
        html += '</table>';
        return html;
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    function handleContentClick(e) {
        var target = e.target;
        if (!target || typeof target.closest !== 'function') { return; }

        var btn = target.closest('[data-wizard-action]');
        if (!btn || !btn.dataset) { return; }

        var action = btn.dataset.wizardAction;

        if (action === 'close') {
            e.preventDefault();
            closeModal();
            return;
        }

        if (action === 'apply') {
            e.preventDefault();
            handleApply();
            return;
        }
    }

    function handleContentChange(e) {
        var target = e.target;
        if (!target) { return; }

        // Route radio toggles the Route B sub-option visibility.
        // The sub-option visibility is a DOM concern handled in
        // the re-render below; no direct manipulation here.
        readStateFromDOM();
        renderContent();
    }

    function handleContentInput(e) {
        var target = e.target;
        if (!target) { return; }

        // Only re-render on start-year changes; text input fires
        // an input event on every keystroke.
        if (target.id === 'csw-start-year') {
            readStateFromDOM();
            renderContent();
        }
    }

    // ============================================================
    // APPLY
    // ============================================================

    function handleApply() {
        readStateFromDOM();

        var generated = generateTimeline(_charId);
        var rows = generated.rows;

        if (rows.length === 0) {
            notify('No stages to apply.', 'error');
            return;
        }

        // Build the final careerStatus array. Drop the wizard-
        // internal metadata (`kept`, `dropped`, `ongoing`); only
        // the four canonical fields survive.
        var stages = [];
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            if (r.dropped) { continue; }
            stages.push({
                status: r.status,
                startYear: String(r.startYear),
                endYear: r.endYear === '' || r.endYear === null
                    ? ''
                    : String(r.endYear),
                title: r.title || ''
            });
        }

        if (stages.length === 0) {
            notify('All stages were omitted.', 'error');
            return;
        }

        CharacterCRUD.applyCareerStatusTimeline(_charId, stages)
            .then(function(result) {
                if (result && result.success) {
                    notify(
                        'Career status replaced: ' + stages.length +
                        ' stage' + (stages.length === 1 ? '' : 's') +
                        '.',
                        'success'
                    );
                    closeModal();
                    return;
                }
                notify(
                    'Failed to apply career status: ' +
                    ((result && result.message) || 'Unknown error'),
                    'error'
                );
            })
            .catch(function(err) {
                console.warn(
                    '[CareerStatusWizard] apply threw:', err
                );
                notify(
                    'Failed to apply career status: ' + err.message,
                    'error'
                );
            });
    }

    // ============================================================
    // OPEN / CLOSE
    // ============================================================

    function openModal(charId) {
        if (!charId) {
            notify('No character selected.', 'error');
            return null;
        }

        var char = CharacterQueries.getCharacterById(charId);
        if (!char) {
            notify('Character not found.', 'error');
            return null;
        }

        closeModal();

        _charId = String(charId);
        _onClose = null;

        // Seed the start year: if the character has a trainee
        // stage, reuse its startYear so the wizard opens on the
        // existing timeline. Otherwise default to the character's
        // birthYear + 16, or 1900.
        var existingTrainee = getExistingStage(_charId, 'trainee');
        var seedYear = null;
        if (existingTrainee) {
            seedYear = parseYearInt(existingTrainee.startYear);
        }
        if (seedYear === null) {
            var birth = parseYearInt(char.birthYear);
            if (birth !== null) {
                seedYear = birth + 16;
            }
        }
        if (seedYear === null) {
            seedYear = 1900;
        }

        _state.startYear = seedYear;
        _state.route = 'A';
        _state.routeBJunior = true;
        _state.convention = 'exclusive';

        var shell = Modal.createModal('career-status-wizard-modal');
        if (!shell) {
            notify('Failed to create modal.', 'error');
            _charId = null;
            return null;
        }
        shell.id = 'career-status-wizard-modal';

        var contentEl = document.createElement('div');
        contentEl.className = 'modal-content wide';
        shell.appendChild(contentEl);

        _modal = shell;
        _contentEl = contentEl;

        _contentChangeHandler = handleContentChange;
        _contentClickHandler = handleContentClick;
        _contentInputHandler = handleContentInput;

        contentEl.addEventListener('change', _contentChangeHandler);
        contentEl.addEventListener('click', _contentClickHandler);
        contentEl.addEventListener('input', _contentInputHandler);

        renderContent();

        Modal.modalSetup(shell, function() {
            closeModal();
        });
        Modal.showModal(shell);

        return shell;
    }

    function closeModal() {
        var modal = _modal;
        var contentEl = _contentEl;

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

        _modal = null;
        _contentEl = null;
        _charId = null;

        _contentChangeHandler = null;
        _contentClickHandler = null;
        _contentInputHandler = null;

        if (modal) {
            try {
                Modal.closeModal(modal);
            } catch (e) {
                // Ignore.
            }
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CareerStatusWizard = Object.freeze({
        openModal: openModal,
        closeModal: closeModal,

        // Exposed for testing.
        // generateTimeline is stateful in production (it reads
        // _state and _charId); the test helpers below set state
        // explicitly.
        _setState: function(next) {
            if (!next || typeof next !== 'object') { return; }
            if (typeof next.startYear === 'number') {
                _state.startYear = next.startYear;
            }
            if (next.route === 'A' || next.route === 'B') {
                _state.route = next.route;
            }
            if (typeof next.routeBJunior === 'boolean') {
                _state.routeBJunior = next.routeBJunior;
            }
            if (next.convention === 'inclusive' ||
                next.convention === 'exclusive') {
                _state.convention = next.convention;
            }
        },
        _setCharId: function(id) {
            _charId = id ? String(id) : null;
        },
        _generate: function() {
            return generateTimeline(_charId);
        }
    });

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.CareerStatusWizard;
        var missing = [];

        var required = ['openModal', 'closeModal'];
        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn(
                '[CareerStatusWizard] Verification - some exports ' +
                'may be missing:', missing.join(', ')
            );
        }
    })();

})();
