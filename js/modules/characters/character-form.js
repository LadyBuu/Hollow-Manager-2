/**
 * js/modules/characters/character-form.js - Character Form
 * Handles form rendering, tab switching, and form field population
 * Path: js/modules/characters/character-form.js
 * 
 * IMPORTANT:
 *   - RENDER ONLY - no event binding (handled by CharacterEvents)
 *   - All field collection uses FormUtils.getField(id) - NOT getFormData()
 *   - Magical section rendering delegates to CharacterStatsView
 *   - Physical stats, HP, MP, weapons rendered inline
 *   - Combat Notes (char.combatNotes) is SEPARATE from Notes tab (char.notes)
 */

(function() {
    'use strict';

    if (window.__characterFormLoaded) {
        return;
    }
    window.__characterFormLoaded = true;

    // ============================================================
    // LAZY LOADING HELPERS
    // ============================================================

    function getCharacterQueries() { return window.CharacterQueries || null; }
    function getCharacterCRUD() { return window.CharacterCRUD || null; }
    function getCharacterGenerator() { return window.CharacterGenerator || null; }
    function getCharacterConstants() { return window.CharacterConstants || null; }
    function getMagicConstants() { return window.MagicConstants || null; }
    function getCharacterStats() { return window.CharacterStats || null; }
    function getCharacterStatsView() { return window.CharacterStatsView || null; }
    function getAcademyQueries() { return window.AcademyQueries || null; }
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
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!getCharacterQueries()) { missing.push('CharacterQueries'); }
        if (!getCharacterCRUD()) { missing.push('CharacterCRUD'); }
        if (!getCharacterConstants()) { missing.push('CharacterConstants'); }
        if (!getMagicConstants()) { missing.push('MagicConstants'); }
        if (!getCharacterStats()) { missing.push('CharacterStats'); }
        if (!getAcademyQueries()) { missing.push('AcademyQueries'); }
        if (!getFormUtils()) { missing.push('FormUtils'); }
        if (!getDomUtils()) { missing.push('DomUtils'); }

        if (missing.length > 0) {
            console.warn('[CharacterForm] Critical dependencies missing:', missing.join(', '));
            return false;
        }
        return true;
    }

    checkDependencies();

    // ============================================================
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        var DomUtils = getDomUtils();
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
        var DomUtils = getDomUtils();
        if (DomUtils && typeof DomUtils.escapeAttribute === 'function') {
            return DomUtils.escapeAttribute(value);
        }
        if (value === undefined || value === null) { return ''; }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // CONSTANTS
    // ============================================================

    function getStatKeys() {
        var CC = getCharacterConstants();
        return CC ? CC.STAT_KEYS || ['str', 'dex', 'con', 'int', 'wis', 'cha'] : ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    }
    function getStatDefinitions() {
        var CC = getCharacterConstants();
        return CC ? CC.STAT_DEFINITIONS || {} : {};
    }
    function getStatMin() {
        var CC = getCharacterConstants();
        return CC ? CC.STAT_MIN || 1 : 1;
    }
    function getStatMax() {
        var CC = getCharacterConstants();
        return CC ? CC.STAT_MAX || 30 : 30;
    }
    function getStatDefault() {
        var CC = getCharacterConstants();
        return CC ? CC.STAT_DEFAULT || 10 : 10;
    }
    function getPhysicalClasses() {
        var CC = getCharacterConstants();
        return CC && typeof CC.getPhysicalClasses === 'function' ? CC.getPhysicalClasses() : [];
    }
    function getWeaponTypes() {
        var CC = getCharacterConstants();
        return CC && typeof CC.getWeaponTypes === 'function' ? CC.getWeaponTypes() : [];
    }
    function getDefaultWeaponType() {
        var CC = getCharacterConstants();
        return CC && CC.DEFAULT_WEAPON_TYPE ? CC.DEFAULT_WEAPON_TYPE : 'sharp';
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
            { value: 'support', label: 'Support' }
        ];
    }

    // ============================================================
    // STATE
    // ============================================================

    var state = { currentTab: 'name' };
    var VALID_TABS = ['name', 'physical', 'personality', 'academic', 'professional', 'combat', 'social', 'notes'];
    var _initialized = false;

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
        var AcademyQueries = getAcademyQueries();
        if (!AcademyQueries) { return '<option value="">None</option>'; }

        var classes = AcademyQueries.getClasses() || [];
        var html = '<option value="">None</option>';

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || typeof cls !== 'object') { continue; }
            var isSelected = String(cls.id) === String(selectedId);
            html += '<option value="' + escapeHtml(cls.id) + '" ' + (isSelected ? 'selected' : '') + '>' + escapeHtml(cls.name) + '</option>';
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
        input.style.cssText = 'flex:1;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;';

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-previous-name small danger';
        removeBtn.textContent = '✕';
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
        row.style.cssText = 'display:grid;grid-template-columns:1.2fr 0.7fr 0.7fr 1.2fr auto;gap:6px;align-items:center;margin-bottom:6px;';

        var select = document.createElement('select');
        select.className = 'career-status-select';
        select.style.cssText = 'padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;';

        var options = getCareerStatusOptions();
        var currentStatus = String(entry.status || '').toLowerCase();
        for (var i = 0; i < options.length; i++) {
            var opt = document.createElement('option');
            opt.value = options[i].value;
            opt.textContent = options[i].label;
            if (options[i].value === currentStatus) {
                opt.selected = true;
            }
            select.appendChild(opt);
        }

        var startInput = document.createElement('input');
        startInput.type = 'number';
        startInput.className = 'career-start-year';
        startInput.placeholder = 'Start';
        startInput.value = entry.startYear !== undefined && entry.startYear !== null ? String(entry.startYear) : '';
        startInput.style.cssText = 'padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;';

        var endInput = document.createElement('input');
        endInput.type = 'number';
        endInput.className = 'career-end-year';
        endInput.placeholder = 'End';
        endInput.value = entry.endYear !== undefined && entry.endYear !== null ? String(entry.endYear) : '';
        endInput.style.cssText = 'padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;';

        var titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.className = 'career-title';
        titleInput.placeholder = 'Title';
        titleInput.value = entry.title ? String(entry.title) : '';
        titleInput.style.cssText = 'padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;';

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-career-entry small danger';
        removeBtn.textContent = '✕';
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
        row.style.cssText = 'display:grid;grid-template-columns:1.5fr 1fr 2fr auto;gap:6px;align-items:center;margin-bottom:6px;';
        if (weapon.id) {
            row.dataset.weaponId = weapon.id;
        }

        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'weapon-name';
        nameInput.placeholder = 'Weapon name';
        nameInput.value = weapon.name || '';
        nameInput.style.cssText = 'padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;';

        var typeSelect = document.createElement('select');
        typeSelect.className = 'weapon-type';
        typeSelect.style.cssText = 'padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;';

        var types = getWeaponTypes();
        var currentType = weapon.type || getDefaultWeaponType();
        for (var i = 0; i < types.length; i++) {
            var opt = document.createElement('option');
            opt.value = types[i].id;
            opt.textContent = types[i].label;
            if (types[i].id === currentType) { opt.selected = true; }
            typeSelect.appendChild(opt);
        }

        var notesInput = document.createElement('input');
        notesInput.type = 'text';
        notesInput.className = 'weapon-notes';
        notesInput.placeholder = 'Notes';
        notesInput.value = weapon.notes || '';
        notesInput.style.cssText = 'padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.7rem;';

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-weapon small danger';
        removeBtn.textContent = '✕';
        removeBtn.setAttribute('aria-label', 'Remove weapon');
        removeBtn.style.cssText = 'padding:4px 8px;font-size:0.65rem;';

        row.appendChild(nameInput);
        row.appendChild(typeSelect);
        row.appendChild(notesInput);
        row.appendChild(removeBtn);

        container.appendChild(row);
    }

    // ============================================================
    // RENDER
    // ============================================================

    function render(editId) {
        if (!checkDependencies()) {
            var container = document.getElementById('character-form-content');
            if (container) {
                container.innerHTML = '<p class="empty-state">Form dependencies not loaded. Please refresh the page.</p>';
            }
            return;
        }

        var CharacterQueries = getCharacterQueries();
        if (!CharacterQueries) { return; }

        var char = null;
        if (editId) {
            char = CharacterQueries.getCharacterById(editId);
            if (!char) { return; }
        }

        var title = document.getElementById('form-title');
        if (title) {
            title.textContent = editId ? 'Edit Character' : 'New Character';
        }

        var nameDisplay = document.getElementById('current-char-name');
        if (nameDisplay) {
            if (char) {
                nameDisplay.textContent = CharacterQueries.getDisplayName(char);
                nameDisplay.style.display = 'inline';
            } else {
                nameDisplay.textContent = '';
                nameDisplay.style.display = 'none';
            }
        }

        var currentYear = getCurrentYear();
        var content = document.getElementById('character-form-content');
        if (!content) { return; }

        var html = getCharacterFormHTML(char, editId, currentYear);
        content.innerHTML = html;

        if (char) {
            populateFormFields(char);
        } else {
            var prevContainer = document.getElementById('previous-names-container');
            if (prevContainer) {
                prevContainer.textContent = '';
                addPreviousNameRow(prevContainer, '');
            }
            var careerContainer = document.getElementById('career-status-container');
            if (careerContainer) {
                careerContainer.textContent = '';
                addCareerEntryRow(careerContainer);
            }
            var weaponsContainer = document.getElementById('weapons-container');
            if (weaponsContainer) {
                weaponsContainer.textContent = '';
            }
            applyDeceasedState(false);
        }

        var CharacterStatsView = getCharacterStatsView();
        if (CharacterStatsView) {
            if (char) {
                if (typeof CharacterStatsView.populateMagicalFields === 'function') {
                    CharacterStatsView.populateMagicalFields(char);
                }
                if (typeof CharacterStatsView.updatePhysicalClassDisplay === 'function') {
                    CharacterStatsView.updatePhysicalClassDisplay(char);
                }
                if (typeof CharacterStatsView.updateMagicalClassDisplay === 'function') {
                    CharacterStatsView.updateMagicalClassDisplay(char);
                }
                if (typeof CharacterStatsView.renderMovesSection === 'function') {
                    CharacterStatsView.renderMovesSection(char);
                }
            } else {
                if (typeof CharacterStatsView.updatePhysicalClassDisplay === 'function') {
                    CharacterStatsView.updatePhysicalClassDisplay(null);
                }
                if (typeof CharacterStatsView.updateMagicalClassDisplay === 'function') {
                    CharacterStatsView.updateMagicalClassDisplay(null);
                }
                if (typeof CharacterStatsView.renderMovesSection === 'function') {
                    CharacterStatsView.renderMovesSection(null);
                }
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
        var nameDisplay = document.getElementById('current-char-name');
        if (nameDisplay) {
            nameDisplay.textContent = '';
            nameDisplay.style.display = 'none';
        }
        var content = document.getElementById('character-form-content');
        if (content) {
            content.innerHTML = '<p class="empty-state">Select a character from the list to view and edit details.</p>';
        }
    }

    function applyDeceasedState(isDeceased) {
        var fields = ['char-deathYear', 'char-deathAge', 'char-deathCause'];
        fields.forEach(function(id) {
            var el = document.getElementById(id);
            if (!el) { return; }
            el.disabled = !isDeceased;
            el.style.opacity = isDeceased ? '1' : '0.5';
            el.style.cursor = isDeceased ? 'text' : 'not-allowed';
        });
    }

    // ============================================================
    // FORM HTML
    // ============================================================

    function getCharacterFormHTML(char, editId, currentYear) {
        var tabs = getTabsHTML();

        return `
            <div class="character-form-container">
                <div class="form-tabs" style="display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:12px;">
                    ${tabs}
                </div>
                <div class="form-tab-content" id="form-tab-content">
                    ${getNameTabHTML(char || {})}
                    ${getPhysicalTabHTML(char || {})}
                    ${getPersonalityTabHTML(char || {})}
                    ${getAcademicTabHTML(char || {})}
                    ${getProfessionalTabHTML(char || {})}
                    ${getCombatTabHTML(char || {})}
                    ${getSocialTabHTML(char || {})}
                    ${getNotesTabHTML(char || {})}
                </div>
                <div class="form-actions" style="display:flex;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
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
            html += '<button class="form-tab-btn ' + (isActive ? 'active' : '') + '" data-tab="' + tab + '" style="background:transparent;border:none;border-bottom:2px solid ' + (isActive ? 'var(--accent)' : 'transparent') + ';color:' + (isActive ? 'var(--accent)' : 'var(--text-dim)') + ';padding:4px 10px;cursor:pointer;font-size:0.7rem;transition:0.2s;">' + tabNames[tab] + '</button>';
        }
        return html;
    }

    // ============================================================
    // NAME TAB
    // ============================================================

    function getNameTabHTML(c) {
        var active = state.currentTab === 'name' ? 'block' : 'none';

        var dp = c.displayParts || {};
        var dpFirst    = dp.first    !== false;
        var dpMiddle   = dp.middle   !== false;
        var dpLast     = dp.last     !== false;
        var dpNickname = dp.nickname === true;
        var dpAlias    = dp.alias    === true;

        var isDeceased = c.deceased === true;
        var deathYear = c.deathYear || '';
        var deathAge = c.deathAge || '';
        var deathCause = c.deathCause || '';

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

        return `
            <div class="tab-panel" data-tab="name" style="display:${active};">

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">First Name *</label>
                        <input type="text" id="char-firstName" value="${escapeHtml(c.firstName || '')}" placeholder="First name" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Middle Name</label>
                        <input type="text" id="char-middleName" value="${escapeHtml(c.middleName || '')}" placeholder="Middle name" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Last Name *</label>
                        <input type="text" id="char-lastName" value="${escapeHtml(c.lastName || '')}" placeholder="Last name" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Nickname</label>
                        <input type="text" id="char-nickname" value="${escapeHtml(c.nickname || '')}" placeholder="Nickname" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <div class="form-group">
                    <label style="font-size:0.7rem;color:var(--text-dim);">Alias</label>
                    <input type="text" id="char-alias" value="${escapeHtml(c.alias || '')}" placeholder="Alias" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                </div>

                <div class="form-group" style="margin-top:8px;">
                    <label style="font-size:0.7rem;color:var(--text-dim);display:block;margin-bottom:4px;">Previous Names</label>
                    <div id="previous-names-container" style="display:flex;flex-direction:column;gap:4px;"></div>
                    <button type="button" id="add-previous-name-btn" class="small secondary" style="margin-top:6px;font-size:0.65rem;padding:3px 10px;">+ Add Previous Name</button>
                </div>

                <div class="form-group" style="margin-top:12px;">
                    <label style="font-size:0.7rem;color:var(--text-dim);display:block;margin-bottom:6px;">Display in List</label>
                    <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;font-size:0.7rem;">
                        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                            <input type="checkbox" id="char-displayFirst" ${dpFirst ? 'checked' : ''} style="accent-color:var(--accent);">
                            First
                        </label>
                        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                            <input type="checkbox" id="char-displayNickname" ${dpNickname ? 'checked' : ''} style="accent-color:var(--accent);">
                            Nickname
                        </label>
                        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                            <input type="checkbox" id="char-displayMiddle" ${dpMiddle ? 'checked' : ''} style="accent-color:var(--accent);">
                            Middle
                        </label>
                        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                            <input type="checkbox" id="char-displayLast" ${dpLast ? 'checked' : ''} style="accent-color:var(--accent);">
                            Last
                        </label>
                        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                            <input type="checkbox" id="char-displayAlias" ${dpAlias ? 'checked' : ''} style="accent-color:var(--accent);">
                            Alias
                        </label>
                    </div>
                    <div style="font-size:0.6rem;color:var(--text-dim);margin-top:6px;">Display order: First Nickname Middle Last (Alias)</div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;">
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Birth Year</label>
                        <input type="number" id="char-birthYear" value="${escapeHtml(c.birthYear || '')}" placeholder="e.g., 1900" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Age</label>
                        <input type="text" id="char-age" value="${escapeHtml(computedAge)}" readonly style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text-dim);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Gender</label>
                        <input type="text" id="char-gender" value="${escapeHtml(c.gender || '')}" placeholder="Gender" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Attraction</label>
                        <input type="text" id="char-attraction" value="${escapeHtml(c.attraction || '')}" placeholder="e.g., Men, Women, All, None" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
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
                                <label style="font-size:0.7rem;color:var(--text-dim);">Year of Death</label>
                                <input type="number" id="char-deathYear" value="${escapeHtml(deathYear)}" placeholder="e.g., 1920" ${deathFieldDisabled} style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;opacity:${deathFieldOpacity};cursor:${deathFieldCursor};">
                            </div>
                            <div class="form-group">
                                <label style="font-size:0.7rem;color:var(--text-dim);">Age at Death</label>
                                <input type="number" id="char-deathAge" value="${escapeHtml(deathAge)}" placeholder="Auto-filled from birth year" ${deathFieldDisabled} style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;opacity:${deathFieldOpacity};cursor:${deathFieldCursor};">
                            </div>
                        </div>

                        <div class="form-group">
                            <label style="font-size:0.7rem;color:var(--text-dim);">Cause of Death</label>
                            <input type="text" id="char-deathCause" value="${escapeHtml(deathCause)}" placeholder="e.g., Fell in battle" ${deathFieldDisabled} style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;opacity:${deathFieldOpacity};cursor:${deathFieldCursor};">
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
                    <button type="button" id="random-physical-btn" class="small secondary" style="font-size:0.65rem;padding:3px 10px;">⟳ Random</button>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Eyes</label>
                        <input type="text" id="char-eyes" value="${escapeHtml(c.eyes || '')}" placeholder="Eye color" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Hair</label>
                        <input type="text" id="char-hair" value="${escapeHtml(c.hair || '')}" placeholder="Hair color/style" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Skin</label>
                        <input type="text" id="char-skin" value="${escapeHtml(c.skin || '')}" placeholder="Skin tone" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Height</label>
                        <input type="text" id="char-height" value="${escapeHtml(c.height || '')}" placeholder="Height" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Weight</label>
                        <input type="text" id="char-weight" value="${escapeHtml(c.weight || '')}" placeholder="Weight" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Build</label>
                        <input type="text" id="char-build" value="${escapeHtml(c.build || '')}" placeholder="Body type" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <div class="form-group">
                    <label style="font-size:0.7rem;color:var(--text-dim);">Appearance Notes</label>
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
                    <button type="button" id="random-personality-btn" class="small secondary" style="font-size:0.65rem;padding:3px 10px;">⟳ Random</button>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Traits</label>
                        <input type="text" id="char-personality-traits" value="${escapeHtml(p.traits || '')}" placeholder="e.g., Brave, Cunning, Loyal" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Ideals</label>
                        <input type="text" id="char-personality-ideals" value="${escapeHtml(p.ideals || '')}" placeholder="What they believe in" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Bonds</label>
                        <input type="text" id="char-personality-bonds" value="${escapeHtml(p.bonds || '')}" placeholder="Who/what they care about" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Flaws</label>
                        <input type="text" id="char-personality-flaws" value="${escapeHtml(p.flaws || '')}" placeholder="Weaknesses, vices" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Alignment</label>
                        <input type="text" id="char-personality-alignment" value="${escapeHtml(p.alignment || '')}" placeholder="e.g., Lawful Good, Chaotic Neutral" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Likes</label>
                        <input type="text" id="char-personality-likes" value="${escapeHtml(p.likes || '')}" placeholder="Things they enjoy" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Dislikes</label>
                        <input type="text" id="char-personality-dislikes" value="${escapeHtml(p.dislikes || '')}" placeholder="Things they avoid" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Fears</label>
                        <input type="text" id="char-personality-fears" value="${escapeHtml(p.fears || '')}" placeholder="What they're afraid of" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Habits</label>
                        <input type="text" id="char-personality-habits" value="${escapeHtml(p.habits || '')}" placeholder="Quirks, routines" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Goals</label>
                        <input type="text" id="char-personality-goals" value="${escapeHtml(p.goals || '')}" placeholder="What they want to achieve" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
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
                <div id="academic-class-view" style="margin-top:8px;"></div>
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
                    <label style="font-size:0.7rem;color:var(--text-dim);">Specialty</label>
                    <input type="text" id="char-specialty" value="${escapeHtml(c.specialty || '')}" placeholder="e.g., herbalist, alchemist, smith" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                </div>

                <div class="form-group" style="margin-top:12px;">
                    <label style="font-size:0.7rem;color:var(--text-dim);display:block;margin-bottom:4px;">Career Status History</label>
                    <div style="font-size:0.6rem;color:var(--text-dim);margin-bottom:6px;">Entries are sorted chronologically by start year.</div>
                    <div id="career-status-container" style="display:flex;flex-direction:column;gap:2px;"></div>
                    <button type="button" id="add-career-entry-btn" class="small secondary" style="margin-top:6px;font-size:0.65rem;padding:3px 10px;">+ Add Status Entry</button>
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
            if (typeof CharacterStatsView.getMagicalSectionHTML === 'function') {
                magicalHTML = CharacterStatsView.getMagicalSectionHTML(c);
            }
            if (typeof CharacterStatsView.getMovesSectionHTML === 'function') {
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
                    <label style="font-size:0.75rem;color:var(--accent);font-weight:600;display:block;margin-bottom:6px;">Combat Notes</label>
                    <textarea id="char-combat-notes" rows="4" placeholder="Combat-specific notes, tactics, observations..." style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;resize:vertical;">${escapeHtml(c.combatNotes || '')}</textarea>
                </div>

            </div>
        `;
    }

    // ============================================================
    // COMBAT TAB - PHYSICAL SECTION
    // ============================================================

    function getPhysicalSectionHTML(c) {
        var stats = c.stats || {};
        var statKeys = getStatKeys();
        var statDefinitions = getStatDefinitions();

        var statInputs = '';
        statKeys.forEach(function(key) {
            var definition = statDefinitions[key] || {};
            var abbreviation = definition.abbreviation || key.toUpperCase();
            var value = stats[key] !== undefined ? stats[key] : getStatDefault();

            var modifier = Math.floor((value - 10) / 2);
            var modifierDisplay = (modifier >= 0 ? '+' : '') + modifier;
            var modColor = modifier > 0 ? 'var(--accent)' : (modifier < 0 ? 'var(--danger)' : 'var(--text-dim)');

            statInputs += `
                <div class="stat-block" style="display:flex;flex-direction:column;gap:2px;align-items:center;padding:6px;background:var(--panel-alt);border:1px solid var(--border);border-radius:6px;">
                    <label style="font-size:0.6rem;color:var(--text-dim);font-weight:600;">${abbreviation}</label>
                    <input type="number" id="char-stat-${key}" value="${value}" min="${getStatMin()}" max="${getStatMax()}" data-stat-key="${key}" class="stat-input" style="width:100%;padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.9rem;font-weight:700;text-align:center;">
                    <span class="stat-modifier" data-modifier-key="${key}" style="font-size:0.65rem;color:${modColor};font-weight:600;">${modifierDisplay}</span>
                </div>
            `;
        });

        var classOptions = '<option value="">— Derived —</option>';
        var physicalClasses = getPhysicalClasses();
        physicalClasses.forEach(function(cls) {
            classOptions += '<option value="' + escapeHtml(cls.id) + '">' + escapeHtml(cls.label) + '</option>';
        });

        return `
            <div class="combat-section" style="margin-bottom:12px;padding:10px;background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
                    <label style="font-size:0.8rem;color:var(--accent);font-weight:600;">Physical</label>
                    <button type="button" id="roll-stats-btn" class="small secondary" style="font-size:0.65rem;padding:3px 10px;">⟳ Roll Stats</button>
                </div>

                <div class="stat-grid" style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:10px;">
                    ${statInputs}
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Derived Class</label>
                        <div id="derived-physical-class" style="padding:5px 8px;background:var(--bg);border:1px solid var(--border);color:var(--accent);border-radius:4px;font-size:0.75rem;font-weight:600;">—</div>
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Override (rewrites stats)</label>
                        <select id="physical-class-override" style="width:100%;padding:5px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                            ${classOptions}
                        </select>
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">HP</label>
                        <div style="display:flex;gap:6px;">
                            <input type="number" id="char-hp" value="${c.hp || 0}" min="0" max="999" style="flex:1;padding:5px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.8rem;">
                            <button type="button" id="roll-hp-btn" class="small secondary" style="font-size:0.7rem;padding:4px 10px;">⟳</button>
                        </div>
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">MP</label>
                        <div style="display:flex;gap:6px;">
                            <input type="number" id="char-mp" value="${c.mp || 0}" min="0" max="999" style="flex:1;padding:5px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.8rem;">
                            <button type="button" id="roll-mp-btn" class="small secondary" style="font-size:0.7rem;padding:4px 10px;">⟳</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // COMBAT TAB - WEAPONS SECTION
    // ============================================================

    function getWeaponsSectionHTML(c) {
        return `
            <div class="combat-section" style="margin-bottom:12px;padding:10px;background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
                    <label style="font-size:0.8rem;color:var(--accent);font-weight:600;">Weapons</label>
                    <button type="button" id="add-weapon-btn" class="small secondary" style="font-size:0.65rem;padding:3px 10px;">+ Add Weapon</button>
                </div>
                <div id="weapons-container" style="display:flex;flex-direction:column;gap:2px;"></div>
            </div>
        `;
    }

    // ============================================================
    // SOCIAL TAB
    // ============================================================

    function getSocialTabHTML(c) {
        var active = state.currentTab === 'social' ? 'block' : 'none';

        return `
            <div class="tab-panel" data-tab="social" style="display:${active};">
                <div id="social-view" style="margin-top:8px;"></div>
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
                    <label style="font-size:0.7rem;color:var(--text-dim);">Notes</label>
                    <textarea id="char-notes-tab" rows="8" placeholder="General notes about this character..." style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;resize:vertical;">${escapeHtml(c.notes || '')}</textarea>
                </div>
            </div>
        `;
    }

    // ============================================================
    // FORM FIELD POPULATION
    // ============================================================

    function populateFormFields(char) {
        if (!char) { return; }

        var FormUtils = getFormUtils();
        if (!FormUtils) { return; }

        // Name Tab
        FormUtils.setField('char-firstName', char.firstName);
        FormUtils.setField('char-middleName', char.middleName);
        FormUtils.setField('char-lastName', char.lastName);
        FormUtils.setField('char-nickname', char.nickname);
        FormUtils.setField('char-alias', char.alias);

        var prevNamesContainer = document.getElementById('previous-names-container');
        if (prevNamesContainer) {
            prevNamesContainer.textContent = '';
            var prevNames = Array.isArray(char.previousNames) ? char.previousNames : [];
            if (prevNames.length === 0) {
                addPreviousNameRow(prevNamesContainer, '');
            } else {
                prevNames.forEach(function(name) {
                    addPreviousNameRow(prevNamesContainer, name);
                });
            }
        }

        var dp = char.displayParts || {};
        FormUtils.setField('char-displayFirst',    dp.first    !== false);
        FormUtils.setField('char-displayNickname', dp.nickname === true);
        FormUtils.setField('char-displayMiddle',   dp.middle   !== false);
        FormUtils.setField('char-displayLast',     dp.last     !== false);
        FormUtils.setField('char-displayAlias',    dp.alias    === true);

        FormUtils.setField('char-birthYear', char.birthYear || '');
        var currentYear = getCurrentYear();
        var ageField = document.getElementById('char-age');
        if (ageField) {
            var by = parseInt(char.birthYear, 10);
            ageField.value = !isNaN(by) ? String(currentYear - by) : '';
        }

        FormUtils.setField('char-gender', char.gender);
        FormUtils.setField('char-attraction', char.attraction);

        var isDeceased = char.deceased === true;
        FormUtils.setField('char-deceased', isDeceased);
        FormUtils.setField('char-deathYear', char.deathYear || '');
        FormUtils.setField('char-deathAge', char.deathAge || '');
        FormUtils.setField('char-deathCause', char.deathCause || '');

        var deathFields = document.getElementById('death-fields');
        if (deathFields) {
            deathFields.style.display = isDeceased ? 'block' : 'none';
        }
        applyDeceasedState(isDeceased);

        // Physical Tab
        FormUtils.setField('char-eyes', char.eyes);
        FormUtils.setField('char-hair', char.hair);
        FormUtils.setField('char-skin', char.skin);
        FormUtils.setField('char-height', char.height);
        FormUtils.setField('char-weight', char.weight);
        FormUtils.setField('char-build', char.build);
        FormUtils.setField('char-appearanceNotes', char.appearanceNotes);

        // Personality Tab
        if (char.personality) {
            FormUtils.setField('char-personality-traits', char.personality.traits);
            FormUtils.setField('char-personality-ideals', char.personality.ideals);
            FormUtils.setField('char-personality-bonds', char.personality.bonds);
            FormUtils.setField('char-personality-flaws', char.personality.flaws);
            FormUtils.setField('char-personality-alignment', char.personality.alignment);
            FormUtils.setField('char-personality-likes', char.personality.likes);
            FormUtils.setField('char-personality-dislikes', char.personality.dislikes);
            FormUtils.setField('char-personality-habits', char.personality.habits);
            FormUtils.setField('char-personality-fears', char.personality.fears);
            FormUtils.setField('char-personality-goals', char.personality.goals);
        }

        // Professional Tab
        FormUtils.setField('char-specialty', char.specialty);

        var careerContainer = document.getElementById('career-status-container');
        if (careerContainer) {
            careerContainer.textContent = '';
            var careerEntries = Array.isArray(char.careerStatus) ? char.careerStatus : [];
            if (careerEntries.length === 0) {
                addCareerEntryRow(careerContainer);
            } else {
                careerEntries.forEach(function(entry) {
                    addCareerEntryRow(careerContainer, entry);
                });
            }
        }

        // Combat Tab - Stats (inputs already rendered with values; keeping for consistency)
        var statKeys = getStatKeys();
        if (char.stats) {
            statKeys.forEach(function(key) {
                var value = char.stats[key] !== undefined ? char.stats[key] : getStatDefault();
                FormUtils.setField('char-stat-' + key, value);
            });
        }

        // Combat Tab - HP / MP
        FormUtils.setField('char-hp', char.hp || 0);
        FormUtils.setField('char-mp', char.mp || 0);

        // Combat Tab - Weapons
        var weaponsContainer = document.getElementById('weapons-container');
        if (weaponsContainer) {
            weaponsContainer.textContent = '';
            var weapons = Array.isArray(char.weapons) ? char.weapons : [];
            weapons.forEach(function(w) {
                addWeaponRow(weaponsContainer, w);
            });
        }

        // Combat Tab - Combat Notes (SEPARATE from Notes tab)
        FormUtils.setField('char-combat-notes', char.combatNotes || '');

        // Notes Tab - general notes
        FormUtils.setField('char-notes-tab', char.notes || '');
    }

    // ============================================================
    // FORM DATA COLLECTION
    // ============================================================

    function collectCareerStatus(form) {
        var rows = form.querySelectorAll('#career-status-container .career-status-entry');
        var entries = [];

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var statusEl = row.querySelector('.career-status-select');
            var startEl = row.querySelector('.career-start-year');
            var endEl = row.querySelector('.career-end-year');
            var titleEl = row.querySelector('.career-title');

            var status = statusEl ? String(statusEl.value || '').trim() : '';
            if (!status) { continue; }

            var startYear = startEl ? String(startEl.value || '').trim() : '';
            var endYear = endEl ? String(endEl.value || '').trim() : '';
            var title = titleEl ? String(titleEl.value || '').trim() : '';

            entries.push({
                status: status,
                startYear: startYear,
                endYear: endYear,
                title: title
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
        var rows = form.querySelectorAll('#weapons-container .weapon-entry');
        var weapons = [];

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var nameEl = row.querySelector('.weapon-name');
            var typeEl = row.querySelector('.weapon-type');
            var notesEl = row.querySelector('.weapon-notes');

            var name = nameEl ? String(nameEl.value || '').trim() : '';
            if (!name) { continue; }

            weapons.push({
                id: row.dataset.weaponId || undefined,
                name: name,
                type: typeEl ? String(typeEl.value || '').trim() : getDefaultWeaponType(),
                notes: notesEl ? String(notesEl.value || '').trim() : ''
            });
        }

        return weapons;
    }

    function collect() {
        var FormUtils = getFormUtils();
        if (!FormUtils) {
            console.warn('[CharacterForm] FormUtils not available for collect');
            return null;
        }

        var form = document.getElementById('character-form');
        if (!form) { return null; }

        var statKeys = getStatKeys();
        var statMin = getStatMin();
        var statMax = getStatMax();
        var statDefault = getStatDefault();

        // Previous Names
        var previousNames = [];
        var prevInputs = form.querySelectorAll('.previous-name-input');
        for (var i = 0; i < prevInputs.length; i++) {
            var val = prevInputs[i].value.trim();
            if (val) { previousNames.push(val); }
        }

        // Display Parts
        var displayParts = {
            first:    FormUtils.getField('char-displayFirst') === true,
            nickname: FormUtils.getField('char-displayNickname') === true,
            middle:   FormUtils.getField('char-displayMiddle') === true,
            last:     FormUtils.getField('char-displayLast') === true,
            alias:    FormUtils.getField('char-displayAlias') === true
        };

        // Deceased / Life Events
        var isDeceased = FormUtils.getField('char-deceased') === true;

        var deathYear = '';
        var deathAge = '';
        var deathCause = '';

        if (isDeceased) {
            deathYear = FormUtils.getField('char-deathYear') || '';
            deathAge = FormUtils.getField('char-deathAge') || '';
            deathCause = FormUtils.getField('char-deathCause') || '';
        }

        var birthYearRaw = FormUtils.getField('char-birthYear') || '';

        if (isDeceased && !deathAge && birthYearRaw && deathYear) {
            var by = parseInt(birthYearRaw, 10);
            var dy = parseInt(deathYear, 10);
            if (!isNaN(by) && !isNaN(dy) && dy >= by) {
                deathAge = String(dy - by);
            }
        }

        var dto = {
            // Name tab
            firstName: FormUtils.getField('char-firstName') || '',
            middleName: FormUtils.getField('char-middleName') || '',
            lastName: FormUtils.getField('char-lastName') || '',
            nickname: FormUtils.getField('char-nickname') || '',
            alias: FormUtils.getField('char-alias') || '',
            previousNames: previousNames,
            displayParts: displayParts,

            // Birth year
            birthYear: birthYearRaw,

            // Gender / Attraction
            gender: FormUtils.getField('char-gender') || '',
            attraction: FormUtils.getField('char-attraction') || '',

            // Life events
            deceased: isDeceased,
            deathYear: deathYear,
            deathAge: deathAge,
            deathCause: deathCause,

            // Physical tab
            eyes: FormUtils.getField('char-eyes') || '',
            hair: FormUtils.getField('char-hair') || '',
            skin: FormUtils.getField('char-skin') || '',
            height: FormUtils.getField('char-height') || '',
            weight: FormUtils.getField('char-weight') || '',
            build: FormUtils.getField('char-build') || '',
            appearanceNotes: FormUtils.getField('char-appearanceNotes') || '',

            // Professional tab
            specialty: FormUtils.getField('char-specialty') || '',
            careerStatus: collectCareerStatus(form),

            // Combat tab - Physical stats
            stats: {},

            // Combat tab - HP / MP
            hp: parseInt(FormUtils.getField('char-hp'), 10) || 0,
            mp: parseInt(FormUtils.getField('char-mp'), 10) || 0,

            // Combat tab - Weapons
            weapons: collectWeapons(form),

            // Combat tab - Combat notes (separate from general notes)
            combatNotes: FormUtils.getField('char-combat-notes') || '',

            // Notes tab - general notes
            notes: FormUtils.getField('char-notes-tab') || '',

            // Personality tab
            personality: {
                traits: FormUtils.getField('char-personality-traits') || '',
                ideals: FormUtils.getField('char-personality-ideals') || '',
                bonds: FormUtils.getField('char-personality-bonds') || '',
                flaws: FormUtils.getField('char-personality-flaws') || '',
                alignment: FormUtils.getField('char-personality-alignment') || '',
                likes: FormUtils.getField('char-personality-likes') || '',
                dislikes: FormUtils.getField('char-personality-dislikes') || '',
                habits: FormUtils.getField('char-personality-habits') || '',
                fears: FormUtils.getField('char-personality-fears') || '',
                goals: FormUtils.getField('char-personality-goals') || ''
            }
        };

        // Stats
        statKeys.forEach(function(key) {
            var value = parseInt(FormUtils.getField('char-stat-' + key), 10);
            dto.stats[key] = !isNaN(value) ? Math.max(statMin, Math.min(statMax, value)) : statDefault;
        });

        // Magic — collected via CharacterStatsView
        var CharacterStatsView = getCharacterStatsView();
        if (CharacterStatsView && typeof CharacterStatsView.collectMagicalFields === 'function') {
            dto.magic = CharacterStatsView.collectMagicalFields();
        }

        return dto;
    }

    // ============================================================
    // TAB SWITCHING
    // ============================================================

    function switchTab(tab) {
        if (!tab || VALID_TABS.indexOf(tab) === -1) { return; }

        state.currentTab = tab;

        var btns = document.querySelectorAll('.form-tab-btn');
        btns.forEach(function(btn) {
            var isActive = btn.dataset.tab === tab;
            btn.classList.toggle('active', isActive);
            btn.style.color = isActive ? 'var(--accent)' : 'var(--text-dim)';
            btn.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
        });

        var panels = document.querySelectorAll('.tab-panel');
        panels.forEach(function(panel) {
            var isActive = panel.dataset.tab === tab;
            panel.style.display = isActive ? 'block' : 'none';
        });
    }

    // ============================================================
    // RANDOM GENERATION
    // ============================================================

    function generateRandomPhysical() {
        var CharacterGenerator = getCharacterGenerator();
        if (!CharacterGenerator) { return null; }
        return CharacterGenerator.generatePhysical ? CharacterGenerator.generatePhysical() : null;
    }

    function generateRandomPersonality() {
        var CharacterGenerator = getCharacterGenerator();
        if (!CharacterGenerator) { return null; }
        return CharacterGenerator.generatePersonality ? CharacterGenerator.generatePersonality() : null;
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

    window.showCharacterForm = function(editId) {
        render(editId);
    };

    window.hideCharacterForm = hide;

    // ============================================================
    // VERIFICATION
    // ============================================================

    (function verify() {
        var exports = window.CharacterForm;
        var missing = [];

        var required = [
            'render', 'hide', 'collect', 'switchTab',
            'getCurrentTab', 'isInitialized'
        ];

        for (var i = 0; i < required.length; i++) {
            if (typeof exports[required[i]] !== 'function') {
                missing.push(required[i]);
            }
        }

        if (missing.length > 0) {
            console.warn('[CharacterForm] Verification - some exports may be missing:', missing.join(', '));
        } else {
            console.log('[CharacterForm] All exports verified successfully.');
        }
    })();

})();
