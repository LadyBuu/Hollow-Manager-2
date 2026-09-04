/**
 * js/modules/characters/character-form.js - Character Form
 * Handles form rendering, tab switching, and form field population
 * Path: js/modules/characters/character-form.js
 * 
 * IMPORTANT:
 *   - USES CharacterQueries for character data and display names
 *   - USES ClassesQueries for class-related data
 *   - USES DomUtils for safe DOM operations
 *   - Delegates save operations to CharacterCRUD
 *   - No direct data mutation or persistence calls
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterFormLoaded) {
        return;
    }
    window.__characterFormLoaded = true;

    // ============================================================
    // DEPENDENCY IMPORTS
    // ============================================================

    var CharacterQueries = window.CharacterQueries || window;
    var ClassesQueries = window.ClassesQueries || window;
    var CharacterCRUD = window.CharacterCRUD || window;
    var DomUtils = window.DomUtils || window;
    var NotificationSystem = window.NotificationSystem || window;
    var CC = window.CharacterConstants;

    // ============================================================
    // CONSTANTS
    // ============================================================

    var STAT_MIN = CC ? CC.STAT_MIN : 1;
    var STAT_MAX = CC ? CC.STAT_MAX : 50;
    var STAT_DEFAULT = CC ? CC.STAT_DEFAULT : 10;
    var MAGIC_MAX = CC ? CC.MAGIC_MAX : 10;
    var MAGIC_TYPE_KEYS = CC ? CC.MAGIC_TYPE_KEYS : [];

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
            'getCurrentEditId',
            'setCurrentEditId'
        ];

        required.forEach(function(name) {
            if (typeof window[name] !== 'function') {
                missing.push(name);
            }
        });

        if (!CharacterQueries || typeof CharacterQueries.getCharacterById !== 'function') {
            missing.push('CharacterQueries.getCharacterById');
        }
        if (!CharacterQueries || typeof CharacterQueries.getDisplayName !== 'function') {
            missing.push('CharacterQueries.getDisplayName');
        }

        if (!CharacterCRUD || typeof CharacterCRUD.save !== 'function') {
            missing.push('CharacterCRUD.save');
        }

        if (!DomUtils || typeof DomUtils.escapeHtml !== 'function') {
            missing.push('DomUtils.escapeHtml');
        }

        if (!NotificationSystem || typeof NotificationSystem.notify !== 'function') {
            missing.push('NotificationSystem.notify');
        }

        if (missing.length > 0) {
            console.warn('CharacterForm: Missing dependencies:', missing.join(', '));
            return false;
        }
        return true;
    }

    // ============================================================
    // NOTIFICATION
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        if (NotificationSystem && typeof NotificationSystem.notify === 'function') {
            NotificationSystem.notify(message, type);
        } else if (type === 'error') {
            alert('Error: ' + message);
        } else {
            alert(message);
        }
    }

    // ============================================================
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        if (DomUtils && typeof DomUtils.escapeHtml === 'function') {
            return DomUtils.escapeHtml(value);
        }
        if (value === undefined || value === null) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/`/g, '&#x60;');
    }

    // ============================================================
    // ENSURE FORM ELEMENTS EXIST
    // ============================================================

    /**
     * Ensure the character form and its content container exist.
     * Creates them if they don't exist.
     */
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
            // This should never happen if form was created above, but just in case
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
            editId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
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
        var currentYear = window.data && window.data.currentYear ? window.data.currentYear : new Date().getFullYear();

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

        // Trigger any post-render updates
        if (window.CharacterStatsView && typeof window.CharacterStatsView.updateClassSuggestion === 'function') {
            window.CharacterStatsView.updateClassSuggestion();
        }
        if (window.CharacterStatsView && typeof window.CharacterStatsView.updateMagicClassSuggestion === 'function') {
            window.CharacterStatsView.updateMagicClassSuggestion();
        }
        if (window.CharacterStatsView && typeof window.CharacterStatsView.updateMagicPowerDisplay === 'function') {
            window.CharacterStatsView.updateMagicPowerDisplay();
        }
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
                    <button type="button" id="save-character-btn" class="primary" style="font-size:0.75rem;padding:6px 12px;">${editId ? 'Update' : 'Create'} Character</button>
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
    // NAME TAB
    // ============================================================

    function getNameTabHTML(char, editId) {
        var active = state.currentTab === 'name' ? 'block' : 'none';
        var c = char || {};
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

    function getCurrentYear() {
        return window.data && window.data.currentYear ? window.data.currentYear : new Date().getFullYear();
    }

    // ============================================================
    // OTHER TABS
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
        var stats = char && char.stats ? char.stats : { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };

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
            html += `
                <div class="form-group">
                    <label style="font-size:0.7rem;color:var(--text-dim);">${statLabels[key]}</label>
                    <input type="number" id="char-stat-${key}" value="${stats[key] !== undefined ? stats[key] : 10}" min="${STAT_MIN}" max="${STAT_MAX}" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;text-align:center;">
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
    // POPULATE CLASS DROPDOWN
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

        setFieldValue('char-firstName', char.firstName);
        setFieldValue('char-lastName', char.lastName);
        setFieldValue('char-middleName', char.middleName);
        setFieldValue('char-nickname', char.nickname);
        setFieldValue('char-alias', char.alias);
        setFieldValue('char-gender', char.gender);
        setFieldValue('char-birthYear', char.birthYear);

        setFieldValue('char-eyes', char.eyes);
        setFieldValue('char-hair', char.hair);
        setFieldValue('char-skin', char.skin);
        setFieldValue('char-height', char.height);
        setFieldValue('char-weight', char.weight);
        setFieldValue('char-build', char.build);
        setFieldValue('char-appearanceNotes', char.appearanceNotes);

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

        if (Array.isArray(char.careerStatus)) {
            setFieldValue('char-careerStatus', JSON.stringify(char.careerStatus, null, 2));
        }
        setFieldValue('char-specialty', char.specialty);

        setFieldValue('char-attraction', char.attraction);
        setFieldValue('char-sexuality', char.sexuality);

        setFieldValue('char-notes', char.notes);

        var checkbox = document.getElementById('char-isInstructor');
        if (checkbox) {
            checkbox.checked = char.graduatingClassInstructor || false;
        }

        if (char.stats) {
            for (var key in char.stats) {
                if (!Object.prototype.hasOwnProperty.call(char.stats, key)) continue;
                setFieldValue('char-stat-' + key, char.stats[key]);
            }
        }

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
        // Tab switching
        var tabBtns = document.querySelectorAll('.form-tab-btn');
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

        // Random buttons
        var randomPhysicalBtn = document.getElementById('random-physical-btn');
        if (randomPhysicalBtn) {
            randomPhysicalBtn.addEventListener('click', fillRandomPhysical);
        }

        var randomPersonalityBtn = document.getElementById('random-personality-btn');
        if (randomPersonalityBtn) {
            randomPersonalityBtn.addEventListener('click', fillRandomPersonality);
        }

        var randomStatsBtn = document.getElementById('random-stats-btn');
        if (randomStatsBtn) {
            randomStatsBtn.addEventListener('click', fillRandomStats);
        }

        // Cancel button
        var cancelBtn = document.getElementById('cancel-character-form');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function() {
                if (typeof window.setCurrentEditId === 'function') {
                    window.setCurrentEditId(null);
                }
                hideCharacterForm();
            });
        }

        // Save button
        var saveBtn = document.getElementById('save-character-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', function() {
                if (CharacterCRUD && typeof CharacterCRUD.save === 'function') {
                    CharacterCRUD.save()
                        .then(function(success) {
                            if (success) {
                                var savedChar = CharacterQueries.getCharacterById(
                                    typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null
                                );
                                if (savedChar) {
                                    var nameDisplay = document.getElementById('current-char-name');
                                    if (nameDisplay) {
                                        nameDisplay.textContent = CharacterQueries.getDisplayName(savedChar);
                                    }
                                }
                            }
                        });
                } else {
                    showNotification('Save functionality not available.', 'error');
                }
            });
        }

        // Enter key
        var formContainer = document.querySelector('.character-form-container');
        if (formContainer) {
            formContainer.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
                    e.preventDefault();
                    if (CharacterCRUD && typeof CharacterCRUD.save === 'function') {
                        CharacterCRUD.save();
                    }
                }
            });
        }
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
    // RANDOM GENERATORS
    // ============================================================

    function fillRandomPhysical() {
        var eyes = ['Blue', 'Brown', 'Green', 'Grey', 'Hazel', 'Amber', 'Violet', 'Black', 'Honey'];
        var hair = ['Blonde', 'Brown', 'Black', 'Red', 'Auburn', 'Chestnut', 'Silver', 'White', 'Platinum', 'Honey'];
        var skin = ['Fair', 'Olive', 'Light Brown', 'Dark Brown', 'Pale', 'Tan', 'Ebony', 'Porcelain'];
        var heights = ['165', '170', '175', '180', '185', '190', '160', '167', '172', '178', '182', '188'];
        var builds = ['Slim', 'Athletic', 'Broad', 'Stocky', 'Lithe', 'Muscular', 'Willowy', 'Compact', 'Heavy'];

        setFieldValue('char-eyes', randomChoice(eyes));
        setFieldValue('char-hair', randomChoice(hair));
        setFieldValue('char-skin', randomChoice(skin));
        setFieldValue('char-height', randomChoice(heights));
        setFieldValue('char-build', randomChoice(builds));
        setFieldValue('char-weight', (60 + Math.floor(Math.random() * 40)) + 'kg');
    }

    function fillRandomPersonality() {
        var traits = [
            'Brave, Honest, Loyal', 'Cunning, Ambitious, Charming', 'Wise, Patient, Kind',
            'Fierce, Proud, Determined', 'Quiet, Observant, Clever', 'Bold, Reckless, Passionate',
            'Calm, Collected, Strategic', 'Playful, Curious, Optimistic', 'Gruff, Loyal, Protective',
            'Elegant, Diplomatic, Calculating', 'Wild, Free-spirited, Intuitive', 'Stoic, Disciplined, Focused'
        ];

        var ideals = [
            'Honor and Duty', 'Freedom and Choice', 'Knowledge and Truth',
            'Justice and Fairness', 'Power and Ambition', 'Peace and Harmony',
            'Tradition and Order', 'Change and Progress', 'Loyalty and Family'
        ];

        var bonds = [
            'Protecting their family', 'A childhood friend', 'Their homeland',
            'A mentor who saved them', 'A sacred oath', 'Their closest ally',
            'A lost loved one', 'Their honor', 'A promise made'
        ];

        var flaws = [
            'Too trusting', 'Quick to anger', 'Afraid of failure',
            'Reckless in pursuit of goals', 'Too proud to ask for help',
            'Haunted by a past mistake', 'Perfectionist', 'Distrustful of others'
        ];

        var alignments = [
            'Lawful Good', 'Neutral Good', 'Chaotic Good',
            'Lawful Neutral', 'True Neutral', 'Chaotic Neutral',
            'Lawful Evil', 'Neutral Evil', 'Chaotic Evil'
        ];

        setFieldValue('char-personality-traits', randomChoice(traits));
        setFieldValue('char-personality-ideals', randomChoice(ideals));
        setFieldValue('char-personality-bonds', randomChoice(bonds));
        setFieldValue('char-personality-flaws', randomChoice(flaws));
        setFieldValue('char-personality-alignment', randomChoice(alignments));
        setFieldValue('char-personality-likes', randomChoice(['Music', 'Books', 'Nature', 'Art', 'Animals', 'Good Food', 'Stories', 'Games']));
        setFieldValue('char-personality-dislikes', randomChoice(['Lies', 'Cruelty', 'Arrogance', 'Crowds', 'Loud Noises', 'Injustice', 'Boredom']));
        setFieldValue('char-personality-habits', randomChoice(['Hums while working', 'Taps fingers when thinking', 'Collects small trinkets', 'Talks to themselves', 'Fidgets with a lucky charm']));
        setFieldValue('char-personality-fears', randomChoice(['Heights', 'Spiders', 'Claustrophobia', 'Being forgotten', 'Failure', 'Loss of control']));
        setFieldValue('char-personality-goals', randomChoice(['To protect the innocent', 'To achieve greatness', 'To find purpose', 'To restore honor', 'To discover truth', 'To build something lasting']));
    }

    function fillRandomStats() {
        var statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        for (var i = 0; i < statKeys.length; i++) {
            var val = 8 + Math.floor(Math.random() * 18);
            setFieldValue('char-stat-' + statKeys[i], val);
        }
    }

    function randomChoice(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
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
