/**
 * js/modules/characters/character-form.js - Character Form
 * Handles form rendering, tab switching, and form field population
 * Path: js/modules/characters/character-form.js
 * 
 * This module is responsible for:
 *   - Rendering the character form in the right side container
 *   - Tab switching between form sections
 *   - Populating form fields from character data
 *   - Collecting form data for save operations
 *   - Delegating save operations to CharacterCRUD
 * 
 * IMPORTANT:
 *   - RENDER ONLY - no event binding (handled by CharacterEvents)
 *   - USES CharacterQueries for character data and display names
 *   - USES CharacterCRUD for save operations
 *   - USES CharacterGenerator for random generation (LAZY LOADED)
 *   - USES CharacterConstants for canonical constants
 *   - USES AcademyQueries directly for class queries (simple read)
 *   - USES FormUtils for form field operations
 *   - USES DomUtils for safe DOM operations
 *   - No direct data mutation
 *   - No direct persistence calls
 *   - All user-controlled data is escaped using DomUtils.escapeHtml()
 *   - getCurrentEditId and setCurrentEditId are LAZY LOADED from index.js
 * 
 * DEPENDENCIES (lazily loaded):
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.CharacterCRUD (from character-crud.js) - MANDATORY
 *   - window.CharacterGenerator (from character-generator.js) - LAZY LOADED
 *   - window.CharacterConstants (from character-constants.js) - MANDATORY
 *   - window.AcademyQueries (from academy-queries.js) - MANDATORY
 *   - window.FormUtils (from form-utils.js) - MANDATORY
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 *   - window.getCurrentEditId (from index.js) - LAZY LOADED
 *   - window.setCurrentEditId (from index.js) - LAZY LOADED
 */

