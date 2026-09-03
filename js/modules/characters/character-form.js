/**
 * js/modules/characters/character-form.js - Character Form
 * Handles form rendering, tab switching, and form field population
 * Path: js/modules/characters/character-form.js
 */

(function() {
    'use strict';

    // ============================================================
    // STATE
    // ============================================================

    var state = {
        currentTab: 'name'
    };

    var VALID_TABS = ['name', 'physical', 'personality', 'academic', 'professional', 'stats', 'social', 'notes'];

    // ============================================================
    // CHARACTER FORM - Public API
    // ============================================================

    function showCharacterForm(editId) {
        if (!editId) {
            editId = window.getCurrentEditId ? window.getCurrentEditId() : null;
        }

        var char = null;
        if (editId) {
            char = window.getCharacterById(editId);
            if (!char) {
                showNotification('Character not found.', 'error');
                return;
            }
        }

        showFormModal(editId, char);
    }

    function showFormModal(editId, char) {
        var modal = document.getElementById('character-form-modal');
        if (!modal) {
            modal = createCharacterFormModal();
        }

        var title = document.getElementById('character-form-title');
        var content = document.getElementById('character-form-content');

        if (!title || !content) return;

        title.textContent = editId ? 'Edit Character' : 'Add Character';

        // Get current year for age calculation
        var currentYear = window.data && window.data.currentYear ? window.data.currentYear : new Date().getFullYear();

        var html = getCharacterFormHTML(char, editId, currentYear);
        content.innerHTML = html;

        // Populate class dropdown
        populateClassDropdown(char);

        // Populate form fields if editing
        if (char) {
            populateFormFields(char);
        }

        // Bind events
        bindFormEvents(modal, editId, char);

        modal.classList.remove('hidden');
        modal.style.display = 'flex';
    }

    // ============================================================
    // CREATE CHARACTER FORM MODAL
    // ============================================================

    function createCharacterFormModal() {
        var modal = document.createElement('div');
        modal.id = 'character-form-modal';
        modal.className = 'modal hidden';
        modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:none;align-items:center;justify-content:center;z-index:1000;';

        modal.innerHTML = `
            <div class="modal-content" style="max-width:650px;max-height:90vh;overflow-y:auto;background:var(--panel);border-radius:var(--radius);padding:20px;position:relative;">
                <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <h3 id="character-form-title" style="margin:0;font-size:1rem;">Add Character</h3>
                    <button class="close-modal" id="close-character-form" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-dim);">&times;</button>
                </div>
                <div class="modal-body">
                    <div id="character-form-content"></div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        return modal;
    }

    // ============================================================
    // CHARACTER FORM HTML
    // ============================================================

    function getCharacterFormHTML(char, editId, currentYear) {
        var tabs = getTabsHTML();
        var age = char && char.birthYear ? currentYear - parseInt(char.birthYear, 10) : '';

        return `
            <div class="character-form">
                <div class="form-tabs" style="display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:12px;">
                    ${tabs}
                </div>
                <div class="form-tab-content" id="form-tab-content">
                    ${getNameTabHTML(char, editId)}
                    ${getPhysicalTabHTML(char, age)}
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
        var classes = window.getGraduatingClasses ? window.getGraduatingClasses() : [];
        var html = '<option value="">None</option>';

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
            var isSelected = String(cls.id) === String(selectedId);
            html += `<option value="${escapeHtml(cls.id)}" ${isSelected ? 'selected' : ''}>${escapeHtml(cls.name)}</option>`;
        }

        return html;
    }

    function getCurrentYear() {
        return window.data && window.data.currentYear ? window.data.currentYear : new Date().getFullYear();
    }

    // ============================================================
    // PHYSICAL TAB - With Random Button
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

    // ============================================================
    // PERSONALITY TAB - With Random Button
    // ============================================================

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

    // ============================================================
    // OTHER TABS - Simplified (keep existing functionality)
    // ============================================================

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
        var magic = char && char.magic ? char.magic : {};

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
            html += `
                <div class="form-group">
                    <label style="font-size:0.7rem;color:var(--text-dim);">${statLabels[key]}</label>
                    <input type="number" id="char-stat-${key}" value="${stats[key] !== undefined ? stats[key] : 10}" min="1" max="50" style="width:100%;padding:6px 8px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;font-size:0.75rem;text-align:center;">
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

        var classes = window.getGraduatingClasses ? window.getGraduatingClasses() : [];
        var selectedId = char && char.graduatingClassId ? char.graduatingClassId : null;

        select.innerHTML = '<option value="">None</option>';

        for (var i = 0; i < classes.length; i++) {
            var cls = classes[i];
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

        // Stats
        if (char.stats) {
            for (var key in char.stats) {
                setFieldValue('char-stat-' + key, char.stats[key]);
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

    function bindFormEvents(modal, editId, char) {
        // Tab switching
        var tabBtns = modal.querySelectorAll('.form-tab-btn');
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

        // Random Physical
        var randomPhysicalBtn = document.getElementById('random-physical-btn');
        if (randomPhysicalBtn) {
            randomPhysicalBtn.addEventListener('click', function() {
                fillRandomPhysical();
            });
        }

        // Random Personality
        var randomPersonalityBtn = document.getElementById('random-personality-btn');
        if (randomPersonalityBtn) {
            randomPersonalityBtn.addEventListener('click', function() {
                fillRandomPersonality();
            });
        }

        // Random Stats
        var randomStatsBtn = document.getElementById('random-stats-btn');
        if (randomStatsBtn) {
            randomStatsBtn.addEventListener('click', function() {
                fillRandomStats();
            });
        }

        // Close buttons
        var closeBtn = document.getElementById('close-character-form');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                modal.classList.add('hidden');
                modal.style.display = 'none';
            });
        }

        var cancelBtn = document.getElementById('cancel-character-form');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function() {
                modal.classList.add('hidden');
                modal.style.display = 'none';
            });
        }

        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                this.classList.add('hidden');
                this.style.display = 'none';
            }
        });

        // Save
        var saveBtn = document.getElementById('save-character-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', function() {
                saveCharacter(editId);
            });
        }

        // Enter key on form
        var form = modal.querySelector('.character-form');
        if (form) {
            form.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
                    e.preventDefault();
                    saveCharacter(editId);
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

        // Update tab buttons
        var btns = document.querySelectorAll('.form-tab-btn');
        btns.forEach(function(btn) {
            var isActive = btn.dataset.tab === tab;
            btn.classList.toggle('active', isActive);
            btn.style.color = isActive ? 'var(--accent)' : 'var(--text-dim)';
            btn.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
        });

        // Update panels
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
            var val = 8 + Math.floor(Math.random() * 18); // 8-25 range
            setFieldValue('char-stat-' + statKeys[i], val);
        }
    }

    function randomChoice(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // ============================================================
    // SAVE CHARACTER
    // ============================================================

    function saveCharacter(editId) {
        // Gather basic fields
        var firstName = document.getElementById('char-firstName').value.trim();
        var lastName = document.getElementById('char-lastName').value.trim();

        if (!firstName || !lastName) {
            showNotification('First and last name are required.', 'error');
            return;
        }

        var data = {
            firstName: firstName,
            lastName: lastName,
            middleName: document.getElementById('char-middleName').value.trim(),
            nickname: document.getElementById('char-nickname').value.trim(),
            alias: document.getElementById('char-alias').value.trim(),
            gender: document.getElementById('char-gender').value.trim(),
            birthYear: document.getElementById('char-birthYear').value.trim(),
            eyes: document.getElementById('char-eyes').value.trim(),
            hair: document.getElementById('char-hair').value.trim(),
            skin: document.getElementById('char-skin').value.trim(),
            height: document.getElementById('char-height').value.trim(),
            weight: document.getElementById('char-weight').value.trim(),
            build: document.getElementById('char-build').value.trim(),
            appearanceNotes: document.getElementById('char-appearanceNotes').value.trim(),
            notes: document.getElementById('char-notes').value.trim(),
            specialty: document.getElementById('char-specialty').value.trim(),
            attraction: document.getElementById('char-attraction').value.trim(),
            sexuality: document.getElementById('char-sexuality').value.trim(),
            graduatingClassId: document.getElementById('char-graduatingClass').value || null,
            graduatingClassInstructor: document.getElementById('char-isInstructor').checked
        };

        // Personality
        data.personality = {
            traits: document.getElementById('char-personality-traits').value.trim(),
            ideals: document.getElementById('char-personality-ideals').value.trim(),
            bonds: document.getElementById('char-personality-bonds').value.trim(),
            flaws: document.getElementById('char-personality-flaws').value.trim(),
            alignment: document.getElementById('char-personality-alignment').value.trim(),
            likes: document.getElementById('char-personality-likes').value.trim(),
            dislikes: document.getElementById('char-personality-dislikes').value.trim(),
            habits: document.getElementById('char-personality-habits').value.trim(),
            fears: document.getElementById('char-personality-fears').value.trim(),
            goals: document.getElementById('char-personality-goals').value.trim()
        };

        // Stats
        data.stats = {};
        var statKeys = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        for (var i = 0; i < statKeys.length; i++) {
            var val = parseInt(document.getElementById('char-stat-' + statKeys[i]).value, 10) || 10;
            data.stats[statKeys[i]] = Math.max(1, Math.min(50, val));
        }

        // Career Status
        var careerStatusText = document.getElementById('char-careerStatus').value.trim();
        if (careerStatusText) {
            try {
                data.careerStatus = JSON.parse(careerStatusText);
                if (!Array.isArray(data.careerStatus)) {
                    data.careerStatus = [];
                }
            } catch (e) {
                showNotification('Invalid career status JSON. Please check the format.', 'error');
                return;
            }
        } else {
            data.careerStatus = [];
        }

        // Class IDs
        var classIdsText = document.getElementById('char-classIds').value.trim();
        if (classIdsText) {
            data.classIds = classIdsText.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        } else {
            data.classIds = [];
        }

        // Create or update
        var result;
        if (editId) {
            result = window.updateCharacter(editId, data);
        } else {
            result = window.createCharacter(data);
        }

        if (!result || !result.success) {
            showNotification(result && result.message ? result.message : 'Failed to save character.', 'error');
            return;
        }

        var modal = document.getElementById('character-form-modal');
        if (modal) {
            modal.classList.add('hidden');
            modal.style.display = 'none';
        }

        // Refresh the character list
        if (typeof window.renderCharacterList === 'function') {
            window.renderCharacterList();
        }

        if (typeof window.renderAll === 'function') {
            window.renderAll();
        }

        if (typeof window.saveData === 'function') {
            window.saveData()
                .then(function() {
                    showNotification(editId ? 'Character updated successfully.' : 'Character created successfully.', 'success');
                })
                .catch(function() {
                    showNotification('Character saved in memory, but persistence failed.', 'error');
                });
        } else {
            showNotification(editId ? 'Character updated successfully.' : 'Character created successfully.', 'success');
        }
    }

    // ============================================================
    // NOTIFICATION HELPER
    // ============================================================

    function showNotification(message, type) {
        type = type || 'info';
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }
        if (type === 'error') {
            alert('Error: ' + message);
        } else if (type === 'success') {
            alert(message);
        } else {
            console.log('[CharacterForm]', message);
        }
    }

    // ============================================================
    // HTML ESCAPING
    // ============================================================

    function escapeHtml(value) {
        if (value === undefined || value === null) {
            return '';
        }
        var str = String(value);
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.showCharacterForm = showCharacterForm;
    window.CharacterForm = {
        show: showCharacterForm,
        switchTab: switchFormTab,
        getCurrentTab: function() { return state.currentTab; }
    };

})();
