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
 *   - USES CharacterQueries for character data and display names
 *   - USES CharacterCRUD for save operations (which uses the mutation pipeline)
 *   - USES CharacterGenerator for random generation
 *   - USES CharacterConstants for canonical constants
 *   - USES NotificationSystem for notifications
 *   - USES DomUtils for safe DOM operations
 *   - No direct data mutation
 *   - No direct persistence calls
 *   - All user-controlled data is escaped using DomUtils.escapeHtml()
 * 
 * DEPENDENCIES:
 *   - window.CharacterQueries (from character-queries.js)
 *   - window.CharacterCRUD (from character-crud.js)
 *   - window.CharacterGenerator (from character-generator.js)
 *   - window.CharacterConstants (from character-constants.js)
 *   - window.NotificationSystem (from notification.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.getCurrentEditId (from index.js)
 *   - window.setCurrentEditId (from index.js)
 *   - window.getGraduatingClasses (from classes-core.js)
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
    var NotificationSystem = window.NotificationSystem;
    var DomUtils = window.DomUtils;
    var CC = window.CharacterConstants;

    // ============================================================
    // CONSTANTS - From CharacterConstants (MANDATORY)
    // ============================================================

    var STAT_MIN = CC.STAT_MIN;
    var STAT_MAX = CC.STAT_MAX;
    var STAT_DEFAULT = CC.STAT_DEFAULT;

    // ============================================================
    // STATE
    // ============================================================

    var state = {
        currentTab: 'name'
    };

    var VALID_TABS = ['name', 'physical', 'personality', 'academic', 'professional', 'stats', 'social', 'notes'];

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        var required = [
            { name: 'CharacterQueries', obj: CharacterQueries, methods: ['getCharacterById', 'getDisplayName'] },
            { name: 'CharacterCRUD', obj: CharacterCRUD, methods: ['save'] },
            { name: 'CharacterGenerator', obj: CharacterGenerator, methods: ['generatePhysical', 'generatePersonality', 'generateStats'] },
            { name: 'NotificationSystem', obj: NotificationSystem, methods: ['notify'] },
            { name: 'DomUtils', obj: DomUtils, methods: ['escapeHtml'] },
            { name: 'CharacterConstants', obj: CC, methods: [] },
            { name: 'window.getCurrentEditId', obj: window, methods: ['getCurrentEditId'] },
            { name: 'window.setCurrentEditId', obj: window, methods: ['setCurrentEditId'] }
        ];

        required.forEach(function(req) {
            if (!req.obj) {
                missing.push(req.name + ' (not loaded)');
                return;
            }
            if (req.methods) {
                req.methods.forEach(function(method) {
                    if (typeof req.obj[method] !== 'function') {
                        missing.push(req.name + '.' + method);
                    }
                });
            }
        });

        if (missing.length > 0) {
            console.warn('CharacterForm: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // NOTIFICATION - Uses NotificationSystem (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        NotificationSystem.notify(message, type);
    }

    // ============================================================
    // HTML ESCAPING - Delegates to DomUtils (SINGLE SOURCE OF TRUTH)
    // ============================================================

    function escapeHtml(value) {
        return DomUtils.escapeHtml(value);
    }

    // ============================================================
    // ENSURE FORM ELEMENTS EXIST
    // ============================================================

    function ensureFormElements() {
        var container = document.getElementById('character-form-container');
        if (!container) {
            console.warn('CharacterForm: Container #character-form-container not found');
            return null;
        }

        var form = document.getElementById('character-form');
        if (!form) {
            // Create the form if it doesn't exist
            form = document.createElement('form');
            form.id = 'character-form';
            form.style.display = 'none';
            
            // Header
            var header = document.createElement('div');
            header.className = 'form-header';
            header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;';
            
            var title = document.createElement('h3');
            title.id = 'form-title';
            title.textContent = 'No Character Selected';
            title.style.margin = '0';
            header.appendChild(title);
            
            var nameDisplay = document.createElement('span');
            nameDisplay.id = 'current-char-name';
            nameDisplay.className = 'char-name-display';
            nameDisplay.style.cssText = 'display:none;color:var(--accent);font-weight:600;';
            header.appendChild(nameDisplay);
            
            var actions = document.createElement('div');
            actions.className = 'form-actions';
            actions.style.cssText = 'display:flex;gap:4px;';
            
            var deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.id = 'delete-char-btn';
            deleteBtn.className = 'danger small';
            deleteBtn.textContent = 'Delete';
            actions.appendChild(deleteBtn);
            
            var saveBtn = document.createElement('button');
            saveBtn.type = 'submit';
            saveBtn.id = 'save-char-btn';
            saveBtn.className = 'primary';
            saveBtn.textContent = 'Save';
            actions.appendChild(saveBtn);
            
            header.appendChild(actions);
            form.appendChild(header);
            
            // Content
            var content = document.createElement('div');
            content.id = 'character-form-content';
            content.innerHTML = '<p class="empty-state">Select a character from the list to view and edit details.</p>';
            form.appendChild(content);
            
            container.appendChild(form);
        }

        var content = document.getElementById('character-form-content');
        if (!content) {
            content = document.createElement('div');
            content.id = 'character-form-content';
            content.innerHTML = '<p class="empty-state">Select a character from the list to view and edit details.</p>';
            form.appendChild(content);
        }

        return { form: form, content: content };
    }

    // ============================================================
    // CHARACTER FORM - Public API
    // ============================================================

    function showCharacterForm(editId) {
        if (!checkDependencies()) {
            showNotification('Dependencies not loaded. Please refresh the page.', 'error');
            return;
        }

        // Ensure form elements exist
        var elements = ensureFormElements();
        if (!elements) {
            showNotification('Form container not found. Please refresh the page.', 'error');
            return;
        }

        var form = elements.form;
        var content = elements.content;

        if (!editId) {
            editId = window.getCurrentEditId();
        }

        var char = null;
        if (editId) {
            char = CharacterQueries.getCharacterById(editId);
            if (!char) {
                showNotification('Character not found.', 'error');
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
        var html = getCharacterFormHTML(char, editId, currentYear);
        content.innerHTML = html;

        // Populate class dropdown
        populateClassDropdown(char);

        // Populate form fields if editing
        if (char) {
            populateFormFields(char);
        }

        // Bind events
        bindFormEvents(editId, char);

        // Show the form
        form.style.display = 'block';
    }

    /**
     * Hide the character form (clear selection).
     */
    function hideCharacterForm() {
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
    // GET CURRENT YEAR - From canonical source
    // ============================================================

    function getCurrentYear() {
        if (window.CalendarCore && typeof window.CalendarCore.getCurrentYear === 'function') {
            return window.CalendarCore.getCurrentYear();
        }
        // Fallback to window.data
        if (window.data && window.data.currentYear) {
            return window.data.currentYear;
        }
        // Emergency fallback - should never be reached
        return 1920;
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
        var classes = typeof window.getGraduatingClasses === 'function' 
            ? window.getGraduatingClasses() 
            : [];
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
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <span style="font-size:0.7rem;color:var(--text-dim);">Physical Appearance</span>
                    <button type="button" id="random-physical-btn" class="small" style="font-size:0.6rem;padding:2px 10px;">🎲 Random</button>
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

    function getPersonalityTabHTML(char) {
        var active = state.currentTab === 'personality' ? 'block' : 'none';
        var p = char && char.personality ? char.personality : {};

        return `
            <div class="tab-panel" data-tab="personality" style="display:${active};">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <span style="font-size:0.7rem;color:var(--text-dim);">Personality Traits</span>
                    <button type="button" id="random-personality-btn" class="small" style="font-size:0.6rem;padding:2px 10px;">🎲 Random</button>
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

    function getAcademicTabHTML(char) {
        var active = state.currentTab === 'academic' ? 'block' : 'none';
        var c = char || {};
        var classIds = Array.isArray(c.classIds) ? c.classIds : [];

        return `
            <div class="tab-panel" data-tab="academic" style="display:${active};">
                <div class="form-group">
                    <label style="font-size:0.7rem;color:var(--text-dim);">Class IDs</label>
                    <input type="text" id="char-classIds" value="${escapeHtml(classIds.join(', '))}" placeholder="Comma-separated class IDs" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                    <div style="font-size:0.6rem;color:var(--text-dim);margin-top:2px;">Use the dropdown above to assign graduating classes instead.</div>
                </div>
            </div>
        `;
    }

    function getProfessionalTabHTML(char) {
        var active = state.currentTab === 'professional' ? 'block' : 'none';
        var c = char || {};
        var careerStatus = Array.isArray(c.careerStatus) ? c.careerStatus : [];

        return `
            <div class="tab-panel" data-tab="professional" style="display:${active};">
                <div class="form-group">
                    <label style="font-size:0.7rem;color:var(--text-dim);">Career Status</label>
                    <textarea id="char-careerStatus" rows="3" placeholder='[{"status":"trainee","startYear":"1920","endYear":"1920"}]' style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;font-family:monospace;">${escapeHtml(JSON.stringify(careerStatus, null, 2))}</textarea>
                </div>
                <div class="form-group">
                    <label style="font-size:0.7rem;color:var(--text-dim);">Specialty</label>
                    <input type="text" id="char-specialty" value="${escapeHtml(c.specialty || '')}" placeholder="Area of expertise" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;">
                </div>
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

        var statLabels = {
            'str': 'Strength',
            'dex': 'Dexterity',
            'con': 'Constitution',
            'int': 'Intelligence',
            'wis': 'Wisdom',
            'cha': 'Charisma'
        };

        for (var key in statLabels) {
            if (!Object.prototype.hasOwnProperty.call(statLabels, key)) continue;
            var value = stats[key] !== undefined ? stats[key] : STAT_DEFAULT;
            html += `
                <div class="form-group">
                    <label style="font-size:0.7rem;color:var(--text-dim);">${statLabels[key]}</label>
                    <input type="number" id="char-stat-${key}" value="${value}" min="${STAT_MIN}" max="${STAT_MAX}" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;text-align:center;">
                </div>
            `;
        }

        html += `
                </div>
                <div style="margin-top:8px;display:flex;gap:8px;">
                    <button type="button" id="random-stats-btn" class="small" style="font-size:0.6rem;padding:2px 10px;">🎲 Random Stats</button>
                </div>
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
    // POPULATE CLASS DROPDOWN - Uses getGraduatingClasses
    // ============================================================

    function populateClassDropdown(char) {
        var select = document.getElementById('char-graduatingClass');
        if (!select) return;

        var classes = typeof window.getGraduatingClasses === 'function' 
            ? window.getGraduatingClasses() 
            : [];
        var selectedId = char && char.graduatingClassId ? char.graduatingClassId : null;

        select.innerHTML = '<option value="">None</option>';

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            if (!cls || typeof cls !== 'object') continue;
            var option = document.createElement('option');
            option.value = cls.id;
            option.textContent = cls.name;
            if (String(cls.id) === String(selectedId)) {
                option.selected = true;
            }
            select.appendChild(option);
        }
    }

    // ============================================================
    // POPULATE FORM FIELDS
    // ============================================================

    function populateFormFields(char) {
        if (!char) return;

        // Name fields
        setFieldValue('char-firstName', char.firstName);
        setFieldValue('char-lastName', char.lastName);
        setFieldValue('char-middleName', char.middleName);
        setFieldValue('char-nickname', char.nickname);
        setFieldValue('char-alias', char.alias);
        setFieldValue('char-gender', char.gender);
        setFieldValue('char-birthYear', char.birthYear);

        // Physical
        setFieldValue('char-eyes', char.eyes);
        setFieldValue('char-hair', char.hair);
        setFieldValue('char-skin', char.skin);
        setFieldValue('char-height', char.height);
        setFieldValue('char-weight', char.weight);
        setFieldValue('char-build', char.build);
        setFieldValue('char-appearanceNotes', char.appearanceNotes);

        // Personality
        if (char.personality) {
            setFieldValue('char-personality-traits', char.personality.traits);
            setFieldValue('char-personality-ideals', char.personality.ideals);
            setFieldValue('char-personality-bonds', char.personality.bonds);
            setFieldValue('char-personality-flaws', char.personality.flaws);
            setFieldValue('char-personality-alignment', char.personality.alignment);
            setFieldValue('char-personality-likes', char.personality.likes);
            setFieldValue('char-personality-dislikes', char.personality.dislikes);
            setFieldValue('char-personality-habits', char.personality.habits);
            setFieldValue('char-personality-fears', char.personality.fears);
            setFieldValue('char-personality-goals', char.personality.goals);
        }

        // Professional
        if (Array.isArray(char.careerStatus)) {
            setFieldValue('char-careerStatus', JSON.stringify(char.careerStatus, null, 2));
        }
        setFieldValue('char-specialty', char.specialty);

        // Social
        setFieldValue('char-attraction', char.attraction);
        setFieldValue('char-sexuality', char.sexuality);

        // Notes
        setFieldValue('char-notes', char.notes);

        // Class checkbox
        var checkbox = document.getElementById('char-isInstructor');
        if (checkbox) {
            checkbox.checked = char.graduatingClassInstructor || false;
        }

        // Stats - use STAT_DEFAULT for missing values
        if (char.stats) {
            for (var key in char.stats) {
                if (!Object.prototype.hasOwnProperty.call(char.stats, key)) continue;
                setFieldValue('char-stat-' + key, char.stats[key] !== undefined ? char.stats[key] : STAT_DEFAULT);
            }
        }

        // Class IDs
        if (Array.isArray(char.classIds)) {
            setFieldValue('char-classIds', char.classIds.join(', '));
        }
    }

    function setFieldValue(id, value) {
        var el = document.getElementById(id);
        if (el) {
            el.value = value !== undefined && value !== null ? value : '';
        }
    }

    // ============================================================
    // BIND FORM EVENTS
    // ============================================================

    function bindFormEvents(editId, char) {
        var formContainer = document.querySelector('.character-form-container');
        if (!formContainer) return;

        // Tab switching
        var tabBtns = formContainer.querySelectorAll('.form-tab-btn');
        tabBtns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                var tab = this.dataset.tab;
                if (tab) {
                    switchFormTab(tab);
                }
            });
        });

        // Birth year -> auto-calculate age
        var birthYearInput = document.getElementById('char-birthYear');
        var ageInput = document.getElementById('char-age');
        if (birthYearInput && ageInput) {
            birthYearInput.addEventListener('input', function() {
                var year = parseInt(this.value, 10);
                if (!isNaN(year)) {
                    var currentYear = getCurrentYear();
                    ageInput.value = currentYear - year;
                } else {
                    ageInput.value = '';
                }
            });
        }

        // Random Physical - Uses CharacterGenerator
        var randomPhysicalBtn = document.getElementById('random-physical-btn');
        if (randomPhysicalBtn) {
            randomPhysicalBtn.addEventListener('click', function() {
                fillRandomPhysical();
            });
        }

        // Random Personality - Uses CharacterGenerator
        var randomPersonalityBtn = document.getElementById('random-personality-btn');
        if (randomPersonalityBtn) {
            randomPersonalityBtn.addEventListener('click', function() {
                fillRandomPersonality();
            });
        }

        // Random Stats - Uses CharacterGenerator
        var randomStatsBtn = document.getElementById('random-stats-btn');
        if (randomStatsBtn) {
            randomStatsBtn.addEventListener('click', function() {
                fillRandomStats();
            });
        }

        // Cancel button - clear selection
        var cancelBtn = document.getElementById('cancel-character-form');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function() {
                window.setCurrentEditId(null);
                hideCharacterForm();
            });
        }

        // Save button - Uses CharacterCRUD
        var saveBtn = document.getElementById('save-character-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', function() {
                CharacterCRUD.save()
                    .then(function(success) {
                        if (success) {
                            var savedChar = CharacterQueries.getCharacterById(
                                window.getCurrentEditId()
                            );
                            if (savedChar) {
                                var nameDisplay = document.getElementById('current-char-name');
                                if (nameDisplay) {
                                    nameDisplay.textContent = CharacterQueries.getDisplayName(savedChar);
                                }
                            }
                        }
                    });
            });
        }

        // Enter key on form
        formContainer.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
                e.preventDefault();
                CharacterCRUD.save();
            }
        });
    }

    // ============================================================
    // SWITCH FORM TAB
    // ============================================================

    function switchFormTab(tab) {
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
    // RANDOM GENERATORS - Uses CharacterGenerator
    // ============================================================

    function fillRandomPhysical() {
        var physical = CharacterGenerator.generatePhysical();
        setFieldValue('char-eyes', physical.eyes);
        setFieldValue('char-hair', physical.hair);
        setFieldValue('char-skin', physical.skin);
        setFieldValue('char-height', physical.height);
        setFieldValue('char-weight', physical.weight);
        setFieldValue('char-build', physical.build);
    }

    function fillRandomPersonality() {
        var personality = CharacterGenerator.generatePersonality();
        setFieldValue('char-personality-traits', personality.traits);
        setFieldValue('char-personality-ideals', personality.ideals);
        setFieldValue('char-personality-bonds', personality.bonds);
        setFieldValue('char-personality-flaws', personality.flaws);
        setFieldValue('char-personality-alignment', personality.alignment);
        setFieldValue('char-personality-likes', personality.likes);
        setFieldValue('char-personality-dislikes', personality.dislikes);
        setFieldValue('char-personality-habits', personality.habits);
        setFieldValue('char-personality-fears', personality.fears);
        setFieldValue('char-personality-goals', personality.goals);
    }

    function fillRandomStats() {
        var stats = CharacterGenerator.generateStats();
        var statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        statKeys.forEach(function(key) {
            setFieldValue('char-stat-' + key, stats[key] !== undefined ? stats[key] : STAT_DEFAULT);
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.showCharacterForm = showCharacterForm;
    window.hideCharacterForm = hideCharacterForm;

    window.CharacterForm = {
        show: showCharacterForm,
        hide: hideCharacterForm,
        switchTab: switchFormTab,
        getCurrentTab: function() { return state.currentTab; }
    };

})();
