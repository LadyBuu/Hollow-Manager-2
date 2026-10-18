/**
 * js/modules/characters/character-form.js - Character Form
 * Form rendering, tab switching, and field population.
 *
 * Path: js/modules/characters/character-form.js
 *
 * WHAT THIS OWNS:
 *   - The character form HTML (all eight tabs).
 *   - Field population from a character record.
 *   - Field collection into a save DTO.
 *   - Tab switching.
 *
 * WHAT THIS DOES NOT OWN:
 *   - Event binding. CharacterEvents owns it, via delegation.
 *   - Field value setting. FormUtils does the actual DOM writes.
 *   - The Combat tab's magical section and moves section.
 *     CharacterStatsView owns them.
 *   - The Social tab body. CharacterViews owns it.
 *   - The Academic tab body. CharacterClassView owns it.
 *   - The Professional tab's team panel. CharacterViews owns it.
 *
 * COLLECTION CONTRACT:
 *   Every field is read via FormUtils.getField(id). Not getFormData().
 *   The Combat tab's magic and moves blocks are the exception: they
 *   are read back via CharacterStatsView.collectMagicalFields() and
 *   CharacterStatsView.collectMovesFromDOM(), which own the DOM
 *   shapes they render.
 *
 * GENDER FIELD:
 *   Gender is edited on the Physical tab ONLY. The Name tab does
 *   not render a char-gender input.
 *
 *   This is the fix for a bug where two inputs shared the id
 *   char-gender. The Name tab's copy came first in document order,
 *   so getElementById always returned it, and edits typed into the
 *   Physical-tab input were never read on save. The Name-tab copy
 *   has been removed entirely; the Physical tab is the only
 *   gender field in the form.
 *
 *   Do NOT reintroduce a second char-gender input. If a caller
 *   ever needs to move gender to another tab, remove it from the
 *   Physical tab in the same change.
 *
 * DEATH FIELDS:
 *   The "deceased" checkbox state is derived from `deathYear !== ''`,
 *   not from the cached char.deceased. A character with a planned
 *   future death keeps the death fields enabled and persists them.
 *   collect() reads the death fields whenever they have a value,
 *   regardless of the checkbox; CharacterCRUD recomputes the
 *   deceased cache.
 *
 *   After a snapshot restore (the re-render merge path), the
 *   renderer re-synchronises the deceased checkbox, the
 *   #death-fields display, and the per-field disabled state to
 *   whatever the restored checkbox says. Without this, a restore
 *   could leave the checkbox unchecked while the death fields
 *   remained enabled (or vice versa), because populateFormFields
 *   wrote the *stored* state before restoreSnapshot overwrote the
 *   checkbox.
 *
 * CAREER / WEAPON FALLBACK OPTIONS:
 *   A career status or weapon type that is not in the current
 *   CAREER_STATUS_OPTIONS or WEAPON_TYPES list is preserved by
 *   appending a fallback <option>. This makes a round-trip through
 *   the form lossless for legacy or imported values such as
 *   "instructor (former)".
 *
 * RE-RENDER MERGE:
 *   render() detects when the form is already showing a character
 *   and re-rendering that same character. In that case it snapshots
 *   the current DOM values before rebuilding, then repopulates them
 *   after. Unsaved edits survive re-renders triggered by class
 *   additions, stint changes, or wizard close.
 *
 *   Switching to a DIFFERENT character discards the snapshot, as it
 *   should.
 *
 * LABEL / BUTTON SEPARATION:
 *   renderLabelWithRandom emits a <label for="..."> and places the
 *   reroll button OUTSIDE the label. Clicking the label focuses the
 *   input; clicking the button rerolls. Previously the button was
 *   nested inside the label, and clicking the label text triggered
 *   a reroll.
 *
 * NUMERIC INPUT ESCAPING:
 *   Stat, HP, MP, and abbreviation values are passed through
 *   escapeAttribute before being interpolated into value attributes.
 *   The rest of the file escapes via escapeHtml or escapeAttribute
 *   consistently.
 *
 * SPECIAL MOVES:
 *   Moves live in the DOM, not in a field id. On render, the moves
 *   section is populated by CharacterStatsView.renderMovesSection.
 *   On save, collect() reads the moves back out via
 *   CharacterStatsView.collectMovesFromDOM().
 *
 * ACTION ROW:
 *   LEFT:  Import JSON (always), Export JSON / Export Report /
 *          Delete (Edit only).
 *   RIGHT: Cancel, Create / Update.
 *
 * DEPENDENCIES (LAZY):
 *   - window.CharacterQueries
 *   - window.CharacterCRUD
 *   - window.CharacterGenerator
 *   - window.CharacterConstants
 *   - window.MagicConstants
 *   - window.CharacterStats
 *   - window.CharacterStatsView
 *   - window.CharacterViews
 *   - window.CharacterClassView
 *   - window.AcademyClasses
 *   - window.FormUtils
 *   - window.DomUtils
 */

