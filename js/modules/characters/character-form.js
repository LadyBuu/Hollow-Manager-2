/**
 * js/modules/characters/character-form.js - Character Form
 * Path: js/modules/characters/character-form.js
 */

(function() {
    'use strict';

    var currentTab = 'name';

    function init(container) {
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
                window.CharacterCRUD.save();
            });
        }

        // Delete button
        var deleteBtn = document.getElementById('delete-char-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', function() {
                var id = window.currentEditId ? window.currentEditId() : null;
                if (id && confirm('Delete this character permanently?')) {
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
                window.CharacterViews.addCareerStatusEntry(container);
            });
        }

        // Add elimination button
        var addElimBtn = document.getElementById('add-standalone-elim-btn');
        if (addElimBtn) {
            addElimBtn.addEventListener('click', function() {
                window.CharacterEliminations.addStandalone();
            });
        }

        // Social button
        var socialBtn = document.getElementById('add-social-relation-btn');
        if (socialBtn) {
            socialBtn.addEventListener('click', function() {
                var id = window.currentEditId ? window.currentEditId() : null;
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
                    
                    var cls = window.getClassByName(name);
                    if (!cls) {
                        var result = window.createClass(name);
                        if (result.success) {
                            cls = result.class;
                        } else {
                            alert(result.message);
                            return;
                        }
                    }
                    
                    var container = document.getElementById('class-tag-container');
                    var existing = container.querySelector('[data-class-id="' + cls.id + '"]');
                    if (existing) {
                        alert('This class is already assigned.');
                        return;
                    }
                    
                    addClassTag(cls.id, cls.name);
                    this.value = '';
                }
            });
        }

        // Academic tab buttons
        var addToClassBtn = document.getElementById('add-to-class-btn');
        if (addToClassBtn) {
            addToClassBtn.addEventListener('click', function() {
                window.CharacterClasses.addToClass();
            });
        }

        var removeFromClassBtn = document.getElementById('remove-from-class-btn');
        if (removeFromClassBtn) {
            removeFromClassBtn.addEventListener('click', function() {
                window.CharacterClasses.removeFromClass();
            });
        }

        // Stats events
        window.CharacterStats.initStatsEvents();
        
        // Magic events
        window.CharacterStats.initMagicEvents();
        
        // Special moves events
        window.CharacterStats.initSpecialMovesEvents();
    }

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
    }

    function show(editId) {
        window.setCurrentEditId(editId);
        var data = window.data || {};
        var form = document.getElementById('character-form');
        var title = document.getElementById('form-title');
        var nameDisplay = document.getElementById('current-char-name');

        // Reset to first tab
        switchTab('name');

        if (editId) {
            var char = data.characters.find(function(c) { return String(c.id) === String(editId); });
            if (!char) {
                title.textContent = 'Character not found';
                return;
            }
            title.textContent = 'Edit Character';
            if (nameDisplay) nameDisplay.textContent = window.getDisplayName(char);

            populateFormFields(char);
            window.CharacterViews.renderAcademic(char);
            window.CharacterViews.renderProfessional(char);
            window.CharacterViews.renderSocial(char);

            var formElement = document.getElementById('char-form');
            if (formElement) formElement.dataset.editId = editId;

            window.CharacterList.render();
        } else {
            title.textContent = 'New Character';
            if (nameDisplay) nameDisplay.textContent = 'New Character';
            var formElement = document.getElementById('char-form');
            if (formElement) {
                formElement.reset();
                delete formElement.dataset.editId;
            }
            resetFormFields();
            window.CharacterList.render();
        }

        form.style.display = 'block';
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

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
            ${getTabPanelsHTML()}
        `;
    }

    function getTabPanelsHTML() {
        // This is a simplified version - the actual HTML is large
        // In practice, you'd keep the existing HTML structure here
        return `
            <!-- Name Tab -->
            <div id="char-tab-name" class="char-tab-panel active">
                ${getNameTabHTML()}
            </div>
            <!-- Physical Tab -->
            <div id="char-tab-physical" class="char-tab-panel" style="display:none;">
                ${getPhysicalTabHTML()}
            </div>
            <!-- Personality Tab -->
            <div id="char-tab-personality" class="char-tab-panel" style="display:none;">
                ${getPersonalityTabHTML()}
            </div>
            <!-- Academic Tab -->
            <div id="char-tab-academic" class="char-tab-panel" style="display:none;">
                ${getAcademicTabHTML()}
            </div>
            <!-- Professional Tab -->
            <div id="char-tab-professional" class="char-tab-panel" style="display:none;">
                ${getProfessionalTabHTML()}
            </div>
            <!-- Stats Tab -->
            <div id="char-tab-stats" class="char-tab-panel" style="display:none;">
                ${window.CharacterStats.getStatsTabHTML()}
            </div>
            <!-- Social Tab -->
            <div id="char-tab-social" class="char-tab-panel" style="display:none;">
                <div id="social-view">
                    <p class="empty-state" style="padding:8px;font-size:0.8rem;">Loading social connections...</p>
                </div>
                <div class="form-actions" style="margin-top:8px;">
                    <button type="button" id="add-social-relation-btn" class="primary small">+ Add Connection</button>
                </div>
            </div>
            <!-- Notes Tab -->
            <div id="char-tab-notes" class="char-tab-panel" style="display:none;">
                <div class="form-group full-width">
                    <textarea id="char-notes" rows="6" placeholder="Background, motivations, history..." style="min-height:150px;"></textarea>
                </div>
            </div>
        `;
    }

    // ... (rest of the HTML generation functions)

    function populateFormFields(char) {
        // ... (existing populateFormFields logic)
    }

    function resetFormFields() {
        // ... (existing resetFormFields logic)
    }

    function addClassTag(classId, className) {
        // ... (existing addClassTag logic)
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
        addClassTag: addClassTag
    };

})();
