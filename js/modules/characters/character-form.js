/**
 * js/modules/characters/character-form.js - Character Form
 * Handles form rendering, tab switching, and form field population
 * Path: js/modules/characters/character-form.js
 * 
 * This module is responsible for:
 *   - Rendering the character form with all tabs
 *   - Switching between tabs (with lazy view rendering)
 *   - Populating form fields from character data
 *   - Resetting form fields for new characters
 *   - Managing class tags in the form
 * 
 * IMPORTANT:
 *   - This module is for RENDERING only - all event binding is in character-events.js
 *   - State is managed via window.getCurrentEditId() (read-only for this module)
 *   - All user-controlled data is inserted using safe DOM APIs (textContent, value)
 *   - DOM operations are safe and defensive
 *   - Re-initialization is supported after DOM replacement
 *   - State mutation (setCurrentEditId) is owned by index.js, not this module
 *   - Lazy rendering: views are only rendered when their tab is first activated
 * 
 * DEPENDENCIES:
 *   - window.CharacterViews
 *   - window.CharacterEliminations
 *   - window.CharacterClasses
 *   - window.CharacterStats (for domain logic)
 *   - window.CharacterStatsView (for rendering)
 *   - window.CharacterList
 *   - window.getCharacterById (from core-utils.js)
 *   - window.getDisplayName (from core-utils.js)
 *   - window.getCurrentEditId (from index.js)
 *   - window.CharacterConstants (from character-constants.js)
 *   - window.DomUtils (from dom-utils.js)
 *   - window.CoreUtils (from core-utils.js)
 */

