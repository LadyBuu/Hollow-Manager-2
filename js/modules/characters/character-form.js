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
 *   - USES CharacterGenerator for random generation
 *   - USES CharacterConstants for canonical constants
 *   - USES FormUtils for form field operations
 *   - USES DomUtils for safe DOM operations
 *   - No direct data mutation
 *   - No direct persistence calls
 *   - All user-controlled data is escaped using DomUtils.escapeHtml()
 * 
 * DEPENDENCIES:
 *   - window.CharacterQueries (from character-queries.js) - MANDATORY
 *   - window.CharacterCRUD (from character-crud.js) - MANDATORY
 *   - window.CharacterGenerator (from character-generator.js) - MANDATORY
 *   - window.CharacterConstants (from character-constants.js) - MANDATORY
 *   - window.FormUtils (from form-utils.js) - MANDATORY
 *   - window.DomUtils (from dom-utils.js) - MANDATORY
 *   - window.ClassesQueries (from classes-queries.js) - MANDATORY
 *   - window.CalendarCore (from calendar-core.js) - MANDATORY
 *   - window.getCurrentEditId (from index.js) - MANDATORY
 *   - window.setCurrentEditId (from index.js) - MANDATORY
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterFormLoaded) {
        return;
    }
    window.__characterFormLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS - MANDATORY (no fallbacks)
    // ============================================================

    var CharacterQueries = window.CharacterQueries;
    var CharacterCRUD = window.CharacterCRUD;
    var CharacterGenerator = window.CharacterGenerator;
    var CharacterConstants = window.CharacterConstants;
    var ClassesQueries = window.ClassesQueries;
    var CalendarCore = window.CalendarCore;
    var FormUtils = window.FormUtils;
    var DomUtils = window.DomUtils;

    // ============================================================
    // CONSTANTS - From CharacterConstants (MANDATORY)
    // ============================================================

    var STAT_KEYS = CharacterConstants.STAT_KEYS;
    var STAT_MIN = CharacterConstants.STAT_MIN;
    var STAT_MAX = CharacterConstants.STAT_MAX;
    var STAT_DEFAULT = CharacterConstants.STAT_DEFAULT;
    var STAT_DEFINITIONS = CharacterConstants.STAT_DEFINITIONS;
    var MAX_SPECIAL_MOVES = CharacterConstants.MAX_SPECIAL_MOVES;
    var MAX_MOVE_NAME_LENGTH = CharacterConstants.MAX_MOVE_NAME_LENGTH;
    var MAX_MOVE_DESCRIPTION_LENGTH = CharacterConstants.MAX_MOVE_DESCRIPTION_LENGTH;

    // Calendar constants
    var MIN_WEEK = window.CALENDAR_CONSTANTS ? window.CALENDAR_CONSTANTS.MIN_WEEK : 1;
    var MAX_WEEK = window.CALENDAR_CONSTANTS ? window.CALENDAR_CONSTANTS.MAX_WEEK : 52;

    // ============================================================
    // STATE
    // ============================================================

    var state = {
        currentTab: 'name'
    };

    var VALID_TABS = ['name', 'physical', 'personality', 'academic', 'professional', 'stats', 'social', 'notes'];
    var _initialized = false;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (!CharacterCRUD || typeof CharacterCRUD.save !== 'function') {
            missing.push('CharacterCRUD.save');
        }

        if (!CharacterGenerator || typeof CharacterGenerator.generatePhysical !== 'function') {
            missing.push('CharacterGenerator.generatePhysical');
        }
        if (!CharacterGenerator || typeof CharacterGenerator.generatePersonality !== 'function') {
            missing.push('CharacterGenerator.generatePersonality');
        }
        if (!CharacterGenerator || typeof CharacterGenerator.generateStats !== 'function') {
            missing.push('CharacterGenerator.generateStats');
        }

        if (!CharacterConstants || typeof CharacterConstants.STAT_KEYS === 'undefined') {
            missing.push('CharacterConstants.STAT_KEYS');
        }

        if (!ClassesQueries || typeof ClassesQueries.getClasses !== 'function') {
            missing.push('ClassesQueries.getClasses');
        }

        if (!CalendarCore || typeof CalendarCore.getCurrentYear !== 'function') {
            missing.push('CalendarCore.getCurrentYear');
        }

        if (!FormUtils || typeof FormUtils.getField !== 'function') {
            missing.push('FormUtils.getField');
        }
        if (!FormUtils || typeof FormUtils.setField !== 'function') {
            missing.push('FormUtils.setField');
        }
        if (!FormUtils || typeof FormUtils.getFormData !== 'function') {
            missing.push('FormUtils.getFormData');
        }
        if (!FormUtils || typeof FormUtils.setFormData !== 'function') {
            missing.push('FormUtils.setFormData');
        }
        if (!FormUtils || typeof FormUtils.resetForm !== 'function') {
            missing.push('FormUtils.resetForm');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (typeof window.getCurrentEditId !== 'function') {
            missing.push('getCurrentEditId');
        }
        if (typeof window.setCurrentEditId !== 'function') {
            missing.push('setCurrentEditId');
        }

        if (missing.length > 0) {
            console.warn('CharacterForm: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    // ============================================================
    // STATE ACCESS - Delegated to index.js
    // ============================================================

    function getCurrentEditId() {
        return window.getCurrentEditId();
    }

    function setCurrentEditId(id) {
        window.setCurrentEditId(id);
    }

    // ============================================================
    // GET CURRENT YEAR - From CalendarCore (MANDATORY)
    // ============================================================

    function getCurrentYear() {
        return CalendarCore.getCurrentYear();
    }

    // ============================================================
    // FORM RENDER
    // ============================================================

    function render(editId) {
        if (!checkDependencies()) {
            return;
        }

        var char = null;
        if (editId) {
            char = CharacterQueries.getCharacterById(editId);
            if (!char) {
                return;
            }
        }

        // Update the form title
        var title = document.getElementById('form-title');
        if (title) {
            title.textContent = editId ? 'Edit Character' : 'New Character';
        }

        // Update character name display
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

        // Get current year for age calculation
        var currentYear = getCurrentYear();

        // Build the form HTML
        var content = document.getElementById('character-form-content');
        if (!content) return;

        var html = getCharacterFormHTML(char, editId, currentYear);
        content.innerHTML = html;

        // Populate form fields if editing
        if (char) {
            populateFormFields(char);
        }

        // Show the form
        var form = document.getElementById('character-form');
        if (form) {
            form.style.display = 'block';
        }

        _initialized = true;
    }

    function hide() {
        var form = document.getElementById('character-form');
        if (form) {
            form.style.display = 'none';
        }
        var title = document.getElementById('form-title');
        if (title) {
            title.textContent = 'No Character Selected';
        }
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
    // CHARACTER FORM HTML
    // ============================================================

    function getCharacterFormHTML(char, editId, currentYear) {
        var tabs = getTabsHTML();

        return `
            <div class="character-form-container">
                <div class="form-tabs" style="display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:12px;">
                    ${tabs}
                </div>
                <div class="form-tab-content" id="form-tab-content">
                    ${getNameTabHTML(char, editId)}
                    ${getPhysicalTabHTML(char)}
                    ${getPersonalityTabHTML(char)}
                    ${getAcademicTabHTML(char)}
                    ${getProfessionalTabHTML(char)}
                    ${getStatsTabHTML(char)}
                    ${getSocialTabHTML(char)}
                    ${getNotesTabHTML(char)}
                </div>
                <div class="form-actions" style="display:flex;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
                    <button type="button" id="cancel-character-form" class="secondary" style="font-size:0.75rem;padding:6px 12px;">Cancel</button>
                    <button type="submit" id="save-character-btn" class="primary" style="font-size:0.75rem;padding:6px 12px;">${editId ? 'Update' : 'Create'} Character</button>
                </div>
            </div>
        `;
    }

    // ============================================================
    // TABS
    // ============================================================

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
            html += `<button class="form-tab-btn ${isActive ? 'active' : ''}" data-tab="${tab}" style="background:transparent;border:none;border-bottom:2px solid ${isActive ? 'var(--accent)' : 'transparent'};color:${isActive ? 'var(--accent)' : 'var(--text-dim)'};padding:4px 10px;cursor:pointer;font-size:0.7rem;transition:0.2s;">${tabNames[tab]}</button>`;
        }
        return html;
    }

    // ============================================================
    // NAME TAB - With Class Dropdown
    // ============================================================

    function getNameTabHTML(char, editId) {
        var active = state.currentTab === 'name' ? 'block' : 'none';
        var c = char || {};

        // Get graduating class options for dropdown
        var classOptions = getClassOptionsHTML(c.graduatingClassId);

        return `
            <div class="tab-panel" data-tab="name" style="display:${active};">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">First Name *</label>
                        <input type="text" id="char-firstName" value="${escapeHtml(c.firstName || '')}" placeholder="First name" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Last Name *</label>
                        <input type="text" id="char-lastName" value="${escapeHtml(c.lastName || '')}" placeholder="Last name" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Middle Name</label>
                        <input type="text" id="char-middleName" value="${escapeHtml(c.middleName || '')}" placeholder="Middle name" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Nickname</label>
                        <input type="text" id="char-nickname" value="${escapeHtml(c.nickname || '')}" placeholder="Nickname" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Alias</label>
                        <input type="text" id="char-alias" value="${escapeHtml(c.alias || '')}" placeholder="Alias" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Gender</label>
                        <input type="text" id="char-gender" value="${escapeHtml(c.gender || '')}" placeholder="Gender" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Birth Year</label>
                        <input type="number" id="char-birthYear" value="${escapeHtml(c.birthYear || '')}" placeholder="Birth year" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Age</label>
                        <input type="text" id="char-age" value="${c.birthYear ? getCurrentYear() - parseInt(c.birthYear, 10) : ''}" readonly style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text-dim);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>

                <!-- Graduating Class Dropdown -->
                <div class="form-group" style="margin-top:8px;">
                    <label style="font-size:0.7rem;color:var(--text-dim);">Graduating Class</label>
                    <select id="char-graduatingClass" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                        ${classOptions}
                    </select>
                    <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
                        <input type="checkbox" id="char-isInstructor" ${c.graduatingClassInstructor ? 'checked' : ''} style="accent-color:var(--accent);">
                        <label for="char-isInstructor" style="font-size:0.65rem;color:var(--text-dim);">Is an instructor (not a student)</label>
                    </div>
                </div>

                <div style="font-size:0.6rem;color:var(--text-dim);margin-top:4px;">* Required fields</div>
            </div>
        `;
    }

    function getClassOptionsHTML(selectedId) {
        var classes = ClassesQueries.getClasses();
        var html = '<option value="">None</option>';

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || typeof cls !== 'object') continue;
            var isSelected = String(cls.id) === String(selectedId);
            html += `<option value="${escapeHtml(cls.id)}" ${isSelected ? 'selected' : ''}>${escapeHtml(cls.name)}</option>`;
        }

        return html;
    }

    // ============================================================
    // OTHER TABS - Using CharacterQueries for display names
    // ============================================================

    function getPhysicalTabHTML(char) {
        var active = state.currentTab === 'physical' ? 'block' : 'none';
        var c = char || {};

        return `
            <div class="tab-panel" data-tab="physical" style="display:${active};">
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

    function getPersonalityTabHTML(char) {
        var active = state.currentTab === 'personality' ? 'block' : 'none';
        var p = char && char.personality ? char.personality : {};

        return `
            <div class="tab-panel" data-tab="personality" style="display:${active};">
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

    function getAcademicTabHTML(char) {
        var active = state.currentTab === 'academic' ? 'block' : 'none';
        var c = char || {};

        return `
            <div class="tab-panel" data-tab="academic" style="display:${active};">
                <div class="form-group">
                    <label style="font-size:0.7rem;color:var(--text-dim);">Graduating Class</label>
                    <select id="char-graduatingClass" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                        ${getClassOptionsHTML(c.graduatingClassId)}
                    </select>
                    <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
                        <input type="checkbox" id="char-isInstructor" ${c.graduatingClassInstructor ? 'checked' : ''} style="accent-color:var(--accent);">
                        <label for="char-isInstructor" style="font-size:0.65rem;color:var(--text-dim);">Is an instructor (not a student)</label>
                    </div>
                </div>
                <div id="academic-class-view" style="margin-top:8px;"></div>
            </div>
        `;
    }

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

    function getStatsTabHTML(char) {
        var active = state.currentTab === 'stats' ? 'block' : 'none';
        var stats = char && char.stats ? char.stats : {};

        var html = `
            <div class="tab-panel" data-tab="stats" style="display:${active};">
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
        `;

        STAT_KEYS.forEach(function(key) {
            var definition = STAT_DEFINITIONS[key] || {};
            var label = definition.label || key.toUpperCase();
            var value = stats[key] !== undefined ? stats[key] : STAT_DEFAULT;

            html += `
                <div class="form-group">
                    <label style="font-size:0.7rem;color:var(--text-dim);">${label}</label>
                    <input type="number" id="char-stat-${key}" value="${value}" min="${STAT_MIN}" max="${STAT_MAX}" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;text-align:center;">
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

    function getSocialTabHTML(char) {
        var active = state.currentTab === 'social' ? 'block' : 'none';
        var c = char || {};

        return `
            <div class="tab-panel" data-tab="social" style="display:${active};">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Attraction</label>
                        <input type="text" id="char-attraction" value="${escapeHtml(c.attraction || '')}" placeholder="e.g., Men, Women, All, None" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                    <div class="form-group">
                        <label style="font-size:0.7rem;color:var(--text-dim);">Sexuality</label>
                        <input type="text" id="char-sexuality" value="${escapeHtml(c.sexuality || '')}" placeholder="e.g., Heterosexual, Bisexual, Asexual" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    </div>
                </div>
                <div id="social-view" style="margin-top:8px;"></div>
            </div>
        `;
    }

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
    // POPULATE FORM FIELDS
    // ============================================================

    function populateFormFields(char) {
        if (!char) return;

        // Use FormUtils.setField for all fields        FormUtils.setField('char-firstName', char.firstName);
        FormUtils.setField('char-lastName', char.lastName);
        FormUtils.setField('char-middleName', char.middleName);
        FormUtils.setField('char-nickname', char.nickname);
        FormUtils.setField('char-alias', char.alias);
        FormUtils.setField('char-gender', char.gender);
        FormUtils.setField('char-birthYear', char.birthYear);

        // Physical
        FormUtils.setField('char-eyes', char.eyes);
        FormUtils.setField('char-hair', char.hair);
        FormUtils.setField('char-skin', char.skin);
        FormUtils.setField('char-height', char.height);
        FormUtils.setField('char-weight', char.weight);
        FormUtils.setField('char-build', char.build);
        FormUtils.setField('char-appearanceNotes', char.appearanceNotes);

        // Personality
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

        // Professional
        FormUtils.setField('char-specialty', char.specialty);

        // Social
        FormUtils.setField('char-attraction', char.attraction);
        FormUtils.setField('char-sexuality', char.sexuality);

        // Notes
        FormUtils.setField('char-notes', char.notes);

        // Class checkbox
        var checkbox = document.getElementById('char-isInstructor');
        if (checkbox) {
            checkbox.checked = char.graduatingClassInstructor || false;
        }

        // Stats
        if (char.stats) {
            STAT_KEYS.forEach(function(key) {
                var value = char.stats[key] !== undefined ? char.stats[key] : STAT_DEFAULT;
                FormUtils.setField('char-stat-' + key, value);
            });
        }
    }

    // ============================================================
    // COLLECT FORM DATA - Public API for CharacterEvents
    // ============================================================

    /**
     * Collect all form data as a DTO for save operations.
     * Uses FormUtils.getFormData for consistent field extraction.
     * 
     * @returns {object} Form data DTO
     */
    function collect() {
        var form = document.getElementById('character-form');
        if (!form) {
            return null;
        }

        // Use FormUtils.getFormData to extract all fields
        var data = FormUtils.getFormData(form);

        // Build the character DTO
        var dto = {
            firstName: data['char-firstName'] || '',
            lastName: data['char-lastName'] || '',
            middleName: data['char-middleName'] || '',
            nickname: data['char-nickname'] || '',
            alias: data['char-alias'] || '',
            gender: data['char-gender'] || '',
            birthYear: data['char-birthYear'] || '',
            eyes: data['char-eyes'] || '',
            hair: data['char-hair'] || '',
            skin: data['char-skin'] || '',
            height: data['char-height'] || '',
            weight: data['char-weight'] || '',
            build: data['char-build'] || '',
            appearanceNotes: data['char-appearanceNotes'] || '',
            specialty: data['char-specialty'] || '',
            attraction: data['char-attraction'] || '',
            sexuality: data['char-sexuality'] || '',
            notes: data['char-notes'] || '',

            graduatingClassId: data['char-graduatingClass'] || null,
            graduatingClassInstructor: data['char-isInstructor'] || false,

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

            stats: {}
        };

        // Collect stats
        STAT_KEYS.forEach(function(key) {
            var value = parseInt(data['char-stat-' + key], 10);
            dto.stats[key] = !isNaN(value) ? Math.max(STAT_MIN, Math.min(STAT_MAX, value)) : STAT_DEFAULT;
        });

        // Collect career status (JSON from textarea)
        var careerStatusRaw = data['char-careerStatus'] || '';
        if (careerStatusRaw) {
            try {
                var parsed = JSON.parse(careerStatusRaw);
                if (Array.isArray(parsed)) {
                    dto.careerStatus = parsed;
                }
            } catch (e) {
                // Invalid JSON - ignore
            }
        }

        // Collect class IDs (comma-separated)
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
    // SWITCH FORM TAB
    // ============================================================

    function switchTab(tab) {
        if (!tab || VALID_TABS.indexOf(tab) === -1) return;

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
    // EXPOSE
    // ============================================================

    window.CharacterForm = {
        render: render,
        hide: hide,
        collect: collect,
        switchTab: switchTab,
        getCurrentTab: function() { return state.currentTab; },
        isInitialized: function() { return _initialized; }
    };

    // Legacy compatibility
    window.showCharacterForm = function(editId) {
        render(editId);
    };

    window.hideCharacterForm = hide;

})();