(function() {
    'use strict';

    if (window.__characterFormLoaded) {
        return;
    }
    window.__characterFormLoaded = true;

    // ============================================================
    // LAZY DEPENDENCIES
    // ============================================================

    function getCharacterQueries() { return window.CharacterQueries || null; }
    function getCharacterCRUD() { return window.CharacterCRUD || null; }
    function getCharacterGenerator() { return window.CharacterGenerator || null; }
    function getCharacterConstants() { return window.CharacterConstants || null; }
    function getMagicConstants() { return window.MagicConstants || null; }
    function getCharacterStats() { return window.CharacterStats || null; }
    function getCharacterStatsView() { return window.CharacterStatsView || null; }
    function getCharacterViews() { return window.CharacterViews || null; }
    function getCharacterClassView() { return window.CharacterClassView || null; }
    function getAcademyClasses() { return window.AcademyClasses || null; }
    function getFormUtils() { return window.FormUtils || null; }
    function getDomUtils() { return window.DomUtils || null; }

    function getCurrentEditId() {
        if (typeof window.getCurrentEditId === 'function') {
            return window.getCurrentEditId();
        }
        if (window._currentEditId !== undefined) {
            return window._currentEditId;
        }
        return null;
    }

    function setCurrentEditId(id) {
        if (typeof window.setCurrentEditId === 'function') {
            window.setCurrentEditId(id);
        } else {
            window._currentEditId = id;
        }
    }

    // ============================================================
    // DEPENDENCY CHECK - at render time
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!getCharacterQueries()) { missing.push('CharacterQueries'); }
        if (!getCharacterCRUD()) { missing.push('CharacterCRUD'); }
        if (!getCharacterConstants()) { missing.push('CharacterConstants'); }
        if (!getMagicConstants()) { missing.push('MagicConstants'); }
        if (!getCharacterStats()) { missing.push('CharacterStats'); }
        if (!getAcademyClasses()) { missing.push('AcademyClasses'); }
        if (!getFormUtils()) { missing.push('FormUtils'); }
        if (!getDomUtils()) { missing.push('DomUtils'); }

        if (missing.length > 0) {
            console.warn(
                '[CharacterForm] Critical dependencies missing:',
                missing.join(', ')
            );
            return false;
        }
        return true;
    }

    // ============================================================
    // ESCAPING
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

    // ============================================================
    // CONSTANT ACCESSORS
    // ============================================================

    function getStatKeys() {
        var CC = getCharacterConstants();
        if (CC && Array.isArray(CC.STAT_KEYS)) {
            return CC.STAT_KEYS;
        }
        return ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    }

    function getStatDefinitions() {
        var CC = getCharacterConstants();
        return CC ? CC.STAT_DEFINITIONS || {} : {};
    }

    function getStatMin() {
        var CC = getCharacterConstants();
        if (CC && typeof CC.STAT_MIN === 'number') { return CC.STAT_MIN; }
        return 1;
    }

    function getStatMax() {
        var CC = getCharacterConstants();
        if (CC && typeof CC.STAT_MAX === 'number') { return CC.STAT_MAX; }
        return 30;
    }

    function getStatDefault() {
        var CC = getCharacterConstants();
        if (CC && typeof CC.STAT_DEFAULT === 'number') {
            return CC.STAT_DEFAULT;
        }
        return 10;
    }

    function getPhysicalClasses() {
        var CC = getCharacterConstants();
        return CC && typeof CC.getPhysicalClasses === 'function'
            ? CC.getPhysicalClasses()
            : [];
    }

    function getWeaponTypes() {
        var CC = getCharacterConstants();
        return CC && typeof CC.getWeaponTypes === 'function'
            ? CC.getWeaponTypes()
            : [];
    }

    function getDefaultWeaponType() {
        var CC = getCharacterConstants();
        return CC && CC.DEFAULT_WEAPON_TYPE
            ? CC.DEFAULT_WEAPON_TYPE
            : 'sharp';
    }

    function getCareerStatusOptions() {
        var CC = getCharacterConstants();
        if (CC && Array.isArray(CC.CAREER_STATUS_OPTIONS)) {
            return CC.CAREER_STATUS_OPTIONS;
        }
        return [
            { value: '', label: 'Select status...' },
            { value: 'civilian', label: 'Civilian' },
            { value: 'trainee', label: 'Trainee' },
            { value: 'rookie', label: 'Rookie' },
            { value: 'junior', label: 'Junior' },
            { value: 'senior', label: 'Senior' },
            { value: 'instructor', label: 'Instructor' },
            { value: 'support', label: 'Support' },
            { value: 'retired', label: 'Retired' }
        ];
    }

    // ============================================================
    // PER-FIELD RANDOM
    // ============================================================
    //
    // The label gets a `for` attribute pointing at the input; the
    // reroll button is a SIBLING of the label, not a descendant.
    // Clicking the label focuses the input. Clicking the button
    // rerolls. This fixes a bug where a nested button was the
    // label's implicit control.

    function renderFieldRandomBtn(field) {
        return '<button type="button" ' +
                    'class="field-random-btn" ' +
                    'data-field="' + escapeAttribute(field) + '" ' +
                    'title="Reroll this field" ' +
                    'aria-label="Reroll ' + escapeAttribute(field) +
                    '">' +
                    '\u27f3' +
                '</button>';
    }

    function renderLabelWithRandom(labelText, field, inputId, extraStyle) {
        var style = extraStyle ||
            'font-size:0.7rem;color:var(--text-dim);';
        return '<div class="form-label-row" ' +
                    'style="display:flex;align-items:center;gap:4px;">' +
                    '<label for="' + escapeAttribute(inputId) + '" ' +
                        'style="' + style + '">' +
                        escapeHtml(labelText) +
                    '</label>' +
                    renderFieldRandomBtn(field) +
                '</div>';
    }

    // ============================================================
    // STATE
    // ============================================================

    var state = { currentTab: 'name' };
    var _lastRenderedEditId = undefined;
    var _initialized = false;

    var VALID_TABS = [
        'name', 'physical', 'personality',
        'academic', 'professional', 'combat', 'social', 'notes'
    ];

    function getCurrentYear() {
        if (window.data && typeof window.data.currentYear === 'number') {
            return window.data.currentYear;
        }
        return new Date().getFullYear();
    }

    // ============================================================
    // CLASS OPTIONS
    // ============================================================

    function getClassOptionsHTML(selectedId) {
        var AcademyClasses = getAcademyClasses();
        if (!AcademyClasses ||
            typeof AcademyClasses.getClasses !== 'function') {
            return '<option value="">None</option>';
        }

        var classes = AcademyClasses.getClasses() || [];
        var html = '<option value="">None</option>';

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || typeof cls !== 'object') { continue; }
            var isSelected = String(cls.id) === String(selectedId);
            html += '<option value="' + escapeAttribute(cls.id) + '"' +
                (isSelected ? ' selected' : '') + '>' +
                escapeHtml(cls.name) +
                '</option>';
        }
        return html;
    }

    // ============================================================
    // PREVIOUS NAME ROW
    // ============================================================

    function addPreviousNameRow(container, value) {
        if (!container) { return; }

        var row = document.createElement('div');
        row.className = 'previous-name-row';
        row.style.cssText = 'display:flex;gap:6px;align-items:center;';

        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'previous-name-input';
        input.placeholder = 'Previous name...';
        input.value = value || '';
        input.style.cssText =
            'flex:1;padding:6px 8px;background:var(--bg);' +
            'border:1px solid var(--border);color:var(--text);' +
            'border-radius:4px;font-size:0.75rem;';

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-previous-name small danger';
        removeBtn.textContent = '\u2715';
        removeBtn.setAttribute('aria-label', 'Remove previous name');
        removeBtn.style.cssText = 'padding:4px 8px;font-size:0.65rem;';

        row.appendChild(input);
        row.appendChild(removeBtn);
        container.appendChild(row);
    }

    // ============================================================
    // CAREER STATUS ROW
    // ============================================================

    function addCareerEntryRow(container, entry) {
        if (!container) { return; }
        entry = entry || {};

        var row = document.createElement('div');
        row.className = 'career-status-entry';
        row.style.cssText =
            'display:grid;' +
            'grid-template-columns:1.2fr 0.7fr 0.7fr 1.2fr auto;' +
            'gap:6px;align-items:center;margin-bottom:6px;';

        var select = document.createElement('select');
        select.className = 'career-status-select';
        select.style.cssText =
            'padding:4px 6px;background:var(--bg);' +
            'border:1px solid var(--border);color:var(--text);' +
            'border-radius:4px;font-size:0.7rem;';

        var options = getCareerStatusOptions();
        var currentStatus = String(entry.status || '').toLowerCase();
        var matched = false;

        for (var i = 0; i < options.length; i++) {
            var opt = document.createElement('option');
            opt.value = options[i].value;
            opt.textContent = options[i].label;
            if (options[i].value === currentStatus) {
                opt.selected = true;
                matched = true;
            }
            select.appendChild(opt);
        }

        // Fallback option for a status not in the current list,
        // such as "instructor (former)". Preserving the value keeps
        // a round-trip through the form lossless.
        if (!matched && currentStatus !== '') {
            var fallbackOpt = document.createElement('option');
            fallbackOpt.value = String(entry.status);
            fallbackOpt.textContent = String(entry.status);
            fallbackOpt.selected = true;
            select.appendChild(fallbackOpt);
        }

        var startInput = document.createElement('input');
        startInput.type = 'number';
        startInput.className = 'career-start-year';
        startInput.placeholder = 'Start';
        startInput.value = entry.startYear !== undefined &&
            entry.startYear !== null
            ? String(entry.startYear)
            : '';
        startInput.style.cssText =
            'padding:4px 6px;background:var(--bg);' +
            'border:1px solid var(--border);color:var(--text);' +
            'border-radius:4px;font-size:0.7rem;';

        var endInput = document.createElement('input');
        endInput.type = 'number';
        endInput.className = 'career-end-year';
        endInput.placeholder = 'End';
        endInput.value = entry.endYear !== undefined &&
            entry.endYear !== null
            ? String(entry.endYear)
            : '';
        endInput.style.cssText = startInput.style.cssText;

        var titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.className = 'career-title';
        titleInput.placeholder = 'Title';
        titleInput.value = entry.title ? String(entry.title) : '';
        titleInput.style.cssText = startInput.style.cssText;

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-career-entry small danger';
        removeBtn.textContent = '\u2715';
        removeBtn.setAttribute('aria-label', 'Remove status entry');
        removeBtn.style.cssText = 'padding:4px 8px;font-size:0.65rem;';

        row.appendChild(select);
        row.appendChild(startInput);
        row.appendChild(endInput);
        row.appendChild(titleInput);
        row.appendChild(removeBtn);

        container.appendChild(row);
    }

    // ============================================================
    // WEAPON ROW
    // ============================================================

    function addWeaponRow(container, weapon) {
        if (!container) { return; }
        weapon = weapon || {};

        var row = document.createElement('div');
        row.className = 'weapon-entry';
        row.style.cssText =
            'display:grid;' +
            'grid-template-columns:1.5fr 1fr 2fr auto;' +
            'gap:6px;align-items:center;margin-bottom:6px;';
        if (weapon.id) {
            row.dataset.weaponId = weapon.id;
        }

        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'weapon-name';
        nameInput.placeholder = 'Weapon name';
        nameInput.value = weapon.name || '';
        nameInput.style.cssText =
            'padding:4px 6px;background:var(--bg);' +
            'border:1px solid var(--border);color:var(--text);' +
            'border-radius:4px;font-size:0.7rem;';

        var typeSelect = document.createElement('select');
        typeSelect.className = 'weapon-type';
        typeSelect.style.cssText = nameInput.style.cssText;

        var types = getWeaponTypes();
        var currentType = weapon.type || getDefaultWeaponType();
        var typeMatched = false;

        for (var i = 0; i < types.length; i++) {
            var opt = document.createElement('option');
            opt.value = types[i].id;
            opt.textContent = types[i].label;
            if (types[i].id === currentType) {
                opt.selected = true;
                typeMatched = true;
            }
            typeSelect.appendChild(opt);
        }

        // Fallback option for a type not in the current list.
        if (!typeMatched && currentType !== '') {
            var fallbackOpt = document.createElement('option');
            fallbackOpt.value = String(currentType);
            fallbackOpt.textContent = String(currentType);
            fallbackOpt.selected = true;
            typeSelect.appendChild(fallbackOpt);
        }

        var notesInput = document.createElement('input');
        notesInput.type = 'text';
        notesInput.className = 'weapon-notes';
        notesInput.placeholder = 'Notes';
        notesInput.value = weapon.notes || '';
        notesInput.style.cssText = nameInput.style.cssText;

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-weapon small danger';
        removeBtn.textContent = '\u2715';
        removeBtn.setAttribute('aria-label', 'Remove weapon');
        removeBtn.style.cssText = 'padding:4px 8px;font-size:0.65rem;';

        row.appendChild(nameInput);
        row.appendChild(typeSelect);
        row.appendChild(notesInput);
        row.appendChild(removeBtn);

        container.appendChild(row);
    }

    // ============================================================
    // SNAPSHOT / RESTORE (for re-render merge)
    // ============================================================
    //
    // Snapshot the current form values before a re-render so
    // unsaved edits survive. Uses FormUtils.getField for scalar
    // inputs, and direct DOM reads for the dynamically-rendered
    // blocks (career entries, weapons, previous names).

    function snapshotCurrentForm() {
        var FormUtils = getFormUtils();
        if (!FormUtils) { return null; }

        var form = document.getElementById('character-form');
        if (!form) { return null; }

        var snapshot = {
            scalars: {},
            previousNames: [],
            careerEntries: [],
            weapons: []
        };

        var scalarIds = [
            'char-firstName', 'char-middleName', 'char-lastName',
            'char-nickname', 'char-alias',
            'char-displayFirst', 'char-displayNickname',
            'char-displayMiddle', 'char-displayLast', 'char-displayAlias',
            'char-is-filler',
            'char-birthYear',
            'char-attraction',
            'char-deceased', 'char-deathYear', 'char-deathAge',
            'char-deathCause',
            'char-gender',
            'char-eyes', 'char-hair', 'char-skin',
            'char-height', 'char-weight', 'char-build',
            'char-appearanceNotes',
            'char-personality-traits', 'char-personality-ideals',
            'char-personality-bonds', 'char-personality-flaws',
            'char-personality-alignment', 'char-personality-likes',
            'char-personality-dislikes', 'char-personality-fears',
            'char-personality-habits', 'char-personality-goals',
            'char-personality-authority',
            'char-personality-conflictStyle',
            'char-personality-socialStyle',
            'char-personality-quirks',
            'char-specialty',
            'char-hp', 'char-mp',
            'char-combat-notes', 'char-notes-tab'
        ];

        var statKeys = getStatKeys();
        for (var s = 0; s < statKeys.length; s++) {
            scalarIds.push('char-stat-' + statKeys[s]);
        }

        for (var i = 0; i < scalarIds.length; i++) {
            var id = scalarIds[i];
            var el = document.getElementById(id);
            if (!el) { continue; }

            if (el.type === 'checkbox') {
                snapshot.scalars[id] = el.checked;
            } else if (el.type === 'radio') {
                snapshot.scalars[id] = el.checked;
            } else {
                snapshot.scalars[id] = el.value;
            }
        }

        var prevInputs = form.querySelectorAll('.previous-name-input');
        for (var p = 0; p < prevInputs.length; p++) {
            snapshot.previousNames.push(prevInputs[p].value);
        }

        var careerRows = form.querySelectorAll(
            '#career-status-container .career-status-entry'
        );
        for (var c = 0; c < careerRows.length; c++) {
            var crow = careerRows[c];
            var statusEl = crow.querySelector('.career-status-select');
            var startEl = crow.querySelector('.career-start-year');
            var endEl = crow.querySelector('.career-end-year');
            var titleEl = crow.querySelector('.career-title');

            snapshot.careerEntries.push({
                status: statusEl ? statusEl.value : '',
                startYear: startEl ? startEl.value : '',
                endYear: endEl ? endEl.value : '',
                title: titleEl ? titleEl.value : ''
            });
        }

        var weaponRows = form.querySelectorAll(
            '#weapons-container .weapon-entry'
        );
        for (var w = 0; w < weaponRows.length; w++) {
            var wrow = weaponRows[w];
            var nameEl = wrow.querySelector('.weapon-name');
            var typeEl = wrow.querySelector('.weapon-type');
            var notesEl = wrow.querySelector('.weapon-notes');

            snapshot.weapons.push({
                id: wrow.dataset.weaponId || undefined,
                name: nameEl ? nameEl.value : '',
                type: typeEl ? typeEl.value : '',
                notes: notesEl ? notesEl.value : ''
            });
        }

        return snapshot;
    }

    function restoreSnapshot(snapshot) {
        if (!snapshot) { return; }
        var FormUtils = getFormUtils();
        if (!FormUtils) { return; }

        // Scalars.
        var keys = Object.keys(snapshot.scalars);
        for (var i = 0; i < keys.length; i++) {
            var id = keys[i];
            var el = document.getElementById(id);
            if (!el) { continue; }

            if (el.type === 'checkbox' || el.type === 'radio') {
                el.checked = snapshot.scalars[id] === true;
            } else {
                el.value = snapshot.scalars[id];
            }
        }

        // Previous names.
        var prevContainer = document.getElementById(
            'previous-names-container'
        );
        if (prevContainer && snapshot.previousNames.length > 0) {
            prevContainer.textContent = '';
            for (var p = 0; p < snapshot.previousNames.length; p++) {
                addPreviousNameRow(
                    prevContainer, snapshot.previousNames[p]
                );
            }
        }

        // Career entries.
        var careerContainer = document.getElementById(
            'career-status-container'
        );
        if (careerContainer && snapshot.careerEntries.length > 0) {
            careerContainer.textContent = '';
            for (var c = 0; c < snapshot.careerEntries.length; c++) {
                addCareerEntryRow(
                    careerContainer, snapshot.careerEntries[c]
                );
            }
        }

        // Weapons.
        var weaponsContainer = document.getElementById(
            'weapons-container'
        );
        if (weaponsContainer && snapshot.weapons.length > 0) {
            weaponsContainer.textContent = '';
            for (var w = 0; w < snapshot.weapons.length; w++) {
                addWeaponRow(weaponsContainer, snapshot.weapons[w]);
            }
        }
    }

    // ============================================================
    // RENDER
    // ============================================================

    function render(editId) {
        if (!checkDependencies()) {
            var container = document.getElementById(
                'character-form-content'
            );
            if (container) {
                container.innerHTML =
                    '<p class="empty-state">Form dependencies ' +
                    'not loaded. Please refresh the page.</p>';
            }
            return;
        }

        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) { return; }

        var char = null;
        if (editId) {
            char = CharacterQueries.getCharacterById(editId);
            if (!char) {
                console.warn(
                    '[CharacterForm] render: character not found:',
                    editId
                );
                hide();
                return;
            }
        }

        var normalizedEditId = editId === undefined ||
            editId === null ||
            editId === ''
            ? null
            : String(editId);

        var openingNewCharacter = (
            _lastRenderedEditId !== undefined &&
            _lastRenderedEditId !== null &&
            normalizedEditId === null
        );

        // ---- Snapshot current form values if re-rendering the
        // SAME character so unsaved edits survive. ----
        var snapshot = null;
        var isSameCharacter = (
            _lastRenderedEditId !== undefined &&
            _lastRenderedEditId !== null &&
            normalizedEditId !== null &&
            _lastRenderedEditId === normalizedEditId
        );
        if (isSameCharacter) {
            snapshot = snapshotCurrentForm();
        }

        if (openingNewCharacter) {
            state.currentTab = 'name';
        }

        _lastRenderedEditId = normalizedEditId;

        var title = document.getElementById('form-title');
        if (title) {
            title.textContent = editId
                ? 'Edit Character' : 'New Character';
        }

        var nameDisplay = document.getElementById(
            'current-char-name'
        );
        if (nameDisplay) {
            if (char) {
                nameDisplay.textContent =
                    CharacterQueries.getDisplayName(char);
                nameDisplay.style.display = 'inline';
            } else {
                nameDisplay.textContent = '';
                nameDisplay.style.display = 'none';
            }
        }

        var currentYear = getCurrentYear();
        var content = document.getElementById(
            'character-form-content'
        );
        if (!content) { return; }

        var html = getCharacterFormHTML(char, editId, currentYear);
        content.innerHTML = html;

        if (char) {
            populateFormFields(char);
        } else {
            var prevContainer = document.getElementById(
                'previous-names-container'
            );
            if (prevContainer) {
                prevContainer.textContent = '';
                addPreviousNameRow(prevContainer, '');
            }
            var careerContainer = document.getElementById(
                'career-status-container'
            );
            if (careerContainer) {
                careerContainer.textContent = '';
                addCareerEntryRow(careerContainer);
            }
            var weaponsContainer = document.getElementById(
                'weapons-container'
            );
            if (weaponsContainer) {
                weaponsContainer.textContent = '';
            }
            applyDeceasedState(false);
        }

        // ---- Restore unsaved edits after populateFormFields has
        // written the stored values. ----
        //
        // After restore, re-synchronise the deceased checkbox, the
        // #death-fields display, and the per-field disabled state
        // to whatever the restored checkbox says. populateFormFields
        // wrote the *stored* state before restoreSnapshot
        // overwrote the checkbox; without this step the fields
        // could end up disabled while the checkbox is unchecked,
        // or enabled while it is checked.
        if (snapshot) {
            restoreSnapshot(snapshot);

            var FormUtilsLocal = getFormUtils();
            if (FormUtilsLocal) {
                var restoredDeceased =
                    FormUtilsLocal.getField('char-deceased') === true;
                applyDeceasedState(restoredDeceased);
                var deathFieldsEl = document.getElementById(
                    'death-fields'
                );
                if (deathFieldsEl) {
                    deathFieldsEl.style.display = restoredDeceased
                        ? 'block' : 'none';
                }
            }
        }

        // ---- Combat tab delegates ----
        var CharacterStatsView = getCharacterStatsView();
        if (CharacterStatsView) {
            if (char) {
                if (typeof CharacterStatsView.populateMagicalFields ===
                    'function') {
                    CharacterStatsView.populateMagicalFields(char);
                }
                if (typeof CharacterStatsView.updatePhysicalClassDisplay ===
                    'function') {
                    CharacterStatsView.updatePhysicalClassDisplay(char);
                }
                if (typeof CharacterStatsView.updateMagicalClassDisplay ===
                    'function') {
                    CharacterStatsView.updateMagicalClassDisplay(char);
                }
                if (typeof CharacterStatsView.renderMovesSection ===
                    'function') {
                    CharacterStatsView.renderMovesSection(char);
                }
            } else {
                if (typeof CharacterStatsView.updatePhysicalClassDisplay ===
                    'function') {
                    CharacterStatsView.updatePhysicalClassDisplay(null);
                }
                if (typeof CharacterStatsView.updateMagicalClassDisplay ===
                    'function') {
                    CharacterStatsView.updateMagicalClassDisplay(null);
                }
                if (typeof CharacterStatsView.renderMovesSection ===
                    'function') {
                    CharacterStatsView.renderMovesSection(null);
                }
            }
        }

        // ---- Academic tab delegates ----
        var CharacterClassView = getCharacterClassView();
        if (CharacterClassView &&
            typeof CharacterClassView.renderAcademicTab ===
            'function') {
            var academicContainer = document.getElementById(
                'academic-class-view'
            );
            if (academicContainer) {
                try {
                    CharacterClassView.renderAcademicTab(
                        char, academicContainer
                    );
                } catch (e) {
                    console.warn(
                        '[CharacterForm] renderAcademicTab failed:', e
                    );
                }
            }
        }

        // ---- Professional tab delegates ----
        var CharacterViews = getCharacterViews();
        if (CharacterViews &&
            typeof CharacterViews.renderCharacterProfessional ===
            'function') {
            var professionalContainer = document.getElementById(
                'professional-view'
            );
            if (professionalContainer) {
                try {
                    CharacterViews.renderCharacterProfessional(char);
                } catch (e) {
                    console.warn(
                        '[CharacterForm] ' +
                        'renderCharacterProfessional failed:', e
                    );
                }
            }
        }

        // ---- Social tab delegates ----
        if (CharacterViews &&
            typeof CharacterViews.renderCharacterSocial ===
            'function') {
            try {
                CharacterViews.renderCharacterSocial(char);
            } catch (e) {
                console.warn(
                    '[CharacterForm] renderCharacterSocial failed:', e
                );
            }
        }

        var form = document.getElementById('character-form');
        if (form) { form.style.display = 'block'; }

        _initialized = true;
    }

    function hide() {
        var form = document.getElementById('character-form');
        if (form) { form.style.display = 'none'; }

        var title = document.getElementById('form-title');
        if (title) { title.textContent = 'No Character Selected'; }

        var nameDisplay = document.getElementById(
            'current-char-name'
        );
        if (nameDisplay) {
            nameDisplay.textContent = '';
            nameDisplay.style.display = 'none';
        }

        var content = document.getElementById(
            'character-form-content'
        );
        if (content) {
            content.innerHTML =
                '<p class="empty-state">Select a character from ' +
                'the list to view and edit details.</p>';
        }

        _lastRenderedEditId = undefined;
        state.currentTab = 'name';
    }

    function applyDeceasedState(isDeceased) {
        var fields = [
            'char-deathYear', 'char-deathAge', 'char-deathCause'
        ];
        for (var i = 0; i < fields.length; i++) {
            var el = document.getElementById(fields[i]);
            if (!el) { continue; }
            el.disabled = !isDeceased;
            el.style.opacity = isDeceased ? '1' : '0.5';
            el.style.cursor = isDeceased ? 'text' : 'not-allowed';
        }
    }

    // ============================================================
    // FORM HTML
    // ============================================================

    function getCharacterFormHTML(char, editId, currentYear) {
        var tabs = getTabsHTML();

        var leftActionsHTML = '';

        leftActionsHTML +=
            '<button type="button" ' +
                'id="import-character-json-btn" ' +
                'class="secondary small" ' +
                'title="Import a full character profile from a JSON file" ' +
                'style="font-size:0.75rem;padding:6px 12px;">' +
                'Import JSON' +
            '</button>';

        if (editId) {
            leftActionsHTML +=
                '<button type="button" ' +
                    'id="export-character-json-btn" ' +
                    'class="secondary small" ' +
                    'title="Export this character\'s full profile as JSON" ' +
                    'style="font-size:0.75rem;padding:6px 12px;">' +
                    'Export JSON' +
                '</button>' +
                '<button type="button" ' +
                    'id="export-character-report-btn" ' +
                    'class="secondary small" ' +
                    'style="font-size:0.75rem;padding:6px 12px;">' +
                    'Export Report' +
                '</button>' +
                '<button type="button" ' +
                    'id="delete-char-btn" ' +
                    'class="danger small" ' +
                    'style="font-size:0.75rem;padding:6px 12px;">' +
                    'Delete' +
                '</button>';
        }

        return `
            <div class="character-form-container">
                <div class="form-tabs" role="tablist" style="display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:12px;">
                    ${tabs}
                </div>
                <div class="form-tab-content" id="form-tab-content">
                    ${getNameTabHTML(char || {}, editId)}
                    ${getPhysicalTabHTML(char || {})}
                    ${getPersonalityTabHTML(char || {})}
                    ${getAcademicTabHTML(char || {})}
                    ${getProfessionalTabHTML(char || {})}
                    ${getCombatTabHTML(char || {})}
                    ${getSocialTabHTML(char || {})}
                    ${getNotesTabHTML(char || {})}
                </div>
                <div class="form-actions" style="display:flex;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);align-items:center;flex-wrap:wrap;">
                    ${leftActionsHTML}
                    <div style="flex:1;"></div>
                    <button type="button" id="cancel-character-form" class="secondary" style="font-size:0.75rem;padding:6px 12px;">Cancel</button>
                    <button type="submit" id="save-character-btn" class="primary" style="font-size:0.75rem;padding:6px 12px;">${editId ? 'Update' : 'Create'} Character</button>
                </div>
            </div>
        `;
    }

    function getTabsHTML() {
        var tabNames = {
            'name': 'Name',
            'physical': 'Physical',
            'personality': 'Personality',
            'academic': 'Academic',
            'professional': 'Professional',
            'combat': 'Combat',
            'social': 'Social',
            'notes': 'Notes'
        };

        var html = '';
        for (var i = 0; i < VALID_TABS.length; i++) {
            var tab = VALID_TABS[i];
            var isActive = tab === state.currentTab;
            html += '<button type="button" ' +
                'class="form-tab-btn' +
                (isActive ? ' active' : '') + '" ' +
                'data-tab="' + escapeAttribute(tab) + '" ' +
                'role="tab" ' +
                'aria-selected="' + (isActive ? 'true' : 'false') + '" ' +
                'tabindex="' + (isActive ? '0' : '-1') + '" ' +
                'style="background:transparent;border:none;' +
                'border-bottom:2px solid ' +
                (isActive ? 'var(--accent)' : 'transparent') + ';' +
                'color:' +
                (isActive ? 'var(--accent)' : 'var(--text-dim)') +
                ';padding:4px 10px;cursor:pointer;' +
                'font-size:0.7rem;transition:0.2s;">' +
                tabNames[tab] +
                '</button>';
        }
        return html;
    }

    // ============================================================
    // NAME TAB
    // ============================================================
    //
    // NOTE: gender is NOT rendered here. It lives on the Physical
    // tab. See the GENDER FIELD note in the header. A second
    // char-gender input here would shadow the Physical-tab one via
    // getElementById and make Physical-tab edits invisible on save.

    function getNameTabHTML(c, editId) {
        var active = state.currentTab === 'name' ? 'block' : 'none';

        var dp = c.displayParts || {};
        var dpFirst    = dp.first    !== false;
        var dpMiddle   = dp.middle   !== false;
        var dpLast     = dp.last     !== false;
        var dpNickname = dp.nickname === true;
        var dpAlias    = dp.alias    === true;

        // Death fields are enabled when the character has a death
        // year on record, not based on the cached deceased boolean.
        // A future death year must stay editable.
        var deathYear = c.deathYear || '';
        var deathAge = c.deathAge || '';
        var deathCause = c.deathCause || '';
        var hasDeathYear = String(deathYear).trim() !== '';
        var isDeceased = hasDeathYear;

        var deathFieldDisabled = isDeceased ? '' : 'disabled';
        var deathFieldOpacity = isDeceased ? '1' : '0.5';
        var deathFieldCursor = isDeceased ? 'text' : 'not-allowed';

        var currentYear = getCurrentYear();
        var computedAge = '';
        if (c.birthYear) {
            var by = parseInt(c.birthYear, 10);
            if (!isNaN(by)) {
                computedAge = String(currentYear - by);
            }
        }

        var charIdValue = c.id ? String(c.id) : '';
        var charIdPlaceholder = c.id ? '' : 'Assigned on save';
        var charIdDisabled = c.id ? '' : 'disabled';

        var isFiller = c.isFiller === true;
        var isFillerChecked = isFiller ? ' checked' : '';

        return `
            <div class="tab-panel" data-tab="name" style="display:${active};">

                <div class="form-group" style="margin-bottom:8px;">
                    <label for="char-id" style="font-size:0.7rem;color:var(--text-dim);">Character ID</label>
                    <input type="text"
                           id="char-id"
                           class="char-id-input"
                           value="${escapeAttribute(charIdValue)}"
                           placeholder="${escapeAttribute(charIdPlaceholder)}"
                           readonly
                           ${charIdDisabled}
                           style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text-dim);border-radius:4px;font-size:0.7rem;font-family:monospace;cursor:${c.id ? 'text' : 'not-allowed'};opacity:${c.id ? '1' : '0.5'};">
                </div>

                <div class="form-group filler-flag-group" style="margin-bottom:12px;">
                    <label for="char-is-filler"
                           style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.75rem;color:var(--text);">
                        <input type="checkbox"
                               id="char-is-filler"
                               ${isFillerChecked}
                               style="accent-color:var(--accent);">
                        <span>Filler character</span>
                    </label>
                    <p class="field-hint filler-flag-hint"
                       style="font-size:0.65rem;color:var(--text-dim);margin-top:2px;margin-left:20px;">
                        Strip empty fields on save. Keeps name, career,
                        class, teams, eliminations, and parent links.
                        Unchecking does not restore stripped fields.
                    </p>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        <label for="char-firstName" style="font-size:0.7rem;color:var(--text-dim);">First Name *</label>
                        <input type="text" id="char-firstName" value="${escapeAttribute(c.firstName || '')}" placeholder="First name" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        <label for="char-middleName" style="font-size:0.7rem;color:var(--text-dim);">Middle Name</label>
                        <input type="text" id="char-middleName" value="${escapeAttribute(c.middleName || '')}" placeholder="Middle name" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        <label for="char-lastName" style="font-size:0.7rem;color:var(--text-dim);">Last Name *</label>
                        <input type="text" id="char-lastName" value="${escapeAttribute(c.lastName || '')}" placeholder="Last name" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        <label for="char-nickname" style="font-size:0.7rem;color:var(--text-dim);">Nickname</label>
                        <input type="text" id="char-nickname" value="${escapeAttribute(c.nickname || '')}" placeholder="Nickname" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <div class="form-group">
                    <label for="char-alias" style="font-size:0.7rem;color:var(--text-dim);">Alias</label>
                    <input type="text" id="char-alias" value="${escapeAttribute(c.alias || '')}" placeholder="Alias" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                </div>

                <div class="form-group" style="margin-top:8px;">
                    <label style="font-size:0.7rem;color:var(--text-dim);display:block;margin-bottom:4px;">Previous Names</label>
                    <div id="previous-names-container" style="display:flex;flex-direction:column;gap:4px;"></div>
                    <button type="button" id="add-previous-name-btn" class="small secondary" style="margin-top:6px;font-size:0.65rem;padding:3px 10px;">+ Add Previous Name</button>
                </div>

                <div class="form-group" style="margin-top:12px;">
                    <label style="font-size:0.7rem;color:var(--text-dim);display:block;margin-bottom:6px;">Display in List</label>
                    <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;font-size:0.7rem;">
                        <label for="char-displayFirst" style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                            <input type="checkbox" id="char-displayFirst" ${dpFirst ? 'checked' : ''} style="accent-color:var(--accent);">
                            First
                        </label>
                        <label for="char-displayNickname" style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                            <input type="checkbox" id="char-displayNickname" ${dpNickname ? 'checked' : ''} style="accent-color:var(--accent);">
                            Nickname
                        </label>
                        <label for="char-displayMiddle" style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                            <input type="checkbox" id="char-displayMiddle" ${dpMiddle ? 'checked' : ''} style="accent-color:var(--accent);">
                            Middle
                        </label>
                        <label for="char-displayLast" style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                            <input type="checkbox" id="char-displayLast" ${dpLast ? 'checked' : ''} style="accent-color:var(--accent);">
                            Last
                        </label>
                        <label for="char-displayAlias" style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                            <input type="checkbox" id="char-displayAlias" ${dpAlias ? 'checked' : ''} style="accent-color:var(--accent);">
                            Alias
                        </label>
                    </div>
                    <div style="font-size:0.6rem;color:var(--text-dim);margin-top:6px;">Display order: First Nickname Middle Last (Alias)</div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;">
                    <div class="form-group">
                        <label for="char-birthYear" style="font-size:0.7rem;color:var(--text-dim);">Birth Year</label>
                        <input type="number" id="char-birthYear" value="${escapeAttribute(c.birthYear || '')}" placeholder="e.g., 1900" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        <label for="char-age" style="font-size:0.7rem;color:var(--text-dim);">Age</label>
                        <input type="text" id="char-age" value="${escapeAttribute(computedAge)}" readonly style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text-dim);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        <label for="char-attraction" style="font-size:0.7rem;color:var(--text-dim);">Attraction</label>
                        <input type="text" id="char-attraction" value="${escapeAttribute(c.attraction || '')}" placeholder="e.g., Men, Women, All, None" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <div class="form-group" style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border-soft);">
                    <label style="font-size:0.75rem;color:var(--danger);font-weight:600;display:block;margin-bottom:6px;">Life Events</label>

                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
                        <input type="checkbox" id="char-deceased" ${isDeceased ? 'checked' : ''} style="accent-color:var(--danger);">
                        <label for="char-deceased" style="font-size:0.7rem;color:var(--text);cursor:pointer;">This character is deceased</label>
                    </div>

                    <div id="death-fields" style="display:${isDeceased ? 'block' : 'none'};padding-left:20px;border-left:2px solid var(--danger);">
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                            <div class="form-group">
                                <label for="char-deathYear" style="font-size:0.7rem;color:var(--text-dim);">Year of Death</label>
                                <input type="number" id="char-deathYear" value="${escapeAttribute(deathYear)}" placeholder="e.g., 1920" ${deathFieldDisabled} style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;opacity:${deathFieldOpacity};cursor:${deathFieldCursor};">
                            </div>
                            <div class="form-group">
                                <label for="char-deathAge" style="font-size:0.7rem;color:var(--text-dim);">Age at Death</label>
                                <input type="number" id="char-deathAge" value="${escapeAttribute(deathAge)}" placeholder="Auto-filled from birth year" ${deathFieldDisabled} style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;opacity:${deathFieldOpacity};cursor:${deathFieldCursor};">
                            </div>
                        </div>

                        <div class="form-group">
                            <label for="char-deathCause" style="font-size:0.7rem;color:var(--text-dim);">Cause of Death</label>
                            <input type="text" id="char-deathCause" value="${escapeAttribute(deathCause)}" placeholder="e.g., Fell in battle" ${deathFieldDisabled} style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;opacity:${deathFieldOpacity};cursor:${deathFieldCursor};">
                        </div>

                        <div style="font-size:0.6rem;color:var(--text-dim);margin-top:4px;">
                            The character will appear as alive in any year before their year of death, and deceased from that year onward.
                        </div>
                    </div>
                </div>

                <div style="font-size:0.6rem;color:var(--text-dim);margin-top:8px;">* Required fields</div>
            </div>
        `;
    }

    // ============================================================
    // PHYSICAL TAB
    // ============================================================

    function getPhysicalTabHTML(c) {
        var active = state.currentTab === 'physical' ? 'block' : 'none';

        return `
            <div class="tab-panel" data-tab="physical" style="display:${active};">
                <div style="display:flex;justify-content:flex-end;margin-bottom:6px;">
                    <button type="button" id="random-physical-btn" class="small secondary" style="font-size:0.65rem;padding:3px 10px;">\u27f3 Random</button>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        ${renderLabelWithRandom('Gender', 'gender', 'char-gender')}
                        <input type="text" id="char-gender" value="${escapeAttribute(c.gender || '')}" placeholder="Gender" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        ${renderLabelWithRandom('Eyes', 'eyes', 'char-eyes')}
                        <input type="text" id="char-eyes" value="${escapeAttribute(c.eyes || '')}" placeholder="Eye color" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        ${renderLabelWithRandom('Hair', 'hair', 'char-hair')}
                        <input type="text" id="char-hair" value="${escapeAttribute(c.hair || '')}" placeholder="Hair color/style" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        ${renderLabelWithRandom('Skin', 'skin', 'char-skin')}
                        <input type="text" id="char-skin" value="${escapeAttribute(c.skin || '')}" placeholder="Skin tone" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        ${renderLabelWithRandom('Height', 'height', 'char-height')}
                        <input type="text" id="char-height" value="${escapeAttribute(c.height || '')}" placeholder="Height" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        ${renderLabelWithRandom('Weight', 'weight', 'char-weight')}
                        <input type="text" id="char-weight" value="${escapeAttribute(c.weight || '')}" placeholder="Weight" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        ${renderLabelWithRandom('Build', 'build', 'char-build')}
                        <input type="text" id="char-build" value="${escapeAttribute(c.build || '')}" placeholder="Body type" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group"></div>
                </div>

                <div class="form-group">
                    <label for="char-appearanceNotes" style="font-size:0.7rem;color:var(--text-dim);">Appearance Notes</label>
                    <textarea id="char-appearanceNotes" rows="2" placeholder="Distinguishing features, scars, tattoos..." style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;resize:vertical;">${escapeHtml(c.appearanceNotes || '')}</textarea>
                </div>
            </div>
        `;
    }

    // ============================================================
    // PERSONALITY TAB
    // ============================================================

    function getPersonalityTabHTML(c) {
        var active = state.currentTab === 'personality' ? 'block' : 'none';
        var p = c.personality || {};

        return `
            <div class="tab-panel" data-tab="personality" style="display:${active};">
                <div style="display:flex;justify-content:flex-end;margin-bottom:6px;">
                    <button type="button" id="random-personality-btn" class="small secondary" style="font-size:0.65rem;padding:3px 10px;">\u27f3 Random</button>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        ${renderLabelWithRandom('Traits', 'traits', 'char-personality-traits')}
                        <input type="text" id="char-personality-traits" value="${escapeAttribute(p.traits || '')}" placeholder="e.g., Brave, Cunning, Loyal" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        ${renderLabelWithRandom('Ideals', 'ideals', 'char-personality-ideals')}
                        <input type="text" id="char-personality-ideals" value="${escapeAttribute(p.ideals || '')}" placeholder="What they believe in" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        ${renderLabelWithRandom('Bonds', 'bonds', 'char-personality-bonds')}
                        <input type="text" id="char-personality-bonds" value="${escapeAttribute(p.bonds || '')}" placeholder="Who/what they care about" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        ${renderLabelWithRandom('Flaws', 'flaws', 'char-personality-flaws')}
                        <input type="text" id="char-personality-flaws" value="${escapeAttribute(p.flaws || '')}" placeholder="Weaknesses, vices" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        ${renderLabelWithRandom('Alignment', 'alignment', 'char-personality-alignment')}
                        <input type="text" id="char-personality-alignment" value="${escapeAttribute(p.alignment || '')}" placeholder="e.g., Lawful Good, Chaotic Neutral" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        ${renderLabelWithRandom('Likes', 'likes', 'char-personality-likes')}
                        <input type="text" id="char-personality-likes" value="${escapeAttribute(p.likes || '')}" placeholder="Things they enjoy" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        ${renderLabelWithRandom('Dislikes', 'dislikes', 'char-personality-dislikes')}
                        <input type="text" id="char-personality-dislikes" value="${escapeAttribute(p.dislikes || '')}" placeholder="Things they avoid" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        ${renderLabelWithRandom('Fears', 'fears', 'char-personality-fears')}
                        <input type="text" id="char-personality-fears" value="${escapeAttribute(p.fears || '')}" placeholder="What they're afraid of" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        ${renderLabelWithRandom('Habits', 'habits', 'char-personality-habits')}
                        <input type="text" id="char-personality-habits" value="${escapeAttribute(p.habits || '')}" placeholder="Quirks, routines" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        ${renderLabelWithRandom('Goals', 'goals', 'char-personality-goals')}
                        <input type="text" id="char-personality-goals" value="${escapeAttribute(p.goals || '')}" placeholder="What they want to achieve" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <div class="form-group" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border-soft);">
                    <label style="font-size:0.75rem;color:var(--accent);font-weight:600;display:block;margin-bottom:8px;">Social &amp; Behavioural</label>

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                        <div class="form-group">
                            ${renderLabelWithRandom('Authority', 'authority', 'char-personality-authority')}
                            <input type="text" id="char-personality-authority" value="${escapeAttribute(p.authority || '')}" placeholder="Relationship to authority" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                        </div>
                        <div class="form-group">
                            ${renderLabelWithRandom('Social', 'socialStyle', 'char-personality-socialStyle')}
                            <input type="text" id="char-personality-socialStyle" value="${escapeAttribute(p.socialStyle || '')}" placeholder="How they relate to others" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                        </div>
                    </div>

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                        <div class="form-group">
                            ${renderLabelWithRandom('Conflict', 'conflictStyle', 'char-personality-conflictStyle')}
                            <input type="text" id="char-personality-conflictStyle" value="${escapeAttribute(p.conflictStyle || '')}" placeholder="How they handle conflict" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                        </div>
                        <div class="form-group">
                            ${renderLabelWithRandom('Quirks', 'quirks', 'char-personality-quirks')}
                            <input type="text" id="char-personality-quirks" value="${escapeAttribute(p.quirks || '')}" placeholder="A behavioural oddity" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // ACADEMIC TAB
    // ============================================================

    function getAcademicTabHTML(c) {
        var active = state.currentTab === 'academic' ? 'block' : 'none';

        return `
            <div class="tab-panel" data-tab="academic" style="display:${active};">
                <div id="academic-class-view"></div>
            </div>
        `;
    }

    // ============================================================
    // PROFESSIONAL TAB
    // ============================================================

    function getProfessionalTabHTML(c) {
        var active = state.currentTab === 'professional' ? 'block' : 'none';

        return `
            <div class="tab-panel" data-tab="professional" style="display:${active};">

                <div class="form-group">
                    <label for="char-specialty" style="font-size:0.7rem;color:var(--text-dim);">Specialty</label>
                    <input type="text" id="char-specialty" value="${escapeAttribute(c.specialty || '')}" placeholder="e.g., herbalist, alchemist, smith" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                </div>

                <div class="form-group" style="margin-top:12px;">
                    <label style="font-size:0.7rem;color:var(--text-dim);display:block;margin-bottom:4px;">Career Status History</label>
                    <div style="font-size:0.6rem;color:var(--text-dim);margin-bottom:6px;">Entries are sorted chronologically by start year.</div>
                    <div id="career-status-container" style="display:flex;flex-direction:column;gap:2px;"></div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center;">
                        <button type="button" id="add-career-entry-btn" class="small secondary" style="font-size:0.65rem;padding:3px 10px;">+ Add Status Entry</button>
                        <button type="button" id="career-wizard-btn" class="small secondary" style="font-size:0.65rem;padding:3px 10px;" title="Auto-fill career status from a start year and a route">\u2302 Career Wizard</button>
                        <button type="button" id="career-transition-btn" class="small secondary" style="font-size:0.65rem;padding:3px 10px;" title="Mark the character Retired, Support, or Instructor and end their open professional stints">\u23f9 Career Transition</button>
                    </div>
                </div>

                <div id="professional-view" style="margin-top:12px;"></div>
            </div>
        `;
    }

    // ============================================================
    // COMBAT TAB
    // ============================================================

    function getCombatTabHTML(c) {
        var active = state.currentTab === 'combat' ? 'block' : 'none';

        var CharacterStatsView = getCharacterStatsView();
        var magicalHTML = '';
        var movesHTML = '';

        if (CharacterStatsView) {
            if (typeof CharacterStatsView.getMagicalSectionHTML ===
                'function') {
                magicalHTML =
                    CharacterStatsView.getMagicalSectionHTML(c);
            }
            if (typeof CharacterStatsView.getMovesSectionHTML ===
                'function') {
                movesHTML = CharacterStatsView.getMovesSectionHTML(c);
            }
        }

        return `
            <div class="tab-panel" data-tab="combat" style="display:${active};">
                ${getPhysicalSectionHTML(c)}
                ${magicalHTML}
                ${movesHTML}
                ${getWeaponsSectionHTML(c)}

                <div class="form-group" style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border-soft);">
                    <label for="char-combat-notes" style="font-size:0.75rem;color:var(--accent);font-weight:600;display:block;margin-bottom:6px;">Combat Notes</label>
                    <textarea id="char-combat-notes" rows="4" placeholder="Combat-specific notes, tactics, observations..." style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;resize:vertical;">${escapeHtml(c.combatNotes || '')}</textarea>
                </div>
            </div>
        `;
    }

    function getPhysicalSectionHTML(c) {
        var stats = c.stats || {};
        var statKeys = getStatKeys();
        var statDefinitions = getStatDefinitions();
        var statMin = getStatMin();
        var statMax = getStatMax();
        var statDefault = getStatDefault();

        var statInputs = '';
        for (var si = 0; si < statKeys.length; si++) {
            var key = statKeys[si];
            var definition = statDefinitions[key] || {};
            var abbreviation = definition.abbreviation ||
                key.toUpperCase();
            var value = stats[key] !== undefined
                ? stats[key]
                : statDefault;

            var modifier = Math.floor((value - 10) / 2);
            var modifierDisplay =
                (modifier >= 0 ? '+' : '') + modifier;
            var modColor = modifier > 0
                ? 'var(--accent)'
                : (modifier < 0
                    ? 'var(--danger)'
                    : 'var(--text-dim)');

            statInputs +=
                '<div class="stat-block" style="display:flex;' +
                    'flex-direction:column;gap:2px;align-items:center;' +
                    'padding:6px;background:var(--panel-alt);' +
                    'border:1px solid var(--border);border-radius:6px;">' +
                    '<label for="char-stat-' + escapeAttribute(key) + '" ' +
                        'style="font-size:0.6rem;color:var(--text-dim);' +
                        'font-weight:600;">' +
                        escapeHtml(abbreviation) +
                    '</label>' +
                    '<input type="number" id="char-stat-' +
                        escapeAttribute(key) + '" ' +
                        'value="' + escapeAttribute(String(value)) + '" ' +
                        'min="' + escapeAttribute(String(statMin)) + '" ' +
                        'max="' + escapeAttribute(String(statMax)) + '" ' +
                        'data-stat-key="' + escapeAttribute(key) + '" ' +
                        'class="stat-input" ' +
                        'style="width:100%;padding:4px 6px;' +
                        'background:var(--bg);' +
                        'border:1px solid var(--border);' +
                        'color:var(--text);border-radius:4px;' +
                        'font-size:0.9rem;font-weight:700;' +
                        'text-align:center;">' +
                    '<span class="stat-modifier" ' +
                        'data-modifier-key="' + escapeAttribute(key) + '" ' +
                        'style="font-size:0.65rem;color:' + modColor + ';' +
                        'font-weight:600;">' +
                        escapeHtml(modifierDisplay) +
                    '</span>' +
                '</div>';
        }

        var classOptions = '<option value="">\u2014 Derived \u2014</option>';
        var physicalClasses = getPhysicalClasses();
        for (var pi = 0; pi < physicalClasses.length; pi++) {
            var cls = physicalClasses[pi];
            classOptions += '<option value="' +
                escapeAttribute(cls.id) + '">' +
                escapeHtml(cls.label) +
                '</option>';
        }

        var hpValue = c.hp || 0;
        var mpValue = c.mp || 0;

        return (
            '<div class="combat-section" ' +
                'style="margin-bottom:12px;padding:10px;' +
                'background:var(--panel);' +
                'border:1px solid var(--border);' +
                'border-radius:var(--radius);">' +
                '<div style="display:flex;justify-content:space-between;' +
                    'align-items:center;margin-bottom:8px;' +
                    'flex-wrap:wrap;gap:6px;">' +
                    '<label style="font-size:0.8rem;' +
                        'color:var(--accent);font-weight:600;">' +
                        'Physical' +
                    '</label>' +
                    '<button type="button" id="roll-stats-btn" ' +
                        'class="small secondary" ' +
                        'style="font-size:0.65rem;padding:3px 10px;">' +
                        '\u27f3 Roll Stats' +
                    '</button>' +
                '</div>' +

                '<div class="stat-grid" ' +
                    'style="display:grid;' +
                    'grid-template-columns:repeat(6,1fr);gap:6px;' +
                    'margin-bottom:10px;">' +
                    statInputs +
                '</div>' +

                '<div style="display:grid;grid-template-columns:1fr 1fr;' +
                    'gap:8px;margin-bottom:8px;">' +
                    '<div class="form-group">' +
                        '<label style="font-size:0.7rem;' +
                            'color:var(--text-dim);">' +
                            'Derived Class' +
                        '</label>' +
                        '<div id="derived-physical-class" ' +
                            'style="padding:5px 8px;background:var(--bg);' +
                            'border:1px solid var(--border);' +
                            'color:var(--accent);border-radius:4px;' +
                            'font-size:0.75rem;font-weight:600;">' +
                            '\u2014' +
                        '</div>' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label for="physical-class-override" ' +
                            'style="font-size:0.7rem;' +
                            'color:var(--text-dim);">' +
                            'Override (rewrites stats)' +
                        '</label>' +
                        '<select id="physical-class-override" ' +
                            'style="width:100%;padding:5px 8px;' +
                            'background:var(--bg);' +
                            'border:1px solid var(--border);' +
                            'color:var(--text);border-radius:4px;' +
                            'font-size:0.75rem;">' +
                            classOptions +
                        '</select>' +
                    '</div>' +
                '</div>' +

                '<div style="display:grid;grid-template-columns:1fr 1fr;' +
                    'gap:8px;">' +
                    '<div class="form-group">' +
                        '<label for="char-hp" ' +
                            'style="font-size:0.7rem;' +
                            'color:var(--text-dim);">HP</label>' +
                        '<div style="display:flex;gap:6px;">' +
                            '<input type="number" id="char-hp" ' +
                                'value="' + escapeAttribute(String(hpValue)) + '" ' +
                                'min="0" max="999" ' +
                                'style="flex:1;padding:5px 8px;' +
                                'background:var(--bg);' +
                                'border:1px solid var(--border);' +
                                'color:var(--text);border-radius:4px;' +
                                'font-size:0.8rem;">' +
                            '<button type="button" id="roll-hp-btn" ' +
                                'class="small secondary" ' +
                                'style="font-size:0.7rem;padding:4px 10px;">' +
                                '\u27f3' +
                            '</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label for="char-mp" ' +
                            'style="font-size:0.7rem;' +
                            'color:var(--text-dim);">MP</label>' +
                        '<div style="display:flex;gap:6px;">' +
                            '<input type="number" id="char-mp" ' +
                                'value="' + escapeAttribute(String(mpValue)) + '" ' +
                                'min="0" max="999" ' +
                                'style="flex:1;padding:5px 8px;' +
                                'background:var(--bg);' +
                                'border:1px solid var(--border);' +
                                'color:var(--text);border-radius:4px;' +
                                'font-size:0.8rem;">' +
                            '<button type="button" id="roll-mp-btn" ' +
                                'class="small secondary" ' +
                                'style="font-size:0.7rem;padding:4px 10px;">' +
                                '\u27f3' +
                            '</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );
    }

    function getWeaponsSectionHTML(c) {
        return (
            '<div class="combat-section" ' +
                'style="margin-bottom:12px;padding:10px;' +
                'background:var(--panel);' +
                'border:1px solid var(--border);' +
                'border-radius:var(--radius);">' +
                '<div style="display:flex;justify-content:space-between;' +
                    'align-items:center;margin-bottom:8px;' +
                    'flex-wrap:wrap;gap:6px;">' +
                    '<label style="font-size:0.8rem;' +
                        'color:var(--accent);font-weight:600;">' +
                        'Weapons' +
                    '</label>' +
                    '<button type="button" id="add-weapon-btn" ' +
                        'class="small secondary" ' +
                        'style="font-size:0.65rem;padding:3px 10px;">' +
                        '+ Add Weapon' +
                    '</button>' +
                '</div>' +
                '<div id="weapons-container" ' +
                    'style="display:flex;flex-direction:column;' +
                    'gap:2px;"></div>' +
            '</div>'
        );
    }

    // ============================================================
    // SOCIAL TAB
    // ============================================================

    function getSocialTabHTML(c) {
        var active = state.currentTab === 'social' ? 'block' : 'none';

        return `
            <div class="tab-panel" data-tab="social" style="display:${active};">

                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:6px;">
                    <label style="font-size:0.8rem;color:var(--accent);font-weight:600;">Relationships</label>
                    <div style="display:flex;gap:6px;">
                        <button type="button" id="view-char-social-graph" class="small secondary" style="font-size:0.65rem;padding:3px 10px;">\u25ca View Network</button>
                        <button type="button" id="add-char-relationship-btn" class="small primary" style="font-size:0.65rem;padding:3px 10px;">+ Add Relationship</button>
                    </div>
                </div>

                <div id="character-social-view">
                    <p class="empty-state" style="padding:8px;font-size:0.8rem;">No relationships recorded.</p>
                </div>

            </div>
        `;
    }

    // ============================================================
    // NOTES TAB
    // ============================================================

    function getNotesTabHTML(c) {
        var active = state.currentTab === 'notes' ? 'block' : 'none';

        return `
            <div class="tab-panel" data-tab="notes" style="display:${active};">
                <div class="form-group">
                    <label for="char-notes-tab" style="font-size:0.7rem;color:var(--text-dim);">Notes</label>
                    <textarea id="char-notes-tab" rows="8" placeholder="General notes about this character..." style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;resize:vertical;">${escapeHtml(c.notes || '')}</textarea>
                </div>
            </div>
        `;
    }

    // ============================================================
    // POPULATE FIELDS
    // ============================================================

    function populateFormFields(char) {
        if (!char) { return; }

        var FormUtils = getFormUtils();
        if (!FormUtils) { return; }

        FormUtils.setField('char-firstName', char.firstName);
        FormUtils.setField('char-middleName', char.middleName);
        FormUtils.setField('char-lastName', char.lastName);
        FormUtils.setField('char-nickname', char.nickname);
        FormUtils.setField('char-alias', char.alias);

        FormUtils.setField('char-is-filler', char.isFiller === true);

        var prevNamesContainer = document.getElementById(
            'previous-names-container'
        );
        if (prevNamesContainer) {
            prevNamesContainer.textContent = '';
            var prevNames = Array.isArray(char.previousNames)
                ? char.previousNames : [];
            if (prevNames.length === 0) {
                addPreviousNameRow(prevNamesContainer, '');
            } else {
                for (var pi = 0; pi < prevNames.length; pi++) {
                    addPreviousNameRow(prevNamesContainer, prevNames[pi]);
                }
            }
        }

        var dp = char.displayParts || {};
        FormUtils.setField('char-displayFirst', dp.first !== false);
        FormUtils.setField('char-displayNickname', dp.nickname === true);
        FormUtils.setField('char-displayMiddle', dp.middle !== false);
        FormUtils.setField('char-displayLast', dp.last !== false);
        FormUtils.setField('char-displayAlias', dp.alias === true);

        FormUtils.setField('char-birthYear', char.birthYear || '');
        var currentYear = getCurrentYear();
        var ageField = document.getElementById('char-age');
        if (ageField) {
            var by = parseInt(char.birthYear, 10);
            ageField.value = !isNaN(by)
                ? String(currentYear - by)
                : '';
        }

        // Gender now lives on the Physical tab only. The Name tab
        // does not render a char-gender input, so this setField
        // reaches the single Physical-tab input.
        FormUtils.setField('char-gender', char.gender);
        FormUtils.setField('char-attraction', char.attraction);

        // Deceased state derives from deathYear presence, not the
        // cached boolean, so a future death year stays editable.
        var hasDeathYear = char.deathYear !== undefined &&
            char.deathYear !== null &&
            String(char.deathYear).trim() !== '';
        FormUtils.setField('char-deceased', hasDeathYear);
        FormUtils.setField('char-deathYear', char.deathYear || '');
        FormUtils.setField('char-deathAge', char.deathAge || '');
        FormUtils.setField('char-deathCause', char.deathCause || '');

        var deathFields = document.getElementById('death-fields');
        if (deathFields) {
            deathFields.style.display = hasDeathYear ? 'block' : 'none';
        }
        applyDeceasedState(hasDeathYear);

        FormUtils.setField('char-eyes', char.eyes);
        FormUtils.setField('char-hair', char.hair);
        FormUtils.setField('char-skin', char.skin);
        FormUtils.setField('char-height', char.height);
        FormUtils.setField('char-weight', char.weight);
        FormUtils.setField('char-build', char.build);
        FormUtils.setField('char-appearanceNotes', char.appearanceNotes);

        if (char.personality) {
            FormUtils.setField(
                'char-personality-traits', char.personality.traits
            );
            FormUtils.setField(
                'char-personality-ideals', char.personality.ideals
            );
            FormUtils.setField(
                'char-personality-bonds', char.personality.bonds
            );
            FormUtils.setField(
                'char-personality-flaws', char.personality.flaws
            );
            FormUtils.setField(
                'char-personality-alignment',
                char.personality.alignment
            );
            FormUtils.setField(
                'char-personality-likes', char.personality.likes
            );
            FormUtils.setField(
                'char-personality-dislikes', char.personality.dislikes
            );
            FormUtils.setField(
                'char-personality-habits', char.personality.habits
            );
            FormUtils.setField(
                'char-personality-fears', char.personality.fears
            );
            FormUtils.setField(
                'char-personality-goals', char.personality.goals
            );
            FormUtils.setField(
                'char-personality-authority',
                char.personality.authority
            );
            FormUtils.setField(
                'char-personality-conflictStyle',
                char.personality.conflictStyle
            );
            FormUtils.setField(
                'char-personality-socialStyle',
                char.personality.socialStyle
            );
            FormUtils.setField(
                'char-personality-quirks', char.personality.quirks
            );
        }

        FormUtils.setField('char-specialty', char.specialty);

        var careerContainer = document.getElementById(
            'career-status-container'
        );
        if (careerContainer) {
            careerContainer.textContent = '';
            var careerEntries = Array.isArray(char.careerStatus)
                ? char.careerStatus : [];
            if (careerEntries.length === 0) {
                addCareerEntryRow(careerContainer);
            } else {
                for (var ci = 0; ci < careerEntries.length; ci++) {
                    addCareerEntryRow(careerContainer, careerEntries[ci]);
                }
            }
        }

        var statKeys = getStatKeys();
        var statDefault = getStatDefault();
        if (char.stats) {
            for (var si = 0; si < statKeys.length; si++) {
                var key = statKeys[si];
                var value = char.stats[key] !== undefined
                    ? char.stats[key]
                    : statDefault;
                FormUtils.setField('char-stat-' + key, value);
            }
        }

        FormUtils.setField('char-hp', char.hp || 0);
        FormUtils.setField('char-mp', char.mp || 0);

        var weaponsContainer = document.getElementById(
            'weapons-container'
        );
        if (weaponsContainer) {
            weaponsContainer.textContent = '';
            var weapons = Array.isArray(char.weapons)
                ? char.weapons : [];
            for (var wi = 0; wi < weapons.length; wi++) {
                addWeaponRow(weaponsContainer, weapons[wi]);
            }
        }

        FormUtils.setField('char-combat-notes', char.combatNotes || '');
        FormUtils.setField('char-notes-tab', char.notes || '');
    }

    // ============================================================
    // COLLECT
    // ============================================================

    function collectCareerStatus(form) {
        var rows = form.querySelectorAll(
            '#career-status-container .career-status-entry'
        );
        var entries = [];

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var statusEl = row.querySelector('.career-status-select');
            var startEl = row.querySelector('.career-start-year');
            var endEl = row.querySelector('.career-end-year');
            var titleEl = row.querySelector('.career-title');

            var status = statusEl
                ? String(statusEl.value || '').trim() : '';
            if (!status) { continue; }

            entries.push({
                status: status,
                startYear: startEl
                    ? String(startEl.value || '').trim() : '',
                endYear: endEl
                    ? String(endEl.value || '').trim() : '',
                title: titleEl
                    ? String(titleEl.value || '').trim() : ''
            });
        }

        entries.sort(function(a, b) {
            var aNum = parseInt(a.startYear, 10);
            var bNum = parseInt(b.startYear, 10);
            var aHas = !isNaN(aNum);
            var bHas = !isNaN(bNum);
            if (aHas && bHas) { return aNum - bNum; }
            if (aHas && !bHas) { return -1; }
            if (!aHas && bHas) { return 1; }
            return 0;
        });

        return entries;
    }

    function collectWeapons(form) {
        var rows = form.querySelectorAll(
            '#weapons-container .weapon-entry'
        );
        var weapons = [];

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var nameEl = row.querySelector('.weapon-name');
            var typeEl = row.querySelector('.weapon-type');
            var notesEl = row.querySelector('.weapon-notes');

            var name = nameEl
                ? String(nameEl.value || '').trim() : '';
            if (!name) { continue; }

            weapons.push({
                id: row.dataset.weaponId || undefined,
                name: name,
                type: typeEl
                    ? String(typeEl.value || '').trim()
                    : getDefaultWeaponType(),
                notes: notesEl
                    ? String(notesEl.value || '').trim() : ''
            });
        }

        return weapons;
    }

    function collect() {
        var FormUtils = getFormUtils();
        if (!FormUtils) {
            console.warn(
                '[CharacterForm] FormUtils not available for collect'
            );
            return null;
        }

        var form = document.getElementById('character-form');
        if (!form) { return null; }

        var statKeys = getStatKeys();
        var statMin = getStatMin();
        var statMax = getStatMax();
        var statDefault = getStatDefault();

        var previousNames = [];
        var prevInputs = form.querySelectorAll(
            '.previous-name-input'
        );
        for (var i = 0; i < prevInputs.length; i++) {
            var val = prevInputs[i].value.trim();
            if (val) { previousNames.push(val); }
        }

        var displayParts = {
            first:    FormUtils.getField('char-displayFirst') === true,
            nickname: FormUtils.getField('char-displayNickname') === true,
            middle:   FormUtils.getField('char-displayMiddle') === true,
            last:     FormUtils.getField('char-displayLast') === true,
            alias:    FormUtils.getField('char-displayAlias') === true
        };

        // Collect death fields whenever they have a value, regardless
        // of the checkbox state. This preserves a future death year.
        var deathYear = FormUtils.getField('char-deathYear') || '';
        var deathAge = FormUtils.getField('char-deathAge') || '';
        var deathCause = FormUtils.getField('char-deathCause') || '';

        var birthYearRaw =
            FormUtils.getField('char-birthYear') || '';

        // Auto-fill deathAge from birth and death years when the
        // user has left it blank.
        if (!deathAge && birthYearRaw && deathYear) {
            var by = parseInt(birthYearRaw, 10);
            var dy = parseInt(deathYear, 10);
            if (!isNaN(by) && !isNaN(dy) && dy >= by) {
                deathAge = String(dy - by);
            }
        }

        var dto = {
            firstName: FormUtils.getField('char-firstName') || '',
            middleName: FormUtils.getField('char-middleName') || '',
            lastName: FormUtils.getField('char-lastName') || '',
            nickname: FormUtils.getField('char-nickname') || '',
            alias: FormUtils.getField('char-alias') || '',
            previousNames: previousNames,
            displayParts: displayParts,

            isFiller: FormUtils.getField('char-is-filler') === true,

            birthYear: birthYearRaw,

            gender: FormUtils.getField('char-gender') || '',
            attraction: FormUtils.getField('char-attraction') || '',

            deceased: FormUtils.getField('char-deceased') === true,
            deathYear: deathYear,
            deathAge: deathAge,
            deathCause: deathCause,

            eyes: FormUtils.getField('char-eyes') || '',
            hair: FormUtils.getField('char-hair') || '',
            skin: FormUtils.getField('char-skin') || '',
            height: FormUtils.getField('char-height') || '',
            weight: FormUtils.getField('char-weight') || '',
            build: FormUtils.getField('char-build') || '',
            appearanceNotes:
                FormUtils.getField('char-appearanceNotes') || '',

            specialty: FormUtils.getField('char-specialty') || '',
            careerStatus: collectCareerStatus(form),

            stats: {},

            hp: parseInt(FormUtils.getField('char-hp'), 10) || 0,
            mp: parseInt(FormUtils.getField('char-mp'), 10) || 0,

            weapons: collectWeapons(form),

            combatNotes:
                FormUtils.getField('char-combat-notes') || '',

            notes: FormUtils.getField('char-notes-tab') || '',

            personality: {
                traits:
                    FormUtils.getField('char-personality-traits') || '',
                ideals:
                    FormUtils.getField('char-personality-ideals') || '',
                bonds:
                    FormUtils.getField('char-personality-bonds') || '',
                flaws:
                    FormUtils.getField('char-personality-flaws') || '',
                alignment:
                    FormUtils.getField('char-personality-alignment') || '',
                likes:
                    FormUtils.getField('char-personality-likes') || '',
                dislikes:
                    FormUtils.getField('char-personality-dislikes') || '',
                habits:
                    FormUtils.getField('char-personality-habits') || '',
                fears:
                    FormUtils.getField('char-personality-fears') || '',
                goals:
                    FormUtils.getField('char-personality-goals') || '',

                authority:
                    FormUtils.getField('char-personality-authority') || '',
                conflictStyle:
                    FormUtils.getField(
                        'char-personality-conflictStyle'
                    ) || '',
                socialStyle:
                    FormUtils.getField('char-personality-socialStyle') ||
                    '',
                quirks:
                    FormUtils.getField('char-personality-quirks') || ''
            }
        };

        for (var si = 0; si < statKeys.length; si++) {
            var key = statKeys[si];
            var value = parseInt(
                FormUtils.getField('char-stat-' + key), 10
            );
            dto.stats[key] = !isNaN(value)
                ? Math.max(statMin, Math.min(statMax, value))
                : statDefault;
        }

        var CharacterStatsView = getCharacterStatsView();
        if (CharacterStatsView &&
            typeof CharacterStatsView.collectMagicalFields ===
            'function') {
            dto.magic = CharacterStatsView.collectMagicalFields();
        }
        if (CharacterStatsView &&
            typeof CharacterStatsView.collectMovesFromDOM ===
            'function') {
            dto.specialMoves =
                CharacterStatsView.collectMovesFromDOM();
        }

        return dto;
    }

    // ============================================================
    // TAB SWITCHING - scoped to #character-form
    // ============================================================

    function switchTab(tab) {
        if (!tab || VALID_TABS.indexOf(tab) === -1) { return; }

        state.currentTab = tab;

        var form = document.getElementById('character-form');
        if (!form) { return; }

        var btns = form.querySelectorAll('.form-tab-btn');
        for (var i = 0; i < btns.length; i++) {
            var btn = btns[i];
            var isActive = btn.dataset.tab === tab;
            btn.classList.toggle('active', isActive);
            btn.setAttribute(
                'aria-selected', isActive ? 'true' : 'false'
            );
            btn.setAttribute('tabindex', isActive ? '0' : '-1');
            btn.style.color = isActive
                ? 'var(--accent)' : 'var(--text-dim)';
            btn.style.borderBottomColor = isActive
                ? 'var(--accent)' : 'transparent';
        }

        var panels = form.querySelectorAll('.tab-panel');
        for (var j = 0; j < panels.length; j++) {
            var panel = panels[j];
            var isPanelActive = panel.dataset.tab === tab;
            panel.style.display = isPanelActive ? 'block' : 'none';
        }

        if (tab === 'professional') {
            var CharacterQueries = getCharacterQueries();
            var charId = getCurrentEditId();
            if (charId && CharacterQueries) {
                var char = CharacterQueries.getCharacterById(charId);
                var CharacterViews = getCharacterViews();
                if (char &&
                    CharacterViews &&
                    typeof CharacterViews.renderCharacterProfessional ===
                    'function') {
                    var professionalContainer =
                        document.getElementById('professional-view');
                    if (professionalContainer) {
                        try {
                            CharacterViews.renderCharacterProfessional(
                                char
                            );
                        } catch (e) {
                            console.warn(
                                '[CharacterForm] ' +
                                'renderCharacterProfessional failed ' +
                                'on tab switch:', e
                            );
                        }
                    }
                }
            }
        }
    }

    // ============================================================
    // RANDOM
    // ============================================================

    function generateRandomPhysical() {
        var CharacterGenerator = getCharacterGenerator();
        if (!CharacterGenerator) { return null; }
        return CharacterGenerator.generatePhysical
            ? CharacterGenerator.generatePhysical()
            : null;
    }

    function generateRandomPersonality() {
        var CharacterGenerator = getCharacterGenerator();
        if (!CharacterGenerator) { return null; }
        return CharacterGenerator.generatePersonality
            ? CharacterGenerator.generatePersonality()
            : null;
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterForm = {
        render: render,
        hide: hide,
        collect: collect,
        switchTab: switchTab,
        getCurrentTab: function() { return state.currentTab; },
        isInitialized: function() { return _initialized; },

        generateRandomPhysical: generateRandomPhysical,
        generateRandomPersonality: generateRandomPersonality,

        addPreviousNameRow: addPreviousNameRow,
        addCareerEntryRow: addCareerEntryRow,
        addWeaponRow: addWeaponRow,
        applyDeceasedState: applyDeceasedState,

        getCharacterGenerator: getCharacterGenerator,
        getCurrentEditId: getCurrentEditId,
        setCurrentEditId: setCurrentEditId
    };

    // NOTE: window.showCharacterForm is owned by index.js (which also
    // owns getCurrentEditId / setCurrentEditId). This file no longer
    // defines it. character-events.js still has a shadowing copy at
    // the moment; that will be removed when the character-events.js
    // semantic fixes land, restoring index.js's definition as the
    // single source.

    window.hideCharacterForm = hide;

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.CharacterForm;
        var failures = [];

        var required = [
            'render', 'hide', 'collect', 'switchTab',
            'getCurrentTab', 'isInitialized'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                failures.push('missing export: ' + required[i]);
            }
        }

        if (failures.length > 0) {
            throw new Error(
                '[CharacterForm] Verification failed: ' +
                failures.join('; ')
            );
        }
    })();

})();