(function() {
    'use strict';

    // Guard against duplicate script loading
    if (window.__characterFormLoaded) {
        return;
    }
    window.__characterFormLoaded = true;

    // ============================================================
    // CONSTANTS - From CharacterConstants
    // ============================================================

    var VALID_TABS = ['name', 'physical', 'personality', 'academic', 'professional', 'stats', 'social', 'notes'];

    var MAGIC_TYPE_KEYS = window.CharacterConstants
        ? window.CharacterConstants.MAGIC_TYPE_KEYS
        : [];

    var STAT_KEYS = window.CharacterConstants
        ? window.CharacterConstants.STAT_KEYS
        : ['str', 'dex', 'con', 'int', 'wis', 'cha'];

    var STAT_DEFAULT = window.CharacterConstants
        ? window.CharacterConstants.STAT_DEFAULT
        : 10;

    // ============================================================
    // DEPENDENCY CHECK
    // ============================================================

    function checkDependencies() {
        var missing = [];

        var required = [
            'getCharacterById',
            'getDisplayName',
            'getCurrentEditId'
        ];

        required.forEach(function(name) {
            if (typeof window[name] !== 'function') {
                missing.push(name);
            }
        });

        // Feature modules
        var featureModules = {
            'CharacterViews': ['renderAcademic', 'renderProfessional', 'renderSocial', 'addCareerStatusEntry'],
            'CharacterEliminations': ['renderTournament', 'renderStandalone'],
            'CharacterClasses': ['populateClassTags', 'clearClassTags', 'populateAcademicClassSelector', 'updateCurrentClassesDisplay'],
            'CharacterStats': ['getCharacterStats', 'getCharacterMagic', 'getSpecialMoves'],
            'CharacterStatsView': ['renderSpecialMoves'],
            'CharacterList': ['render']
        };

        for (var moduleName in featureModules) {
            if (typeof window[moduleName] === 'undefined' || window[moduleName] === null) {
                missing.push(moduleName + ' (module missing)');
                continue;
            }
            var methods = featureModules[moduleName];
            for (var i = 0; i < methods.length; i++) {
                if (typeof window[moduleName][methods[i]] !== 'function') {
                    missing.push(moduleName + '.' + methods[i]);
                }
            }
        }

        if (missing.length > 0) {
            console.warn('CharacterForm: Missing dependencies:', missing.join(', '));
            return false;
        }

        return true;
    }

    // ============================================================
    // STATE
    // ============================================================

    // Track which views have been rendered to support lazy rendering
    var _renderedViews = {
        academic: false,
        professional: false,
        social: false
    };

    // ============================================================
    // EMPTY STATE HELPER
    // ============================================================

    function setEmptyState(container, text, padding, fontSize) {
        if (!container) return;

        container.replaceChildren();

        var empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.style.padding = padding || '8px';
        empty.style.fontSize = fontSize || '0.8rem';
        empty.textContent = text || 'None';

        container.appendChild(empty);
    }

    // ============================================================
    // TAB SWITCHING - With lazy view rendering
    // ============================================================

    function switchTab(tab) {
        if (VALID_TABS.indexOf(tab) === -1) {
            return;
        }

        var tabBtns = document.querySelectorAll('.char-tab-btn');
        tabBtns.forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        var panels = document.querySelectorAll('.char-tab-panel');
        panels.forEach(function(panel) {
            var panelId = panel.id.replace('char-tab-', '');
            panel.style.display = panelId === tab ? 'block' : 'none';
            panel.classList.toggle('active', panelId === tab);
        });

        // Lazy render tab-specific content
        var id = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;
        if (id) {
            var char = typeof window.getCharacterById === 'function' ? window.getCharacterById(id) : null;
            if (char) {
                if (tab === 'academic' && !_renderedViews.academic) {
                    _renderedViews.academic = true;
                    if (window.CharacterViews && typeof window.CharacterViews.renderAcademic === 'function') {
                        window.CharacterViews.renderAcademic(char);
                    }
                } else if (tab === 'professional' && !_renderedViews.professional) {
                    _renderedViews.professional = true;
                    if (window.CharacterViews && typeof window.CharacterViews.renderProfessional === 'function') {
                        window.CharacterViews.renderProfessional(char);
                    }
                } else if (tab === 'social' && !_renderedViews.social) {
                    _renderedViews.social = true;
                    if (window.CharacterViews && typeof window.CharacterViews.renderSocial === 'function') {
                        window.CharacterViews.renderSocial(char);
                    }
                }
            }
        }
    }

    // ============================================================
    // SHOW CHARACTER IN FORM
    // ============================================================

    function show(editId) {
        if (!checkDependencies()) return;

        var form = document.getElementById('character-form');
        var title = document.getElementById('form-title');
        var nameDisplay = document.getElementById('current-char-name');

        if (!form) {
            console.warn('CharacterForm: Form #character-form not found');
            return;
        }

        // Handle invalid editId - clear form state
        if (editId !== null && editId !== undefined && editId !== '') {
            var char = typeof window.getCharacterById === 'function' 
                ? window.getCharacterById(editId) 
                : null;
            
            if (!char) {
                if (title) title.textContent = 'Character not found';
                resetFormFields();
                return;
            }

            // Reset view render state for this character
            _renderedViews.academic = false;
            _renderedViews.professional = false;
            _renderedViews.social = false;

            if (title) title.textContent = 'Edit Character';
            if (nameDisplay) {
                nameDisplay.textContent = typeof window.getDisplayName === 'function'
                    ? window.getDisplayName(char)
                    : char.firstName || '';
            }

            // Switch to name tab (this will lazy render the active view)
            switchTab('name');

            populateFormFields(char);

            // Refresh character list to reflect selection
            if (window.CharacterList && typeof window.CharacterList.render === 'function') {
                window.CharacterList.render();
            }
        } else {
            // New character - reset view render state
            _renderedViews.academic = false;
            _renderedViews.professional = false;
            _renderedViews.social = false;

            switchTab('name');

            if (title) title.textContent = 'New Character';
            if (nameDisplay) nameDisplay.textContent = 'New Character';

            resetFormFields();

            if (window.CharacterList && typeof window.CharacterList.render === 'function') {
                window.CharacterList.render();
            }
        }

        form.style.display = 'block';
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ============================================================
    // POPULATE FORM FIELDS
    // ============================================================

    function populateFormFields(char) {
        if (!char) return;

        // Name tab
        setFieldValue('char-firstname', char.firstName);
        setFieldValue('char-middlename', char.middleName);
        setFieldValue('char-lastname', char.lastName);
        setFieldValue('char-nickname', char.nickname);
        setFieldValue('char-alias', char.alias);
        setFieldValue('char-previous-names', (char.previousNames || []).join(', '));
        setFieldValue('char-name-format', char.nameFormat || 'firstlast');
        setFieldValue('char-birthyear', char.birthYear);
        setCheckbox('char-deceased', char.deceased);
        setFieldValue('char-death-year', char.deathYear);
        setFieldValue('char-death-cause', char.deathCause);
        setFieldValue('char-death-age', char.deathAge);
        setFieldValue('char-death-week', char.deathWeek);

        var deathFields = document.getElementById('death-fields');
        if (deathFields) {
            deathFields.style.display = char.deceased ? 'block' : 'none';
        }

        // Physical tab
        setFieldValue('char-gender', char.gender);
        setFieldValue('char-eyes', char.eyes);
        setFieldValue('char-hair', char.hair);
        setFieldValue('char-skin', char.skin);
        setFieldValue('char-height', char.height);
        setFieldValue('char-weight', char.weight);
        setFieldValue('char-build', char.build);
        setFieldValue('char-appearance-notes', char.appearanceNotes);

        // Personality tab
        var p = char.personality || {};
        setFieldValue('char-traits', p.traits);
        setFieldValue('char-ideals', p.ideals);
        setFieldValue('char-bonds', p.bonds);
        setFieldValue('char-flaws', p.flaws);
        setFieldValue('char-alignment', p.alignment);
        setFieldValue('char-likes', p.likes);
        setFieldValue('char-dislikes', p.dislikes);
        setFieldValue('char-habits', p.habits);
        setFieldValue('char-fears', p.fears);
        setFieldValue('char-goals', p.goals);

        // Stats tab
        var stats = window.CharacterStats && typeof window.CharacterStats.getCharacterStats === 'function' 
            ? window.CharacterStats.getCharacterStats(char) 
            : char.stats || {};
        STAT_KEYS.forEach(function(key) {
            setFieldValue('char-' + key, stats[key]);
        });

        // Magic stats
        var magic = window.CharacterStats && typeof window.CharacterStats.getCharacterMagic === 'function'
            ? window.CharacterStats.getCharacterMagic(char)
            : char.magic || {};
        MAGIC_TYPE_KEYS.forEach(function(key) {
            var input = document.getElementById('magic-' + key);
            if (input) {
                input.value = magic[key] !== undefined ? magic[key] : 0;
            }
        });

        // Special moves
        var moves = window.CharacterStats && typeof window.CharacterStats.getSpecialMoves === 'function'
            ? window.CharacterStats.getSpecialMoves(char)
            : char.specialMoves || { physical: [], magical: [] };
        
        if (window.CharacterStatsView && typeof window.CharacterStatsView.renderSpecialMoves === 'function') {
            window.CharacterStatsView.renderSpecialMoves('physical-moves-list', moves.physical || [], 'physical');
            window.CharacterStatsView.renderSpecialMoves('magical-moves-list', moves.magical || [], 'magical');
        }

        // Career status
        var statusContainer = document.getElementById('career-status-container');
        if (statusContainer) {
            statusContainer.replaceChildren();
            if (char.careerStatus && char.careerStatus.length > 0) {
                char.careerStatus.forEach(function(status) {
                    if (window.CharacterViews && typeof window.CharacterViews.addCareerStatusEntry === 'function') {
                        window.CharacterViews.addCareerStatusEntry(
                            statusContainer, 
                            status.status, 
                            status.startYear, 
                            status.endYear
                        );
                    }
                });
            } else if (window.CharacterViews && typeof window.CharacterViews.addCareerStatusEntry === 'function') {
                window.CharacterViews.addCareerStatusEntry(statusContainer);
            }
        }

        // Professional tab
        setFieldValue('char-specialty', char.specialty);

        // Class tags
        if (window.CharacterClasses && typeof window.CharacterClasses.populateClassTags === 'function') {
            window.CharacterClasses.populateClassTags(char.classIds || []);
        }

        // Academic class selector
        if (window.CharacterClasses && typeof window.CharacterClasses.populateAcademicClassSelector === 'function') {
            window.CharacterClasses.populateAcademicClassSelector(char);
        }

        // Current classes display
        if (window.CharacterClasses && typeof window.CharacterClasses.updateCurrentClassesDisplay === 'function') {
            window.CharacterClasses.updateCurrentClassesDisplay(char);
        }

        // Eliminations
        if (window.CharacterEliminations && typeof window.CharacterEliminations.renderTournament === 'function') {
            window.CharacterEliminations.renderTournament(char);
        }
        if (window.CharacterEliminations && typeof window.CharacterEliminations.renderStandalone === 'function') {
            window.CharacterEliminations.renderStandalone(char);
        }

        // Notes
        setFieldValue('char-notes', char.notes);
    }

    // ============================================================
    // RESET FORM FIELDS - DOM only, no state mutation
    // ============================================================

    function resetFormFields() {
        var inputs = document.querySelectorAll('#character-form input, #character-form textarea, #character-form select');
        
        // Stat keys for special handling
        var statMap = {};
        STAT_KEYS.forEach(function(key) {
            statMap['char-' + key] = key;
        });

        inputs.forEach(function(input) {
            if (input.type === 'checkbox') {
                input.checked = false;
                return;
            }

            // Check if this is a stat input
            var statKey = statMap[input.id];
            if (statKey) {
                var defaultVal = STAT_DEFAULT;
                if (window.CharacterStats && typeof window.CharacterStats.getDefaultStats === 'function') {
                    var defaults = window.CharacterStats.getDefaultStats();
                    if (defaults && defaults[statKey] !== undefined && defaults[statKey] !== null) {
                        defaultVal = defaults[statKey];
                    }
                }
                input.value = defaultVal;
                return;
            }

            // Special case: standalone elim week
            if (input.id === 'standalone-elim-week') {
                input.value = '1';
                return;
            }

            // Everything else: empty string
            input.value = '';
        });

        // Explicitly restore name format default
        var nameFormat = document.getElementById('char-name-format');
        if (nameFormat) {
            nameFormat.value = 'firstlast';
        }

        // Reset magic inputs to 0
        MAGIC_TYPE_KEYS.forEach(function(key) {
            var input = document.getElementById('magic-' + key);
            if (input) input.value = 0;
        });

        // Reset death fields
        var deathFields = document.getElementById('death-fields');
        if (deathFields) deathFields.style.display = 'none';

        // Reset career status
        var statusContainer = document.getElementById('career-status-container');
        if (statusContainer) {
            statusContainer.replaceChildren();
            if (window.CharacterViews && typeof window.CharacterViews.addCareerStatusEntry === 'function') {
                window.CharacterViews.addCareerStatusEntry(statusContainer);
            }
        }

        // Reset class tags
        if (window.CharacterClasses && typeof window.CharacterClasses.clearClassTags === 'function') {
            window.CharacterClasses.clearClassTags();
        }

        // Reset class selector - use DOM APIs for consistency
        var classSelect = document.getElementById('academic-class-select');
        if (classSelect) {
            classSelect.replaceChildren();
            var option = document.createElement('option');
            option.value = '';
            option.textContent = 'Select a class...';
            classSelect.appendChild(option);
        }

        // Reset current classes display
        var classesDisplay = document.getElementById('current-classes-list');
        if (classesDisplay) classesDisplay.textContent = 'None';

        // Reset eliminations views
        setEmptyState(
            document.getElementById('tournament-eliminations-view'),
            'None',
            '6px',
            '0.75rem'
        );

        setEmptyState(
            document.getElementById('standalone-eliminations-container'),
            'None',
            '6px',
            '0.75rem'
        );

        // Reset social view
        setEmptyState(
            document.getElementById('social-view'),
            'Save character to view social connections',
            '8px',
            '0.8rem'
        );

        // Reset academic/professional views
        setEmptyState(
            document.getElementById('academic-view'),
            'Save character to view academic data',
            '8px',
            '0.8rem'
        );

        setEmptyState(
            document.getElementById('professional-view'),
            'Save character to view professional data',
            '8px',
            '0.8rem'
        );

        // Reset special moves
        setEmptyState(
            document.getElementById('physical-moves-list'),
            'None',
            '4px',
            '0.7rem'
        );

        setEmptyState(
            document.getElementById('magical-moves-list'),
            'None',
            '4px',
            '0.7rem'
        );

        // Reset view render state
        _renderedViews.academic = false;
        _renderedViews.professional = false;
        _renderedViews.social = false;
    }

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    function setFieldValue(id, value) {
        var el = document.getElementById(id);
        if (el) {
            el.value = value !== undefined && value !== null ? value : '';
        }
    }

    function setCheckbox(id, checked) {
        var el = document.getElementById(id);
        if (el) {
            el.checked = !!checked;
        }
    }

    // ============================================================
    // GET CURRENT TAB (for external use)
    // ============================================================

    function getCurrentTab() {
        var activeBtn = document.querySelector('.char-tab-btn.active');
        return activeBtn ? activeBtn.dataset.tab : 'name';
    }

    // ============================================================
    // TAB HTML GENERATORS
    // ============================================================

    function getTabsHTML() {
        return `
            <div class="char-tabs">
                <button type="button" class="char-tab-btn active" data-tab="name">Name</button>
                <button type="button" class="char-tab-btn" data-tab="physical">Physical</button>
                <button type="button" class="char-tab-btn" data-tab="personality">Personality</button>
                <button type="button" class="char-tab-btn" data-tab="academic">Academic</button>
                <button type="button" class="char-tab-btn" data-tab="professional">Professional</button>
                <button type="button" class="char-tab-btn" data-tab="stats">Stats</button>
                <button type="button" class="char-tab-btn" data-tab="social">Social</button>
                <button type="button" class="char-tab-btn" data-tab="notes">Notes</button>
            </div>
            ${getNameTabHTML()}
            ${getPhysicalTabHTML()}
            ${getPersonalityTabHTML()}
            ${getAcademicTabHTML()}
            ${getProfessionalTabHTML()}
            ${getStatsTabHTML()}
            ${getSocialTabHTML()}
            ${getNotesTabHTML()}
        `;
    }

    function getNameTabHTML() {
        return `
            <div id="char-tab-name" class="char-tab-panel active">
                <div class="form-grid">
                    <div class="form-group">
                        <label>First Name *</label>
                        <input type="text" id="char-firstname" required />
                    </div>
                    <div class="form-group">
                        <label>Middle Name</label>
                        <input type="text" id="char-middlename" />
                    </div>
                    <div class="form-group">
                        <label>Last Name *</label>
                        <input type="text" id="char-lastname" required />
                    </div>
                    <div class="form-group">
                        <label>Nickname</label>
                        <input type="text" id="char-nickname" placeholder="e.g., Ben" />
                    </div>
                    <div class="form-group">
                        <label>Alias</label>
                        <input type="text" id="char-alias" placeholder="e.g., The Shadow" />
                    </div>
                    <div class="form-group full-width">
                        <label>Previous Names (comma separated)</label>
                        <input type="text" id="char-previous-names" placeholder="e.g., John Smith, Jonathan Doe" />
                    </div>
                    <div class="form-group">
                        <label>Display Name Format</label>
                        <select id="char-name-format">
                            <option value="firstlast">First + Last</option>
                            <option value="lastfirst">Last, First</option>
                            <option value="nicklast">Nickname + Last</option>
                            <option value="firstnick">First "Nickname"</option>
                            <option value="alias">Alias</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Year of Birth</label>
                        <input type="number" id="char-birthyear" />
                    </div>
                    <div class="form-group full-width section-divider">
                        <div class="deceased-toggle">
                            <input type="checkbox" id="char-deceased" />
                            <label for="char-deceased" class="deceased-label">Mark as Deceased</label>
                        </div>
                        <div id="death-fields" class="death-fields" style="display:none;">
                            <div class="form-group"><label>Year of Death</label><input type="number" id="char-death-year" placeholder="e.g., 2023" /></div>
                            <div class="form-group"><label>Death Age</label><input type="number" id="char-death-age" min="0" max="150" placeholder="e.g., 45" /></div>
                            <div class="form-group"><label>Death Week (1-52)</label><input type="number" id="char-death-week" min="1" max="52" placeholder="e.g., 24" /></div>
                            <div class="form-group full-width"><label>Cause of Death</label><input type="text" id="char-death-cause" /></div>
                        </div>
                    </div>
                    <div class="form-group full-width section-divider">
                        <label>Classes</label>
                        <div id="class-tag-container" style="display:flex;flex-wrap:wrap;gap:4px;padding:4px;background:var(--panel-alt);border:1px solid var(--border);border-radius:6px;min-height:36px;">
                            <span style="color:var(--text-dim);font-size:0.7rem;padding:4px;">No classes assigned</span>
                        </div>
                        <input type="text" id="class-tag-input" placeholder="Type class name and press Enter..." style="width:100%;padding:4px 6px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;margin-top:4px;font-size:0.7rem;">
                        <span style="font-size:0.6rem;color:var(--text-dim);">Press Enter to add a class. Click ✕ on a tag to remove it.</span>
                    </div>
                </div>
            </div>
        `;
    }

    function getPhysicalTabHTML() {
        return `
            <div id="char-tab-physical" class="char-tab-panel" style="display:none;">
                <div class="form-grid">
                    <div class="form-group">
                        <label>Gender</label>
                        <input type="text" id="char-gender" placeholder="Male/Female/Other" />
                    </div>
                    <div class="form-group">
                        <label>Eye Color</label>
                        <input type="text" id="char-eyes" placeholder="Blue, Green, Brown..." />
                    </div>
                    <div class="form-group">
                        <label>Hair Color</label>
                        <input type="text" id="char-hair" placeholder="Blonde, Black, Red..." />
                    </div>
                    <div class="form-group">
                        <label>Skin Color/Tone</label>
                        <input type="text" id="char-skin" placeholder="Fair, Olive, Dark..." />
                    </div>
                    <div class="form-group">
                        <label>Height</label>
                        <input type="text" id="char-height" placeholder="e.g., 5'10\"" />
                    </div>
                    <div class="form-group">
                        <label>Weight</label>
                        <input type="text" id="char-weight" placeholder="e.g., 75kg" />
                    </div>
                    <div class="form-group">
                        <label>Build</label>
                        <input type="text" id="char-build" placeholder="Slim, Athletic..." />
                    </div>
                    <div class="form-group full-width">
                        <label>Appearance Notes</label>
                        <textarea id="char-appearance-notes" rows="2" placeholder="Scars, tattoos..."></textarea>
                    </div>
                    <div class="form-group full-width section-divider">
                        <label>Sexuality</label>
                        <input type="text" id="char-sexuality" placeholder="Heterosexual, Homosexual, Bisexual, Pansexual, Asexual, Questioning, Other" />
                    </div>
                </div>
            </div>
        `;
    }

    function getPersonalityTabHTML() {
        return `
            <div id="char-tab-personality" class="char-tab-panel" style="display:none;">
                <div class="personality-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
                    <div class="form-group"><label>Traits</label><input type="text" id="char-traits" placeholder="Brave, Honest, Curious..." /></div>
                    <div class="form-group"><label>Ideals</label><input type="text" id="char-ideals" placeholder="Justice, Freedom, Truth..." /></div>
                    <div class="form-group"><label>Bonds</label><input type="text" id="char-bonds" placeholder="Family, Country, Friends..." /></div>
                    <div class="form-group"><label>Flaws</label><input type="text" id="char-flaws" placeholder="Fear, Pride, Greed..." /></div>
                    <div class="form-group"><label>Alignment</label><input type="text" id="char-alignment" placeholder="Lawful Good, Chaotic Neutral..." /></div>
                    <div class="form-group"><label>Likes</label><input type="text" id="char-likes" placeholder="Music, Books, Combat..." /></div>
                    <div class="form-group"><label>Dislikes</label><input type="text" id="char-dislikes" placeholder="Lies, Injustice, Spiders..." /></div>
                    <div class="form-group"><label>Habits</label><input type="text" id="char-habits" placeholder="Smoking, Pacing, Humming..." /></div>
                    <div class="form-group"><label>Fears</label><input type="text" id="char-fears" placeholder="Heights, Loss, Darkness..." /></div>
                    <div class="form-group"><label>Goals</label><input type="text" id="char-goals" placeholder="Seeking power, Revenge, Peace..." /></div>
                </div>
            </div>
        `;
    }

    function getAcademicTabHTML() {
        if (window.CharacterViews && typeof window.CharacterViews.getAcademicTabHTML === 'function') {
            return window.CharacterViews.getAcademicTabHTML();
        }

        return `
            <div id="char-tab-academic" class="char-tab-panel" style="display:none;">
                <p class="empty-state">Academic view not loaded.</p>
            </div>
        `;
    }

    function getProfessionalTabHTML() {
        if (window.CharacterViews && typeof window.CharacterViews.getProfessionalTabHTML === 'function') {
            return window.CharacterViews.getProfessionalTabHTML();
        }

        return `
            <div id="char-tab-professional" class="char-tab-panel" style="display:none;">
                <p class="empty-state">Professional view not loaded.</p>
            </div>
        `;
    }

    function getStatsTabHTML() {
        if (window.CharacterStatsView && typeof window.CharacterStatsView.getStatsTabHTML === 'function') {
            return window.CharacterStatsView.getStatsTabHTML();
        }

        return `
            <div id="char-tab-stats" class="char-tab-panel" style="display:none;">
                <p class="empty-state">Stats view not loaded.</p>
            </div>
        `;
    }

    function getSocialTabHTML() {
        if (window.CharacterViews && typeof window.CharacterViews.getSocialTabHTML === 'function') {
            return window.CharacterViews.getSocialTabHTML();
        }

        return `
            <div id="char-tab-social" class="char-tab-panel" style="display:none;">
                <p class="empty-state">Social view not loaded.</p>
            </div>
        `;
    }

    function getNotesTabHTML() {
        return `
            <div id="char-tab-notes" class="char-tab-panel" style="display:none;">
                <div class="form-group full-width">
                    <textarea id="char-notes" rows="6" placeholder="Background, motivations, history..." style="min-height:150px;"></textarea>
                </div>
            </div>
        `;
    }

    // ============================================================
    // INIT - RENDERING ONLY (events bound in character-events.js)
    // ============================================================

    function init(container) {
        if (!checkDependencies()) return;

        if (!container) {
            container = document.getElementById('tab-characters');
        }
        if (!container) return;

        var editId = typeof window.getCurrentEditId === 'function' ? window.getCurrentEditId() : null;

        if (editId) {
            show(editId);
        }
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterForm = {
        init: init,
        show: show,
        switchTab: switchTab,
        getTabsHTML: getTabsHTML,
        populateFormFields: populateFormFields,
        resetFormFields: resetFormFields,
        getCurrentTab: getCurrentTab
    };

})();