(function() {
    'use strict';

    if (window.__characterFormLoaded) {
        return;
    }
    window.__characterFormLoaded = true;

    // ============================================================
    // LAZY LOADING HELPERS - Breaks circular dependencies
    // ============================================================

    function getCharacterQueries() {
        return window.CharacterQueries || null;
    }

    function getCharacterCRUD() {
        return window.CharacterCRUD || null;
    }

    function getCharacterGenerator() {
        return window.CharacterGenerator || null;
    }

    function getCharacterConstants() {
        return window.CharacterConstants || null;
    }

    function getAcademyQueries() {
        return window.AcademyQueries || null;
    }

    function getFormUtils() {
        return window.FormUtils || null;
    }

    function getDomUtils() {
        return window.DomUtils || null;
    }

    function getCalendarConstants() {
        return window.CalendarConstants || null;
    }

    /**
     * Get the current edit ID from the global state.
     * This is lazily loaded from characters/index.js
     */
    function getCurrentEditId() {
        if (typeof window.getCurrentEditId === 'function') {
            return window.getCurrentEditId();
        }
        if (window._currentEditId !== undefined) {
            return window._currentEditId;
        }
        return null;
    }

    /**
     * Set the current edit ID in the global state.
     * This is lazily loaded from characters/index.js
     */
    function setCurrentEditId(id) {
        if (typeof window.setCurrentEditId === 'function') {
            window.setCurrentEditId(id);
        } else {
            window._currentEditId = id;
        }
    }

    // ============================================================
    // DEPENDENCY CHECK - Warns but doesn't fail
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!getCharacterQueries()) { missing.push('CharacterQueries'); }
        if (!getCharacterCRUD()) { missing.push('CharacterCRUD'); }
        if (!getCharacterConstants()) { missing.push('CharacterConstants'); }
        if (!getAcademyQueries()) { missing.push('AcademyQueries'); }
        if (!getFormUtils()) { missing.push('FormUtils'); }
        if (!getDomUtils()) { missing.push('DomUtils'); }

        if (!getCharacterGenerator()) { missing.push('CharacterGenerator (lazy)'); }

        if (typeof window.getCurrentEditId !== 'function' && window._currentEditId === undefined) {
            missing.push('getCurrentEditId (lazy)');
        }
        if (typeof window.setCurrentEditId !== 'function' && window._currentEditId === undefined) {
            missing.push('setCurrentEditId (lazy)');
        }

        if (missing.length > 0) {
            var criticalMissing = missing.filter(function(m) { return m.indexOf('(lazy)') === -1; });
            if (criticalMissing.length > 0) {
                console.warn('[CharacterForm] Critical dependencies missing:', criticalMissing.join(', '));
                return false;
            }
            console.warn('[CharacterForm] Some lazy dependencies not yet loaded:', missing.join(', '));
        }

        return true;
    }

    checkDependencies();

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils
    // ============================================================

    function escapeHtml(value) {
        var DomUtils = getDomUtils();
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
        }
        if (value === undefined || value === null) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // CONSTANTS - Lazy loaded from CharacterConstants
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
        return CC ? CC.STAT_MAX || 50 : 50;
    }

    function getStatDefault() {
        var CC = getCharacterConstants();
        return CC ? CC.STAT_DEFAULT || 10 : 10;
    }

    function getCalendarBounds() {
        var CC = getCalendarConstants();
        if (CC) {
            return {
                MIN_WEEK: CC.MIN_WEEK || 1,
                MAX_WEEK: CC.MAX_WEEK || 52
            };
        }
        return { MIN_WEEK: 1, MAX_WEEK: 52 };
    }

    // ============================================================
    // STATE
    // ============================================================

    var state = {
        currentTab: 'name'
    };

    var VALID_TABS = ['name', 'physical', 'personality', 'academic', 'professional', 'stats', 'social', 'notes'];
    var _initialized = false;

    // ============================================================
    // GET CURRENT YEAR
    // ============================================================

    function getCurrentYear() {
        if (window.data && typeof window.data.currentYear === 'number') {
            return window.data.currentYear;
        }
        return new Date().getFullYear();
    }

    // ============================================================
    // GET CLASS OPTIONS HTML - Uses AcademyQueries
    // ============================================================

    function getClassOptionsHTML(selectedId) {
        var AcademyQueries = getAcademyQueries();
        if (!AcademyQueries) {
            return '<option value="">None</option>';
        }

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
    // PREVIOUS NAME ROW HELPER
    // ============================================================

    /**
     * Append a previous-name row to the given container.
     * Used by populateFormFields and re-used by CharacterEvents.
     */
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
    // RENDER FORM
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
            // Initialize previous-names container for new characters
            var prevContainer = document.getElementById('previous-names-container');
            if (prevContainer) {
                prevContainer.textContent = '';
                addPreviousNameRow(prevContainer, '');
            }
            // Initialize death fields as disabled
            applyDeceasedState(false);
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

    // ============================================================
    // DECEASED FIELD STATE HELPER
    // ============================================================

    /**
     * Enable or disable the death detail fields based on whether
     * the deceased checkbox is checked.
     * 
     * @param {boolean} isDeceased
     */
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
    // FORM HTML GENERATORS
    // ============================================================

    function getCharacterFormHTML(char, editId, currentYear) {
        var tabs = getTabsHTML();
        var c = char || {};

        return `
            <div class="character-form-container">
                <div class="form-tabs" style="display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:12px;">
                    ${tabs}
                </div>
                <div class="form-tab-content" id="form-tab-content">
                    ${getNameTabHTML(c, editId)}
                    ${getPhysicalTabHTML(c)}
                    ${getPersonalityTabHTML(c)}
                    ${getAcademicTabHTML(c)}
                    ${getProfessionalTabHTML(c)}
                    ${getStatsTabHTML(c)}
                    ${getSocialTabHTML(c)}
                    ${getNotesTabHTML(c)}
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
            'stats': 'Stats',
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
    // NAME TAB (with Life Events + Birth Year + Display Checkboxes)
    // ============================================================

    function getNameTabHTML(char, editId) {
        var active = state.currentTab === 'name' ? 'block' : 'none';
        var c = char || {};

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

                <div class="form-group">
                    <label style="font-size:0.7rem;color:var(--text-dim);">Sexuality</label>
                    <input type="text" id="char-sexuality" value="${escapeHtml(c.sexuality || '')}" placeholder="e.g., Heterosexual, Bisexual, Asexual" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
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

    function getPhysicalTabHTML(char) {
        var active = state.currentTab === 'physical' ? 'block' : 'none';
        var c = char || {};

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

    function getPersonalityTabHTML(char) {
        var active = state.currentTab === 'personality' ? 'block' : 'none';
        var p = char && char.personality ? char.personality : {};

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

    function getAcademicTabHTML(char) {
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

    function getProfessionalTabHTML(char) {
        var active = state.currentTab === 'professional' ? 'block' : 'none';
        var c = char || {};

        return `
            <div class="tab-panel" data-tab="professional" style="display:${active};">
                <div class="form-group">
                    <label style="font-size:0.7rem;color:var(--text-dim);">Specialty</label>
                    <input type="text" id="char-specialty" value="${escapeHtml(c.specialty || '')}" placeholder="Area of expertise" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                </div>
                <div id="professional-view" style="margin-top:8px;"></div>
            </div>
        `;
    }

    // ============================================================
    // STATS TAB
    // ============================================================

    function getStatsTabHTML(char) {
        var active = state.currentTab === 'stats' ? 'block' : 'none';
        var stats = char && char.stats ? char.stats : {};
        var statKeys = getStatKeys();
        var statDefinitions = getStatDefinitions();

        var html = `
            <div class="tab-panel" data-tab="stats" style="display:${active};">
                <div style="display:flex;justify-content:flex-end;margin-bottom:6px;">
                    <button type="button" id="random-stats-btn" class="small secondary" style="font-size:0.65rem;padding:3px 10px;">⟳ Random</button>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
        `;

        statKeys.forEach(function(key) {
            var definition = statDefinitions[key] || {};
            var label = definition.label || key.toUpperCase();
            var value = stats[key] !== undefined ? stats[key] : getStatDefault();

            html += `
                <div class="form-group">
                    <label style="font-size:0.7rem;color:var(--text-dim);">${label}</label>
                    <input type="number" id="char-stat-${key}" value="${value}" min="${getStatMin()}" max="${getStatMax()}" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;text-align:center;">
                </div>
            `;
        });

        html += `
                </div>
                <div id="stats-view" style="margin-top:8px;"></div>
            </div>
        `;

        return html;
    }

    // ============================================================
    // SOCIAL TAB
    // ============================================================

    function getSocialTabHTML(char) {
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

    function getNotesTabHTML(char) {
        var active = state.currentTab === 'notes' ? 'block' : 'none';
        var c = char || {};

        return `
            <div class="tab-panel" data-tab="notes" style="display:${active};">
                <div class="form-group">
                    <label style="font-size:0.7rem;color:var(--text-dim);">Notes</label>
                    <textarea id="char-notes" rows="6" placeholder="General notes about this character..." style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;resize:vertical;">${escapeHtml(c.notes || '')}</textarea>
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
        if (!FormUtils) {
            console.warn('[CharacterForm] FormUtils not available for populateFormFields');
            return;
        }

        // ---- Name Tab ----
        FormUtils.setField('char-firstName', char.firstName);
        FormUtils.setField('char-middleName', char.middleName);
        FormUtils.setField('char-lastName', char.lastName);
        FormUtils.setField('char-nickname', char.nickname);
        FormUtils.setField('char-alias', char.alias);

        // Previous names
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

        // Display parts
        var dp = char.displayParts || {};
        FormUtils.setField('char-displayFirst',    dp.first    !== false);
        FormUtils.setField('char-displayNickname', dp.nickname === true);
        FormUtils.setField('char-displayMiddle',   dp.middle   !== false);
        FormUtils.setField('char-displayLast',     dp.last     !== false);
        FormUtils.setField('char-displayAlias',    dp.alias    === true);

        // Birth year + Age (Name tab)
        FormUtils.setField('char-birthYear', char.birthYear || '');
        var currentYear = getCurrentYear();
        var ageField = document.getElementById('char-age');
        if (ageField) {
            var by = parseInt(char.birthYear, 10);
            ageField.value = !isNaN(by) ? String(currentYear - by) : '';
        }

        // Gender / Attraction / Sexuality (Name tab)
        FormUtils.setField('char-gender', char.gender);
        FormUtils.setField('char-attraction', char.attraction);
        FormUtils.setField('char-sexuality', char.sexuality);

        // Life Events (deceased)
        var isDeceased = char.deceased === true;
        FormUtils.setField('char-deceased', isDeceased);
        FormUtils.setField('char-deathYear', char.deathYear || '');
        FormUtils.setField('char-deathAge', char.deathAge || '');
        FormUtils.setField('char-deathCause', char.deathCause || '');

        // Sync UI state for the death field group
        var deathFields = document.getElementById('death-fields');
        if (deathFields) {
            deathFields.style.display = isDeceased ? 'block' : 'none';
        }
        applyDeceasedState(isDeceased);

        // ---- Physical Tab ----
        FormUtils.setField('char-eyes', char.eyes);
        FormUtils.setField('char-hair', char.hair);
        FormUtils.setField('char-skin', char.skin);
        FormUtils.setField('char-height', char.height);
        FormUtils.setField('char-weight', char.weight);
        FormUtils.setField('char-build', char.build);
        FormUtils.setField('char-appearanceNotes', char.appearanceNotes);

        // ---- Personality Tab ----
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

        // ---- Professional Tab ----
        FormUtils.setField('char-specialty', char.specialty);

        // ---- Notes Tab ----
        FormUtils.setField('char-notes', char.notes);

        // ---- Stats Tab ----
        var statKeys = getStatKeys();
        if (char.stats) {
            statKeys.forEach(function(key) {
                var value = char.stats[key] !== undefined ? char.stats[key] : getStatDefault();
                FormUtils.setField('char-stat-' + key, value);
            });
        }
    }

    // ============================================================
    // FORM DATA COLLECTION
    // ============================================================

    function collect() {
        var FormUtils = getFormUtils();
        if (!FormUtils) {
            console.warn('[CharacterForm] FormUtils not available for collect');
            return null;
        }

        var form = document.getElementById('character-form');
        if (!form) { return null; }

        var data = FormUtils.getFormData(form);
        var statKeys = getStatKeys();
        var statMin = getStatMin();
        var statMax = getStatMax();
        var statDefault = getStatDefault();

        // ---- Previous Names ----
        var previousNames = [];
        var prevInputs = form.querySelectorAll('.previous-name-input');
        for (var i = 0; i < prevInputs.length; i++) {
            var val = prevInputs[i].value.trim();
            if (val) { previousNames.push(val); }
        }

        // ---- Display Parts ----
        var displayParts = {
            first:    FormUtils.getField('char-displayFirst') === true,
            nickname: FormUtils.getField('char-displayNickname') === true,
            middle:   FormUtils.getField('char-displayMiddle') === true,
            last:     FormUtils.getField('char-displayLast') === true,
            alias:    FormUtils.getField('char-displayAlias') === true
        };

        // ---- Deceased / Life Events ----
        var isDeceased = FormUtils.getField('char-deceased') === true;

        var deathYear = '';
        var deathAge = '';
        var deathCause = '';

        if (isDeceased) {
            deathYear = FormUtils.getField('char-deathYear') || '';
            deathAge = FormUtils.getField('char-deathAge') || '';
            deathCause = FormUtils.getField('char-deathCause') || '';
        }

        // Auto-fill death age from birth year if empty
        var birthYearRaw = data['char-birthYear'] || '';
        if (isDeceased && !deathAge && birthYearRaw && deathYear) {
            var by = parseInt(birthYearRaw, 10);
            var dy = parseInt(deathYear, 10);
            if (!isNaN(by) && !isNaN(dy) && dy >= by) {
                deathAge = String(dy - by);
            }
        }

        var dto = {
            // Name tab
            firstName: data['char-firstName'] || '',
            middleName: data['char-middleName'] || '',
            lastName: data['char-lastName'] || '',
            nickname: data['char-nickname'] || '',
            alias: data['char-alias'] || '',
            previousNames: previousNames,
            displayParts: displayParts,

            // Birth year / age (Name tab)
            birthYear: data['char-birthYear'] || '',

            // Gender / Attraction / Sexuality (Name tab)
            gender: data['char-gender'] || '',
            attraction: data['char-attraction'] || '',
            sexuality: data['char-sexuality'] || '',

            // Life events (Name tab)
            deceased: isDeceased,
            deathYear: deathYear,
            deathAge: deathAge,
            deathCause: deathCause,

            // Physical tab
            eyes: data['char-eyes'] || '',
            hair: data['char-hair'] || '',
            skin: data['char-skin'] || '',
            height: data['char-height'] || '',
            weight: data['char-weight'] || '',
            build: data['char-build'] || '',
            appearanceNotes: data['char-appearanceNotes'] || '',

            // Professional tab
            specialty: data['char-specialty'] || '',

            // Notes tab
            notes: data['char-notes'] || '',

            // Personality tab
            personality: {
                traits: data['char-personality-traits'] || '',
                ideals: data['char-personality-ideals'] || '',
                bonds: data['char-personality-bonds'] || '',
                flaws: data['char-personality-flaws'] || '',
                alignment: data['char-personality-alignment'] || '',
                likes: data['char-personality-likes'] || '',
                dislikes: data['char-personality-dislikes'] || '',
                habits: data['char-personality-habits'] || '',
                fears: data['char-personality-fears'] || '',
                goals: data['char-personality-goals'] || ''
            },

            // Stats tab
            stats: {}
        };

        statKeys.forEach(function(key) {
            var value = parseInt(data['char-stat-' + key], 10);
            dto.stats[key] = !isNaN(value) ? Math.max(statMin, Math.min(statMax, value)) : statDefault;
        });

        var careerStatusRaw = data['char-careerStatus'] || '';
        if (careerStatusRaw) {
            try {
                var parsed = JSON.parse(careerStatusRaw);
                if (Array.isArray(parsed)) {
                    dto.careerStatus = parsed;
                }
            } catch (e) {
                // Ignore parse errors
            }
        }

        var classIdsRaw = data['char-classIds'] || '';
        if (classIdsRaw) {
            var classIds = classIdsRaw.split(',').map(function(s) {
                return s.trim();
            }).filter(function(s) {
                return s !== '';
            });
            if (classIds.length > 0) {
                dto.classIds = classIds;
            }
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
        if (!CharacterGenerator) {
            console.warn('[CharacterForm] CharacterGenerator not available');
            return null;
        }
        return CharacterGenerator.generatePhysical ? CharacterGenerator.generatePhysical() : null;
    }

    function generateRandomPersonality() {
        var CharacterGenerator = getCharacterGenerator();
        if (!CharacterGenerator) {
            console.warn('[CharacterForm] CharacterGenerator not available');
            return null;
        }
        return CharacterGenerator.generatePersonality ? CharacterGenerator.generatePersonality() : null;
    }

    function generateRandomStats() {
        var CharacterGenerator = getCharacterGenerator();
        if (!CharacterGenerator) {
            console.warn('[CharacterForm] CharacterGenerator not available');
            return null;
        }
        return CharacterGenerator.generateStats3d6 ? CharacterGenerator.generateStats3d6() : null;
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
        generateRandomStats: generateRandomStats,

        addPreviousNameRow: addPreviousNameRow,
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