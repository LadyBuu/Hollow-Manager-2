/**
 * js/modules/characters/character-events.js - Character Events
 * Initializes all character module event listeners
 * Path: js/modules/characters/character-events.js
 * 
 * This module is responsible for:
 *   - Toggle character list
 *   - Add character button
 *   - Form submission (save/delete)
 *   - Tab switching
 *   - Filter controls (search, status, class)
 *   - Career status management
 *   - Deceased toggle
 *   - Elimination controls
 *   - Class tag input
 *   - Academic class management
 *   - Social relationship button
 *   - Stats/magic events (delegated to CharacterStats)
 *   - Special moves events (delegated to CharacterStats)
 *   - Click outside to close list
 */

(function() {
    'use strict';

    var characterListOpen = false;

    // ============================================================
    // MAIN INITIALIZATION
    // ============================================================

    function init(container) {
        if (!container) {
            container = document.getElementById('tab-characters');
        }
        if (!container) return;

        initToggleList(container);
        initAddCharacter(container);
        initFormSubmit(container);
        initDeleteButton(container);
        initTabSwitching(container);
        initFilters(container);
        initCareerStatus(container);
        initDeceasedToggle(container);
        initEliminationControls(container);
        initClassTagInput(container);
        initAcademicClassControls(container);
        initSocialButton(container);
        initClickOutside(container);
        
        // Stats/magic events are initialized by CharacterStats module
        // This is called from character-form.js
    }

    // ============================================================
    // TOGGLE CHARACTER LIST
    // ============================================================

    function initToggleList(container) {
        var toggleBtn = document.getElementById('toggle-char-list');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                toggleCharacterList();
            });
        }
    }

    function toggleCharacterList(open) {
        var panel = document.getElementById('char-list-panel');
        var toggle = document.getElementById('toggle-char-list');
        if (!panel) return;
        
        if (open === undefined) {
            characterListOpen = !characterListOpen;
        } else {
            characterListOpen = open;
        }
        
        panel.classList.toggle('open', characterListOpen);
        if (toggle) {
            toggle.classList.toggle('open', characterListOpen);
        }
    }

    // ============================================================
    // ADD CHARACTER
    // ============================================================

    function initAddCharacter(container) {
        var addBtn = document.getElementById('add-character-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function() {
                window.setCurrentEditId(null);
                window.showCharacterForm(null);
                if (window.innerWidth < 768) {
                    toggleCharacterList(false);
                }
            });
        }
    }

    // ============================================================
    // FORM SUBMIT
    // ============================================================

    function initFormSubmit(container) {
        var form = document.getElementById('char-form');
        if (form) {
            form.addEventListener('submit', function(e) {
                e.preventDefault();
                window.CharacterCRUD.save();
            });
        }
    }

    // ============================================================
    // DELETE BUTTON
    // ============================================================

    function initDeleteButton(container) {
        var deleteBtn = document.getElementById('delete-char-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', function() {
                var id = window.currentEditId ? window.currentEditId() : null;
                if (id && confirm('Delete this character permanently?')) {
                    window.CharacterCRUD.delete(id);
                }
            });
        }
    }

    // ============================================================
    // TAB SWITCHING
    // ============================================================

    function initTabSwitching(container) {
        container.querySelectorAll('.char-tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var tab = this.dataset.tab;
                switchTab(tab);
            });
        });
    }

    function switchTab(tab) {
        document.querySelectorAll('.char-tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        
        document.querySelectorAll('.char-tab-panel').forEach(function(panel) {
            var panelId = panel.id.replace('char-tab-', '');
            panel.style.display = panelId === tab ? 'block' : 'none';
            panel.classList.toggle('active', panelId === tab);
        });
        
        // Refresh views when switching to certain tabs
        var id = window.currentEditId ? window.currentEditId() : null;
        if (id) {
            var char = window.getCharacterById(id);
            if (char) {
                if (tab === 'academic') {
                    window.CharacterViews.renderAcademic(char);
                } else if (tab === 'professional') {
                    window.CharacterViews.renderProfessional(char);
                } else if (tab === 'social') {
                    window.CharacterViews.renderSocial(char);
                }
            }
        }
    }

    // ============================================================
    // FILTERS
    // ============================================================

    function initFilters(container) {
        var nameFilter = document.getElementById('char-name-filter');
        if (nameFilter) {
            nameFilter.addEventListener('input', function() {
                window.CharacterList.render();
            });
        }

        var statusFilter = document.getElementById('char-status-filter');
        if (statusFilter) {
            statusFilter.addEventListener('change', function() {
                window.CharacterList.render();
            });
        }

        var classFilter = document.getElementById('char-class-filter');
        if (classFilter) {
            classFilter.addEventListener('change', function() {
                window.CharacterList.render();
            });
        }

        var clearFilter = document.getElementById('clear-char-filter');
        if (clearFilter) {
            clearFilter.addEventListener('click', function() {
                document.getElementById('char-name-filter').value = '';
                document.getElementById('char-status-filter').value = 'all';
                document.getElementById('char-class-filter').value = 'all';
                window.CharacterList.render();
            });
        }
    }

    // ============================================================
    // CAREER STATUS
    // ============================================================

    function initCareerStatus(container) {
        var addStatusBtn = document.getElementById('add-status-btn');
        if (addStatusBtn) {
            addStatusBtn.addEventListener('click', function() {
                var container = document.getElementById('career-status-container');
                window.CharacterViews.addCareerStatusEntry(container);
            });
        }

        // Handle remove status via event delegation
        document.addEventListener('click', function(e) {
            if (e.target && e.target.classList.contains('remove-status')) {
                var entry = e.target.closest('.career-status-entry');
                var container = document.getElementById('career-status-container');
                if (entry && container && container.children.length > 1) {
                    entry.remove();
                } else if (entry && container) {
                    alert('You need at least one status entry.');
                }
            }
        });
    }

    // ============================================================
    // DECEASED TOGGLE
    // ============================================================

    function initDeceasedToggle(container) {
        var deceasedCheck = document.getElementById('char-deceased');
        if (deceasedCheck) {
            deceasedCheck.addEventListener('change', function() {
                var deathFields = document.getElementById('death-fields');
                if (deathFields) {
                    deathFields.style.display = this.checked ? 'block' : 'none';
                }
            });
        }
    }

    // ============================================================
    // ELIMINATION CONTROLS
    // ============================================================

    function initEliminationControls(container) {
        var addElimBtn = document.getElementById('add-standalone-elim-btn');
        if (addElimBtn) {
            addElimBtn.addEventListener('click', function() {
                window.CharacterEliminations.addStandalone();
            });
        }

        // Handle remove standalone elimination via event delegation
        document.addEventListener('click', function(e) {
            if (e.target && e.target.classList.contains('remove-standalone-elim')) {
                var id = window.currentEditId ? window.currentEditId() : null;
                var index = parseInt(e.target.dataset.index);
                if (id !== null && !isNaN(index)) {
                    window.CharacterEliminations.removeStandalone(id, index);
                }
            }
        });
    }

    // ============================================================
    // CLASS TAG INPUT
    // ============================================================

    function initClassTagInput(container) {
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
                    
                    window.CharacterClasses.addClassTag(cls.id, cls.name);
                    this.value = '';
                }
            });
        }

        // Handle remove class tag via event delegation
        document.addEventListener('click', function(e) {
            if (e.target && e.target.classList.contains('remove-class-tag')) {
                var id = e.target.dataset.id;
                var container = document.getElementById('class-tag-container');
                var tag = container.querySelector('[data-class-id="' + id + '"]');
                if (tag) tag.remove();
                if (container.children.length === 0) {
                    container.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem;padding:4px;">No classes assigned</span>';
                }
            }
        });
    }

    // ============================================================
    // ACADEMIC CLASS CONTROLS
    // ============================================================

    function initAcademicClassControls(container) {
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
    }

    // ============================================================
    // SOCIAL BUTTON
    // ============================================================

    function initSocialButton(container) {
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
    }

    // ============================================================
    // CLICK OUTSIDE TO CLOSE LIST
    // ============================================================

    function initClickOutside(container) {
        document.addEventListener('click', function(e) {
            var panel = document.getElementById('char-list-panel');
            var toggle = document.getElementById('toggle-char-list');
            if (panel && panel.classList.contains('open')) {
                if (!panel.contains(e.target) && !toggle.contains(e.target)) {
                    toggleCharacterList(false);
                }
            }
        });
    }

    // ============================================================
    // EXPOSE
    // ============================================================

    window.CharacterEvents = {
        init: init,
        toggleCharacterList: toggleCharacterList,
        switchTab: switchTab
    };

})();
