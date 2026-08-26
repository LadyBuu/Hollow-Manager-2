/**
 * js/modules/characters/character-form.js - Character Form
 * Handles form rendering, tab switching, and form field population
 * Path: js/modules/characters/character-form.js
 * 
 * This module is responsible for:
 *   - Rendering the character form with all tabs
 *   - Switching between tabs
 *   - Populating form fields from character data
 *   - Resetting form fields for new characters
 *   - Managing class tags in the form
 * 
 * DEPENDENCIES:
 *   - window.CharacterViews
 *   - window.CharacterCRUD
 *   - window.CharacterEliminations
 *   - window.CharacterClasses
 *   - window.CharacterStats
 *   - window.getCharacterById (from utils)
 */

(function() {
    'use strict';

    // ============================================================
    // STATE
    // ============================================================

    var currentTab = 'name';

    // ============================================================
    // INIT
    // ============================================================

    function init(container) {
        if (!container) {
            container = document.getElementById('tab-characters');
        }
        if (!container) return;

        // Tab switching
        container.querySelectorAll('.char-tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var tab = this.dataset.tab;
                switchTab(tab);
            });
        });

        // Form submit
        var form = document.getElementById('char-form');
        if (form) {
            form.addEventListener('submit', function(e) {
                e.preventDefault();
                if (window.CharacterCRUD && typeof window.CharacterCRUD.save === 'function') {
                    window.CharacterCRUD.save();
                }
            });
        }

        // Delete button
        var deleteBtn = document.getElementById('delete-char-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', function() {
                var id = typeof window.currentEditId === 'function' ? window.currentEditId() : null;
                if (id && window.CharacterCRUD && typeof window.CharacterCRUD.delete === 'function') {
                    window.CharacterCRUD.delete(id);
                }
            });
        }

        // Deceased toggle
        var deceasedCheck = document.getElementById('char-deceased');
        if (deceasedCheck) {
            deceasedCheck.addEventListener('change', function() {
                var deathFields = document.getElementById('death-fields');
                if (deathFields) {
                    deathFields.style.display = this.checked ? 'block' : 'none';
                }
            });
        }

        // Add status button
        var addStatusBtn = document.getElementById('add-status-btn');
        if (addStatusBtn) {
            addStatusBtn.addEventListener('click', function() {
                var container = document.getElementById('career-status-container');
                if (window.CharacterViews && typeof window.CharacterViews.addCareerStatusEntry === 'function') {
                    window.CharacterViews.addCareerStatusEntry(container);
                }
            });
        }

        // Add elimination button
        var addElimBtn = document.getElementById('add-standalone-elim-btn');
        if (addElimBtn) {
            addElimBtn.addEventListener('click', function() {
                if (window.CharacterEliminations && typeof window.CharacterEliminations.addStandalone === 'function') {
                    window.CharacterEliminations.addStandalone();
                }
            });
        }

        // Social button
        var socialBtn = document.getElementById('add-social-relation-btn');
        if (socialBtn) {
            socialBtn.addEventListener('click', function() {
                var id = typeof window.currentEditId === 'function' ? window.currentEditId() : null;
                if (!id) {
                    alert('Please save the character first.');
                    return;
                }
                if (typeof window.showRelationshipForm === 'function') {
                    window.showRelationshipForm(null, id);
                } else {
                    alert('Relationship functionality is not available. Please use the Social tab.');
                }
            });
        }

        // Class tag input
        var classInput = document.getElementById('class-tag-input');
        if (classInput) {
            classInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    var name = this.value.trim();
                    if (!name) return;
                    
                    var cls = typeof window.getClassByName === 'function' ? window.getClassByName(name) : null;
                    if (!cls) {
                        var result = typeof window.createClass === 'function' ? window.createClass(name) : null;
                        if (result && result.success) {
                            cls = result.class;
                        } else {
                            alert(result ? result.message : 'Failed to create class.');
                            return;
                        }
                    }
                    
                    if (window.CharacterClasses && typeof window.CharacterClasses.addClassTag === 'function') {
                        window.CharacterClasses.addClassTag(cls.id, cls.name);
                    }
                    this.value = '';
                }
            });
        }

        // Academic tab buttons
        var addToClassBtn = document.getElementById('add-to-class-btn');
        if (addToClassBtn) {
            addToClassBtn.addEventListener('click', function() {
                if (window.CharacterClasses && typeof window.CharacterClasses.addToClass === 'function') {
                    window.CharacterClasses.addToClass();
                }
            });
        }

        var removeFromClassBtn = document.getElementById('remove-from-class-btn');
        if (removeFromClassBtn) {
            removeFromClassBtn.addEventListener('click', function() {
                if (window.CharacterClasses && typeof window.CharacterClasses.removeFromClass === 'function') {
                    window.CharacterClasses.removeFromClass();
                }
            });
        }

        // Stats events
        if (window.CharacterStats && typeof window.CharacterStats.initStatsEvents === 'function') {
            window.CharacterStats.initStatsEvents();
        }
        
        // Magic events
        if (window.CharacterStats && typeof window.CharacterStats.initMagicEvents === 'function') {
            window.CharacterStats.initMagicEvents();
        }
        
        // Special moves events
        if (window.CharacterStats && typeof window.CharacterStats.initSpecialMovesEvents === 'function') {
            window.CharacterStats.initSpecialMovesEvents();
        }
    }

    // ============================================================
    // TAB SWITCHING
    // ============================================================

    function switchTab(tab) {
        currentTab = tab;
        
        document.querySelectorAll('.char-tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        
        document.querySelectorAll('.char-tab-panel').forEach(function(panel) {
            var panelId = panel.id.replace('char-tab-', '');
            panel.style.display = panelId === tab ? 'block' : 'none';
            panel.classList.toggle('active', panelId === tab);
        });
        
        // Refresh views when switching to certain tabs
        var id = typeof window.currentEditId === 'function' ? window.currentEditId() : null;
        if (id) {
            var char = typeof window.getCharacterById === 'function' ? window.getCharacterById(id) : null;
            if (char) {
                if (tab === 'academic' && window.CharacterViews && typeof window.CharacterViews.renderAcademic === 'function') {
                    window.CharacterViews.renderAcademic(char);
                } else if (tab === 'professional' && window.CharacterViews && typeof window.CharacterViews.renderProfessional === 'function') {
                    window.CharacterViews.renderProfessional(char);
                } else if (tab === 'social' && window.CharacterViews && typeof window.CharacterViews.renderSocial === 'function') {
                    window.CharacterViews.renderSocial(char);
                }
            }
        }
    }

    // ============================================================
    // SHOW CHARACTER IN FORM
    // ============================================================

    function show(editId) {
        var data = window.data || {};
        var form = document.getElementById('character-form');
        var title = document.getElementById('form-title');
        var nameDisplay = document.getElementById('current-char-name');

        // Reset to first tab
        switchTab('name');

        if (editId !== null && editId !== undefined && editId !== '') {
            var char = data.characters ? data.characters.find(function(c) { 
                return String(c.id) === String(editId); 
            }) : null;
            
            if (!char) {
                title.textContent = 'Character not found';
                return;
            }
            
            title.textContent = 'Edit Character';
            if (nameDisplay) nameDisplay.textContent = window.getDisplayName ? window.getDisplayName(char) : char.firstName || '';

            populateFormFields(char);
            
            if (window.CharacterViews && typeof window.CharacterViews.renderAcademic === 'function') {
                window.CharacterViews.renderAcademic(char);
            }
            if (window.CharacterViews && typeof window.CharacterViews.renderProfessional === 'function') {
                window.CharacterViews.renderProfessional(char);
            }
            if (window.CharacterViews && typeof window.CharacterViews.renderSocial === 'function') {
                window.CharacterViews.renderSocial(char);
            }

            var formElement = document.getElementById('char-form');
            if (formElement) formElement.dataset.editId = editId;

            if (window.CharacterList && typeof window.CharacterList.render === 'function') {
                window.CharacterList.render();
            }
        } else {
            title.textContent = 'New Character';
            if (nameDisplay) nameDisplay.textContent = 'New Character';
            
            var formElement = document.getElementById('char-form');
            if (formElement) {
                formElement.reset();
                delete formElement.dataset.editId;
            }
            
            resetFormFields();
            
            if (window.CharacterList && typeof window.CharacterList.render === 'function') {
                window.CharacterList.render();
            }
        }

        if (form) {
            form.style.display = 'block';
            form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    // ============================================================
    // POPULATE FORM FIELDS
    // ============================================================

    function populateFormFields(char) {
        if (!char) return;

        // Name tab
        setFieldValue('char-firstname', char.firstName || '');
        setFieldValue('char-middlename', char.middleName || '');
        setFieldValue('char-lastname', char.lastName || '');
        setFieldValue('char-nickname', char.nickname || '');
        setFieldValue('char-alias', char.alias || '');
        setFieldValue('char-previous-names', (char.previousNames || []).join(', '));
        setFieldValue('char-name-format', char.nameFormat || 'firstlast');
        setFieldValue('char-birthyear', char.birthYear || '');
        setCheckbox('char-deceased', char.deceased || false);
        setFieldValue('char-death-year', char.deathYear || '');
        setFieldValue('char-death-cause', char.deathCause || '');
        setFieldValue('char-death-age', char.deathAge || '');

        // Show/hide death fields
        var deathFields = document.getElementById('death-fields');
        if (deathFields) {
            deathFields.style.display = char.deceased ? 'block' : 'none';
        }

        // Physical tab
        setFieldValue('char-gender', char.gender || '');
        setFieldValue('char-eyes', char.eyes || '');
        setFieldValue('char-hair', char.hair || '');
        setFieldValue('char-skin', char.skin || '');
        setFieldValue('char-height', char.height || '');
        setFieldValue('char-weight', char.weight || '');
        setFieldValue('char-build', char.build || '');
        setFieldValue('char-appearance-notes', char.appearanceNotes || '');

        // Personality tab
        var p = char.personality || {};
        setFieldValue('char-traits', p.traits || '');
        setFieldValue('char-ideals', p.ideals || '');
        setFieldValue('char-flaws', p.flaws || '');
        setFieldValue('char-alignment', p.alignment || '');
        setFieldValue('char-likes', p.likes || '');
        setFieldValue('char-dislikes', p.dislikes || '');
        setFieldValue('char-habits', p.habits || '');
        setFieldValue('char-fears', p.fears || '');
        setFieldValue('char-goals', p.goals || '');

        // Stats tab
        var stats = window.CharacterStats && typeof window.CharacterStats.getCharacterStats === 'function' 
            ? window.CharacterStats.getCharacterStats(char) 
            : char.stats || {};
        setFieldValue('char-str', stats.str || 10);
        setFieldValue('char-dex', stats.dex || 10);
        setFieldValue('char-con', stats.con || 10);
        setFieldValue('char-int', stats.int || 10);
        setFieldValue('char-wis', stats.wis || 10);
        setFieldValue('char-cha', stats.cha || 10);

        // Magic stats
        var magic = window.CharacterStats && typeof window.CharacterStats.getCharacterMagic === 'function'
            ? window.CharacterStats.getCharacterMagic(char)
            : char.magic || {};
        var magicTypes = ['earth', 'water', 'fire', 'air', 'metal', 'wood',
            'blood', 'bone', 'mind', 'morphic', 'life', 'death',
            'space', 'time', 'dimension', 'void', 'reality', 'transference'];
        magicTypes.forEach(function(key) {
            var input = document.getElementById('magic-' + key);
            if (input) {
                input.value = magic[key] !== undefined ? magic[key] : 0;
            }
        });

        // Update suggestions
        if (window.CharacterStats && typeof window.CharacterStats.updateClassSuggestion === 'function') {
            window.CharacterStats.updateClassSuggestion();
        }
        if (window.CharacterStats && typeof window.CharacterStats.updateMagicClassSuggestion === 'function') {
            window.CharacterStats.updateMagicClassSuggestion();
        }
        if (window.CharacterStats && typeof window.CharacterStats.updateMagicPowerDisplay === 'function') {
            window.CharacterStats.updateMagicPowerDisplay();
        }

        // Special moves
        var moves = window.CharacterStats && typeof window.CharacterStats.getSpecialMoves === 'function'
            ? window.CharacterStats.getSpecialMoves(char)
            : char.specialMoves || { physical: [], magical: [] };
        
        if (window.CharacterStats && typeof window.CharacterStats.renderSpecialMoves === 'function') {
            window.CharacterStats.renderSpecialMoves('physical-moves-list', moves.physical || [], 'physical');
            window.CharacterStats.renderSpecialMoves('magical-moves-list', moves.magical || [], 'magical');
        }

        // Career status
        var statusContainer = document.getElementById('career-status-container');
        if (statusContainer) {
            statusContainer.innerHTML = '';
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
        setFieldValue('char-specialty', char.specialty || '');

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
        setFieldValue('char-notes', char.notes || '');
    }

    // ============================================================
    // RESET FORM FIELDS
    // ============================================================

    function resetFormFields() {
        // Reset all inputs to default values
        var inputs = document.querySelectorAll('#char-form input, #char-form textarea, #char-form select');
        inputs.forEach(function(input) {
            if (input.type === 'checkbox') {
                input.checked = false;
            } else if (input.type === 'number') {
                var defaultVal = input.id === 'char-str' || input.id === 'char-dex' || 
                                 input.id === 'char-con' || input.id === 'char-int' || 
                                 input.id === 'char-wis' || input.id === 'char-cha' ? 10 : '';
                input.value = defaultVal;
            } else {
                input.value = '';
            }
        });

        // Reset magic inputs to 0
        var magicTypes = ['earth', 'water', 'fire', 'air', 'metal', 'wood',
            'blood', 'bone', 'mind', 'morphic', 'life', 'death',
            'space', 'time', 'dimension', 'void', 'reality', 'transference'];
        magicTypes.forEach(function(key) {
            var input = document.getElementById('magic-' + key);
            if (input) input.value = 0;
        });

        // Reset death fields
        var deathFields = document.getElementById('death-fields');
        if (deathFields) deathFields.style.display = 'none';

        // Reset career status
        var statusContainer = document.getElementById('career-status-container');
        if (statusContainer) {
            statusContainer.innerHTML = '';
            if (window.CharacterViews && typeof window.CharacterViews.addCareerStatusEntry === 'function') {
                window.CharacterViews.addCareerStatusEntry(statusContainer);
            }
        }

        // Reset class tags
        if (window.CharacterClasses && typeof window.CharacterClasses.clearClassTags === 'function') {
            window.CharacterClasses.clearClassTags();
        }

        // Reset class selector
        var classSelect = document.getElementById('academic-class-select');
        if (classSelect) {
            classSelect.innerHTML = '<option value="">Select a class...</option>';
        }

        // Reset current classes display
        var classesDisplay = document.getElementById('current-classes-list');
        if (classesDisplay) classesDisplay.textContent = 'None';

        // Reset eliminations views
        var tournView = document.getElementById('tournament-eliminations-view');
        if (tournView) tournView.innerHTML = '<p class="empty-state" style="padding:6px;font-size:0.75rem;">None</p>';
        var standaloneView = document.getElementById('standalone-eliminations-container');
        if (standaloneView) standaloneView.innerHTML = '<p class="empty-state" style="padding:6px;font-size:0.75rem;">None</p>';

        // Reset social view
        var socialView = document.getElementById('social-view');
        if (socialView) socialView.innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">Save character to view social connections</p>';

        // Reset academic/professional views
        var acadView = document.getElementById('academic-view');
        if (acadView) acadView.innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">Save character to view academic data</p>';
        var profView = document.getElementById('professional-view');
        if (profView) profView.innerHTML = '<p class="empty-state" style="padding:8px;font-size:0.8rem;">Save character to view professional data</p>';

        // Reset special moves
        var physMoves = document.getElementById('physical-moves-list');
        if (physMoves) physMoves.innerHTML = '<p class="empty-state" style="padding:4px;font-size:0.7rem;">None</p>';
        var magMoves = document.getElementById('magical-moves-list');
        if (magMoves) magMoves.innerHTML = '<p class="empty-state" style="padding:4px;font-size:0.7rem;">None</p>';

        // Update suggestions
        if (window.CharacterStats && typeof window.CharacterStats.updateClassSuggestion === 'function') {
            window.CharacterStats.updateClassSuggestion();
        }
        if (window.CharacterStats && typeof window.CharacterStats.updateMagicClassSuggestion === 'function') {
            window.CharacterStats.updateMagicClassSuggestion();
        }
        if (window.CharacterStats && typeof window.CharacterStats.updateMagicPowerDisplay === 'function') {
            window.CharacterStats.updateMagicPowerDisplay();
        }

        // Reset form edit ID
        var form = document.getElementById('char-form');
        if (form) delete form.dataset.editId;
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
                        <div id="death-fields" class="death-fields">
                            <div class="form-group"><label>Year of Death</label><input type="number" id="char-death-year" placeholder="e.g., 2023" /></div>
                            <div class="form-group"><label>Death Age</label><input type="number" id="char-death-age" min="0" max="150" placeholder="e.g., 45" /></div>
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
                        <input type="text" id="char-height" placeholder='e.g., 5'"10"' />
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
        return `
            <div id="char-tab-academic" class="char-tab-panel" style="display:none;">
                <div id="academic-view" style="padding:4px 0;">
                    <p class="empty-state" style="padding:8px;font-size:0.8rem;">Loading academic data...</p>
                </div>
                <div class="form-group full-width section-divider">
                    <label class="section-label">Class Management</label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:4px;">
                        <select id="academic-class-select" style="flex:1;min-width:150px;padding:6px;background:var(--panel-alt);border:1px solid var(--border);color:var(--text);border-radius:6px;">
                            <option value="">Select a class...</option>
                        </select>
                        <button id="add-to-class-btn" class="primary small">Add to Class</button>
                        <button id="remove-from-class-btn" class="danger small">Remove from Class</button>
                    </div>
                    <div id="character-classes-display" style="margin-top:8px;padding:8px;background:var(--bg);border-radius:4px;border:1px solid var(--border-soft);">
                        <span style="color:var(--text-dim);font-size:0.7rem;">Current Classes: <span id="current-classes-list">None</span></span>
                    </div>
                </div>
                <div class="form-group full-width section-divider">
                    <label>Tournament Eliminations</label>
                    <div id="tournament-eliminations-view"><p class="empty-state" style="padding:6px;font-size:0.75rem;">None</p></div>
                </div>
                <div class="form-group full-width section-divider">
                    <label class="section-label warning-label">Standalone Elimination</label>
                    <div class="elimination-controls">
                        <label>Week:</label>
                        <input type="number" id="standalone-elim-week" min="1" max="52" value="1" />
                        <label>Reason:</label>
                        <input type="text" id="standalone-elim-reason" placeholder="e.g., Dropped out" />
                        <button type="button" id="add-standalone-elim-btn" class="small warning-btn">Apply</button>
                    </div>
                    <div id="standalone-eliminations-container"><p class="empty-state" style="padding:6px;font-size:0.75rem;">None</p></div>
                </div>
            </div>
        `;
    }

    function getProfessionalTabHTML() {
        return `
            <div id="char-tab-professional" class="char-tab-panel" style="display:none;">
                <div class="form-group full-width">
                    <label>Career Status History</label>
                    <div id="career-status-container">
                        <div class="career-status-entry">
                            <select class="career-status-select">
                                <option value="">Select status...</option>
                                <option value="civilian">Civilian</option>
                                <option value="trainee">Trainee</option>
                                <option value="rookie">Rookie</option>
                                <option value="junior">Junior</option>
                                <option value="senior">Senior</option>
                                <option value="instructor">Instructor</option>
                                <option value="support">Support</option>
                            </select>
                            <input type="number" class="career-start-year" placeholder="Start Year" />
                            <input type="number" class="career-end-year" placeholder="End Year" />
                            <button type="button" class="small danger remove-status">✕</button>
                        </div>
                    </div>
                    <button type="button" id="add-status-btn" class="small">+ Add Status</button>
                </div>
                <div class="form-group full-width">
                    <label>Specialty/Discipline</label>
                    <input type="text" id="char-specialty" />
                </div>
                <div id="professional-view" style="padding:4px 0;">
                    <p class="empty-state" style="padding:8px;font-size:0.8rem;">Loading professional data...</p>
                </div>
            </div>
        `;
    }

    function getStatsTabHTML() {
        // Get stats tab HTML from CharacterStats module
        if (window.CharacterStats && typeof window.CharacterStats.getStatsTabHTML === 'function') {
            return window.CharacterStats.getStatsTabHTML();
        }
        return `
            <div id="char-tab-stats" class="char-tab-panel" style="display:none;">
                <p class="empty-state">Stats module not loaded</p>
            </div>
        `;
    }

    function getSocialTabHTML() {
        return `
            <div id="char-tab-social" class="char-tab-panel" style="display:none;">
                <div id="social-view">
                    <p class="empty-state" style="padding:8px;font-size:0.8rem;">Loading social connections...</p>
                </div>
                <div class="form-actions" style="margin-top:8px;">
                    <button type="button" id="add-social-relation-btn" class="primary small">+ Add Connection</button>
                </div>
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
    // EXPOSE
    // ============================================================

    window.CharacterForm = {
        init: init,
        show: show,
        switchTab: switchTab,
        getTabsHTML: getTabsHTML,
        populateFormFields: populateFormFields,
        resetFormFields: resetFormFields
    };

})();
